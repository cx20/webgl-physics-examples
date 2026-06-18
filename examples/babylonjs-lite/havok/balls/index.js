import {
    addToScene, attachControl, createArcRotateCamera, createBox, createGround,
    createDirectionalLight, createEngine, createHavokWorld,
    createPhysicsAggregate, createPhysicsViewer,
    createSceneContext, createSphere, createStandardMaterial,
    hidePhysicsBody, loadTexture2D, onBeforeRender, PhysicsShapeType,
    registerScene, showPhysicsBody, startEngine,
    setPhysicsBodyAngularVelocity, setPhysicsBodyLinearVelocity, setPhysicsBodyPreStep,
} from 'https://cdn.jsdelivr.net/npm/@babylonjs/lite@1.0.1/index.js';
import HavokPhysics from 'https://cdn.jsdelivr.net/npm/@babylonjs/havok@1.3.12/lib/esm/HavokPhysics_es.js';

const PHYSICS_SCALE = 1 / 10;
const PHYSICS_FPS = 60;
const BALL_COUNT = 150;

const ballSet = [
    { imageFile: '../../../../assets/textures/Basketball.jpg', scale: 1.0 },
    { imageFile: '../../../../assets/textures/BeachBall.jpg', scale: 0.9 },
    { imageFile: '../../../../assets/textures/Football.jpg', scale: 1.0 },
    { imageFile: '../../../../assets/textures/Softball.jpg', scale: 0.3 },
    { imageFile: '../../../../assets/textures/TennisBall.jpg', scale: 0.3 },
];

function randomNumber(min, max) {
    if (min === max) return min;
    return Math.random() * (max - min) + min;
}

async function main() {
    const canvas = document.getElementById('c');
    const engine = await createEngine(canvas);
    const scene = createSceneContext(engine);
    scene.fixedDeltaMs = 1000 / PHYSICS_FPS;

    const camera = createArcRotateCamera(0.86, 1.37, 40, { x: 0, y: 5 * PHYSICS_SCALE, z: 0 });
    scene.camera = camera;
    attachControl(camera, canvas, scene);

    const light1 = createDirectionalLight([0.2, -1.0, 0.2]);
    light1.intensity = 0.2;
    addToScene(scene, light1);
    const light2 = createDirectionalLight([-0.5, -0.5, -0.5]);
    light2.intensity = 1.0;
    addToScene(scene, light2);

    const grassTex = await loadTexture2D(engine, '../../../../assets/textures/grass.jpg');

    const groundMat = createStandardMaterial();
    groundMat.diffuseTexture = grassTex;
    groundMat.specularColor = [0, 0, 0];
    const ground = createGround(engine, { width: 400 * PHYSICS_SCALE, height: 400 * PHYSICS_SCALE });
    ground.material = groundMat;
    ground.position.set(0, -15 * PHYSICS_SCALE, 0);
    addToScene(scene, ground);

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
    const world = createHavokWorld(scene, hknp, { x: 0, y: -9.8, z: 0 });

    const groundAggregate = createPhysicsAggregate(world, ground, PhysicsShapeType.BOX, {
        mass: 0, friction: 0.4, restitution: 0.6,
    });

    const allBodies = [groundAggregate.body];

    // Four translucent walls forming a container. They are scaled boxes, so the
    // collider size must be passed explicitly through `extents` (the body sync
    // never copies node scaling, see the domino example).
    const BOARD = 50 * PHYSICS_SCALE; // base cube edge
    const THIN = BOARD * 0.1;
    const boardMat = createStandardMaterial();
    boardMat.emissiveColor = [0.5, 0.5, 0.5];
    boardMat.alpha = 0.5;
    const boardSpecs = [
        { pos: { x: 25 * PHYSICS_SCALE, y: 10 * PHYSICS_SCALE, z: 0 }, scaling: { x: 0.1, y: 1, z: 1 } },
        { pos: { x: -25 * PHYSICS_SCALE, y: 10 * PHYSICS_SCALE, z: 0 }, scaling: { x: 0.1, y: 1, z: 1 } },
        { pos: { x: 0, y: 10 * PHYSICS_SCALE, z: 25 * PHYSICS_SCALE }, scaling: { x: 1, y: 1, z: 0.1 } },
        { pos: { x: 0, y: 10 * PHYSICS_SCALE, z: -25 * PHYSICS_SCALE }, scaling: { x: 1, y: 1, z: 0.1 } },
    ];
    for (const spec of boardSpecs) {
        const board = createBox(engine, BOARD);
        board.scaling.set(spec.scaling.x, spec.scaling.y, spec.scaling.z);
        board.position.set(spec.pos.x, spec.pos.y, spec.pos.z);
        board.material = boardMat;
        addToScene(scene, board);
        const agg = createPhysicsAggregate(world, board, PhysicsShapeType.BOX, {
            mass: 0, friction: 0.4, restitution: 0.6,
            extents: {
                x: spec.scaling.x === 0.1 ? THIN : BOARD,
                y: BOARD,
                z: spec.scaling.z === 0.1 ? THIN : BOARD,
            },
        });
        allBodies.push(agg.body);
    }

    const getPosition = (yBase) => ({
        x: randomNumber(-25, 25) * PHYSICS_SCALE,
        y: (randomNumber(0, 100) + yBase) * PHYSICS_SCALE,
        z: randomNumber(-25, 25) * PHYSICS_SCALE,
    });

    const ballTextures = [];
    for (const def of ballSet) {
        ballTextures.push(await loadTexture2D(engine, def.imageFile));
    }

    // Rain of assorted balls
    const objects = [];
    let y = 50;
    for (let index = 0; index < BALL_COUNT; index++) {
        const pos = Math.floor(Math.random() * ballSet.length);
        const scale = ballSet[pos].scale;
        const s = createSphere(engine, { diameter: 15 * scale * PHYSICS_SCALE, segments: 30 });
        const p = getPosition(y);
        s.position.set(p.x, p.y, p.z);
        const mat = createStandardMaterial();
        mat.diffuseTexture = ballTextures[pos];
        mat.specularColor = [0, 0, 0];
        s.material = mat;
        addToScene(scene, s);
        const agg = createPhysicsAggregate(world, s, PhysicsShapeType.SPHERE, {
            mass: 1, friction: 0.4, restitution: 0.8,
        });
        objects.push({ mesh: s, body: agg.body });
        allBodies.push(agg.body);

        // Small per-ball spawn-height stagger (pre-scale units, kept constant).
        y += 0.2;
    }

    // Recycle balls that fall below the floor
    onBeforeRender(scene, () => {
        for (const obj of objects) {
            if (obj.mesh.position.y < -100 * PHYSICS_SCALE) {
                const pos = getPosition(100);
                setPhysicsBodyPreStep(obj.body, true);
                obj.mesh.position.set(pos.x, pos.y, pos.z);
                setPhysicsBodyLinearVelocity(world, obj.body, { x: 0, y: 0, z: 0 });
                setPhysicsBodyAngularVelocity(world, obj.body, { x: 0, y: 0, z: 0 });
            }
        }
        // Slow ~0.2 rad/s rotation to match the WebGL/WebGPU samples.
        camera.alpha += 0.2 / 60;
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
