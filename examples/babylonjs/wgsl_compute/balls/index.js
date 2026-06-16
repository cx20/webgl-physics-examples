'use strict';

// Babylon.js (WebGPUEngine) provides the camera, skybox and environment, while the
// balls and their basket are simulated and drawn entirely on the GPU through custom WGSL
// compute + render passes that share Babylon's WebGPU device. Five textured ball types
// fall into a basket; the physics is O(N^2) sphere-sphere collision plus floor/wall
// contacts, integrated with a ping-pong, sub-stepped solver.
//
// The balls and basket are rendered into a RenderTargetTexture and composited over the
// Babylon scene with a Layer. Press W to toggle the collider wireframe.

const BASE_URL = 'https://cx20.github.io/gltf-test';

const BALL_COUNT = 180;
const STATIC_COUNT = 5;
const STATE_FLOATS = 16;
const INFO_FLOATS = 4;
const STATIC_FLOATS = 12;
const SUBSTEPS = 4;
const BASKET_HALF = 2.5;
const BASKET_TOP = 4.0;
const GROUND_Y = -1.0;
const GROUND_HALF = 10.0;
const RESTITUTIONS = [0.72, 0.82, 0.76, 0.48, 0.72];
const FRICTIONS = [0.035, 0.02, 0.035, 0.08, 0.055];
const BALL_SIZE_SCALES = [1.0, 0.9, 1.0, 0.3, 0.3];
const TEXTURE_FILES = [
    '../../../../assets/textures/Basketball.jpg',
    '../../../../assets/textures/BeachBall.jpg',
    '../../../../assets/textures/Football.jpg',
    '../../../../assets/textures/Softball.jpg',
    '../../../../assets/textures/TennisBall.jpg',
];

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

// ---------------------------------------------------------------- geometry helpers
function createSphereGeometry(segments = 32, rings = 16) {
    const positions = [], normals = [], uvs = [], indices = [];
    for (let y = 0; y <= rings; y++) {
        const v = y / rings;
        const theta = v * Math.PI;
        const sinTheta = Math.sin(theta), cosTheta = Math.cos(theta);
        for (let x = 0; x <= segments; x++) {
            const u = x / segments;
            const phi = u * Math.PI * 2;
            const nx = Math.cos(phi) * sinTheta, ny = cosTheta, nz = Math.sin(phi) * sinTheta;
            positions.push(nx, ny, nz);
            normals.push(nx, ny, nz);
            uvs.push(1 - u, v);
        }
    }
    for (let y = 0; y < rings; y++) {
        for (let x = 0; x < segments; x++) {
            const a = y * (segments + 1) + x;
            const b = a + segments + 1;
            indices.push(a, b, a + 1, b, b + 1, a + 1);
        }
    }
    return { positions: new Float32Array(positions), normals: new Float32Array(normals), uvs: new Float32Array(uvs), indices: new Uint16Array(indices) };
}

function createBoxGeometry() {
    const positions = new Float32Array([
        -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5,
        0.5, -0.5, -0.5, -0.5, -0.5, -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5,
        -0.5, -0.5, -0.5, -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5, -0.5,
        0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5,
        -0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, -0.5, -0.5, 0.5, -0.5,
        -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, -0.5, 0.5, -0.5, -0.5, 0.5,
    ]);
    const normals = new Float32Array([
        0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1,
        0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1,
        -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0,
        1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0,
        0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0,
        0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0,
    ]);
    const uvs = new Float32Array([
        0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1,
        0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1,
        0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1,
    ]);
    const indices = new Uint16Array([
        0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7,
        8, 9, 10, 8, 10, 11, 12, 13, 14, 12, 14, 15,
        16, 17, 18, 16, 18, 19, 20, 21, 22, 20, 22, 23,
    ]);
    return { positions, normals, uvs, indices };
}

