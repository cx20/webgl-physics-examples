'use strict';

// Babylon.js (WebGPUEngine) renders the coins with its native PBR materials and
// hardware instancing, while the falling-coin physics runs entirely on the GPU in
// a WGSL compute shader (a sphere-based streaming "waterfall", ported from the raw
// WebGPU example in ../../../webgpu/wgsl_compute/coins).
//
// Data flow, fully GPU-resident (no per-frame readback):
//   stateA/stateB  : ping-pong physics state, stepped by the compute shader
//   matrixBuffer   : per-coin world matrix written by a second compute pass and
//                    bound directly as the instanced world0..world3 attributes
//                    of the coin meshes, so Babylon's PBR material draws them.

const BASE_URL = 'https://cx20.github.io/gltf-test';
const TEXTURE_FLOOR = '../../../../assets/textures/floor_bump.png';
const TEXTURE_ROCK = '../../../../assets/textures/rockn.png';

const MAX_COINS = 4096;
const SUBSTEPS = 4;
const GROUND_Y = -10.0;

// Physics tuning (kept in sync with the raw WebGPU example).
const GRAVITY = 9.81;
const DAMPING = 0.9992;
const ANG_DAMPING = 0.992;
const RESTITUTION = 0.2;
const FRICTION = 0.98;

// Three coin types. radius is the physics sphere radius (= visual diameter / 2);
// the mesh keeps its real per-type geometry, so the world matrix is translate*rotate
// only (no scale baked in, which keeps normals undistorted).
const COIN_TYPES = [
    { name: 'GOLD', color: [1.000, 0.766, 0.336], texture: TEXTURE_FLOOR, metallic: 1.0, roughness: 0.2, diameter: 1.0, height: 0.1 },
    { name: 'SILVER', color: [0.972, 0.960, 0.915], texture: TEXTURE_ROCK, metallic: 1.0, roughness: 0.4, diameter: 0.8, height: 0.075 },
    { name: 'COPPER', color: [0.955, 0.637, 0.538], texture: TEXTURE_ROCK, metallic: 1.0, roughness: 0.2, diameter: 0.6, height: 0.05 },
];

// State layout (floats per coin): position(xyz + seed), velocity, rotation(quat), angularVel.
const STATE_FLOATS = 16;
const INFO_FLOATS = 4;      // size.x = physics radius, size.y = shuffled spawn order
const MATRIX_FLOATS = 16;   // 4x4 world matrix (column-major)

// ----------------------------------------------------------------------------
// WGSL compute shaders
// ----------------------------------------------------------------------------

