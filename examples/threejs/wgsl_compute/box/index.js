import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const ROWS = [
    '.............ppp',
    '......rrrrr..ppp',
    '.....rrrrrrrrrpp',
    '.....nnnppnp.rrr',
    '....npnpppnpprrr',
    '....npnnpppnpppr',
    '....nnppppnnnnr.',
    '......pppppppr..',
    '..rrrrrbrrrbr...',
    '.rrrrrrrbrrrb..n',
    'pprrrrrrbbbbb..n',
    'ppp.bbrbbybbybnn',
    '.p.nbbbbbbbbbbnn',
    '..nnnbbbbbbbbbnn',
    '.nnnbbbbbbb.....',
    '.n..bbbb........',
];

const palette = {
    '.': 0xDCAA6B, p: 0xFFCCCC, n: 0x800000,
    r: 0xFF0000,  y: 0xFFFF00, b: 0x0000FF,
};

const COUNT    = 256;
const BOX_HALF = 0.5;
const GROUND_Y = -2.0;
const SUBSTEPS = 5;

let showWireframe = true;
let scene, camera, renderer, controls;
let device;
let stateBuffers = [], simParamsBuffer, readbackBuffer;
let computePipeline, computeBindGroups = [];
let currentState = 0;
const boxMeshes  = [];
const debugMeshes = [];
let groundDebug;
let readbackBusy = false;
let lastTime = -1;

function initScene() {
    scene  = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 200);
    camera.position.set(0, 13, 25);

    const dir = new THREE.DirectionalLight(0xffffff, 1.5);
    dir.position.set(0.5, 0.9, 0.35).normalize();
    scene.add(dir);
    scene.add(new THREE.AmbientLight(0x505050));

    const groundGeo = new THREE.BoxGeometry(32, 0.4, 32);
    const groundMesh = new THREE.Mesh(
        groundGeo,
        new THREE.MeshLambertMaterial({ color: 0x557755 })
    );
    groundMesh.position.set(0, -2.2, 0);
    scene.add(groundMesh);

    groundDebug = new THREE.LineSegments(
        new THREE.EdgesGeometry(groundGeo),
        new THREE.LineBasicMaterial({ color: 0x44ee88 })
    );
    groundDebug.position.copy(groundMesh.position);
    scene.add(groundDebug);

    const boxGeo   = new THREE.BoxGeometry(1, 1, 1);
    const edgesGeo = new THREE.EdgesGeometry(boxGeo);
    const wireMat  = new THREE.LineBasicMaterial({ color: 0xff8844 });

    let i = 0;
    for (let rowIndex = 0; rowIndex < ROWS.length; rowIndex++) {
        const row = ROWS[rowIndex];
        for (let col = 0; col < row.length; col++) {
            const jitter = ((col * 13 + rowIndex * 7) % 10) * 0.006;
            const px = -12 + col * 1.5 + jitter;
            const py = (ROWS.length - 1 - rowIndex) * 1.2 + jitter;
            const pz = ((col * 5 + rowIndex * 3) % 9) * 0.012;

            const mesh = new THREE.Mesh(
                boxGeo,
                new THREE.MeshLambertMaterial({ color: palette[row[col]] })
            );
            mesh.position.set(px, py, pz);
            scene.add(mesh);
            boxMeshes.push(mesh);

            const dbg = new THREE.LineSegments(edgesGeo, wireMat);
            dbg.position.copy(mesh.position);
            scene.add(dbg);
            debugMeshes.push(dbg);
            i++;
        }
    }
}

function createInitialStates() {
    const states = new Float32Array(COUNT * 8);
    let i = 0;
    for (let rowIndex = 0; rowIndex < ROWS.length; rowIndex++) {
        const row = ROWS[rowIndex];
        for (let col = 0; col < row.length; col++) {
            const base   = i * 8;
            const jitter = ((col * 13 + rowIndex * 7) % 10) * 0.006;
            states[base + 0] = -12 + col * 1.5 + jitter;
            states[base + 1] = (ROWS.length - 1 - rowIndex) * 1.2 + jitter;
            states[base + 2] = ((col * 5 + rowIndex * 3) % 9) * 0.012;
            states[base + 3] = ((col * 17 + rowIndex * 31) % 97) / 97;
            states[base + 4] = ((col % 3) - 1) * 0.03;
            states[base + 5] = -0.05;
            states[base + 6] = ((rowIndex % 3) - 1) * 0.02;
            i++;
        }
    }
    return states;
}

function initPhysics() {
    const wgsl = document.getElementById('cs').textContent;
    computePipeline = device.createComputePipeline({
        layout:  'auto',
        compute: { module: device.createShaderModule({ code: wgsl }), entryPoint: 'main' },
    });

    const initial = createInitialStates();
    const bufSize = COUNT * 8 * 4;
    for (let i = 0; i < 2; i++) {
        const buf = device.createBuffer({
            size: bufSize, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
            mappedAtCreation: true,
        });
        new Float32Array(buf.getMappedRange()).set(initial);
        buf.unmap();
        stateBuffers.push(buf);
    }

    readbackBuffer = device.createBuffer({
        size:  bufSize,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });

    simParamsBuffer = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    for (let i = 0; i < 2; i++) {
        computeBindGroups.push(device.createBindGroup({
            layout:  computePipeline.getBindGroupLayout(0),
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
        const off = i * 8;
        boxMeshes[i].position.set(data[off], data[off + 1], data[off + 2]);
        debugMeshes[i].position.copy(boxMeshes[i].position);
    }
}

function animate(timeMs) {
    if (lastTime < 0) lastTime = timeMs;
    const dt = Math.min((timeMs - lastTime) / 1000, 1 / 30);
    lastTime = timeMs;

    device.queue.writeBuffer(simParamsBuffer, 0, new Float32Array([
        dt / SUBSTEPS, 9.8, GROUND_Y, 0.18, 0.996, 0.86, BOX_HALF, timeMs * 0.001,
    ]));

    const encoder = device.createCommandEncoder();
    for (let s = 0; s < SUBSTEPS; s++) {
        const cp = encoder.beginComputePass();
        cp.setPipeline(computePipeline);
        cp.setBindGroup(0, computeBindGroups[currentState]);
        cp.dispatchWorkgroups(Math.ceil(COUNT / 64));
        cp.end();
        currentState = 1 - currentState;
    }
    if (!readbackBusy) {
        encoder.copyBufferToBuffer(stateBuffers[currentState], 0, readbackBuffer, 0, COUNT * 8 * 4);
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

    initScene();

    renderer = new THREE.WebGPURenderer({ antialias: true });
    renderer.setClearColor(0xF7F7FA);
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.getElementById('container').appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 6, 0);
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
