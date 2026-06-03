'use strict';

// Babylon.js (WebGPUEngine) provides the camera, skybox and environment, while the cones and
// their basket are simulated and drawn entirely on the GPU through custom WGSL compute +
// render passes that share Babylon's WebGPU device. 160 carrot-textured cones fall into a
// basket; the physics is O(N^2) collision (cones approximated by their bounding sphere) plus
// floor/wall contacts, integrated with a ping-pong, sub-stepped solver.
//
// The cones and basket are rendered into a RenderTargetTexture and composited over the
// Babylon scene with a Layer. Press W to toggle the collider wireframe.

const BASE_URL = 'https://cx20.github.io/gltf-test';
const CONE_TEXTURE = '../../../../assets/textures/carrot.jpg';

const CONE_COUNT = 160;
const STATIC_COUNT = 5;
const STATE_FLOATS = 16;
const INFO_FLOATS = 4;
const STATIC_FLOATS = 12;
const SUBSTEPS = 4;
const BASKET_HALF = 3.0;
const BASKET_TOP = 4.0;
const GROUND_Y = -1.0;
const GROUND_HALF = 10.0;

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

async function loadTexture(device, url) {
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

const normalize3 = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

function quatFromEuler(x, y, z) {
    const cx = Math.cos(x * 0.5), sx = Math.sin(x * 0.5);
    const cy = Math.cos(y * 0.5), sy = Math.sin(y * 0.5);
    const cz = Math.cos(z * 0.5), sz = Math.sin(z * 0.5);
    return [
        sx * cy * cz + cx * sy * sz,
        cx * sy * cz - sx * cy * sz,
        cx * cy * sz + sx * sy * cz,
        cx * cy * cz - sx * sy * sz,
    ];
}

// Unit cone: base radius 1 at y=-0.5, apex at y=+0.5.
function createConeGeometry(segments = 56) {
    const positions = [], normals = [], uvs = [], indices = [];
    for (let i = 0; i < segments; i++) {
        const a0 = (i / segments) * Math.PI * 2, a1 = ((i + 1) / segments) * Math.PI * 2;
        const x0 = Math.cos(a0), z0 = Math.sin(a0), x1 = Math.cos(a1), z1 = Math.sin(a1);
        const sideBase = positions.length / 3;
        const sideNormal = normalize3(cross3(sub3([x1, -0.5, z1], [x0, -0.5, z0]), sub3([0, 0.5, 0], [x0, -0.5, z0])));
        positions.push(x0, -0.5, z0, x1, -0.5, z1, 0, 0.5, 0);
        normals.push(...sideNormal, ...sideNormal, ...sideNormal);
        uvs.push(i / segments, 0, (i + 1) / segments, 0, (i + 0.5) / segments, 1);
        indices.push(sideBase, sideBase + 1, sideBase + 2);
        const base = positions.length / 3;
        positions.push(0, -0.5, 0, x1, -0.5, z1, x0, -0.5, z0);
        normals.push(0, -1, 0, 0, -1, 0, 0, -1, 0);
        uvs.push(0.5, 0.5, 0.5 + x1 * 0.5, 0.5 + z1 * 0.5, 0.5 + x0 * 0.5, 0.5 + z0 * 0.5);
        indices.push(base, base + 1, base + 2);
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
        0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1,
        -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0,
        0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0,
    ]);
    const uvs = new Float32Array([
        0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1,
        0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1,
    ]);
    const indices = new Uint16Array([
        0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 8, 9, 10, 8, 10, 11,
        12, 13, 14, 12, 14, 15, 16, 17, 18, 16, 18, 19, 20, 21, 22, 20, 22, 23,
    ]);
    return { positions, normals, uvs, indices };
}

// Cone outline (base ring + a few apex spokes) as a line list.
function createConeWire(segments = 16) {
    const positions = [], indices = [];
    for (let i = 0; i < segments; i++) {
        const a = (i / segments) * Math.PI * 2;
        positions.push(Math.cos(a), -0.5, Math.sin(a));
        indices.push(i, (i + 1) % segments);
    }
    const apex = positions.length / 3;
    positions.push(0, 0.5, 0);
    for (let i = 0; i < segments; i += 2) indices.push(i, apex);
    return { positions: new Float32Array(positions), indices: new Uint16Array(indices) };
}

