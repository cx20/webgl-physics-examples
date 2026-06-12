import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { HDRCubeTextureLoader } from 'three/addons/loaders/HDRCubeTextureLoader.js';

const FLOOR_BUMP_FILE = '../../../../assets/textures/floor_bump.png';
const ROCKN_FILE      = '../../../../assets/textures/rockn.png';

const MAX_COINS      = 8192;
const SUBSTEPS       = 4;
const GROUND_Y       = -10.0;
const STATE_FLOATS   = 16;
const INFO_FLOATS    = 12;

const GRID_X = 64, GRID_Y = 64, GRID_Z = 64;
const CELL_CAPACITY = 8;
const GRID_SLOTS = GRID_X * GRID_Y * GRID_Z * (CELL_CAPACITY + 1);

const SLEEP_Y = GROUND_Y - 30;

const COIN_TYPES = [
    { color: [1.000, 0.766, 0.336], radius: 0.80,  halfHeight: 0.075, restitution: 0.28, friction: 0.84, metallic: 1.0, roughness: 0.2 },
    { color: [0.972, 0.960, 0.915], radius: 0.76,  halfHeight: 0.071, restitution: 0.24, friction: 0.82, metallic: 1.0, roughness: 0.4 },
    { color: [0.955, 0.637, 0.538], radius: 0.72,  halfHeight: 0.067, restitution: 0.26, friction: 0.83, metallic: 1.0, roughness: 0.2 },
];

// PCG hash: matches the WGSL shader so coin types are assigned consistently.
function pcgHash(v) {
    const state = (Math.imul(v >>> 0, 747796405) + 2891336453) >>> 0;
    const word  = Math.imul(((state >>> ((state >>> 28) + 4)) ^ state) >>> 0, 277803737) >>> 0;
    return ((word >>> 22) ^ word) >>> 0;
}
function randomFromIndex(index) {
    return pcgHash(index) / 4294967296;
}

let showWireframe = true;
let scene, camera, renderer, controls;
let device;
let stateBuffers = [], coinInfoBuffer, simParamsBuffer, readbackBuffer, gridBuffer;
let computePipeline, clearGridPipeline, buildGridPipeline;
let computeBindGroups = [], clearGridBindGroup, buildGridBindGroups = [];
let currentState = 0;
const coinMeshes   = [];   // InstancedMesh per coin type
let   groundDebug;
let   readbackBusy = false;
let   lastTime     = -1;
let   simStartTime = -1;

// Per-coin mapping: { typeIdx, instIdx }
const coinMeshInfo = new Array(MAX_COINS);
// Per-type index lists (coin indices per type)
const typeGroups   = [[], [], []];

const _pos   = new THREE.Vector3();
const _quat  = new THREE.Quaternion();
const _scale = new THREE.Vector3(1, 1, 1);
const _mat   = new THREE.Matrix4();

function buildCoinGroups() {
    for (let i = 0; i < MAX_COINS; i++) {
        const typeIdx = Math.min(COIN_TYPES.length - 1, Math.floor(randomFromIndex(i) * COIN_TYPES.length));
        const instIdx = typeGroups[typeIdx].length;
        typeGroups[typeIdx].push(i);
        coinMeshInfo[i] = { typeIdx, instIdx };
    }
}

