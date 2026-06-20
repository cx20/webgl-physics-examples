import {
    addToScene, attachControl, createArcRotateCamera, createBox, createEngine,
    createHavokWorld, createHemisphericLight, createPhysicsAggregate, createPhysicsViewer,
    createSceneContext, createSphere, createStandardMaterial, hidePhysicsBody, loadGltf,
    onBeforeRender, PhysicsShapeType, registerScene, setMeshVisible, showPhysicsBody, startEngine,
} from '@babylonjs/lite';
import HavokPhysics from '@babylonjs/havok';

// Khronos glTF Physics sample (KHR_physics_rigid_bodies + KHR_implicit_shapes).
// Same asset the three.js / Rhodonite / PlayCanvas examples load.
const MODEL_URL = 'https://raw.githubusercontent.com/eoineoineoin/glTF_Physics/master/samples/Materials_Restitution/Materials_Restitution.glb';
const PHYSICS_FPS = 60;

// Babylon.js Lite has no built-in glTF-physics loader, so we parse the glb's physics extensions
// ourselves and drive each rigid body with the Lite Havok wrapper. The wrapper writes a body's
// WORLD pose into its bound node's LOCAL transform, so each body binds to an invisible TOP-LEVEL
// anchor placed at the node's Babylon left-handed world pose. The asset's own loaded subtree (its
// mesh plus any decorative child meshes) is reparented under that anchor so it follows physics; the
// decomposed scale carries the -X that reproduces the RH->LH winding flip loadGltf applies through
// its `__root__`. Only the collider geometry comes from the KHR_implicit_shapes definition. A
// basketball (high restitution) bounces while a bowling ball (low restitution) barely does.

async function fetchGltfJson(url) {
    const buffer = await fetch(url).then((r) => r.arrayBuffer());
    const view = new DataView(buffer);
    if (view.getUint32(0, true) !== 0x46546c67) throw new Error('Not a binary glTF (glb): ' + url);
    let offset = 12;
    while (offset < view.byteLength) {
        const chunkLength = view.getUint32(offset, true);
        const chunkType = view.getUint32(offset + 4, true);
        const dataStart = offset + 8;
        if (chunkType === 0x4e4f534a) {
            return JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, dataStart, chunkLength)));
        }
        offset = dataStart + chunkLength;
    }
    throw new Error('glb has no JSON chunk: ' + url);
}

// Rebuild the glTF-node-index -> loaded TransformNode map (loadGltf builds it internally but does
// not expose it). buildNodeHierarchy adds child-node TransformNodes before mesh children, in glTF
// child order, so we can pair them by walking the scene roots in lock-step with root.children.
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

// --- glTF node transform -> Babylon left-handed world transform -----------------------------------
// glTF is right-handed; Babylon (and Lite via loadGltf's `__root__`) renders it left-handed by
// pre-multiplying every node's world matrix with F = diag(-1, 1, 1). We reproduce that here so each
// reconstructed body sits at the SAME world pose as the Babylon.js (full) example (no left/right
// mirror). Matrices are column-major.

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
    for (let p = parentMap[index]; p !== undefined; p = parentMap[p]) {
        m = mat4Multiply(nodeLocalMatrix(json.nodes[p]), m);
    }
    return m;
}

// Apply F = diag(-1, 1, 1): negate row 0 of a column-major matrix.
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

// Decompose a column-major matrix into { position, quaternion, scale }, pushing a negative
// determinant onto the X scale (matching Babylon's `__root__`, which carries scale.x = -1).
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

function makeFallbackMaterial(color) {
    const mat = createStandardMaterial();
    mat.diffuseColor = color;
    mat.specularColor = [0.08, 0.08, 0.08];
    return mat;
}