// Sphere-based streaming-waterfall physics. Coins start asleep below the floor and
// stream in over time through a narrow central column; coins that spill off the
// finite floor sleep and re-stream, so the pile stays at a steady height.
const PHYSICS_WGSL = /* wgsl */`
struct SimParams { p0 : vec4<f32>, p1 : vec4<f32>, }
struct Coin { position:vec4<f32>, velocity:vec4<f32>, rotation:vec4<f32>, angularVel:vec4<f32>, }
struct Info { size : vec4<f32>, }   // size.x = physics radius, size.y = shuffled spawn order

@group(0) @binding(0) var<uniform> params : SimParams;
@group(0) @binding(1) var<storage, read> srcStates : array<Coin>;
@group(0) @binding(2) var<storage, read_write> dstStates : array<Coin>;
@group(0) @binding(3) var<storage, read> infos : array<Info>;

const GROUND_HALF : f32 = 13.0;
const SPAWN_RADIUS : f32 = 3.0;     // radius of the narrow spawn column at the top
const SPAWN_RATE : f32 = 350.0;     // coins per second streamed into the column

fn quatMul(a:vec4<f32>, b:vec4<f32>) -> vec4<f32> {
  return vec4<f32>(
    a.w*b.x + a.x*b.w + a.y*b.z - a.z*b.y,
    a.w*b.y - a.x*b.z + a.y*b.w + a.z*b.x,
    a.w*b.z + a.x*b.y - a.y*b.x + a.z*b.w,
    a.w*b.w - a.x*b.x - a.y*b.y - a.z*b.z);
}
fn normalizeQ(q:vec4<f32>) -> vec4<f32> {
  let l = length(q);
  return select(vec4<f32>(0.0,0.0,0.0,1.0), q/l, l > 0.0001);
}
// PCG hash: a statistically strong hash so the streamed spawn positions are not biased.
fn pcgHash(v:u32) -> u32 {
  let state = v*747796405u + 2891336453u;
  let word = ((state >> ((state >> 28u)+4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}
fn rndU(seed:u32) -> f32 { return f32(pcgHash(seed)) * (1.0/4294967296.0); }

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id:vec3<u32>) {
  let i = id.x;
  let count = arrayLength(&srcStates);
  if (i >= count) { return; }

  let dt = params.p0.x;
  let gravity = params.p0.y;
  let groundY = params.p0.z;
  let time = params.p0.w;
  let damping = params.p1.x;
  let angDamping = params.p1.y;
  let restitution = params.p1.z;
  let friction = params.p1.w;

  let radius = infos[i].size.x;
  let seed = srcStates[i].position.w;

  var pos = srcStates[i].position.xyz;
  var vel = srcStates[i].velocity.xyz;
  var rot = srcStates[i].rotation;
  var angVel = srcStates[i].angularVel.xyz;

  let sleepY = groundY - 30.0;
  let spawnY = groundY + 50.0;
  // Spawn order is a shuffled slot (stored per coin), so the three contiguous coin-type
  // blocks stream in mixed together instead of one whole type after another.
  let spawnTime = infos[i].size.y / SPAWN_RATE;

  // Asleep coins wait below the floor and stream in over time (a few per frame).
  if (pos.y < sleepY) {
    if (time >= spawnTime) {
      let salt = i*2654435761u + u32(time*60.0)*40503u;
      let ang = rndU(salt) * 6.28318530718;
      let rad = sqrt(rndU(salt+1u)) * SPAWN_RADIUS;
      pos = vec3<f32>(cos(ang)*rad, spawnY, sin(ang)*rad);
      vel = vec3<f32>(0.0, -1.0, 0.0);
      angVel = vec3<f32>((rndU(salt+3u)-0.5)*6.0, (rndU(salt+4u)-0.5)*2.0, (rndU(salt+5u)-0.5)*6.0);
      rot = vec4<f32>(0.0, 0.0, 0.0, 1.0);
    }
    dstStates[i].position = vec4<f32>(pos, seed);
    dstStates[i].velocity = vec4<f32>(vel, 0.0);
    dstStates[i].rotation = rot;
    dstStates[i].angularVel = vec4<f32>(angVel, 0.0);
    return;
  }

  vel.y = vel.y - gravity*dt;
  pos = pos + vel*dt;

  // Visual tumble (integrated independently; sphere collisions carry no torque).
  let hw = angVel*0.5*dt;
  let dq = quatMul(vec4<f32>(hw, 0.0), rot);
  rot = normalizeQ(rot + dq);

  // Sphere vs ground plane.
  if (pos.y - radius < groundY && abs(pos.x) < GROUND_HALF && abs(pos.z) < GROUND_HALF) {
    pos.y = groundY + radius;
    if (vel.y < 0.0) { vel.y = -vel.y*restitution; vel.x = vel.x*friction; vel.z = vel.z*friction; }
  }

  // Sphere vs sphere against every other (awake) coin.
  for (var j:u32 = 0u; j < count; j = j+1u) {
    if (j == i) { continue; }
    let other = srcStates[j];
    if (other.position.y < sleepY) { continue; }
    let otherRadius = infos[j].size.x;
    let delta = pos - other.position.xyz;
    let dist = length(delta);
    let minDist = radius + otherRadius;
    if (dist < minDist && dist > 1e-4) {
      let n = delta / dist;
      let overlap = minDist - dist;
      pos = pos + n*(overlap*0.5);
      let relVel = vel - other.velocity.xyz;
      let vn = dot(relVel, n);
      if (vn < 0.0) { vel = vel - n*(vn*(1.0+restitution)*0.5); }
    }
  }

  vel = vel*damping;
  angVel = angVel*angDamping;

  // Recycle: a coin that fell past the floor goes back to sleep and re-streams.
  if (pos.y < sleepY) {
    pos = vec3<f32>(0.0, -1000.0 - f32(i)*0.01, 0.0);
    vel = vec3<f32>(0.0, 0.0, 0.0);
  }

  dstStates[i].position = vec4<f32>(pos, seed);
  dstStates[i].velocity = vec4<f32>(vel, 0.0);
  dstStates[i].rotation = rot;
  dstStates[i].angularVel = vec4<f32>(angVel, 0.0);
}
`;

