import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const CONE_TEXTURE = '../../../../assets/textures/carrot.jpg';
const CONE_COUNT = 160;
const STATE_FLOATS = 16;
const INFO_FLOATS = 4;
const SUBSTEPS = 4;
const BASKET_HALF = 3.0;
const BASKET_TOP = 4.0;
const GROUND_Y = -1.0;
const GROUND_HALF = 10.0;
const CONE_RADIUS_RATIO = 0.25;

const staticData = [
    { pos: [0, -2, 0],      scale: [20, 2, 20],   color: 0x383839 },
    { pos: [0, 1.53, -3.25], scale: [6.2, 5, 0.5], color: 0x404749 },
    { pos: [0, 1.53,  3.25], scale: [6.2, 5, 0.5], color: 0x404749 },
    { pos: [-3.25, 1.53, 0], scale: [0.5, 5, 6.2], color: 0x404749 },
    { pos: [ 3.25, 1.53, 0], scale: [0.5, 5, 6.2], color: 0x404749 },
];

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
    const states = new Float32Array(CONE_COUNT * STATE_FLOATS);
    for (let i = 0; i < CONE_COUNT; i++) {
        const seed = ((i * 37) % 101) / 101;
        const base = i * STATE_FLOATS;
        const col = i % 16;
        const row = Math.floor(i / 16);
        const angle = seed * Math.PI * 2 + i * 0.37;
        const rotation = quatFromEuler((seed - 0.5) * 2.4, angle, (0.5 - seed) * 2.0);
        states[base + 0] = (col - 7.5) * 0.28 + Math.cos(angle) * 0.2;
        states[base + 1] = 6 + row * 0.55 + seed * 8;
        states[base + 2] = Math.sin(angle * 1.7) * BASKET_HALF * 0.7;
        states[base + 3] = seed;
        states[base + 4] = (seed - 0.5) * 0.12;
        states[base + 5] = -0.05;
        states[base + 6] = (0.5 - seed) * 0.12;
        states.set(rotation, base + 8);
        states[base + 12] = seed * 0.7;
        states[base + 13] = seed * 0.3;
        states[base + 14] = -seed * 0.6;
    }
    return states;
}

function createConeInfos() {
    const infos = new Float32Array(CONE_COUNT * INFO_FLOATS);
    for (let i = 0; i < CONE_COUNT; i++) {
        const base = i * INFO_FLOATS;
        const height = 1.2 + (((i * 17) % 101) / 101) * 1.0;
        infos[base + 0] = height * CONE_RADIUS_RATIO;
        infos[base + 1] = height;
        infos[base + 2] = 0.1;
        infos[base + 3] = 0.055;
    }
    return infos;
}

let showWireframe = true;
let scene, camera, renderer, controls;
let device;
let stateBuffers = [], coneInfoBuffer, simParamsBuffer, readbackBuffer;
let computePipeline, computeBindGroups = [];
let currentState = 0;
const coneMeshes = [];
const debugMeshes = [];
const staticMeshes = [];
const staticWireMeshes = [];
let readbackBusy = false;
let lastTime = -1;

async function initScene() {
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 150);
    camera.position.set(24, 12, 0);

    const dir = new THREE.DirectionalLight(0xffffff, 1.5);
    dir.position.set(0.55, 0.9, 0.35).normalize();
    scene.add(dir);
    scene.add(new THREE.AmbientLight(0x404040));

    // Static objects
    for (const d of staticData) {
        const geo = new THREE.BoxGeometry(...d.scale);
        const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: d.color }));
        mesh.position.set(...d.pos);
        scene.add(mesh);
        staticMeshes.push(mesh);

        const wgeo = new THREE.EdgesGeometry(geo);
        const wmesh = new THREE.LineSegments(wgeo, new THREE.LineBasicMaterial({ color: 0x44ee88 }));
        wmesh.position.set(...d.pos);
        scene.add(wmesh);
        staticWireMeshes.push(wmesh);
    }

    const texLoader = new THREE.TextureLoader();
    const carrotTex = await new Promise(res => texLoader.load(CONE_TEXTURE, res));
    carrotTex.wrapS = carrotTex.wrapT = THREE.RepeatWrapping;

    const coneInfos = createConeInfos();
    // Unit cone: height=1, radiusBottom=1 — scale per mesh by (radius, height, radius)
    const unitGeo = new THREE.ConeGeometry(1, 1, 32);
    const mat = new THREE.MeshLambertMaterial({ map: carrotTex });

    // Unit wire cone outline for wireframe
    const wireGeo = buildConeWireGeo(16);
    const wireMat = new THREE.LineBasicMaterial({ color: 0xffff00 });

    const initial = createInitialStates();
    for (let i = 0; i < CONE_COUNT; i++) {
        const base = i * STATE_FLOATS;
        const infoBase = i * INFO_FLOATS;
        const radius = coneInfos[infoBase];
        const height = coneInfos[infoBase + 1];

        const mesh = new THREE.Mesh(unitGeo, mat);
        mesh.scale.set(radius, height, radius);
        mesh.position.set(initial[base], initial[base + 1], initial[base + 2]);
        mesh.quaternion.set(initial[base + 8], initial[base + 9], initial[base + 10], initial[base + 11]);
        scene.add(mesh);
        coneMeshes.push(mesh);

        const dbg = new THREE.LineSegments(wireGeo, wireMat);
        dbg.scale.set(radius, height, radius);
        dbg.position.copy(mesh.position);
        dbg.quaternion.copy(mesh.quaternion);
        scene.add(dbg);
        debugMeshes.push(dbg);
    }
}