// ---------------------------------------------------------------- state init
function createInitialStates() {
    const states = new Float32Array(BALL_COUNT * STATE_FLOATS);
    for (let i = 0; i < BALL_COUNT; i++) {
        const seed = ((i * 37) % 101) / 101;
        const base = i * STATE_FLOATS;
        const col = i % 15;
        const row = Math.floor(i / 15);
        states[base + 0] = (col - 7) * 0.24 + (seed - 0.5) * 0.35;
        states[base + 1] = 7 + row * 0.35 + seed * 5;
        states[base + 2] = (seed - 0.5) * BASKET_HALF * 1.2;
        states[base + 3] = seed;
        states[base + 4] = (seed - 0.5) * 0.12;
        states[base + 5] = -0.05;
        states[base + 6] = (0.5 - seed) * 0.12;
        states[base + 11] = 1;
        states[base + 12] = seed * 0.6;
        states[base + 13] = seed * 0.3;
        states[base + 14] = -seed * 0.4;
    }
    return states;
}

function createBallInfos() {
    const infos = new Float32Array(BALL_COUNT * INFO_FLOATS);
    for (let i = 0; i < BALL_COUNT; i++) {
        const textureIndex = (i * 7) % BALL_SIZE_SCALES.length;
        const seed = ((i * 37) % 101) / 101;
        const radius = (0.5 + seed * 0.25) * BALL_SIZE_SCALES[textureIndex];
        const base = i * INFO_FLOATS;
        infos[base + 0] = radius;
        infos[base + 1] = textureIndex;
        infos[base + 2] = RESTITUTIONS[textureIndex];
        infos[base + 3] = FRICTIONS[textureIndex];
    }
    return infos;
}

function createStaticItems() {
    const items = new Float32Array(STATIC_COUNT * STATIC_FLOATS);
    const data = [
        { pos: [0, -2, 0], scale: [20, 2, 20], color: [0.22, 0.22, 0.24, 1] },
        { pos: [0, 1.5, -2.5], scale: [4.8, 5, 0.4], color: [0.25, 0.28, 0.3, 1] },
        { pos: [0, 1.5, 2.5], scale: [4.8, 5, 0.4], color: [0.25, 0.28, 0.3, 1] },
        { pos: [-2.5, 1.5, 0], scale: [0.4, 5, 4.8], color: [0.25, 0.28, 0.3, 1] },
        { pos: [2.5, 1.5, 0], scale: [0.4, 5, 4.8], color: [0.25, 0.28, 0.3, 1] },
    ];
    for (let i = 0; i < data.length; i++) {
        const base = i * STATIC_FLOATS;
        items.set([...data[i].pos, 0], base);
        items.set([...data[i].scale, 0], base + 4);
        items.set(data[i].color, base + 8);
    }
    return items;
}

async function loadImage(src) {
    const img = document.createElement('img');
    img.src = src;
    await img.decode();
    return img;
}

