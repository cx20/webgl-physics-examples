'use strict';

// Babylon.js (WebGPUEngine) provides the camera, skybox, environment and ground,
// while the shogi pieces are simulated and drawn entirely on the GPU through custom
// WGSL compute + render passes that share Babylon's WebGPU device. The physics treats
// every piece as an oriented bounding box (OBB) and resolves piece-piece contacts with
// the Separating Axis Theorem, integrated with a ping-pong, sub-stepped solver.
//
// The pieces are rendered into a RenderTargetTexture and composited over the Babylon
// scene with a Layer. Press W to toggle a wireframe view of the OBB colliders.

const BASE_URL = 'https://cx20.github.io/gltf-test';
const TEXTURE_PIECE = '../../../../assets/textures/shogi_001/shogi.png';

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

async function loadPieceTexture(device, url) {
    const img = document.createElement('img');
    img.src = url;
    await img.decode();
    const bitmap = await createImageBitmap(img);
    const tex = device.createTexture({
        size: [bitmap.width, bitmap.height, 1],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    device.queue.copyExternalImageToTexture({ source: bitmap }, { texture: tex }, [bitmap.width, bitmap.height, 1]);
    bitmap.close();
    return tex;
}

// ---------------------------------------------------------------- piece geometry
// Pentagon-prism shogi piece (identical dimensions/UVs to the Havok + WebGPU versions).
const DOT_SIZE = 2;
const pw = DOT_SIZE * 0.8 * 1.0;   // 1.6
const ph = DOT_SIZE * 0.8 * 1.0;   // 1.6
const pd = DOT_SIZE * 0.8 * 0.2;   // 0.32

const PIECE_POSITIONS = new Float32Array([
    // Front face
    -0.5 * pw, -0.5 * ph, 0.7 * pd, 0.5 * pw, -0.5 * ph, 0.7 * pd, 0.35 * pw, 0.5 * ph, 0.4 * pd, -0.35 * pw, 0.5 * ph, 0.4 * pd,
    // Back face
    -0.5 * pw, -0.5 * ph, -0.7 * pd, 0.5 * pw, -0.5 * ph, -0.7 * pd, 0.35 * pw, 0.5 * ph, -0.4 * pd, -0.35 * pw, 0.5 * ph, -0.4 * pd,
    // Top face
    0.35 * pw, 0.5 * ph, 0.4 * pd, -0.35 * pw, 0.5 * ph, 0.4 * pd, -0.35 * pw, 0.5 * ph, -0.4 * pd, 0.35 * pw, 0.5 * ph, -0.4 * pd,
    // Bottom face
    -0.5 * pw, -0.5 * ph, 0.7 * pd, 0.5 * pw, -0.5 * ph, 0.7 * pd, 0.5 * pw, -0.5 * ph, -0.7 * pd, -0.5 * pw, -0.5 * ph, -0.7 * pd,
    // Right face
    0.5 * pw, -0.5 * ph, 0.7 * pd, 0.35 * pw, 0.5 * ph, 0.4 * pd, 0.35 * pw, 0.5 * ph, -0.4 * pd, 0.5 * pw, -0.5 * ph, -0.7 * pd,
    // Left face
    -0.5 * pw, -0.5 * ph, 0.7 * pd, -0.35 * pw, 0.5 * ph, 0.4 * pd, -0.35 * pw, 0.5 * ph, -0.4 * pd, -0.5 * pw, -0.5 * ph, -0.7 * pd,
    // Front2 face
    -0.35 * pw, 0.5 * ph, 0.4 * pd, 0.35 * pw, 0.5 * ph, 0.4 * pd, 0.0 * pw, 0.6 * ph, 0.35 * pd,
    // Back2 face
    -0.35 * pw, 0.5 * ph, -0.4 * pd, 0.35 * pw, 0.5 * ph, -0.4 * pd, 0.0 * pw, 0.6 * ph, -0.35 * pd,
    // Right2 face
    0.35 * pw, 0.5 * ph, 0.4 * pd, 0.35 * pw, 0.5 * ph, -0.4 * pd, 0.0 * pw, 0.6 * ph, -0.35 * pd, 0.0 * pw, 0.6 * ph, 0.35 * pd,
    // Left2 face
    -0.35 * pw, 0.5 * ph, 0.4 * pd, -0.35 * pw, 0.5 * ph, -0.4 * pd, 0.0 * pw, 0.6 * ph, -0.35 * pd, 0.0 * pw, 0.6 * ph, 0.35 * pd,
]);

const PIECE_NORMALS = new Float32Array([
    0, 0.0599, 0.9982, 0, 0.0599, 0.9982, 0, 0.0599, 0.9982, 0, 0.0599, 0.9982,
    0, -0.0599, -0.9982, 0, -0.0599, -0.9982, 0, -0.0599, -0.9982, 0, -0.0599, -0.9982,
    0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0,
    0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0,
    0.9889, 0.1483, 0, 0.9889, 0.1483, 0, 0.9889, 0.1483, 0, 0.9889, 0.1483, 0,
    -0.9889, 0.1483, 0, -0.9889, 0.1483, 0, -0.9889, 0.1483, 0, -0.9889, 0.1483, 0,
    0, 0.0995, 0.995, 0, 0.0995, 0.995, 0, 0.0995, 0.995,
    0, -0.0995, -0.995, 0, -0.0995, -0.995, 0, -0.0995, -0.995,
    0.2747, 0.9615, 0, 0.2747, 0.9615, 0, 0.2747, 0.9615, 0, 0.2747, 0.9615, 0,
    -0.2747, 0.9615, 0, -0.2747, 0.9615, 0, -0.2747, 0.9615, 0, -0.2747, 0.9615, 0,
]);

const PIECE_UVS = new Float32Array([
    0.5, 0.5, 0.75, 0.5, 0.75 - 0.25 / 8, 1.0, 0.5 + 0.25 / 8, 1.0,
    0.5, 0.5, 0.25, 0.5, 0.25 + 0.25 / 8, 1.0, 0.5 - 0.25 / 8, 1.0,
    0.75, 0.5, 0.5, 0.5, 0.5, 0.0, 0.75, 0.0,
    0.0, 0.5, 0.25, 0.5, 0.25, 1.0, 0.0, 1.0,
    0.0, 0.5, 0.0, 0.0, 0.25, 0.0, 0.25, 0.5,
    0.5, 0.5, 0.5, 0.0, 0.25, 0.0, 0.25, 0.5,
    0.75, 0.0, 1.0, 0.0, 1.0, 0.5,
    0.75, 0.0, 1.0, 0.0, 1.0, 0.5,
    0.75, 0.0, 1.0, 0.0, 1.0, 0.5, 0.75, 0.5,
    0.75, 0.0, 1.0, 0.0, 1.0, 0.5, 0.75, 0.5,
]);

const PIECE_INDICES = new Uint16Array([
    0, 1, 2, 0, 2, 3,
    4, 5, 6, 4, 6, 7,
    8, 9, 10, 8, 10, 11,
    12, 13, 14, 12, 14, 15,
    16, 17, 18, 16, 18, 19,
    20, 21, 22, 20, 22, 23,
    24, 25, 26,
    27, 28, 29,
    30, 33, 31, 33, 32, 31,
    34, 35, 36, 34, 36, 37,
]);

// ---------------------------------------------------------------- initial states
const COUNT = 300;
const STATE_FLOATS = 16;
const SUBSTEPS = 4;

function hash32(n) {
    let x = ((n >>> 0) ^ (n >>> 17)) >>> 0;
    x = Math.imul(x, 0xbf324c81) >>> 0;
    x = (x ^ (x >>> 11)) >>> 0;
    x = Math.imul(x, 0x68b665e5) >>> 0;
    x = (x ^ (x >>> 16)) >>> 0;
    return x;
}
function hashF(n) { return (hash32(n) & 0xffffff) / 0xffffff; }

function createInitialStates() {
    const states = new Float32Array(COUNT * STATE_FLOATS);
    const statesU = new Uint32Array(states.buffer);
    for (let i = 0; i < COUNT; i++) {
        const base = i * STATE_FLOATS;
        const seed = hash32(i + 1);
        states[base + 0] = (hashF(seed) - 0.5) * 15;        // x
        states[base + 1] = (hashF(seed + 1) + 1.0) * 15;    // y (15..30)
        states[base + 2] = (hashF(seed + 2) - 0.5) * 15;    // z
        statesU[base + 3] = seed;                            // seed as uint32 bits
        states[base + 11] = 1.0;                             // rotation: identity (qw=1)
        states[base + 12] = (hashF(seed + 3) - 0.5) * 6;     // initial tumble
        states[base + 13] = (hashF(seed + 4) - 0.5) * 2;
        states[base + 14] = (hashF(seed + 5) - 0.5) * 6;
    }
    return states;
}

const createScene = async function () {
    const scene = new BABYLON.Scene(engine);
    const camera = new BABYLON.ArcRotateCamera('camera',
        -Math.PI / 180 * 30, Math.PI / 180 * 72, 46,
        BABYLON.Vector3.Zero(), scene);
    camera.setTarget(new BABYLON.Vector3(0, -5, 0));
    camera.attachControl(canvas, true);
    camera.minZ = 0.1;
    camera.maxZ = 1000;

    const cubeTexture = new BABYLON.CubeTexture(
        BASE_URL + '/textures/env/papermillSpecularHDR.env', scene);
    scene.createDefaultSkybox(cubeTexture, true);
    scene.environmentTexture = cubeTexture;
    const hemi = new BABYLON.HemisphericLight('light0', new BABYLON.Vector3(0.4, 1, 0.3), scene);
    hemi.intensity = 0.9;

    await waitForReady(cubeTexture);

    // Ground plate sized to match the physics floor (top surface at y = -9.9, half-extent 6.5).
    const ground = BABYLON.MeshBuilder.CreateBox('ground', { width: 13, height: 1, depth: 13 }, scene);
    ground.position.y = -10.4;
    const groundMat = new BABYLON.PBRMaterial('groundMat', scene);
    groundMat.metallic = 0;
    groundMat.roughness = 0.85;
    groundMat.albedoColor = new BABYLON.Color3(0.32, 0.28, 0.22);
    ground.material = groundMat;

    // ============================================================
    // Custom WebGPU path (shares Babylon's device)
    // ============================================================
    const device = engine._device;

    const pieceTex = await loadPieceTexture(device, TEXTURE_PIECE);
    const pieceTexView = pieceTex.createView();
    const pieceSampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });

    const mkVB = (data) => {
        const buf = device.createBuffer({ size: data.byteLength, usage: GPUBufferUsage.VERTEX, mappedAtCreation: true });
        new Float32Array(buf.getMappedRange()).set(data);
        buf.unmap();
        return buf;
    };

    const positionBuffer = mkVB(PIECE_POSITIONS);
    const normalBuffer = mkVB(PIECE_NORMALS);
    const uvBuffer = mkVB(PIECE_UVS);
    const indexBuffer = (() => {
        const buf = device.createBuffer({ size: PIECE_INDICES.byteLength, usage: GPUBufferUsage.INDEX, mappedAtCreation: true });
        new Uint16Array(buf.getMappedRange()).set(PIECE_INDICES);
        buf.unmap();
        return buf;
    })();
    const indexCount = PIECE_INDICES.length;

    // OBB collider wireframe (half-extents match the compute shader: HW/HH/HD).
    const WH = 0.80, WV = 0.96, WD = 0.224;
    const wirePos = new Float32Array([
        -WH, -WV, -WD, WH, -WV, -WD, WH, WV, -WD, -WH, WV, -WD,
        -WH, -WV, WD, WH, -WV, WD, WH, WV, WD, -WH, WV, WD,
    ]);
    const wireIdx = new Uint16Array([
        0, 1, 1, 2, 2, 3, 3, 0,
        4, 5, 5, 6, 6, 7, 7, 4,
        0, 4, 1, 5, 2, 6, 3, 7,
    ]);
    const wireVBuffer = mkVB(wirePos);
    const wireIBuffer = (() => {
        const buf = device.createBuffer({ size: wireIdx.byteLength, usage: GPUBufferUsage.INDEX, mappedAtCreation: true });
        new Uint16Array(buf.getMappedRange()).set(wireIdx);
        buf.unmap();
        return buf;
    })();
    const wireIndexCount = wireIdx.length;

    // Ping-pong piece-state buffers.
    const stateBufSize = COUNT * STATE_FLOATS * 4;
    const initStates = createInitialStates();
    const mkState = () => {
        const buf = device.createBuffer({ size: stateBufSize, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, mappedAtCreation: true });
        new Float32Array(buf.getMappedRange()).set(initStates);
        buf.unmap();
        return buf;
    };
    const stateBuffers = [mkState(), mkState()];

    const simUbo = device.createBuffer({ size: 8 * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const camUbo = device.createBuffer({ size: 16 * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    // Physics: every piece is an oriented bounding box. Ground contact uses the lowest
    // corner (with contact torque) and piece-piece contact is resolved with the Separating
    // Axis Theorem (15 candidate axes) plus a bounding-sphere early-out.
    const computeWGSL = `
struct PieceState {
    position   : vec4<f32>,
    velocity   : vec4<f32>,
    rotation   : vec4<f32>,
    angularVel : vec4<f32>,
}
struct SimParams {
    dt          : f32,
    gravity     : f32,
    groundY     : f32,
    damping     : f32,
    angDamping  : f32,
    restitution : f32,
    friction    : f32,
    spawnRange  : f32,
}
const COUNT : u32 = ${COUNT}u;
const HW : f32 = 0.80;
const HH : f32 = 0.96;
const HD : f32 = 0.224;

@group(0) @binding(0) var<storage, read>       srcStates : array<PieceState>;
@group(0) @binding(1) var<storage, read_write> dstStates : array<PieceState>;
@group(0) @binding(2) var<uniform>             params    : SimParams;

fn hash(n : u32) -> u32 {
    var x = n ^ (n >> 17u);
    x = x * 0xbf324c81u;
    x ^= x >> 11u;
    x = x * 0x68b665e5u;
    x ^= x >> 16u;
    return x;
}
fn hashF(n : u32) -> f32 {
    return f32(hash(n) & 0xffffffu) * (1.0 / f32(0xffffffu));
}
fn quatMul(a : vec4<f32>, b : vec4<f32>) -> vec4<f32> {
    return vec4<f32>(
        a.w*b.x + a.x*b.w + a.y*b.z - a.z*b.y,
        a.w*b.y - a.x*b.z + a.y*b.w + a.z*b.x,
        a.w*b.z + a.x*b.y - a.y*b.x + a.z*b.w,
        a.w*b.w - a.x*b.x - a.y*b.y - a.z*b.z,
    );
}
fn rotateQ(q : vec4<f32>, v : vec3<f32>) -> vec3<f32> {
    let t = 2.0 * cross(q.xyz, v);
    return v + q.w * t + cross(q.xyz, t);
}
fn normalizeQ(q : vec4<f32>) -> vec4<f32> {
    let l = length(q);
    return select(vec4<f32>(0, 0, 0, 1), q / l, l > 0.0001);
}
fn quatToAxes(q : vec4<f32>) -> mat3x3<f32> {
    let x = q.x; let y = q.y; let z = q.z; let w = q.w;
    return mat3x3<f32>(
        vec3<f32>(1.0-2.0*(y*y+z*z),   2.0*(x*y+w*z),   2.0*(x*z-w*y)),
        vec3<f32>(  2.0*(x*y-w*z), 1.0-2.0*(x*x+z*z),   2.0*(y*z+w*x)),
        vec3<f32>(  2.0*(x*z+w*y),   2.0*(y*z-w*x), 1.0-2.0*(x*x+y*y))
    );
}
fn obbHalfProj(axes : mat3x3<f32>, L : vec3<f32>) -> f32 {
    return abs(dot(axes[0], L)) * HW
         + abs(dot(axes[1], L)) * HH
         + abs(dot(axes[2], L)) * HD;
}
fn satPen(T : vec3<f32>, axA : mat3x3<f32>, axB : mat3x3<f32>, L : vec3<f32>) -> f32 {
    let lenSq = dot(L, L);
    if (lenSq < 1e-8) { return 1e9; }
    let Ln = L * inverseSqrt(lenSq);
    return obbHalfProj(axA, Ln) + obbHalfProj(axB, Ln) - abs(dot(T, Ln));
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id : vec3<u32>) {
    let i = id.x;
    if (i >= COUNT) { return; }

    var pos    = srcStates[i].position.xyz;
    let seedW  = bitcast<u32>(srcStates[i].position.w);
    var vel    = srcStates[i].velocity.xyz;
    var rot    = srcStates[i].rotation;
    var angVel = srcStates[i].angularVel.xyz;

    // Respawn when a piece leaves the play area.
    if (pos.y < -15.0 || abs(pos.x) > 30.0 || abs(pos.z) > 30.0) {
        let s  = hash(seedW + 1u);
        pos.x  = (hashF(s)      - 0.5) * params.spawnRange;
        pos.y  = (hashF(s + 1u) + 1.0) * 15.0;
        pos.z  = (hashF(s + 2u) - 0.5) * params.spawnRange;
        let av = vec3<f32>(
            (hashF(s + 3u) - 0.5) * 6.0,
            (hashF(s + 4u) - 0.5) * 2.0,
            (hashF(s + 5u) - 0.5) * 6.0,
        );
        dstStates[i].position   = vec4<f32>(pos, bitcast<f32>(s));
        dstStates[i].velocity   = vec4<f32>(0.0);
        dstStates[i].rotation   = vec4<f32>(0.0, 0.0, 0.0, 1.0);
        dstStates[i].angularVel = vec4<f32>(av, 0.0);
        return;
    }

    vel.y -= params.gravity * params.dt;
    pos += vel * params.dt;

    let hw = angVel * 0.5 * params.dt;
    let dq = quatMul(vec4<f32>(hw, 0.0), rot);
    rot = normalizeQ(rot + dq);

    // Ground collision: lowest OBB corner + contact torque.
    var minY  = 1e9;
    var cLocal = vec3<f32>(0.0, -HH, 0.0);
    for (var ix = 0; ix < 2; ix++) {
        for (var iy = 0; iy < 2; iy++) {
            for (var iz = 0; iz < 2; iz++) {
                let lx = select(-HW, HW, ix == 1);
                let ly = select(-HH, HH, iy == 1);
                let lz = select(-HD, HD, iz == 1);
                let local = vec3<f32>(lx, ly, lz);
                let wy = pos.y + rotateQ(rot, local).y;
                if (wy < minY) {
                    minY   = wy;
                    cLocal = local;
                }
            }
        }
    }
    if (minY < params.groundY && abs(pos.x) < 6.5 && abs(pos.z) < 6.5) {
        pos.y += params.groundY - minY;
        if (vel.y < 0.0) {
            let r  = rotateQ(rot, cLocal);
            let jY = -vel.y * (1.0 + params.restitution);
            angVel += cross(r, vec3<f32>(0.0, jY, 0.0)) * 0.20;
            let dVelF = vec3<f32>(vel.x * (params.friction - 1.0), 0.0, vel.z * (params.friction - 1.0));
            angVel += cross(r, dVelF) * 0.25;
            vel.y  = -vel.y * params.restitution;
            vel.x *= params.friction;
            vel.z *= params.friction;
        }
        angVel *= 0.80;
    }

    // Piece-to-piece OBB collision (SAT).
    let axA  = quatToAxes(rot);
    let BSR2 = 6.76;   // bounding-sphere diameter^2 = (2*1.3)^2
    for (var j = 0u; j < COUNT; j++) {
        if (j == i) { continue; }
        let jPos = srcStates[j].position.xyz;
        let T    = jPos - pos;
        if (dot(T, T) > BSR2) { continue; }
        let axB = quatToAxes(srcStates[j].rotation);

        var minPen  = 1e9;
        var minAxis = vec3<f32>(1.0, 0.0, 0.0);
        var sep     = false;

        for (var k = 0; k < 3; k++) {
            if (sep) { break; }
            let pen = satPen(T, axA, axB, axA[k]);
            if (pen <= 0.0) { sep = true; break; }
            if (pen < minPen) { minPen = pen; minAxis = axA[k]; }
        }
        for (var k = 0; k < 3; k++) {
            if (sep) { break; }
            let pen = satPen(T, axA, axB, axB[k]);
            if (pen <= 0.0) { sep = true; break; }
            if (pen < minPen) { minPen = pen; minAxis = axB[k]; }
        }
        for (var a = 0; a < 3; a++) {
            if (sep) { break; }
            for (var b = 0; b < 3; b++) {
                if (sep) { break; }
                let L   = cross(axA[a], axB[b]);
                let pen = satPen(T, axA, axB, L);
                if (pen <= 0.0) { sep = true; break; }
                if (pen < minPen) { minPen = pen; minAxis = L; }
            }
        }
        if (sep) { continue; }

        var n = minAxis;
        if (dot(n, pos - jPos) < 0.0) { n = -n; }
        pos += n * (minPen * 0.5);

        let cLx = clamp(dot(T, axA[0]), -HW, HW);
        let cLy = clamp(dot(T, axA[1]), -HH, HH);
        let cLz = clamp(dot(T, axA[2]), -HD, HD);
        let r_i = axA[0]*cLx + axA[1]*cLy + axA[2]*cLz;

        let jVel  = srcStates[j].velocity.xyz;
        let relV  = vel - jVel;
        let relVn = dot(relV, n);
        if (relVn < 0.0) {
            let Jn = -(relVn * (1.0 + 0.2) * 0.5);
            vel    += n * Jn;
            angVel += cross(r_i, n * Jn) * 0.5;
            let relVt    = relV - relVn * n;
            let relVtLen = length(relVt);
            if (relVtLen > 0.001) {
                let Jt   = min(0.4 * Jn, relVtLen * 0.5);
                let tDir = relVt / relVtLen;
                vel    -= tDir * Jt;
                angVel += cross(r_i, -tDir * Jt) * 1.5;
            }
        }
    }

    vel    *= params.damping;
    angVel *= params.angDamping;

    dstStates[i].position   = vec4<f32>(pos, bitcast<f32>(seedW));
    dstStates[i].velocity   = vec4<f32>(vel, 0.0);
    dstStates[i].rotation   = rot;
    dstStates[i].angularVel = vec4<f32>(angVel, 0.0);
}
`;

    // Render: instanced texture-mapped pieces, lit by a single world-space key light plus
    // ambient. The clip-space Y is flipped because the output goes into a RenderTargetTexture.
    const renderWGSL = `
struct PieceState {
    position   : vec4<f32>,
    velocity   : vec4<f32>,
    rotation   : vec4<f32>,
    angularVel : vec4<f32>,
}
struct Camera { viewProj : mat4x4<f32>, }
@group(0) @binding(0) var<uniform>       cam    : Camera;
@group(0) @binding(1) var                samp   : sampler;
@group(0) @binding(2) var                tex    : texture_2d<f32>;
@group(0) @binding(3) var<storage, read> states : array<PieceState>;

struct VSOut {
    @builtin(position) pos : vec4<f32>,
    @location(0) uv : vec2<f32>,
    @location(1) light : f32,
}
fn qtransform(q : vec4<f32>, p : vec3<f32>) -> vec3<f32> {
    return p + 2.0 * cross(cross(p, q.xyz) - q.w * p, q.xyz);
}
@vertex
fn vs(
    @location(0) position : vec3<f32>,
    @location(1) normal   : vec3<f32>,
    @location(2) uv       : vec2<f32>,
    @builtin(instance_index) instance : u32,
) -> VSOut {
    let state = states[instance];
    let worldN = qtransform(state.rotation, normal);
    let worldPos = qtransform(state.rotation, position) + state.position.xyz;
    var out : VSOut;
    let clip = cam.viewProj * vec4<f32>(worldPos, 1.0);
    out.pos = vec4<f32>(clip.x, -clip.y, clip.z, clip.w);
    // Babylon's left-handed viewProj mirrors X, so flip U to keep the characters
    // readable (the Havok version compensates the same way with uScale=-1/uOffset=1).
    out.uv = vec2<f32>(1.0 - uv.x, uv.y);
    let L = normalize(vec3<f32>(0.5, 1.0, 0.6));
    out.light = 0.45 + 0.55 * max(dot(normalize(worldN), L), 0.0);
    return out;
}
@fragment
fn fs(in : VSOut) -> @location(0) vec4<f32> {
    let t = textureSample(tex, samp, in.uv);
    let shade = pow(vec3<f32>(in.light), vec3<f32>(0.7));
    return vec4<f32>(t.rgb * shade, 1.0);
}
`;

    const wireWGSL = `
struct PieceState {
    position   : vec4<f32>,
    velocity   : vec4<f32>,
    rotation   : vec4<f32>,
    angularVel : vec4<f32>,
}
struct Camera { viewProj : mat4x4<f32>, }
@group(0) @binding(0) var<uniform>       cam    : Camera;
@group(0) @binding(1) var<storage, read> states : array<PieceState>;
fn qtransform(q : vec4<f32>, p : vec3<f32>) -> vec3<f32> {
    return p + 2.0 * cross(cross(p, q.xyz) - q.w * p, q.xyz);
}
@vertex
fn vs(@location(0) position : vec3<f32>, @builtin(instance_index) instance : u32) -> @builtin(position) vec4<f32> {
    let state = states[instance];
    let worldPos = state.position.xyz + qtransform(state.rotation, position);
    let clip = cam.viewProj * vec4<f32>(worldPos, 1.0);
    return vec4<f32>(clip.x, -clip.y, clip.z, clip.w);
}
@fragment
fn fs() -> @location(0) vec4<f32> { return vec4<f32>(0.1, 1.0, 0.35, 1.0); }
`;

    const computeModule = device.createShaderModule({ code: computeWGSL });
    const renderModule = device.createShaderModule({ code: renderWGSL });
    const wireModule = device.createShaderModule({ code: wireWGSL });

    const computePipeline = device.createComputePipeline({ layout: 'auto', compute: { module: computeModule, entryPoint: 'main' } });

    const rttSize = { width: engine.getRenderWidth(), height: engine.getRenderHeight() };
    const pieceRtt = new BABYLON.RenderTargetTexture('pieceRTT', rttSize, scene, {
        generateMipMaps: false,
        type: BABYLON.Constants.TEXTURETYPE_UNSIGNED_BYTE,
        format: BABYLON.Constants.TEXTUREFORMAT_RGBA,
    });
    const pieceLayer = new BABYLON.Layer('pieceLayer', null, scene, false);
    pieceLayer.texture = pieceRtt;
    pieceLayer.alphaBlendingMode = BABYLON.Engine.ALPHA_COMBINE;

    const depthTex = device.createTexture({
        size: [rttSize.width, rttSize.height],
        format: 'depth24plus',
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });

    const renderPipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: {
            module: renderModule, entryPoint: 'vs',
            buffers: [
                { arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] },
                { arrayStride: 12, attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x3' }] },
                { arrayStride: 8, attributes: [{ shaderLocation: 2, offset: 0, format: 'float32x2' }] },
            ],
        },
        fragment: { module: renderModule, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        depthStencil: { depthWriteEnabled: true, depthCompare: 'less', format: 'depth24plus' },
    });

    const wirePipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: {
            module: wireModule, entryPoint: 'vs',
            buffers: [{ arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] }],
        },
        fragment: { module: wireModule, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] },
        primitive: { topology: 'line-list' },
        depthStencil: { depthWriteEnabled: false, depthCompare: 'less-equal', format: 'depth24plus' },
    });

    // src reads stateBuffers[s], writes stateBuffers[1-s].
    const computeBindGroups = [0, 1].map((s) => device.createBindGroup({
        layout: computePipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: stateBuffers[s] } },
            { binding: 1, resource: { buffer: stateBuffers[1 - s] } },
            { binding: 2, resource: { buffer: simUbo } },
        ],
    }));
    const renderBindGroups = [0, 1].map((s) => device.createBindGroup({
        layout: renderPipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: camUbo } },
            { binding: 1, resource: pieceSampler },
            { binding: 2, resource: pieceTexView },
            { binding: 3, resource: { buffer: stateBuffers[s] } },
        ],
    }));
    const wireBindGroups = [0, 1].map((s) => device.createBindGroup({
        layout: wirePipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: camUbo } },
            { binding: 1, resource: { buffer: stateBuffers[s] } },
        ],
    }));

    const GRAVITY = 9.8;
    const GROUND_Y = -9.9;
    const DAMPING = 0.9992;
    const ANG_DAMPING = 0.992;
    const RESTITUTION = 0.35;
    const FRICTION = 0.82;
    const SPAWN_RANGE = 15.0;

    const hint = document.getElementById('hint');
    let frameCount = 0, lastFpsT = performance.now(), fps = 0;
    let ping = 0;

    scene.onBeforeRenderObservable.add(() => {
        const internalTex = pieceRtt.getInternalTexture();
        if (!internalTex || !internalTex._hardwareTexture) return;
        const gpuTex = internalTex._hardwareTexture.underlyingResource;
        if (!gpuTex) return;

        const view = camera.getViewMatrix();
        const proj = camera.getProjectionMatrix();
        const viewProj = view.multiply(proj);
        device.queue.writeBuffer(camUbo, 0, new Float32Array(viewProj.toArray()));

        const dtFrame = Math.min(engine.getDeltaTime() / 1000, 1 / 30);
        const dtSub = dtFrame / SUBSTEPS;
        device.queue.writeBuffer(simUbo, 0, new Float32Array([
            dtSub, GRAVITY, GROUND_Y, DAMPING, ANG_DAMPING, RESTITUTION, FRICTION, SPAWN_RANGE,
        ]));

        const ce = device.createCommandEncoder();

        for (let s = 0; s < SUBSTEPS; s++) {
            const cp = ce.beginComputePass();
            cp.setPipeline(computePipeline);
            cp.setBindGroup(0, computeBindGroups[ping]);
            cp.dispatchWorkgroups(Math.ceil(COUNT / 64));
            cp.end();
            ping ^= 1;
        }

        // After an even number of substeps, the latest state is back in stateBuffers[ping].
        const latest = ping;
        {
            const pass = ce.beginRenderPass({
                colorAttachments: [{
                    view: gpuTex.createView(),
                    clearValue: { r: 0, g: 0, b: 0, a: 0 },
                    loadOp: 'clear',
                    storeOp: 'store',
                }],
                depthStencilAttachment: {
                    view: depthTex.createView(),
                    depthClearValue: 1.0,
                    depthLoadOp: 'clear',
                    depthStoreOp: 'store',
                },
            });
            pass.setPipeline(renderPipeline);
            pass.setVertexBuffer(0, positionBuffer);
            pass.setVertexBuffer(1, normalBuffer);
            pass.setVertexBuffer(2, uvBuffer);
            pass.setIndexBuffer(indexBuffer, 'uint16');
            pass.setBindGroup(0, renderBindGroups[latest]);
            pass.drawIndexed(indexCount, COUNT);
            if (showWireframe) {
                pass.setPipeline(wirePipeline);
                pass.setBindGroup(0, wireBindGroups[latest]);
                pass.setVertexBuffer(0, wireVBuffer);
                pass.setIndexBuffer(wireIBuffer, 'uint16');
                pass.drawIndexed(wireIndexCount, COUNT);
            }
            pass.end();
        }

        device.queue.submit([ce.finish()]);

        frameCount++;
        const now = performance.now();
        if (now - lastFpsT > 500) {
            fps = (frameCount * 1000 / (now - lastFpsT)) | 0;
            frameCount = 0; lastFpsT = now;
            if (hint) hint.textContent = 'W: wireframe ' + (showWireframe ? 'ON' : 'OFF') + ' · ' + fps + ' FPS';
        }
    });

    scene.onDisposeObservable.add(() => { depthTex.destroy(); });

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
