'use strict';

// Babylon.js (WebGPUEngine) provides the camera, skybox, environment and ground,
// while the marbles are simulated and drawn entirely on the GPU through custom WGSL
// compute + render passes that share Babylon's WebGPU device. The marble geometry and
// its iridescent/metallic materials are loaded from the IridescenceMetallicSpheres glTF
// model; the physics is a sphere-based "marble waterfall" that uses a uniform spatial
// grid for broad-phase collision, so dense piles slump and spread instead of jamming.
//
// The marbles are rendered into a RenderTargetTexture and composited over the Babylon
// scene with a Layer. Press W to toggle a wireframe view of the spherical colliders.

const BASE_URL = 'https://cx20.github.io/gltf-test';
const MARBLES_GLTF_DIR = BASE_URL + '/tutorialModels/IridescenceMetallicSpheres/glTF/';
const MARBLES_GLTF_FILE = 'IridescenceMetallicSpheres.gltf';
const TEXTURE_GROUND = '../../../../assets/textures/grass.jpg';

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

// Pull the marble geometry (a single sphere, normalised to unit radius) and a palette of
// iridescent/metallic materials out of the glTF model. The meshes are disposed afterwards
// so only our custom GPU pass draws the marbles.
async function loadMarbleAssets() {
    const result = await BABYLON.SceneLoader.ImportMeshAsync(
        null, MARBLES_GLTF_DIR, MARBLES_GLTF_FILE, scene);

    const sphereMeshes = result.meshes.filter(
        (m) => m.name && m.name.indexOf('Sphere') !== -1 && m.getTotalVertices() > 0);
    const geoMeshes = sphereMeshes.length ? sphereMeshes : result.meshes.filter((m) => m.getTotalVertices() > 0);
    if (!geoMeshes.length) {
        throw new Error('No sphere meshes were found in the glTF model.');
    }

    // Geometry: take the first sphere and normalise it to a unit radius so the WGSL render
    // pass can scale every instance by the shared collider radius.
    const geoMesh = geoMeshes[0];
    const positions = Array.from(geoMesh.getVerticesData(BABYLON.VertexBuffer.PositionKind));
    const normals = geoMesh.getVerticesData(BABYLON.VertexBuffer.NormalKind)
        ? Array.from(geoMesh.getVerticesData(BABYLON.VertexBuffer.NormalKind))
        : null;
    const uvsRaw = geoMesh.getVerticesData(BABYLON.VertexBuffer.UVKind);
    const indices = Array.from(geoMesh.getIndices());
    const vertCount = positions.length / 3;

    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < vertCount; i++) {
        cx += positions[i * 3]; cy += positions[i * 3 + 1]; cz += positions[i * 3 + 2];
    }
    cx /= vertCount; cy /= vertCount; cz /= vertCount;
    let radius = 0;
    for (let i = 0; i < vertCount; i++) {
        const dx = positions[i * 3] - cx, dy = positions[i * 3 + 1] - cy, dz = positions[i * 3 + 2] - cz;
        radius = Math.max(radius, Math.hypot(dx, dy, dz));
    }
    if (radius < 1e-6) radius = 1;

    // Interleaved vertex = pos(3) + normal(3) + uv(2) = 8 floats (32 bytes).
    const verts = new Float32Array(vertCount * 8);
    for (let i = 0; i < vertCount; i++) {
        const o = i * 8;
        verts[o + 0] = (positions[i * 3] - cx) / radius;
        verts[o + 1] = (positions[i * 3 + 1] - cy) / radius;
        verts[o + 2] = (positions[i * 3 + 2] - cz) / radius;
        const nx = normals ? normals[i * 3] : positions[i * 3] - cx;
        const ny = normals ? normals[i * 3 + 1] : positions[i * 3 + 1] - cy;
        const nz = normals ? normals[i * 3 + 2] : positions[i * 3 + 2] - cz;
        const nl = Math.hypot(nx, ny, nz) || 1;
        verts[o + 3] = nx / nl;
        verts[o + 4] = ny / nl;
        verts[o + 5] = nz / nl;
        verts[o + 6] = uvsRaw ? uvsRaw[i * 2] : 0;
        verts[o + 7] = uvsRaw ? uvsRaw[i * 2 + 1] : 0;
    }
    const idx = new Uint32Array(indices);

    for (const m of result.meshes) m.dispose();

    // Material palette read straight from the glTF JSON, so it matches the
    // KHR_materials_iridescence / KHR_materials_ior parameters the model ships with
    // regardless of how a given Babylon version surfaces them.
    const palette = [];
    try {
        const gltf = await fetch(MARBLES_GLTF_DIR + MARBLES_GLTF_FILE).then((r) => r.json());
        for (const mat of (gltf.materials || [])) {
            const pbr = mat.pbrMetallicRoughness || {};
            const baseColorFactor = pbr.baseColorFactor || [0.8, 0.8, 0.85, 1];
            const metallic = (typeof pbr.metallicFactor === 'number') ? pbr.metallicFactor : 1.0;
            const roughness = (typeof pbr.roughnessFactor === 'number') ? pbr.roughnessFactor : 0.2;
            const ext = mat.extensions || {};
            const ior = (ext.KHR_materials_ior && typeof ext.KHR_materials_ior.ior === 'number')
                ? ext.KHR_materials_ior.ior : 1.5;
            let irFactor = 0.0, irIor = 1.3, thickness = 400.0;
            const ir = ext.KHR_materials_iridescence;
            if (ir) {
                if (typeof ir.iridescenceFactor === 'number') irFactor = ir.iridescenceFactor;
                if (typeof ir.iridescenceIor === 'number') irIor = ir.iridescenceIor;
                if (typeof ir.iridescenceThicknessMaximum === 'number') thickness = ir.iridescenceThicknessMaximum;
            }
            palette.push({
                baseColor: [baseColorFactor[0], baseColorFactor[1], baseColorFactor[2]],
                ior, irFactor, irIor, thickness, metallic, roughness,
            });
        }
    } catch (e) {
        console.warn('Could not read glTF materials, falling back to a default palette.', e);
    }
    if (!palette.length) {
        palette.push({ baseColor: [0.8, 0.8, 0.85], ior: 1.5, irFactor: 1.0, irIor: 1.3, thickness: 400.0, metallic: 1.0, roughness: 0.2 });
    }

    return { verts, idx, indexCount: idx.length, palette };
}

