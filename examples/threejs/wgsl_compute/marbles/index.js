import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const MARBLES_GLTF_URL   = 'https://cx20.github.io/gltf-test/tutorialModels/IridescenceMetallicSpheres/glTF/IridescenceMetallicSpheres.gltf';
const GROUND_TEXTURE_FILE = '../../../../assets/textures/grass.jpg';
const MARBLE_COUNT  = 1500;
const SUBSTEPS      = 2;
const GROUND_Y      = -3.0;
const GROUND_HALF   = 40.0;
const SPAWN_RANGE   = 8.5;
const SPAWN_HEIGHT  = 7.0;
let   marbleBaseRadius = 0.5;

const GRID_X = 64, GRID_Y = 64, GRID_Z = 64;
const CELL_CAPACITY = 12;
const GRID_SLOTS = GRID_X * GRID_Y * GRID_Z * (CELL_CAPACITY + 1);

let showWireframe = true;
let scene, camera, renderer, controls;
let device;
let stateBuffers = [], marbleInfoBuffer, simParamsBuffer, readbackBuffer, gridBuffer;
let computePipeline, clearGridPipeline, buildGridPipeline;
let computeBindGroups = [], clearGridBindGroup, buildGridBindGroups = [];
let currentState = 0;
const marbleMeshes = [];
const debugMeshes  = [];
let groundDebug;
let readbackBusy = false;
let lastTime = -1;

// Marble radii needed to scale wire spheres on first updateMeshes call.
const marbleRadii = new Float32Array(MARBLE_COUNT);

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
    camera.position.set(0, 10, 22);

    const dir = new THREE.DirectionalLight(0xffffff, 1.5);
    dir.position.set(0.55, 0.9, 0.35).normalize();
    scene.add(dir);
    scene.add(new THREE.AmbientLight(0x404040));

    // Ground
    const texLoader = new THREE.TextureLoader();
    const grassTex  = await new Promise(res => texLoader.load(GROUND_TEXTURE_FILE, res));
    grassTex.wrapS = grassTex.wrapT = THREE.RepeatWrapping;
    grassTex.repeat.set(8, 8);

    const groundGeo  = new THREE.BoxGeometry(80, 2, 80);
    const groundMesh = new THREE.Mesh(groundGeo, new THREE.MeshLambertMaterial({ color: 0xddddcc, map: grassTex }));
    groundMesh.position.set(0, GROUND_Y - 1, 0);
    scene.add(groundMesh);

    groundDebug = new THREE.LineSegments(
        new THREE.EdgesGeometry(groundGeo),
        new THREE.LineBasicMaterial({ color: 0x44ee88 })
    );
    groundDebug.position.copy(groundMesh.position);
    scene.add(groundDebug);

    // Load marble materials from glTF; fall back to basic coloured materials.
    let materials = [];
    try {
        const gltf = await new Promise((res, rej) => new GLTFLoader().load(MARBLES_GLTF_URL, res, undefined, rej));
        const seen  = new Set();
        gltf.scene.traverse(obj => {
            if (obj.isMesh && !seen.has(obj.material.uuid)) {
                seen.add(obj.material.uuid);
                materials.push(obj.material);
            }
        });
        // Estimate marbleBaseRadius from first sphere mesh in scene graph.
        let firstMesh = null;
        gltf.scene.traverse(obj => { if (obj.isMesh && !firstMesh) firstMesh = obj; });
        if (firstMesh) {
            firstMesh.geometry.computeBoundingSphere();
            const ws = new THREE.Vector3();
            firstMesh.getWorldScale(ws);
            const r = firstMesh.geometry.boundingSphere.radius * Math.max(ws.x, ws.y, ws.z);
            if (r > 0.01 && r < 10) marbleBaseRadius = r;
        }
    } catch (err) {
        console.warn('Marble glTF load failed; using fallback materials.', err);
    }
    if (!materials.length) {
        const colors = [0xcc4444, 0x4444cc, 0x44cc44, 0xcccc44, 0xcc44cc, 0x44cccc, 0xaaaaaa, 0xffffff];
        for (const c of colors) {
            materials.push(new THREE.MeshPhysicalMaterial({ color: c, metalness: 0.8, roughness: 0.2, iridescence: 0.8 }));
        }
    }

    const sphereGeo = new THREE.SphereGeometry(1, 20, 12);
    const wireGeo   = makeSphereWireGeo();
    const wireMat   = new THREE.LineBasicMaterial({ color: 0xffff00 });

    for (let i = 0; i < MARBLE_COUNT; i++) {
        const seed   = ((i * 37) % 101) / 101;
        const radius = marbleBaseRadius * (0.9 + seed * 0.25);
        marbleRadii[i] = radius;
        const col = i % 12;
        const row = Math.floor(i / 12);
        const px  = (col - 5.5) * 0.88 + (seed - 0.5) * 0.8;
        const py  = SPAWN_HEIGHT + row * 0.38 + seed * 3;
        const pz  = Math.sin(seed * Math.PI * 10 + i * 0.19) * SPAWN_RANGE;

        const mesh = new THREE.Mesh(sphereGeo, materials[i % materials.length]);
        mesh.scale.setScalar(radius);
        mesh.position.set(px, py, pz);
        scene.add(mesh);
        marbleMeshes.push(mesh);

        const dbg = new THREE.LineSegments(wireGeo, wireMat);
        dbg.scale.setScalar(radius);
        dbg.position.set(px, py, pz);
        scene.add(dbg);
        debugMeshes.push(dbg);
    }
}

