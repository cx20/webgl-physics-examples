// Filament + Havok — Falling Eraser sample (PBR).
//
// Many textured eraser boxes rain into a walled box, simulated by Havok and rendered by Filament
// with lit, physically-based materials.
//
// There is no lit .filamat we can load, so the scene is emitted as an in-code glTF (GLB): the eraser
// box mesh (textured with a 6-cell atlas built at runtime from the six eraser_003 face images, so
// every label reads "MOMO") plus a grass ground slab, loaded through Filament's gltfio. The papermill
// IBL and a directional sun light the scene. Each eraser collides as a box (HP_Shape_CreateBox) and
// its node is synced every frame.
//
// Collider wireframes are baked into the same GLB as LINES primitives with KHR_materials_unlit
// (orange eraser outline = box collider; green = ground + walls), so they render in the same Filament
// pass — no second canvas. Press W to toggle the wireframe entities in / out of the scene.
//
// Libraries are loaded as globals via <script> tags: Filament, HavokPhysics, gl-matrix
// (vec3 / quat / mat4).

const IBL_URL = 'https://cx20.github.io/gltf-test/textures/ktx/papermill/papermill_ibl.ktx';
const GRASS_URL = '../../../../assets/textures/grass.jpg';
// Six eraser faces in atlas-column order: +x, -x, +y, -y, +z, -z (right, left, top, bottom, front, back).
const ERASER_FACE_TEXTURES = [
  '../../../../assets/textures/eraser_003/eraser_right.png',
  '../../../../assets/textures/eraser_003/eraser_left.png',
  '../../../../assets/textures/eraser_003/eraser_top.png',
  '../../../../assets/textures/eraser_003/eraser_bottom.png',
  '../../../../assets/textures/eraser_003/eraser_front.png',
  '../../../../assets/textures/eraser_003/eraser_back.png',
];

const ERASER_COUNT = 200;
// Flat eraser box (full side lengths) and its half-extents.
const ERASER_SIZE = [2.4, 0.6, 1.2];
const EHALF = [ERASER_SIZE[0] / 2, ERASER_SIZE[1] / 2, ERASER_SIZE[2] / 2];
const ERASER_ROUGHNESS = 0.7;
const WIREFRAME_OUTSET = 1.01;

const FIXED_TIMESTEP = 1 / 60;
const IDENTITY_QUATERNION = [0, 0, 0, 1];
const RESET_Y_THRESHOLD = -15;
// Small low floor (no walls), matching the other Havok eraser samples.
const GROUND = { size: [20, 0.1, 20], pos: [0, -10, 0] };
const GROUND_TILES = 8;
const WALLS = [];

const COLOR_DYNAMIC = [1.0, 0.5, 0.2, 1.0];
const COLOR_STATIC = [0.2, 1.0, 0.4, 1.0];

let HK = null;
let worldId = null;

let engine = null;
let scene = null;
let asset = null;
let showWireframe = true;
const erasers = [];                  // { entity, wireframeEntity, bodyId }
const staticWireframeEntities = [];  // ground + walls

// ---- Havok helpers ----
function enumToNumber(value) {
  if (typeof value === 'number' || typeof value === 'bigint') return Number(value);
  if (!value || typeof value !== 'object') return NaN;
  if (typeof value.value === 'number' || typeof value.value === 'bigint') return Number(value.value);
  if (typeof value.m_value === 'number' || typeof value.m_value === 'bigint') return Number(value.m_value);
  return NaN;
}

function checkResult(result, label) {
  if (result === HK.Result.RESULT_OK) return;
  const rc = enumToNumber(result);
  const ok = enumToNumber(HK.Result.RESULT_OK);
  if (!Number.isNaN(rc) && !Number.isNaN(ok) && rc === ok) return;
  console.warn('[Havok] ' + label + ' returned:', result);
}

