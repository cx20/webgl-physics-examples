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

const COUNT        = 256;
const RADIUS       = 0.5;
const GROUND_Y     = -2.0;
const GROUND_HALF  = 15.0;
const SUBSTEPS     = 5;
const RESTITUTION  = 0.68;
const FRICTION     = 0.02;
const LINEAR_DAMPING = 0.999;

const GRID_X = 64, GRID_Y = 64, GRID_Z = 64;
const CELL_CAPACITY = 12;
const GRID_SLOTS = GRID_X * GRID_Y * GRID_Z * (CELL_CAPACITY + 1);

let showWireframe = true;
let scene, camera, renderer, controls;
let device;
let stateBuffers = [], gridBuffer, simParamsBuffer, readbackBuffer;
let computePipeline, clearGridPipeline, buildGridPipeline;
let computeBindGroups = [], buildGridBindGroups = [];
let clearGridBindGroup;
let currentState = 0;
const ballMeshes  = [];
const debugMeshes = [];
let groundMesh, groundDebug;
let readbackBusy = false;
let lastTime = -1;

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

async function initScene() {
    scene  = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 150);
    camera.position.set(0, 10, 20);

    const dir = new THREE.DirectionalLight(0xffffff, 1.5);
    dir.position.set(0.55, 0.9, 0.35).normalize();
    scene.add(dir);
    scene.add(new THREE.AmbientLight(0x404040));

    const loader = new THREE.TextureLoader();
    const footballTex = await new Promise(res => loader.load('../../../../assets/textures/Football.jpg', res));
    footballTex.wrapS = footballTex.wrapT = THREE.RepeatWrapping;

    const grassTex = await new Promise(res => loader.load('../../../../assets/textures/grass.jpg', res));
    grassTex.wrapS = grassTex.wrapT = THREE.RepeatWrapping;
    grassTex.repeat.set(6, 6);

    const groundGeo = new THREE.PlaneGeometry(30, 30);
    groundMesh = new THREE.Mesh(
        groundGeo,
        new THREE.MeshLambertMaterial({ color: 0x5B8C5A, map: grassTex })
    );
    groundMesh.rotation.x = -Math.PI / 2;
    groundMesh.position.y = GROUND_Y;
    scene.add(groundMesh);

    groundDebug = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.PlaneGeometry(30, 30)),
        new THREE.LineBasicMaterial({ color: 0x44ee88 })
    );
    groundDebug.rotation.x = -Math.PI / 2;
    groundDebug.position.y = GROUND_Y;
    scene.add(groundDebug);

    const sphereGeo = new THREE.SphereGeometry(RADIUS, 20, 12);
    const wireGeo   = makeSphereWireGeo();
    const wireMat   = new THREE.LineBasicMaterial({ color: 0x1aff55 });

    const paletteMats = {};
    for (const [key, hex] of Object.entries(palette)) {
        paletteMats[key] = new THREE.MeshLambertMaterial({ color: hex, map: footballTex });
    }

    let i = 0;
    for (const row of ROWS) {
        for (const ch of row) {
            const seed = ((Math.floor(i / 16) * 17 + (i % 16) * 31) % 97) / 97;
            const px   = -10 + (i % 16) * 1.5 + seed * 0.08;
            const py   =  4 + (ROWS.length - 1 - Math.floor(i / 16)) * 1.2 + seed * 0.08;
            const pz   = seed * 0.12;

            const mesh = new THREE.Mesh(sphereGeo, paletteMats[ch]);
            mesh.position.set(px, py, pz);
            scene.add(mesh);
            ballMeshes.push(mesh);

            const dbg = new THREE.LineSegments(wireGeo, wireMat);
            dbg.position.copy(mesh.position);
            dbg.scale.setScalar(RADIUS);
            scene.add(dbg);
            debugMeshes.push(dbg);
            i++;
        }
    }
}