async function initScene() {
    buildCoinGroups();

    scene  = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 150);
    // Camera matches the WebGPU version: alpha=-PI/6, beta=76deg, radius=50, target=(0,-8,0)
    camera.position.set(42, 4, -24);

    const dir = new THREE.DirectionalLight(0xffffff, 1.5);
    dir.position.set(0.55, 0.9, 0.35).normalize();
    scene.add(dir);
    scene.add(new THREE.AmbientLight(0x404040));

    // Ground box
    const groundGeo  = new THREE.BoxGeometry(26, 1, 26);
    const groundMesh = new THREE.Mesh(groundGeo, new THREE.MeshLambertMaterial({ color: 0x757880 }));
    groundMesh.position.set(0, -10.5, 0);
    scene.add(groundMesh);

    groundDebug = new THREE.LineSegments(
        new THREE.EdgesGeometry(groundGeo),
        new THREE.LineBasicMaterial({ color: 0x44ee88 })
    );
    groundDebug.position.copy(groundMesh.position);
    scene.add(groundDebug);

    // Load textures for coin materials (normal maps).
    const texLoader = new THREE.TextureLoader();
    const [floorTex, rockTex] = await Promise.all([
        new Promise(res => texLoader.load(FLOOR_BUMP_FILE, res)),
        new Promise(res => texLoader.load(ROCKN_FILE, res)),
    ]);
    floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
    rockTex.wrapS  = rockTex.wrapT  = THREE.RepeatWrapping;

    const offMat = new THREE.Matrix4().makeTranslation(0, -10000, 0);

    for (let t = 0; t < COIN_TYPES.length; t++) {
        const type     = COIN_TYPES[t];
        const colorHex = Math.round(type.color[0] * 255) * 0x10000 +
                         Math.round(type.color[1] * 255) * 0x100   +
                         Math.round(type.color[2] * 255);
        const faceMat  = new THREE.MeshStandardMaterial({
            color: colorHex, metalness: type.metallic, roughness: type.roughness, normalMap: floorTex,
        });
        const sideMat  = new THREE.MeshStandardMaterial({
            color: colorHex, metalness: type.metallic, roughness: type.roughness, normalMap: rockTex,
        });
        const geo  = new THREE.CylinderGeometry(type.radius, type.radius, type.halfHeight * 2, 32, 1, false);
        const mesh = new THREE.InstancedMesh(geo, [sideMat, faceMat, faceMat], typeGroups[t].length);
        mesh.frustumCulled = false;
        // Park all instances off-screen until physics readback arrives.
        for (let j = 0; j < typeGroups[t].length; j++) mesh.setMatrixAt(j, offMat);
        mesh.instanceMatrix.needsUpdate = true;
        scene.add(mesh);
        coinMeshes.push(mesh);
    }
}

function createInitialStates() {
    const states = new Float32Array(MAX_COINS * STATE_FLOATS);
    for (let coin = 0; coin < MAX_COINS; coin++) {
        const seed = ((coin * 37) % 101) / 101;
        const base = coin * STATE_FLOATS;
        states[base + 1]  = -1000 - coin * 0.01; // y: parked below floor
        states[base + 3]  = seed;                 // position.w = seed
        states[base + 11] = 1;                    // rotation.w = 1 (identity quat)
    }
    return states;
}

function createCoinInfos() {
    const infos = new Float32Array(MAX_COINS * INFO_FLOATS);
    for (let coin = 0; coin < MAX_COINS; coin++) {
        const seed    = ((coin * 37) % 101) / 101;
        const typeIdx = Math.min(COIN_TYPES.length - 1, Math.floor(randomFromIndex(coin) * COIN_TYPES.length));
        const type    = COIN_TYPES[typeIdx];
        const base    = coin * INFO_FLOATS;
        infos[base + 0]  = type.radius;
        infos[base + 1]  = type.halfHeight;
        infos[base + 2]  = typeIdx;
        infos[base + 3]  = seed;
        infos[base + 4]  = type.restitution;
        infos[base + 5]  = type.friction;
        infos[base + 6]  = type.metallic;
        infos[base + 7]  = type.roughness;
        infos[base + 8]  = type.color[0];
        infos[base + 9]  = type.color[1];
        infos[base + 10] = type.color[2];
        infos[base + 11] = 1.0;
    }
    return infos;
}

