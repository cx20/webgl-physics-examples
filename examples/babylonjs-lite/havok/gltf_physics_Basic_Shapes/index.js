import {
    addPhysicsShapeChildFromParent, addToScene, attachControl, createArcRotateCamera, createEngine,
    createHavokWorld, createHemisphericLight, createPhysicsBody, createPhysicsShape,
    createPhysicsViewer, createSceneContext, createTransformNode, hidePhysicsBody, loadGltf,
    onBeforeRender, PhysicsMotionType, PhysicsShapeType, registerScene, setPhysicsBodyMassProperties,
    setPhysicsBodyShape, showPhysicsBody, startEngine,
} from '@babylonjs/lite';
import HavokPhysics from '@babylonjs/havok';

// Khronos glTF Physics sample (KHR_physics_rigid_bodies + KHR_implicit_shapes).
// Same asset the three.js / Rhodonite / PlayCanvas examples load.
const MODEL_URL = 'https://raw.githubusercontent.com/eoineoineoin/glTF_Physics/master/samples/ShapeTypes/ShapeTypes.glb';
const PHYSICS_FPS = 60;

// Babylon.js Lite has no built-in glTF-physics loader, so we parse the glb's physics extensions
// ourselves and drive each body with the Lite Havok wrapper. Bodies are reconstructed at the Babylon
// left-handed world pose decompose(F * node-world), F = diag(-1, 1, 1), so the scene matches the
// Babylon.js (full) example. This is the catch-all "shape types" sample: box / sphere / capsule /
// cylinder (incl. tapered) primitives, convex-hull and triangle-mesh colliders (the Suzanne meshes
// and the static ground plane), and a dynamic compound "car" (a container of wheel cylinders + a
// chassis convex hull, with decorative trigger headlights that ride along visually).

async function fetchGltfJson(url) {
    const buffer = await fetch(url).then((r) => r.arrayBuffer());
    const view = new DataView(buffer);
    if (view.getUint32(0, true) !== 0x46546c67) throw new Error('Not a binary glTF (glb): ' + url);
    let offset = 12;
    while (offset < view.byteLength) {
        const chunkLength = view.getUint32(offset, true);
        const chunkType = view.getUint32(offset + 4, true);
        const dataStart = offset + 8;
        if (chunkType === 0x4e4f534a) return JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, dataStart, chunkLength)));
        offset = dataStart + chunkLength;
    }
    throw new Error('glb has no JSON chunk: ' + url);
}

function composeTRS(t, q, s) {
    const [x, y, z, w] = q;
    const [sx, sy, sz] = s;
    const m00 = 1 - 2 * (y * y + z * z), m01 = 2 * (x * y - z * w), m02 = 2 * (x * z + y * w);
    const m10 = 2 * (x * y + z * w), m11 = 1 - 2 * (x * x + z * z), m12 = 2 * (y * z - x * w);
    const m20 = 2 * (x * z - y * w), m21 = 2 * (y * z + x * w), m22 = 1 - 2 * (x * x + y * y);
    return [m00 * sx, m10 * sx, m20 * sx, 0, m01 * sy, m11 * sy, m21 * sy, 0, m02 * sz, m12 * sz, m22 * sz, 0, t[0], t[1], t[2], 1];
}

function mat4Multiply(a, b) {
    const o = new Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
        let v = 0;
        for (let k = 0; k < 4; k++) v += a[k * 4 + r] * b[c * 4 + k];
        o[c * 4 + r] = v;
    }
    return o;
}

function nodeLocalMatrix(node) {
    if (node.matrix) return node.matrix.slice();
    return composeTRS(node.translation || [0, 0, 0], node.rotation || [0, 0, 0, 1], node.scale || [1, 1, 1]);
}

function nodeWorldMatrix(json, parentMap, index) {
    let m = nodeLocalMatrix(json.nodes[index]);
    for (let p = parentMap[index]; p !== undefined; p = parentMap[p]) m = mat4Multiply(nodeLocalMatrix(json.nodes[p]), m);
    return m;
}

function applyLeftHandedFlip(m) {
    const o = m.slice();
    o[0] = -o[0]; o[4] = -o[4]; o[8] = -o[8]; o[12] = -o[12];
    return o;
}

