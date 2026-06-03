'use strict';

// Babylon.js + WGSL compute-physics example: a glTF model (the classic Duck) falls onto the
// ground and tumbles to rest. Babylon.js (WebGPUEngine) loads/renders the Duck, ground and
// skybox, while the rigid-body physics (OBB-vs-plane with normal + Coulomb-friction impulses
// and quaternion integration) runs in a WGSL compute shader sharing Babylon's WebGPU device.
// Each frame the new transform is read back and applied to the Babylon Duck. The collider is
// the model's oriented bounding box. Press W to toggle the collider wireframe.

const BASE_URL = 'https://cx20.github.io/gltf-test';
const DUCK_DIR = 'https://rawcdn.githack.com/cx20/gltf-test/5465cc37/sampleModels/Duck/glTF/';
const DUCK_FILE = 'Duck.gltf';
const FALL_SCALE = 5.0;
const GROUND_Y = 0.0;
const SUBSTEPS = 6;

let engine;
let scene;
let canvas;
let showWireframe = true;

window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (e.code === 'KeyW' || e.key === 'w' || e.key === 'W') {
        showWireframe = !showWireframe;
        const hint = document.getElementById('hint');
        if (hint) hint.textContent = 'W: wireframe ' + (showWireframe ? 'ON' : 'OFF');
    }
});

const waitForReady = (t) => new Promise((resolve) => {
    if (t.isReady()) resolve();
    else t.onLoadObservable.addOnce(() => resolve());
});