// ---- Geometry (triangle meshes) ----
function computeFlatNormals(positions, indices) {
  const normals = new Float32Array(positions.length);
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3, b = indices[i + 1] * 3, c = indices[i + 2] * 3;
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const idx of [a, b, c]) { normals[idx] += nx; normals[idx + 1] += ny; normals[idx + 2] += nz; }
  }
  for (let i = 0; i < normals.length; i += 3) {
    const l = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1;
    normals[i] /= l; normals[i + 1] /= l; normals[i + 2] /= l;
  }
  return normals;
}

function minMax3(positions) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], positions[i + k]);
      max[k] = Math.max(max[k], positions[i + k]);
    }
  }
  return { min, max };
}

// Eraser box: 24 vertices (6 faces) with per-face UVs into a 6-column atlas (+x,-x,+y,-y,+z,-z).
function createEraserGeometry() {
  const faces = [
    { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },
    { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
    { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },
    { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
    { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
    { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
  ];
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  const localUV = [[0, 1], [1, 1], [1, 0], [0, 0]];
  const positions = [], uvs = [], indices = [];
  const dotHalf = (a) => Math.abs(a[0]) * EHALF[0] + Math.abs(a[1]) * EHALF[1] + Math.abs(a[2]) * EHALF[2];
  faces.forEach((f, fi) => {
    const base = positions.length / 3;
    const halfU = dotHalf(f.u), halfV = dotHalf(f.v);
    for (let ci = 0; ci < 4; ci++) {
      const [su, sv] = corners[ci];
      positions.push(
        f.n[0] * EHALF[0] + f.u[0] * su * halfU + f.v[0] * sv * halfV,
        f.n[1] * EHALF[1] + f.u[1] * su * halfU + f.v[1] * sv * halfV,
        f.n[2] * EHALF[2] + f.u[2] * su * halfU + f.v[2] * sv * halfV,
      );
      uvs.push((localUV[ci][0] + fi) / 6, localUV[ci][1]);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  });
  const pos = new Float32Array(positions);
  const idx = new Uint32Array(indices);
  const { min, max } = minMax3(pos);
  return { positions: pos, normals: computeFlatNormals(pos, idx), uvs: new Float32Array(uvs), indices: idx, min, max };
}

function buildQuadGeometry(halfX, halfZ, y, tiles) {
  const positions = new Float32Array([-halfX, y, -halfZ, halfX, y, -halfZ, halfX, y, halfZ, -halfX, y, halfZ]);
  return {
    positions,
    normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]),
    uvs: new Float32Array([0, 0, tiles, 0, tiles, tiles, 0, tiles]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    min: [-halfX, y, -halfZ],
    max: [halfX, y, halfZ],
  };
}

// ---- Geometry (LINES wireframes) ----
const LINE_BOX_INDICES = new Uint32Array([
  0, 1, 1, 2, 2, 3, 3, 0,
  4, 5, 5, 6, 6, 7, 7, 4,
  0, 4, 1, 5, 2, 6, 3, 7,
]);
function buildLineBox(hx, hy, hz, cx = 0, cy = 0, cz = 0) {
  const positions = new Float32Array([
    cx - hx, cy - hy, cz - hz,  cx + hx, cy - hy, cz - hz,  cx + hx, cy + hy, cz - hz,  cx - hx, cy + hy, cz - hz,
    cx - hx, cy - hy, cz + hz,  cx + hx, cy - hy, cz + hz,  cx + hx, cy + hy, cz + hz,  cx - hx, cy + hy, cz + hz,
  ]);
  return {
    positions, indices: LINE_BOX_INDICES,
    min: [cx - hx, cy - hy, cz - hz], max: [cx + hx, cy + hy, cz + hz],
  };
}

// ---- In-code GLB assembly ----
function alignTo4(n) { return (n + 3) & ~3; }

function buildSceneGlb(eraserSpecs, eraserGeo, atlasImage, grassImage) {
  const accessors = [];
  const bufferViews = [];
  const binChunks = [];
  let binOffset = 0;

  function addBufferView(typedArray, target) {
    const padded = alignTo4(binOffset);
    if (padded > binOffset) { binChunks.push(new Uint8Array(padded - binOffset)); binOffset = padded; }
    const bytes = new Uint8Array(typedArray.buffer, typedArray.byteOffset, typedArray.byteLength);
    const index = bufferViews.length;
    const bv = { buffer: 0, byteOffset: binOffset, byteLength: bytes.byteLength };
    if (target !== undefined) bv.target = target;
    bufferViews.push(bv);
    binChunks.push(bytes);
    binOffset += bytes.byteLength;
    return index;
  }

  function addTriMesh(g) {
    const posBV = addBufferView(g.positions, 34962);
    const posAcc = accessors.length;
    accessors.push({ bufferView: posBV, componentType: 5126, count: g.positions.length / 3, type: 'VEC3', min: g.min, max: g.max });
    const nrmBV = addBufferView(g.normals, 34962);
    const nrmAcc = accessors.length;
    accessors.push({ bufferView: nrmBV, componentType: 5126, count: g.normals.length / 3, type: 'VEC3' });
    const uvBV = addBufferView(g.uvs, 34962);
    const uvAcc = accessors.length;
    accessors.push({ bufferView: uvBV, componentType: 5126, count: g.uvs.length / 2, type: 'VEC2' });
    const idxBV = addBufferView(g.indices, 34963);
    const idxAcc = accessors.length;
    accessors.push({ bufferView: idxBV, componentType: 5125, count: g.indices.length, type: 'SCALAR' });
    return { POSITION: posAcc, NORMAL: nrmAcc, TEXCOORD_0: uvAcc, indices: idxAcc };
  }
  function addLineMesh(g) {
    const posBV = addBufferView(g.positions, 34962);
    const posAcc = accessors.length;
    accessors.push({ bufferView: posBV, componentType: 5126, count: g.positions.length / 3, type: 'VEC3', min: g.min, max: g.max });
    const idxBV = addBufferView(g.indices, 34963);
    const idxAcc = accessors.length;
    accessors.push({ bufferView: idxBV, componentType: 5125, count: g.indices.length, type: 'SCALAR' });
    return { POSITION: posAcc, indices: idxAcc };
  }

  const meshes = [];
  const materials = [];

  // ---- PBR eraser + ground ----
  const eraserAccs = addTriMesh(eraserGeo);
  materials.push({
    name: 'eraser',
    pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0.0, roughnessFactor: ERASER_ROUGHNESS },
    doubleSided: true,
  });
  meshes.push({ primitives: [{ attributes: { POSITION: eraserAccs.POSITION, NORMAL: eraserAccs.NORMAL, TEXCOORD_0: eraserAccs.TEXCOORD_0 }, indices: eraserAccs.indices, material: materials.length - 1 }] });
  const eraserMeshIndex = meshes.length - 1;

  const groundAccs = addTriMesh(buildQuadGeometry(GROUND.size[0] / 2, GROUND.size[2] / 2, GROUND.pos[1] + GROUND.size[1] / 2, GROUND_TILES));
  materials.push({
    name: 'ground',
    pbrMetallicRoughness: { baseColorTexture: { index: 1 }, metallicFactor: 0.0, roughnessFactor: 0.9 },
    doubleSided: true,
  });
  meshes.push({ primitives: [{ attributes: { POSITION: groundAccs.POSITION, NORMAL: groundAccs.NORMAL, TEXCOORD_0: groundAccs.TEXCOORD_0 }, indices: groundAccs.indices, material: materials.length - 1 }] });
  const groundMeshIndex = meshes.length - 1;

  // ---- Unlit wireframe materials ----
  const eraserWireMatIndex = materials.length;
  materials.push({ name: 'eraserWireframe', extensions: { KHR_materials_unlit: {} }, pbrMetallicRoughness: { baseColorFactor: COLOR_DYNAMIC } });
  const staticWireMatIndex = materials.length;
  materials.push({ name: 'staticWireframe', extensions: { KHR_materials_unlit: {} }, pbrMetallicRoughness: { baseColorFactor: COLOR_STATIC } });

  // ---- LINES eraser wireframe (shared by all erasers) ----
  const eraserLineAccs = addLineMesh(buildLineBox(EHALF[0] * WIREFRAME_OUTSET, EHALF[1] * WIREFRAME_OUTSET, EHALF[2] * WIREFRAME_OUTSET));
  meshes.push({ primitives: [{ mode: 1, attributes: { POSITION: eraserLineAccs.POSITION }, indices: eraserLineAccs.indices, material: eraserWireMatIndex }] });
  const eraserWireMeshIndex = meshes.length - 1;

  // ---- LINES static wireframes (ground + 4 walls, size + position baked) ----
  const staticDefs = [{ size: GROUND.size, pos: GROUND.pos }, ...WALLS];
  const staticWireMeshIndices = staticDefs.map((d) => {
    const hx = d.size[0] / 2 * WIREFRAME_OUTSET, hy = d.size[1] / 2 * WIREFRAME_OUTSET, hz = d.size[2] / 2 * WIREFRAME_OUTSET;
    const accs = addLineMesh(buildLineBox(hx, hy, hz, d.pos[0], d.pos[1], d.pos[2]));
    meshes.push({ primitives: [{ mode: 1, attributes: { POSITION: accs.POSITION }, indices: accs.indices, material: staticWireMatIndex }] });
    return meshes.length - 1;
  });

  // ---- Nodes ----
  const nodes = [];
  eraserSpecs.forEach((s, i) => nodes.push({ name: 'eraser' + i, mesh: eraserMeshIndex, translation: s.position }));
  nodes.push({ name: 'ground', mesh: groundMeshIndex });
  eraserSpecs.forEach((s, i) => nodes.push({ name: 'eraserWireframe' + i, mesh: eraserWireMeshIndex, translation: s.position }));
  staticWireMeshIndices.forEach((mi, i) => nodes.push({ name: 'staticWireframe' + i, mesh: mi }));

  // ---- Embedded textures (eraser atlas + grass) ----
  const images = [atlasImage, grassImage];
  const imgs = [], texs = [];
  images.forEach((im, i) => {
    const bv = addBufferView(im.bytes, undefined);
    imgs.push({ bufferView: bv, mimeType: im.mimeType });
    texs.push({ sampler: i === 0 ? 0 : 1, source: i });
  });

  const gltf = {
    asset: { version: '2.0', generator: 'filament-havok-eraser' },
    extensionsUsed: ['KHR_materials_unlit'],
    scene: 0,
    scenes: [{ nodes: nodes.map((_, i) => i) }],
    nodes, meshes, materials, accessors, bufferViews,
    images: imgs,
    // sampler 0: eraser atlas — clamped, no mipmaps, so adjacent atlas cells never bleed together.
    // sampler 1: grass — repeating with mipmaps.
    samplers: [
      { magFilter: 9729, minFilter: 9729, wrapS: 33071, wrapT: 33071 },
      { magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 },
    ],
    textures: texs,
    buffers: [{ byteLength: binOffset }],
  };

  let jsonBytes = new TextEncoder().encode(JSON.stringify(gltf));
  const jsonPad = alignTo4(jsonBytes.length) - jsonBytes.length;
  if (jsonPad) {
    const t = new Uint8Array(jsonBytes.length + jsonPad);
    t.set(jsonBytes); t.fill(0x20, jsonBytes.length);
    jsonBytes = t;
  }

  const binBuf = new Uint8Array(alignTo4(binOffset));
  let o = 0;
  for (const ch of binChunks) { binBuf.set(ch, o); o += ch.byteLength; }

  const totalLen = 12 + 8 + jsonBytes.length + 8 + binBuf.length;
  const glb = new Uint8Array(totalLen);
  const dv = new DataView(glb.buffer);
  let p = 0;
  dv.setUint32(p, 0x46546C67, true); p += 4;
  dv.setUint32(p, 2, true); p += 4;
  dv.setUint32(p, totalLen, true); p += 4;
  dv.setUint32(p, jsonBytes.length, true); p += 4;
  dv.setUint32(p, 0x4E4F534A, true); p += 4;
  glb.set(jsonBytes, p); p += jsonBytes.length;
  dv.setUint32(p, binBuf.length, true); p += 4;
  dv.setUint32(p, 0x004E4942, true); p += 4;
  glb.set(binBuf, p);
  return glb;
}

// ---- Scene setup ----
function createStaticBox(size, pos) {
  const s = HK.HP_Shape_CreateBox([0, 0, 0], IDENTITY_QUATERNION, size);
  const b = HK.HP_Body_Create();
  HK.HP_Body_SetShape(b[1], s[1]);
  HK.HP_Body_SetMotionType(b[1], HK.MotionType.STATIC);
  HK.HP_Body_SetPosition(b[1], pos);
  HK.HP_Body_SetOrientation(b[1], IDENTITY_QUATERNION);
  HK.HP_World_AddBody(worldId, b[1], false);
}

function createEraserShape() {
  const res = HK.HP_Shape_CreateBox([0, 0, 0], IDENTITY_QUATERNION, ERASER_SIZE);
  checkResult(res[0], 'HP_Shape_CreateBox eraser');
  HK.HP_Shape_SetDensity(res[1], 1);
  return res[1];
}

function randomQuat() {
  const x = Math.random() - 0.5, y = Math.random() - 0.5, z = Math.random() - 0.5, w = Math.random() - 0.5;
  const l = Math.hypot(x, y, z, w) || 1;
  return [x / l, y / l, z / l, w / l];
}

function randomDrop() {
  return [(Math.random() - 0.5) * 12, 14 + Math.random() * 14, (Math.random() - 0.5) * 12];
}

function addEraserBody(shapeId, entity, wireframeEntity, pos, rot) {
  const cb = HK.HP_Body_Create();
  const bodyId = cb[1];
  HK.HP_Body_SetShape(bodyId, shapeId);
  HK.HP_Body_SetMotionType(bodyId, HK.MotionType.DYNAMIC);
  const mp = HK.HP_Shape_BuildMassProperties(shapeId);
  HK.HP_Body_SetMassProperties(bodyId, mp[1]);
  HK.HP_Body_SetPosition(bodyId, pos);
  HK.HP_Body_SetOrientation(bodyId, rot);
  HK.HP_World_AddBody(worldId, bodyId, false);
  erasers.push({ entity, wireframeEntity, bodyId });
}

// Scratch buffers reused by stepAndSync; initialised in main() once gl-matrix is available.
let tmpMat = null, tmpQuat = null, tmpVec = null;

function stepAndSync() {
  checkResult(HK.HP_World_Step(worldId, FIXED_TIMESTEP), 'HP_World_Step');
  const tcm = engine.getTransformManager();
  tcm.openLocalTransformTransaction();
  for (const p of erasers) {
    let pos = HK.HP_Body_GetPosition(p.bodyId)[1];
    if (pos[1] < RESET_Y_THRESHOLD) {
      HK.HP_Body_SetPosition(p.bodyId, randomDrop());
      HK.HP_Body_SetOrientation(p.bodyId, randomQuat());
      HK.HP_Body_SetLinearVelocity(p.bodyId, [0, 0, 0]);
      HK.HP_Body_SetAngularVelocity(p.bodyId, [0, 0, 0]);
      pos = HK.HP_Body_GetPosition(p.bodyId)[1];
    }
    const r = HK.HP_Body_GetOrientation(p.bodyId)[1];
    quat.set(tmpQuat, r[0], r[1], r[2], r[3]);
    vec3.set(tmpVec, pos[0], pos[1], pos[2]);
    mat4.fromRotationTranslation(tmpMat, tmpQuat, tmpVec);
    if (p.entity) {
      const inst = tcm.getInstance(p.entity);
      tcm.setTransform(inst, tmpMat);
      inst.delete();
    }
    if (p.wireframeEntity) {
      const inst = tcm.getInstance(p.wireframeEntity);
      tcm.setTransform(inst, tmpMat);
      inst.delete();
    }
  }
  tcm.commitLocalTransformTransaction();
}

// ---- W-key wireframe toggle (adds / removes the wireframe entities from the scene) ----
function setWireframeVisible(visible) {
  showWireframe = visible;
  const hint = document.getElementById('hint');
  if (hint) hint.textContent = 'W: wireframe ' + (visible ? 'ON' : 'OFF');
  if (!scene) return;
  for (const p of erasers) {
    if (!p.wireframeEntity) continue;
    if (visible) scene.addEntity(p.wireframeEntity); else scene.remove(p.wireframeEntity);
  }
  for (const e of staticWireframeEntities) {
    if (visible) scene.addEntity(e); else scene.remove(e);
  }
}

window.addEventListener('keydown', (event) => {
  if (event.repeat) return;
  if (event.code === 'KeyW' || event.key === 'w' || event.key === 'W') {
    setWireframeVisible(!showWireframe);
  }
});

async function fetchBytes(url) {
  return new Uint8Array(await (await fetch(url)).arrayBuffer());
}

// Build a 6-cell atlas PNG (right,left,top,bottom,front,back) from the eraser_003 face images.
async function buildEraserAtlasBytes() {
  const cell = 256;
  const images = await Promise.all(ERASER_FACE_TEXTURES.map(async (s) => {
    const im = new Image();
    im.src = s;
    await im.decode();
    return im;
  }));
  const canvas = document.createElement('canvas');
  canvas.width = cell * 6;
  canvas.height = cell;
  const ctx = canvas.getContext('2d');
  for (let i = 0; i < 6; i++) ctx.drawImage(images[i], i * cell, 0, cell, cell);
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}

// ---- Filament app ----
Filament.init([IBL_URL], () => {
  window.gltfio = Filament.gltfio;
  window.Fov = Filament.Camera$Fov;
  window.LightType = Filament.LightManager$Type;
  window.ToneMapping = Filament.ColorGrading$ToneMapping;
  main().catch(e => console.error(e));
});

async function main() {
  tmpMat = mat4.create();
  tmpQuat = quat.create();
  tmpVec = vec3.create();

  const canvas = document.getElementsByTagName('canvas')[0];
  engine = Filament.Engine.create(canvas);
  scene = engine.createScene();

  const ibl = engine.createIblFromKtx1(IBL_URL);
  ibl.setIntensity(50000);
  scene.setIndirectLight(ibl);

  const sun = Filament.EntityManager.get().create();
  Filament.LightManager.Builder(LightType.SUN)
    .color([0.98, 0.92, 0.89])
    .intensity(50000.0)
    .direction([0.5, -1.0, -0.6])
    .castShadows(true)
    .build(engine, sun);
  scene.addEntity(sun);

  const swapChain = engine.createSwapChain();
  const renderer = engine.createRenderer();
  const camera = engine.createCamera(Filament.EntityManager.get().create());
  camera.setExposure(16.0, 1.0 / 125.0, 100.0);
  const view = engine.createView();
  view.setCamera(camera);
  view.setScene(scene);
  const colorGrading = Filament.ColorGrading.Builder().toneMapping(ToneMapping.LINEAR).build(engine);
  view.setColorGrading(colorGrading);
  renderer.setClearOptions({ clearColor: [0.5, 0.5, 0.8, 1.0], clear: true });

  // Physics world + static ground / walls (walls are wireframe-only renderables but solid colliders).
  HK = await HavokPhysics();
  const w = HK.HP_World_Create();
  worldId = w[1];
  checkResult(HK.HP_World_SetGravity(worldId, [0, -9.8, 0]), 'HP_World_SetGravity');
  checkResult(HK.HP_World_SetIdealStepTime(worldId, FIXED_TIMESTEP), 'HP_World_SetIdealStepTime');
  createStaticBox(GROUND.size, GROUND.pos);
  for (const wd of WALLS) createStaticBox(wd.size, wd.pos);

  // Assign a spawn point to each eraser, then build & load the GLB (erasers + wires + ground).
  const eraserSpecs = [];
  for (let i = 0; i < ERASER_COUNT; i++) eraserSpecs.push({ position: randomDrop() });

  const eraserGeo = createEraserGeometry();

  const atlasImage = { bytes: await buildEraserAtlasBytes(), mimeType: 'image/png' };
  const grassImage = { bytes: await fetchBytes(GRASS_URL), mimeType: 'image/jpeg' };

  const glb = buildSceneGlb(eraserSpecs, eraserGeo, atlasImage, grassImage);
  const assetLoader = engine.createAssetLoader();
  asset = assetLoader.createAsset(glb);
  await new Promise((resolve) => {
    asset.loadResources(() => {
      assetLoader.delete();
      // Pop every renderable into the scene now so the W toggle can manage wireframes by name.
      let e = asset.popRenderable();
      while (e.getId() !== 0) { scene.addEntity(e); e = asset.popRenderable(); }
      const rm = engine.getRenderableManager();
      for (const ent of asset.getEntities()) {
        const inst = rm.getInstance(ent);
        if (inst) {
          rm.setCastShadows(inst, true);
          rm.setReceiveShadows(inst, true);
          rm.setCulling(inst, false);
          inst.delete();
        }
      }
      resolve();
    }, () => {}, '');
  });

  // One shared box collider; match each eraser node to its Filament entities + wireframe.
  const eraserShape = createEraserShape();
  for (let i = 0; i < eraserSpecs.length; i++) {
    const entity = asset.getEntitiesByName('eraser' + i)[0] || null;
    const wireframeEntity = asset.getEntitiesByName('eraserWireframe' + i)[0] || null;
    addEraserBody(eraserShape, entity, wireframeEntity, eraserSpecs[i].position, randomQuat());
  }
  // Ground + 4 wall wireframes.
  for (let i = 0; i < 1 + WALLS.length; i++) {
    const ent = asset.getEntitiesByName('staticWireframe' + i)[0];
    if (ent) staticWireframeEntities.push(ent);
  }
  console.log('[Filament+Havok] erasers ready:', erasers.length, 'static wires:', staticWireframeEntities.length);

  // Head-on view matching the WebGL/WebGPU + Havok eraser samples (eye at (0,0,40), origin).
  const camTarget = [0, 0, 0];
  let camTheta = 0.0;   // azimuth (rad)
  let camPhi = 0.0;     // elevation (rad)
  let camRadius = 40.0;

  let aspect = 1;
  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.width = Math.floor(window.innerWidth * dpr);
    const height = canvas.height = Math.floor(window.innerHeight * dpr);
    aspect = width / height;
    view.setViewport([0, 0, width, height]);
    const fovAxis = aspect < 1 ? Fov.HORIZONTAL : Fov.VERTICAL;
    camera.setProjectionFov(45, aspect, 0.1, 1000.0, fovAxis);
  }
  window.addEventListener('resize', resize);
  resize();

  // Mouse-drag orbit + scroll zoom.
  let isDragging = false, lastX = 0, lastY = 0;
  canvas.addEventListener('mousedown', e => { isDragging = true; lastX = e.clientX; lastY = e.clientY; });
  window.addEventListener('mouseup', () => { isDragging = false; });
  window.addEventListener('mousemove', e => {
    if (!isDragging) return;
    camTheta -= (e.clientX - lastX) * 0.01;
    camPhi += (e.clientY - lastY) * 0.01;
    camPhi = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, camPhi));
    lastX = e.clientX; lastY = e.clientY;
  });
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    camRadius *= 1 + e.deltaY * 0.001;
    camRadius = Math.max(1.0, Math.min(500.0, camRadius));
  }, { passive: false });
  setWireframeVisible(showWireframe);

  function render(now) {
    requestAnimationFrame(render);

    if (HK && worldId) {
      try { stepAndSync(); } catch (e) { console.error('[physics] error:', e); HK = null; }
    }

    const ex = camTarget[0] + camRadius * Math.cos(camPhi) * Math.sin(camTheta);
    const ey = camTarget[1] + camRadius * Math.sin(camPhi);
    const ez = camTarget[2] + camRadius * Math.cos(camPhi) * Math.cos(camTheta);
    camera.lookAt([ex, ey, ez], camTarget, [0, 1, 0]);

    renderer.render(swapChain, view);
  }
  requestAnimationFrame(render);
}