function matrixToQuaternion(r) {
    const m00 = r[0], m10 = r[1], m20 = r[2], m01 = r[4], m11 = r[5], m21 = r[6], m02 = r[8], m12 = r[9], m22 = r[10];
    const trace = m00 + m11 + m22;
    let x, y, z, w, s;
    if (trace > 0) {
        s = Math.sqrt(trace + 1) * 2; w = 0.25 * s; x = (m21 - m12) / s; y = (m02 - m20) / s; z = (m10 - m01) / s;
    } else if (m00 > m11 && m00 > m22) {
        s = Math.sqrt(1 + m00 - m11 - m22) * 2; w = (m21 - m12) / s; x = 0.25 * s; y = (m01 + m10) / s; z = (m02 + m20) / s;
    } else if (m11 > m22) {
        s = Math.sqrt(1 + m11 - m00 - m22) * 2; w = (m02 - m20) / s; x = (m01 + m10) / s; y = 0.25 * s; z = (m12 + m21) / s;
    } else {
        s = Math.sqrt(1 + m22 - m00 - m11) * 2; w = (m10 - m01) / s; x = (m02 + m20) / s; y = (m12 + m21) / s; z = 0.25 * s;
    }
    return [x, y, z, w];
}

function decomposeMatrix(m) {
    const position = [m[12], m[13], m[14]];
    let sx = Math.hypot(m[0], m[1], m[2]);
    const sy = Math.hypot(m[4], m[5], m[6]);
    const sz = Math.hypot(m[8], m[9], m[10]);
    const det = m[0] * (m[5] * m[10] - m[6] * m[9]) - m[4] * (m[1] * m[10] - m[2] * m[9]) + m[8] * (m[1] * m[6] - m[2] * m[5]);
    if (det < 0) sx = -sx;
    const r = [m[0] / sx, m[1] / sx, m[2] / sx, 0, m[4] / sy, m[5] / sy, m[6] / sy, 0, m[8] / sz, m[9] / sz, m[10] / sz, 0];
    return { position, quaternion: matrixToQuaternion(r), scale: [sx, sy, sz] };
}

function buildParentMap(json) {
    const parent = {};
    json.nodes.forEach((node, i) => (node.children || []).forEach((c) => (parent[c] = i)));
    return parent;
}

function reparentNode(child, newParent) {
    const old = child.parent;
    if (old && Array.isArray(old.children)) {
        const i = old.children.indexOf(child);
        if (i >= 0) old.children.splice(i, 1);
    }
    child.parent = newParent;
    newParent.children.push(child);
}

function buildNodeToTransformNode(json, root) {
    const map = new Map();
    const walk = (nodeIndex, tn) => {
        map.set(nodeIndex, tn);
        const childIndices = json.nodes[nodeIndex].children || [];
        for (let i = 0; i < childIndices.length; i++) walk(childIndices[i], tn.children[i]);
    };
    const sceneRoots = json.scenes?.[json.scene ?? 0]?.nodes ?? [];
    for (let i = 0; i < sceneRoots.length; i++) walk(sceneRoots[i], root.children[i]);
    return map;
}

function primitiveShapeOptions(shapeDef, absScale) {
    const maxXZ = Math.max(absScale[0], absScale[2]);
    const maxAll = Math.max(absScale[0], absScale[1], absScale[2]);
    if (shapeDef.type === 'box') {
        const s = shapeDef.box?.size || [1, 1, 1];
        return { type: PhysicsShapeType.BOX, parameters: { center: { x: 0, y: 0, z: 0 }, extents: { x: s[0] * absScale[0], y: s[1] * absScale[1], z: s[2] * absScale[2] } } };
    }
    if (shapeDef.type === 'sphere') {
        return { type: PhysicsShapeType.SPHERE, parameters: { center: { x: 0, y: 0, z: 0 }, radius: (shapeDef.sphere?.radius ?? 0.5) * maxAll } };
    }
    if (shapeDef.type === 'capsule') {
        const c = shapeDef.capsule || {};
        const radius = ((c.radiusTop ?? 0.5) + (c.radiusBottom ?? 0.5)) * 0.5 * maxXZ;
        const half = (c.height ?? 1) * 0.5 * absScale[1];
        return { type: PhysicsShapeType.CAPSULE, parameters: { pointA: { x: 0, y: -half, z: 0 }, pointB: { x: 0, y: half, z: 0 }, radius } };
    }
    if (shapeDef.type === 'cylinder') {
        const c = shapeDef.cylinder || {};
        const radius = Math.max(c.radiusTop ?? 0.5, c.radiusBottom ?? 0.5) * maxXZ;
        const half = (c.height ?? 1) * 0.5 * absScale[1];
        return { type: PhysicsShapeType.CYLINDER, parameters: { pointA: { x: 0, y: -half, z: 0 }, pointB: { x: 0, y: half, z: 0 }, radius } };
    }
    return null;
}