async function createTextureAtlas(device) {
    const cell = 256;
    const images = await Promise.all(TEXTURE_FILES.map(loadImage));
    const atlas = document.createElement('canvas');
    atlas.width = cell * images.length;
    atlas.height = cell;
    const ctx = atlas.getContext('2d');
    for (let i = 0; i < images.length; i++) {
        ctx.drawImage(images[i], i * cell, 0, cell, cell);
    }
    const tex = device.createTexture({
        size: [atlas.width, atlas.height, 1],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    device.queue.copyExternalImageToTexture({ source: atlas }, { texture: tex }, [atlas.width, atlas.height]);
    return tex;
}

const createScene = async function () {
    const scene = new BABYLON.Scene(engine);
    const camera = new BABYLON.ArcRotateCamera('camera',
        -Math.PI / 180 * 60, Math.PI / 180 * 66, 24,
        BABYLON.Vector3.Zero(), scene);
    camera.setTarget(new BABYLON.Vector3(0, 2, 0));
    camera.attachControl(canvas, true);
    camera.minZ = 0.1;
    camera.maxZ = 150;

    const cubeTexture = new BABYLON.CubeTexture(
        BASE_URL + '/textures/env/papermillSpecularHDR.env', scene);
    scene.createDefaultSkybox(cubeTexture, true);
    scene.environmentTexture = cubeTexture;
    new BABYLON.HemisphericLight('light0', new BABYLON.Vector3(0.4, 1, 0.3), scene);

    await waitForReady(cubeTexture);

    // ============================================================
    // Custom WebGPU path (shares Babylon's device)
    // ============================================================
    const device = engine._device;

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
    const mkMesh = (g) => ({
        positionBuffer: mkVB(g.positions), normalBuffer: mkVB(g.normals), uvBuffer: mkVB(g.uvs),
        indexBuffer: mkIB(g.indices), indexCount: g.indices.length,
    });

    const sphereMesh = mkMesh(createSphereGeometry());
    const cubeMesh = mkMesh(createBoxGeometry());

    const sampler = device.createSampler({
        addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge',
        magFilter: 'linear', minFilter: 'linear',
    });
    const texture = await createTextureAtlas(device);
    const textureView = texture.createView();

    // Ping-pong ball-state buffers.
    const initStates = createInitialStates();
    const stateBuffers = [0, 1].map(() => {
        const buf = device.createBuffer({ size: BALL_COUNT * STATE_FLOATS * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, mappedAtCreation: true });
        new Float32Array(buf.getMappedRange()).set(initStates);
        buf.unmap();
        return buf;
    });

    const ballInfoBuffer = (() => {
        const buf = device.createBuffer({ size: BALL_COUNT * INFO_FLOATS * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, mappedAtCreation: true });
        new Float32Array(buf.getMappedRange()).set(createBallInfos());
        buf.unmap();
        return buf;
    })();
    const staticBuffer = (() => {
        const buf = device.createBuffer({ size: STATIC_COUNT * STATIC_FLOATS * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, mappedAtCreation: true });
        new Float32Array(buf.getMappedRange()).set(createStaticItems());
        buf.unmap();
        return buf;
    })();

    const cameraBuffer = device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const simParamsBuffer = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    // Collider wireframes: a box (for the static basket) and three great circles (per ball).
    const boxLineVerts = new Float32Array([
        -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, -0.5,
        -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5,
    ]);
    const boxLineIndices = new Uint16Array([
        0, 1, 1, 2, 2, 3, 3, 0, 4, 5, 5, 6, 6, 7, 7, 4, 0, 4, 1, 5, 2, 6, 3, 7,
    ]);
    const debugBoxVertexBuffer = mkVB(boxLineVerts);
    const debugBoxIndexBuffer = mkIB(boxLineIndices);
    const debugBoxIndexCount = boxLineIndices.length;

    const sphereSegments = 32;
    const sphereLineVerts = [];
    const sphereLineIndices = [];
    const ringAxes = [[1, 0, 2], [0, 1, 2], [1, 2, 0]];
    for (let ring = 0; ring < 3; ring++) {
        const base = ring * sphereSegments;
        for (let i = 0; i < sphereSegments; i++) {
            const a = (i / sphereSegments) * Math.PI * 2;
            const v = [0, 0, 0];
            v[ringAxes[ring][0]] = Math.cos(a);
            v[ringAxes[ring][1]] = Math.sin(a);
            sphereLineVerts.push(...v);
            sphereLineIndices.push(base + i, base + ((i + 1) % sphereSegments));
        }
    }
    const debugSphereVertexBuffer = mkVB(new Float32Array(sphereLineVerts));
    const debugSphereIndexBuffer = mkIB(new Uint16Array(sphereLineIndices));
    const debugSphereIndexCount = sphereLineIndices.length;

    // Physics: gravity, floor and basket-wall contacts, and O(N^2) sphere-sphere collision
    // with friction-driven roll. Quaternion orientation is integrated from angular velocity.
    const computeWGSL = `
struct BallState { position:vec4<f32>, velocity:vec4<f32>, rotation:vec4<f32>, angularVel:vec4<f32>, }
struct BallInfo { data : vec4<f32>, }   // radius, textureIndex, restitution, friction
struct SimParams {
    dt:f32, gravity:f32, groundY:f32, basketHalf:f32,
    basketTop:f32, damping:f32, elapsedTime:f32, groundHalf:f32,
}
const COUNT : u32 = ${BALL_COUNT}u;
@group(0) @binding(0) var<storage, read>       srcStates : array<BallState>;
@group(0) @binding(1) var<storage, read_write> dstStates : array<BallState>;
@group(0) @binding(2) var<storage, read>       infos     : array<BallInfo>;
@group(0) @binding(3) var<uniform>             params    : SimParams;

fn quatMul(a : vec4<f32>, b : vec4<f32>) -> vec4<f32> {
    return vec4<f32>(
        a.w*b.x + a.x*b.w + a.y*b.z - a.z*b.y,
        a.w*b.y - a.x*b.z + a.y*b.w + a.z*b.x,
        a.w*b.z + a.x*b.y - a.y*b.x + a.z*b.w,
        a.w*b.w - a.x*b.x - a.y*b.y - a.z*b.z,
    );
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id : vec3<u32>) {
    let i = id.x;
    if (i >= COUNT) { return; }

    let info = infos[i].data;
    let r = info.x;
    let restitution = info.z;
    let friction = info.w;
    let seed = srcStates[i].position.w;

    var pos = srcStates[i].position.xyz;
    var vel = srcStates[i].velocity.xyz;
    var rot = srcStates[i].rotation;
    var angVel = srcStates[i].angularVel.xyz;
    var contactCount = 0u;

    vel.y -= params.gravity * params.dt;
    vel *= params.damping;
    pos += vel * params.dt;
    let insideBasket = abs(pos.x) < params.basketHalf && abs(pos.z) < params.basketHalf && pos.y < params.basketTop + r;
    angVel *= select(0.996, 0.99, insideBasket);

    let onGroundPlane = abs(pos.x) + r < params.groundHalf && abs(pos.z) + r < params.groundHalf;
    if (onGroundPlane && pos.y - r < params.groundY) {
        let impactSpeed = max(-vel.y, 0.0);
        pos.y = params.groundY + r;
        if (impactSpeed > 0.0) {
            let bounceSpeed = impactSpeed * restitution;
            vel.y = select(bounceSpeed, max(bounceSpeed, 0.16), impactSpeed > 0.45);
        }
        let tangentDecay = max(1.0 - friction, 0.0);
        vel.x *= tangentDecay;
        vel.z *= tangentDecay;
        let rollingBlend = select(0.38, 0.16, insideBasket);
        angVel = mix(angVel, vec3<f32>(-vel.z / r, angVel.y * 0.8, vel.x / r), rollingBlend);
        contactCount++;
        if (abs(vel.y) < 0.03) { vel.y = 0.0; }
    }

    let wallHalfThickness = 0.2;
    let innerHalf = params.basketHalf - wallHalfThickness;
    let outerHalf = params.basketHalf + wallHalfThickness;
    let tangentDecay = max(1.0 - friction, 0.0);
    let hitsWallHeight = pos.y - r < params.basketTop && pos.y + r > params.groundY;

    if (hitsWallHeight && abs(pos.z) < outerHalf) {
        if (pos.x > 0.0 && pos.x + r > innerHalf && pos.x - r < outerHalf) {
            if (pos.x < params.basketHalf) {
                pos.x = innerHalf - r;
                if (vel.x > 0.0) { vel.x = -vel.x * restitution; }
            } else {
                pos.x = outerHalf + r;
                if (vel.x < 0.0) { vel.x = -vel.x * restitution; }
            }
            vel.y *= tangentDecay;
            vel.z *= tangentDecay;
            contactCount++;
        }
        if (pos.x < 0.0 && pos.x - r < -innerHalf && pos.x + r > -outerHalf) {
            if (pos.x > -params.basketHalf) {
                pos.x = -innerHalf + r;
                if (vel.x < 0.0) { vel.x = -vel.x * restitution; }
            } else {
                pos.x = -outerHalf - r;
                if (vel.x > 0.0) { vel.x = -vel.x * restitution; }
            }
            vel.y *= tangentDecay;
            vel.z *= tangentDecay;
            contactCount++;
        }
    }

    if (hitsWallHeight && abs(pos.x) < outerHalf) {
        if (pos.z > 0.0 && pos.z + r > innerHalf && pos.z - r < outerHalf) {
            if (pos.z < params.basketHalf) {
                pos.z = innerHalf - r;
                if (vel.z > 0.0) { vel.z = -vel.z * restitution; }
            } else {
                pos.z = outerHalf + r;
                if (vel.z < 0.0) { vel.z = -vel.z * restitution; }
            }
            vel.x *= tangentDecay;
            vel.y *= tangentDecay;
            contactCount++;
        }
        if (pos.z < 0.0 && pos.z - r < -innerHalf && pos.z + r > -outerHalf) {
            if (pos.z > -params.basketHalf) {
                pos.z = -innerHalf + r;
                if (vel.z < 0.0) { vel.z = -vel.z * restitution; }
            } else {
                pos.z = -outerHalf - r;
                if (vel.z > 0.0) { vel.z = -vel.z * restitution; }
            }
            vel.x *= tangentDecay;
            vel.y *= tangentDecay;
            contactCount++;
        }
    }

    for (var j = 0u; j < COUNT; j++) {
        if (j == i) { continue; }
        let other = srcStates[j];
        let otherInfo = infos[j].data;
        let otherRadius = otherInfo.x;
        var delta = pos - other.position.xyz;
        var dist = length(delta);
        if (dist < 0.0001) {
            let a = params.elapsedTime + seed * 6.28318;
            delta = vec3<f32>(cos(a), 0.2, sin(a)) * 0.001;
            dist = length(delta);
        }
        let minDist = r + otherRadius;
        if (dist < minDist) {
            contactCount++;
            let n = delta / dist;
            let penetration = minDist - dist;
            pos += n * penetration * 0.52;
            let relVel = vel - other.velocity.xyz;
            let vn = dot(relVel, n);
            if (vn < 0.0) {
                let pairRestitution = (restitution + otherInfo.z) * 0.5;
                vel += n * (-(1.0 + pairRestitution) * vn * 0.62);
            }
            let tangent = relVel - n * vn;
            let tangentLen = length(tangent);
            if (tangentLen > 0.0001) {
                let pairFriction = (friction + otherInfo.w) * 0.5;
                let t = tangent / tangentLen;
                vel -= t * min(tangentLen * pairFriction, 0.12);
                angVel += cross(n, t) * tangentLen * 0.035;
                contactCount++;
            }
        }
    }

    if (insideBasket && contactCount > 0u) {
        let angularDamping = pow(0.72, f32(contactCount));
        angVel *= angularDamping;
        if (length(vel) < 0.12 && length(angVel) < 1.0) { angVel = vec3<f32>(0.0); }
    }

    if (!insideBasket && onGroundPlane && abs(pos.y - (params.groundY + r)) < 0.04) {
        let groundSpeed = length(vec2<f32>(vel.x, vel.z));
        if (groundSpeed > 0.025) {
            let rollingAngVel = vec3<f32>(-vel.z / r, angVel.y * 0.98, vel.x / r);
            angVel = mix(angVel, rollingAngVel, 0.45);
        }
    }

    let speed = length(angVel);
    if (speed > 0.0001) {
        let axis = angVel / speed;
        let halfAngle = speed * params.dt * 0.5;
        let dq = vec4<f32>(axis * sin(halfAngle), cos(halfAngle));
        rot = normalize(quatMul(dq, rot));
    }

    if (pos.y < params.groundY - 16.0 || abs(pos.x) > params.groundHalf + 8.0 || abs(pos.z) > params.groundHalf + 8.0) {
        let col = f32(i % 15u);
        let row = f32(i / 15u);
        pos = vec3<f32>((col - 7.0) * 0.24 + (seed - 0.5) * 0.35,
                        7.0 + row * 0.35 + seed * 5.0,
                        (seed - 0.5) * params.basketHalf * 1.2);
        vel = vec3<f32>((seed - 0.5) * 0.12, -0.05, (0.5 - seed) * 0.12);
        rot = vec4<f32>(0.0, 0.0, 0.0, 1.0);
        angVel = vec3<f32>(seed * 0.6, seed * 0.3, -seed * 0.4);
    }

    dstStates[i].position = vec4<f32>(pos, seed);
    dstStates[i].velocity = vec4<f32>(vel, 0.0);
    dstStates[i].rotation = rot;
    dstStates[i].angularVel = vec4<f32>(angVel, 0.0);
}
`;

    // Render: instanced textured balls (first COUNT instances) followed by the tinted basket
    // boxes. The clip-space Y is flipped because the output goes into a RenderTargetTexture.
    const renderWGSL = `
struct Camera { viewProjection : mat4x4<f32>, }
struct BallState { position:vec4<f32>, velocity:vec4<f32>, rotation:vec4<f32>, angularVel:vec4<f32>, }
struct BallInfo { data : vec4<f32>, }
struct StaticItem { position:vec4<f32>, scale:vec4<f32>, color:vec4<f32>, }
struct VSOut {
    @builtin(position) position : vec4<f32>,
    @location(0) normal : vec3<f32>,
    @location(1) uv : vec2<f32>,
    @location(2) tint : vec3<f32>,
    @location(3) texIndex : f32,
    @location(4) texMix : f32,
}
const COUNT : u32 = ${BALL_COUNT}u;
@group(0) @binding(0) var<uniform>       camera  : Camera;
@group(0) @binding(1) var<storage, read> states  : array<BallState>;
@group(0) @binding(2) var<storage, read> infos   : array<BallInfo>;
@group(0) @binding(3) var<storage, read> statics : array<StaticItem>;
@group(0) @binding(4) var                texSampler : sampler;
@group(0) @binding(5) var                texAtlas   : texture_2d<f32>;

fn rotByQuat(v : vec3<f32>, q : vec4<f32>) -> vec3<f32> {
    let t = 2.0 * cross(q.xyz, v);
    return v + q.w * t + cross(q.xyz, t);
}
@vertex
fn vs(
    @location(0) position : vec3<f32>,
    @location(1) normal : vec3<f32>,
    @location(2) uv : vec2<f32>,
    @builtin(instance_index) instance : u32,
) -> VSOut {
    var out : VSOut;
    var worldPos : vec3<f32>;
    var worldNormal : vec3<f32>;
    if (instance < COUNT) {
        let state = states[instance];
        let info = infos[instance].data;
        worldPos = rotByQuat(position * info.x, state.rotation) + state.position.xyz;
        worldNormal = normalize(rotByQuat(normal, state.rotation));
        out.uv = uv;
        out.tint = vec3<f32>(1.0);
        out.texIndex = info.y;
        out.texMix = 1.0;
    } else {
        let item = statics[instance - COUNT];
        worldPos = position * item.scale.xyz + item.position.xyz;
        worldNormal = normal;
        out.uv = uv;
        out.tint = item.color.rgb;
        out.texIndex = 0.0;
        out.texMix = 0.0;
    }
    out.normal = worldNormal;
    let clip = camera.viewProjection * vec4<f32>(worldPos, 1.0);
    out.position = vec4<f32>(clip.x, -clip.y, clip.z, clip.w);
    return out;
}
@fragment
fn fs(
    @location(0) normal : vec3<f32>,
    @location(1) uv : vec2<f32>,
    @location(2) tint : vec3<f32>,
    @location(3) texIndex : f32,
    @location(4) texMix : f32,
) -> @location(0) vec4<f32> {
    let atlasUv = vec2<f32>((uv.x + texIndex) / 5.0, uv.y);
    let sampleColor = textureSample(texAtlas, texSampler, atlasUv).rgb;
    let lightDir = normalize(vec3<f32>(0.55, 0.9, 0.35));
    let diffuse = max(dot(normalize(normal), lightDir), 0.25);
    let base = mix(vec3<f32>(1.0), sampleColor, texMix);
    return vec4<f32>(pow(base * tint * diffuse, vec3<f32>(0.82)), 1.0);
}
`;

    const wireWGSL = `
struct Camera { viewProjection : mat4x4<f32>, }
struct BallState { position:vec4<f32>, velocity:vec4<f32>, rotation:vec4<f32>, angularVel:vec4<f32>, }
struct BallInfo { data : vec4<f32>, }
struct StaticItem { position:vec4<f32>, scale:vec4<f32>, color:vec4<f32>, }
struct VSOut {
    @builtin(position) position : vec4<f32>,
    @location(0) color : vec4<f32>,
}
const STATIC_COUNT : u32 = ${STATIC_COUNT}u;
@group(0) @binding(0) var<uniform>       camera  : Camera;
@group(0) @binding(1) var<storage, read> states  : array<BallState>;
@group(0) @binding(2) var<storage, read> infos   : array<BallInfo>;
@group(0) @binding(3) var<storage, read> statics : array<StaticItem>;
fn rotByQuat(v : vec3<f32>, q : vec4<f32>) -> vec3<f32> {
    let t = 2.0 * cross(q.xyz, v);
    return v + q.w * t + cross(q.xyz, t);
}
@vertex
fn vs(@location(0) position : vec3<f32>, @builtin(instance_index) instance : u32) -> VSOut {
    var out : VSOut;
    var worldPos : vec3<f32>;
    if (instance < STATIC_COUNT) {
        let item = statics[instance];
        worldPos = position * item.scale.xyz + item.position.xyz;
        out.color = vec4<f32>(0.0, 1.0, 0.0, 1.0);
    } else {
        let ballIndex = instance - STATIC_COUNT;
        let state = states[ballIndex];
        let info = infos[ballIndex].data;
        worldPos = rotByQuat(position * info.x, state.rotation) + state.position.xyz;
        out.color = vec4<f32>(1.0, 1.0, 0.0, 1.0);
    }
    let clip = camera.viewProjection * vec4<f32>(worldPos, 1.0);
    out.position = vec4<f32>(clip.x, -clip.y, clip.z, clip.w);
    return out;
}
@fragment
fn fs(@location(0) color : vec4<f32>) -> @location(0) vec4<f32> { return color; }
`;

    const computeModule = device.createShaderModule({ code: computeWGSL });
    const renderModule = device.createShaderModule({ code: renderWGSL });
    const wireModule = device.createShaderModule({ code: wireWGSL });

    const computePipeline = device.createComputePipeline({ layout: 'auto', compute: { module: computeModule, entryPoint: 'main' } });

    const rttSize = { width: engine.getRenderWidth(), height: engine.getRenderHeight() };
    const ballRtt = new BABYLON.RenderTargetTexture('ballRTT', rttSize, scene, {
        generateMipMaps: false,
        type: BABYLON.Constants.TEXTURETYPE_UNSIGNED_BYTE,
        format: BABYLON.Constants.TEXTUREFORMAT_RGBA,
    });
    const ballLayer = new BABYLON.Layer('ballLayer', null, scene, false);
    ballLayer.texture = ballRtt;
    ballLayer.alphaBlendingMode = BABYLON.Engine.ALPHA_COMBINE;

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
            { binding: 2, resource: { buffer: ballInfoBuffer } },
            { binding: 3, resource: { buffer: simParamsBuffer } },
        ],
    }));
    const renderBindGroups = [0, 1].map((s) => device.createBindGroup({
        layout: renderPipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: cameraBuffer } },
            { binding: 1, resource: { buffer: stateBuffers[s] } },
            { binding: 2, resource: { buffer: ballInfoBuffer } },
            { binding: 3, resource: { buffer: staticBuffer } },
            { binding: 4, resource: sampler },
            { binding: 5, resource: textureView },
        ],
    }));
    const wireBindGroups = [0, 1].map((s) => device.createBindGroup({
        layout: wirePipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: cameraBuffer } },
            { binding: 1, resource: { buffer: stateBuffers[s] } },
            { binding: 2, resource: { buffer: ballInfoBuffer } },
            { binding: 3, resource: { buffer: staticBuffer } },
        ],
    }));

    const drawMesh = (pass, mesh, instanceCount, firstInstance = 0) => {
        pass.setVertexBuffer(0, mesh.positionBuffer);
        pass.setVertexBuffer(1, mesh.normalBuffer);
        pass.setVertexBuffer(2, mesh.uvBuffer);
        pass.setIndexBuffer(mesh.indexBuffer, 'uint16');
        pass.drawIndexed(mesh.indexCount, instanceCount, 0, 0, firstInstance);
    };

    const hint = document.getElementById('hint');
    const fpsEl = document.getElementById('fps');
    let frameCount = 0, lastFpsT = performance.now(), fps = 0;
    let currentState = 0;
    const startTime = performance.now();

    scene.onBeforeRenderObservable.add(() => {
        const internalTex = ballRtt.getInternalTexture();
        if (!internalTex || !internalTex._hardwareTexture) return;
        const gpuTex = internalTex._hardwareTexture.underlyingResource;
        if (!gpuTex) return;

        const viewProj = camera.getViewMatrix().multiply(camera.getProjectionMatrix());
        device.queue.writeBuffer(cameraBuffer, 0, new Float32Array(viewProj.toArray()));

        const dt = Math.min(engine.getDeltaTime() / 1000, 1 / 30);
        const time = (performance.now() - startTime) / 1000;
        device.queue.writeBuffer(simParamsBuffer, 0, new Float32Array([
            dt / SUBSTEPS, 9.8, GROUND_Y, BASKET_HALF, BASKET_TOP, 0.998, time, GROUND_HALF,
        ]));

        const ce = device.createCommandEncoder();

        for (let s = 0; s < SUBSTEPS; s++) {
            const cp = ce.beginComputePass();
            cp.setPipeline(computePipeline);
            cp.setBindGroup(0, computeBindGroups[currentState]);
            cp.dispatchWorkgroups(Math.ceil(BALL_COUNT / 64));
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
            drawMesh(pass, sphereMesh, BALL_COUNT);
            drawMesh(pass, cubeMesh, STATIC_COUNT, BALL_COUNT);
            if (showWireframe) {
                pass.setPipeline(wirePipeline);
                pass.setBindGroup(0, wireBindGroups[currentState]);
                pass.setVertexBuffer(0, debugBoxVertexBuffer);
                pass.setIndexBuffer(debugBoxIndexBuffer, 'uint16');
                pass.drawIndexed(debugBoxIndexCount, STATIC_COUNT, 0, 0, 0);
                pass.setVertexBuffer(0, debugSphereVertexBuffer);
                pass.setIndexBuffer(debugSphereIndexBuffer, 'uint16');
                pass.drawIndexed(debugSphereIndexCount, BALL_COUNT, 0, 0, STATIC_COUNT);
            }
            pass.end();
        }

        device.queue.submit([ce.finish()]);

        frameCount++;
        const now = performance.now();
        if (now - lastFpsT > 500) {
            fps = (frameCount * 1000 / (now - lastFpsT)) | 0;
            frameCount = 0; lastFpsT = now;
            if (hint) hint.textContent = 'W: wireframe ' + (showWireframe ? 'ON' : 'OFF');
            if (fpsEl) fpsEl.textContent = fps + ' FPS';
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
