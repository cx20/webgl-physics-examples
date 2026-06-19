import {
    addToScene, attachControl, createArcRotateCamera, createBox,
    createEngine, createHavokWorld, createHemisphericLight, createPhysicsAggregate,
    createPhysicsViewer, createSceneContext, createSphere, createStandardMaterial,
    hidePhysicsBody, loadGltf, onBeforeRender, PhysicsShapeType, registerScene,
    setMeshVisible, showPhysicsBody, startEngine,
} from '@babylonjs/lite';
import HavokPhysics from '@babylonjs/havok';

// Khronos glTF Physics sample (KHR_physics_rigid_bodies + KHR_implicit_shapes).
// Same asset the three.js / Rhodonite / PlayCanvas examples load.
const MODEL_URL = 'https://raw.githubusercontent.com/eoineoineoin/glTF_Physics/master/samples/Materials_Restitution/Materials_Restitution.glb';
const PHYSICS_FPS = 60;

// Babylon.js Lite has no built-in glTF-physics loader, so we parse the glb's physics extensions
// ourselves and drive each rigid body with the Havok wrapper. The wrapper writes a body's WORLD
// pose back into its bound node's LOCAL transform, so the body must sit on a TOP-LEVEL node with
// unit scale. We therefore mirror the official Babylon.js Lite "gltf" example: an invisible
// top-level anchor (scale 1) carries the body, and the asset's own textured mesh is parented under
// it for the visual (the -X scale on the visual reproduces loadGltf's RH->LH winding flip). Only
// the collider geometry comes from the KHR_implicit_shapes definition.

// Parse a binary glb, returning its JSON chunk (the physics extensions + node tree).
async function fetchGltfJson(url) {
    const buffer = await fetch(url).then((r) => r.arrayBuffer());
    const view = new DataView(buffer);
    if (view.getUint32(0, true) !== 0x46546c67) {
        throw new Error('Not a binary glTF (glb): ' + url);
    }
    let offset = 12;
    while (offset < view.byteLength) {
        const chunkLength = view.getUint32(offset, true);
        const chunkType = view.getUint32(offset + 4, true);
        const dataStart = offset + 8;
        if (chunkType === 0x4e4f534a) { // "JSON"
            const bytes = new Uint8Array(buffer, dataStart, chunkLength);
            return JSON.parse(new TextDecoder().decode(bytes));
        }
        offset = dataStart + chunkLength;
    }
    throw new Error('glb has no JSON chunk: ' + url);
}

// Collect every renderable mesh (carrying GPU geometry) under a loaded entity tree.
function collectMeshes(node, out) {
    if (node._gpu) out.push(node);
    if (node.children) for (const child of node.children) collectMeshes(child, out);
}