function buildConeWireGeo(segments) {
    const pts = [];
    for (let i = 0; i < segments; i++) {
        const a0 = (i / segments) * Math.PI * 2;
        const a1 = ((i + 1) / segments) * Math.PI * 2;
        pts.push(Math.cos(a0), -0.5, Math.sin(a0));
        pts.push(Math.cos(a1), -0.5, Math.sin(a1));
    }
    for (let i = 0; i < segments; i += 2) {
        const a = (i / segments) * Math.PI * 2;
        pts.push(Math.cos(a), -0.5, Math.sin(a));
        pts.push(0, 0.5, 0);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    return geo;
}

function initPhysics() {
    const csCode = document.getElementById('cs').textContent;
    computePipeline = device.createComputePipeline({
        layout: 'auto',
        compute: { module: device.createShaderModule({ code: csCode }), entryPoint: 'main' },
    });

    const initial = createInitialStates();
    const bufSize = CONE_COUNT * STATE_FLOATS * 4;
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

    coneInfoBuffer = device.createBuffer({
        size: CONE_COUNT * INFO_FLOATS * 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        mappedAtCreation: true,
    });
    new Float32Array(coneInfoBuffer.getMappedRange()).set(createConeInfos());
    coneInfoBuffer.unmap();

    readbackBuffer = device.createBuffer({ size: bufSize, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    simParamsBuffer = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    for (let i = 0; i < 2; i++) {
        computeBindGroups.push(device.createBindGroup({
            layout: computePipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: stateBuffers[i] } },
                { binding: 1, resource: { buffer: stateBuffers[1 - i] } },
                { binding: 2, resource: { buffer: coneInfoBuffer } },
                { binding: 3, resource: { buffer: simParamsBuffer } },
            ],
        }));
    }
}

function updateMeshes(data) {
    for (let i = 0; i < CONE_COUNT; i++) {
        const off = i * STATE_FLOATS;
        coneMeshes[i].position.set(data[off], data[off + 1], data[off + 2]);
        coneMeshes[i].quaternion.set(data[off + 8], data[off + 9], data[off + 10], data[off + 11]);
        debugMeshes[i].position.copy(coneMeshes[i].position);
        debugMeshes[i].quaternion.copy(coneMeshes[i].quaternion);
    }
}

function animate(timeMs) {
    if (lastTime < 0) lastTime = timeMs;
    const dt = Math.min((timeMs - lastTime) / 1000, 1 / 30);
    lastTime = timeMs;

    device.queue.writeBuffer(simParamsBuffer, 0, new Float32Array([
        dt / SUBSTEPS, 9.8, GROUND_Y, BASKET_HALF, BASKET_TOP, 0.998, timeMs * 0.001, GROUND_HALF,
    ]));

    const encoder = device.createCommandEncoder();
    for (let s = 0; s < SUBSTEPS; s++) {
        const pass = encoder.beginComputePass();
        pass.setPipeline(computePipeline);
        pass.setBindGroup(0, computeBindGroups[currentState]);
        pass.dispatchWorkgroups(Math.ceil(CONE_COUNT / 64));
        pass.end();
        currentState = 1 - currentState;
    }
    if (!readbackBusy) {
        encoder.copyBufferToBuffer(stateBuffers[currentState], 0, readbackBuffer, 0, CONE_COUNT * STATE_FLOATS * 4);
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
    for (const dbg of debugMeshes) dbg.visible = visible;
    for (const wm of staticWireMeshes) wm.visible = visible;
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
    controls.target.set(0, 3, 0);
    controls.autoRotate = true;
    controls.autoRotateSpeed = 1.0;

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