const createScene = async function () {
    const scene = new BABYLON.Scene(engine);
    const camera = new BABYLON.ArcRotateCamera('camera',
        -Math.PI / 180 * 30, Math.PI / 180 * 70, 42,
        BABYLON.Vector3.Zero(), scene);
    camera.setTarget(new BABYLON.Vector3(0, -4, 0));
    camera.attachControl(canvas, true);
    camera.minZ = 0.1;
    camera.maxZ = 200;

    const cubeTexture = new BABYLON.CubeTexture(
        BASE_URL + '/textures/env/papermillSpecularHDR.env', scene);
    scene.createDefaultSkybox(cubeTexture, true);
    scene.environmentTexture = cubeTexture;
    new BABYLON.HemisphericLight('light0', new BABYLON.Vector3(1, 1, 0), scene);

    await waitForReady(cubeTexture);

    const ground = BABYLON.MeshBuilder.CreateGround('ground', { width: 20, height: 20 }, scene);
    ground.position.y = -10;
    const groundMat = new BABYLON.PBRMaterial('groundMat', scene);
    groundMat.metallic = 0;
    groundMat.roughness = 0.9;
    const groundTex = new BABYLON.Texture(TEXTURE_GROUND, scene);
    groundTex.uScale = groundTex.vScale = 4;
    groundMat.albedoTexture = groundTex;
    ground.material = groundMat;

    const marbleAssets = await loadMarbleAssets();
    const palette = marbleAssets.palette;
    const PALETTE_COUNT = palette.length;

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

    const MARBLE_COUNT = 1500;
    const MARBLE_RADIUS = 0.4;

    const FLOOR_Y = -10;
    const WALL_X = 10;
    const WALL_Z = 10;

    const GRID_X = 64, GRID_Y = 64, GRID_Z = 64;
    const GRID_CELLS = GRID_X * GRID_Y * GRID_Z;
    const CELL_CAPACITY = 6;
    const CELL_SIZE = 0.6;
    const GRID_SLOTS = GRID_CELLS * (CELL_CAPACITY + 1);

    const mkBuf = (data, usage) => {
        const buf = device.createBuffer({ size: data.byteLength, usage, mappedAtCreation: true });
        new data.constructor(buf.getMappedRange()).set(data);
        buf.unmap();
        return buf;
    };

    const positionsBuffer = mkBuf(marbleAssets.verts, GPUBufferUsage.VERTEX);
    const indexBuffer = mkBuf(marbleAssets.idx, GPUBufferUsage.INDEX);

    // Per-marble state: pos(xyz + materialIndex), vel, rotation quaternion, angular velocity.
    const MARBLE_FLOATS = 16;
    const marbleData = new Float32Array(MARBLE_COUNT * MARBLE_FLOATS);
    for (let i = 0; i < MARBLE_COUNT; i++) {
        const o = i * MARBLE_FLOATS;
        marbleData[o + 0] = 0;
        marbleData[o + 1] = -1000 - i * 0.01;          // start asleep, far below
        marbleData[o + 2] = 0;
        marbleData[o + 3] = i % PALETTE_COUNT;          // material index
        marbleData[o + 8] = 0;                          // rotation quaternion (identity)
        marbleData[o + 9] = 0;
        marbleData[o + 10] = 0;
        marbleData[o + 11] = 1;
    }
    const marbleBuffer = mkBuf(marbleData, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);

    // Material palette (3 vec4 per entry): baseColor, (ior,irFactor,irIor,thickness),
    // (metallic, roughness, _, _).
    const paletteData = new Float32Array(PALETTE_COUNT * 12);
    for (let i = 0; i < PALETTE_COUNT; i++) {
        const p = palette[i];
        const o = i * 12;
        paletteData[o + 0] = p.baseColor[0];
        paletteData[o + 1] = p.baseColor[1];
        paletteData[o + 2] = p.baseColor[2];
        paletteData[o + 3] = 1;
        paletteData[o + 4] = p.ior;
        paletteData[o + 5] = p.irFactor;
        paletteData[o + 6] = p.irIor;
        paletteData[o + 7] = p.thickness;
        paletteData[o + 8] = p.metallic;
        paletteData[o + 9] = p.roughness;
    }
    const paletteBuffer = mkBuf(paletteData, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);

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

    const gridBuffer = device.createBuffer({
        size: GRID_SLOTS * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const simUbo = device.createBuffer({ size: 8 * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const camUboSize = 20 * 4;
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

    const clearGridWGSL = `
@group(0) @binding(0) var<storage, read_write> grid : array<u32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let i = gid.x;
  if (i < arrayLength(&grid)) { grid[i] = 0u; }
}
`;

    const buildGridWGSL = `
${COMMON}
struct Marble { pos:vec4<f32>, vel:vec4<f32>, rot:vec4<f32>, angVel:vec4<f32>, }
@group(0) @binding(0) var<storage, read>        marbles : array<Marble>;
@group(0) @binding(1) var<storage, read_write>  grid    : array<atomic<u32>>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let pid = gid.x;
  if (pid >= arrayLength(&marbles)) { return; }
  let c = marbles[pid];
  let cidx = cellHash(cellCoord(c.pos.xyz));
  if (cidx < 0) { return; }
  let base = u32(cidx) * (CELL_CAPACITY + 1u);
  let slot = atomicAdd(&grid[base], 1u);
  if (slot < CELL_CAPACITY) {
    atomicStore(&grid[base + 1u + slot], pid);
  }
}
`;

    // Physics: spheres in a uniform grid. Per-cell capacity caps how many contacts a
    // marble resolves, so dense piles slump and spread instead of jamming, and the
    // collision response uses a Jacobi update (accumulate, then apply) to avoid a
    // directional bias from the cell scan order. Each marble also rolls: its angular
    // velocity is driven from its horizontal motion and integrated as a quaternion.
    const physWGSL = `
${COMMON}
struct Marble { pos:vec4<f32>, vel:vec4<f32>, rot:vec4<f32>, angVel:vec4<f32>, }
struct Sim { params:vec4<f32>, bounds:vec4<f32>, }
@group(0) @binding(0) var<storage, read_write> marbles : array<Marble>;
@group(0) @binding(1) var<storage, read>       grid    : array<u32>;
@group(0) @binding(2) var<uniform>             sim     : Sim;

const MARBLE_RADIUS : f32 = ${MARBLE_RADIUS};
const RESTITUTION : f32 = 0.35;
const FLOOR_FRICTION : f32 = 0.96;
const SPAWN_RADIUS : f32 = 2.5;

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
fn quatMul(a: vec4<f32>, b: vec4<f32>) -> vec4<f32> {
  return vec4<f32>(
    a.w*b.x + a.x*b.w + a.y*b.z - a.z*b.y,
    a.w*b.y - a.x*b.z + a.y*b.w + a.z*b.x,
    a.w*b.z + a.x*b.y - a.y*b.x + a.z*b.w,
    a.w*b.w - a.x*b.x - a.y*b.y - a.z*b.z,
  );
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let pid = gid.x;
  if (pid >= arrayLength(&marbles)) { return; }
  var c = marbles[pid];

  let dt = clamp(sim.params.x, 1.0 / 120.0, 1.0 / 30.0);
  let time = sim.params.y;
  let spawnDuration = sim.params.z;
  let spawnTime = f32(pid) / f32(${MARBLE_COUNT}u) * spawnDuration;
  let isAsleep = c.pos.y < -50.0;

  if (isAsleep) {
    if (time >= spawnTime) {
      // Uniform disk so marbles fall radially symmetric; per-marble and time-varied salt
      // so a recycled marble reappears at a fresh point in the column.
      let salt = pid * 2654435761u + u32(time * 60.0) * 40503u;
      let ang = rnd(salt) * 6.28318530718;
      let radv = sqrt(rnd(salt ^ 0x68bc21ebu)) * SPAWN_RADIUS;
      c.pos = vec4<f32>(cos(ang) * radv, 40.0, sin(ang) * radv, c.pos.w);
      c.vel = vec4<f32>(0.0, -1.0, 0.0, 0.0);
      c.rot = vec4<f32>(0.0, 0.0, 0.0, 1.0);
      c.angVel = vec4<f32>(0.0, 0.0, 0.0, 0.0);
    }
    marbles[pid] = c;
    return;
  }

  c.vel.y = c.vel.y - 9.81 * dt;

  // Collision response: accumulate corrections and apply after the loop (Jacobi),
  // so the push-out does not inherit a bias from the cell scan order.
  var posCorr = vec3<f32>(0.0, 0.0, 0.0);
  var velCorr = vec3<f32>(0.0, 0.0, 0.0);
  var collided = false;
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
          let q = marbles[other];
          let diff = q.pos.xyz - c.pos.xyz;   // c -> q
          let d = length(diff);
          let minD = MARBLE_RADIUS * 2.0;
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
            collided = true;
          }
        }
      }
    }
  }
  c.pos = vec4<f32>(c.pos.xyz + posCorr, c.pos.w);
  c.vel = vec4<f32>(c.vel.xyz + velCorr, c.vel.w);

  var onFloor = false;
  let onFloorArea = abs(c.pos.x) < sim.bounds.y && abs(c.pos.z) < sim.bounds.z;
  if (onFloorArea && c.pos.y - MARBLE_RADIUS < sim.bounds.x) {
    c.pos.y = sim.bounds.x + MARBLE_RADIUS;
    if (c.vel.y < 0.0) { c.vel.y = -c.vel.y * RESTITUTION; }
    c.vel.x = c.vel.x * FLOOR_FRICTION;
    c.vel.z = c.vel.z * FLOOR_FRICTION;
    onFloor = true;
  }

  let speed = length(c.vel.xyz);
  if (speed > 25.0) { c.vel = vec4<f32>(c.vel.xyz * (25.0 / speed), c.vel.w); }

  c.pos = vec4<f32>(c.pos.xyz + c.vel.xyz * dt, c.pos.w);

  // Rolling: drive angular velocity from horizontal motion (omega = (-vz, 0, vx)/r),
  // blending harder while in contact, then integrate the rotation quaternion.
  let inContact = onFloor || collided;
  let rollTarget = vec3<f32>(-c.vel.z, 0.0, c.vel.x) / MARBLE_RADIUS;
  let blend = select(0.04, 0.35, inContact);
  var w = mix(c.angVel.xyz, rollTarget, blend) * 0.995;
  c.angVel = vec4<f32>(w, 0.0);
  let wl = length(w);
  if (wl > 1e-5) {
    let axis = w / wl;
    let half = wl * dt * 0.5;
    let dq = vec4<f32>(axis * sin(half), cos(half));
    c.rot = normalize(quatMul(dq, c.rot));
  }

  if (c.pos.y < sim.bounds.x - 30.0) {
    // Back to sleep; x/z are overwritten by the next frame's respawn.
    c.pos = vec4<f32>(0.0, -1000.0 - f32(pid) * 0.01, 0.0, c.pos.w);
    c.vel = vec4<f32>(0.0, 0.0, 0.0, 0.0);
    c.angVel = vec4<f32>(0.0, 0.0, 0.0, 0.0);
  }

  marbles[pid] = c;
}
`;

    // Render: an iridescent metallic surface (KHR_materials_iridescence thin-film model),
    // lit by a single key light plus image-based diffuse + specular from Babylon's env map.
    const renderWGSL = `
struct Marble { pos:vec4<f32>, vel:vec4<f32>, rot:vec4<f32>, angVel:vec4<f32>, }
struct Camera { viewProj:mat4x4<f32>, camPos:vec4<f32>, }
struct Mat { baseColor:vec4<f32>, p0:vec4<f32>, p1:vec4<f32>, }
@group(0) @binding(0) var<storage, read> marbles : array<Marble>;
@group(0) @binding(1) var<uniform>       cam     : Camera;
@group(0) @binding(2) var<storage, read> palette : array<Mat>;
@group(0) @binding(3) var                envMap  : texture_cube<f32>;
@group(0) @binding(4) var                envSampler : sampler;

override MAX_MIP : f32 = 8.0;
const MARBLE_RADIUS : f32 = ${MARBLE_RADIUS};
const M_PI : f32 = 3.14159265359;

struct VSIn {
  @location(0) position : vec3<f32>,
  @location(1) normal   : vec3<f32>,
  @location(2) uv       : vec2<f32>,
  @builtin(instance_index) iid : u32,
}
struct VSOut {
  @builtin(position) pos : vec4<f32>,
  @location(0) worldPos : vec3<f32>,
  @location(1) worldNormal : vec3<f32>,
  @location(2) @interpolate(flat) matIndex : u32,
}
fn rotByQuat(v : vec3<f32>, q : vec4<f32>) -> vec3<f32> {
  let t = 2.0 * cross(q.xyz, v);
  return v + q.w * t + cross(q.xyz, t);
}
@vertex
fn vs(input : VSIn) -> VSOut {
  let c = marbles[input.iid];
  let world = rotByQuat(input.position * MARBLE_RADIUS, c.rot) + c.pos.xyz;
  let worldN = rotByQuat(input.normal, c.rot);
  var out : VSOut;
  let clipPos = cam.viewProj * vec4<f32>(world, 1.0);
  out.pos = vec4<f32>(clipPos.x, -clipPos.y, clipPos.z, clipPos.w);
  out.worldPos = world;
  out.worldNormal = worldN;
  out.matIndex = u32(c.pos.w + 0.5);
  return out;
}

fn sq(x: f32) -> f32 { return x * x; }
fn sq3(x: vec3<f32>) -> vec3<f32> { return x * x; }
fn saturate(x: f32) -> f32 { return clamp(x, 0.0, 1.0); }
fn fresnelSchlick(f0: vec3<f32>, cosTheta: f32) -> vec3<f32> {
  let c = saturate(cosTheta);
  return f0 + (vec3<f32>(1.0) - f0) * pow(1.0 - c, 5.0);
}
fn iorToFresnel0(transmittedIor: f32, incidentIor: f32) -> f32 {
  return sq((transmittedIor - incidentIor) / (transmittedIor + incidentIor));
}
fn fresnel0ToIor(fresnel0: vec3<f32>) -> vec3<f32> {
  let sqrtF0 = sqrt(fresnel0);
  return (vec3<f32>(1.0) + sqrtF0) / (vec3<f32>(1.0) - sqrtF0);
}
fn evalSensitivity(opd: f32, shift: vec3<f32>) -> vec3<f32> {
  let XYZ_TO_REC709 = mat3x3<f32>(
     3.2404542, -0.9692660,  0.0556434,
    -1.5371385,  1.8760108, -0.2040259,
    -0.4985314,  0.0415560,  1.0572252
  );
  let phase = 2.0 * M_PI * opd * 1.0e-9;
  let val = vec3<f32>(5.4856e-13, 4.4201e-13, 5.2481e-13);
  let pos = vec3<f32>(1.6810e+06, 1.7953e+06, 2.2084e+06);
  let varv = vec3<f32>(4.3278e+09, 9.3046e+09, 6.6121e+09);
  var xyz = val * sqrt(2.0 * M_PI * varv) * cos(pos * phase + shift) * exp(-sq(phase) * varv);
  xyz.x += 9.7470e-14 * sqrt(2.0 * M_PI * 4.5282e+09) * cos(2.2399e+06 * phase + shift.x) * exp(-4.5282e+09 * sq(phase));
  xyz = xyz / vec3<f32>(1.0685e-7);
  return XYZ_TO_REC709 * xyz;
}
fn evalIridescence(outsideIor: f32, eta2: f32, cosTheta1: f32, thinFilmThickness: f32, baseF0: vec3<f32>) -> vec3<f32> {
  let iridescenceIor = mix(outsideIor, eta2, smoothstep(0.0, 0.03, thinFilmThickness));
  let sinTheta2Sq = sq(outsideIor / iridescenceIor) * (1.0 - sq(cosTheta1));
  let cosTheta2Sq = 1.0 - sinTheta2Sq;
  if (cosTheta2Sq < 0.0) {
    return vec3<f32>(1.0);
  }
  let cosTheta2 = sqrt(cosTheta2Sq);
  let r0 = iorToFresnel0(iridescenceIor, outsideIor);
  let r12 = r0 + (1.0 - r0) * pow(1.0 - cosTheta1, 5.0);
  let t121 = 1.0 - r12;
  var phi12 = 0.0;
  if (iridescenceIor < outsideIor) { phi12 = M_PI; }
  let phi21 = M_PI - phi12;
  let baseIOR = fresnel0ToIor(clamp(baseF0, vec3<f32>(0.0), vec3<f32>(0.9999)));
  let r1 = sq3((baseIOR - vec3<f32>(iridescenceIor)) / (baseIOR + vec3<f32>(iridescenceIor)));
  let r23 = fresnelSchlick(r1, cosTheta2);
  var phi23 = vec3<f32>(0.0);
  if (baseIOR.x < iridescenceIor) { phi23.x = M_PI; }
  if (baseIOR.y < iridescenceIor) { phi23.y = M_PI; }
  if (baseIOR.z < iridescenceIor) { phi23.z = M_PI; }
  let opd = 2.0 * iridescenceIor * thinFilmThickness * cosTheta2;
  let phi = vec3<f32>(phi21) + phi23;
  let r123 = clamp(vec3<f32>(r12) * r23, vec3<f32>(1e-5), vec3<f32>(0.9999));
  let rr123 = sqrt(r123);
  let rs = sq3(vec3<f32>(t121)) * r23 / (vec3<f32>(1.0) - r123);
  let c0 = vec3<f32>(r12) + rs;
  var i = c0;
  var cm = rs - vec3<f32>(t121);
  for (var m: i32 = 1; m <= 2; m = m + 1) {
    cm = cm * rr123;
    let sm = 2.0 * evalSensitivity(f32(m) * opd, f32(m) * phi);
    i = i + cm * sm;
  }
  return max(i, vec3<f32>(0.0));
}
fn sampleEnv(dir: vec3<f32>, mip: f32) -> vec3<f32> {
  let d = vec3<f32>(-dir.x, dir.y, dir.z);
  return textureSampleLevel(envMap, envSampler, d, mip).rgb;
}

@fragment
fn fs(in : VSOut) -> @location(0) vec4<f32> {
  let N = normalize(in.worldNormal);
  let V = normalize(cam.camPos.xyz - in.worldPos);
  let L = normalize(vec3<f32>(0.6, 1.0, 0.5));
  let H = normalize(L + V);
  let ndotv = max(dot(N, V), 0.0);
  let ndotl = max(dot(N, L), 0.0);
  let ndoth = max(dot(N, H), 0.0);

  let m = palette[in.matIndex];
  let baseColor = m.baseColor.rgb;
  let ior = max(m.p0.x, 1.0);
  let irFactor = m.p0.y;
  let irIor = m.p0.z;
  let thickness = m.p0.w;
  let metallic = clamp(m.p1.x, 0.0, 1.0);
  let roughness = clamp(m.p1.y, 0.04, 1.0);

  let f0s = sq((ior - 1.0) / (ior + 1.0));
  let baseF0 = mix(vec3<f32>(f0s), baseColor, metallic);
  let fres = fresnelSchlick(baseF0, ndotv);
  let irF = evalIridescence(1.0, irIor, ndotv, thickness, baseF0);
  let specColor = mix(fres, irF, clamp(irFactor * 1.25, 0.0, 1.0));

  let shininess = mix(256.0, 8.0, roughness * roughness);
  let specLobe = pow(max(ndoth, 0.0), shininess);
  let kd = (1.0 - metallic) * (1.0 - max(max(specColor.r, specColor.g), specColor.b));
  let directDiffuse = baseColor * (0.15 + 0.85 * ndotl) * kd;
  let directSpec = specColor * specLobe * mix(0.3, 1.1, metallic);
  let rimSpec = specColor * pow(1.0 - ndotv, 2.0) * 0.35;

  var color = directDiffuse + directSpec + rimSpec;
  let R = normalize(reflect(-V, N));
  let blurredR = normalize(mix(R, N, roughness * roughness));
  let envDiffuse = sampleEnv(N, MAX_MIP);
  let envSpec = sampleEnv(blurredR, roughness * MAX_MIP);
  color = color + baseColor * envDiffuse * ((0.10 + 0.25 * (1.0 - roughness)) * kd);
  color = color + specColor * envSpec * (0.55 + 0.65 * metallic);

  color = color / (color + vec3<f32>(1.0));
  color = pow(color, vec3<f32>(1.0 / 2.2));
  return vec4<f32>(color, 1.0);
}
`;

    // Wireframe of the spherical collider (radius = MARBLE_RADIUS), drawn as line lists.
    const wireWGSL = `
struct Marble { pos:vec4<f32>, vel:vec4<f32>, rot:vec4<f32>, angVel:vec4<f32>, }
struct Camera { viewProj:mat4x4<f32>, camPos:vec4<f32>, }
@group(0) @binding(0) var<storage, read> marbles : array<Marble>;
@group(0) @binding(1) var<uniform>       cam     : Camera;
const MARBLE_RADIUS : f32 = ${MARBLE_RADIUS};
@vertex
fn vs(@location(0) position : vec3<f32>, @builtin(instance_index) iid : u32) -> @builtin(position) vec4<f32> {
  let c = marbles[iid];
  let world = position * MARBLE_RADIUS + c.pos.xyz;
  let clip = cam.viewProj * vec4<f32>(world, 1.0);
  return vec4<f32>(clip.x, -clip.y, clip.z, clip.w);
}
@fragment
fn fs() -> @location(0) vec4<f32> { return vec4<f32>(1.0, 0.85, 0.1, 1.0); }
`;

    const clearGridModule = device.createShaderModule({ code: clearGridWGSL });
    const buildGridModule = device.createShaderModule({ code: buildGridWGSL });
    const physModule = device.createShaderModule({ code: physWGSL });
    const renderModule = device.createShaderModule({ code: renderWGSL });
    const wireModule = device.createShaderModule({ code: wireWGSL });

    const clearGridPipeline = device.createComputePipeline({ layout: 'auto', compute: { module: clearGridModule, entryPoint: 'main' } });
    const buildGridPipeline = device.createComputePipeline({ layout: 'auto', compute: { module: buildGridModule, entryPoint: 'main' } });
    const physPipeline = device.createComputePipeline({ layout: 'auto', compute: { module: physModule, entryPoint: 'main' } });

    const rttSize = { width: engine.getRenderWidth(), height: engine.getRenderHeight() };
    const marbleRtt = new BABYLON.RenderTargetTexture('marbleRTT', rttSize, scene, {
        generateMipMaps: false,
        type: BABYLON.Constants.TEXTURETYPE_UNSIGNED_BYTE,
        format: BABYLON.Constants.TEXTUREFORMAT_RGBA,
    });
    const marbleLayer = new BABYLON.Layer('marbleLayer', null, scene, false);
    marbleLayer.texture = marbleRtt;
    marbleLayer.alphaBlendingMode = BABYLON.Engine.ALPHA_COMBINE;

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
                arrayStride: 32,
                attributes: [
                    { shaderLocation: 0, offset: 0, format: 'float32x3' },
                    { shaderLocation: 1, offset: 12, format: 'float32x3' },
                    { shaderLocation: 2, offset: 24, format: 'float32x2' },
                ],
            }],
        },
        fragment: {
            module: renderModule, entryPoint: 'fs',
            constants: { MAX_MIP: envMaxMip },
            targets: [{ format: 'rgba8unorm' }],
        },
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

    const clearGridBindGroup = device.createBindGroup({
        layout: clearGridPipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: gridBuffer } }],
    });
    const buildGridBindGroup = device.createBindGroup({
        layout: buildGridPipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: marbleBuffer } },
            { binding: 1, resource: { buffer: gridBuffer } },
        ],
    });
    const physBindGroup = device.createBindGroup({
        layout: physPipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: marbleBuffer } },
            { binding: 1, resource: { buffer: gridBuffer } },
            { binding: 2, resource: { buffer: simUbo } },
        ],
    });

    const envView = envGpuTex.createView({ dimension: 'cube' });
    const renderBindGroup = device.createBindGroup({
        layout: renderPipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: marbleBuffer } },
            { binding: 1, resource: { buffer: camUbo } },
            { binding: 2, resource: { buffer: paletteBuffer } },
            { binding: 3, resource: envView },
            { binding: 4, resource: envSampler },
        ],
    });
    const wireBindGroup = device.createBindGroup({
        layout: wirePipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: marbleBuffer } },
            { binding: 1, resource: { buffer: camUbo } },
        ],
    });

    const hint = document.getElementById('hint');
    let frameCount = 0, lastFpsT = performance.now(), fps = 0;
    const startTime = performance.now();
    const SPAWN_DURATION = MARBLE_COUNT / 400;

    scene.onBeforeRenderObservable.add(() => {
        const internalTex = marbleRtt.getInternalTexture();
        if (!internalTex || !internalTex._hardwareTexture) return;
        const gpuTex = internalTex._hardwareTexture.underlyingResource;
        if (!gpuTex) return;

        const view = camera.getViewMatrix();
        const proj = camera.getProjectionMatrix();
        const viewProj = view.multiply(proj);
        const camPos = camera.position;
        const camData = new Float32Array(camUboSize / 4);
        camData.set(viewProj.toArray(), 0);
        camData[16] = camPos.x; camData[17] = camPos.y; camData[18] = camPos.z; camData[19] = 0;
        device.queue.writeBuffer(camUbo, 0, camData);

        const dt = Math.min(engine.getDeltaTime() / 1000, 1 / 30);
        const time = (performance.now() - startTime) / 1000;
        const simData = new Float32Array(8);
        simData[0] = dt;
        simData[1] = time;
        simData[2] = SPAWN_DURATION;
        simData[3] = 0;
        simData[4] = FLOOR_Y; simData[5] = WALL_X; simData[6] = WALL_Z; simData[7] = 0;
        device.queue.writeBuffer(simUbo, 0, simData);

        const ce = device.createCommandEncoder();
        const wg = Math.ceil(MARBLE_COUNT / 64);

        {
            const cp = ce.beginComputePass();
            cp.setPipeline(clearGridPipeline);
            cp.setBindGroup(0, clearGridBindGroup);
            cp.dispatchWorkgroups(Math.ceil(GRID_SLOTS / 64));
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
            pass.setBindGroup(0, renderBindGroup);
            pass.drawIndexed(marbleAssets.indexCount, MARBLE_COUNT);
            if (showWireframe) {
                pass.setPipeline(wirePipeline);
                pass.setBindGroup(0, wireBindGroup);
                pass.setVertexBuffer(0, wireBuffer);
                pass.draw(wireVertCount, MARBLE_COUNT);
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
