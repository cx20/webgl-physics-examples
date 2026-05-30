// Filament + Havok — Falling Shogi sample (PBR).
//
// Many shogi pieces (a faceted pentagon-prism shape, textured with a shogi piece image) tumble into
// a walled box, simulated by Havok and rendered by Filament with lit, physically-based materials.
//
// There is no lit .filamat we can load, so the scene is emitted as an in-code glTF (GLB): the piece
// mesh (the shogi image as baseColorTexture, with flat per-face normals) plus a grass ground slab,
// loaded through Filament's gltfio. The papermill IBL and a directional sun light the scene, so the
// pieces are shaded instead of looking flat. Each piece collides as a convex hull of its own mesh
// (HP_Shape_CreateConvexHull) and its node is synced every frame.
//
// Collider wireframes are baked into the same GLB as LINES primitives with KHR_materials_unlit
// (orange piece outline = convex-hull collider; green = ground + walls), so they render in the same
// Filament pass — no second canvas. Press W to toggle the wireframe entities in / out of the scene.
//
// Libraries are loaded as globals via <script> tags: Filament, HavokPhysics, gl-matrix
// (vec3 / quat / mat4).

const IBL_URL = 'https://cx20.github.io/gltf-test/textures/ktx/papermill/papermill_ibl.ktx';
const GRASS_URL = '../../../../assets/textures/grass.jpg';
const SHOGI_URL = '../../../../assets/textures/shogi_001/shogi.png';

const PIECE_COUNT = 220;
const PIECE_W = 1.6;
const PIECE_H = 1.6;
const PIECE_D = 0.45;
const COLLIDER_SIZE = [PIECE_W, PIECE_H, PIECE_D * 1.4]; // box fallback only
const PIECE_ROUGHNESS = 0.65; // lacquered-wood look
const WIREFRAME_OUTSET = 1.005;

const FIXED_TIMESTEP = 1 / 60;
const IDENTITY_QUATERNION = [0, 0, 0, 1];
const RESET_Y_THRESHOLD = -10;
const GROUND = { size: [40, 4, 40], pos: [0, -2, 0] };
const GROUND_TILES = 16;
const WALLS = [
  { size: [10, 10, 1], pos: [0, 5, -5] },
  { size: [10, 10, 1], pos: [0, 5, 5] },
  { size: [1, 10, 10], pos: [-5, 5, 0] },
  { size: [1, 10, 10], pos: [5, 5, 0] },
];

const COLOR_DYNAMIC = [1.0, 0.5, 0.2, 1.0];
const COLOR_STATIC = [0.2, 1.0, 0.4, 1.0];

let HK = null;
let worldId = null;

let engine = null;
let scene = null;
let asset = null;
let showWireframe = true;
const pieces = [];                   // { entity, wireframeEntity, bodyId }
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

