'use strict';

// PHYSICS DEBUG build of the WebGPU + WGSL falling-eraser sample.
//
// Identical solver to ../eraser, but instead of 200 erasers it drops a few probe erasers from
// known poses and graphs their post-landing behaviour on a 2D overlay (top-right): tilt angle,
// |angVel| and height over time. The eraser state is read back from the GPU each frame. Use it to
// compare settling behaviour against the other physics-library eraser samples.
// Press W to toggle the collider wireframe.

// Six faces of a MOMO-style eraser (order: +x, -x, +y, -y, +z, -z).
const ERASER_TEXTURES = [
    '../../../../assets/textures/eraser_003/eraser_right.png',
    '../../../../assets/textures/eraser_003/eraser_left.png',
    '../../../../assets/textures/eraser_003/eraser_top.png',
    '../../../../assets/textures/eraser_003/eraser_bottom.png',
    '../../../../assets/textures/eraser_003/eraser_front.png',
    '../../../../assets/textures/eraser_003/eraser_back.png',
];

const ERASER_COUNT = 5;   // DEBUG: a few erasers for problem isolation (restore to 200 afterwards)
const DEBUG = ERASER_COUNT <= 8;   // when on, read the state back each frame and graph it on-screen
const STATE_FLOATS = 16;
const SUBSTEPS = 5;
const EHE = [1.2, 0.3, 0.6];  // eraser half-extents (2.4 x 0.6 x 1.2), matching the reference eraser samples

// Static collider: a small low floor (no walls, no ramp), matching the flat-floor reference
// eraser samples. The visible plate is a thin 20 x 0.1 x 20 slab at y = -10; the physics floor is
// thicker (top aligned at y = -9.95) so fast erasers cannot tunnel through it.
const GROUND = { center: [0, -10, 0], half: [10, 0.05, 10], angle: 0 };
const GROUND_PHYS = { center: [0, -11.45, 0], half: [10, 1.5, 10] };

let device, ctx, format, canvas;
let depthTexture;
let showWireframe = true;

// ------------------------------------------------------------------ math helpers
function perspectiveZO(fovyDeg, aspect, near, far) {
    // Right-handed perspective mapping depth to [0, 1] (WebGPU convention), column-major.
    const f = 1.0 / Math.tan((fovyDeg * Math.PI / 180) / 2);
    const nf = 1.0 / (near - far);
    return new Float32Array([
        f / aspect, 0, 0, 0,
        0, f, 0, 0,
        0, 0, far * nf, -1,
        0, 0, far * near * nf, 0,
    ]);
}

function lookAt(eye, center, up) {
    let z0 = eye[0] - center[0], z1 = eye[1] - center[1], z2 = eye[2] - center[2];
    let zl = Math.hypot(z0, z1, z2) || 1; z0 /= zl; z1 /= zl; z2 /= zl;
    let x0 = up[1] * z2 - up[2] * z1, x1 = up[2] * z0 - up[0] * z2, x2 = up[0] * z1 - up[1] * z0;
    let xl = Math.hypot(x0, x1, x2) || 1; x0 /= xl; x1 /= xl; x2 /= xl;
    const y0 = z1 * x2 - z2 * x1, y1 = z2 * x0 - z0 * x2, y2 = z0 * x1 - z1 * x0;
    return new Float32Array([
        x0, y0, z0, 0,
        x1, y1, z1, 0,
        x2, y2, z2, 0,
        -(x0 * eye[0] + x1 * eye[1] + x2 * eye[2]),
        -(y0 * eye[0] + y1 * eye[1] + y2 * eye[2]),
        -(z0 * eye[0] + z1 * eye[1] + z2 * eye[2]), 1,
    ]);
}

function mat4mul(a, b) {
    const r = new Float32Array(16);
    for (let c = 0; c < 4; c++)
        for (let row = 0; row < 4; row++) {
            let s = 0;
            for (let k = 0; k < 4; k++) s += a[k * 4 + row] * b[c * 4 + k];
            r[c * 4 + row] = s;
        }
    return r;
}