const createScene = async function () {
    const scene = new BABYLON.Scene(engine);
    const camera = new BABYLON.ArcRotateCamera('camera',
        -Math.PI / 180 * 50, Math.PI / 180 * 64, 22,
        BABYLON.Vector3.Zero(), scene);
    camera.setTarget(new BABYLON.Vector3(0, 4, 0));
    camera.attachControl(canvas, true);
    camera.minZ = 0.1;
    camera.maxZ = 300;

    const cubeTexture = new BABYLON.CubeTexture(
        BASE_URL + '/textures/env/papermillSpecularHDR.env', scene);
    scene.createDefaultSkybox(cubeTexture, true);
    scene.environmentTexture = cubeTexture;
    const hemi = new BABYLON.HemisphericLight('light0', new BABYLON.Vector3(0.4, 1, 0.3), scene);
    hemi.intensity = 0.9;

    await waitForReady(cubeTexture);

    const ground = BABYLON.MeshBuilder.CreateGround('ground', { width: 24, height: 24 }, scene);
    ground.position.y = GROUND_Y;
    const groundMat = new BABYLON.PBRMaterial('groundMat', scene);
    groundMat.metallic = 0;
    groundMat.roughness = 0.9;
    groundMat.albedoColor = new BABYLON.Color3(0.5, 0.5, 0.52);
    ground.material = groundMat;

    // Load the Duck, scale it up and re-centre it under a node we can drive from physics.
    const result = await BABYLON.SceneLoader.ImportMeshAsync(null, DUCK_DIR, DUCK_FILE, scene);
    const duckRoot = result.meshes[0];
    const physicsNode = new BABYLON.TransformNode('physicsNode', scene);
    physicsNode.rotationQuaternion = BABYLON.Quaternion.Identity();
    duckRoot.parent = physicsNode;
    duckRoot.scaling.scaleInPlace(FALL_SCALE);
    duckRoot.computeWorldMatrix(true);
    const bounds = duckRoot.getHierarchyBoundingVectors(true);
    const center = bounds.min.add(bounds.max).scale(0.5);
    duckRoot.position.subtractInPlace(center); // re-centre so the model sits at physicsNode origin
    const halfExtents = bounds.max.subtract(bounds.min).scale(0.5);

    // Collider wireframes (yellow model OBB, green ground box).
    const wireMat = (name, color) => {
        const m = new BABYLON.StandardMaterial(name, scene);
        m.wireframe = true;
        m.disableLighting = true;
        m.emissiveColor = color;
        return m;
    };
    const obbWire = BABYLON.MeshBuilder.CreateBox('obbWire', {
        width: halfExtents.x * 2, height: halfExtents.y * 2, depth: halfExtents.z * 2,
    }, scene);
    obbWire.material = wireMat('obbWireMat', new BABYLON.Color3(1, 1, 0.1));
    obbWire.parent = physicsNode;
    obbWire.isPickable = false;
    const groundWire = BABYLON.MeshBuilder.CreateBox('groundWire', { width: 24, height: 1, depth: 24 }, scene);
    groundWire.position.set(0, GROUND_Y - 0.5, 0);
    groundWire.material = wireMat('groundWireMat', new BABYLON.Color3(0.1, 1, 0.35));
    groundWire.isPickable = false;

    // ============================================================
    // Custom WebGPU path (shares Babylon's device): rigid-body physics in a compute shader.
    // ============================================================
    const device = engine._device;

    const initialPhysics = new Float32Array([
        0, 12, 0, 0,
        0, 0, 0, 0,
        0.15, 0.25, 0, 0.955,
        0.45, 0.7, 0.25, 0,
    ]);
    // normalise initial quaternion
    {
        const q = initialPhysics.subarray(8, 12);
        const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
        q[0] /= l; q[1] /= l; q[2] /= l; q[3] /= l;
    }
    const physicsBuffer = device.createBuffer({
        size: initialPhysics.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
        mappedAtCreation: true,
    });
    new Float32Array(physicsBuffer.getMappedRange()).set(initialPhysics);
    physicsBuffer.unmap();

    const readbackBuffer = device.createBuffer({ size: 64, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const simUbo = device.createBuffer({ size: 12 * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    const computeWGSL = `
struct PhysicsState {
    position   : vec4<f32>,
    velocity   : vec4<f32>,
    rotation   : vec4<f32>,
    angularVel : vec4<f32>,
}
struct SimParams {
    dt:f32, gravity:f32, groundY:f32, restitution:f32,
    halfExtents:vec4<f32>,
    friction:f32, mass:f32, inertiaInv:f32, pad:f32,
}
@group(0) @binding(0) var<storage, read_write> state : PhysicsState;
@group(0) @binding(1) var<uniform> params : SimParams;

fn quatMul(a : vec4<f32>, b : vec4<f32>) -> vec4<f32> {
    return vec4<f32>(
        a.w*b.x + a.x*b.w + a.y*b.z - a.z*b.y,
        a.w*b.y - a.x*b.z + a.y*b.w + a.z*b.x,
        a.w*b.z + a.x*b.y - a.y*b.x + a.z*b.w,
        a.w*b.w - a.x*b.x - a.y*b.y - a.z*b.z,
    );
}
fn rotByQuat(v : vec3<f32>, q : vec4<f32>) -> vec3<f32> {
    let t = 2.0 * cross(q.xyz, v);
    return v + q.w * t + cross(q.xyz, t);
}

@compute @workgroup_size(1)
fn main() {
    var pos = state.position.xyz;
    var vel = state.velocity.xyz;
    var rot = state.rotation;
    var angVel = state.angularVel.xyz;
    let half = params.halfExtents.xyz;

    vel.y -= params.gravity * params.dt;
    vel *= 0.999;
    pos += vel * params.dt;
    angVel *= 0.998;

    let speed = length(angVel);
    if (speed > 0.0001) {
        let axis = angVel / speed;
        let halfAngle = speed * params.dt * 0.5;
        let dq = vec4<f32>(axis * sin(halfAngle), cos(halfAngle));
        rot = normalize(quatMul(dq, rot));
    }

    var contactCount = 0u;
    var minWorldY = 0.0;
    var sumR = vec3<f32>(0.0);
    for (var mask = 0u; mask < 8u; mask++) {
        let lx = select(-half.x, half.x, (mask & 1u) != 0u);
        let ly = select(-half.y, half.y, (mask & 2u) != 0u);
        let lz = select(-half.z, half.z, (mask & 4u) != 0u);
        let r = rotByQuat(vec3<f32>(lx, ly, lz), rot);
        let worldY = pos.y + r.y;
        if (worldY < params.groundY) {
            if (contactCount == 0u || worldY < minWorldY) { minWorldY = worldY; }
            sumR += r;
            contactCount++;
        }
    }

    if (contactCount > 0u) {
        let r = sumR / f32(contactCount);
        let vn = vel.y + angVel.z * r.x - angVel.x * r.z;
        var normalImpulse = 0.0;
        if (vn < 0.0) {
            let e = select(params.restitution, 0.0, abs(vn) < 0.8);
            let denom = (1.0 / params.mass) + params.inertiaInv * (r.x * r.x + r.z * r.z);
            normalImpulse = -(1.0 + e) * vn / denom;
            vel.y += normalImpulse / params.mass;
            angVel.x -= params.inertiaInv * normalImpulse * r.z;
            angVel.z += params.inertiaInv * normalImpulse * r.x;
        }

        let tangentVel = vec3<f32>(
            vel.x + angVel.y * r.z - angVel.z * r.y,
            0.0,
            vel.z + angVel.x * r.y - angVel.y * r.x
        );
        let tangentLen = length(tangentVel);
        if (tangentLen > 0.0001) {
            let t = tangentVel / tangentLen;
            let rCrossT = cross(r, t);
            let denomT = (1.0 / params.mass) + params.inertiaInv * dot(rCrossT, rCrossT);
            let normalEstimate = max(abs(normalImpulse), params.mass * params.gravity * params.dt);
            let jt = clamp(-tangentLen / denomT, -params.friction * normalEstimate, params.friction * normalEstimate);
            vel += (jt / params.mass) * t;
            angVel += params.inertiaInv * jt * rCrossT;
        }

        pos.y += params.groundY - minWorldY;
        if (length(vel) < 0.04 && length(angVel) < 0.04) {
            vel = vec3<f32>(0.0);
            angVel = vec3<f32>(0.0);
        }
    }

    if (pos.y < -24.0) {
        pos = vec3<f32>(0.0, 12.0, 0.0);
        vel = vec3<f32>(0.0, 0.0, 0.0);
        rot = normalize(vec4<f32>(0.15, 0.25, 0.0, 0.955));
        angVel = vec3<f32>(0.45, 0.7, 0.25);
    }

    state.position = vec4<f32>(pos, 0.0);
    state.velocity = vec4<f32>(vel, 0.0);
    state.rotation = rot;
    state.angularVel = vec4<f32>(angVel, 0.0);
}
`;

    const computePipeline = device.createComputePipeline({
        layout: 'auto',
        compute: { module: device.createShaderModule({ code: computeWGSL }), entryPoint: 'main' },
    });
    const computeBindGroup = device.createBindGroup({
        layout: computePipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: physicsBuffer } },
            { binding: 1, resource: { buffer: simUbo } },
        ],
    });

    const MASS = 1.0;
    const inertiaInv = 1.0 / Math.max(halfExtents.x * halfExtents.x + halfExtents.z * halfExtents.z, 0.001);

    const hint = document.getElementById('hint');
    let frameCount = 0, lastFpsT = performance.now(), fps = 0;
    let readbackBusy = false;

    scene.onBeforeRenderObservable.add(() => {
        const dt = Math.min(engine.getDeltaTime() / 1000, 1 / 30);
        device.queue.writeBuffer(simUbo, 0, new Float32Array([
            dt / SUBSTEPS, 9.8, GROUND_Y, 0.22,
            halfExtents.x, halfExtents.y, halfExtents.z, 0,
            0.55, MASS, inertiaInv, 0,
        ]));

        const ce = device.createCommandEncoder();
        for (let s = 0; s < SUBSTEPS; s++) {
            const cp = ce.beginComputePass();
            cp.setPipeline(computePipeline);
            cp.setBindGroup(0, computeBindGroup);
            cp.dispatchWorkgroups(1);
            cp.end();
        }
        if (!readbackBusy) {
            ce.copyBufferToBuffer(physicsBuffer, 0, readbackBuffer, 0, 64);
        }
        device.queue.submit([ce.finish()]);

        if (!readbackBusy) {
            readbackBusy = true;
            readbackBuffer.mapAsync(GPUMapMode.READ).then(() => {
                const data = new Float32Array(readbackBuffer.getMappedRange().slice(0));
                readbackBuffer.unmap();
                physicsNode.position.set(data[0], data[1], data[2]);
                physicsNode.rotationQuaternion.set(data[8], data[9], data[10], data[11]);
                readbackBusy = false;
            }).catch(() => { readbackBusy = false; });
        }

        obbWire.isVisible = showWireframe;
        groundWire.isVisible = showWireframe;

        frameCount++;
        const now = performance.now();
        if (now - lastFpsT > 500) {
            fps = (frameCount * 1000 / (now - lastFpsT)) | 0;
            frameCount = 0; lastFpsT = now;
            if (hint) hint.textContent = 'W: wireframe ' + (showWireframe ? 'ON' : 'OFF') + ' · ' + fps + ' FPS';
        }
    });

    return scene;
};

async function init() {
    canvas = document.getElementById('c');
    if (!navigator.gpu) {
        document.getElementById('hint').textContent = 'WebGPU is not available in this browser.';
        return;
    }
    engine = new BABYLON.WebGPUEngine(canvas);
    await engine.initAsync();
    scene = await createScene();
    engine.runRenderLoop(() => scene.render());
    window.addEventListener('resize', () => engine.resize());
}

init().catch((error) => console.error(error));