function initPhysics() {
    const csCode    = document.getElementById('cs').textContent;
    const clearCode = document.getElementById('cs-clear').textContent;
    const buildCode = document.getElementById('cs-build').textContent;

    computePipeline   = device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code: csCode }),    entryPoint: 'main' } });
    clearGridPipeline = device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code: clearCode }), entryPoint: 'main' } });
    buildGridPipeline = device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code: buildCode }), entryPoint: 'main' } });

    const initial = createInitialStates();
    const bufSize = MAX_COINS * STATE_FLOATS * 4;
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
    simParamsBuffer = device.createBuffer({ size: 32,      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    gridBuffer      = device.createBuffer({ size: GRID_SLOTS * 4, usage: GPUBufferUsage.STORAGE });

    coinInfoBuffer = device.createBuffer({
        size: MAX_COINS * INFO_FLOATS * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        mappedAtCreation: true,
    });
    new Float32Array(coinInfoBuffer.getMappedRange()).set(createCoinInfos());
    coinInfoBuffer.unmap();

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
                { binding: 2, resource: { buffer: coinInfoBuffer } },
                { binding: 3, resource: { buffer: simParamsBuffer } },
                { binding: 4, resource: { buffer: gridBuffer } },
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

function updateCoins(data) {
    for (let i = 0; i < MAX_COINS; i++) {
        const off = i * STATE_FLOATS;
        const { typeIdx, instIdx } = coinMeshInfo[i];
        const y = data[off + 1];
        if (y < SLEEP_Y) {
            _mat.makeTranslation(0, -10000, 0);
        } else {
            _pos.set(data[off], y, data[off + 2]);
            _quat.set(data[off + 8], data[off + 9], data[off + 10], data[off + 11]);
            _mat.compose(_pos, _quat, _scale);
        }
        coinMeshes[typeIdx].setMatrixAt(instIdx, _mat);
    }
    for (const mesh of coinMeshes) mesh.instanceMatrix.needsUpdate = true;
}

function animate(timeMs) {
    if (lastTime < 0)     lastTime     = timeMs;
    if (simStartTime < 0) simStartTime = timeMs;
    const dt   = Math.min((timeMs - lastTime) / 1000, 1 / 30);
    lastTime   = timeMs;
    const time = (timeMs - simStartTime) / 1000;

    device.queue.writeBuffer(simParamsBuffer, 0, new Float32Array([
        dt / SUBSTEPS, 9.81, GROUND_Y, 0.9992,
        0.999, 0.2, 0.98, time,
    ]));

    const encoder        = device.createCommandEncoder();
    const coinWorkgroups = Math.ceil(MAX_COINS / 64);
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
        buildPass.dispatchWorkgroups(coinWorkgroups);
        buildPass.end();

        const cp = encoder.beginComputePass();
        cp.setPipeline(computePipeline);
        cp.setBindGroup(0, computeBindGroups[currentState]);
        cp.dispatchWorkgroups(coinWorkgroups);
        cp.end();
        currentState = 1 - currentState;
    }
    if (!readbackBusy) {
        encoder.copyBufferToBuffer(stateBuffers[currentState], 0, readbackBuffer, 0, MAX_COINS * STATE_FLOATS * 4);
    }
    device.queue.submit([encoder.finish()]);

    if (!readbackBusy) {
        readbackBusy = true;
        readbackBuffer.mapAsync(GPUMapMode.READ).then(() => {
            const data = new Float32Array(readbackBuffer.getMappedRange().slice(0));
            readbackBuffer.unmap();
            updateCoins(data);
            readbackBusy = false;
        }).catch(() => { readbackBusy = false; });
    }

    controls.update();
    renderer.render(scene, camera);
}

function setWireframeVisible(visible) {
    showWireframe = visible;
    if (groundDebug) groundDebug.visible = visible;
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

    scene.background = new THREE.Color(0x1a1a1f);

    renderer = new THREE.WebGPURenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.getElementById('container').appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, -8, 0);

    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });

    await renderer.init();
    device = renderer.backend.device;

    const BASE_HDR = 'https://cx20.github.io/gltf-test/textures/papermill_hdr/specular/';
    new HDRCubeTextureLoader().load(
        ['specular_posx_0.hdr', 'specular_negx_0.hdr',
         'specular_posy_0.hdr', 'specular_negy_0.hdr',
         'specular_posz_0.hdr', 'specular_negz_0.hdr'].map(f => BASE_HDR + f),
        (hdrCubeMap) => {
            hdrCubeMap.mapping = THREE.CubeReflectionMapping;
            const pmrem = new THREE.PMREMGenerator(renderer);
            pmrem.compileCubemapShader();
            scene.environment = pmrem.fromCubemap(hdrCubeMap).texture;
            scene.background  = hdrCubeMap;
            pmrem.dispose();
        }
    );

    initPhysics();
    setWireframeVisible(showWireframe);
    renderer.setAnimationLoop(animate);
}

main().catch(console.error);
