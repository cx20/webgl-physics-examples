import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const GRID     = 16;
const COUNT    = GRID * GRID;    // 256
const BW       = 1.0;            // domino half-width
const BH       = 2.0;            // domino half-height
const BD       = 0.3;            // domino half-depth
const SPACING  = 3.0;
const SUBSTEPS = 4;

// Colour sprite (16x16 grid, column-major: col = floor(i/GRID), row = i%GRID)
const sprite = [
    0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,1,
    0,0,0,0,0,0,2,2,2,2,2,0,0,1,1,1,
    0,0,0,0,0,2,2,2,2,2,2,2,2,2,1,1,
    0,0,0,0,0,3,3,3,1,1,3,1,0,2,2,2,
    0,0,0,0,3,1,3,1,1,1,3,1,1,2,2,2,
    0,0,0,0,3,1,3,3,1,1,1,3,1,1,1,2,
    0,0,0,0,3,3,1,1,1,1,3,3,3,3,2,0,
    0,0,0,0,0,0,1,1,1,1,1,1,1,2,0,0,
    0,0,2,2,2,2,2,4,2,2,2,4,2,0,0,0,
    0,2,2,2,2,2,2,2,4,2,2,2,4,0,0,3,
    1,1,2,2,2,2,2,2,4,4,4,4,4,0,0,3,
    1,1,1,0,4,4,2,4,4,5,4,4,5,4,3,3,
    0,1,0,3,4,4,4,4,4,4,4,4,4,4,3,3,
    0,0,3,3,3,4,4,4,4,4,4,4,4,4,3,3,
    0,3,3,3,4,4,4,4,4,4,4,0,0,0,0,0,
    0,3,0,0,4,4,4,4,0,0,0,0,0,0,0,0,
];

// Palette index → three.js hex colour (converted from float RGBA)
const palette = [
    0xDCAA6B,  // 0 tan
    0xFFCCCC,  // 1 light pink
    0xFF0A05,  // 2 red
    0x800000,  // 3 dark red
    0x0A24FF,  // 4 blue
    0xFFEB0A,  // 5 yellow
];

let showWireframe = true;
let scene, camera, renderer, controls;
let device;
let stateBuffer, readbackBuffer, simParamsBuffer;
let computePipeline, computeBindGroup;
const dominoMeshes = [];
const debugMeshes  = [];
let groundDebug;
let readbackBusy = false;
let lastTime = -1;

function initScene() {
    scene = new THREE.Scene();

    camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 300);
    camera.position.set(0, 35, 50);

    const dir = new THREE.DirectionalLight(0xffffff, 1.5);
    dir.position.set(0.45, 0.9, 0.35).normalize();
    scene.add(dir);
    scene.add(new THREE.AmbientLight(0x606060));

    const groundGeo = new THREE.BoxGeometry(52, 0.16, 52);
    const groundMesh = new THREE.Mesh(
        groundGeo,
        new THREE.MeshLambertMaterial({ color: 0x85948A })
    );
    groundMesh.position.set(0, -0.08, 0);
    scene.add(groundMesh);

    groundDebug = new THREE.LineSegments(
        new THREE.EdgesGeometry(groundGeo),
        new THREE.LineBasicMaterial({ color: 0x44ee88 })
    );
    groundDebug.position.set(0, -0.08, 0);
    scene.add(groundDebug);

    const dominoGeo = new THREE.BoxGeometry(BW * 2, BH * 2, BD * 2);
    const edgesGeo  = new THREE.EdgesGeometry(dominoGeo);
    const wireMat   = new THREE.LineBasicMaterial({ color: 0xff8844 });

    for (let i = 0; i < COUNT; i++) {
        const col = Math.floor(i / GRID);
        const row = i % GRID;
        const px  = (col - (GRID - 1) * 0.5) * SPACING;
        const pz  = ((GRID - 1) * 0.5 - row) * SPACING;

        const mesh = new THREE.Mesh(
            dominoGeo,
            new THREE.MeshLambertMaterial({ color: palette[sprite[i]] })
        );
        mesh.position.set(px, BH, pz);
        scene.add(mesh);
        dominoMeshes.push(mesh);

        const dbg = new THREE.LineSegments(edgesGeo, wireMat);
        dbg.position.copy(mesh.position);
        scene.add(dbg);
        debugMeshes.push(dbg);
    }
}

function createInitialStates() {
    const states = new Float32Array(COUNT * 8);
    for (let i = 0; i < COUNT; i++) {
        const col  = Math.floor(i / GRID);
        const row  = i % GRID;
        const base = i * 8;
        states[base + 0] = (col - (GRID - 1) * 0.5) * SPACING;   // base.x
        states[base + 1] = BH;                                      // base.y (unused by shader)
        states[base + 2] = ((GRID - 1) * 0.5 - row) * SPACING;    // base.z
        // first row starts already tilting
        states[base + 4] = row === 0 ? -0.18 : 0.0;  // motion.x = angle
        states[base + 5] = row === 0 ? -1.6  : 0.0;  // motion.y = angVel
        states[base + 6] = row === 0 ?  1.0  : 0.0;  // motion.z = phase
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

    stateBuffer = device.createBuffer({
        size:             initial.byteLength,
        usage:            GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
        mappedAtCreation: true,
    });
    new Float32Array(stateBuffer.getMappedRange()).set(initial);
    stateBuffer.unmap();

    readbackBuffer = device.createBuffer({
        size:  initial.byteLength,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });

    simParamsBuffer = device.createBuffer({
        size:  16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    computeBindGroup = device.createBindGroup({
        layout:  computePipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: stateBuffer } },
            { binding: 1, resource: { buffer: simParamsBuffer } },
        ],
    });
}

function updateMeshes(data) {
    // DominoState: [base.x, base.y, base.z, base.w,  motion.x(angle), ...]
    // Domino pivots around its bottom-back edge at world (base.x, 0, base.z - BD).
    // Centre of rotated domino = pivot + rotateX((0, BH, BD), angle).
    for (let i = 0; i < COUNT; i++) {
        const off   = i * 8;
        const bx    = data[off + 0];
        const bz    = data[off + 2];
        const angle = data[off + 4];

        const ry = BH * Math.cos(angle) - BD * Math.sin(angle);
        const rz = BH * Math.sin(angle) + BD * Math.cos(angle);

        dominoMeshes[i].position.set(bx, ry, bz - BD + rz);
        dominoMeshes[i].rotation.set(angle, 0, 0);
        debugMeshes[i].position.copy(dominoMeshes[i].position);
        debugMeshes[i].rotation.copy(dominoMeshes[i].rotation);
    }
}

function animate(timeMs) {
    if (lastTime < 0) lastTime = timeMs;
    const dt = Math.min((timeMs - lastTime) / 1000, 1 / 30);
    lastTime = timeMs;

    device.queue.writeBuffer(simParamsBuffer, 0, new Float32Array([
        dt / SUBSTEPS, 9.81, 0.992, 0,
    ]));

    const encoder = device.createCommandEncoder();
    for (let s = 0; s < SUBSTEPS; s++) {
        const cp = encoder.beginComputePass();
        cp.setPipeline(computePipeline);
        cp.setBindGroup(0, computeBindGroup);
        cp.dispatchWorkgroups(Math.ceil(COUNT / 64));
        cp.end();
    }
    if (!readbackBusy) {
        encoder.copyBufferToBuffer(stateBuffer, 0, readbackBuffer, 0, stateBuffer.size);
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
    renderer.setClearColor(0x14171A);
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.getElementById('container').appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 5, 0);
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
