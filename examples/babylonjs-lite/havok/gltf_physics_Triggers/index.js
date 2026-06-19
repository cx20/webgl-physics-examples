import {
    addToScene, attachControl, createArcRotateCamera, createBox, createEngine, createHavokWorld,
    createHemisphericLight, createPhysicsBody, createPhysicsShape, createPhysicsViewer,
    createSceneContext, createStandardMaterial, createTransformNode, hidePhysicsBody, loadGltf,
    onBeforeRender, PhysicsMotionType, PhysicsShapeType, registerScene, setMeshVisible,
    setPhysicsBodyShape, setPhysicsShapeIsTrigger, showPhysicsBody, startEngine,
} from '@babylonjs/lite';
import HavokPhysics from '@babylonjs/havok';

// Khronos glTF Physics sample (KHR_physics_rigid_bodies + KHR_implicit_shapes).
// Same asset the three.js / Rhodonite / PlayCanvas examples load.
const MODEL_URL = 'https://raw.githubusercontent.com/eoineoineoin/glTF_Physics/master/samples/Triggers/Triggers.glb';
const PHYSICS_FPS = 60;

const TRIGGER_BASE = [0.85, 0.2, 0.2];
const TRIGGER_ACTIVE = [0.2, 0.9, 0.35];
const TRIGGER_BASE_ALPHA = 0.35;
const TRIGGER_ACTIVE_ALPHA = 0.6;

// Babylon.js Lite has no built-in glTF-physics loader, so we parse the glb's physics extensions
// ourselves and drive each body with the Lite Havok wrapper. Each body is reconstructed at the
// Babylon left-handed world pose decompose(F * node-world), F = diag(-1, 1, 1), so the scene matches
// the Babylon.js (full) example. A dynamic cube falls THROUGH static trigger volumes (flagged with
// setPhysicsShapeIsTrigger) onto a solid floor. Lite's trigger events only report ENTERED/EXITED
// (not which volume), so overlaps are detected manually to highlight each trigger.

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

// Collect renderable meshes under a node, and estimate a world-space bounding radius from the first.
function collectMeshes(node, out) {
    if (node._gpu) out.push(node);
    for (const c of node.children || []) collectMeshes(c, out);
}