function createBoxWire() {
    const positions = new Float32Array([
        -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, -0.5,
        -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5,
    ]);
    const indices = new Uint16Array([0, 1, 1, 2, 2, 3, 3, 0, 4, 5, 5, 6, 6, 7, 7, 4, 0, 4, 1, 5, 2, 6, 3, 7]);
    return { positions, indices };
}

function createInitialStates() {
    const states = new Float32Array(CONE_COUNT * STATE_FLOATS);
    for (let i = 0; i < CONE_COUNT; i++) {
        const seed = ((i * 37) % 101) / 101;
        const base = i * STATE_FLOATS;
        const col = i % 16;
        const row = Math.floor(i / 16);
        const angle = seed * Math.PI * 2 + i * 0.37;
        const rotation = quatFromEuler((seed - 0.5) * 0.45, angle, (0.5 - seed) * 0.35);
        states[base + 0] = (col - 7.5) * 0.28 + Math.cos(angle) * 0.2;
        states[base + 1] = 6 + row * 0.55 + seed * 8;
        states[base + 2] = Math.sin(angle * 1.7) * BASKET_HALF * 0.7;
        states[base + 3] = seed;
        states[base + 4] = (seed - 0.5) * 0.12;
        states[base + 5] = -0.05;
        states[base + 6] = (0.5 - seed) * 0.12;
        states[base + 8] = rotation[0];
        states[base + 9] = rotation[1];
        states[base + 10] = rotation[2];
        states[base + 11] = rotation[3];
        states[base + 12] = seed * 0.7;
        states[base + 13] = seed * 0.3;
        states[base + 14] = -seed * 0.6;
    }
    return states;
}

function createConeInfos() {
    const infos = new Float32Array(CONE_COUNT * INFO_FLOATS);
    for (let i = 0; i < CONE_COUNT; i++) {
        const seed = ((i * 37) % 101) / 101;
        const base = i * INFO_FLOATS;
        infos[base + 0] = 0.45 + seed * 0.3;
        infos[base + 1] = 1.2 + (((i * 17) % 101) / 101) * 1.0;
        infos[base + 2] = 0.1;
        infos[base + 3] = 0.055;
    }
    return infos;
}

function createStaticItems() {
    const items = new Float32Array(STATIC_COUNT * STATIC_FLOATS);
    const data = [
        { pos: [0, -2, 0], scale: [20, 2, 20], color: [0.22, 0.22, 0.24, 1] },
        { pos: [0, 1.53, -3.25], scale: [6.2, 5, 0.5], color: [0.25, 0.28, 0.3, 1] },
        { pos: [0, 1.53, 3.25], scale: [6.2, 5, 0.5], color: [0.25, 0.28, 0.3, 1] },
        { pos: [-3.25, 1.53, 0], scale: [0.5, 5, 6.2], color: [0.25, 0.28, 0.3, 1] },
        { pos: [3.25, 1.53, 0], scale: [0.5, 5, 6.2], color: [0.25, 0.28, 0.3, 1] },
    ];
    for (let i = 0; i < data.length; i++) {
        const base = i * STATIC_FLOATS;
        items.set([...data[i].pos, 0], base);
        items.set([...data[i].scale, 0], base + 4);
        items.set(data[i].color, base + 8);
    }
    return items;
}