// Builds a column-major translate*rotate world matrix per coin from the final state,
// written into a buffer that is bound as the meshes' instanced world0..world3 attributes.
const MATRIX_WGSL = /* wgsl */`
struct Coin { position:vec4<f32>, velocity:vec4<f32>, rotation:vec4<f32>, angularVel:vec4<f32>, }
@group(0) @binding(0) var<storage, read> states : array<Coin>;
@group(0) @binding(1) var<storage, read_write> matrices : array<mat4x4<f32>>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id:vec3<u32>) {
  let i = id.x;
  if (i >= arrayLength(&states)) { return; }
  let p = states[i].position.xyz;
  let q = states[i].rotation;
  let x = q.x; let y = q.y; let z = q.z; let w = q.w;
  // Columns of the rotation matrix (column-major, matching Babylon's Matrix layout).
  let col0 = vec4<f32>(1.0-2.0*(y*y+z*z), 2.0*(x*y+w*z),     2.0*(x*z-w*y),     0.0);
  let col1 = vec4<f32>(2.0*(x*y-w*z),     1.0-2.0*(x*x+z*z), 2.0*(y*z+w*x),     0.0);
  let col2 = vec4<f32>(2.0*(x*z+w*y),     2.0*(y*z-w*x),     1.0-2.0*(x*x+y*y), 0.0);
  let col3 = vec4<f32>(p.x, p.y, p.z, 1.0);
  matrices[i] = mat4x4<f32>(col0, col1, col2, col3);
}
`;

// ----------------------------------------------------------------------------
// Scene / GPU setup
// ----------------------------------------------------------------------------

// Coins are partitioned into three contiguous blocks (one per type) so each type's
// mesh can instance its slice of the shared matrix buffer.
function typeBlocks(count) {
    const per = Math.floor(count / COIN_TYPES.length);
    return [
        { start: 0, count: per },
        { start: per, count: per },
        { start: 2 * per, count: count - 2 * per },
    ];
}

function buildInitialState(count, blocks) {
    const states = new Float32Array(count * STATE_FLOATS);
    const infos = new Float32Array(count * INFO_FLOATS);

    // A shuffled spawn order decouples the streaming sequence from the type blocks,
    // so gold/silver/copper fall mixed together rather than in three separate clumps.
    const order = new Int32Array(count);
    for (let i = 0; i < count; i++) order[i] = i;
    for (let i = count - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = order[i]; order[i] = order[j]; order[j] = tmp;
    }

    for (let t = 0; t < COIN_TYPES.length; t++) {
        const type = COIN_TYPES[t];
        const radius = type.diameter * 0.5;
        const block = blocks[t];
        for (let k = 0; k < block.count; k++) {
            const i = block.start + k;
            const sb = i * STATE_FLOATS;
            // Start asleep far below the floor; the compute shader streams coins in.
            states[sb + 1] = -1000 - i * 0.01;   // position.y
            states[sb + 11] = 1;                 // rotation = identity quaternion
            const ib = i * INFO_FLOATS;
            infos[ib + 0] = radius;              // physics sphere radius
            infos[ib + 1] = order[i];            // shuffled spawn order (slot index)
        }
    }
    return { states, infos };
}

// Seed the matrix buffer so the first few frames (before the compute runs) keep coins
// off-screen rather than at a garbage transform.
function buildInitialMatrices(count) {
    const m = new Float32Array(count * MATRIX_FLOATS);
    for (let i = 0; i < count; i++) {
        const o = i * MATRIX_FLOATS;
        m[o + 0] = 1; m[o + 5] = 1; m[o + 10] = 1; m[o + 15] = 1; // identity
        m[o + 13] = -2000;                                        // translate well below
    }
    return m;
}

function makeCoinMesh(type, scene) {
    const mat = new BABYLON.PBRMaterial('material_' + type.name, scene);
    mat.metallic = type.metallic;
    mat.roughness = type.roughness;
    mat.forceIrradianceInFragment = true;
    mat.albedoColor = new BABYLON.Color3(type.color[0], type.color[1], type.color[2]);
    mat.bumpTexture = new BABYLON.Texture(type.texture, scene);

    const faceUV = [
        new BABYLON.Vector4(0, 0, 1.00, 1),
        new BABYLON.Vector4(1, 0, 0.32, 1),
        new BABYLON.Vector4(0, 0, 1.00, 1),
    ];
    const mesh = BABYLON.MeshBuilder.CreateCylinder('coin_' + type.name, {
        height: type.height,
        diameter: type.diameter,
        tessellation: 32,
        faceUV: faceUV,
    }, scene);
    mesh.material = mat;
    mesh.isPickable = false;
    // The instances live anywhere in the scene, so never frustum-cull the base mesh.
    mesh.alwaysSelectAsActiveMesh = true;
    return mesh;
}

