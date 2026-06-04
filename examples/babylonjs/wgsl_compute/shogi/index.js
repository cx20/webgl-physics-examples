'use strict';

// Babylon.js (WebGPUEngine) provides the camera, skybox, environment and ground,
// while the shogi pieces are simulated and drawn entirely on the GPU through custom
// WGSL compute + render passes that share Babylon's WebGPU device.
//
// The physics is ported from the Babylon.js + WGSL eraser sample: every piece is an
// oriented bounding box (OBB) resolved by a single shared collide() routine against the
// floor and every other piece, using only the six face normals as separating axes (no
// edge cross-products) for a stable contact normal, plus a Baumgarte push-out, a
// gravity-tip torque about the average contact point (so an edge-balanced piece flattens),
// and a per-body sleep timer (velocity.w) so a settled pile stops trembling.
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
// 200 pieces fit the 13 x 13 plate as a low heap; more than this overflows the edges and the
// spilled pieces recycle forever (a "fountain" of pieces raining back down).
const COUNT = 300;
const STATE_FLOATS = 16;
const SUBSTEPS = 5;

// Piece OBB half-extents (match the wireframe box + compute shader).
const SHE = [0.80, 0.96, 0.224];
// Static floor OBB. Thick (so fast pieces cannot tunnel through a thin slab) with its top
// surface at y = -9.95, matching the thin rendered plate.
const GROUND_C = [0, -11.45, 0];
const GROUND_HE = [6.5, 1.5, 6.5];

function hash32(n) {
    let x = ((n >>> 0) ^ (n >>> 17)) >>> 0;
    x = Math.imul(x, 0xbf324c81) >>> 0;
    x = (x ^ (x >>> 11)) >>> 0;
    x = Math.imul(x, 0x68b665e5) >>> 0;
    x = (x ^ (x >>> 16)) >>> 0;
    return x;
}
function hashF(n) { return (hash32(n) & 0xffffff) / 0xffffff; }

