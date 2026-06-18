import {
    addToScene, attachControl, createArcRotateCamera, createBox, createCylinder,
    createEngine, createHavokWorld, createHemisphericLight,
    createPbrMaterial, createPhysicsAggregate, createPhysicsViewer,
    createSceneContext, createSolidTexture2D, createStandardMaterial,
    hidePhysicsBody, loadEnvironment, loadGltf, onBeforeRender, PhysicsShapeType,
    registerScene, showPhysicsBody, startEngine,
    setPhysicsBodyAngularVelocity, setPhysicsBodyLinearVelocity, setPhysicsBodyPreStep,
} from 'https://cdn.jsdelivr.net/npm/@babylonjs/lite@1.0.1/index.js';
import HavokPhysics from 'https://cdn.jsdelivr.net/npm/@babylonjs/havok@1.3.12/lib/esm/HavokPhysics_es.js';

const BASE_URL = 'https://cx20.github.io/gltf-test';
const DUCK_URL = BASE_URL + '/sampleModels/Duck/glTF/Duck.gltf';
const ENV_URL = BASE_URL + '/textures/env/papermillSpecularHDR.env';
const BRDF_URL = 'https://cdn.jsdelivr.net/gh/BabylonJS/Babylon-Lite@master/packages/babylon-lite/assets/brdf-lut.png';
const PHYSICS_SCALE = 1 / 10;
const PHYSICS_FPS = 60;
const MAX_COINS = 500;

// Gold / silver / copper coins (PBR factors + diameter from the Babylon.js sample).
const COIN_TYPES = [
    { color: [1.000, 0.766, 0.336], metallic: 1.0, roughness: 0.2, height: 0.1, diameter: 1.0 },
    { color: [0.972, 0.960, 0.915], metallic: 1.0, roughness: 0.4, height: 0.075, diameter: 0.8 },
    { color: [0.955, 0.637, 0.538], metallic: 1.0, roughness: 0.2, height: 0.05, diameter: 0.6 },
];

function randomNumber(min, max) {
    return min === max ? min : Math.random() * (max - min) + min;
}

function getNextPosition(y) {
    return {
        x: randomNumber(-25, 25) * PHYSICS_SCALE,
        y: (randomNumber(0, 10) + y) * PHYSICS_SCALE,
        z: randomNumber(-25, 25) * PHYSICS_SCALE,
    };
}

function collectMeshes(node, out) {
    if (node._gpu) out.push(node);
    if (node.children) for (const c of node.children) collectMeshes(c, out);
}

async function main() {
    const canvas = document.getElementById('c');
    const engine = await createEngine(canvas);
    const scene = createSceneContext(engine);
    scene.fixedDeltaMs = 1000 / PHYSICS_FPS;

    const camera = createArcRotateCamera(-Math.PI / 180 * 30, Math.PI / 180 * 76, 24, { x: 0, y: -8, z: 0 });
    camera.farPlane = Math.max(camera.farPlane, 20000);
    scene.camera = camera;
    attachControl(camera, canvas, scene);

    const hemi = createHemisphericLight([1, 1, 0]);
    addToScene(scene, hemi);

    // IBL + skybox + BRDF LUT (PBR materials need these; also enables tone mapping).
    await loadEnvironment(scene, ENV_URL, { brdfUrl: BRDF_URL, skyboxUrl: ENV_URL, skyboxSize: 10000 });

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
    });

    const hknp = await HavokPhysics();
    const world = createHavokWorld(scene, hknp, { x: 0, y: -9.81, z: 0 });

    const allBodies = [];

    // Ground slab (20 x ~0.4 x 20) at y = -10*SCALE.
    const groundMat = createStandardMaterial();
    groundMat.diffuseColor = [0.4, 0.4, 0.4];
    groundMat.specularColor = [0, 0, 0];
    const ground = createBox(engine, 1);
    ground.scaling.set(20, 0.4, 20);
    ground.position.set(0, -10, 0);
    ground.material = groundMat;
    addToScene(scene, ground);
    const groundAgg = createPhysicsAggregate(world, ground, PhysicsShapeType.BOX, {
        mass: 0, extents: { x: 20, y: 0.4, z: 20 },
    });
    allBodies.push(groundAgg.body);

    // Load the duck mesh just to read its vertices; the coins are scattered on those points.
    const duck = await loadGltf(engine, DUCK_URL);
    const duckMeshes = [];
    collectMeshes(duck.entities[0], duckMeshes);
    // The largest mesh is the duck body.
    let duckMesh = duckMeshes[0];
    for (const m of duckMeshes) {
        if ((m._cpuPositions?.length ?? 0) > (duckMesh._cpuPositions?.length ?? 0)) duckMesh = m;
    }
    const positions = duckMesh._cpuPositions;

    // One PBR material per coin type. PBR always binds a baseColor and an ORM texture, so use a
    // 1x1 white baseColor (tinted by baseColorFactor) and a 1x1 ORM encoding roughness/metallic.
    const whiteTex = createSolidTexture2D(engine, 1, 1, 1, 1);
    const coinMaterials = COIN_TYPES.map((t) => createPbrMaterial({
        baseColorTexture: whiteTex,
        baseColorFactor: [t.color[0], t.color[1], t.color[2], 1],
        ormTexture: createSolidTexture2D(engine, 1, t.roughness, t.metallic, 1),
        metallicFactor: 1,
        roughnessFactor: 1,
    }));

    // Scatter coins across the duck's vertices (stride-limited so Lite stays performant).
    const coinObjects = [];
    const vertCount = Math.floor(positions.length / 3);
    const stride = Math.max(1, Math.ceil(vertCount / MAX_COINS));
    for (let vi = 0; vi < vertCount; vi += stride) {
        const typeIdx = Math.floor(Math.random() * COIN_TYPES.length);
        const type = COIN_TYPES[typeIdx];
        const coin = createCylinder(engine, { height: type.height, diameter: type.diameter, tessellation: 16 });
        coin.position.set(
            positions[vi * 3 + 0] * PHYSICS_SCALE,
            positions[vi * 3 + 1] * PHYSICS_SCALE - 10,
            positions[vi * 3 + 2] * PHYSICS_SCALE,
        );
        coin.material = coinMaterials[typeIdx];
        addToScene(scene, coin);
        const agg = createPhysicsAggregate(world, coin, PhysicsShapeType.SPHERE, {
            mass: 1, friction: 0.4, restitution: 0.8, radius: type.diameter * 0.5,
        });
        coinObjects.push({ mesh: coin, body: agg.body });
        allBodies.push(agg.body);
    }

    // Recycle coins that fall away.
    onBeforeRender(scene, () => {
        for (const obj of coinObjects) {
            if (obj.mesh.position.y < -50) {
                const pos = getNextPosition(100);
                setPhysicsBodyPreStep(obj.body, true);
                obj.mesh.position.set(pos.x, pos.y, pos.z);
                setPhysicsBodyLinearVelocity(world, obj.body, { x: 0, y: 0, z: 0 });
                setPhysicsBodyAngularVelocity(world, obj.body, { x: 0, y: 0, z: 0 });
            }
        }
    });

    const viewer = createPhysicsViewer(scene, world);
    let showWireframe = true;
    for (const body of allBodies) showPhysicsBody(viewer, body);

    window.addEventListener('keydown', (e) => {
        if (e.repeat) return;
        if (e.code === 'KeyW' || e.key === 'w' || e.key === 'W') {
            showWireframe = !showWireframe;
            for (const body of allBodies) {
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