// Wireframe sphere matching the physics collision shape (radius = coin diameter / 2).
function makeWireSphere(type, scene) {
    const mat = new BABYLON.StandardMaterial('wire_' + type.name, scene);
    mat.wireframe = true;
    mat.disableLighting = true;
    mat.emissiveColor = new BABYLON.Color3(0.1, 1.0, 0.35);
    const mesh = BABYLON.MeshBuilder.CreateSphere('wire_' + type.name, {
        diameter: type.diameter,   // physics sphere diameter = 2 * radius
        segments: 8,
    }, scene);
    mesh.material = mat;
    mesh.isPickable = false;
    mesh.alwaysSelectAsActiveMesh = true;
    return mesh;
}

// Bind a type block of the shared matrix buffer as this mesh's instanced world0..world3.
function bindInstanceMatrices(engine, mesh, matrixBuffer, block) {
    const dataBuffer = matrixBuffer.getBuffer();
    const FLOAT = BABYLON.VertexBuffer.FLOAT;
    const strideBytes = MATRIX_FLOATS * 4;            // 64 bytes per matrix
    const baseByte = block.start * strideBytes;
    const kinds = ['world0', 'world1', 'world2', 'world3'];
    for (let r = 0; r < 4; r++) {
        const vb = new BABYLON.VertexBuffer(
            engine, dataBuffer, kinds[r],
            false,              // updatable
            false,              // postponeInternalCreation
            strideBytes,        // stride (bytes, useBytes=true below)
            true,               // instanced
            baseByte + r * 16,  // byte offset of this matrix column
            4,                  // size (vec4)
            FLOAT,              // type
            false,              // normalized
            true                // useBytes
        );
        mesh.setVerticesBuffer(vb, false);
    }
    mesh.forcedInstanceCount = block.count;
}