// State layout (matches the eraser sample): position.w = seed (float), velocity.w = sleep timer.
function createInitialStates() {
    const states = new Float32Array(COUNT * STATE_FLOATS);
    for (let i = 0; i < COUNT; i++) {
        const base = i * STATE_FLOATS;
        const seed = hash32(i + 1);
        states[base + 0] = (hashF(seed) - 0.5) * 15;        // x (matches the other Havok samples)
        states[base + 1] = (hashF(seed + 1) + 1.0) * 15;    // y (15..30)
        states[base + 2] = (hashF(seed + 2) - 0.5) * 15;    // z
        states[base + 3] = hashF(seed + 6);                  // seed (float 0..1)
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

    // Thin rendered plate (13 x 0.1 x 13, top at y = -9.95), matching the other shogi samples;
    // the physics floor collider underneath is thicker to avoid tunnelling.
    const ground = BABYLON.MeshBuilder.CreateBox('ground', { width: 13, height: 0.1, depth: 13 }, scene);
    ground.position.y = -10.0;
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

    const simUbo = device.createBuffer({ size: 4 * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const camUbo = device.createBuffer({ size: 16 * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    // Physics (ported from the WGSL eraser sample): every piece is an oriented bounding box
    // resolved by a single shared collide() routine against the floor and every other piece.
    // Only the six face normals are used as separating axes (no edge cross-products), giving a
    // stable face contact normal; a Baumgarte push-out, a gravity-tip torque about the average
    // contact, and a per-body sleep timer keep a settled pile from trembling.
    const computeWGSL = `
struct PieceState { position:vec4<f32>, velocity:vec4<f32>, rotation:vec4<f32>, angularVel:vec4<f32>, }
struct SimParams { dt:f32, gravity:f32, elapsedTime:f32, pad:f32, }
const COUNT : u32 = ${COUNT}u;
const SHE : vec3<f32> = vec3<f32>(${SHE[0]}, ${SHE[1]}, ${SHE[2]});
const GROUND_C : vec3<f32> = vec3<f32>(${GROUND_C[0]}, ${GROUND_C[1]}, ${GROUND_C[2]});
const GROUND_HE : vec3<f32> = vec3<f32>(${GROUND_HE[0]}, ${GROUND_HE[1]}, ${GROUND_HE[2]});

@group(0) @binding(0) var<storage, read>       srcStates : array<PieceState>;
@group(0) @binding(1) var<storage, read_write> dstStates : array<PieceState>;
@group(0) @binding(2) var<uniform>             params    : SimParams;

fn quatMul(a:vec4<f32>, b:vec4<f32>) -> vec4<f32> {
    return vec4<f32>(
        a.w*b.x + a.x*b.w + a.y*b.z - a.z*b.y,
        a.w*b.y - a.x*b.z + a.y*b.w + a.z*b.x,
        a.w*b.z + a.x*b.y - a.y*b.x + a.z*b.w,
        a.w*b.w - a.x*b.x - a.y*b.y - a.z*b.z,
    );
}
fn normalizeQ(q:vec4<f32>) -> vec4<f32> { let l = length(q); return select(vec4<f32>(0,0,0,1), q/l, l > 0.0001); }
fn quatToAxes(q:vec4<f32>) -> mat3x3<f32> {
    let x=q.x; let y=q.y; let z=q.z; let w=q.w;
    return mat3x3<f32>(
        vec3<f32>(1.0-2.0*(y*y+z*z), 2.0*(x*y+w*z), 2.0*(x*z-w*y)),
        vec3<f32>(2.0*(x*y-w*z), 1.0-2.0*(x*x+z*z), 2.0*(y*z+w*x)),
        vec3<f32>(2.0*(x*z+w*y), 2.0*(y*z-w*x), 1.0-2.0*(x*x+y*y)),
    );
}
fn obbProj(ax:mat3x3<f32>, he:vec3<f32>, L:vec3<f32>) -> f32 {
    return abs(dot(ax[0],L))*he.x + abs(dot(ax[1],L))*he.y + abs(dot(ax[2],L))*he.z;
}
fn satPen(T:vec3<f32>, axA:mat3x3<f32>, heA:vec3<f32>, axB:mat3x3<f32>, heB:vec3<f32>, L:vec3<f32>) -> f32 {
    let lenSq = dot(L,L);
    if (lenSq < 1e-8) { return 1e9; }
    let Ln = L * inverseSqrt(lenSq);
    return obbProj(axA,heA,Ln) + obbProj(axB,heB,Ln) - abs(dot(T,Ln));
}

struct Resp { dPos:vec3<f32>, dVel:vec3<f32>, dAng:vec3<f32>, hit:f32, normal:vec3<f32>, lever:vec3<f32>, }

const ANG_SCALE : f32 = 0.18;
const PEN_SLOP  : f32 = 0.006;
const BAUMGARTE : f32 = 0.4;
const MAX_PUSH  : f32 = 0.06;
const WAKE_LIN  : f32 = 0.15;
const WAKE_ANG  : f32 = 0.6;
const SLEEP_TIME : f32 = 0.4;
// Gravity torque about the average contact tips a piece flat quickly (only while it is still
// moving, see below). A small extra bias only nudges near-upright pieces off their edge.
const GTIP : f32 = 4.5;
const GTIP_FLAT : f32 = 1.5;
// A body may only sleep on a stable support (the floor or an already-sleeping piece), when it
// is slow AND the per-step push-out has converged (PUSH_REST). This stops pieces from freezing
// mid-pile while still penetrating, which is what made the heap look like it was floating.
const PUSH_REST : f32 = 0.03;
const POKE_SPEED : f32 = 0.3;

// Collide this piece (A, half-extents SHE) against another OBB (B). pushFactor/impFactor are
// 1.0 against an immovable static and 0.5 for a piece-piece pair. Only the six face normals are
// separating axes, so the contact normal is a stable face direction (no jitter/crawl).
fn collide(pos:vec3<f32>, vel:vec3<f32>, angVel:vec3<f32>, axA:mat3x3<f32>,
           cB:vec3<f32>, velB:vec3<f32>, axB:mat3x3<f32>, heB:vec3<f32>,
           pushFactor:f32, impFactor:f32, restitution:f32, friction:f32) -> Resp {
    var resp : Resp;
    resp.dPos = vec3<f32>(0.0); resp.dVel = vec3<f32>(0.0); resp.dAng = vec3<f32>(0.0); resp.hit = 0.0; resp.normal = vec3<f32>(0.0); resp.lever = vec3<f32>(0.0);
    let T = cB - pos;
    let bsr = length(SHE) + length(heB);
    if (dot(T,T) > bsr*bsr) { return resp; }

    var minPen = 1e9;
    var minAxis = vec3<f32>(0.0,1.0,0.0);
    var sep = false;
    for (var k=0; k<3; k++) { if (sep) { break; } let pen = satPen(T,axA,SHE,axB,heB,axA[k]); if (pen<=0.0){sep=true;break;} if (pen<minPen){minPen=pen;minAxis=axA[k];} }
    for (var k=0; k<3; k++) { if (sep) { break; } let pen = satPen(T,axA,SHE,axB,heB,axB[k]); if (pen<=0.0){sep=true;break;} if (pen<minPen){minPen=pen;minAxis=axB[k];} }
    if (sep) { return resp; }
    resp.hit = 1.0;

    var n = minAxis;
    if (dot(n, -T) < 0.0) { n = -n; }   // n points from B toward this piece
    resp.normal = n;
    // Clamp the positional correction so a deep overlap can't teleport a piece out of the pile.
    resp.dPos = n * min(max(minPen - PEN_SLOP, 0.0) * pushFactor * BAUMGARTE, MAX_PUSH);

    let cLx = clamp(dot(T, axA[0]), -SHE.x, SHE.x);
    let cLy = clamp(dot(T, axA[1]), -SHE.y, SHE.y);
    let cLz = clamp(dot(T, axA[2]), -SHE.z, SHE.z);
    let r_i = axA[0]*cLx + axA[1]*cLy + axA[2]*cLz;
    resp.lever = r_i;

    let relV = vel - velB;
    let relVn = dot(relV, n);
    if (relVn < 0.0) {
        let Jn = -(relVn * (1.0 + restitution) * impFactor);
        resp.dVel += n * Jn;
        resp.dAng += cross(r_i, n * Jn) * (impFactor * ANG_SCALE);
        let relVt = relV - relVn * n;
        let vtLen = length(relVt);
        if (vtLen > 0.001) {
            let tDir = relVt / vtLen;
            let Jt = min(friction * abs(Jn), vtLen * impFactor);
            resp.dVel -= tDir * Jt;
            resp.dAng += cross(r_i, -tDir * Jt) * (impFactor * ANG_SCALE);
        }
    }
    return resp;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id : vec3<u32>) {
    let i = id.x;
    if (i >= COUNT) { return; }

    var pos = srcStates[i].position.xyz;
    var vel = srcStates[i].velocity.xyz;
    var rot = srcStates[i].rotation;
    var angVel = srcStates[i].angularVel.xyz;
    let seed = srcStates[i].position.w;
    var sleepTimer = srcStates[i].velocity.w;
    var asleep = sleepTimer >= SLEEP_TIME;

    // Integrate only while awake; a sleeping piece holds its pose (but is still tested for
    // contacts below so it can be woken up).
    if (!asleep) {
        vel.y -= params.gravity * params.dt;
        vel *= 0.998;
        angVel *= 0.96;
        pos += vel * params.dt;
        let sp = length(angVel);
        if (sp > 0.0001) {
            let axis = angVel / sp;
            let half = sp * params.dt * 0.5;
            rot = normalizeQ(quatMul(vec4<f32>(axis * sin(half), cos(half)), rot));
        }
    }

    let axA = quatToAxes(rot);
    let identity = mat3x3<f32>(vec3<f32>(1,0,0), vec3<f32>(0,1,0), vec3<f32>(0,0,1));

    var contacts = 0.0;
    var leverSum = vec3<f32>(0.0);
    var pushMag = 0.0;
    var stableSupport = false;   // resting on the floor or an already-sleeping piece
    var awakePoke = false;       // a moving piece is pushing into us

    // Floor (static, always a stable support).
    var r = collide(pos, vel, angVel, axA, GROUND_C, vec3<f32>(0.0), identity, GROUND_HE, 1.0, 1.0, 0.0, 0.8);
    if (r.hit > 0.0) {
        pos += r.dPos; vel += r.dVel; angVel += r.dAng;
        contacts += 1.0; leverSum += r.lever; pushMag += length(r.dPos);
        stableSupport = true;
    }

    // Piece-piece (read neighbours from the previous state). Against an already-sleeping
    // neighbour this piece takes the full push-out (the sleeper acts like a static).
    for (var j = 0u; j < COUNT; j++) {
        if (j == i) { continue; }
        let o = srcStates[j];
        let oAsleep = o.velocity.w >= SLEEP_TIME;
        let push = select(0.5, 1.0, oAsleep);
        r = collide(pos, vel, angVel, axA, o.position.xyz, o.velocity.xyz, quatToAxes(o.rotation), SHE, push, 0.5, 0.0, 0.6);
        if (r.hit > 0.0) {
            pos += r.dPos; vel += r.dVel; angVel += r.dAng;
            contacts += 1.0; leverSum += r.lever; pushMag += length(r.dPos);
            if (oAsleep) { stableSupport = true; }
            else if (length(o.velocity.xyz) > POKE_SPEED) { awakePoke = true; }
        }
    }

    // A sleeping piece stays frozen unless a moving piece disturbs it or its support is gone
    // (otherwise it would hang in the air after the pile underneath shifts).
    if (asleep) {
        if (awakePoke || !stableSupport) {
            sleepTimer = 0.0;
            asleep = false;
        } else {
            dstStates[i].position = vec4<f32>(pos, seed);
            dstStates[i].velocity = vec4<f32>(0.0, 0.0, 0.0, sleepTimer);
            dstStates[i].rotation = rot;
            dstStates[i].angularVel = vec4<f32>(0.0);
            return;
        }
    }

    // Cap falling/contact speeds so impacts into the dense pile stay gentle (no ejection fountain).
    let speed = length(vel);
    if (speed > 18.0) { vel *= 18.0 / speed; }
    if (length(angVel) > 8.0) { angVel *= 8.0 / length(angVel); }

    // Resting bodies: gravity torque about the average contact topples a piece quickly, like
    // real toppling. Once a piece is slow on a stable support it is left alone (no more tipping)
    // so settled and buried pieces come to rest and stay put instead of being nudged forever. A
    // small bias is kept only for near-upright pieces, to break the metastable on-edge balance.
    // Pieces may sleep at whatever angle they wedge at (a natural Havok-like jumble).
    if (contacts > 0.0) {
        let zaxis = axA[2];
        let settledSupport = stableSupport && length(vel) < WAKE_LIN && length(angVel) < WAKE_ANG;
        if (!settledSupport) {
            let rAvg = leverSum / contacts;
            angVel += cross(-rAvg, vec3<f32>(0.0, -params.gravity, 0.0)) * (params.dt * GTIP);
        }
        if (abs(zaxis.y) < 0.35) {   // near upright (tilt > ~70deg): nudge so it cannot balance
            let upTarget = select(vec3<f32>(0.0, -1.0, 0.0), vec3<f32>(0.0, 1.0, 0.0), zaxis.y >= 0.0);
            angVel += cross(zaxis, upTarget) * (params.dt * GTIP_FLAT);
        }
        angVel *= 0.93;
        if (stableSupport && length(vel) < WAKE_LIN && length(angVel) < WAKE_ANG && pushMag < PUSH_REST) {
            sleepTimer += params.dt;
        } else {
            sleepTimer = 0.0;
        }
        if (sleepTimer >= SLEEP_TIME) {
            vel = vec3<f32>(0.0);
            angVel = vec3<f32>(0.0);
        }
    } else {
        sleepTimer = 0.0;   // airborne -> never sleeps
    }

    // Recycle pieces that fall off the floor edge.
    if (pos.y < -15.0) {
        let salt = i * 2654435761u + u32(params.elapsedTime * 60.0) * 40503u;
        let fx = f32((salt >> 0u) & 1023u) / 1023.0;
        let fy = f32((salt >> 10u) & 1023u) / 1023.0;
        let fz = f32((salt >> 20u) & 1023u) / 1023.0;
        pos = vec3<f32>((fx - 0.5) * 15.0, (fy + 1.0) * 15.0, (fz - 0.5) * 15.0);
        vel = vec3<f32>(0.0, -0.3, 0.0);
        rot = normalizeQ(vec4<f32>(fx - 0.5, fz - 0.5, seed - 0.5, 1.0));
        angVel = vec3<f32>(0.0, 0.0, 0.0);
        sleepTimer = 0.0;
    }

    dstStates[i].position = vec4<f32>(pos, seed);
    dstStates[i].velocity = vec4<f32>(vel, sleepTimer);
    dstStates[i].rotation = rot;
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

    const hint = document.getElementById('hint');
    let frameCount = 0, lastFpsT = performance.now(), fps = 0;
    let ping = 0;
    const startTime = performance.now();

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
        const time = (performance.now() - startTime) / 1000;
        device.queue.writeBuffer(simUbo, 0, new Float32Array([dtSub, GRAVITY, time, 0]));

        const ce = device.createCommandEncoder();

        for (let s = 0; s < SUBSTEPS; s++) {
            const cp = ce.beginComputePass();
            cp.setPipeline(computePipeline);
            cp.setBindGroup(0, computeBindGroups[ping]);
            cp.dispatchWorkgroups(Math.ceil(COUNT / 64));
            cp.end();
            ping ^= 1;
        }

        // Each substep flips ping to point at the buffer just written, so the latest state is
        // always in stateBuffers[ping] after the loop (regardless of the substep count parity).
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
