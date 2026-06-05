'use strict';

// Babylon.js (WebGPUEngine) provides the camera, skybox, environment and ground, while the
// erasers are simulated and drawn entirely on the GPU through custom WGSL compute + render
// passes that share Babylon's WebGPU device. Box-shaped (MONO-style) erasers rain onto a small
// low floor and overflow the edges, the spilled ones recycling from the top (a "fountain"),
// matching the flat-floor reference eraser samples; the physics is an oriented-bounding-box
// solver using the Separating Axis Theorem for eraser-eraser and eraser-static contacts.
//
// The erasers are rendered into a RenderTargetTexture and composited over the Babylon scene
// with a Layer. Press W to toggle the collider wireframe.

const BASE_URL = 'https://cx20.github.io/gltf-test';
// Six faces of a MONO-style eraser (order: +x, -x, +y, -y, +z, -z).
const ERASER_TEXTURES = [
    '../../../../assets/textures/eraser_003/eraser_right.png',
    '../../../../assets/textures/eraser_003/eraser_left.png',
    '../../../../assets/textures/eraser_003/eraser_top.png',
    '../../../../assets/textures/eraser_003/eraser_bottom.png',
    '../../../../assets/textures/eraser_003/eraser_front.png',
    '../../../../assets/textures/eraser_003/eraser_back.png',
];

const ERASER_COUNT = 200;
const STATE_FLOATS = 16;
const SUBSTEPS = 5;
const EHE = [1.2, 0.3, 0.6];  // eraser half-extents (2.4 x 0.6 x 1.2), matching the reference eraser samples

// Static collider: a small low floor (no walls, no ramp), matching the flat-floor reference
// eraser samples. The visible plate is a thin 20 x 0.1 x 20 slab at y = -10; the physics floor is
// thicker (top aligned at y = -9.95) so fast erasers cannot tunnel through it.
const GROUND = { center: [0, -10, 0], half: [10, 0.05, 10], angle: 0 };
const GROUND_PHYS = { center: [0, -11.45, 0], half: [10, 1.5, 10] };

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