// ------------------------------------------------------------------ geometry
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
            uvs.push((localUV[c][0] + fi) / 6, localUV[c][1]);
        }
        indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    });
    return { positions: new Float32Array(positions), normals: new Float32Array(normals), uvs: new Float32Array(uvs), indices: new Uint16Array(indices) };
}

// World-space triangles (positions + normals) for a box, rotated about the Z axis.
function appendBox(pos, nrm, center, half, angleZ) {
    const c = Math.cos(angleZ), s = Math.sin(angleZ);
    const tr = (x, y, z) => [c * x - s * y + center[0], s * x + c * y + center[1], z + center[2]];
    const trn = (x, y, z) => [c * x - s * y, s * x + c * y, z];
    const faces = [
        { n: [1, 0, 0], q: [[1, -1, -1], [1, -1, 1], [1, 1, 1], [1, 1, -1]] },
        { n: [-1, 0, 0], q: [[-1, -1, 1], [-1, -1, -1], [-1, 1, -1], [-1, 1, 1]] },
        { n: [0, 1, 0], q: [[-1, 1, -1], [1, 1, -1], [1, 1, 1], [-1, 1, 1]] },
        { n: [0, -1, 0], q: [[-1, -1, 1], [1, -1, 1], [1, -1, -1], [-1, -1, -1]] },
        { n: [0, 0, 1], q: [[1, -1, 1], [-1, -1, 1], [-1, 1, 1], [1, 1, 1]] },
        { n: [0, 0, -1], q: [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1]] },
    ];
    for (const f of faces) {
        const n = trn(f.n[0], f.n[1], f.n[2]);
        const v = f.q.map((k) => tr(k[0] * half[0], k[1] * half[1], k[2] * half[2]));
        for (const idx of [0, 1, 2, 0, 2, 3]) {
            pos.push(v[idx][0], v[idx][1], v[idx][2]);
            nrm.push(n[0], n[1], n[2]);
        }
    }
}

