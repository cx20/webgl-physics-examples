'use strict';

// Babylon.js (WebGPUEngine) provides the camera, skybox, environment and ground,
// while the coins are simulated and drawn entirely on the GPU through custom WGSL
// compute + render passes that share Babylon's WebGPU device. The physics is a
// sphere-based "coin waterfall" that uses a uniform spatial grid for broad-phase
// collision, so dense piles slump and spread instead of jamming into a mountain.
//
// The coins are rendered into a RenderTargetTexture and composited over the Babylon
// scene with a Layer. Press W to toggle a wireframe view of the spherical colliders.

const BASE_URL = 'https://cx20.github.io/gltf-test';
const TEXTURE_FLOOR = '../../../../assets/textures/floor_bump.png';
const TEXTURE_ROCK = '../../../../assets/textures/rockn.png';

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
        -Math.PI / 180 * 30, Math.PI / 180 * 90, 40,
        BABYLON.Vector3.Zero(), scene);
    camera.setTarget(BABYLON.Vector3.Zero());
    camera.attachControl(canvas, true);
    camera.minZ = 0.1;
    camera.maxZ = 200;

    const cubeTexture = new BABYLON.CubeTexture(
        BASE_URL + '/textures/env/papermillSpecularHDR.env', scene);
    scene.createDefaultSkybox(cubeTexture, true);
    scene.environmentTexture = cubeTexture;
    new BABYLON.HemisphericLight('light0', new BABYLON.Vector3(1, 1, 0), scene);

    await waitForReady(cubeTexture);

    // Coin textures, loaded through Babylon so we can hand their GPU resources to WGSL.
    const texFloor = new BABYLON.Texture(TEXTURE_FLOOR, scene);
    const texRock = new BABYLON.Texture(TEXTURE_ROCK, scene);
    await Promise.all([texFloor, texRock].map(waitForReady));

    const ground = BABYLON.MeshBuilder.CreateGround('ground', { width: 20, height: 20 }, scene);
    ground.position.y = -10;
    const groundMat = new BABYLON.PBRMaterial('groundMat', scene);
    groundMat.metallic = 0;
    groundMat.roughness = 0.8;
    groundMat.albedoColor = new BABYLON.Color3(0.4, 0.4, 0.4);
    ground.material = groundMat;

    // ============================================================
    // Custom WebGPU path (shares Babylon's device)
    // ============================================================
    const device = engine._device;
    const envInternal = cubeTexture._texture;
    const envGpuTex = envInternal._hardwareTexture.underlyingResource;
    const envMaxMip = Math.max(0, Math.floor(Math.log2(envInternal.width)));
    const envSampler = device.createSampler({
        magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear',
        addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge',
    });

    const texFloorGpu = texFloor._texture._hardwareTexture.underlyingResource;
    const texRockGpu = texRock._texture._hardwareTexture.underlyingResource;
    const texSampler = device.createSampler({
        magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear',
        addressModeU: 'repeat', addressModeV: 'repeat',
    });

    const COIN_COUNT = 5000;
    const NUM_TYPES = 3;
    const NUM_LODS = 3;
    const NUM_CATEGORIES = NUM_TYPES * NUM_LODS;

    const FLOOR_Y = -10;
    const WALL_X = 10;
    const WALL_Z = 10;

    const GRID_X = 64, GRID_Y = 64, GRID_Z = 64;
    const GRID_CELLS = GRID_X * GRID_Y * GRID_Z;
    const CELL_CAPACITY = 6;
    const CELL_SIZE = 0.6;

    // UV cylinder (vertex = 12 floats: pos(4) + normal(4) + uv(2) + pad(2)).
    function makeCylinder(height, diameter, segments) {
        const data = [], indices = [];
        const r = diameter * 0.5;
        const h = height * 0.5;
        let cur = 0;

        // Top cap (faceUV[0] = aspect-preserving).
        const topCenterIdx = cur;
        data.push(0, h, 0, 1, 0, 1, 0, 0, 0.5, 0.5, 0, 0); cur++;
        const topRingStart = cur;
        for (let i = 0; i < segments; i++) {
            const a = (i / segments) * Math.PI * 2;
            const u = 0.5 + 0.5 * Math.cos(a);
            const v = 0.5 + 0.5 * Math.sin(a);
            data.push(Math.cos(a) * r, h, Math.sin(a) * r, 1, 0, 1, 0, 0, u, v, 0, 0); cur++;
        }
        for (let i = 0; i < segments; i++) {
            const i0 = topRingStart + i;
            const i1 = topRingStart + ((i + 1) % segments);
            indices.push(topCenterIdx, i1, i0);
        }

        // Bottom cap.
        const botCenterIdx = cur;
        data.push(0, -h, 0, 1, 0, -1, 0, 0, 0.5, 0.5, 0, 0); cur++;
        const botRingStart = cur;
        for (let i = 0; i < segments; i++) {
            const a = (i / segments) * Math.PI * 2;
            const u = 0.5 + 0.5 * Math.cos(a);
            const v = 0.5 + 0.5 * Math.sin(a);
            data.push(Math.cos(a) * r, -h, Math.sin(a) * r, 1, 0, -1, 0, 0, u, v, 0, 0); cur++;
        }
        for (let i = 0; i < segments; i++) {
            const i0 = botRingStart + i;
            const i1 = botRingStart + ((i + 1) % segments);
            indices.push(botCenterIdx, i0, i1);
        }

        // Side: wrap horizontally, 0..1 vertically.
        for (let i = 0; i < segments; i++) {
            const a0 = (i / segments) * Math.PI * 2;
            const a1 = ((i + 1) / segments) * Math.PI * 2;
            const c0 = Math.cos(a0), s0 = Math.sin(a0);
            const c1 = Math.cos(a1), s1 = Math.sin(a1);
            const u0 = i / segments;
            const u1 = (i + 1) / segments;
            const i0 = cur;
            data.push(c0 * r, h, s0 * r, 1, c0, 0, s0, 0, u0, 0, 0, 0); cur++;
            data.push(c1 * r, h, s1 * r, 1, c1, 0, s1, 0, u1, 0, 0, 0); cur++;
            data.push(c1 * r, -h, s1 * r, 1, c1, 0, s1, 0, u1, 1, 0, 0); cur++;
            data.push(c0 * r, -h, s0 * r, 1, c0, 0, s0, 0, u0, 1, 0, 0); cur++;
            indices.push(i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3);
        }
        return { data: new Float32Array(data), indices: new Uint32Array(indices) };
    }

    const coinDims = [
        { height: 0.1, diameter: 1.0 },
        { height: 0.075, diameter: 0.8 },
        { height: 0.05, diameter: 0.6 },
    ];
    // Segment count per LOD; even the lowest LOD stays round enough to read as a coin.
    const lodSegments = [48, 32, 24];

    const allGeoms = [];
    for (let t = 0; t < NUM_TYPES; t++) {
        for (let l = 0; l < NUM_LODS; l++) {
            allGeoms.push(makeCylinder(coinDims[t].height, coinDims[t].diameter, lodSegments[l]));
        }
    }
    const VERT_STRIDE = 48, FLOATS_PER_VERT = 12;   // stride = 48 bytes
    let totalVerts = 0, totalIdx = 0;
    const geomInfo = allGeoms.map((g) => {
        const info = { baseVertex: totalVerts, firstIndex: totalIdx, indexCount: g.indices.length };
        totalVerts += g.data.length / FLOATS_PER_VERT;
        totalIdx += g.indices.length;
        return info;
    });
    const allVerts = new Float32Array(totalVerts * FLOATS_PER_VERT);
    const allIndices = new Uint32Array(totalIdx);
    {
        let vOff = 0, iOff = 0;
        for (const g of allGeoms) {
            allVerts.set(g.data, vOff);
            allIndices.set(g.indices, iOff);
            vOff += g.data.length;
            iOff += g.indices.length;
        }
    }

    const COIN_FLOATS = 16;
    const coinData = new Float32Array(COIN_COUNT * COIN_FLOATS);
    for (let i = 0; i < COIN_COUNT; i++) {
        const o = i * COIN_FLOATS;
        coinData[o + 0] = (Math.random() - 0.5) * 200;
        coinData[o + 1] = -1000 - i * 0.01;            // start asleep, far below
        coinData[o + 2] = (Math.random() - 0.5) * 200;
        coinData[o + 3] = Math.floor(Math.random() * NUM_TYPES);
        const u = Math.random(), v = Math.random();
        const theta = u * Math.PI * 2;
        const phi = Math.acos(2 * v - 1);
        coinData[o + 8] = Math.sin(phi) * Math.cos(theta);   // random tumble axis
        coinData[o + 9] = Math.sin(phi) * Math.sin(theta);
        coinData[o + 10] = Math.cos(phi);
        coinData[o + 12] = Math.random() * Math.PI * 2;      // spin phase
        coinData[o + 13] = 0.5 + Math.random() * 1.5;        // spin rate
    }

    const mkBuf = (data, usage) => {
        const buf = device.createBuffer({ size: data.byteLength, usage, mappedAtCreation: true });
        new data.constructor(buf.getMappedRange()).set(data);
        buf.unmap();
        return buf;
    };

    const positionsBuffer = mkBuf(allVerts, GPUBufferUsage.VERTEX);
    const indexBuffer = mkBuf(allIndices, GPUBufferUsage.INDEX);
    const coinBuffer = mkBuf(coinData, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);

    // Wireframe collider sphere: three orthogonal great circles as a line list.
    const wireData = [];
    {
        const seg = 32;
        const ring = (axis) => {
            for (let i = 0; i < seg; i++) {
                const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
                const p = (a) => {
                    const c = Math.cos(a), s = Math.sin(a);
                    if (axis === 0) return [0, c, s];
                    if (axis === 1) return [c, 0, s];
                    return [c, s, 0];
                };
                wireData.push(...p(a0), ...p(a1));
            }
        };
        ring(0); ring(1); ring(2);
    }
    const wireVerts = new Float32Array(wireData);
    const wireVertCount = wireVerts.length / 3;
    const wireBuffer = mkBuf(wireVerts, GPUBufferUsage.VERTEX);

    const visibleBuffer = device.createBuffer({
        size: NUM_CATEGORIES * COIN_COUNT * 4, usage: GPUBufferUsage.STORAGE,
    });
    const indirectBuffer = device.createBuffer({
        size: NUM_CATEGORIES * 5 * 4,
        usage: GPUBufferUsage.INDIRECT | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const counterBuffer = device.createBuffer({
        size: NUM_CATEGORIES * 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });
    const gridBuffer = device.createBuffer({
        size: GRID_CELLS * (CELL_CAPACITY + 1) * 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const simUboSize = 16 * 4;
    const simUbo = device.createBuffer({ size: simUboSize, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const camUboSize = (16 + 4 + 4 * 6 + 4) * 4;
    const camUbo = device.createBuffer({ size: camUboSize, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    const COMMON = `
const GRID_X : u32 = ${GRID_X}u;
const GRID_Y : u32 = ${GRID_Y}u;
const GRID_Z : u32 = ${GRID_Z}u;
const CELL_CAPACITY : u32 = ${CELL_CAPACITY}u;
const CELL_SIZE : f32 = ${CELL_SIZE};
const FLOOR_Y_C : f32 = ${FLOOR_Y}.0;

fn cellCoord(p: vec3<f32>) -> vec3<i32> {
  return vec3<i32>(
    i32(floor(p.x / CELL_SIZE + f32(GRID_X) * 0.5)),
    i32(floor((p.y - FLOOR_Y_C) / CELL_SIZE)),
    i32(floor(p.z / CELL_SIZE + f32(GRID_Z) * 0.5)),
  );
}
fn cellHash(c: vec3<i32>) -> i32 {
  if (c.x < 0 || c.x >= i32(GRID_X)) { return -1; }
  if (c.y < 0 || c.y >= i32(GRID_Y)) { return -1; }
  if (c.z < 0 || c.z >= i32(GRID_Z)) { return -1; }
  return c.x + c.y * i32(GRID_X) + c.z * i32(GRID_X) * i32(GRID_Y);
}
`;

    const resetWGSL = `
struct DrawArg {
  indexCount : u32, instanceCount : u32, firstIndex : u32,
  baseVertex : i32, firstInstance : u32,
}
struct Init { args : array<DrawArg, ${NUM_CATEGORIES}> }
@group(0) @binding(0) var<storage, read_write> draws    : array<DrawArg, ${NUM_CATEGORIES}>;
@group(0) @binding(1) var<uniform>              init     : Init;
@group(0) @binding(2) var<storage, read_write> counters : array<u32, ${NUM_CATEGORIES}>;
@group(0) @binding(3) var<storage, read_write> grid     : array<u32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let i = gid.x;
  if (i < ${NUM_CATEGORIES}u) {
    draws[i] = init.args[i];
    counters[i] = 0u;
  }
  let total = arrayLength(&grid);
  var k = i;
  loop {
    if (k >= total) { break; }
    grid[k] = 0u;
    k = k + 64u * 2048u;
  }
}
`;

    const buildGridWGSL = `
${COMMON}
struct Coin { pos:vec4<f32>, vel:vec4<f32>, axis:vec4<f32>, spin:vec4<f32>, }
@group(0) @binding(0) var<storage, read>        coins : array<Coin>;
@group(0) @binding(1) var<storage, read_write>  grid  : array<atomic<u32>>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let pid = gid.x;
  if (pid >= arrayLength(&coins)) { return; }
  let c = coins[pid];
  let cidx = cellHash(cellCoord(c.pos.xyz));
  if (cidx < 0) { return; }
  let base = u32(cidx) * (CELL_CAPACITY + 1u);
  let slot = atomicAdd(&grid[base], 1u);
  if (slot < CELL_CAPACITY) {
    atomicStore(&grid[base + 1u + slot], pid);
  }
}
`;

    // Physics: spheres in a uniform grid. Per-cell capacity caps how many contacts
    // a coin resolves, so dense piles slump and spread instead of jamming, and the
    // collision response uses a Jacobi update (accumulate, then apply) to avoid a
    // directional bias from the cell scan order.
    const physWGSL = `
${COMMON}
struct Coin { pos:vec4<f32>, vel:vec4<f32>, axis:vec4<f32>, spin:vec4<f32>, }
struct Sim { params:vec4<f32>, bounds:vec4<f32>, source:vec4<f32>, flags:vec4<f32>, }
@group(0) @binding(0) var<storage, read_write> coins : array<Coin>;
@group(0) @binding(1) var<storage, read>       grid  : array<u32>;
@group(0) @binding(2) var<uniform>             sim   : Sim;

const COIN_RADIUS : f32 = 0.4;
const RESTITUTION : f32 = 0.2;
const FLOOR_FRICTION : f32 = 0.92;
const SPAWN_RADIUS : f32 = 2.0;

// PCG hash so streamed spawn positions are not biased (a sin-based hash correlates
// linear seeds and clumps the drops along a diagonal).
fn pcgHash(v: u32) -> u32 {
  let state = v * 747796405u + 2891336453u;
  let word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}
fn rnd(seed: u32) -> f32 {
  return f32(pcgHash(seed)) * (1.0 / 4294967296.0);
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let pid = gid.x;
  if (pid >= arrayLength(&coins)) { return; }
  var c = coins[pid];

  let dt = clamp(sim.params.x, 1.0 / 120.0, 1.0 / 30.0);
  let time = sim.params.y;
  let spawnDuration = sim.params.z;
  let spawnTime = f32(pid) / f32(${COIN_COUNT}u) * spawnDuration;
  let isAsleep = c.pos.y < -50.0;

  if (isAsleep) {
    if (time >= spawnTime) {
      // Uniform disk so coins fall radially symmetric; per-coin and time-varied salt
      // so a recycled coin reappears at a fresh point in the column.
      let salt = pid * 2654435761u + u32(time * 60.0) * 40503u;
      let ang = rnd(salt) * 6.28318530718;
      let rad = sqrt(rnd(salt ^ 0x68bc21ebu)) * SPAWN_RADIUS;
      c.pos = vec4<f32>(cos(ang) * rad, 40.0, sin(ang) * rad, c.pos.w);
      c.vel = vec4<f32>(0.0, -1.0, 0.0, 0.0);
    }
    coins[pid] = c;
    return;
  }

  c.vel.y = c.vel.y - 9.81 * dt;

  // Collision response: accumulate corrections and apply after the loop (Jacobi),
  // so the push-out does not inherit a bias from the cell scan order.
  var posCorr = vec3<f32>(0.0, 0.0, 0.0);
  var velCorr = vec3<f32>(0.0, 0.0, 0.0);
  let myCoord = cellCoord(c.pos.xyz);
  for (var dz = -1; dz <= 1; dz = dz + 1) {
    for (var dy = -1; dy <= 1; dy = dy + 1) {
      for (var dx = -1; dx <= 1; dx = dx + 1) {
        let cidx = cellHash(myCoord + vec3<i32>(dx, dy, dz));
        if (cidx < 0) { continue; }
        let base = u32(cidx) * (CELL_CAPACITY + 1u);
        let count = min(grid[base], CELL_CAPACITY);
        for (var k = 0u; k < count; k = k + 1u) {
          let other = grid[base + 1u + k];
          if (other == pid) { continue; }
          let q = coins[other];
          let diff = q.pos.xyz - c.pos.xyz;   // c -> q
          let d = length(diff);
          let minD = COIN_RADIUS * 2.0;
          if (d < minD && d > 0.0001) {
            let n = diff / d;
            let overlap = minD - d;
            posCorr = posCorr - n * (overlap * 0.5);   // push away from q
            let relV = c.vel.xyz - q.vel.xyz;
            let vn = dot(relV, n);
            // n points c -> q, so vn > 0 means approaching.
            if (vn > 0.0) {
              velCorr = velCorr - n * (vn * (1.0 + RESTITUTION) * 0.5);
            }
          }
        }
      }
    }
  }
  c.pos = vec4<f32>(c.pos.xyz + posCorr, c.pos.w);
  c.vel = vec4<f32>(c.vel.xyz + velCorr, c.vel.w);

  let onFloorArea = abs(c.pos.x) < sim.bounds.y && abs(c.pos.z) < sim.bounds.z;
  if (onFloorArea && c.pos.y - COIN_RADIUS < sim.bounds.x) {
    c.pos.y = sim.bounds.x + COIN_RADIUS;
    if (c.vel.y < 0.0) { c.vel.y = -c.vel.y * RESTITUTION; }
    c.vel.x = c.vel.x * FLOOR_FRICTION;
    c.vel.z = c.vel.z * FLOOR_FRICTION;
  }

  let speed = length(c.vel.xyz);
  if (speed > 25.0) { c.vel = vec4<f32>(c.vel.xyz * (25.0 / speed), c.vel.w); }

  c.pos = vec4<f32>(c.pos.xyz + c.vel.xyz * dt, c.pos.w);

  let inAir = !onFloorArea || c.pos.y - COIN_RADIUS > sim.bounds.x + 0.05;
  let spinFactor = select(0.3, 1.0, inAir);
  let spinSpeed = c.spin.y * (4.0 + speed * 0.5) * spinFactor;
  c.spin.x = c.spin.x + spinSpeed * dt;

  if (c.pos.y < sim.bounds.x - 30.0) {
    // Back to sleep; x/z are overwritten by the next frame's respawn.
    c.pos = vec4<f32>(0.0, -1000.0 - f32(pid) * 0.01, 0.0, c.pos.w);
    c.vel = vec4<f32>(0.0, 0.0, 0.0, 0.0);
  }

  coins[pid] = c;
}
`;

    const cullClassifyWGSL = `
struct Coin { pos:vec4<f32>, vel:vec4<f32>, axis:vec4<f32>, spin:vec4<f32>, }
struct DrawArg {
  indexCount:u32, instanceCount:atomic<u32>, firstIndex:u32,
  baseVertex:i32, firstInstance:u32,
}
struct Camera {
  viewProj:mat4x4<f32>, camPos:vec4<f32>,
  planes:array<vec4<f32>,6>, lodDist:vec4<f32>,
}
@group(0) @binding(0) var<storage, read>        coins   : array<Coin>;
@group(0) @binding(1) var<storage, read_write>  draws   : array<DrawArg, ${NUM_CATEGORIES}>;
@group(0) @binding(2) var<storage, read_write>  visible : array<u32>;
@group(0) @binding(3) var<storage, read_write>  counters: array<atomic<u32>, ${NUM_CATEGORIES}>;
@group(0) @binding(4) var<uniform>              cam     : Camera;
const MAX_PER_CAT : u32 = ${COIN_COUNT}u;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let pid = gid.x;
  if (pid >= arrayLength(&coins)) { return; }
  let c = coins[pid];
  let center = c.pos.xyz;
  if (center.y < -50.0) { return; }
  let dist = length(center - cam.camPos.xyz);
  if (dist > 100.0) { return; }
  var lod : u32 = 2u;
  if (dist < cam.lodDist.x)      { lod = 0u; }
  else if (dist < cam.lodDist.y) { lod = 1u; }
  let coinType = u32(c.pos.w + 0.5);
  let cat = coinType * 3u + lod;
  let slot = atomicAdd(&counters[cat], 1u);
  if (slot < MAX_PER_CAT) {
    visible[cat * MAX_PER_CAT + slot] = pid;
    atomicAdd(&draws[cat].instanceCount, 1u);
  }
}
`;

    // Render: the coin color comes only from the per-type metal albedo; the texture
    // (floor_bump / rockn) is used as a tangent-space normal map to perturb the
    // surface normal, and lighting is a small PBR + image-based reflection.
    const renderWGSL = `
struct Coin { pos:vec4<f32>, vel:vec4<f32>, axis:vec4<f32>, spin:vec4<f32>, }
struct Camera {
  viewProj:mat4x4<f32>, camPos:vec4<f32>,
  planes:array<vec4<f32>,6>, lodDist:vec4<f32>,
}
struct CatParams { baseOffset:u32, coinType:u32, }
@group(0) @binding(0) var<storage, read> coins   : array<Coin>;
@group(0) @binding(1) var<storage, read> visible : array<u32>;
@group(0) @binding(2) var<uniform>       cam     : Camera;
@group(0) @binding(3) var<uniform>       cp      : CatParams;
@group(0) @binding(4) var                envMap  : texture_cube<f32>;
@group(0) @binding(5) var                envSampler: sampler;
@group(0) @binding(6) var                bumpTex : texture_2d<f32>;
@group(0) @binding(7) var                bumpSampler : sampler;

override MAX_MIP : f32 = 8.0;
const BUMP_STRENGTH : f32 = 1.0;     // 1 = full normal map, 0 = flat
const BUMP_GREEN_SIGN : f32 = 1.0;   // flip to -1 if the bumps look inverted
struct VSIn {
  @location(0) position : vec4<f32>,
  @location(1) normal   : vec4<f32>,
  @location(2) uv       : vec2<f32>,
  @builtin(instance_index) iid : u32,
}
struct VSOut {
  @builtin(position) pos : vec4<f32>,
  @location(0) worldPos : vec3<f32>,
  @location(1) worldNormal : vec3<f32>,
  @location(2) uv : vec2<f32>,
}
fn rotByAxisAngle(v: vec3<f32>, axis: vec3<f32>, angle: f32) -> vec3<f32> {
  let cs = cos(angle);
  let sn = sin(angle);
  return v * cs + cross(axis, v) * sn + axis * dot(axis, v) * (1.0 - cs);
}
@vertex
fn vs(input : VSIn) -> VSOut {
  let realIdx = visible[cp.baseOffset + input.iid];
  let c = coins[realIdx];
  let axis = normalize(c.axis.xyz);
  let angle = c.spin.x;
  let rotPos = rotByAxisAngle(input.position.xyz, axis, angle);
  let rotNorm = rotByAxisAngle(input.normal.xyz, axis, angle);
  let world = rotPos + c.pos.xyz;
  var out : VSOut;
  let clipPos = cam.viewProj * vec4<f32>(world, 1.0);
  out.pos = vec4<f32>(clipPos.x, -clipPos.y, clipPos.z, clipPos.w);
  out.worldPos = world;
  out.worldNormal = rotNorm;
  out.uv = input.uv;
  return out;
}
const PI : f32 = 3.14159265359;
fn distGGX(N: vec3<f32>, H: vec3<f32>, r: f32) -> f32 {
  let a = r * r; let a2 = a * a;
  let NdH = max(dot(N, H), 0.0);
  let d = NdH * NdH * (a2 - 1.0) + 1.0;
  return a2 / (PI * d * d);
}
fn smithG(N: vec3<f32>, V: vec3<f32>, L: vec3<f32>, r: f32) -> f32 {
  let k = (r + 1.0) * (r + 1.0) / 8.0;
  let NdV = max(dot(N, V), 0.0);
  let NdL = max(dot(N, L), 0.0);
  return (NdV / (NdV * (1.0 - k) + k)) * (NdL / (NdL * (1.0 - k) + k));
}
fn fresnel(c: f32, F0: vec3<f32>) -> vec3<f32> {
  return F0 + (vec3<f32>(1.0) - F0) * pow(clamp(1.0 - c, 0.0, 1.0), 5.0);
}
fn fresnelRough(c: f32, F0: vec3<f32>, r: f32) -> vec3<f32> {
  let inv = vec3<f32>(1.0 - r);
  return F0 + (max(inv, F0) - F0) * pow(clamp(1.0 - c, 0.0, 1.0), 5.0);
}
fn sampleIBL(dir: vec3<f32>, roughness: f32) -> vec3<f32> {
  let mip = roughness * MAX_MIP;
  let d = vec3<f32>(-dir.x, dir.y, dir.z);
  return textureSampleLevel(envMap, envSampler, d, mip).rgb;
}
// Normal mapping without precomputed tangents (Christian Schuler): recover a tangent
// frame from screen-space derivatives and bring the tangent-space normal to world.
fn perturbNormal(Ng: vec3<f32>, worldPos: vec3<f32>, uv: vec2<f32>, nTan: vec3<f32>) -> vec3<f32> {
  let pdx = dpdx(worldPos);
  let pdy = dpdy(worldPos);
  let uvdx = dpdx(uv);
  let uvdy = dpdy(uv);
  let dp2perp = cross(pdy, Ng);
  let dp1perp = cross(Ng, pdx);
  let T = dp2perp * uvdx.x + dp1perp * uvdy.x;
  let B = dp2perp * uvdx.y + dp1perp * uvdy.y;
  let invmax = inverseSqrt(max(dot(T, T), dot(B, B)));
  let TBN = mat3x3<f32>(T * invmax, B * invmax, Ng);
  return normalize(TBN * nTan);
}
@fragment
fn fs(in : VSOut) -> @location(0) vec4<f32> {
  let Ng = normalize(in.worldNormal);
  let V = normalize(cam.camPos.xyz - in.worldPos);

  // Texture is treated purely as a normal map (never tints the color).
  let sample = textureSample(bumpTex, bumpSampler, in.uv).xyz;
  let nTan = vec3<f32>(
      (sample.xy * 2.0 - 1.0) * vec2<f32>(BUMP_STRENGTH, BUMP_STRENGTH * BUMP_GREEN_SIGN),
      sample.z * 2.0 - 1.0);
  let N = perturbNormal(Ng, in.worldPos, in.uv, nTan);

  // Base color: per-type metal color (no texture tint).
  var baseColor : vec3<f32>;
  var roughness : f32;
  if (cp.coinType == 0u) {
    baseColor = vec3<f32>(1.000, 0.766, 0.336);   // GOLD
    roughness = 0.2;
  } else if (cp.coinType == 1u) {
    baseColor = vec3<f32>(0.972, 0.960, 0.915);   // SILVER
    roughness = 0.4;
  } else {
    baseColor = vec3<f32>(0.955, 0.637, 0.538);   // COPPER
    roughness = 0.2;
  }

  // Metallic workflow: albedo is F0 directly (almost no diffuse).
  let albedo = baseColor;
  let F0 = albedo;

  let L = normalize(vec3<f32>(0.4, 0.7, 0.3));
  let H = normalize(V + L);
  let NdL = max(dot(N, L), 0.0);
  var Lo = vec3<f32>(0.0);
  if (NdL > 0.0) {
    let D = distGGX(N, H, max(roughness, 0.04));
    let G = smithG(N, V, L, roughness);
    let F = fresnel(max(dot(H, V), 0.0), F0);
    let spec = (D * G * F) / (4.0 * max(dot(N, V), 0.0) * NdL + 0.0001);
    Lo = spec * vec3<f32>(1.0, 0.95, 0.85) * 1.5 * NdL;
  }
  let R = reflect(-V, N);
  let NdV = max(dot(N, V), 0.0);
  let prefiltered = sampleIBL(R, roughness);
  let F_env = fresnelRough(NdV, F0, roughness);
  let irradiance = sampleIBL(N, 1.0);
  let ambient = irradiance * F0 * 0.3 + prefiltered * F_env * 1.4;
  var color = ambient + Lo;
  color = color / (color + vec3<f32>(1.0));
  color = pow(color, vec3<f32>(1.0 / 2.2));
  return vec4<f32>(color, 1.0);
}
`;

    // Wireframe of the spherical collider (radius = COIN_RADIUS), drawn as line lists.
    const wireWGSL = `
struct Coin { pos:vec4<f32>, vel:vec4<f32>, axis:vec4<f32>, spin:vec4<f32>, }
struct Camera {
  viewProj:mat4x4<f32>, camPos:vec4<f32>,
  planes:array<vec4<f32>,6>, lodDist:vec4<f32>,
}
@group(0) @binding(0) var<storage, read> coins : array<Coin>;
@group(0) @binding(1) var<uniform>       cam   : Camera;
const COIN_RADIUS : f32 = 0.4;
@vertex
fn vs(@location(0) position : vec3<f32>, @builtin(instance_index) iid : u32) -> @builtin(position) vec4<f32> {
  let c = coins[iid];
  let world = position * COIN_RADIUS + c.pos.xyz;
  let clip = cam.viewProj * vec4<f32>(world, 1.0);
  return vec4<f32>(clip.x, -clip.y, clip.z, clip.w);
}
@fragment
fn fs() -> @location(0) vec4<f32> { return vec4<f32>(0.1, 1.0, 0.35, 1.0); }
`;

    const resetModule = device.createShaderModule({ code: resetWGSL });
    const buildGridModule = device.createShaderModule({ code: buildGridWGSL });
    const physModule = device.createShaderModule({ code: physWGSL });
    const cullModule = device.createShaderModule({ code: cullClassifyWGSL });
    const renderModule = device.createShaderModule({ code: renderWGSL });
    const wireModule = device.createShaderModule({ code: wireWGSL });

    const resetPipeline = device.createComputePipeline({ layout: 'auto', compute: { module: resetModule, entryPoint: 'main' } });
    const buildGridPipeline = device.createComputePipeline({ layout: 'auto', compute: { module: buildGridModule, entryPoint: 'main' } });
    const physPipeline = device.createComputePipeline({ layout: 'auto', compute: { module: physModule, entryPoint: 'main' } });
    const cullPipeline = device.createComputePipeline({ layout: 'auto', compute: { module: cullModule, entryPoint: 'main' } });

    const rttSize = { width: engine.getRenderWidth(), height: engine.getRenderHeight() };
    const coinRtt = new BABYLON.RenderTargetTexture('coinRTT', rttSize, scene, {
        generateMipMaps: false,
        type: BABYLON.Constants.TEXTURETYPE_UNSIGNED_BYTE,
        format: BABYLON.Constants.TEXTUREFORMAT_RGBA,
    });
    const coinLayer = new BABYLON.Layer('coinLayer', null, scene, false);
    coinLayer.texture = coinRtt;
    coinLayer.alphaBlendingMode = BABYLON.Engine.ALPHA_COMBINE;

    const depthTex = device.createTexture({
        size: [rttSize.width, rttSize.height],
        format: 'depth24plus',
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });

    const renderPipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: {
            module: renderModule, entryPoint: 'vs',
            constants: { MAX_MIP: envMaxMip },
            buffers: [{
                arrayStride: VERT_STRIDE,
                attributes: [
                    { shaderLocation: 0, offset: 0, format: 'float32x4' },
                    { shaderLocation: 1, offset: 16, format: 'float32x4' },
                    { shaderLocation: 2, offset: 32, format: 'float32x2' },
                ],
            }],
        },
        fragment: {
            module: renderModule, entryPoint: 'fs',
            constants: { MAX_MIP: envMaxMip },
            targets: [{ format: 'rgba8unorm' }],
        },
        primitive: { topology: 'triangle-list', cullMode: 'front' },
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

    const catParamUbos = [];
    for (let cat = 0; cat < NUM_CATEGORIES; cat++) {
        const buf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        const coinType = Math.floor(cat / 3);
        device.queue.writeBuffer(buf, 0, new Uint32Array([cat * COIN_COUNT, coinType, 0, 0]));
        catParamUbos.push(buf);
    }

    const initData = new ArrayBuffer(NUM_CATEGORIES * 5 * 4);
    {
        const u32 = new Uint32Array(initData);
        const i32 = new Int32Array(initData);
        for (let i = 0; i < NUM_CATEGORIES; i++) {
            u32[i * 5 + 0] = geomInfo[i].indexCount;
            u32[i * 5 + 1] = 0;
            u32[i * 5 + 2] = geomInfo[i].firstIndex;
            i32[i * 5 + 3] = geomInfo[i].baseVertex;
            u32[i * 5 + 4] = 0;
        }
    }
    const initUbo = device.createBuffer({ size: initData.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(initUbo, 0, initData);

    const resetBindGroup = device.createBindGroup({
        layout: resetPipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: indirectBuffer } },
            { binding: 1, resource: { buffer: initUbo } },
            { binding: 2, resource: { buffer: counterBuffer } },
            { binding: 3, resource: { buffer: gridBuffer } },
        ],
    });
    const buildGridBindGroup = device.createBindGroup({
        layout: buildGridPipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: coinBuffer } },
            { binding: 1, resource: { buffer: gridBuffer } },
        ],
    });
    const physBindGroup = device.createBindGroup({
        layout: physPipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: coinBuffer } },
            { binding: 1, resource: { buffer: gridBuffer } },
            { binding: 2, resource: { buffer: simUbo } },
        ],
    });
    const cullBindGroup = device.createBindGroup({
        layout: cullPipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: coinBuffer } },
            { binding: 1, resource: { buffer: indirectBuffer } },
            { binding: 2, resource: { buffer: visibleBuffer } },
            { binding: 3, resource: { buffer: counterBuffer } },
            { binding: 4, resource: { buffer: camUbo } },
        ],
    });

    const envView = envGpuTex.createView({ dimension: 'cube' });

    // Per-type texture (GOLD -> floor_bump, SILVER/COPPER -> rockn).
    const texViewByType = [texFloorGpu.createView(), texRockGpu.createView(), texRockGpu.createView()];

    const renderBindGroups = [];
    for (let cat = 0; cat < NUM_CATEGORIES; cat++) {
        const coinType = Math.floor(cat / 3);
        renderBindGroups.push(device.createBindGroup({
            layout: renderPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: coinBuffer } },
                { binding: 1, resource: { buffer: visibleBuffer } },
                { binding: 2, resource: { buffer: camUbo } },
                { binding: 3, resource: { buffer: catParamUbos[cat] } },
                { binding: 4, resource: envView },
                { binding: 5, resource: envSampler },
                { binding: 6, resource: texViewByType[coinType] },
                { binding: 7, resource: texSampler },
            ],
        }));
    }

    const wireBindGroup = device.createBindGroup({
        layout: wirePipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: coinBuffer } },
            { binding: 1, resource: { buffer: camUbo } },
        ],
    });

    const hint = document.getElementById('hint');
    let frameCount = 0, lastFpsT = performance.now(), fps = 0;
    const startTime = performance.now();
    const SPAWN_DURATION = COIN_COUNT / 1666;

    scene.onBeforeRenderObservable.add(() => {
        const internalTex = coinRtt.getInternalTexture();
        if (!internalTex || !internalTex._hardwareTexture) return;
        const gpuTex = internalTex._hardwareTexture.underlyingResource;
        if (!gpuTex) return;

        const view = camera.getViewMatrix();
        const proj = camera.getProjectionMatrix();
        const viewProj = view.multiply(proj);
        const m = viewProj.m;
        const planes = [
            [m[3] + m[0], m[7] + m[4], m[11] + m[8], m[15] + m[12]],
            [m[3] - m[0], m[7] - m[4], m[11] - m[8], m[15] - m[12]],
            [m[3] + m[1], m[7] + m[5], m[11] + m[9], m[15] + m[13]],
            [m[3] - m[1], m[7] - m[5], m[11] - m[9], m[15] - m[13]],
            [m[3] + m[2], m[7] + m[6], m[11] + m[10], m[15] + m[14]],
            [m[3] - m[2], m[7] - m[6], m[11] - m[10], m[15] - m[14]],
        ].map((p) => {
            const len = Math.hypot(p[0], p[1], p[2]) || 1;
            return [p[0] / len, p[1] / len, p[2] / len, p[3] / len];
        });
        const camPos = camera.position;
        const camData = new Float32Array(camUboSize / 4);
        camData.set(viewProj.toArray(), 0);
        camData[16] = camPos.x; camData[17] = camPos.y; camData[18] = camPos.z; camData[19] = 0;
        for (let i = 0; i < 6; i++) {
            camData[20 + i * 4 + 0] = planes[i][0];
            camData[20 + i * 4 + 1] = planes[i][1];
            camData[20 + i * 4 + 2] = planes[i][2];
            camData[20 + i * 4 + 3] = planes[i][3];
        }
        // LOD switch distances tuned for camera radius ~40: <25 LOD0, 25..45 LOD1, >45 LOD2.
        camData[44] = 25; camData[45] = 45; camData[46] = 0; camData[47] = 0;
        device.queue.writeBuffer(camUbo, 0, camData);

        const dt = Math.min(engine.getDeltaTime() / 1000, 1 / 30);
        const time = (performance.now() - startTime) / 1000;
        const simData = new Float32Array(simUboSize / 4);
        simData[0] = dt;
        simData[1] = time;
        simData[2] = SPAWN_DURATION;
        simData[3] = 0;
        simData[4] = FLOOR_Y; simData[5] = WALL_X; simData[6] = WALL_Z;
        simData[7] = FLOOR_Y - 5;
        device.queue.writeBuffer(simUbo, 0, simData);

        const ce = device.createCommandEncoder();
        const wg = Math.ceil(COIN_COUNT / 64);

        {
            const cp = ce.beginComputePass();
            cp.setPipeline(resetPipeline);
            cp.setBindGroup(0, resetBindGroup);
            cp.dispatchWorkgroups(Math.ceil(GRID_CELLS * (CELL_CAPACITY + 1) / 64));
            cp.end();
        }
        {
            const cp = ce.beginComputePass();
            cp.setPipeline(buildGridPipeline);
            cp.setBindGroup(0, buildGridBindGroup);
            cp.dispatchWorkgroups(wg);
            cp.end();
        }
        {
            const cp = ce.beginComputePass();
            cp.setPipeline(physPipeline);
            cp.setBindGroup(0, physBindGroup);
            cp.dispatchWorkgroups(wg);
            cp.end();
        }
        {
            const cp = ce.beginComputePass();
            cp.setPipeline(cullPipeline);
            cp.setBindGroup(0, cullBindGroup);
            cp.dispatchWorkgroups(wg);
            cp.end();
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
            pass.setVertexBuffer(0, positionsBuffer);
            pass.setIndexBuffer(indexBuffer, 'uint32');
            for (let cat = 0; cat < NUM_CATEGORIES; cat++) {
                pass.setBindGroup(0, renderBindGroups[cat]);
                pass.drawIndexedIndirect(indirectBuffer, cat * 5 * 4);
            }
            if (showWireframe) {
                pass.setPipeline(wirePipeline);
                pass.setBindGroup(0, wireBindGroup);
                pass.setVertexBuffer(0, wireBuffer);
                pass.draw(wireVertCount, COIN_COUNT);
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