function createInitialStates() {
    const states = new Float32Array(MARBLE_COUNT * 16);
    for (let i = 0; i < MARBLE_COUNT; i++) {
        const seed = ((i * 37) % 101) / 101;
        const col  = i % 12;
        const row  = Math.floor(i / 12);
        const base = i * 16;
        states[base + 0]  = (col - 5.5) * 0.88 + (seed - 0.5) * 0.8;
        states[base + 1]  = SPAWN_HEIGHT + row * 0.38 + seed * 3;
        states[base + 2]  = Math.sin(seed * Math.PI * 10 + i * 0.19) * SPAWN_RANGE;
        states[base + 3]  = seed;
        states[base + 4]  = (seed - 0.5) * 0.45;
        states[base + 5]  = -0.05;
        states[base + 6]  = (0.5 - seed) * 0.45;
        states[base + 8]  = 0; states[base + 9]  = 0; states[base + 10] = 0; states[base + 11] = 1;
        states[base + 12] = seed * 0.5; states[base + 13] = seed * 0.25; states[base + 14] = -seed * 0.4;
    }
    return states;
}

function createMarbleInfos() {
    const infos = new Float32Array(MARBLE_COUNT * 4);
    for (let i = 0; i < MARBLE_COUNT; i++) {
        const seed = ((i * 37) % 101) / 101;
        const base = i * 4;
        infos[base + 0] = marbleBaseRadius * (0.9 + seed * 0.25); // radius
        infos[base + 1] = i % 8;                                   // renderScale slot (unused by CS)
        infos[base + 2] = 0.46 + seed * 0.14;                     // restitution
        infos[base + 3] = 0.006 + seed * 0.006;                   // friction
    }
    return infos;
}

function initPhysics() {
    const maxMarbleRadius = marbleBaseRadius * 1.15;
    const cellSize = Math.max(1.2, maxMarbleRadius * 2 * 1.15).toFixed(4);
    const csCode    = document.getElementById('cs').textContent
        .replaceAll('__COUNT__', MARBLE_COUNT + 'u')
        .replaceAll('__CELL_SIZE__', cellSize);
    const buildCode = document.getElementById('cs-build').textContent
        .replaceAll('__CELL_SIZE__', cellSize);
    const clearCode = document.getElementById('cs-clear').textContent;

    computePipeline   = device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code: csCode }),    entryPoint: 'main' } });
    clearGridPipeline = device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code: clearCode }), entryPoint: 'main' } });
    buildGridPipeline = device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code: buildCode }), entryPoint: 'main' } });

    const initial = createInitialStates();
    const bufSize = MARBLE_COUNT * 16 * 4;
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

    marbleInfoBuffer = device.createBuffer({
        size: MARBLE_COUNT * 4 * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        mappedAtCreation: true,
    });
    new Float32Array(marbleInfoBuffer.getMappedRange()).set(createMarbleInfos());
    marbleInfoBuffer.unmap();

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
                { binding: 2, resource: { buffer: marbleInfoBuffer } },
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

function updateMeshes(data) {
    for (let i = 0; i < MARBLE_COUNT; i++) {
        const off = i * 16;
        marbleMeshes[i].position.set(data[off], data[off + 1], data[off + 2]);
        marbleMeshes[i].quaternion.set(data[off + 8], data[off + 9], data[off + 10], data[off + 11]);
        debugMeshes[i].position.copy(marbleMeshes[i].position);
        debugMeshes[i].quaternion.copy(marbleMeshes[i].quaternion);
    }
}

function animate(timeMs) {
    if (lastTime < 0) lastTime = timeMs;
    const dt = Math.min((timeMs - lastTime) / 1000, 1 / 30);
    lastTime = timeMs;

    device.queue.writeBuffer(simParamsBuffer, 0, new Float32Array([
        dt / SUBSTEPS, 9.8, GROUND_Y, 0.998,
        timeMs * 0.001, GROUND_HALF, SPAWN_RANGE, SPAWN_HEIGHT,
    ]));

    const encoder        = device.createCommandEncoder();
    const marbWorkgroups = Math.ceil(MARBLE_COUNT / 64);
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
        buildPass.dispatchWorkgroups(marbWorkgroups);
        buildPass.end();

        const cp = encoder.beginComputePass();
        cp.setPipeline(computePipeline);
        cp.setBindGroup(0, computeBindGroups[currentState]);
        cp.dispatchWorkgroups(marbWorkgroups);
        cp.end();
        currentState = 1 - currentState;
    }
    if (!readbackBusy) {
        encoder.copyBufferToBuffer(stateBuffers[currentState], 0, readbackBuffer, 0, MARBLE_COUNT * 16 * 4);
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
    controls.target.set(0, 2.5, 0);
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
