import {
    addToScene, attachControl, createArcRotateCamera, createBox, createSphere,
    createDirectionalLight, createEngine, createGround, createHavokWorld,
    createHemisphericLight, createPhysicsAggregate, createPhysicsViewer,
    createSceneContext, createStandardMaterial,
    hidePhysicsBody, loadTexture2D, onBeforeRender, PhysicsShapeType,
    registerScene, showPhysicsBody, startEngine, updateMeshPositions,
} from 'https://cdn.jsdelivr.net/npm/@babylonjs/lite@1.0.1/index.js';
import HavokPhysics from 'https://cdn.jsdelivr.net/npm/@babylonjs/havok@1.3.12/lib/esm/HavokPhysics_es.js';

const PHYSICS_SCALE = 1 / 10;
const PHYSICS_FPS = 60;

// Pixel-art domino face pattern (16x16 grid, read left-to-right bottom-to-top)
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

async function main() {
    const canvas = document.getElementById('c');
    const engine = await createEngine(canvas);
    const scene = createSceneContext(engine);
    scene.fixedDeltaMs = 1000 / PHYSICS_FPS;

    const camera = createArcRotateCamera(-2.2, 1.0, 50, { x: 0, y: 0, z: 0 });
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

    onBeforeRender(scene, () => { camera.alpha += Math.PI * 0.5 / 180.0; });

    const hknp = await HavokPhysics();
    const world = createHavokWorld(scene, hknp, { x: 0, y: -9.8, z: 0 });

    const groundAggregate = createPhysicsAggregate(world, ground, PhysicsShapeType.BOX, {
        mass: 0, friction: 1.0, restitution: 1.0,
    });

    const allBodies = [groundAggregate.body];

    // Vertex positions for a 0.2 x 1.8 x 1.5 domino, matching Babylon.js CreateBox face order
    // (6 faces x 4 vertices x 3 floats = 72 floats; unit cube ±0.5 scaled by 0.2/1.8/1.5)
    const DOMINO_POSITIONS = new Float32Array([
         0.1,-0.9,-0.75,  0.1, 0.9,-0.75,  0.1, 0.9, 0.75,  0.1,-0.9, 0.75,  // +x
        -0.1,-0.9, 0.75, -0.1, 0.9, 0.75, -0.1, 0.9,-0.75, -0.1,-0.9,-0.75,  // -x
        -0.1, 0.9, 0.75,  0.1, 0.9, 0.75,  0.1, 0.9,-0.75, -0.1, 0.9,-0.75,  // +y
        -0.1,-0.9,-0.75,  0.1,-0.9,-0.75,  0.1,-0.9, 0.75, -0.1,-0.9, 0.75,  // -y
         0.1,-0.9, 0.75,  0.1, 0.9, 0.75, -0.1, 0.9, 0.75, -0.1,-0.9, 0.75,  // +z
        -0.1,-0.9,-0.75, -0.1, 0.9,-0.75,  0.1, 0.9,-0.75,  0.1,-0.9,-0.75,  // -z
    ]);

    // Domino pieces (16x16 grid)
    const DOMINO_SIZE = 15;
    for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
            const pos = x + (15 - y) * 16;
            const x1 = (-100 + x * DOMINO_SIZE) * PHYSICS_SCALE;
            const y1 = -10 * PHYSICS_SCALE;
            const z1 = (-150 + y * DOMINO_SIZE * 1.2) * PHYSICS_SCALE;
            const domino = createBox(engine, 1);
            updateMeshPositions(domino, DOMINO_POSITIONS);
            domino.position.set(x1, y1, z1);
            const mat = createStandardMaterial();
            mat.diffuseColor = getRgbColor(dataSet[pos]);
            domino.material = mat;
            addToScene(scene, domino);
            const agg = createPhysicsAggregate(world, domino, PhysicsShapeType.BOX, { mass: 1 });
            allBodies.push(agg.body);
        }
    }

    // Balls that knock over the dominoes
    const BALL_SIZE = 15;
    const ballMat = createStandardMaterial();
    ballMat.diffuseTexture = footballTex;
    ballMat.emissiveColor = [1, 1, 1];
    for (let y = 0; y < 16; y++) {
        const ball = createSphere(engine, BALL_SIZE * PHYSICS_SCALE);
        const x1 = -105 * PHYSICS_SCALE;
        const y1 = (10 + Math.random()) * PHYSICS_SCALE;
        const z1 = (-150 + y * BALL_SIZE * 1.2) * PHYSICS_SCALE;
        ball.position.set(x1, y1, z1);
        ball.material = ballMat;
        addToScene(scene, ball);
        const agg = createPhysicsAggregate(world, ball, PhysicsShapeType.SPHERE, { mass: 1 });
        allBodies.push(agg.body);
    }

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
