import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const SHOGI_TEXTURE = '../../../../assets/textures/shogi_001/shogi.png';
const COUNT = 300;
const STATE_FLOATS = 16;
const SUBSTEPS = 5;
const SHE = [0.80, 0.96, 0.224];
const GROUND_VISUAL_Y = -10.0;

// Shogi piece geometry (pentagon shape, matching the WebGPU + Havok versions)
const DOT_SIZE = 2;
const pw = DOT_SIZE * 0.8;
const ph = DOT_SIZE * 0.8;
const pd = DOT_SIZE * 0.8 * 0.2;

const positions = new Float32Array([
    -0.5*pw, -0.5*ph,  0.7*pd,   0.5*pw, -0.5*ph,  0.7*pd,   0.35*pw, 0.5*ph,  0.4*pd,  -0.35*pw, 0.5*ph,  0.4*pd,
    -0.5*pw, -0.5*ph, -0.7*pd,   0.5*pw, -0.5*ph, -0.7*pd,   0.35*pw, 0.5*ph, -0.4*pd,  -0.35*pw, 0.5*ph, -0.4*pd,
     0.35*pw, 0.5*ph,  0.4*pd,  -0.35*pw, 0.5*ph,  0.4*pd,  -0.35*pw, 0.5*ph, -0.4*pd,   0.35*pw, 0.5*ph, -0.4*pd,
    -0.5*pw, -0.5*ph,  0.7*pd,   0.5*pw, -0.5*ph,  0.7*pd,   0.5*pw, -0.5*ph, -0.7*pd,  -0.5*pw, -0.5*ph, -0.7*pd,
     0.5*pw, -0.5*ph,  0.7*pd,   0.35*pw, 0.5*ph,  0.4*pd,   0.35*pw, 0.5*ph, -0.4*pd,   0.5*pw, -0.5*ph, -0.7*pd,
    -0.5*pw, -0.5*ph,  0.7*pd,  -0.35*pw, 0.5*ph,  0.4*pd,  -0.35*pw, 0.5*ph, -0.4*pd,  -0.5*pw, -0.5*ph, -0.7*pd,
    -0.35*pw, 0.5*ph,  0.4*pd,   0.35*pw, 0.5*ph,  0.4*pd,   0.0*pw,  0.6*ph,  0.35*pd,
    -0.35*pw, 0.5*ph, -0.4*pd,   0.35*pw, 0.5*ph, -0.4*pd,   0.0*pw,  0.6*ph, -0.35*pd,
     0.35*pw, 0.5*ph,  0.4*pd,   0.35*pw, 0.5*ph, -0.4*pd,   0.0*pw,  0.6*ph, -0.35*pd,  0.0*pw,  0.6*ph,  0.35*pd,
    -0.35*pw, 0.5*ph,  0.4*pd,  -0.35*pw, 0.5*ph, -0.4*pd,   0.0*pw,  0.6*ph, -0.35*pd,  0.0*pw,  0.6*ph,  0.35*pd,
]);

const normals = new Float32Array([
     0,  0.0599,  0.9982,   0,  0.0599,  0.9982,   0,  0.0599,  0.9982,   0,  0.0599,  0.9982,
     0, -0.0599, -0.9982,   0, -0.0599, -0.9982,   0, -0.0599, -0.9982,   0, -0.0599, -0.9982,
     0,  1,  0,   0,  1,  0,   0,  1,  0,   0,  1,  0,
     0, -1,  0,   0, -1,  0,   0, -1,  0,   0, -1,  0,
     0.9889,  0.1483,  0,   0.9889,  0.1483,  0,   0.9889,  0.1483,  0,   0.9889,  0.1483,  0,
    -0.9889,  0.1483,  0,  -0.9889,  0.1483,  0,  -0.9889,  0.1483,  0,  -0.9889,  0.1483,  0,
     0,  0.0995,  0.995,   0,  0.0995,  0.995,   0,  0.0995,  0.995,
     0, -0.0995, -0.995,   0, -0.0995, -0.995,   0, -0.0995, -0.995,
     0.2747,  0.9615,  0,   0.2747,  0.9615,  0,   0.2747,  0.9615,  0,   0.2747,  0.9615,  0,
    -0.2747,  0.9615,  0,  -0.2747,  0.9615,  0,  -0.2747,  0.9615,  0,  -0.2747,  0.9615,  0,
]);

const texCoords = new Float32Array([
    0.5, 0.5,   0.75, 0.5,   0.75-0.25/8, 1.0,   0.5+0.25/8, 1.0,
    0.5, 0.5,   0.25, 0.5,   0.25+0.25/8, 1.0,   0.5-0.25/8, 1.0,
    0.75, 0.5,   0.5, 0.5,   0.5, 0.0,   0.75, 0.0,
    0.0,  0.5,   0.25, 0.5,   0.25, 1.0,   0.0,  1.0,
    0.0,  0.5,   0.0,  0.0,   0.25, 0.0,   0.25, 0.5,
    0.5,  0.5,   0.5,  0.0,   0.25, 0.0,   0.25, 0.5,
    0.75, 0.0,   1.0,  0.0,   1.0,  0.5,
    0.75, 0.0,   1.0,  0.0,   1.0,  0.5,
    0.75, 0.0,   1.0,  0.0,   1.0,  0.5,   0.75, 0.5,
    0.75, 0.0,   1.0,  0.0,   1.0,  0.5,   0.75, 0.5,
]);