function createShogiGeometry(w, h, d) {
  const positions = new Float32Array([
    -0.5 * w, -0.5 * h, 0.7 * d, 0.5 * w, -0.5 * h, 0.7 * d, 0.35 * w, 0.5 * h, 0.4 * d, -0.35 * w, 0.5 * h, 0.4 * d,
    -0.5 * w, -0.5 * h, -0.7 * d, 0.5 * w, -0.5 * h, -0.7 * d, 0.35 * w, 0.5 * h, -0.4 * d, -0.35 * w, 0.5 * h, -0.4 * d,
    0.35 * w, 0.5 * h, 0.4 * d, -0.35 * w, 0.5 * h, 0.4 * d, -0.35 * w, 0.5 * h, -0.4 * d, 0.35 * w, 0.5 * h, -0.4 * d,
    -0.5 * w, -0.5 * h, 0.7 * d, 0.5 * w, -0.5 * h, 0.7 * d, 0.5 * w, -0.5 * h, -0.7 * d, -0.5 * w, -0.5 * h, -0.7 * d,
    0.5 * w, -0.5 * h, 0.7 * d, 0.35 * w, 0.5 * h, 0.4 * d, 0.35 * w, 0.5 * h, -0.4 * d, 0.5 * w, -0.5 * h, -0.7 * d,
    -0.5 * w, -0.5 * h, 0.7 * d, -0.35 * w, 0.5 * h, 0.4 * d, -0.35 * w, 0.5 * h, -0.4 * d, -0.5 * w, -0.5 * h, -0.7 * d,
    -0.35 * w, 0.5 * h, 0.4 * d, 0.35 * w, 0.5 * h, 0.4 * d, 0.0 * w, 0.6 * h, 0.35 * d,
    -0.35 * w, 0.5 * h, -0.4 * d, 0.35 * w, 0.5 * h, -0.4 * d, 0.0 * w, 0.6 * h, -0.35 * d,
    0.35 * w, 0.5 * h, 0.4 * d, 0.35 * w, 0.5 * h, -0.4 * d, 0.0 * w, 0.6 * h, -0.35 * d, 0.0 * w, 0.6 * h, 0.35 * d,
    -0.35 * w, 0.5 * h, 0.4 * d, -0.35 * w, 0.5 * h, -0.4 * d, 0.0 * w, 0.6 * h, -0.35 * d, 0.0 * w, 0.6 * h, 0.35 * d,
  ]);
  const uvs = new Float32Array([
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
  const indices = new Uint32Array([
    0, 1, 2, 0, 2, 3,
    4, 6, 5, 4, 7, 6,
    8, 9, 10, 8, 10, 11,
    12, 14, 13, 12, 15, 14,
    16, 18, 17, 16, 19, 18,
    20, 21, 22, 20, 22, 23,
    24, 25, 26,
    27, 29, 28,
    30, 31, 33, 31, 32, 33,
    34, 36, 35, 34, 37, 36,
  ]);
  const { min, max } = minMax3(positions);
  return { positions, normals: computeFlatNormals(positions, indices), uvs, indices, min, max };
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

// Triangle-edge line list from a triangle mesh — a faithful outline of the convex-hull collider.
function buildPieceLineMesh(geo) {
  const pos = geo.positions, idx = geo.indices, verts = [];
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
    verts.push(pos[a], pos[a + 1], pos[a + 2], pos[b], pos[b + 1], pos[b + 2]);
    verts.push(pos[b], pos[b + 1], pos[b + 2], pos[c], pos[c + 1], pos[c + 2]);
    verts.push(pos[c], pos[c + 1], pos[c + 2], pos[a], pos[a + 1], pos[a + 2]);
  }
  const positionArr = new Float32Array(verts);
  const indicesArr = new Uint32Array(positionArr.length / 3);
  for (let i = 0; i < indicesArr.length; i++) indicesArr[i] = i;
  return {
    positions: positionArr, indices: indicesArr,
    min: geo.min.slice(), max: geo.max.slice(),
  };
}

// ---- In-code GLB assembly ----
function alignTo4(n) { return (n + 3) & ~3; }

function buildSceneGlb(pieceSpecs, pieceGeo, shogiImage, grassImage) {
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

  // ---- PBR piece + ground ----
  const pieceAccs = addTriMesh(pieceGeo);
  materials.push({
    name: 'piece',
    pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0.0, roughnessFactor: PIECE_ROUGHNESS },
    doubleSided: true,
  });
  meshes.push({ primitives: [{ attributes: { POSITION: pieceAccs.POSITION, NORMAL: pieceAccs.NORMAL, TEXCOORD_0: pieceAccs.TEXCOORD_0 }, indices: pieceAccs.indices, material: materials.length - 1 }] });
  const pieceMeshIndex = meshes.length - 1;

  const groundAccs = addTriMesh(buildQuadGeometry(GROUND.size[0] / 2, GROUND.size[2] / 2, GROUND.pos[1] + GROUND.size[1] / 2, GROUND_TILES));
  materials.push({
    name: 'ground',
    pbrMetallicRoughness: { baseColorTexture: { index: 1 }, metallicFactor: 0.0, roughnessFactor: 0.9 },
    doubleSided: true,
  });
  meshes.push({ primitives: [{ attributes: { POSITION: groundAccs.POSITION, NORMAL: groundAccs.NORMAL, TEXCOORD_0: groundAccs.TEXCOORD_0 }, indices: groundAccs.indices, material: materials.length - 1 }] });
  const groundMeshIndex = meshes.length - 1;

  // ---- Unlit wireframe materials ----
  const pieceWireMatIndex = materials.length;
  materials.push({ name: 'pieceWireframe', extensions: { KHR_materials_unlit: {} }, pbrMetallicRoughness: { baseColorFactor: COLOR_DYNAMIC } });
  const staticWireMatIndex = materials.length;
  materials.push({ name: 'staticWireframe', extensions: { KHR_materials_unlit: {} }, pbrMetallicRoughness: { baseColorFactor: COLOR_STATIC } });

  // ---- LINES piece wireframe (shared by all pieces) ----
  const pieceLineAccs = addLineMesh(buildPieceLineMesh(pieceGeo));
  meshes.push({ primitives: [{ mode: 1, attributes: { POSITION: pieceLineAccs.POSITION }, indices: pieceLineAccs.indices, material: pieceWireMatIndex }] });
  const pieceWireMeshIndex = meshes.length - 1;

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
  pieceSpecs.forEach((s, i) => nodes.push({ name: 'piece' + i, mesh: pieceMeshIndex, translation: s.position }));
  nodes.push({ name: 'ground', mesh: groundMeshIndex });
  pieceSpecs.forEach((s, i) => nodes.push({ name: 'pieceWireframe' + i, mesh: pieceWireMeshIndex, translation: s.position }));
  staticWireMeshIndices.forEach((mi, i) => nodes.push({ name: 'staticWireframe' + i, mesh: mi }));

  // ---- Embedded textures (shogi + grass) ----
  const images = [shogiImage, grassImage];
  const imgs = [], texs = [];
  images.forEach((im, i) => {
    const bv = addBufferView(im.bytes, undefined);
    imgs.push({ bufferView: bv, mimeType: im.mimeType });
    texs.push({ sampler: 0, source: i });
  });

  const gltf = {
    asset: { version: '2.0', generator: 'filament-havok-shogi' },
    extensionsUsed: ['KHR_materials_unlit'],
    scene: 0,
    scenes: [{ nodes: nodes.map((_, i) => i) }],
    nodes, meshes, materials, accessors, bufferViews,
    images: imgs,
    samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }],
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

function createPieceShape(positions) {
  if (typeof HK.HP_Shape_CreateConvexHull === 'function') {
    const nPoints = positions.length / 3;
    let shapeId = null;
    if (typeof HK._malloc === 'function' && HK.HEAPU8) {
      const ptr = HK._malloc(positions.byteLength);
      new Float32Array(HK.HEAPU8.buffer, ptr, positions.length).set(positions);
      const res = HK.HP_Shape_CreateConvexHull(ptr, nPoints);
      HK._free(ptr);
      if (enumToNumber(res[0]) === enumToNumber(HK.Result.RESULT_OK) && res[1]) shapeId = res[1];
    }
    if (!shapeId) {
      const res = HK.HP_Shape_CreateConvexHull(positions, nPoints);
      if (enumToNumber(res[0]) === enumToNumber(HK.Result.RESULT_OK) && res[1]) shapeId = res[1];
    }
    if (shapeId) return shapeId;
  }
  const res = HK.HP_Shape_CreateBox([0, 0, 0], IDENTITY_QUATERNION, COLLIDER_SIZE);
  checkResult(res[0], 'HP_Shape_CreateBox piece fallback');
  return res[1];
}

function randomQuat() {
  const x = Math.random() - 0.5, y = Math.random() - 0.5, z = Math.random() - 0.5, w = Math.random() - 0.5;
  const l = Math.hypot(x, y, z, w) || 1;
  return [x / l, y / l, z / l, w / l];
}

function randomDrop() {
  return [(Math.random() - 0.5) * 8, 12 + Math.random() * 26, (Math.random() - 0.5) * 8];
}

function addPieceBody(shapeId, entity, wireframeEntity, pos, rot) {
  const cb = HK.HP_Body_Create();
  const bodyId = cb[1];
  HK.HP_Body_SetShape(bodyId, shapeId);
  HK.HP_Body_SetMotionType(bodyId, HK.MotionType.DYNAMIC);
  const mp = HK.HP_Shape_BuildMassProperties(shapeId);
  HK.HP_Body_SetMassProperties(bodyId, mp[1]);
  HK.HP_Body_SetPosition(bodyId, pos);
  HK.HP_Body_SetOrientation(bodyId, rot);
  HK.HP_World_AddBody(worldId, bodyId, false);
  pieces.push({ entity, wireframeEntity, bodyId });
}

// Scratch buffers reused by stepAndSync; initialised in main() once gl-matrix is available.
let tmpMat = null, tmpQuat = null, tmpVec = null;

function stepAndSync() {
  checkResult(HK.HP_World_Step(worldId, FIXED_TIMESTEP), 'HP_World_Step');
  const tcm = engine.getTransformManager();
  tcm.openLocalTransformTransaction();
  for (const p of pieces) {
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
  for (const p of pieces) {
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
  renderer.setClearOptions({ clearColor: [0.13, 0.14, 0.16, 1.0], clear: true });

  // Physics world + static ground / walls (walls are wireframe-only).
  HK = await HavokPhysics();
  const w = HK.HP_World_Create();
  worldId = w[1];
  checkResult(HK.HP_World_SetGravity(worldId, [0, -10, 0]), 'HP_World_SetGravity');
  checkResult(HK.HP_World_SetIdealStepTime(worldId, FIXED_TIMESTEP), 'HP_World_SetIdealStepTime');
  createStaticBox(GROUND.size, GROUND.pos);
  for (const wd of WALLS) createStaticBox(wd.size, wd.pos);

  // Assign a spawn point to each piece, then build & load the GLB (pieces + wires + ground).
  const pieceSpecs = [];
  for (let i = 0; i < PIECE_COUNT; i++) pieceSpecs.push({ position: randomDrop() });

  const pieceGeo = createShogiGeometry(PIECE_W, PIECE_H, PIECE_D);

  const shogiImage = { bytes: await fetchBytes(SHOGI_URL), mimeType: 'image/png' };
  const grassImage = { bytes: await fetchBytes(GRASS_URL), mimeType: 'image/jpeg' };

  const glb = buildSceneGlb(pieceSpecs, pieceGeo, shogiImage, grassImage);
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

  // One shared convex-hull collider; match each piece node to its Filament entities + wireframe.
  const pieceShape = createPieceShape(pieceGeo.positions);
  for (let i = 0; i < pieceSpecs.length; i++) {
    const entity = asset.getEntitiesByName('piece' + i)[0] || null;
    const wireframeEntity = asset.getEntitiesByName('pieceWireframe' + i)[0] || null;
    addPieceBody(pieceShape, entity, wireframeEntity, pieceSpecs[i].position, randomQuat());
  }
  // Ground + 4 wall wireframes.
  for (let i = 0; i < 1 + WALLS.length; i++) {
    const ent = asset.getEntitiesByName('staticWireframe' + i)[0];
    if (ent) staticWireframeEntities.push(ent);
  }
  console.log('[Filament+Havok] pieces ready:', pieces.length, 'static wires:', staticWireframeEntities.length);

  const camTarget = [0, 2, 0];
  let camTheta  = 0.5;   // azimuth (rad)
  let camPhi    = 0.49;   // elevation (rad)
  let camRadius = 34.0;

  let aspect = 1;
  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.width = Math.floor(window.innerWidth * dpr);
    const height = canvas.height = Math.floor(window.innerHeight * dpr);
    aspect = width / height;
    view.setViewport([0, 0, width, height]);
    const fovAxis = aspect < 1 ? Fov.HORIZONTAL : Fov.VERTICAL;
    camera.setProjectionFov(75, aspect, 0.1, 1000.0, fovAxis);
  }
  window.addEventListener('resize', resize);
  resize();

  // Mouse-drag orbit + scroll zoom.
  let isDragging = false, lastX = 0, lastY = 0;
  canvas.addEventListener('mousedown', e => { isDragging = true; lastX = e.clientX; lastY = e.clientY; });
  window.addEventListener('mouseup',   () => { isDragging = false; });
  window.addEventListener('mousemove', e => {
    if (!isDragging) return;
    camTheta -= (e.clientX - lastX) * 0.01;
    camPhi   += (e.clientY - lastY) * 0.01;
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
