import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const BALL_COUNT   = 180;
const SUBSTEPS     = 4;
const BASKET_HALF  = 2.5;
const BASKET_TOP   = 4.0;
const GROUND_Y     = -1.0;
const GROUND_HALF  = 10.0;

const RESTITUTIONS     = [0.72, 0.82, 0.76, 0.48, 0.72];
const FRICTIONS        = [0.035, 0.02, 0.035, 0.08, 0.055];
const BALL_SIZE_SCALES = [1.0, 0.9, 1.0, 0.3, 0.3];
const TEXTURE_FILES    = [
    '../../../../assets/textures/Basketball.jpg',
    '../../../../assets/textures/BeachBall.jpg',
    '../../../../assets/textures/Football.jpg',
    '../../../../assets/textures/Softball.jpg',
    '../../../../assets/textures/TennisBall.jpg',
];

let showWireframe = true;
let scene, camera, renderer, controls;
let device;
let stateBuffers = [], ballInfoBuffer, simParamsBuffer, readbackBuffer;
let computePipeline, computeBindGroups = [];
let currentState = 0;
const ballMeshes  = [];
const debugMeshes = [];
const staticMeshes = [];
const staticDebug  = [];
let readbackBusy  = false;
let lastTime = -1;

// CPU-side ball radii (needed for scaling debug wireframes)
const ballRadii = new Float32Array(BALL_COUNT);

function makeSphereWireGeo() {
    const segs = 32;
    const pts  = [];
    for (let axis = 0; axis < 3; axis++) {
        for (let k = 0; k < segs; k++) {
            for (const a of [(k / segs) * Math.PI * 2, ((k + 1) / segs) * Math.PI * 2]) {
                const c = Math.cos(a), s = Math.sin(a);
                if      (axis === 0) pts.push(0, c, s);
                else if (axis === 1) pts.push(c, 0, s);
                else                 pts.push(c, s, 0);
            }
        }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    return geo;
}

async function loadTextures() {
    const loader = new THREE.TextureLoader();
    return Promise.all(TEXTURE_FILES.map(src =>
        new Promise(res => loader.load(src, res))
    ));
}

async function initScene() {
    scene  = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 150);
    camera.position.set(0, 12, 24);

    const dir = new THREE.DirectionalLight(0xffffff, 1.5);
    dir.position.set(0.5, 0.9, 0.35).normalize();
    scene.add(dir);
    scene.add(new THREE.AmbientLight(0x505050));

    const textures = await loadTextures();
    const mats     = textures.map(tex => new THREE.MeshLambertMaterial({ map: tex }));

    const sphereGeo = new THREE.SphereGeometry(1, 20, 12);
    const wireGeo   = makeSphereWireGeo();
    const wireMat   = new THREE.LineBasicMaterial({ color: 0xff8844 });

    for (let i = 0; i < BALL_COUNT; i++) {
        const seed        = ((i * 37) % 101) / 101;
        const texIdx      = (i * 7) % BALL_SIZE_SCALES.length;
        const radius      = (0.5 + seed * 0.25) * BALL_SIZE_SCALES[texIdx];
        ballRadii[i]      = radius;

        const col = i % 15;
        const row = Math.floor(i / 15);
        const px  = (col - 7) * 0.24 + (seed - 0.5) * 0.35;
        const py  = 7 + row * 0.35 + seed * 5;
        const pz  = (seed - 0.5) * BASKET_HALF * 1.2;

        const mesh = new THREE.Mesh(sphereGeo, mats[texIdx]);
        mesh.scale.setScalar(radius);
        mesh.position.set(px, py, pz);
        scene.add(mesh);
        ballMeshes.push(mesh);

        const dbg = new THREE.LineSegments(wireGeo, wireMat);
        dbg.scale.setScalar(radius);
        dbg.position.copy(mesh.position);
        scene.add(dbg);
        debugMeshes.push(dbg);
    }

    // Static items: ground + 4 basket walls
    const staticData = [
        { pos: [0, -2, 0],    scale: [20, 2, 20],  color: 0x383840 },
        { pos: [0, 1.5, -2.5], scale: [4.8, 5, 0.4], color: 0x404048 },
        { pos: [0, 1.5,  2.5], scale: [4.8, 5, 0.4], color: 0x404048 },
        { pos: [-2.5, 1.5, 0], scale: [0.4, 5, 4.8], color: 0x404048 },
        { pos: [ 2.5, 1.5, 0], scale: [0.4, 5, 4.8], color: 0x404048 },
    ];
    const boxWireMat = new THREE.LineBasicMaterial({ color: 0x44ee88 });

    for (const d of staticData) {
        const geo  = new THREE.BoxGeometry(...d.scale);
        const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: d.color }));
        mesh.position.set(...d.pos);
        scene.add(mesh);
        staticMeshes.push(mesh);

        const dbg = new THREE.LineSegments(new THREE.EdgesGeometry(geo), boxWireMat);
        dbg.position.set(...d.pos);
        scene.add(dbg);
        staticDebug.push(dbg);
    }
}

function createInitialStates() {
    const states = new Float32Array(BALL_COUNT * 16);
    for (let i = 0; i < BALL_COUNT; i++) {
        const seed = ((i * 37) % 101) / 101;
        const base = i * 16;
        const col  = i % 15;
        const row  = Math.floor(i / 15);
        states[base + 0] = (col - 7) * 0.24 + (seed - 0.5) * 0.35;
        states[base + 1] = 7 + row * 0.35 + seed * 5;
        states[base + 2] = (seed - 0.5) * BASKET_HALF * 1.2;
        states[base + 3] = seed;
        states[base + 4] = (seed - 0.5) * 0.12;
        states[base + 5] = -0.05;
        states[base + 6] = (0.5 - seed) * 0.12;
        states[base + 8] = 0; states[base + 9] = 0; states[base + 10] = 0; states[base + 11] = 1;
        states[base + 12] = seed * 0.6;
        states[base + 13] = seed * 0.3;
        states[base + 14] = -seed * 0.4;
    }
    return states;
}