const indices = new Uint16Array([
     0,  1,  2,   0,  2,  3,
     4,  5,  6,   4,  6,  7,
     8,  9, 10,   8, 10, 11,
    12, 13, 14,  12, 14, 15,
    16, 17, 18,  16, 18, 19,
    20, 21, 22,  20, 22, 23,
    24, 25, 26,
    27, 28, 29,
    30, 33, 31,  33, 32, 31,
    34, 35, 36,  34, 36, 37,
]);

function hash32(n) {
    let x = ((n >>> 0) ^ (n >>> 17)) >>> 0;
    x = Math.imul(x, 0xbf324c81) >>> 0;
    x = (x ^ (x >>> 11)) >>> 0;
    x = Math.imul(x, 0x68b665e5) >>> 0;
    x = (x ^ (x >>> 16)) >>> 0;
    return x;
}
function hashF(n) { return (hash32(n) & 0xffffff) / 0xffffff; }

function createInitialStates() {
    const states = new Float32Array(COUNT * STATE_FLOATS);
    for (let i = 0; i < COUNT; i++) {
        const base = i * STATE_FLOATS;
        const seed = hash32(i + 1);
        states[base + 0] = (hashF(seed)     - 0.5) * 15;
        states[base + 1] = (hashF(seed + 1) + 1.0) * 15;
        states[base + 2] = (hashF(seed + 2) - 0.5) * 15;
        states[base + 3] = hashF(seed + 6);
        states[base + 11] = 1.0;
        states[base + 12] = (hashF(seed + 3) - 0.5) * 6;
        states[base + 13] = (hashF(seed + 4) - 0.5) * 2;
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
const pieceMeshes = [];
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
    scene.add(new THREE.AmbientLight(0x404040));

    const groundGeo = new THREE.BoxGeometry(13, 0.1, 13);
    const groundMesh = new THREE.Mesh(groundGeo, new THREE.MeshLambertMaterial({ color: 0x888899 }));
    groundMesh.position.set(0, GROUND_VISUAL_Y, 0);
    scene.add(groundMesh);

    groundDebug = new THREE.LineSegments(
        new THREE.EdgesGeometry(groundGeo),
        new THREE.LineBasicMaterial({ color: 0x44ee88 })
    );
    groundDebug.position.copy(groundMesh.position);
    scene.add(groundDebug);

    const texLoader = new THREE.TextureLoader();
    const shogiTex = await new Promise(res => texLoader.load(SHOGI_TEXTURE, res));
    shogiTex.flipY = false; // UV coords match WebGPU convention (v=0 at top)

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(texCoords, 2));
    geo.setIndex(new THREE.Uint16BufferAttribute(indices, 1));

    const mat = new THREE.MeshLambertMaterial({ map: shogiTex, side: THREE.DoubleSide });

    const wireGeo = new THREE.EdgesGeometry(
        new THREE.BoxGeometry(SHE[0] * 2, SHE[1] * 2, SHE[2] * 2)
    );
    const wireMat = new THREE.LineBasicMaterial({ color: 0xffff00 });

    const initial = createInitialStates();
    for (let i = 0; i < COUNT; i++) {
        const base = i * STATE_FLOATS;
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(initial[base], initial[base + 1], initial[base + 2]);
        mesh.quaternion.set(initial[base + 8], initial[base + 9], initial[base + 10], initial[base + 11]);
        scene.add(mesh);
        pieceMeshes.push(mesh);

        const dbg = new THREE.LineSegments(wireGeo, wireMat);
        dbg.position.copy(mesh.position);
        dbg.quaternion.copy(mesh.quaternion);
        scene.add(dbg);
        debugMeshes.push(dbg);
    }
}

function initPhysics() {
    const csCode = document.getElementById('cs').textContent
        .replaceAll('__COUNT__', COUNT + 'u');

    computePipeline = device.createComputePipeline({
        layout: 'auto',
        compute: { module: device.createShaderModule({ code: csCode }), entryPoint: 'main' },
    });

    const initial = createInitialStates();
    const bufSize = COUNT * STATE_FLOATS * 4;
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
    for (let i = 0; i < COUNT; i++) {
        const off = i * STATE_FLOATS;
        pieceMeshes[i].position.set(data[off], data[off + 1], data[off + 2]);
        pieceMeshes[i].quaternion.set(data[off + 8], data[off + 9], data[off + 10], data[off + 11]);
        debugMeshes[i].position.copy(pieceMeshes[i].position);
        debugMeshes[i].quaternion.copy(pieceMeshes[i].quaternion);
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
        pass.dispatchWorkgroups(Math.ceil(COUNT / 64));
        pass.end();
        currentState = 1 - currentState;
    }
    if (!readbackBusy) {
        encoder.copyBufferToBuffer(stateBuffers[currentState], 0, readbackBuffer, 0, COUNT * STATE_FLOATS * 4);
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
    renderer.setClearColor(0x000000);
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.getElementById('container').appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, -5, 0);

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