async function main() {
    const canvas = document.getElementById('c');
    const engine = await createEngine(canvas);
    const scene = createSceneContext(engine);
    scene.fixedDeltaMs = 1000 / PHYSICS_FPS;

    const camera = createArcRotateCamera(-Math.PI / 2, Math.PI / 2.3, 16, { x: 0, y: 2.4, z: 2.2 });
    scene.camera = camera;
    attachControl(camera, canvas, scene);

    const light = createHemisphericLight([0, 1, 0]);
    light.intensity = 0.95;
    addToScene(scene, light);
    const fillLight = createHemisphericLight([0, -1, 0]);
    fillLight.intensity = 0.25;
    addToScene(scene, fillLight);

    const fpsEl = document.getElementById('fps');
    let lastTime = performance.now();
    let lastFrameTime = 0;
    let frameCount = 0;
    onBeforeRender(scene, () => {
        frameCount++;
        const now = performance.now();
        if (now - lastTime >= 1000) {
            fpsEl.textContent = 'FPS: ' + Math.round((frameCount * 1000) / (now - lastTime));
            frameCount = 0;
            lastTime = now;
        }
        // Framerate-independent spin to match the Babylon.js sample's getAnimationRatio().
        const animationRatio = lastFrameTime ? (now - lastFrameTime) / (1000 / 60) : 1;
        lastFrameTime = now;
        camera.alpha += 0.0012 * animationRatio;
    });

    const hknp = await HavokPhysics();
    const world = createHavokWorld(scene, hknp, { x: 0, y: -9.8, z: 0 });
    const viewer = createPhysicsViewer(scene, world, { color: [1, 1, 1, 1] });
    const combine = hknp.MaterialCombine;
    const bodies = [];

    const json = await fetchGltfJson(MODEL_URL);
    const shapeDefs = json.extensions?.KHR_implicit_shapes?.shapes || [];
    const materialDefs = json.extensions?.KHR_physics_rigid_bodies?.physicsMaterials || [];
    const parentMap = buildParentMap(json);

    const loaded = await loadGltf(engine, MODEL_URL);
    const root = loaded.entities[0];
    addToScene(scene, root);
    const nodeToTN = buildNodeToTransformNode(json, root);

    const setMaterial = (shape, matIndex) => {
        const matDef = matIndex !== undefined ? materialDefs[matIndex] : null;
        const friction = matDef?.dynamicFriction ?? 0.5;
        const restitution = matDef?.restitution ?? 0;
        hknp.HP_Shape_SetMaterial(shape._hkShape, [friction, friction, restitution, combine.MAXIMUM, combine.MAXIMUM]);
    };

    // A compound body has motion but no collider of its own. Collect its descendant collider nodes
    // (added to the container) and mark every descendant carrying physics as consumed so the main
    // loop skips them — descendant triggers (the headlights) just ride along visually.
    const consumed = new Set();
    const compounds = [];
    const collectCompoundChildren = (nodeIndex, out) => {
        for (const childIndex of (json.nodes[nodeIndex].children || [])) {
            const cp = json.nodes[childIndex].extensions?.KHR_physics_rigid_bodies;
            if (cp?.collider?.geometry) { out.push(childIndex); consumed.add(childIndex); }
            else if (cp?.trigger) consumed.add(childIndex);
            collectCompoundChildren(childIndex, out);
        }
    };
    for (let i = 0; i < json.nodes.length; i++) {
        const physics = json.nodes[i].extensions?.KHR_physics_rigid_bodies;
        if (physics?.motion && !physics.collider && !physics.trigger && (json.nodes[i].children || []).length) {
            const childColliders = [];
            collectCompoundChildren(i, childColliders);
            if (childColliders.length) compounds.push({ index: i, childColliders });
        }
    }
    const compoundByIndex = new Map(compounds.map((c) => [c.index, c]));

    const placeAnchor = (nodeIndex) => {
        const lh = decomposeMatrix(applyLeftHandedFlip(nodeWorldMatrix(json, parentMap, nodeIndex)));
        const anchor = createTransformNode('body_' + nodeIndex);
        anchor.position.set(lh.position[0], lh.position[1], lh.position[2]);
        anchor.rotationQuaternion.set(lh.quaternion[0], lh.quaternion[1], lh.quaternion[2], lh.quaternion[3]);
        addToScene(scene, anchor);
        const subtree = nodeToTN.get(nodeIndex);
        if (subtree) {
            subtree.position.set(0, 0, 0);
            if (subtree.rotationQuaternion) subtree.rotationQuaternion.set(0, 0, 0, 1);
            subtree.scaling.set(lh.scale[0], lh.scale[1], lh.scale[2]);
            reparentNode(subtree, anchor);
        }
        return { anchor, lh };
    };

    const buildShapeFor = (nodeIndex, geometry, anchorForMesh, absScale) => {
        if (geometry.shape !== undefined) {
            return createPhysicsShape(world, primitiveShapeOptions(shapeDefs[geometry.shape], absScale));
        }
        const type = geometry.convexHull ? PhysicsShapeType.CONVEX_HULL : PhysicsShapeType.MESH;
        return createPhysicsShape(world, { type, mesh: anchorForMesh, includeChildMeshes: true });
    };

    for (let nodeIndex = 0; nodeIndex < json.nodes.length; nodeIndex++) {
        if (consumed.has(nodeIndex)) continue;
        const physics = json.nodes[nodeIndex].extensions?.KHR_physics_rigid_bodies;
        if (!physics) continue;
        const motion = physics.motion || null;

        // Compound "car": a container of its descendant collider shapes.
        const compound = compoundByIndex.get(nodeIndex);
        if (compound) {
            const { anchor } = placeAnchor(nodeIndex);
            const container = createPhysicsShape(world, { type: PhysicsShapeType.CONTAINER });
            for (const childIndex of compound.childColliders) {
                const childGeom = json.nodes[childIndex].extensions.KHR_physics_rigid_bodies.collider.geometry;
                // Primitive child: base size; the parent-relative transform carries the world scale.
                const childShape = buildShapeFor(childIndex, childGeom, nodeToTN.get(childIndex), [1, 1, 1]);
                setMaterial(childShape, json.nodes[childIndex].extensions.KHR_physics_rigid_bodies.collider.physicsMaterial);
                addPhysicsShapeChildFromParent(world, container, anchor, childShape, nodeToTN.get(childIndex));
            }
            const body = createPhysicsBody(world, anchor, PhysicsMotionType.DYNAMIC);
            setPhysicsBodyShape(world, body, container);
            setPhysicsBodyMassProperties(world, body, { mass: motion.mass ?? 1 });
            showPhysicsBody(viewer, body);
            bodies.push(body);
            continue;
        }

        const geometry = physics.collider?.geometry;
        if (!geometry) continue; // standalone triggers (none here) are skipped

        const { anchor, lh } = placeAnchor(nodeIndex);
        const absScale = lh.scale.map(Math.abs);
        const shape = buildShapeFor(nodeIndex, geometry, anchor, absScale);
        setMaterial(shape, physics.collider.physicsMaterial);
        const body = createPhysicsBody(world, anchor, motion ? PhysicsMotionType.DYNAMIC : PhysicsMotionType.STATIC);
        setPhysicsBodyShape(world, body, shape);
        if (motion) setPhysicsBodyMassProperties(world, body, { mass: motion.mass ?? 1 });
        showPhysicsBody(viewer, body);
        bodies.push(body);
    }

    let showWireframe = true;
    window.addEventListener('keydown', (e) => {
        if (e.repeat) return;
        if (e.code === 'KeyW' || e.key === 'w' || e.key === 'W') {
            showWireframe = !showWireframe;
            for (const body of bodies) {
                if (showWireframe) showPhysicsBody(viewer, body);
                else hidePhysicsBody(viewer, body);
            }
            const hint = document.getElementById('hint');
            if (hint) hint.textContent = 'W: wireframe ' + (showWireframe ? 'ON' : 'OFF');
        }
    });

    await registerScene(scene);
    await startEngine(engine);
}

main().catch((err) => {
    console.error('Babylon.js Lite error:', err);
    document.body.style.color = '#f88';
    document.body.style.padding = '1rem';
    document.body.style.fontFamily = 'monospace';
    document.body.innerHTML = '<b>Error:</b> ' + err.message +
        '<br><br>This example requires a WebGPU-capable browser (Chrome 113+, Edge 113+).';
});