// Map a glTF node index to its loaded Lite mesh. loadGltf names tight meshes `gltf_mesh_<i>` where
// <i> is the extraction index (node order, primitive order), so we replay that order to recover the
// node each mesh came from.
function buildNodeToMesh(json, meshes) {
    const meshDataNode = [];
    for (let ni = 0; ni < json.nodes.length; ni++) {
        const node = json.nodes[ni];
        if (node.mesh === undefined) continue;
        for (let p = 0; p < json.meshes[node.mesh].primitives.length; p++) meshDataNode.push(ni);
    }
    const map = new Map();
    for (const mesh of meshes) {
        const m = /gltf_mesh_(\d+)/.exec(mesh.name || '');
        if (!m) continue;
        const ni = meshDataNode[Number(m[1])];
        if (ni !== undefined && !map.has(ni)) map.set(ni, mesh);
    }
    return map;
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

    const camera = createArcRotateCamera(-Math.PI / 2, 1.15, 4.5, { x: 0, y: 0.6, z: 0 });
    scene.camera = camera;
    attachControl(camera, canvas, scene);

    const light = createHemisphericLight([0, 1, 0]);
    light.intensity = 0.95;
    addToScene(scene, light);
    const fillLight = createHemisphericLight([0, -1, 0]);
    fillLight.intensity = 0.25;
    addToScene(scene, fillLight);

    // FPS readout + gentle camera orbit (matching the other Babylon.js Lite examples).
    const fpsEl = document.getElementById('fps');
    let lastTime = performance.now();
    let frameCount = 0;
    onBeforeRender(scene, () => {
        frameCount++;
        const now = performance.now();
        if (now - lastTime >= 1000) {
            fpsEl.textContent = 'FPS: ' + Math.round((frameCount * 1000) / (now - lastTime));
            frameCount = 0;
            lastTime = now;
        }
        camera.alpha += 0.0015;
    });

    const hknp = await HavokPhysics();
    const world = createHavokWorld(scene, hknp, { x: 0, y: -9.8, z: 0 });
    const viewer = createPhysicsViewer(scene, world, { color: [1, 1, 1, 1] });
    const bodies = [];

    // Parse the glTF physics extensions, and load the asset's textured meshes for the visuals.
    const json = await fetchGltfJson(MODEL_URL);
    const shapeDefs = json.extensions?.KHR_implicit_shapes?.shapes || [];
    const materialDefs = json.extensions?.KHR_physics_rigid_bodies?.physicsMaterials || [];
    const sceneRoots = json.scenes?.[json.scene ?? 0]?.nodes ?? [];

    const loaded = await loadGltf(engine, MODEL_URL);
    const loadedMeshes = [];
    for (const entity of loaded.entities) collectMeshes(entity, loadedMeshes);
    const nodeToMesh = buildNodeToMesh(json, loadedMeshes);

    for (const nodeIndex of sceneRoots) {
        const node = json.nodes[nodeIndex];
        const physics = node.extensions?.KHR_physics_rigid_bodies;
        const geometry = physics?.collider?.geometry;
        if (geometry?.shape === undefined) continue; // skip lights / cameras / non-implicit bodies

        const shapeDef = shapeDefs[geometry.shape];
        // All rigid bodies in this sample are scene roots, so the node's local TRS is its world TRS.
        const t = node.translation || [0, 0, 0];
        const r = node.rotation || [0, 0, 0, 1];
        const s = node.scale || [1, 1, 1];
        const maxScale = Math.max(Math.abs(s[0]), Math.abs(s[1]), Math.abs(s[2]));

        // Mass comes from the motion property; a node with no motion is a static collider.
        const mass = physics.motion?.mass ?? 0;

        // Friction + restitution come from the referenced physics material. Havok combines the two
        // contacting materials with MAX restitution (matching this sample's restitutionCombine).
        const matDef = physics.collider.physicsMaterial !== undefined
            ? materialDefs[physics.collider.physicsMaterial]
            : null;
        const friction = matDef?.dynamicFriction ?? 0.5;
        const restitution = matDef?.restitution ?? 0;

        // Collider geometry from the implicit-shape def (scaled by the node's world scale).
        let type;
        const aggregateOptions = { mass, friction, restitution };
        if (shapeDef.type === 'box') {
            const size = shapeDef.box?.size || [1, 1, 1];
            type = PhysicsShapeType.BOX;
            aggregateOptions.extents = { x: size[0] * s[0], y: size[1] * s[1], z: size[2] * s[2] };
        } else if (shapeDef.type === 'sphere') {
            type = PhysicsShapeType.SPHERE;
            aggregateOptions.radius = (shapeDef.sphere?.radius ?? 0.5) * maxScale;
        } else {
            continue; // this sample only uses box + sphere
        }

        // Invisible top-level anchor (unit scale) — the body binds to this so the wrapper's
        // body->node sync stays correct. Its geometry matches the collider shape but is hidden.
        const anchor = type === PhysicsShapeType.BOX
            ? createBox(engine, 1)
            : createSphere(engine, { diameter: aggregateOptions.radius * 2, segments: 32 });
        anchor.position.set(t[0], t[1], t[2]);
        if (anchor.rotationQuaternion) anchor.rotationQuaternion.set(r[0], r[1], r[2], r[3]);
        addToScene(scene, anchor);

        // Visual: the asset's own textured mesh parented under the anchor (so it follows physics).
        // The -X scale reproduces the RH->LH winding flip loadGltf normally applies via its
        // `__root__`. If the textured mesh can't be matched, show the anchor with a fallback colour.
        const source = nodeToMesh.get(nodeIndex);
        if (source) {
            setMeshVisible(anchor, false);
            source.scaling.set(-s[0], s[1], s[2]);
            source.position.set(0, 0, 0);
            if (source.rotationQuaternion) source.rotationQuaternion.set(0, 0, 0, 1);
            addToScene(scene, source);
            source.parent = anchor;
        } else {
            if (type === PhysicsShapeType.BOX) {
                const e = aggregateOptions.extents;
                anchor.scaling.set(e.x, e.y, e.z);
            }
            anchor.material = makeFallbackMaterial([0.7, 0.7, 0.72]);
        }

        const body = createPhysicsAggregate(world, anchor, type, aggregateOptions).body;
        showPhysicsBody(viewer, body);
        bodies.push(body);
    }

    // W toggles the collider wireframe overlay (repo convention: starts ON).
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