async function main() {
    const canvas = document.getElementById('c');
    const engine = await createEngine(canvas);
    const scene = createSceneContext(engine);
    scene.fixedDeltaMs = 1000 / PHYSICS_FPS;

    // View the front of the scene (azimuth rotated 180 deg, matching the Materials Friction view).
    const camera = createArcRotateCamera(Math.PI / 2, 1.15, 4.5, { x: 0, y: 0.6, z: 0 });
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
        camera.alpha += 0.0015 * animationRatio;
    });

    const hknp = await HavokPhysics();
    const world = createHavokWorld(scene, hknp, { x: 0, y: -9.8, z: 0 });
    const viewer = createPhysicsViewer(scene, world, { color: [1, 1, 1, 1] });
    const bodies = [];

    const json = await fetchGltfJson(MODEL_URL);
    const shapeDefs = json.extensions?.KHR_implicit_shapes?.shapes || [];
    const materialDefs = json.extensions?.KHR_physics_rigid_bodies?.physicsMaterials || [];
    const parentMap = buildParentMap(json);

    // Load the asset's textured meshes, then add the node tree to the scene so its transform links
    // are established (glTF lights are separate container entities and are intentionally left out;
    // the example uses its own hemispheric lights). Physics subtrees are reparented out of `__root__`
    // below so dynamic bodies follow physics instead of staying at their rest pose.
    const loaded = await loadGltf(engine, MODEL_URL);
    const root = loaded.entities[0];
    addToScene(scene, root);
    const nodeToTN = buildNodeToTransformNode(json, root);

    const sceneRoots = json.scenes?.[json.scene ?? 0]?.nodes ?? [];
    for (const nodeIndex of sceneRoots) {
        const node = json.nodes[nodeIndex];
        const physics = node.extensions?.KHR_physics_rigid_bodies;
        const geometry = physics?.collider?.geometry;
        if (geometry?.shape === undefined) continue; // only implicit-shape rigid bodies in this sample

        const shapeDef = shapeDefs[geometry.shape];
        const mass = physics.motion?.mass ?? 0;

        // Babylon left-handed world pose for this node (F * world). The body is placed at this
        // pose; the visual subtree gets the decomposed scale (which carries the -X winding flip).
        const lhTransform = decomposeMatrix(applyLeftHandedFlip(nodeWorldMatrix(json, parentMap, nodeIndex)));
        const absScale = lhTransform.scale.map(Math.abs);
        const maxScale = Math.max(absScale[0], absScale[1], absScale[2]);

        const matDef = physics.collider.physicsMaterial !== undefined
            ? materialDefs[physics.collider.physicsMaterial]
            : null;
        const friction = matDef?.dynamicFriction ?? 0.5;
        const restitution = matDef?.restitution ?? 0;

        let type;
        const aggregateOptions = { mass, friction, restitution };
        if (shapeDef.type === 'box') {
            const size = shapeDef.box?.size || [1, 1, 1];
            type = PhysicsShapeType.BOX;
            aggregateOptions.extents = { x: size[0] * absScale[0], y: size[1] * absScale[1], z: size[2] * absScale[2] };
        } else if (shapeDef.type === 'sphere') {
            type = PhysicsShapeType.SPHERE;
            aggregateOptions.radius = (shapeDef.sphere?.radius ?? 0.5) * maxScale;
        } else {
            continue;
        }

        // Invisible top-level anchor carrying the body at the node's left-handed world pose.
        const anchor = type === PhysicsShapeType.BOX
            ? createBox(engine, 1)
            : createSphere(engine, { diameter: aggregateOptions.radius * 2, segments: 32 });
        anchor.position.set(lhTransform.position[0], lhTransform.position[1], lhTransform.position[2]);
        if (anchor.rotationQuaternion) {
            anchor.rotationQuaternion.set(lhTransform.quaternion[0], lhTransform.quaternion[1], lhTransform.quaternion[2], lhTransform.quaternion[3]);
        }
        addToScene(scene, anchor);

        // Reparent the node's loaded subtree (its mesh + decorative children) under the anchor. The
        // anchor already carries the node's world translation/rotation, so the subtree root keeps
        // only the decomposed scale (whose negative X reproduces the RH->LH winding flip).
        const subtree = nodeToTN.get(nodeIndex);
        if (subtree) {
            subtree.position.set(0, 0, 0);
            if (subtree.rotationQuaternion) subtree.rotationQuaternion.set(0, 0, 0, 1);
            subtree.scaling.set(lhTransform.scale[0], lhTransform.scale[1], lhTransform.scale[2]);
            subtree.parent = anchor;
            setMeshVisible(anchor, false);
        } else {
            if (type === PhysicsShapeType.BOX) {
                const e = aggregateOptions.extents;
                anchor.scaling.set(e.x, e.y, e.z);
            }
            anchor.material = makeFallbackMaterial([0.7, 0.7, 0.72]);
        }

        const aggregate = createPhysicsAggregate(world, anchor, type, aggregateOptions);
        // Match the glTF Physics samples (and the three.js / Rhodonite ports), which combine both
        // friction and restitution with MAXIMUM. The Lite wrapper defaults friction to MINIMUM,
        // which would let a zero-restitution/zero-friction floor cancel a body's own material, so
        // override the shape material here.
        const combine = hknp.MaterialCombine;
        hknp.HP_Shape_SetMaterial(aggregate.shape._hkShape, [friction, friction, restitution, combine.MAXIMUM, combine.MAXIMUM]);
        showPhysicsBody(viewer, aggregate.body);
        bodies.push(aggregate.body);
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
