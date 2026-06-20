import {
    addToScene, attachControl, createArcRotateCamera, createGround,
    createDirectionalLight, createEngine, createHavokWorld,
    createHemisphericLight, createPhysicsAggregate, createPhysicsViewer,
    createSceneContext, createSphere, createStandardMaterial,
    hidePhysicsBody, loadTexture2D, onBeforeRender, PhysicsShapeType,
    registerScene, showPhysicsBody, startEngine,
    setPhysicsBodyAngularVelocity, setPhysicsBodyLinearVelocity, setPhysicsBodyPreStep,
} from '@babylonjs/lite';
import HavokPhysics from '@babylonjs/havok';

const PHYSICS_SCALE = 1 / 10;
const PHYSICS_FPS = 60;

// Pixel-art pattern (16x16 grid, read left-to-right bottom-to-top)
const dataSet = [
    "無","無","無","無","無","無","無","無","無","無","無","無","無","肌","肌","肌",
    "無","無","無","無","無","無","赤","赤","赤","赤","赤","無","無","肌","肌","肌",
    "無","無","無","無","無","赤","赤","赤","赤","赤","赤","赤","赤","赤","肌","肌",
    "無","無","無","無","無","茶","茶","茶","肌","肌","茶","肌","無","赤","赤","赤",
    "無","無","無","無","茶","肌","茶","肌","肌","肌","茶","肌","肌","赤","赤","赤",
    "無","無","無","無","茶","肌","茶","茶","肌","肌","肌","茶","肌","肌","肌","赤",
    "無","無","無","無","茶","茶","肌","肌","肌","肌","茶","茶","茶","茶","赤","無",
    "無","無","無","無","無","無","肌","肌","肌","肌","肌","肌","肌","赤","無","無",
    "無","無","赤","赤","赤","赤","赤","青","赤","赤","赤","青","赤","無","無","無",
    "無","赤","赤","赤","赤","赤","赤","赤","青","赤","赤","赤","青","無","無","茶",
    "肌","肌","赤","赤","赤","赤","赤","赤","青","青","青","青","青","無","無","茶",
    "肌","肌","肌","無","青","青","赤","青","青","黄","青","青","黄","青","茶","茶",
    "無","肌","無","茶","青","青","青","青","青","青","青","青","青","青","茶","茶",
    "無","無","茶","茶","茶","青","青","青","青","青","青","青","青","青","茶","茶",
    "無","茶","茶","茶","青","青","青","青","青","青","青","無","無","無","無","無",
    "無","茶","無","無","青","青","青","青","無","無","無","無","無","無","無","無",
];

function getRgbColor(c) {
    const colorHash = {
        "無": [0xDC / 0xFF, 0xAA / 0xFF, 0x6B / 0xFF],
        "白": [1, 1, 1],
        "肌": [1, 0xCC / 0xFF, 0xCC / 0xFF],
        "茶": [0x80 / 0xFF, 0, 0],
        "赤": [1, 0, 0],
        "黄": [1, 1, 0],
        "緑": [0, 1, 0],
        "水": [0, 1, 1],
        "青": [0, 0, 1],
        "紫": [0x80 / 0xFF, 0, 0x80 / 0xFF],
    };
    return colorHash[c];
}

function randomNumber(min, max) {
    return Math.random() * (max - min) + min;
}

async function main() {
    const canvas = document.getElementById('c');
    const engine = await createEngine(canvas);
    const scene = createSceneContext(engine);
    scene.fixedDeltaMs = 1000 / PHYSICS_FPS;

    // Match the Babylon.js sample's effective view: it overrides the ArcRotateCamera ctor with
    // camera.setPosition(0, 2, -30) looking at the origin -> alpha -PI/2, beta ~1.50, radius ~30.07.
    const camera = createArcRotateCamera(-Math.PI / 2, 1.504, 30.07, { x: 0, y: 0, z: 0 });
    scene.camera = camera;
    attachControl(camera, canvas, scene);

    const hemi = createHemisphericLight([0, 1, 0]);
    hemi.intensity = 1.0;
    addToScene(scene, hemi);

    const dir = createDirectionalLight([0.0, -1.0, 0.5]);
    addToScene(scene, dir);

    const grassTex = await loadTexture2D(engine, '../../../../assets/textures/grass.jpg');
    const footballTex = await loadTexture2D(engine, '../../../../assets/textures/football.png');

    const groundMat = createStandardMaterial();
    groundMat.diffuseTexture = grassTex;
    groundMat.specularColor = [0, 0, 0];
    const ground = createGround(engine, { width: 400 * PHYSICS_SCALE, height: 400 * PHYSICS_SCALE });
    ground.material = groundMat;
    ground.position.set(0, -20 * PHYSICS_SCALE, 0);
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
        mass: 0, friction: 1.0, restitution: 1.0,
    });

    const allBodies = [groundAggregate.body];

    const getPosition = (yBase) => ({
        x: randomNumber(-25, 25) * PHYSICS_SCALE,
        y: (randomNumber(0, 100) + yBase) * PHYSICS_SCALE,
        z: randomNumber(-25, 25) * PHYSICS_SCALE,
    });

    // Footballs forming a pixel-art picture (16x16 grid)
    const BALL_SIZE = 15;
    const objects = [];
    for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
            const i = x + (15 - y) * 16;
            const s = createSphere(engine, { diameter: BALL_SIZE * PHYSICS_SCALE, segments: 16 });
            const x1 = (-130 + x * BALL_SIZE * 1.2 + Math.random()) * PHYSICS_SCALE;
            const y1 = (30 + y * BALL_SIZE * 1.2) * PHYSICS_SCALE;
            const z1 = Math.random() * PHYSICS_SCALE;
            s.position.set(x1, y1, z1);
            const mat = createStandardMaterial();
            mat.diffuseTexture = footballTex;
            const rgb = getRgbColor(dataSet[i]);
            mat.diffuseColor = rgb;
            mat.emissiveColor = rgb;
            s.material = mat;
            addToScene(scene, s);
            const agg = createPhysicsAggregate(world, s, PhysicsShapeType.SPHERE, {
                mass: 1, friction: 0.4, restitution: 0.6,
            });
            objects.push({ mesh: s, body: agg.body });
            allBodies.push(agg.body);
        }
    }

    // Recycle balls that fall below the floor
    let lastFrameTime = 0;
    onBeforeRender(scene, () => {
        for (const obj of objects) {
            if (obj.mesh.position.y < -100 * PHYSICS_SCALE) {
                const pos = getPosition(200);
                setPhysicsBodyPreStep(obj.body, true);
                obj.mesh.position.set(pos.x, pos.y, pos.z);
                setPhysicsBodyLinearVelocity(world, obj.body, { x: 0, y: 0, z: 0 });
                setPhysicsBodyAngularVelocity(world, obj.body, { x: 0, y: 0, z: 0 });
            }
        }
        // Framerate-independent spin to match the Babylon.js sample's getAnimationRatio()
        // (= deltaMs / (1000/60), i.e. 1.0 at 60 FPS).
        const now = performance.now();
        const animationRatio = lastFrameTime ? (now - lastFrameTime) / (1000 / 60) : 1;
        lastFrameTime = now;
        camera.alpha += (Math.PI / 180.0) * animationRatio;
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
    console.error('Babylon Lite error:', err);
    document.body.style.color = '#f88';
    document.body.style.padding = '1rem';
    document.body.style.fontFamily = 'monospace';
    document.body.innerHTML = '<b>Error:</b> ' + err.message +
        '<br><br>This example requires a WebGPU-capable browser (Chrome 113+, Edge 113+).';
});
