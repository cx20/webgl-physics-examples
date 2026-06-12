import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const ERASER_TEXTURES = [
    '../../../../assets/textures/eraser_003/eraser_right.png',
    '../../../../assets/textures/eraser_003/eraser_left.png',
    '../../../../assets/textures/eraser_003/eraser_top.png',
    '../../../../assets/textures/eraser_003/eraser_bottom.png',
    '../../../../assets/textures/eraser_003/eraser_front.png',
    '../../../../assets/textures/eraser_003/eraser_back.png',
];
const ERASER_COUNT = 200;
const STATE_FLOATS = 16;
const SUBSTEPS = 8;
const EHE = [1.2, 0.3, 0.6];
const GROUND_VISUAL_Y = -10.0;

function hash32(n) {
    let x = ((n >>> 0) ^ (n >>> 17)) >>> 0;
    x = Math.imul(x, 0xbf324c81) >>> 0;
    x = (x ^ (x >>> 11)) >>> 0;
    x = Math.imul(x, 0x68b665e5) >>> 0;
    x = (x ^ (x >>> 16)) >>> 0;
    return x;
}
function hashF(n) { return (hash32(n) & 0xffffff) / 0xffffff; }

function quatFromEuler(x, y, z) {
    const cx = Math.cos(x * 0.5), sx = Math.sin(x * 0.5);
    const cy = Math.cos(y * 0.5), sy = Math.sin(y * 0.5);
    const cz = Math.cos(z * 0.5), sz = Math.sin(z * 0.5);
    return [
        sx * cy * cz + cx * sy * sz,
        cx * sy * cz - sx * cy * sz,
        cx * cy * sz + sx * sy * cz,
        cx * cy * cz - sx * sy * sz,
    ];
}

function createInitialStates() {
    const states = new Float32Array(ERASER_COUNT * STATE_FLOATS);
    for (let i = 0; i < ERASER_COUNT; i++) {
        const base = i * STATE_FLOATS;
        const seed = hash32(i + 1);
        states[base + 0] = (hashF(seed)     - 0.5) * 12;
        states[base + 1] = 14 + (i / ERASER_COUNT) * 14 + (hashF(seed + 1) - 0.5) * 2;
        states[base + 2] = (hashF(seed + 2) - 0.5) * 12;
        states[base + 3] = hashF(seed + 6);
        const q = quatFromEuler(
            (hashF(seed + 7) - 0.5) * Math.PI * 2,
            (hashF(seed + 8) - 0.5) * Math.PI * 2,
            (hashF(seed + 9) - 0.5) * Math.PI * 2
        );
        states[base + 8]  = q[0];
        states[base + 9]  = q[1];
        states[base + 10] = q[2];
        states[base + 11] = q[3];
        states[base + 12] = (hashF(seed + 3) - 0.5) * 6;
        states[base + 13] = (hashF(seed + 4) - 0.5) * 6;
        states[base + 14] = (hashF(seed + 5) - 0.5) * 6;
    }
    return states;
}

let showWireframe = true;
let scene, camera, renderer, controls;
let device;
let stateBuffers = [], simParamsBuffer, readbackBuffer;
let computePipeline, computeBindGroups = [];
let currentState = 0;
const eraserMeshes = [];
const debugMeshes = [];
let groundDebug;
let readbackBusy = false;
let lastTime = -1;