const createScene = async function (engine, canvas) {
    const scene = new BABYLON.Scene(engine);

    const camera = new BABYLON.ArcRotateCamera('camera',
        -Math.PI / 180 * 30, Math.PI / 180 * 76, 50,
        new BABYLON.Vector3(0, -8, 0), scene);
    camera.minZ = 0.1;
    camera.maxZ = 200;
    camera.wheelPrecision = 5;
    camera.attachControl(canvas, true);

    const cubeTexture = new BABYLON.CubeTexture(BASE_URL + '/textures/env/papermillSpecularHDR.env', scene);
    scene.environmentTexture = cubeTexture;
    scene.createDefaultSkybox(cubeTexture, true);
    new BABYLON.HemisphericLight('light0', new BABYLON.Vector3(1, 1, 0), scene);

    const ground = BABYLON.MeshBuilder.CreateGround('ground', { width: 26, height: 26 }, scene);
    ground.position.y = GROUND_Y;
    const groundMat = new BABYLON.PBRMaterial('groundMat', scene);
    groundMat.metallic = 0;
    groundMat.roughness = 0.8;
    groundMat.albedoColor = new BABYLON.Color3(0.4, 0.4, 0.4);
    ground.material = groundMat;

    const blocks = typeBlocks(MAX_COINS);
    const { states, infos } = buildInitialState(MAX_COINS, blocks);

    // GPU buffers.
    const stateA = new BABYLON.StorageBuffer(engine, states.byteLength);
    const stateB = new BABYLON.StorageBuffer(engine, states.byteLength);
    stateA.update(states);
    stateB.update(states);

    const infoBuffer = new BABYLON.StorageBuffer(engine, infos.byteLength);
    infoBuffer.update(infos);

    const matrixBuffer = new BABYLON.StorageBuffer(engine, MAX_COINS * MATRIX_FLOATS * 4,
        BABYLON.Constants.BUFFER_CREATIONFLAG_VERTEX | BABYLON.Constants.BUFFER_CREATIONFLAG_READWRITE);
    matrixBuffer.update(buildInitialMatrices(MAX_COINS));

    const paramsUB = new BABYLON.UniformBuffer(engine);
    paramsUB.addUniform('p0', 4);
    paramsUB.addUniform('p1', 4);

    // Two physics compute shaders for ping-pong (A->B and B->A).
    const physMapping = {
        bindingsMapping: {
            params: { group: 0, binding: 0 },
            srcStates: { group: 0, binding: 1 },
            dstStates: { group: 0, binding: 2 },
            infos: { group: 0, binding: 3 },
        },
    };
    const makePhys = (name, src, dst) => {
        const cs = new BABYLON.ComputeShader(name, engine, { computeSource: PHYSICS_WGSL }, physMapping);
        cs.setUniformBuffer('params', paramsUB);
        cs.setStorageBuffer('srcStates', src);
        cs.setStorageBuffer('dstStates', dst);
        cs.setStorageBuffer('infos', infoBuffer);
        return cs;
    };
    const phys = [makePhys('physAB', stateA, stateB), makePhys('physBA', stateB, stateA)];

    // Two matrix-build compute shaders, one per possible "current" state buffer.
    const matMapping = {
        bindingsMapping: {
            states: { group: 0, binding: 0 },
            matrices: { group: 0, binding: 1 },
        },
    };
    const makeMat = (name, src) => {
        const cs = new BABYLON.ComputeShader(name, engine, { computeSource: MATRIX_WGSL }, matMapping);
        cs.setStorageBuffer('states', src);
        cs.setStorageBuffer('matrices', matrixBuffer);
        return cs;
    };
    const buildMat = [makeMat('matA', stateA), makeMat('matB', stateB)];

    // Coin meshes (one per type) plus a matching wireframe collider sphere, each
    // instancing its block of the shared matrix buffer.
    const wireMeshes = [];
    COIN_TYPES.forEach((type, t) => {
        const mesh = makeCoinMesh(type, scene);
        bindInstanceMatrices(engine, mesh, matrixBuffer, blocks[t]);
        const wire = makeWireSphere(type, scene);
        bindInstanceMatrices(engine, wire, matrixBuffer, blocks[t]);
        wireMeshes.push(wire);
    });

    // Toggle the collider wireframe with the W key (matching the other examples).
    let showWireframe = true;
    const hint = document.getElementById('hint');
    if (hint) hint.textContent = 'W: wireframe ON';
    window.addEventListener('keydown', (event) => {
        const isW = event.code === 'KeyW' || event.key === 'w' || event.key === 'W';
        if (!isW || event.repeat) return;
        showWireframe = !showWireframe;
        wireMeshes.forEach((m) => m.setEnabled(showWireframe));
        if (hint) hint.textContent = 'W: wireframe ' + (showWireframe ? 'ON' : 'OFF');
    });

    const groups = Math.ceil(MAX_COINS / 64);
    let current = 0;           // index of the buffer that currently holds valid state
    let startTime = -1;
    let lastTime = -1;

    scene.onBeforeRenderObservable.add(() => {
        if (!phys[0].isReady() || !phys[1].isReady() || !buildMat[0].isReady() || !buildMat[1].isReady()) {
            return;
        }
        const now = performance.now();
        if (startTime < 0) { startTime = now; lastTime = now; }
        const dt = Math.min((now - lastTime) / 1000, 1 / 30);
        lastTime = now;
        const time = (now - startTime) / 1000;

        paramsUB.updateFloat4('p0', dt / SUBSTEPS, GRAVITY, GROUND_Y, time);
        paramsUB.updateFloat4('p1', DAMPING, ANG_DAMPING, RESTITUTION, FRICTION);
        paramsUB.update();

        for (let s = 0; s < SUBSTEPS; s++) {
            phys[current].dispatch(groups);
            current = 1 - current;   // the freshly written buffer becomes current
        }
        buildMat[current].dispatch(groups);
    });

    return scene;
};

async function init() {
    const canvas = document.getElementById('c');
    if (!navigator.gpu) {
        document.getElementById('hint').textContent = 'WebGPU is not available in this browser.';
        return;
    }
    const engine = new BABYLON.WebGPUEngine(canvas);
    await engine.initAsync();
    const scene = await createScene(engine, canvas);
    engine.runRenderLoop(() => scene.render());
    window.addEventListener('resize', () => engine.resize());
}

init().catch((error) => console.error(error));