function createBallInfos() {
    const infos = new Float32Array(BALL_COUNT * 4);
    for (let i = 0; i < BALL_COUNT; i++) {
        const seed    = ((i * 37) % 101) / 101;
        const texIdx  = (i * 7) % BALL_SIZE_SCALES.length;
        const radius  = (0.5 + seed * 0.25) * BALL_SIZE_SCALES[texIdx];
        const base    = i * 4;
        infos[base + 0] = radius;
        infos[base + 1] = texIdx;
        infos[base + 2] = RESTITUTIONS[texIdx];
        infos[base + 3] = FRICTIONS[texIdx];
    }
    return infos;
}

function initPhysics() {
    const wgsl = document.getElementById('cs').textContent;
    computePipeline = device.createComputePipeline({
        layout:  'auto',
        compute: { module: device.createShaderModule({ code: wgsl }), entryPoint: 'main' },
    });

    const initial = createInitialStates();
    const bufSize = BALL_COUNT * 16 * 4;
    for (let i = 0; i < 2; i++) {
        const buf = device.createBuffer({
            size: bufSize, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
            mappedAtCreation: true,
        });
        new Float32Array(buf.getMappedRange()).set(initial);
        buf.unmap();
        stateBuffers.push(buf);
    }

    readbackBuffer = device.createBuffer({ size: bufSize, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    simParamsBuffer = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    ballInfoBuffer = device.createBuffer({
        size: BALL_COUNT * 4 * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        mappedAtCreation: true,
    });
    new Float32Array(ballInfoBuffer.getMappedRange()).set(createBallInfos());
    ballInfoBuffer.unmap();

    for (let i = 0; i < 2; i++) {
        computeBindGroups.push(device.createBindGroup({
            layout:  computePipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: stateBuffers[i] } },
                { binding: 1, resource: { buffer: stateBuffers[1 - i] } },
                { binding: 2, resource: { buffer: ballInfoBuffer } },
                { binding: 3, resource: { buffer: simParamsBuffer } },
            ],
        }));
    }
}

function updateMeshes(data) {
    for (let i = 0; i < BALL_COUNT; i++) {
        const off = i * 16;
        ballMeshes[i].position.set(data[off], data[off + 1], data[off + 2]);
        ballMeshes[i].quaternion.set(data[off + 8], data[off + 9], data[off + 10], data[off + 11]);
        debugMeshes[i].position.copy(ballMeshes[i].position);
        debugMeshes[i].quaternion.copy(ballMeshes[i].quaternion);
    }
}

function animate(timeMs) {
    if (lastTime < 0) lastTime = timeMs;
    const dt = Math.min((timeMs - lastTime) / 1000, 1 / 30);
    lastTime = timeMs;

    device.queue.writeBuffer(simParamsBuffer, 0, new Float32Array([
        dt / SUBSTEPS, 9.8, GROUND_Y, BASKET_HALF,
        BASKET_TOP, 0.998, timeMs * 0.001, GROUND_HALF,
    ]));

    const encoder = device.createCommandEncoder();
    for (let s = 0; s < SUBSTEPS; s++) {
        const cp = encoder.beginComputePass();
        cp.setPipeline(computePipeline);
        cp.setBindGroup(0, computeBindGroups[currentState]);
        cp.dispatchWorkgroups(Math.ceil(BALL_COUNT / 64));
        cp.end();
        currentState = 1 - currentState;
    }
    if (!readbackBusy) {
        encoder.copyBufferToBuffer(stateBuffers[currentState], 0, readbackBuffer, 0, BALL_COUNT * 16 * 4);
    }
    device.queue.submit([encoder.finish()]);

    if (!readbackBusy) {
        readbackBusy = true;
        readbackBuffer.mapAsync(GPUMapMode.READ).then(() => {
            const data = new Float32Array(readbackBuffer.getMappedRange().slice(0));
            readbackBuffer.unmap();
            updateMeshes(data);
            readbackBusy = false;
        }).catch(() => { readbackBusy = false; });
    }

    controls.update();
    renderer.render(scene, camera);
}

function setWireframeVisible(visible) {
    showWireframe = visible;
    for (const dbg of debugMeshes)  dbg.visible = visible;
    for (const dbg of staticDebug)  dbg.visible = visible;
    const hint = document.getElementById('hint');
    if (hint) hint.textContent = 'W: wireframe ' + (visible ? 'ON' : 'OFF');
}

window.addEventListener('keydown', (event) => {
    if (event.repeat) return;
    if (event.code === 'KeyW' || event.key === 'w' || event.key === 'W') {
        setWireframeVisible(!showWireframe);
    }
});

async function main() {
    if (!navigator.gpu) {
        document.getElementById('hint').textContent = 'WebGPU is not supported in this browser.';
        return;
    }

    await initScene();

    renderer = new THREE.WebGPURenderer({ antialias: true });
    renderer.setClearColor(0xF7F7FA);
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.getElementById('container').appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 4, 0);
    controls.autoRotate      = true;
    controls.autoRotateSpeed = 0.5;

    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });

    await renderer.init();
    device = renderer.backend.device;

    initPhysics();
    setWireframeVisible(showWireframe);
    renderer.setAnimationLoop(animate);
}

main().catch(console.error);
