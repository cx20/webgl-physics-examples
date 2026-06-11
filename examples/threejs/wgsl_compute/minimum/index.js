import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import WebGPURenderer from 'three/addons/renderers/webgpu/WebGPURenderer.js';

// Physics constants (same as webgpu/wgsl_compute/minimum)
const GROUND_Y  = -2.0;
const CUBE_HALF = 2.5;
const CUBE_SIZE = 5.0;
const MASS      = 1.0;
const I_INV     = 6.0 / (MASS * CUBE_SIZE * CUBE_SIZE);
const SUBSTEPS  = 4;

let showWireframe = true;
let scene, camera, renderer, controls;
let meshGround, meshCube;
let debugGround, debugCube;

// Raw WebGPU for WGSL compute physics
let device;
let computePipeline, physicsBuffer, readbackBuffer, simParamsBuffer, physicsBindGroup;
let readbackBusy = false;
let lastTime = -1;

// CPU-side copy of physics state (updated from GPU readback each frame)
const cubePos = [0, 12, 0];
const cubeRot = [0, 0, 0, 1]; // quaternion xyzw

function initScene() {
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 200);
    camera.position.set(0, 20, 35);

    const loader = new THREE.TextureLoader();
    const texture = loader.load('../../../../assets/textures/frog.jpg');
    const material = new THREE.MeshBasicMaterial({ map: texture });

    meshGround = new THREE.Mesh(new THREE.BoxGeometry(20, 1, 20), material);
    meshGround.position.set(0, GROUND_Y - 0.5, 0);
    scene.add(meshGround);

    meshCube = new THREE.Mesh(new THREE.BoxGeometry(CUBE_SIZE, CUBE_SIZE, CUBE_SIZE), material);
    meshCube.position.set(cubePos[0], cubePos[1], cubePos[2]);
    scene.add(meshCube);

    debugGround = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(20, 1, 20)),
        new THREE.LineBasicMaterial({ color: 0x44ee88 })
    );
    debugGround.position.set(0, GROUND_Y - 0.5, 0);
    scene.add(debugGround);

    debugCube = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(CUBE_SIZE, CUBE_SIZE, CUBE_SIZE)),
        new THREE.LineBasicMaterial({ color: 0xff8844 })
    );
    debugCube.position.set(cubePos[0], cubePos[1], cubePos[2]);
    scene.add(debugCube);
}

function initPhysics() {
    const computeShaderWGSL = document.getElementById('cs').textContent;

    computePipeline = device.createComputePipeline({
        layout:  'auto',
        compute: {
            module:     device.createShaderModule({ code: computeShaderWGSL }),
            entryPoint: 'main',
        },
    });

    const initialState = new Float32Array([
        0, 12, 0, 0,      // position xyz, pad
        0,  0, 0, 0,      // velocity xyz, pad
        0,  0, 0, 1,      // rotation quaternion xyzw (identity)
        0.3, 0.8, 0.2, 0, // angularVel xyz, pad
    ]);

    physicsBuffer = device.createBuffer({
        size:             initialState.byteLength,
        usage:            GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
        mappedAtCreation: true,
    });
    new Float32Array(physicsBuffer.getMappedRange()).set(initialState);
    physicsBuffer.unmap();

    readbackBuffer = device.createBuffer({
        size:  64,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });

    simParamsBuffer = device.createBuffer({
        size:  32,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    physicsBindGroup = device.createBindGroup({
        layout:  computePipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: physicsBuffer } },
            { binding: 1, resource: { buffer: simParamsBuffer } },
        ],
    });
}

function animate(timeMs) {
    if (lastTime < 0) lastTime = timeMs;
    const dt = Math.min((timeMs - lastTime) / 1000, 1 / 30);
    lastTime = timeMs;

    // Upload simulation parameters
    device.queue.writeBuffer(simParamsBuffer, 0, new Float32Array([
        dt / SUBSTEPS, 9.81, GROUND_Y, 0.5, CUBE_HALF, 0.5, MASS, I_INV,
    ]));

    // Dispatch compute passes (SUBSTEPS per frame for stability)
    const encoder = device.createCommandEncoder();
    for (let s = 0; s < SUBSTEPS; s++) {
        const cp = encoder.beginComputePass();
        cp.setPipeline(computePipeline);
        cp.setBindGroup(0, physicsBindGroup);
        cp.dispatchWorkgroups(1);
        cp.end();
    }
    if (!readbackBusy) {
        encoder.copyBufferToBuffer(physicsBuffer, 0, readbackBuffer, 0, 64);
    }
    device.queue.submit([encoder.finish()]);

    // Async readback: update CPU-side state from previous frame's copy
    if (!readbackBusy) {
        readbackBusy = true;
        readbackBuffer.mapAsync(GPUMapMode.READ).then(() => {
            const data = new Float32Array(readbackBuffer.getMappedRange().slice(0));
            readbackBuffer.unmap();
            cubePos[0] = data[0]; cubePos[1] = data[1]; cubePos[2] = data[2];
            cubeRot[0] = data[8]; cubeRot[1] = data[9]; cubeRot[2] = data[10]; cubeRot[3] = data[11];
            readbackBusy = false;
        }).catch(() => { readbackBusy = false; });
    }

    // Sync three.js mesh to physics state
    meshCube.position.set(cubePos[0], cubePos[1], cubePos[2]);
    meshCube.quaternion.set(cubeRot[0], cubeRot[1], cubeRot[2], cubeRot[3]);
    if (debugCube) {
        debugCube.position.copy(meshCube.position);
        debugCube.quaternion.copy(meshCube.quaternion);
    }

    controls.update();
    renderer.render(scene, camera);
}

function setWireframeVisible(visible) {
    showWireframe = visible;
    if (debugGround) debugGround.visible = visible;
    if (debugCube) debugCube.visible = visible;
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

    renderer = new WebGPURenderer({ antialias: true });
    renderer.setClearColor(0xffffff);
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

    // Initialize WebGPU renderer — device is available after this call
    await renderer.init();
    device = renderer.backend.device;

    initPhysics();
    setWireframeVisible(showWireframe);
    renderer.setAnimationLoop(animate);
}

main().catch(console.error);
