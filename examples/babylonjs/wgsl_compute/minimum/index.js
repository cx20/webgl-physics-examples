'use strict';

// Minimal Babylon.js + WGSL compute-physics example: a single textured cube falls onto the
// ground. Babylon.js (WebGPUEngine) provides the camera, skybox, environment, lights, ground
// and the cube mesh, while the rigid-body physics (OBB-vs-plane with normal + Coulomb-friction
// impulses and quaternion integration) runs in a WGSL compute shader that shares Babylon's
// WebGPU device. Each frame the new position/orientation is read back and applied to the
// Babylon cube mesh. Press W to toggle the collider wireframe.

const BASE_URL = 'https://cx20.github.io/gltf-test';
const TEXTURE_FROG = '../../../../assets/textures/frog.jpg';

const GROUND_Y = -2.0;
const CUBE_SIZE = 5.0;
const CUBE_HALF = 2.5;
const MASS = 1.0;
const I_INV = 6.0 / (MASS * CUBE_SIZE * CUBE_SIZE); // uniform cube: I = (1/6) m L^2
const SUBSTEPS = 4;

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
        -Math.PI / 180 * 45, Math.PI / 180 * 62, 42,
        BABYLON.Vector3.Zero(), scene);
    camera.setTarget(new BABYLON.Vector3(0, 3, 0));
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

    const frogTex = new BABYLON.Texture(TEXTURE_FROG, scene);

    const ground = BABYLON.MeshBuilder.CreateGround('ground', { width: 20, height: 20 }, scene);
    ground.position.y = GROUND_Y;
    const groundMat = new BABYLON.PBRMaterial('groundMat', scene);
    groundMat.metallic = 0;
    groundMat.roughness = 0.85;
    groundMat.albedoTexture = frogTex;
    ground.material = groundMat;

    const cube = BABYLON.MeshBuilder.CreateBox('cube', { size: CUBE_SIZE }, scene);
    cube.position.set(0, 12, 0);
    cube.rotationQuaternion = BABYLON.Quaternion.Identity();
    const cubeMat = new BABYLON.PBRMaterial('cubeMat', scene);
    cubeMat.metallic = 0;
    cubeMat.roughness = 0.6;
    cubeMat.albedoTexture = frogTex;
    cube.material = cubeMat;

    // Collider wireframes (green ground box, yellow cube box).
    const wireMat = (name, color) => {
        const m = new BABYLON.StandardMaterial(name, scene);
        m.wireframe = true;
        m.disableLighting = true;
        m.emissiveColor = color;
        return m;
    };
    const cubeWire = BABYLON.MeshBuilder.CreateBox('cubeWire', { size: CUBE_SIZE }, scene);
    cubeWire.material = wireMat('cubeWireMat', new BABYLON.Color3(1, 1, 0.1));
    cubeWire.rotationQuaternion = BABYLON.Quaternion.Identity();
    cubeWire.isPickable = false;
    const groundWire = BABYLON.MeshBuilder.CreateBox('groundWire', { width: 20, height: 1, depth: 20 }, scene);
    groundWire.position.set(0, GROUND_Y - 0.5, 0);
    groundWire.material = wireMat('groundWireMat', new BABYLON.Color3(0.1, 1, 0.35));
    groundWire.isPickable = false;

    // ============================================================
    // Custom WebGPU path (shares Babylon's device): rigid-body physics in a compute shader.
    // ============================================================
    const device = engine._device;

    // PhysicsState = position(vec4), velocity(vec4), rotation(vec4 quat), angularVel(vec4).
    const initialPhysics = new Float32Array([
        0, 12, 0, 0,
        0, 0, 0, 0,
        0, 0, 0, 1,
        0.3, 0.8, 0.2, 0,
    ]);
    const physicsBuffer = device.createBuffer({
        size: initialPhysics.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
        mappedAtCreation: true,
    });
    new Float32Array(physicsBuffer.getMappedRange()).set(initialPhysics);
    physicsBuffer.unmap();

    const readbackBuffer = device.createBuffer({ size: 64, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const simUbo = device.createBuffer({ size: 8 * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    const computeWGSL = `
struct PhysicsState {
    position   : vec4<f32>,
    velocity   : vec4<f32>,
    rotation   : vec4<f32>,
    angularVel : vec4<f32>,
}
struct SimParams {
    dt:f32, gravity:f32, groundY:f32, restitution:f32,
    halfSize:f32, friction:f32, mass:f32, iInv:f32,
}
@group(0) @binding(0) var<storage, read_write> state  : PhysicsState;
@group(0) @binding(1) var<uniform>             params : SimParams;

fn quatMul(a: vec4<f32>, b: vec4<f32>) -> vec4<f32> {
    return vec4<f32>(
        a.w*b.x + a.x*b.w + a.y*b.z - a.z*b.y,
        a.w*b.y - a.x*b.z + a.y*b.w + a.z*b.x,
        a.w*b.z + a.x*b.y - a.y*b.x + a.z*b.w,
        a.w*b.w - a.x*b.x - a.y*b.y - a.z*b.z,
    );
}
fn rotByQuat(v: vec3<f32>, q: vec4<f32>) -> vec3<f32> {
    let t = 2.0 * cross(q.xyz, v);
    return v + q.w * t + cross(q.xyz, t);
}

@compute @workgroup_size(1)
fn main() {
    var pos    = state.position.xyz;
    var vel    = state.velocity.xyz;
    var rot    = state.rotation;
    var angVel = state.angularVel.xyz;

    let mInv = 1.0 / params.mass;
    let iInv = params.iInv;
    let h    = params.halfSize;
    let mu   = params.friction;

    angVel *= 0.999;
    vel.y -= params.gravity * params.dt;
    pos   += vel * params.dt;

    let angSpeed = length(angVel);
    if (angSpeed > 0.0001) {
        let axis      = angVel / angSpeed;
        let halfAngle = angSpeed * params.dt * 0.5;
        let dq        = vec4<f32>(axis * sin(halfAngle), cos(halfAngle));
        rot = normalize(quatMul(dq, rot));
    }

    // OBB vs ground-plane (n = +Y): gather penetrating corners.
    var numContact = 0u;
    var sumR       = vec3<f32>(0.0);
    var minWorldY  = 0.0;
    for (var mask = 0u; mask < 8u; mask++) {
        let lx = select(-h, h, (mask & 1u) != 0u);
        let ly = select(-h, h, (mask & 2u) != 0u);
        let lz = select(-h, h, (mask & 4u) != 0u);
        let r_world = rotByQuat(vec3<f32>(lx, ly, lz), rot);
        let worldY  = pos.y + r_world.y;
        if (worldY < params.groundY) {
            numContact++;
            sumR += r_world;
            if (numContact == 1u || worldY < minWorldY) { minWorldY = worldY; }
        }
    }

    if (numContact > 0u) {
        let r = sumR / f32(numContact);

        let vn = vel.y + angVel.z * r.x - angVel.x * r.z;
        var jn = 0.0;
        if (vn < 0.0) {
            let e  = select(params.restitution, 0.0, abs(vn) < 1.0);
            let dn = mInv + iInv * (r.x * r.x + r.z * r.z);
            jn     = -(1.0 + e) * vn / dn;
            vel.y    += jn * mInv;
            angVel.x -= iInv * jn * r.z;
            angVel.z += iInv * jn * r.x;
        }

        let vt    = vec3<f32>(vel.x + angVel.y*r.z - angVel.z*r.y,
                              0.0,
                              vel.z + angVel.x*r.y - angVel.y*r.x);
        let vtLen = length(vt);
        if (vtLen > 0.0001) {
            let tDir    = vt / vtLen;
            let rCrossT = cross(r, tDir);
            let denom_t = mInv + iInv * dot(rCrossT, rCrossT);
            let jn_eff  = max(abs(jn), params.mass * params.gravity * params.dt);
            let jt      = clamp(-vtLen / denom_t, -mu * jn_eff, mu * jn_eff);
            vel    += (jt * mInv) * tDir;
            angVel += iInv * jt * rCrossT;
        }

        pos.y += params.groundY - minWorldY;

        if (length(vel) < 0.05 && length(angVel) < 0.05) {
            vel    = vec3<f32>(0.0);
            angVel = vec3<f32>(0.0);
        }
    }

    if (pos.y < -30.0) {
        pos    = vec3<f32>(0.0, 12.0, 0.0);
        vel    = vec3<f32>(0.0, 0.0, 0.0);
        rot    = vec4<f32>(0.0, 0.0, 0.0, 1.0);
        angVel = vec3<f32>(0.3, 0.8, 0.2);
    }

    state.position   = vec4<f32>(pos, 0.0);
    state.velocity   = vec4<f32>(vel, 0.0);
    state.rotation   = rot;
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

    const hint = document.getElementById('hint');
    let frameCount = 0, lastFpsT = performance.now(), fps = 0;
    let readbackBusy = false;

    scene.onBeforeRenderObservable.add(() => {
        const dt = Math.min(engine.getDeltaTime() / 1000, 1 / 30);
        device.queue.writeBuffer(simUbo, 0, new Float32Array([
            dt / SUBSTEPS, 9.81, GROUND_Y, 0.5, CUBE_HALF, 0.5, MASS, I_INV,
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

        // Read the new transform back and drive the Babylon meshes with it.
        if (!readbackBusy) {
            readbackBusy = true;
            readbackBuffer.mapAsync(GPUMapMode.READ).then(() => {
                const data = new Float32Array(readbackBuffer.getMappedRange().slice(0));
                readbackBuffer.unmap();
                cube.position.set(data[0], data[1], data[2]);
                cube.rotationQuaternion.set(data[8], data[9], data[10], data[11]);
                cubeWire.position.copyFrom(cube.position);
                cubeWire.rotationQuaternion.copyFrom(cube.rotationQuaternion);
                readbackBusy = false;
            }).catch(() => { readbackBusy = false; });
        }

        cubeWire.isVisible = showWireframe;
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