async function loadEraserAtlas(device) {
    const cell = 256;
    const images = await Promise.all(ERASER_TEXTURES.map(async (src) => {
        const img = document.createElement('img');
        img.src = src;
        await img.decode();
        return img;
    }));
    const atlas = document.createElement('canvas');
    atlas.width = cell * images.length;
    atlas.height = cell;
    const ctx = atlas.getContext('2d');
    for (let i = 0; i < images.length; i++) ctx.drawImage(images[i], i * cell, 0, cell, cell);
    const tex = device.createTexture({
        size: [atlas.width, atlas.height, 1],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    device.queue.copyExternalImageToTexture({ source: atlas }, { texture: tex }, [atlas.width, atlas.height]);
    return tex;
}

// Unit box (half-extent 1) with per-face normals and atlas UVs (face f -> column f of 6).
function buildEraserBox() {
    const faces = [
        { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },
        { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
        { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },
        { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
        { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
        { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
    ];
    const positions = [], normals = [], uvs = [], indices = [];
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    const localUV = [[0, 1], [1, 1], [1, 0], [0, 0]];
    faces.forEach((f, fi) => {
        const base = positions.length / 3;
        for (let c = 0; c < 4; c++) {
            const [su, sv] = corners[c];
            positions.push(
                f.n[0] + f.u[0] * su + f.v[0] * sv,
                f.n[1] + f.u[1] * su + f.v[1] * sv,
                f.n[2] + f.u[2] * su + f.v[2] * sv,
            );
            normals.push(...f.n);
            // Mirror the local U within the face's atlas column: Babylon's left-handed viewProj
            // flips X, so without this the face text reads back-to-front.
            uvs.push(((1.0 - localUV[c][0]) + fi) / 6, localUV[c][1]);
        }
        indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    });
    return { positions: new Float32Array(positions), normals: new Float32Array(normals), uvs: new Float32Array(uvs), indices: new Uint16Array(indices) };
}

function quatFromEuler(x, y, z) {
    const cx = Math.cos(x * 0.5), sx = Math.sin(x * 0.5);
    const cy = Math.cos(y * 0.5), sy = Math.sin(y * 0.5);
    const cz = Math.cos(z * 0.5), sz = Math.sin(z * 0.5);
    return [sx * cy * cz + cx * sy * sz, cx * sy * cz - sx * cy * sz, cx * cy * sz + sx * sy * cz, cx * cy * cz - sx * sy * sz];
}

// Hash-based PRNG (matches the WGSL shogi sample) so each eraser gets well-distributed,
// per-axis-independent random values.
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
    const states = new Float32Array(ERASER_COUNT * STATE_FLOATS);
    for (let i = 0; i < ERASER_COUNT; i++) {
        const base = i * STATE_FLOATS;
        const seed = hash32(i + 1);
        // Decorrelate every axis (the old i-based pattern spawned the erasers in neat columns):
        // random x,z over the floor, a random orientation and a random tumble so they rain down
        // and settle in a natural jumble. Keep the height loosely stratified by i (plus jitter) so
        // they do not all overlap at the instant they spawn.
        states[base + 0] = (hashF(seed)     - 0.5) * 12;                          // x in +/-6
        states[base + 1] = 14 + (i / ERASER_COUNT) * 14 + (hashF(seed + 1) - 0.5) * 2; // y ~14..28
        states[base + 2] = (hashF(seed + 2) - 0.5) * 12;                          // z in +/-6
        states[base + 3] = hashF(seed + 6);                                       // seed (0..1)
        const q = quatFromEuler(
            (hashF(seed + 7) - 0.5) * Math.PI * 2,
            (hashF(seed + 8) - 0.5) * Math.PI * 2,
            (hashF(seed + 9) - 0.5) * Math.PI * 2);
        states[base + 8]  = q[0];
        states[base + 9]  = q[1];
        states[base + 10] = q[2];
        states[base + 11] = q[3];
        states[base + 12] = (hashF(seed + 3) - 0.5) * 6;                          // tumble (angVel)
        states[base + 13] = (hashF(seed + 4) - 0.5) * 6;
        states[base + 14] = (hashF(seed + 5) - 0.5) * 6;
    }
    return states;
}

const createScene = async function () {
    const scene = new BABYLON.Scene(engine);
    // Fixed head-on camera matching the reference eraser samples: eye at (0,0,40) looking at the
    // origin, 45 deg vertical FOV.
    const camera = new BABYLON.ArcRotateCamera('camera',
        -Math.PI / 2, Math.PI / 2, 40,
        BABYLON.Vector3.Zero(), scene);
    camera.setTarget(BABYLON.Vector3.Zero());
    camera.fov = 45 * Math.PI / 180;
    camera.attachControl(canvas, true);
    camera.minZ = 0.1;
    camera.maxZ = 1000;

    const cubeTexture = new BABYLON.CubeTexture(
        BASE_URL + '/textures/env/papermillSpecularHDR.env', scene);
    scene.createDefaultSkybox(cubeTexture, true);
    scene.environmentTexture = cubeTexture;
    new BABYLON.HemisphericLight('light0', new BABYLON.Vector3(0.4, 1, 0.3), scene);

    await waitForReady(cubeTexture);

    const staticMat = new BABYLON.PBRMaterial('staticMat', scene);
    staticMat.metallic = 0;
    staticMat.roughness = 0.9;
    staticMat.albedoColor = new BABYLON.Color3(0.24, 0.25, 0.28);

    const ground = BABYLON.MeshBuilder.CreateBox('ground', { width: GROUND.half[0] * 2, height: GROUND.half[1] * 2, depth: GROUND.half[2] * 2 }, scene);
    ground.position.set(GROUND.center[0], GROUND.center[1], GROUND.center[2]);
    ground.material = staticMat;

    // ============================================================
    // Custom WebGPU path (shares Babylon's device)
    // ============================================================
    const device = engine._device;

    const atlasTex = await loadEraserAtlas(device);
    const atlasView = atlasTex.createView();
    const texSampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });

    const mkVB = (data) => {
        const buf = device.createBuffer({ size: data.byteLength, usage: GPUBufferUsage.VERTEX, mappedAtCreation: true });
        new Float32Array(buf.getMappedRange()).set(data);
        buf.unmap();
        return buf;
    };
    const mkIB = (data) => {
        const buf = device.createBuffer({ size: data.byteLength, usage: GPUBufferUsage.INDEX, mappedAtCreation: true });
        new Uint16Array(buf.getMappedRange()).set(data);
        buf.unmap();
        return buf;
    };

    const box = buildEraserBox();
    const positionBuffer = mkVB(box.positions);
    const normalBuffer = mkVB(box.normals);
    const uvBuffer = mkVB(box.uvs);
    const indexBuffer = mkIB(box.indices);

    // Box edge wireframe (unit box).
    const wirePos = new Float32Array([
        -1, -1, -1, 1, -1, -1, 1, 1, -1, -1, 1, -1,
        -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1,
    ]);
    const wireIdx = new Uint16Array([0, 1, 1, 2, 2, 3, 3, 0, 4, 5, 5, 6, 6, 7, 7, 4, 0, 4, 1, 5, 2, 6, 3, 7]);
    const wireVB = mkVB(wirePos);
    const wireIB = mkIB(wireIdx);
    const wireCount = wireIdx.length;

    const initStates = createInitialStates();
    const stateBuffers = [0, 1].map(() => {
        const buf = device.createBuffer({ size: ERASER_COUNT * STATE_FLOATS * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, mappedAtCreation: true });
        new Float32Array(buf.getMappedRange()).set(initStates);
        buf.unmap();
        return buf;
    });

    const camUbo = device.createBuffer({ size: 16 * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const simUbo = device.createBuffer({ size: 4 * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    // Physics: oriented bounding boxes resolved with the Separating Axis Theorem. Each eraser
    // is integrated, then collided against the floor and every other eraser.
    const computeWGSL = `
struct EraserState { position:vec4<f32>, velocity:vec4<f32>, rotation:vec4<f32>, angularVel:vec4<f32>, }
struct SimParams { dt:f32, gravity:f32, elapsedTime:f32, pad:f32, }
const COUNT : u32 = ${ERASER_COUNT}u;
const EHE : vec3<f32> = vec3<f32>(${EHE[0]}, ${EHE[1]}, ${EHE[2]});
const GROUND_C : vec3<f32> = vec3<f32>(${GROUND_PHYS.center[0]}, ${GROUND_PHYS.center[1]}, ${GROUND_PHYS.center[2]});
const GROUND_HE : vec3<f32> = vec3<f32>(${GROUND_PHYS.half[0]}, ${GROUND_PHYS.half[1]}, ${GROUND_PHYS.half[2]});

@group(0) @binding(0) var<storage, read>       srcStates : array<EraserState>;
@group(0) @binding(1) var<storage, read_write> dstStates : array<EraserState>;
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

// Angular response is deliberately scaled down: a faithful inertia tensor makes a thin
// eraser spin violently, so we keep it gentle to read as a rigid box settling.
// Full-scale solver tuning shared with the WGSL shogi sample (the same OBB solver at this scale).
const ANG_SCALE : f32 = 0.18;
// Soft resting contact: tolerate a small overlap (PEN_SLOP) and push out gently (BAUMGARTE), so
// stacked erasers don't get shoved apart and pulled back every frame (the "trembling" at overlaps).
const PEN_SLOP  : f32 = 0.02;
const BAUMGARTE : f32 = 0.25;
const MAX_PUSH  : f32 = 0.06;
// Sleeping: once a body has been in contact and nearly still for SLEEP_TIME it is frozen (skips
// integration/response entirely) so a settled pile stops trembling. Thresholds are raised a little
// (with the leaky timer below) so a box still sleeps through small residual rocking.
const WAKE_LIN  : f32 = 0.2;
const WAKE_ANG  : f32 = 1.0;
const SLEEP_TIME : f32 = 0.4;
// Gravity torque about the contact: tips an overhanging / edge-balanced box toward a flat
// rest and vanishes once balanced, so (unlike a forced "align" nudge) it does not keep a
// settled pile twitching.
const GTIP : f32 = 4.5;
// Gentle bias toward lying flat (big face down): the gravity-tip torque vanishes once a box is
// balanced, so without this a box can stand on a thin edge. Kept weak so a jumbled pile does not
// get forced flat (the reference Oimo/Havok piles settle at mixed angles too).
const GTIP_FLAT : f32 = 1.0;

// Collide this eraser (A) against another OBB (B). pushFactor/impFactor are 1.0 for an
// immovable static and 0.5 for an eraser-eraser pair (so each takes half). Only the six
// face normals are used as separating axes (skipping the edge cross-products) so the contact
// normal is always a stable face direction, which keeps the boxes from jittering/crawling.
fn collide(pos:vec3<f32>, vel:vec3<f32>, angVel:vec3<f32>, axA:mat3x3<f32>,
           cB:vec3<f32>, velB:vec3<f32>, axB:mat3x3<f32>, heB:vec3<f32>,
           pushFactor:f32, impFactor:f32, restitution:f32, friction:f32) -> Resp {
    var resp : Resp;
    resp.dPos = vec3<f32>(0.0); resp.dVel = vec3<f32>(0.0); resp.dAng = vec3<f32>(0.0); resp.hit = 0.0; resp.normal = vec3<f32>(0.0); resp.lever = vec3<f32>(0.0);
    let T = cB - pos;
    let bsr = length(EHE) + length(heB);
    if (dot(T,T) > bsr*bsr) { return resp; }

    var minPen = 1e9;
    var minAxis = vec3<f32>(0.0,1.0,0.0);
    var sep = false;
    for (var k=0; k<3; k++) { if (sep) { break; } let pen = satPen(T,axA,EHE,axB,heB,axA[k]); if (pen<=0.0){sep=true;break;} if (pen<minPen){minPen=pen;minAxis=axA[k];} }
    for (var k=0; k<3; k++) { if (sep) { break; } let pen = satPen(T,axA,EHE,axB,heB,axB[k]); if (pen<=0.0){sep=true;break;} if (pen<minPen){minPen=pen;minAxis=axB[k];} }
    if (sep) { return resp; }
    resp.hit = 1.0;

    var n = minAxis;
    if (dot(n, -T) < 0.0) { n = -n; }   // n points from B toward this eraser
    resp.normal = n;
    resp.dPos = n * min(max(minPen - PEN_SLOP, 0.0) * pushFactor * BAUMGARTE, MAX_PUSH);

    // Contact lever = this eraser's support point toward B (its deepest vertex/face in the -n
    // direction). The old code clamped the centre-to-centre vector T, but against the huge floor
    // box T is dominated by the eraser's horizontal offset from the floor centre, so the lever
    // landed at the eraser's side edge and the normal impulse spun it up on contact (worse the
    // further from x=z=0). The support point depends only on the eraser's own orientation.
    let r_i = -sign(dot(n, axA[0])) * EHE.x * axA[0]
            - sign(dot(n, axA[1])) * EHE.y * axA[1]
            - sign(dot(n, axA[2])) * EHE.z * axA[2];
    resp.lever = r_i;

    let relV = vel - velB;
    let relVn = dot(relV, n);
    if (relVn < 0.0) {
        // Only bounce on a fast impact; at low approach speed use no restitution, so a settling box
        // does not rock corner-to-corner forever (a single-contact-point solver cannot rest a face
        // stably with restitution). Keeps the visible landing bounce, kills the resting jitter.
        let rest = select(0.0, restitution, abs(relVn) > 2.0);
        let Jn = -(relVn * (1.0 + rest) * impFactor);
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

    // Asleep: stay frozen (still collidable by others as a static obstacle).
    if (sleepTimer >= SLEEP_TIME) {
        dstStates[i].position = vec4<f32>(pos, seed);
        dstStates[i].velocity = vec4<f32>(0.0, 0.0, 0.0, sleepTimer);
        dstStates[i].rotation = rot;
        dstStates[i].angularVel = vec4<f32>(0.0);
        return;
    }

    vel.y -= params.gravity * params.dt;
    vel *= 0.998;
    // Only a very light airborne angular drag, so erasers keep tumbling all the way down (the old
    // 0.96 killed almost all spin within ~0.5 s of the fall, so they dropped as frozen blocks and
    // then merely crept flat on landing). Resting bodies are damped much harder by the per-contact
    // angVel *= 0.95 below, plus the gravity-tip torque and sleep, so the pile still settles.
    angVel *= 0.999;
    pos += vel * params.dt;

    let sp = length(angVel);
    if (sp > 0.0001) {
        let axis = angVel / sp;
        let half = sp * params.dt * 0.5;
        rot = normalizeQ(quatMul(vec4<f32>(axis * sin(half), cos(half)), rot));
    }

    let axA = quatToAxes(rot);
    let identity = mat3x3<f32>(vec3<f32>(1,0,0), vec3<f32>(0,1,0), vec3<f32>(0,0,1));

    var contacts = 0.0;
    var leverSum = vec3<f32>(0.0);

    // Floor (static).
    var r = collide(pos, vel, angVel, axA, GROUND_C, vec3<f32>(0.0), identity, GROUND_HE, 1.0, 1.0, 0.2, 0.5);
    pos += r.dPos; vel += r.dVel; angVel += r.dAng; contacts += r.hit; leverSum += r.lever;

    // Eraser-eraser (read neighbours from the previous state). Against an already-sleeping
    // neighbour this eraser takes the full push-out (the sleeper acts like a static).
    for (var j = 0u; j < COUNT; j++) {
        if (j == i) { continue; }
        let o = srcStates[j];
        let push = select(0.5, 1.0, o.velocity.w >= SLEEP_TIME);
        r = collide(pos, vel, angVel, axA, o.position.xyz, o.velocity.xyz, quatToAxes(o.rotation), EHE, push, 0.5, 0.1, 0.45);
        pos += r.dPos; vel += r.dVel; angVel += r.dAng; contacts += r.hit; leverSum += r.lever;
    }

    let speed = length(vel);
    if (speed > 18.0) { vel *= 18.0 / speed; }
    if (length(angVel) > 8.0) { angVel *= 8.0 / length(angVel); }

    // Resting bodies: apply a gravity torque about the average contact point. This tips an
    // overhanging or edge-balanced box toward a flat rest but goes to zero once the box is
    // balanced, so a settled pile does not keep twitching. Then freeze it once it has been
    // calm for SLEEP_TIME.
    if (contacts > 0.0) {
        let rAvg = leverSum / contacts;
        angVel += cross(-rAvg, vec3<f32>(0.0, -params.gravity, 0.0)) * (params.dt * GTIP);
        // Bias the big face (local +Y, = axA[1]) toward horizontal so edge-balanced erasers fall
        // flat instead of standing. Target is whichever pole (up/down) the face already leans to.
        let upAxis = axA[1];
        let flatTarget = select(vec3<f32>(0.0, -1.0, 0.0), vec3<f32>(0.0, 1.0, 0.0), upAxis.y >= 0.0);
        angVel += cross(upAxis, flatTarget) * (params.dt * GTIP_FLAT);
        // Light damping while resting; gentle enough that a forming pile can still slide and
        // spread out instead of freezing into a sticky clump.
        angVel *= 0.95;
        if (length(vel) < WAKE_LIN && length(angVel) < WAKE_ANG) {
            sleepTimer += params.dt;
        } else {
            // Leaky reset: a brief jitter spike only drains the accumulated still-time instead of
            // zeroing it, so a nearly-settled box still falls asleep despite tiny residual rocking.
            sleepTimer = max(sleepTimer - params.dt * 3.0, 0.0);
        }
        if (sleepTimer >= SLEEP_TIME) {
            vel = vec3<f32>(0.0);
            angVel = vec3<f32>(0.0);
        }
    } else {
        sleepTimer = 0.0;   // airborne -> never sleeps
    }

    // Recycle erasers that overflow the small floor: respawn them at the top (a "fountain").
    if (pos.y < -15.0) {
        let salt = i * 2654435761u + u32(params.elapsedTime * 60.0) * 40503u;
        let fx = f32((salt >> 0u) & 1023u) / 1023.0;
        let fz = f32((salt >> 10u) & 1023u) / 1023.0;
        pos = vec3<f32>((fx - 0.5) * 12.0, 18.0 + seed * 8.0, (fz - 0.5) * 12.0);
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

    const renderWGSL = `
struct Camera { viewProjection : mat4x4<f32>, }
struct EraserState { position:vec4<f32>, velocity:vec4<f32>, rotation:vec4<f32>, angularVel:vec4<f32>, }
struct VSOut {
    @builtin(position) position : vec4<f32>,
    @location(0) normal : vec3<f32>,
    @location(1) uv : vec2<f32>,
}
const EHE : vec3<f32> = vec3<f32>(${EHE[0]}, ${EHE[1]}, ${EHE[2]});
@group(0) @binding(0) var<uniform>       camera : Camera;
@group(0) @binding(1) var<storage, read> states : array<EraserState>;
@group(0) @binding(2) var                texSampler : sampler;
@group(0) @binding(3) var                atlasTex : texture_2d<f32>;
fn rotByQuat(v:vec3<f32>, q:vec4<f32>) -> vec3<f32> {
    let t = 2.0 * cross(q.xyz, v);
    return v + q.w * t + cross(q.xyz, t);
}
@vertex
fn vs(@location(0) position:vec3<f32>, @location(1) normal:vec3<f32>, @location(2) uv:vec2<f32>, @builtin(instance_index) instance:u32) -> VSOut {
    var out : VSOut;
    let s = states[instance];
    let worldPos = rotByQuat(position * EHE, s.rotation) + s.position.xyz;
    out.normal = normalize(rotByQuat(normal, s.rotation));
    out.uv = uv;
    let clip = camera.viewProjection * vec4<f32>(worldPos, 1.0);
    out.position = vec4<f32>(clip.x, -clip.y, clip.z, clip.w);
    return out;
}
@fragment
fn fs(@location(0) normal:vec3<f32>, @location(1) uv:vec2<f32>) -> @location(0) vec4<f32> {
    let lightDir = normalize(vec3<f32>(0.5, 0.9, 0.35));
    let diffuse = max(dot(normalize(normal), lightDir), 0.28);
    let tex = textureSample(atlasTex, texSampler, uv).rgb;
    return vec4<f32>(pow(tex * diffuse, vec3<f32>(0.85)), 1.0);
}
`;

    const wireWGSL = `
struct Camera { viewProjection : mat4x4<f32>, }
struct EraserState { position:vec4<f32>, velocity:vec4<f32>, rotation:vec4<f32>, angularVel:vec4<f32>, }
const EHE : vec3<f32> = vec3<f32>(${EHE[0]}, ${EHE[1]}, ${EHE[2]});
@group(0) @binding(0) var<uniform>       camera : Camera;
@group(0) @binding(1) var<storage, read> states : array<EraserState>;
fn rotByQuat(v:vec3<f32>, q:vec4<f32>) -> vec3<f32> {
    let t = 2.0 * cross(q.xyz, v);
    return v + q.w * t + cross(q.xyz, t);
}
@vertex
fn vs(@location(0) position:vec3<f32>, @builtin(instance_index) instance:u32) -> @builtin(position) vec4<f32> {
    let s = states[instance];
    let worldPos = rotByQuat(position * EHE, s.rotation) + s.position.xyz;
    let clip = camera.viewProjection * vec4<f32>(worldPos, 1.0);
    return vec4<f32>(clip.x, -clip.y, clip.z, clip.w);
}
@fragment
fn fs() -> @location(0) vec4<f32> { return vec4<f32>(1.0, 0.85, 0.1, 1.0); }
`;

    const computeModule = device.createShaderModule({ code: computeWGSL });
    const renderModule = device.createShaderModule({ code: renderWGSL });
    const wireModule = device.createShaderModule({ code: wireWGSL });

    const computePipeline = device.createComputePipeline({ layout: 'auto', compute: { module: computeModule, entryPoint: 'main' } });

    const rttSize = { width: engine.getRenderWidth(), height: engine.getRenderHeight() };
    const eraserRtt = new BABYLON.RenderTargetTexture('eraserRTT', rttSize, scene, {
        generateMipMaps: false,
        type: BABYLON.Constants.TEXTURETYPE_UNSIGNED_BYTE,
        format: BABYLON.Constants.TEXTUREFORMAT_RGBA,
    });
    const eraserLayer = new BABYLON.Layer('eraserLayer', null, scene, false);
    eraserLayer.texture = eraserRtt;
    eraserLayer.alphaBlendingMode = BABYLON.Engine.ALPHA_COMBINE;

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
            { binding: 1, resource: { buffer: stateBuffers[s] } },
            { binding: 2, resource: texSampler },
            { binding: 3, resource: atlasView },
        ],
    }));
    const wireBindGroups = [0, 1].map((s) => device.createBindGroup({
        layout: wirePipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: camUbo } },
            { binding: 1, resource: { buffer: stateBuffers[s] } },
        ],
    }));

    const hint = document.getElementById('hint');
    let frameCount = 0, lastFpsT = performance.now(), fps = 0;
    let currentState = 0;
    const startTime = performance.now();

    scene.onBeforeRenderObservable.add(() => {
        const internalTex = eraserRtt.getInternalTexture();
        if (!internalTex || !internalTex._hardwareTexture) return;
        const gpuTex = internalTex._hardwareTexture.underlyingResource;
        if (!gpuTex) return;

        const viewProj = camera.getViewMatrix().multiply(camera.getProjectionMatrix());
        device.queue.writeBuffer(camUbo, 0, new Float32Array(viewProj.toArray()));

        const dt = Math.min(engine.getDeltaTime() / 1000, 1 / 30);
        const time = (performance.now() - startTime) / 1000;
        // Fixed timestep (matches the WGSL shogi sample) so the solver tuning is stable.
        device.queue.writeBuffer(simUbo, 0, new Float32Array([1 / (60 * SUBSTEPS), 9.8, time, 0]));

        const ce = device.createCommandEncoder();
        const wg = Math.ceil(ERASER_COUNT / 64);
        for (let s = 0; s < SUBSTEPS; s++) {
            const cp = ce.beginComputePass();
            cp.setPipeline(computePipeline);
            cp.setBindGroup(0, computeBindGroups[currentState]);
            cp.dispatchWorkgroups(wg);
            cp.end();
            currentState = 1 - currentState;
        }

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
            pass.setBindGroup(0, renderBindGroups[currentState]);
            pass.setVertexBuffer(0, positionBuffer);
            pass.setVertexBuffer(1, normalBuffer);
            pass.setVertexBuffer(2, uvBuffer);
            pass.setIndexBuffer(indexBuffer, 'uint16');
            pass.drawIndexed(box.indices.length, ERASER_COUNT);
            if (showWireframe) {
                pass.setPipeline(wirePipeline);
                pass.setBindGroup(0, wireBindGroups[currentState]);
                pass.setVertexBuffer(0, wireVB);
                pass.setIndexBuffer(wireIB, 'uint16');
                pass.drawIndexed(wireCount, ERASER_COUNT);
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