function buildStaticGeometry() {
    const pos = [], nrm = [];
    appendBox(pos, nrm, GROUND.center, GROUND.half, GROUND.angle);
    return { positions: new Float32Array(pos), normals: new Float32Array(nrm), count: pos.length / 3 };
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

// DEBUG colours/labels for the 5 probe erasers (kept in sync with the setup below).
const DEBUG_COLORS = ['#ff5555', '#55dd55', '#5599ff', '#ffaa33', '#ff66dd'];
const DEBUG_LABELS = ['flat x=-6', 'flat x=0', 'tilt45 x=4', 'yaw x=-3', 'tumble x=6'];

function createInitialStates() {
    const states = new Float32Array(ERASER_COUNT * STATE_FLOATS);

    // DEBUG: 5 erasers dropped from known poses to probe the *post-landing* settling. Spread
    // across x so we can see whether position still affects the landing (the old contact-lever bug).
    if (DEBUG && ERASER_COUNT <= 8) {
        const setup = [
            { x: -6, eul: [0.0, 0.0, 0.0], w: [0, 0, 0] },   // flat, far out
            { x:  0, eul: [0.0, 0.0, 0.0], w: [0, 0, 0] },   // flat, centre (baseline)
            { x:  4, eul: [0.8, 0.0, 0.0], w: [0, 0, 0] },   // tilted ~46 deg, should tip flat
            { x: -3, eul: [0.0, 0.0, 0.0], w: [0, 4, 0] },   // flat + yaw spin
            { x:  6, eul: [0.5, 0.5, 0.5], w: [3, 3, 3] },   // full tumble, far out
        ];
        for (let i = 0; i < ERASER_COUNT; i++) {
            const s = setup[i % setup.length];
            const base = i * STATE_FLOATS;
            const q = quatFromEuler(s.eul[0], s.eul[1], s.eul[2]);
            states[base + 0] = s.x; states[base + 1] = 14; states[base + 2] = 0; states[base + 3] = 0.5;
            states[base + 8] = q[0]; states[base + 9] = q[1]; states[base + 10] = q[2]; states[base + 11] = q[3];
            states[base + 12] = s.w[0]; states[base + 13] = s.w[1]; states[base + 14] = s.w[2];
        }
        return states;
    }

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

// ------------------------------------------------------------------ WebGPU helpers
function mkVB(data) {
    const buf = device.createBuffer({ size: data.byteLength, usage: GPUBufferUsage.VERTEX, mappedAtCreation: true });
    new Float32Array(buf.getMappedRange()).set(data);
    buf.unmap();
    return buf;
}
function mkIB(data) {
    const buf = device.createBuffer({ size: data.byteLength, usage: GPUBufferUsage.INDEX, mappedAtCreation: true });
    new Uint16Array(buf.getMappedRange()).set(data);
    buf.unmap();
    return buf;
}

async function loadEraserAtlas() {
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
    const c2d = atlas.getContext('2d');
    for (let i = 0; i < images.length; i++) c2d.drawImage(images[i], i * cell, 0, cell, cell);
    const tex = device.createTexture({
        size: [atlas.width, atlas.height, 1],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    device.queue.copyExternalImageToTexture({ source: atlas }, { texture: tex }, [atlas.width, atlas.height]);
    return tex;
}

function createDepthTexture() {
    return device.createTexture({
        size: { width: canvas.width, height: canvas.height, depthOrArrayLayers: 1 },
        format: 'depth24plus',
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
}

// ------------------------------------------------------------------ WGSL: compute (OBB SAT solver)
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

// Full-scale solver tuning shared with the WGSL shogi sample (the same OBB solver at this scale).
const ANG_SCALE : f32 = 0.18;
const PEN_SLOP  : f32 = 0.006;
const BAUMGARTE : f32 = 0.4;
const MAX_PUSH  : f32 = 0.06;
const WAKE_LIN  : f32 = 0.15;
const WAKE_ANG  : f32 = 0.6;
const SLEEP_TIME : f32 = 0.4;
const GTIP : f32 = 4.5;
// Gentle bias toward lying flat (big face down): the gravity-tip torque vanishes once a box is
// balanced, so without this a box can stand on a thin edge. Kept weak so a jumbled pile does not
// get forced flat (the reference Oimo/Havok piles settle at mixed angles too).
const GTIP_FLAT : f32 = 1.0;

// Collide this eraser (A) against another OBB (B). Only the six face normals are used as
// separating axes (no edge cross-products), so the contact normal is a stable face direction.
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

    var r = collide(pos, vel, angVel, axA, GROUND_C, vec3<f32>(0.0), identity, GROUND_HE, 1.0, 1.0, 0.2, 0.5);
    pos += r.dPos; vel += r.dVel; angVel += r.dAng; contacts += r.hit; leverSum += r.lever;

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
        sleepTimer = 0.0;
    }

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

// ------------------------------------------------------------------ WGSL: render (erasers)
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
    out.position = camera.viewProjection * vec4<f32>(worldPos, 1.0);
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

// ------------------------------------------------------------------ WGSL: static ground
const staticWGSL = `
struct Camera { viewProjection : mat4x4<f32>, }
@group(0) @binding(0) var<uniform> camera : Camera;
struct VSOut { @builtin(position) position : vec4<f32>, @location(0) normal : vec3<f32>, }
@vertex
fn vs(@location(0) position:vec3<f32>, @location(1) normal:vec3<f32>) -> VSOut {
    var out : VSOut;
    out.position = camera.viewProjection * vec4<f32>(position, 1.0);
    out.normal = normal;
    return out;
}
@fragment
fn fs(@location(0) normal:vec3<f32>) -> @location(0) vec4<f32> {
    let lightDir = normalize(vec3<f32>(0.5, 0.9, 0.35));
    let diffuse = max(dot(normalize(normal), lightDir), 0.3);
    return vec4<f32>(vec3<f32>(0.26, 0.27, 0.30) * diffuse, 1.0);
}
`;

// ------------------------------------------------------------------ WGSL: wireframe
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
    return camera.viewProjection * vec4<f32>(worldPos, 1.0);
}
@fragment
fn fs() -> @location(0) vec4<f32> { return vec4<f32>(1.0, 0.85, 0.1, 1.0); }
`;

// ------------------------------------------------------------------ app state
let camUbo, simUbo;
let stateBuffers, computeBindGroups, renderBindGroups, wireBindGroups;
let computePipeline, renderPipeline, wirePipeline, staticPipeline, staticBindGroup;
let positionBuffer, normalBuffer, uvBuffer, indexBuffer, indexCount;
let wireVB, wireIB, wireCount;
let staticVB, staticCount;
let currentState = 0;
let startTime = 0, lastTime = 0;
let frameCount = 0, lastFpsT = 0, fps = 0;
// DEBUG: GPU readback + on-screen time-series graphs.
let debugReadback = null, debugPending = false, debugCanvas = null, debugCtx = null;
const debugSamples = Array.from({ length: ERASER_COUNT }, () => []);  // per eraser: {t, tilt, w, y}

function updateCamera(dt) {
    // Fixed head-on camera matching the reference eraser samples: eye at (0,0,40) looking at the
    // origin, 45 deg vertical FOV, no auto-rotation.
    const eye = [0, 0, 40], target = [0, 0, 0];
    const proj = perspectiveZO(45, canvas.width / canvas.height, 0.1, 1000);
    const view = lookAt(eye, target, [0, 1, 0]);
    device.queue.writeBuffer(camUbo, 0, mat4mul(proj, view));
}

function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    if (depthTexture) depthTexture.destroy();
    depthTexture = createDepthTexture();
}

// DEBUG: draw three stacked time-series graphs (tilt angle, |angVel|, height) for the probe
// erasers onto a 2D overlay canvas, so the post-landing behaviour is visible without console logs.
function drawDebugViz() {
    if (!debugCanvas) {
        debugCanvas = document.createElement('canvas');
        debugCanvas.width = 520; debugCanvas.height = 420;
        Object.assign(debugCanvas.style, {
            position: 'fixed', right: '8px', top: '8px', zIndex: 9999,
            background: 'rgba(0,0,0,0.72)', border: '1px solid #444', borderRadius: '4px',
        });
        document.body.appendChild(debugCanvas);
        debugCtx = debugCanvas.getContext('2d');
    }
    const ctx = debugCtx, W = debugCanvas.width;
    ctx.clearRect(0, 0, W, debugCanvas.height);
    ctx.font = '11px monospace'; ctx.textBaseline = 'middle';

    // Legend
    let lx = 10;
    for (let k = 0; k < ERASER_COUNT; k++) {
        ctx.fillStyle = DEBUG_COLORS[k];
        ctx.fillRect(lx, 6, 10, 10);
        ctx.fillText(DEBUG_LABELS[k], lx + 13, 12);
        lx += 13 + ctx.measureText(DEBUG_LABELS[k]).width + 12;
    }

    // Common time window across all erasers (last ~8 s).
    let tMax = 0;
    for (const s of debugSamples) if (s.length) tMax = Math.max(tMax, s[s.length - 1].t);
    const tMin = Math.max(0, tMax - 8);

    const panels = [
        { title: 'tilt angle (deg) - 0=flat, ~90=on edge', key: 'tilt', lo: 0, hi: 95, guide: 0 },
        { title: '|angVel| (rad/s) - should settle to 0', key: 'w', lo: 0, hi: 6, guide: 0 },
        { title: 'height y - rests ~ -9.65 if flat', key: 'y', lo: -11, hi: 16, guide: -9.65 },
    ];
    const padL = 38, padR = 10, top0 = 26, ph = 116, gap = 16;

    panels.forEach((p, pi) => {
        const y0 = top0 + pi * (ph + gap), x0 = padL, pw = W - padL - padR;
        // frame + title
        ctx.strokeStyle = '#666'; ctx.lineWidth = 1; ctx.strokeRect(x0, y0, pw, ph);
        ctx.fillStyle = '#ccc'; ctx.fillText(p.title, x0, y0 - 7);
        const vy = (v) => y0 + ph - ((v - p.lo) / (p.hi - p.lo)) * ph;
        // y ticks
        ctx.fillStyle = '#888';
        for (let g = 0; g <= 4; g++) {
            const v = p.lo + (p.hi - p.lo) * g / 4, yy = vy(v);
            ctx.strokeStyle = '#333'; ctx.beginPath(); ctx.moveTo(x0, yy); ctx.lineTo(x0 + pw, yy); ctx.stroke();
            ctx.fillText(v.toFixed(p.key === 'y' ? 0 : (p.hi <= 6 ? 1 : 0)), 2, yy);
        }
        // guide line (target)
        if (p.guide >= p.lo && p.guide <= p.hi) {
            ctx.strokeStyle = '#00ff9988'; ctx.setLineDash([4, 3]); ctx.beginPath();
            ctx.moveTo(x0, vy(p.guide)); ctx.lineTo(x0 + pw, vy(p.guide)); ctx.stroke(); ctx.setLineDash([]);
        }
        // series
        for (let k = 0; k < ERASER_COUNT; k++) {
            const s = debugSamples[k];
            ctx.strokeStyle = DEBUG_COLORS[k]; ctx.lineWidth = 1.5; ctx.beginPath();
            let started = false;
            for (const pt of s) {
                if (pt.t < tMin) continue;
                const xx = x0 + ((pt.t - tMin) / (tMax - tMin || 1)) * pw;
                const yy = Math.max(y0, Math.min(y0 + ph, vy(pt[p.key])));
                if (!started) { ctx.moveTo(xx, yy); started = true; } else ctx.lineTo(xx, yy);
            }
            ctx.stroke();
        }
    });
}

function render() {
    const now = performance.now();
    const dt = Math.min((now - lastTime) / 1000, 1 / 30);
    lastTime = now;
    const time = (now - startTime) / 1000;

    updateCamera(dt);
    // Fixed timestep (matches the WGSL shogi sample) so the solver tuning is stable.
    device.queue.writeBuffer(simUbo, 0, new Float32Array([1 / (60 * SUBSTEPS), 9.8, time, 0]));

    const encoder = device.createCommandEncoder();
    const wg = Math.ceil(ERASER_COUNT / 64);
    for (let s = 0; s < SUBSTEPS; s++) {
        const cp = encoder.beginComputePass();
        cp.setPipeline(computePipeline);
        cp.setBindGroup(0, computeBindGroups[currentState]);
        cp.dispatchWorkgroups(wg);
        cp.end();
        currentState = 1 - currentState;
    }

    const pass = encoder.beginRenderPass({
        colorAttachments: [{
            view: ctx.getCurrentTexture().createView(),
            clearValue: { r: 0.5, g: 0.5, b: 0.8, a: 1.0 },
            loadOp: 'clear',
            storeOp: 'store',
        }],
        depthStencilAttachment: {
            view: depthTexture.createView(),
            depthClearValue: 1.0,
            depthLoadOp: 'clear',
            depthStoreOp: 'store',
        },
    });

    pass.setPipeline(staticPipeline);
    pass.setBindGroup(0, staticBindGroup);
    pass.setVertexBuffer(0, staticVB);
    pass.draw(staticCount);

    pass.setPipeline(renderPipeline);
    pass.setBindGroup(0, renderBindGroups[currentState]);
    pass.setVertexBuffer(0, positionBuffer);
    pass.setVertexBuffer(1, normalBuffer);
    pass.setVertexBuffer(2, uvBuffer);
    pass.setIndexBuffer(indexBuffer, 'uint16');
    pass.drawIndexed(indexCount, ERASER_COUNT);

    if (showWireframe) {
        pass.setPipeline(wirePipeline);
        pass.setBindGroup(0, wireBindGroups[currentState]);
        pass.setVertexBuffer(0, wireVB);
        pass.setIndexBuffer(wireIB, 'uint16');
        pass.drawIndexed(wireCount, ERASER_COUNT);
    }

    pass.end();

    // DEBUG: copy every eraser's latest state into the readback buffer (only when no map is pending).
    const doReadback = DEBUG && debugReadback && !debugPending;
    if (doReadback) {
        encoder.copyBufferToBuffer(stateBuffers[currentState], 0, debugReadback, 0, ERASER_COUNT * STATE_FLOATS * 4);
    }

    device.queue.submit([encoder.finish()]);

    if (doReadback) {
        debugPending = true;
        debugReadback.mapAsync(GPUMapMode.READ).then(() => {
            const a = new Float32Array(debugReadback.getMappedRange()).slice();
            debugReadback.unmap();
            debugPending = false;
            for (let k = 0; k < ERASER_COUNT; k++) {
                const o = k * STATE_FLOATS;
                const qx = a[o + 8], qy = a[o + 9], qz = a[o + 10];
                // Tilt of the eraser's big face from horizontal: angle of its local up-axis from
                // world up. 0 deg = lying flat, ~90 deg = standing on an edge. |upY| so either
                // large face counts as flat.
                const upY = 1 - 2 * (qx * qx + qz * qz);
                const tilt = Math.acos(Math.min(1, Math.abs(upY))) * 180 / Math.PI;
                const w = Math.hypot(a[o + 12], a[o + 13], a[o + 14]);
                const s = debugSamples[k];
                s.push({ t: time, tilt, w, y: a[o + 1] });
                if (s.length > 900) s.shift();
            }
            drawDebugViz();
        });
    }

    frameCount++;
    if (now - lastFpsT > 500) {
        fps = (frameCount * 1000 / (now - lastFpsT)) | 0;
        frameCount = 0; lastFpsT = now;
        const hint = document.getElementById('hint');
        if (hint) hint.textContent = 'W: wireframe ' + (showWireframe ? 'ON' : 'OFF') + ' · ' + fps + ' FPS';
    }

    requestAnimationFrame(render);
}

async function init() {
    canvas = document.getElementById('c');
    if (!navigator.gpu) {
        document.getElementById('hint').textContent = 'WebGPU is not available in this browser.';
        return;
    }
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) { document.getElementById('hint').textContent = 'Failed to get GPU adapter.'; return; }
    device = await adapter.requestDevice();

    ctx = canvas.getContext('webgpu');
    format = navigator.gpu.getPreferredCanvasFormat();
    ctx.configure({ device, format, alphaMode: 'opaque' });

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    depthTexture = createDepthTexture();
    window.addEventListener('resize', resize);

    window.addEventListener('keydown', (e) => {
        const isWKey = e.code === 'KeyW' || e.key === 'w' || e.key === 'W';
        if (!isWKey || e.repeat) return;
        showWireframe = !showWireframe;
        const hint = document.getElementById('hint');
        if (hint) hint.textContent = 'W: wireframe ' + (showWireframe ? 'ON' : 'OFF');
    });

    // Geometry
    const box = buildEraserBox();
    positionBuffer = mkVB(box.positions);
    normalBuffer = mkVB(box.normals);
    uvBuffer = mkVB(box.uvs);
    indexBuffer = mkIB(box.indices);
    indexCount = box.indices.length;

    const wirePos = new Float32Array([
        -1, -1, -1, 1, -1, -1, 1, 1, -1, -1, 1, -1,
        -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1,
    ]);
    const wireIdx = new Uint16Array([0, 1, 1, 2, 2, 3, 3, 0, 4, 5, 5, 6, 6, 7, 7, 4, 0, 4, 1, 5, 2, 6, 3, 7]);
    wireVB = mkVB(wirePos);
    wireIB = mkIB(wireIdx);
    wireCount = wireIdx.length;

    const staticGeo = buildStaticGeometry();
    const staticInterleavedPos = staticGeo.positions;
    const staticInterleavedNrm = staticGeo.normals;
    staticVB = (() => {
        // interleave position + normal into one buffer
        const n = staticGeo.count;
        const data = new Float32Array(n * 6);
        for (let i = 0; i < n; i++) {
            data[i * 6 + 0] = staticInterleavedPos[i * 3 + 0];
            data[i * 6 + 1] = staticInterleavedPos[i * 3 + 1];
            data[i * 6 + 2] = staticInterleavedPos[i * 3 + 2];
            data[i * 6 + 3] = staticInterleavedNrm[i * 3 + 0];
            data[i * 6 + 4] = staticInterleavedNrm[i * 3 + 1];
            data[i * 6 + 5] = staticInterleavedNrm[i * 3 + 2];
        }
        return mkVB(data);
    })();
    staticCount = staticGeo.count;

    // Texture
    const atlasTex = await loadEraserAtlas();
    const atlasView = atlasTex.createView();
    const texSampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });

    // Uniforms + state buffers (ping-pong)
    camUbo = device.createBuffer({ size: 16 * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    simUbo = device.createBuffer({ size: 4 * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    const initStates = createInitialStates();
    stateBuffers = [0, 1].map(() => {
        const buf = device.createBuffer({ size: ERASER_COUNT * STATE_FLOATS * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC, mappedAtCreation: true });
        new Float32Array(buf.getMappedRange()).set(initStates);
        buf.unmap();
        return buf;
    });

    // DEBUG: a CPU-readable buffer to copy every eraser's state into each frame.
    if (DEBUG) {
        debugReadback = device.createBuffer({ size: ERASER_COUNT * STATE_FLOATS * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    }

    // Pipelines
    const computeModule = device.createShaderModule({ code: computeWGSL });
    const renderModule = device.createShaderModule({ code: renderWGSL });
    const wireModule = device.createShaderModule({ code: wireWGSL });
    const staticModule = device.createShaderModule({ code: staticWGSL });

    computePipeline = device.createComputePipeline({ layout: 'auto', compute: { module: computeModule, entryPoint: 'main' } });

    renderPipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: {
            module: renderModule, entryPoint: 'vs',
            buffers: [
                { arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] },
                { arrayStride: 12, attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x3' }] },
                { arrayStride: 8, attributes: [{ shaderLocation: 2, offset: 0, format: 'float32x2' }] },
            ],
        },
        fragment: { module: renderModule, entryPoint: 'fs', targets: [{ format }] },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        depthStencil: { depthWriteEnabled: true, depthCompare: 'less', format: 'depth24plus' },
    });

    staticPipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: {
            module: staticModule, entryPoint: 'vs',
            buffers: [{ arrayStride: 24, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x3' }] }],
        },
        fragment: { module: staticModule, entryPoint: 'fs', targets: [{ format }] },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        depthStencil: { depthWriteEnabled: true, depthCompare: 'less', format: 'depth24plus' },
    });

    wirePipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: {
            module: wireModule, entryPoint: 'vs',
            buffers: [{ arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] }],
        },
        fragment: { module: wireModule, entryPoint: 'fs', targets: [{ format }] },
        primitive: { topology: 'line-list' },
        depthStencil: { depthWriteEnabled: false, depthCompare: 'less-equal', format: 'depth24plus' },
    });

    computeBindGroups = [0, 1].map((s) => device.createBindGroup({
        layout: computePipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: stateBuffers[s] } },
            { binding: 1, resource: { buffer: stateBuffers[1 - s] } },
            { binding: 2, resource: { buffer: simUbo } },
        ],
    }));
    renderBindGroups = [0, 1].map((s) => device.createBindGroup({
        layout: renderPipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: camUbo } },
            { binding: 1, resource: { buffer: stateBuffers[s] } },
            { binding: 2, resource: texSampler },
            { binding: 3, resource: atlasView },
        ],
    }));
    wireBindGroups = [0, 1].map((s) => device.createBindGroup({
        layout: wirePipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: camUbo } },
            { binding: 1, resource: { buffer: stateBuffers[s] } },
        ],
    }));
    staticBindGroup = device.createBindGroup({
        layout: staticPipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: camUbo } }],
    });

    startTime = performance.now();
    lastTime = startTime;
    lastFpsT = startTime;
    requestAnimationFrame(render);
}

init().catch((error) => { console.error(error); const h = document.getElementById('hint'); if (h) h.textContent = String(error.message || error); });
