import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const DUCK_GLTF_URL = 'https://rawcdn.githack.com/cx20/gltf-test/5465cc37/sampleModels/Duck/glTF/Duck.gltf';
const FALL_SCALE    = 5.0;
const GROUND_Y      = 0.0;
const SUBSTEPS      = 6;

let showWireframe = true;
let scene, camera, renderer, controls;
let device;
let stateBuffer, simParamsBuffer, readbackBuffer;
let computePipeline, computeBindGroup;
let duckGroup, wireMesh;
let duckHalfExtents = [1.0, 1.0, 1.0];
let readbackBusy = false;
let lastTime = -1;

async function initScene() {
    scene  = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 150);
    camera.position.set(0, 9, 20);

    const dir = new THREE.DirectionalLight(0xffffff, 1.5);
    dir.position.set(0.6, 1.0, 0.5).normalize();
    scene.add(dir);
    scene.add(new THREE.AmbientLight(0x404040));

    const groundGeo  = new THREE.PlaneGeometry(24, 24);
    const groundMesh = new THREE.Mesh(groundGeo, new THREE.MeshLambertMaterial({ color: 0x558855 }));
    groundMesh.rotation.x = -Math.PI / 2;
    groundMesh.position.y = GROUND_Y;
    scene.add(groundMesh);

    const gltf = await new Promise((res, rej) => new GLTFLoader().load(DUCK_GLTF_URL, res, undefined, rej));
    const duck = gltf.scene;
    duck.scale.setScalar(FALL_SCALE);

    duckGroup = new THREE.Group();
    duckGroup.add(duck);
    scene.add(duckGroup);

    // Centre duck so its AABB centre sits at the group origin (= physics centre of mass).
    duckGroup.updateMatrixWorld(true);
    const bbox   = new THREE.Box3().setFromObject(duckGroup);
    const centre = bbox.getCenter(new THREE.Vector3());
    duck.position.sub(centre);  // shift in local space (group has no transform yet)

    duckHalfExtents = [
        (bbox.max.x - bbox.min.x) * 0.5,
        (bbox.max.y - bbox.min.y) * 0.5,
        (bbox.max.z - bbox.min.z) * 0.5,
    ];

    const wireGeo = new THREE.EdgesGeometry(
        new THREE.BoxGeometry(duckHalfExtents[0] * 2, duckHalfExtents[1] * 2, duckHalfExtents[2] * 2)
    );
    wireMesh = new THREE.LineSegments(wireGeo, new THREE.LineBasicMaterial({ color: 0x00ff44 }));
    duckGroup.add(wireMesh);

    // Set initial physics pose (matches compute shader reset values).
    duckGroup.position.set(0, 12, 0);
    duckGroup.quaternion.set(0.15, 0.25, 0, 0.955).normalize();
}

function initPhysics() {
    const wgsl = document.getElementById('cs').textContent;
    computePipeline = device.createComputePipeline({
        layout:  'auto',
        compute: { module: device.createShaderModule({ code: wgsl }), entryPoint: 'main' },
    });

    stateBuffer = device.createBuffer({
        size: 64,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
        mappedAtCreation: true,
    });
    new Float32Array(stateBuffer.getMappedRange()).set([
        0, 12, 0, 0,            // position.xyz + pad
        0, 0, 0, 0,             // velocity.xyz + pad
        0.15, 0.25, 0, 0.955,   // rotation quat (xyzw)
        0.45, 0.7, 0.25, 0,     // angularVel.xyz + pad
    ]);
    stateBuffer.unmap();

    readbackBuffer  = device.createBuffer({ size: 64, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    simParamsBuffer = device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    computeBindGroup = device.createBindGroup({
        layout:  computePipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: stateBuffer } },
            { binding: 1, resource: { buffer: simParamsBuffer } },
        ],
    });
}

function animate(timeMs) {
    if (lastTime < 0) lastTime = timeMs;
    const dt = Math.min((timeMs - lastTime) / 1000, 1 / 30);
    lastTime = timeMs;

    const h = duckHalfExtents;
    const inertiaInv = 1.0 / Math.max(h[0] * h[0] + h[2] * h[2], 0.001);
    device.queue.writeBuffer(simParamsBuffer, 0, new Float32Array([
        dt / SUBSTEPS, 9.8, GROUND_Y, 0.22,
        h[0], h[1], h[2], 0.0,
        0.55, 1.0, inertiaInv, 0.0,
    ]));

    const encoder = device.createCommandEncoder();
    for (let s = 0; s < SUBSTEPS; s++) {
        const pass = encoder.beginComputePass();
        pass.setPipeline(computePipeline);
        pass.setBindGroup(0, computeBindGroup);
        pass.dispatchWorkgroups(1);
        pass.end();
    }
    if (!readbackBusy) {
        encoder.copyBufferToBuffer(stateBuffer, 0, readbackBuffer, 0, 64);
    }
    device.queue.submit([encoder.finish()]);

    if (!readbackBusy) {
        readbackBusy = true;
        readbackBuffer.mapAsync(GPUMapMode.READ).then(() => {
            const data = new Float32Array(readbackBuffer.getMappedRange().slice(0));
            readbackBuffer.unmap();
            duckGroup.position.set(data[0], data[1], data[2]);
            duckGroup.quaternion.set(data[8], data[9], data[10], data[11]);
            readbackBusy = false;
        }).catch(() => { readbackBusy = false; });
    }

    controls.update();
    renderer.render(scene, camera);
}

function setWireframeVisible(visible) {
    showWireframe = visible;
    if (wireMesh) wireMesh.visible = visible;
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