async function initScene() {
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 0, 40);

    const dir = new THREE.DirectionalLight(0xffffff, 1.5);
    dir.position.set(0.5, 0.9, 0.35).normalize();
    scene.add(dir);
    scene.add(new THREE.AmbientLight(0x505050));

    // Ground (visual)
    const groundGeo = new THREE.BoxGeometry(20, 0.1, 20);
    const groundMesh = new THREE.Mesh(groundGeo, new THREE.MeshLambertMaterial({ color: 0x424347 }));
    groundMesh.position.set(0, GROUND_VISUAL_Y, 0);
    scene.add(groundMesh);

    groundDebug = new THREE.LineSegments(
        new THREE.EdgesGeometry(groundGeo),
        new THREE.LineBasicMaterial({ color: 0x44ee88 })
    );
    groundDebug.position.copy(groundMesh.position);
    scene.add(groundDebug);

    // Load 6 face textures; BoxGeometry face order: +x, -x, +y, -y, +z, -z
    const texLoader = new THREE.TextureLoader();
    const textures = await Promise.all(
        ERASER_TEXTURES.map(src => new Promise(res => texLoader.load(src, res)))
    );
    const materials = textures.map(t => new THREE.MeshLambertMaterial({ map: t }));

    // Eraser box: full size 2*EHE per axis
    const eraserGeo = new THREE.BoxGeometry(EHE[0] * 2, EHE[1] * 2, EHE[2] * 2);
    const wireGeo = new THREE.EdgesGeometry(eraserGeo);
    const wireMat = new THREE.LineBasicMaterial({ color: 0xffd91a });

    const initial = createInitialStates();
    for (let i = 0; i < ERASER_COUNT; i++) {
        const base = i * STATE_FLOATS;
        const mesh = new THREE.Mesh(eraserGeo, materials);
        mesh.position.set(initial[base], initial[base + 1], initial[base + 2]);
        mesh.quaternion.set(initial[base + 8], initial[base + 9], initial[base + 10], initial[base + 11]);
        scene.add(mesh);
        eraserMeshes.push(mesh);

        const dbg = new THREE.LineSegments(wireGeo, wireMat);
        dbg.position.copy(mesh.position);
        dbg.quaternion.copy(mesh.quaternion);
        scene.add(dbg);
        debugMeshes.push(dbg);
    }
}

function initPhysics() {
    const csCode = document.getElementById('cs').textContent;
    computePipeline = device.createComputePipeline({
        layout: 'auto',
        compute: { module: device.createShaderModule({ code: csCode }), entryPoint: 'main' },
    });

    const initial = createInitialStates();
    const bufSize = ERASER_COUNT * STATE_FLOATS * 4;
    for (let i = 0; i < 2; i++) {
        const buf = device.createBuffer({
            size: bufSize,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
            mappedAtCreation: true,
        });
        new Float32Array(buf.getMappedRange()).set(initial);
        buf.unmap();
        stateBuffers.push(buf);
    }

    readbackBuffer = device.createBuffer({ size: bufSize, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    simParamsBuffer = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    for (let i = 0; i < 2; i++) {
        computeBindGroups.push(device.createBindGroup({
            layout: computePipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: stateBuffers[i] } },
                { binding: 1, resource: { buffer: stateBuffers[1 - i] } },
                { binding: 2, resource: { buffer: simParamsBuffer } },
            ],
        }));
    }
}

function updateMeshes(data) {
    for (let i = 0; i < ERASER_COUNT; i++) {
        const off = i * STATE_FLOATS;
        eraserMeshes[i].position.set(data[off], data[off + 1], data[off + 2]);
        eraserMeshes[i].quaternion.set(data[off + 8], data[off + 9], data[off + 10], data[off + 11]);
        debugMeshes[i].position.copy(eraserMeshes[i].position);
        debugMeshes[i].quaternion.copy(eraserMeshes[i].quaternion);
    }
}

function animate(timeMs) {
    if (lastTime < 0) lastTime = timeMs;
    lastTime = timeMs;

    device.queue.writeBuffer(simParamsBuffer, 0, new Float32Array([
        1 / (60 * SUBSTEPS), 9.8, timeMs * 0.001, 0,
    ]));

    const encoder = device.createCommandEncoder();
    for (let s = 0; s < SUBSTEPS; s++) {
        const pass = encoder.beginComputePass();
        pass.setPipeline(computePipeline);
        pass.setBindGroup(0, computeBindGroups[currentState]);
        pass.dispatchWorkgroups(Math.ceil(ERASER_COUNT / 64));
        pass.end();
        currentState = 1 - currentState;
    }
    if (!readbackBusy) {
        encoder.copyBufferToBuffer(stateBuffers[currentState], 0, readbackBuffer, 0, ERASER_COUNT * STATE_FLOATS * 4);
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
    if (groundDebug) groundDebug.visible = visible;
    for (const dbg of debugMeshes) dbg.visible = visible;
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
    renderer.setClearColor(0x808099);
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.getElementById('container').appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0, 0);

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