function createInitialStates() {
    const states = new Float32Array(COUNT * 16);
    let i = 0;
    for (let rowIndex = 0; rowIndex < ROWS.length; rowIndex++) {
        const row = ROWS[rowIndex];
        for (let col = 0; col < row.length; col++) {
            const base = i * 16;
            const seed = ((col * 17 + rowIndex * 31) % 97) / 97;
            states[base + 0] = -10 + col * 1.5 + seed * 0.08;
            states[base + 1] =  4  + (ROWS.length - 1 - rowIndex) * 1.2 + seed * 0.08;
            states[base + 2] = seed * 0.12;
            states[base + 3] = seed;
            states[base + 4] = ((col % 3) - 1) * 0.035;
            states[base + 5] = -0.05;
            states[base + 6] = ((rowIndex % 3) - 1) * 0.03;
            states[base + 8] = 0; states[base + 9] = 0; states[base + 10] = 0; states[base + 11] = 1;
            states[base + 12] = seed * 0.6;
            states[base + 13] = seed * 0.3;
            states[base + 14] = -seed * 0.4;
            i++;
        }
    }
    return states;
}

function initPhysics() {
    const cellSize = Math.max(1.2, RADIUS * 2 * 1.15).toFixed(4);
    const csCode   = document.getElementById('cs').textContent.replaceAll('__CELL_SIZE__', cellSize);
    const buildCode = document.getElementById('cs-build').textContent.replaceAll('__CELL_SIZE__', cellSize);
    const clearCode = document.getElementById('cs-clear').textContent;

    computePipeline   = device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code: csCode }),    entryPoint: 'main' } });
    clearGridPipeline = device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code: clearCode }), entryPoint: 'main' } });
    buildGridPipeline = device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code: buildCode }), entryPoint: 'main' } });

    const initial = createInitialStates();
    const bufSize = COUNT * 16 * 4;
    for (let i = 0; i < 2; i++) {
        const buf = device.createBuffer({
            size: bufSize, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
            mappedAtCreation: true,
        });
        new Float32Array(buf.getMappedRange()).set(initial);
        buf.unmap();
        stateBuffers.push(buf);
    }

    readbackBuffer  = device.createBuffer({ size: bufSize, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    simParamsBuffer = device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    gridBuffer      = device.createBuffer({ size: GRID_SLOTS * 4, usage: GPUBufferUsage.STORAGE });

    clearGridBindGroup = device.createBindGroup({
        layout:  clearGridPipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: gridBuffer } }],
    });

    for (let i = 0; i < 2; i++) {
        computeBindGroups.push(device.createBindGroup({
            layout:  computePipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: stateBuffers[i] } },
                { binding: 1, resource: { buffer: stateBuffers[1 - i] } },
                { binding: 2, resource: { buffer: simParamsBuffer } },
                { binding: 3, resource: { buffer: gridBuffer } },
            ],
        }));
        buildGridBindGroups.push(device.createBindGroup({
            layout:  buildGridPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: stateBuffers[i] } },
                { binding: 1, resource: { buffer: gridBuffer } },
            ],
        }));
    }
}

function updateMeshes(data) {
    for (let i = 0; i < COUNT; i++) {
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
        dt / SUBSTEPS, 9.8, GROUND_Y, RESTITUTION,
        LINEAR_DAMPING, FRICTION, RADIUS, timeMs * 0.001,
        GROUND_HALF, 0, 0, 0,
    ]));

    const encoder        = device.createCommandEncoder();
    const ballWorkgroups = Math.ceil(COUNT / 64);
    const gridWorkgroups = Math.ceil(GRID_SLOTS / 64);

    for (let s = 0; s < SUBSTEPS; s++) {
        const clearPass = encoder.beginComputePass();
        clearPass.setPipeline(clearGridPipeline);
        clearPass.setBindGroup(0, clearGridBindGroup);
        clearPass.dispatchWorkgroups(gridWorkgroups);
        clearPass.end();

        const buildPass = encoder.beginComputePass();
        buildPass.setPipeline(buildGridPipeline);
        buildPass.setBindGroup(0, buildGridBindGroups[currentState]);
        buildPass.dispatchWorkgroups(ballWorkgroups);
        buildPass.end();

        const cp = encoder.beginComputePass();
        cp.setPipeline(computePipeline);
        cp.setBindGroup(0, computeBindGroups[currentState]);
        cp.dispatchWorkgroups(ballWorkgroups);
        cp.end();
        currentState = 1 - currentState;
    }

    if (!readbackBusy) {
        encoder.copyBufferToBuffer(stateBuffers[currentState], 0, readbackBuffer, 0, COUNT * 16 * 4);
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
    renderer.setClearColor(0xF7F7FA);
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.getElementById('container').appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 8, 0);
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