// loadGltf bakes the node's world transform into boundMin/boundMax, so they are already world-space
// extents - do NOT multiply by the node scale again.
function approxRadius(mesh) {
    if (!mesh || !mesh.boundMin || !mesh.boundMax) return 0.5;
    const dx = mesh.boundMax[0] - mesh.boundMin[0];
    const dy = mesh.boundMax[1] - mesh.boundMin[1];
    const dz = mesh.boundMax[2] - mesh.boundMin[2];
    return 0.5 * Math.max(dx, dy, dz);
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

    const camera = createArcRotateCamera(-Math.PI / 2, Math.PI / 2.4, 6, { x: 0, y: 0.8, z: 0 });
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
    let frameCount = 0;

    const hknp = await HavokPhysics();
    const world = createHavokWorld(scene, hknp, { x: 0, y: -9.8, z: 0 });
    const viewer = createPhysicsViewer(scene, world, { color: [1, 1, 1, 1] });
    const combine = hknp.MaterialCombine;
    const bodies = [];
    const triggers = []; // { anchor, materials, radius }
    const dynamicEntries = []; // { anchor, radius } — bodies that can enter triggers

    const json = await fetchGltfJson(MODEL_URL);
    const shapeDefs = json.extensions?.KHR_implicit_shapes?.shapes || [];
    const materialDefs = json.extensions?.KHR_physics_rigid_bodies?.physicsMaterials || [];
    const parentMap = buildParentMap(json);

    const loaded = await loadGltf(engine, MODEL_URL);
    const root = loaded.entities[0];
    addToScene(scene, root);
    const nodeToTN = buildNodeToTransformNode(json, root);

    // Process every node carrying physics (colliders AND triggers may be nested under group nodes).
    for (let nodeIndex = 0; nodeIndex < json.nodes.length; nodeIndex++) {
        const physics = json.nodes[nodeIndex].extensions?.KHR_physics_rigid_bodies;
        if (!physics) continue;
        const geometry = physics.collider?.geometry || physics.trigger?.geometry;
        if (!geometry) continue;
        const isTrigger = !!physics.trigger;
        const motion = physics.motion || null;

        const lhTransform = decomposeMatrix(applyLeftHandedFlip(nodeWorldMatrix(json, parentMap, nodeIndex)));
        const absScale = lhTransform.scale.map(Math.abs);
        const maxScale = Math.max(absScale[0], absScale[1], absScale[2]);

        const anchor = createTransformNode('body_' + nodeIndex);
        anchor.position.set(lhTransform.position[0], lhTransform.position[1], lhTransform.position[2]);
        anchor.rotationQuaternion.set(lhTransform.quaternion[0], lhTransform.quaternion[1], lhTransform.quaternion[2], lhTransform.quaternion[3]);
        addToScene(scene, anchor);
        const subtree = nodeToTN.get(nodeIndex);

        if (isTrigger) {
            // A trigger volume: the cube passes through it. Reusing the loaded glTF (PBR) mesh as the
            // visual and recolouring it breaks the PBR pipeline, so we hide the loaded mesh and show a
            // separate semi-transparent box (a primitive with a standard material we can highlight)
            // sized to the trigger's bounds, and use a matching box trigger shape.
            const triggerMeshes = [];
            if (subtree) collectMeshes(subtree, triggerMeshes);
            for (const mesh of triggerMeshes) setMeshVisible(mesh, false);

            // boundMin/boundMax are already in glTF world space (node transform baked in). Build the
            // trigger box from that AABB directly, applying F (negate X) to the centre for Lite's LH.
            const bm = triggerMeshes[0];
            const bmin = bm?.boundMin || [-0.3, -0.3, -0.3];
            const bmax = bm?.boundMax || [0.3, 0.3, 0.3];
            const center = [-(bmin[0] + bmax[0]) / 2, (bmin[1] + bmax[1]) / 2, (bmin[2] + bmax[2]) / 2];
            const extents = { x: bmax[0] - bmin[0], y: bmax[1] - bmin[1], z: bmax[2] - bmin[2] };

            anchor.position.set(center[0], center[1], center[2]);
            anchor.rotationQuaternion.set(0, 0, 0, 1);
            const shape = createPhysicsShape(world, { type: PhysicsShapeType.BOX, parameters: { center: { x: 0, y: 0, z: 0 }, extents } });
            setPhysicsShapeIsTrigger(world, shape, true);
            const body = createPhysicsBody(world, anchor, PhysicsMotionType.STATIC);
            setPhysicsBodyShape(world, body, shape);

            const box = createBox(engine, 1);
            box.scaling.set(extents.x, extents.y, extents.z);
            box.position.set(center[0], center[1], center[2]);
            const material = createStandardMaterial();
            material.diffuseColor = TRIGGER_BASE.slice();
            material.specularColor = [0, 0, 0];
            material.alpha = TRIGGER_BASE_ALPHA;
            box.material = material;
            addToScene(scene, box);

            triggers.push({ pos: center, material, radius: 0.5 * Math.max(extents.x, extents.y, extents.z) });
            continue;
        }

        // Solid collider: reparent the loaded subtree (keeping its textured material) under the anchor.
        const meshes = [];
        if (subtree) {
            subtree.position.set(0, 0, 0);
            if (subtree.rotationQuaternion) subtree.rotationQuaternion.set(0, 0, 0, 1);
            subtree.scaling.set(lhTransform.scale[0], lhTransform.scale[1], lhTransform.scale[2]);
            reparentNode(subtree, anchor);
            collectMeshes(subtree, meshes);
        }

        let shape;
        if (geometry.shape !== undefined) {
            const opts = primitiveShapeOptions(shapeDefs[geometry.shape], absScale);
            if (!opts) continue;
            shape = createPhysicsShape(world, opts);
        } else {
            const type = geometry.convexHull ? PhysicsShapeType.CONVEX_HULL : PhysicsShapeType.MESH;
            shape = createPhysicsShape(world, { type, mesh: anchor, includeChildMeshes: true });
        }

        const body = createPhysicsBody(world, anchor, motion ? PhysicsMotionType.DYNAMIC : PhysicsMotionType.STATIC);
        setPhysicsBodyShape(world, body, shape);
        const matDef = physics.collider.physicsMaterial !== undefined ? materialDefs[physics.collider.physicsMaterial] : null;
        const friction = matDef?.dynamicFriction ?? 0.5;
        const restitution = matDef?.restitution ?? 0;
        hknp.HP_Shape_SetMaterial(shape._hkShape, [friction, friction, restitution, combine.MAXIMUM, combine.MAXIMUM]);
        showPhysicsBody(viewer, body);
        bodies.push(body);
        if (motion) dynamicEntries.push({ anchor, radius: approxRadius(meshes[0]) });
    }

    // Manual overlap highlight: Lite's trigger events do not say which volume was entered, so test the
    // dynamic bodies against each trigger volume by distance each frame.
    onBeforeRender(scene, () => {
        frameCount++;
        const now = performance.now();
        if (now - lastTime >= 1000) {
            fpsEl.textContent = 'FPS: ' + Math.round((frameCount * 1000) / (now - lastTime));
            frameCount = 0;
            lastTime = now;
        }
        camera.alpha += 0.0012;

        for (const trigger of triggers) {
            let active = false;
            for (const dyn of dynamicEntries) {
                const dx = dyn.anchor.position.x - trigger.pos[0];
                const dy = dyn.anchor.position.y - trigger.pos[1];
                const dz = dyn.anchor.position.z - trigger.pos[2];
                if (Math.hypot(dx, dy, dz) < dyn.radius + trigger.radius) { active = true; break; }
            }
            trigger.material.diffuseColor = active ? TRIGGER_ACTIVE.slice() : TRIGGER_BASE.slice();
            trigger.material.alpha = active ? TRIGGER_ACTIVE_ALPHA : TRIGGER_BASE_ALPHA;
        }
    });

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
