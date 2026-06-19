import {
    addToScene,
    attachControl,
    createArcRotateCamera,
    createBox,
    createEngine,
    createGround,
    createHavokWorld,
    createHemisphericLight,
    createPhysicsAggregate,
    createPhysicsViewer,
    createSceneContext,
    createStandardMaterial,
    hidePhysicsBody,
    loadTexture2D,
    onBeforeRender,
    PhysicsShapeType,
    registerScene,
    showPhysicsBody,
    startEngine,
} from 'https://cdn.jsdelivr.net/npm/@babylonjs/lite@1.2.0/index.js';

import HavokPhysics from 'https://cdn.jsdelivr.net/npm/@babylonjs/havok@1.3.12/lib/esm/HavokPhysics_es.js';

const PHYSICS_SCALE = 1 / 10;
const PHYSICS_FPS = 60;

async function main() {
    const canvas = document.getElementById('c');
    const engine = await createEngine(canvas);
    const scene = createSceneContext(engine);
    scene.fixedDeltaMs = 1000 / PHYSICS_FPS;

    // ArcRotateCamera — positioned behind and above the scene
    const camera = createArcRotateCamera(-Math.PI / 2, 1.0, 25, { x: 0, y: 2, z: 0 });
    scene.camera = camera;
    attachControl(camera, canvas, scene);

    // Hemispheric light
    const light = createHemisphericLight([0, 1, 0]);
    light.intensity = 1.0;
    addToScene(scene, light);

    // Standard material with frog texture
    const material = createStandardMaterial();
    material.diffuseTexture = await loadTexture2D(engine, '../../../../assets/textures/frog.jpg');
    material.emissiveColor = [1, 1, 1];

    // Ground — flat plane 20×20 at y = -2
    const ground = createGround(engine, { width: 200 * PHYSICS_SCALE, height: 200 * PHYSICS_SCALE });
    ground.material = material;
    ground.position.set(0, -20 * PHYSICS_SCALE, 0);
    addToScene(scene, ground);

    // Falling box — size 5, starts at y = 10
    const cube = createBox(engine, 50 * PHYSICS_SCALE);
    cube.material = material;
    cube.position.set(0, 100 * PHYSICS_SCALE, 0);
    addToScene(scene, cube);

    // FPS display (top-right)
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

    // Camera auto-rotation (1 degree per frame at 60 fps)
    onBeforeRender(scene, () => {
        camera.alpha += Math.PI / 180.0 / 60.0;
    });

    // Havok physics — WASM loads automatically from the same CDN path
    const hknp = await HavokPhysics();
    const world = createHavokWorld(scene, hknp, { x: 0, y: -9.8, z: 0 });

    // Dynamic rigid body for the box
    const cubeAggregate = createPhysicsAggregate(world, cube, PhysicsShapeType.BOX, {
        mass: 1,
        friction: 0.2,
        restitution: 0.5,
    });

    // Static rigid body for the ground
    const groundAggregate = createPhysicsAggregate(world, ground, PhysicsShapeType.BOX, {
        mass: 0,
        friction: 0.1,
        restitution: 0.1,
    });

    // Physics wireframe viewer (W key to toggle)
    const viewer = createPhysicsViewer(scene, world);
    let showWireframe = true;
    showPhysicsBody(viewer, cubeAggregate.body);
    showPhysicsBody(viewer, groundAggregate.body);

    window.addEventListener('keydown', (e) => {
        if (e.repeat) return;
        if (e.code === 'KeyW' || e.key === 'w' || e.key === 'W') {
            showWireframe = !showWireframe;
            if (showWireframe) {
                showPhysicsBody(viewer, cubeAggregate.body);
                showPhysicsBody(viewer, groundAggregate.body);
            } else {
                hidePhysicsBody(viewer, cubeAggregate.body);
                hidePhysicsBody(viewer, groundAggregate.body);
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
