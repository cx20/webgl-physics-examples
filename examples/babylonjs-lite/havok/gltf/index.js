import {
    addToScene, attachControl, createArcRotateCamera, createBox, createEngine,
    createHavokWorld, createHemisphericLight, createPhysicsAggregate,
    createPhysicsViewer, createSceneContext, createStandardMaterial,
    hidePhysicsBody, loadGltf, onBeforeRender, PhysicsShapeType,
    registerScene, setMeshVisible, showPhysicsBody, startEngine,
    setPhysicsBodyLinearVelocity,
} from '@babylonjs/lite';
import HavokPhysics from '@babylonjs/havok';

const DUCK_URL = 'https://rawcdn.githack.com/cx20/gltf-test/1f6515ce/sampleModels/Duck/glTF/Duck.gltf';
const PHYSICS_FPS = 30;

// Collect every renderable mesh under a node (loaded glTF meshes carry _gpu).
function collectMeshes(node, out) {
    if (node._gpu) out.push(node);
    if (node.children) for (const c of node.children) collectMeshes(c, out);
}

// World-space AABB of the given meshes, computed from their CPU vertex positions transformed by
// each mesh's world matrix (glTF meshes expose _cpuPositions but not boundMin/boundMax).
function worldAabb(meshes) {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    const acc = (wx, wy, wz) => {
        if (wx < min[0]) min[0] = wx; if (wx > max[0]) max[0] = wx;
        if (wy < min[1]) min[1] = wy; if (wy > max[1]) max[1] = wy;
        if (wz < min[2]) min[2] = wz; if (wz > max[2]) max[2] = wz;
    };
    for (const mesh of meshes) {
        const m = mesh.worldMatrix;
        const p = mesh._cpuPositions;
        if (p) {
            for (let i = 0; i < p.length; i += 3) {
                const x = p[i], y = p[i + 1], z = p[i + 2];
                acc(
                    m[0] * x + m[4] * y + m[8] * z + m[12],
                    m[1] * x + m[5] * y + m[9] * z + m[13],
                    m[2] * x + m[6] * y + m[10] * z + m[14],
                );
            }
        } else if (mesh.boundMin && mesh.boundMax) {
            const bmin = mesh.boundMin, bmax = mesh.boundMax;
            for (let ci = 0; ci < 8; ci++) {
                const x = ci & 1 ? bmax[0] : bmin[0];
                const y = ci & 2 ? bmax[1] : bmin[1];
                const z = ci & 4 ? bmax[2] : bmin[2];
                acc(
                    m[0] * x + m[4] * y + m[8] * z + m[12],
                    m[1] * x + m[5] * y + m[9] * z + m[13],
                    m[2] * x + m[6] * y + m[10] * z + m[14],
                );
            }
        }
    }
    return { min, max };
}

async function main() {
    const canvas = document.getElementById('c');
    const engine = await createEngine(canvas);
    const scene = createSceneContext(engine);
    scene.fixedDeltaMs = 1000 / PHYSICS_FPS;

    const camera = createArcRotateCamera(-Math.PI / 2, Math.PI / 3, 10, { x: 0, y: 0, z: 0 });
    scene.camera = camera;
    attachControl(camera, canvas, scene);

    const light = createHemisphericLight([0, 1, 0]);
    light.intensity = 0.7;
    addToScene(scene, light);

    const fpsEl = document.getElementById('fps');
    let lastTime = performance.now();
    let frameCount = 0;
    onBeforeRender(scene, () => {
        frameCount++;
        const now = performance.now();
        if (now - lastTime >= 1000) {
            fpsEl.textContent = 'FPS: ' + Math.round(frameCount * 1000 / (now - lastTime));
            frameCount = 0;
            lastTime = now;
        }
        camera.alpha += Math.PI / 180.0;
    });

    const hknp = await HavokPhysics();
    const world = createHavokWorld(scene, hknp, { x: 0, y: -9.8, z: 0 });

    // Ground: a 20 x 0.5 x 20 slab whose top sits at y = 0.
    const groundMat = createStandardMaterial();
    groundMat.diffuseColor = [0.5, 0.5, 0.5];
    groundMat.specularColor = [0, 0, 0];
    const GW = 20, GH = 0.5, GD = 20;
    const ground = createBox(engine, 1);
    ground.scaling.set(GW, GH, GD);
    ground.position.set(0, -GH / 2, 0);
    ground.material = groundMat;
    addToScene(scene, ground);
    const groundAgg = createPhysicsAggregate(world, ground, PhysicsShapeType.BOX, {
        mass: 0, friction: 0.1, restitution: 0.2, extents: { x: GW, y: GH, z: GD },
    });

    // Load the duck and add it to the scene. loadGltf returns { entities: [root], ... }.
    const duck = await loadGltf(engine, DUCK_URL);
    addToScene(scene, duck);
    const duckRoot = duck.entities[0];

    // Wrap the duck in an invisible box collider sized to its world AABB, then reparent the
    // duck (preserving its world transform) so it follows the physics body.
    const duckMeshes = [];
    collectMeshes(duckRoot, duckMeshes);
    const { min, max } = worldAabb(duckMeshes);
    const size = { x: max[0] - min[0], y: max[1] - min[1], z: max[2] - min[2] };
    const center = { x: (min[0] + max[0]) / 2, y: (min[1] + max[1]) / 2, z: (min[2] + max[2]) / 2 };

    // The wrapper stays at unit scale (it is invisible, so its mesh size is irrelevant) and the
    // collider size is given via `extents`. Scaling the wrapper would distort the parented duck.
    const wrapper = createBox(engine, 1);
    wrapper.position.set(center.x, center.y, center.z);
    setMeshVisible(wrapper, false);
    addToScene(scene, wrapper);

    // Parent the duck to the wrapper manually instead of via setParent: setParent decomposes the
    // world matrix and loses the glTF root's -1 X scale (sqrt drops the sign), which mangles the
    // duck. Offsetting the root by -center keeps it centred on the wrapper while preserving scale.
    duckRoot.parent = wrapper;
    duckRoot.position.set(-center.x, -center.y, -center.z);

    // Drop the duck from a height (the duck follows because it is parented to the wrapper).
    wrapper.position.set(center.x, center.y + 10, center.z);

    const duckAgg = createPhysicsAggregate(world, wrapper, PhysicsShapeType.BOX, {
        mass: 1, friction: 0.0, restitution: 1.0, extents: { x: size.x, y: size.y, z: size.z },
    });

    // Click to launch the duck upward.
    window.addEventListener('click', () => {
        setPhysicsBodyLinearVelocity(world, duckAgg.body, { x: 0, y: 10, z: 0 });
    });

    const viewer = createPhysicsViewer(scene, world);
    let showWireframe = true;
    const bodies = [groundAgg.body, duckAgg.body];
    for (const body of bodies) showPhysicsBody(viewer, body);

    window.addEventListener('keydown', (e) => {
        if (e.repeat) return;
        if (e.code === 'KeyW' || e.key === 'w' || e.key === 'W') {
            showWireframe = !showWireframe;
            for (const body of bodies) {
                if (showWireframe) showPhysicsBody(viewer, body);
                else hidePhysicsBody(viewer, body);
            }
            const hint = document.getElementById('hint');
            if (hint) hint.textContent = 'W: wireframe ' + (showWireframe ? 'ON' : 'OFF') + ' / click: jump';
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