const createScene = async function () {
    const scene = new BABYLON.Scene(engine);
    const camera = new BABYLON.ArcRotateCamera('camera',
        -Math.PI / 180 * 60, Math.PI / 180 * 64, 26,
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

    const coneTex = await loadTexture(device, CONE_TEXTURE);
    const coneTexView = coneTex.createView();
    const texSampler = device.createSampler({
        addressModeU: 'repeat', addressModeV: 'repeat', magFilter: 'linear', minFilter: 'linear',
    });

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

    const coneMesh = mkMesh(createConeGeometry());
    const cubeMesh = mkMesh(createBoxGeometry());
    const coneWire = createConeWire();
    const coneWireVB = mkVB(coneWire.positions);
    const coneWireIB = mkIB(coneWire.indices);
    const coneWireCount = coneWire.indices.length;
    const boxWire = createBoxWire();
    const boxWireVB = mkVB(boxWire.positions);
    const boxWireIB = mkIB(boxWire.indices);
    const boxWireCount = boxWire.indices.length;

    const initStates = createInitialStates();
    const stateBuffers = [0, 1].map(() => {
        const buf = device.createBuffer({ size: CONE_COUNT * STATE_FLOATS * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, mappedAtCreation: true });
        new Float32Array(buf.getMappedRange()).set(initStates);
        buf.unmap();
        return buf;
    });
    const coneInfoBuffer = (() => {
        const buf = device.createBuffer({ size: CONE_COUNT * INFO_FLOATS * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, mappedAtCreation: true });
        new Float32Array(buf.getMappedRange()).set(createConeInfos());
        buf.unmap();
        return buf;
    })();
    const staticBuffer = (() => {
        const buf = device.createBuffer({ size: STATIC_COUNT * STATIC_FLOATS * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, mappedAtCreation: true });
        new Float32Array(buf.getMappedRange()).set(createStaticItems());
        buf.unmap();
        return buf;
    })();

    const camUbo = device.createBuffer({ size: 16 * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const simUbo = device.createBuffer({ size: 8 * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    // Physics: cones approximated by their bounding sphere (max(radius, height/2)) for
    // collision; gravity, floor + basket-wall contacts, O(N^2) pair collisions and rolling.
    const computeWGSL = `
struct ConeState { position:vec4<f32>, velocity:vec4<f32>, rotation:vec4<f32>, angularVel:vec4<f32>, }
struct ConeInfo { data : vec4<f32>, }   // radius, height, restitution, friction
struct SimParams {
    dt:f32, gravity:f32, groundY:f32, basketHalf:f32,
    basketTop:f32, damping:f32, elapsedTime:f32, groundHalf:f32,
}
const COUNT : u32 = ${CONE_COUNT}u;
@group(0) @binding(0) var<storage, read>       srcStates : array<ConeState>;
@group(0) @binding(1) var<storage, read_write> dstStates : array<ConeState>;
@group(0) @binding(2) var<storage, read>       infos     : array<ConeInfo>;
@group(0) @binding(3) var<uniform>             params    : SimParams;

fn quatMul(a : vec4<f32>, b : vec4<f32>) -> vec4<f32> {
    return vec4<f32>(
        a.w*b.x + a.x*b.w + a.y*b.z - a.z*b.y,
        a.w*b.y - a.x*b.z + a.y*b.w + a.z*b.x,
        a.w*b.z + a.x*b.y - a.y*b.x + a.z*b.w,
        a.w*b.w - a.x*b.x - a.y*b.y - a.z*b.z,
    );
}
fn resetPosition(i : u32, seed : f32) -> vec3<f32> {
    let col = f32(i % 16u);
    let row = f32(i / 16u);
    let a = seed * 6.2831853 + f32(i) * 0.37;
    return vec3<f32>(
        (col - 7.5) * 0.28 + cos(a) * 0.2,
        6.0 + row * 0.55 + seed * 8.0,
        sin(a * 1.7) * params.basketHalf * 0.7,
    );
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id : vec3<u32>) {
    let i = id.x;
    if (i >= COUNT) { return; }

    let info = infos[i].data;
    let radius = info.x;
    let height = info.y;
    let restitution = info.z;
    let friction = info.w;
    let collisionRadius = max(radius, height * 0.5);
    let seed = srcStates[i].position.w;

    var pos = srcStates[i].position.xyz;
    var vel = srcStates[i].velocity.xyz;
    var rot = srcStates[i].rotation;
    var angVel = srcStates[i].angularVel.xyz;
    var contacts = 0u;

    vel.y -= params.gravity * params.dt;
    vel *= params.damping;
    pos += vel * params.dt;
    angVel *= 0.996;

    let bottom = height * 0.5;
    let onGroundPlane = abs(pos.x) + radius < params.groundHalf && abs(pos.z) + radius < params.groundHalf;
    if (onGroundPlane && pos.y - bottom < params.groundY) {
        let impactSpeed = max(-vel.y, 0.0);
        pos.y = params.groundY + bottom;
        if (impactSpeed > 0.0) { vel.y = impactSpeed * restitution; }
        let tangentDecay = max(1.0 - friction, 0.0);
        vel.x *= tangentDecay;
        vel.z *= tangentDecay;
        let rolling = vec3<f32>(-vel.z / max(radius, 0.0001), angVel.y * 0.8, vel.x / max(radius, 0.0001));
        angVel = mix(angVel, rolling, 0.22);
        contacts++;
        if (abs(vel.y) < 0.025) { vel.y = 0.0; }
    }

    let wallHalfThickness = 0.25;
    let innerHalf = params.basketHalf - wallHalfThickness;
    let outerHalf = params.basketHalf + wallHalfThickness;
    let hitsWallHeight = pos.y - collisionRadius < params.basketTop && pos.y + collisionRadius > params.groundY;
    let tangentDecay = max(1.0 - friction, 0.0);

    if (hitsWallHeight && abs(pos.z) < outerHalf) {
        if (pos.x > 0.0 && pos.x + collisionRadius > innerHalf && pos.x - collisionRadius < outerHalf) {
            if (pos.x < params.basketHalf) {
                pos.x = innerHalf - collisionRadius;
                if (vel.x > 0.0) { vel.x = -vel.x * restitution; }
            } else {
                pos.x = outerHalf + collisionRadius;
                if (vel.x < 0.0) { vel.x = -vel.x * restitution; }
            }
            vel.y *= tangentDecay; vel.z *= tangentDecay;
            angVel += vec3<f32>(0.0, 0.0, -vel.x) * 0.08;
            contacts++;
        }
        if (pos.x < 0.0 && pos.x - collisionRadius < -innerHalf && pos.x + collisionRadius > -outerHalf) {
            if (pos.x > -params.basketHalf) {
                pos.x = -innerHalf + collisionRadius;
                if (vel.x < 0.0) { vel.x = -vel.x * restitution; }
            } else {
                pos.x = -outerHalf - collisionRadius;
                if (vel.x > 0.0) { vel.x = -vel.x * restitution; }
            }
            vel.y *= tangentDecay; vel.z *= tangentDecay;
            angVel += vec3<f32>(0.0, 0.0, -vel.x) * 0.08;
            contacts++;
        }
    }

    if (hitsWallHeight && abs(pos.x) < outerHalf) {
        if (pos.z > 0.0 && pos.z + collisionRadius > innerHalf && pos.z - collisionRadius < outerHalf) {
            if (pos.z < params.basketHalf) {
                pos.z = innerHalf - collisionRadius;
                if (vel.z > 0.0) { vel.z = -vel.z * restitution; }
            } else {
                pos.z = outerHalf + collisionRadius;
                if (vel.z < 0.0) { vel.z = -vel.z * restitution; }
            }
            vel.x *= tangentDecay; vel.y *= tangentDecay;
            angVel += vec3<f32>(vel.z, 0.0, 0.0) * 0.08;
            contacts++;
        }
        if (pos.z < 0.0 && pos.z - collisionRadius < -innerHalf && pos.z + collisionRadius > -outerHalf) {
            if (pos.z > -params.basketHalf) {
                pos.z = -innerHalf + collisionRadius;
                if (vel.z < 0.0) { vel.z = -vel.z * restitution; }
            } else {
                pos.z = -outerHalf - collisionRadius;
                if (vel.z > 0.0) { vel.z = -vel.z * restitution; }
            }
            vel.x *= tangentDecay; vel.y *= tangentDecay;
            angVel += vec3<f32>(vel.z, 0.0, 0.0) * 0.08;
            contacts++;
        }
    }

    for (var j = 0u; j < COUNT; j++) {
        if (j == i) { continue; }
        let other = srcStates[j];
        let otherInfo = infos[j].data;
        let otherRadius = max(otherInfo.x, otherInfo.y * 0.5);
        var delta = pos - other.position.xyz;
        var dist = length(delta);
        if (dist < 0.0001) {
            let a = params.elapsedTime + seed * 6.28318;
            delta = vec3<f32>(cos(a), 0.2, sin(a)) * 0.001;
            dist = length(delta);
        }
        let minDist = collisionRadius + otherRadius;
        if (dist < minDist) {
            let n = delta / dist;
            let penetration = minDist - dist;
            pos += n * penetration * 0.5;
            let relVel = vel - other.velocity.xyz;
            let vn = dot(relVel, n);
            if (vn < 0.0) {
                let pairRestitution = (restitution + otherInfo.z) * 0.5;
                vel += n * (-(1.0 + pairRestitution) * vn * 0.55);
            }
            let tangent = relVel - n * vn;
            let tangentLen = length(tangent);
            if (tangentLen > 0.0001) {
                let pairFriction = (friction + otherInfo.w) * 0.5;
                let t = tangent / tangentLen;
                vel -= t * min(tangentLen * pairFriction, 0.1);
                angVel += cross(n, t) * tangentLen * 0.04;
            }
            contacts++;
        }
    }

    if (contacts > 0u) { angVel *= pow(0.83, f32(contacts)); }

    let speed = length(angVel);
    if (speed > 0.0001) {
        let axis = angVel / speed;
        let halfAngle = speed * params.dt * 0.5;
        let dq = vec4<f32>(axis * sin(halfAngle), cos(halfAngle));
        rot = normalize(quatMul(dq, rot));
    }

    if (pos.y < params.groundY - 18.0 || abs(pos.x) > params.groundHalf + 8.0 || abs(pos.z) > params.groundHalf + 8.0) {
        pos = resetPosition(i, seed);
        vel = vec3<f32>((seed - 0.5) * 0.12, -0.05, (0.5 - seed) * 0.12);
        rot = normalize(vec4<f32>(sin(seed * 3.14) * 0.12, sin(seed * 6.28) * 0.18, 0.0, 0.975));
        angVel = vec3<f32>(seed * 0.7, seed * 0.3, -seed * 0.6);
    }

    dstStates[i].position = vec4<f32>(pos, seed);
    dstStates[i].velocity = vec4<f32>(vel, 0.0);
    dstStates[i].rotation = rot;
    dstStates[i].angularVel = vec4<f32>(angVel, 0.0);
}
`;

    // Render: instanced textured cones (first COUNT) then the tinted basket boxes. Clip Y is
    // flipped because the output goes into a RenderTargetTexture.
    const renderWGSL = `
struct Camera { viewProjection : mat4x4<f32>, }
struct ConeState { position:vec4<f32>, velocity:vec4<f32>, rotation:vec4<f32>, angularVel:vec4<f32>, }
struct ConeInfo { data : vec4<f32>, }
struct StaticItem { position:vec4<f32>, scale:vec4<f32>, color:vec4<f32>, }
struct VSOut {
    @builtin(position) position : vec4<f32>,
    @location(0) normal : vec3<f32>,
    @location(1) uv : vec2<f32>,
    @location(2) tint : vec3<f32>,
    @location(3) texMix : f32,
}
const COUNT : u32 = ${CONE_COUNT}u;
@group(0) @binding(0) var<uniform>       camera  : Camera;
@group(0) @binding(1) var<storage, read> states  : array<ConeState>;
@group(0) @binding(2) var<storage, read> infos   : array<ConeInfo>;
@group(0) @binding(3) var<storage, read> statics : array<StaticItem>;
@group(0) @binding(4) var                texSampler : sampler;
@group(0) @binding(5) var                coneTexture : texture_2d<f32>;
fn rotByQuat(v : vec3<f32>, q : vec4<f32>) -> vec3<f32> {
    let t = 2.0 * cross(q.xyz, v);
    return v + q.w * t + cross(q.xyz, t);
}
@vertex
fn vs(@location(0) position : vec3<f32>, @location(1) normal : vec3<f32>, @location(2) uv : vec2<f32>, @builtin(instance_index) instance : u32) -> VSOut {
    var out : VSOut;
    var worldPos : vec3<f32>;
    var worldNormal : vec3<f32>;
    if (instance < COUNT) {
        let state = states[instance];
        let info = infos[instance].data;
        worldPos = rotByQuat(position * vec3<f32>(info.x, info.y, info.x), state.rotation) + state.position.xyz;
        worldNormal = normalize(rotByQuat(normal, state.rotation));
        out.uv = uv;
        out.tint = vec3<f32>(1.0);
        out.texMix = 1.0;
    } else {
        let item = statics[instance - COUNT];
        worldPos = position * item.scale.xyz + item.position.xyz;
        worldNormal = normal;
        out.uv = uv;
        out.tint = item.color.rgb;
        out.texMix = 0.0;
    }
    out.normal = worldNormal;
    let clip = camera.viewProjection * vec4<f32>(worldPos, 1.0);
    out.position = vec4<f32>(clip.x, -clip.y, clip.z, clip.w);
    return out;
}
@fragment
fn fs(@location(0) normal : vec3<f32>, @location(1) uv : vec2<f32>, @location(2) tint : vec3<f32>, @location(3) texMix : f32) -> @location(0) vec4<f32> {
    let sampleColor = textureSample(coneTexture, texSampler, uv).rgb;
    let lightDir = normalize(vec3<f32>(0.55, 0.9, 0.35));
    let diffuse = max(dot(normalize(normal), lightDir), 0.25);
    let base = mix(vec3<f32>(1.0), sampleColor, texMix);
    return vec4<f32>(pow(base * tint * diffuse, vec3<f32>(0.82)), 1.0);
}
`;

    const wireWGSL = `
struct Camera { viewProjection : mat4x4<f32>, }
struct ConeState { position:vec4<f32>, velocity:vec4<f32>, rotation:vec4<f32>, angularVel:vec4<f32>, }
struct ConeInfo { data : vec4<f32>, }
struct StaticItem { position:vec4<f32>, scale:vec4<f32>, color:vec4<f32>, }
struct VSOut {
    @builtin(position) position : vec4<f32>,
    @location(0) color : vec3<f32>,
}
const COUNT : u32 = ${CONE_COUNT}u;
const MODE_CONE : u32 = 0u;
@group(0) @binding(0) var<uniform>       camera  : Camera;
@group(0) @binding(1) var<storage, read> states  : array<ConeState>;
@group(0) @binding(2) var<storage, read> infos   : array<ConeInfo>;
@group(0) @binding(3) var<storage, read> statics : array<StaticItem>;
override IS_CONE : u32 = 1u;
fn rotByQuat(v : vec3<f32>, q : vec4<f32>) -> vec3<f32> {
    let t = 2.0 * cross(q.xyz, v);
    return v + q.w * t + cross(q.xyz, t);
}
@vertex
fn vs(@location(0) position : vec3<f32>, @builtin(instance_index) instance : u32) -> VSOut {
    var out : VSOut;
    var worldPos : vec3<f32>;
    if (IS_CONE == 1u) {
        let state = states[instance];
        let info = infos[instance].data;
        worldPos = rotByQuat(position * vec3<f32>(info.x, info.y, info.x), state.rotation) + state.position.xyz;
        out.color = vec3<f32>(1.0, 1.0, 0.0);
    } else {
        let item = statics[instance];
        worldPos = position * item.scale.xyz + item.position.xyz;
        out.color = vec3<f32>(0.1, 1.0, 0.35);
    }
    let clip = camera.viewProjection * vec4<f32>(worldPos, 1.0);
    out.position = vec4<f32>(clip.x, -clip.y, clip.z, clip.w);
    return out;
}
@fragment
fn fs(@location(0) color : vec3<f32>) -> @location(0) vec4<f32> { return vec4<f32>(color, 1.0); }
`;

    const computeModule = device.createShaderModule({ code: computeWGSL });
    const renderModule = device.createShaderModule({ code: renderWGSL });
    const wireModule = device.createShaderModule({ code: wireWGSL });

    const computePipeline = device.createComputePipeline({ layout: 'auto', compute: { module: computeModule, entryPoint: 'main' } });

    const rttSize = { width: engine.getRenderWidth(), height: engine.getRenderHeight() };
    const coneRtt = new BABYLON.RenderTargetTexture('coneRTT', rttSize, scene, {
        generateMipMaps: false,
        type: BABYLON.Constants.TEXTURETYPE_UNSIGNED_BYTE,
        format: BABYLON.Constants.TEXTUREFORMAT_RGBA,
    });
    const coneLayer = new BABYLON.Layer('coneLayer', null, scene, false);
    coneLayer.texture = coneRtt;
    coneLayer.alphaBlendingMode = BABYLON.Engine.ALPHA_COMBINE;

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

    const wirePipelineDesc = (isCone) => ({
        layout: 'auto',
        vertex: {
            module: wireModule, entryPoint: 'vs',
            constants: { IS_CONE: isCone },
            buffers: [{ arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] }],
        },
        fragment: { module: wireModule, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] },
        primitive: { topology: 'line-list' },
        depthStencil: { depthWriteEnabled: false, depthCompare: 'less-equal', format: 'depth24plus' },
    });
    const coneWirePipeline = device.createRenderPipeline(wirePipelineDesc(1));
    const boxWirePipeline = device.createRenderPipeline(wirePipelineDesc(0));

    const computeBindGroups = [0, 1].map((s) => device.createBindGroup({
        layout: computePipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: stateBuffers[s] } },
            { binding: 1, resource: { buffer: stateBuffers[1 - s] } },
            { binding: 2, resource: { buffer: coneInfoBuffer } },
            { binding: 3, resource: { buffer: simUbo } },
        ],
    }));
    const renderBindGroups = [0, 1].map((s) => device.createBindGroup({
        layout: renderPipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: camUbo } },
            { binding: 1, resource: { buffer: stateBuffers[s] } },
            { binding: 2, resource: { buffer: coneInfoBuffer } },
            { binding: 3, resource: { buffer: staticBuffer } },
            { binding: 4, resource: texSampler },
            { binding: 5, resource: coneTexView },
        ],
    }));
    const coneWireBindGroups = [0, 1].map((s) => device.createBindGroup({
        layout: coneWirePipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: camUbo } },
            { binding: 1, resource: { buffer: stateBuffers[s] } },
            { binding: 2, resource: { buffer: coneInfoBuffer } },
            { binding: 3, resource: { buffer: staticBuffer } },
        ],
    }));
    const boxWireBindGroup = device.createBindGroup({
        layout: boxWirePipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: camUbo } },
            { binding: 1, resource: { buffer: stateBuffers[0] } },
            { binding: 2, resource: { buffer: coneInfoBuffer } },
            { binding: 3, resource: { buffer: staticBuffer } },
        ],
    });

    const drawMesh = (pass, mesh, instanceCount, firstInstance = 0) => {
        pass.setVertexBuffer(0, mesh.positionBuffer);
        pass.setVertexBuffer(1, mesh.normalBuffer);
        pass.setVertexBuffer(2, mesh.uvBuffer);
        pass.setIndexBuffer(mesh.indexBuffer, 'uint16');
        pass.drawIndexed(mesh.indexCount, instanceCount, 0, 0, firstInstance);
    };

    const hint = document.getElementById('hint');
    let frameCount = 0, lastFpsT = performance.now(), fps = 0;
    let currentState = 0;
    const startTime = performance.now();

    scene.onBeforeRenderObservable.add(() => {
        const internalTex = coneRtt.getInternalTexture();
        if (!internalTex || !internalTex._hardwareTexture) return;
        const gpuTex = internalTex._hardwareTexture.underlyingResource;
        if (!gpuTex) return;

        const viewProj = camera.getViewMatrix().multiply(camera.getProjectionMatrix());
        device.queue.writeBuffer(camUbo, 0, new Float32Array(viewProj.toArray()));

        const dt = Math.min(engine.getDeltaTime() / 1000, 1 / 30);
        const time = (performance.now() - startTime) / 1000;
        device.queue.writeBuffer(simUbo, 0, new Float32Array([
            dt / SUBSTEPS, 9.8, GROUND_Y, BASKET_HALF, BASKET_TOP, 0.998, time, GROUND_HALF,
        ]));

        const ce = device.createCommandEncoder();
        const wg = Math.ceil(CONE_COUNT / 64);
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
            drawMesh(pass, coneMesh, CONE_COUNT);
            drawMesh(pass, cubeMesh, STATIC_COUNT, CONE_COUNT);
            if (showWireframe) {
                pass.setPipeline(coneWirePipeline);
                pass.setBindGroup(0, coneWireBindGroups[currentState]);
                pass.setVertexBuffer(0, coneWireVB);
                pass.setIndexBuffer(coneWireIB, 'uint16');
                pass.drawIndexed(coneWireCount, CONE_COUNT);
                pass.setPipeline(boxWirePipeline);
                pass.setBindGroup(0, boxWireBindGroup);
                pass.setVertexBuffer(0, boxWireVB);
                pass.setIndexBuffer(boxWireIB, 'uint16');
                pass.drawIndexed(boxWireCount, STATIC_COUNT);
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
