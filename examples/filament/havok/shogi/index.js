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
// Collider wireframes are drawn on a separate transparent WebGL2 canvas overlaid with the same
// camera (Filament can't easily draw lines); the four walls are shown only as wireframes. Press W to
// toggle them.
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

const DEBUG_COLOR_DYNAMIC = [1.0, 0.5, 0.2, 1.0];
const DEBUG_COLOR_STATIC = [0.2, 1.0, 0.4, 1.0];

let HK = null;
let worldId = null;

let engine = null;
let asset = null;
const pieces = [];      // { entity, bodyId, curPos, curRot }
const staticBoxes = []; // ground + walls, for the debug overlay

let debugCanvas = null, debugGl = null, debugProg = null, debugVbo = null, showWireframe = true;
let unitCubeLines = null, pieceLines = null;

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

// ---- Geometry ----
// Flat per-face normals: each vertex belongs only to coplanar triangles (faces don't share
// vertices), so accumulating triangle normals and normalising yields the face normal.
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

// Faceted shogi-piece prism (positions + uv0 + flat normals). UVs follow the glTF top-left
// convention the atlas was authored for, so gltfio maps the kanji onto the faces with no flip.
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

// ---- In-code GLB assembly ----
// Generic builder: meshGeos (each carrying a `material` index), materials, nodes (each referencing a
// mesh by index), and embedded images (each { bytes, mimeType }). Materials' baseColorTexture index
// refers into the images array. Produces a single self-contained GLB (JSON + embedded BIN).
function alignTo4(n) { return (n + 3) & ~3; }

function buildGlb(meshGeos, materials, nodes, images) {
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

  const meshes = meshGeos.map((g) => {
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
    return { primitives: [{ attributes: { POSITION: posAcc, NORMAL: nrmAcc, TEXCOORD_0: uvAcc }, indices: idxAcc, material: g.material }] };
  });

  const textureBlocks = {};
  if (images && images.length) {
    const imgs = [], texs = [];
    images.forEach((im, i) => {
      const bv = addBufferView(im.bytes, undefined);
      imgs.push({ bufferView: bv, mimeType: im.mimeType });
      texs.push({ sampler: 0, source: i });
    });
    textureBlocks.images = imgs;
    textureBlocks.samplers = [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }];
    textureBlocks.textures = texs;
  }

  const gltf = {
    asset: { version: '2.0', generator: 'filament-havok-shogi' },
    scene: 0,
    scenes: [{ nodes: nodes.map((_, i) => i) }],
    nodes, meshes, materials, accessors, bufferViews,
    ...textureBlocks,
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
  dv.setUint32(p, 0x46546C67, true); p += 4; // 'glTF'
  dv.setUint32(p, 2, true); p += 4;
  dv.setUint32(p, totalLen, true); p += 4;
  dv.setUint32(p, jsonBytes.length, true); p += 4;
  dv.setUint32(p, 0x4E4F534A, true); p += 4; // 'JSON'
  glb.set(jsonBytes, p); p += jsonBytes.length;
  dv.setUint32(p, binBuf.length, true); p += 4;
  dv.setUint32(p, 0x004E4942, true); p += 4; // 'BIN\0'
  glb.set(binBuf, p);
  return glb;
}

// Piece mesh/material (0, shogi texture) + grass ground slab (1). Piece nodes are named "piece<i>"
// so they can be matched to Havok bodies; physics drives their orientation, so node rotation is left
// at identity.
function buildSceneGlb(pieceSpecs, pieceGeo, shogiImage, grassImage) {
  pieceGeo.material = 0;
  const groundGeo = buildQuadGeometry(GROUND.size[0] / 2, GROUND.size[2] / 2, GROUND.pos[1] + GROUND.size[1] / 2, GROUND_TILES);
  groundGeo.material = 1;

  const materials = [
    {
      name: 'piece',
      pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0.0, roughnessFactor: PIECE_ROUGHNESS },
      doubleSided: true,
    },
    {
      name: 'ground',
      pbrMetallicRoughness: { baseColorTexture: { index: 1 }, metallicFactor: 0.0, roughnessFactor: 0.9 },
      doubleSided: true,
    },
  ];

  const nodes = pieceSpecs.map((s, i) => ({ name: 'piece' + i, mesh: 0, translation: s.position }));
  nodes.push({ name: 'ground', mesh: 1 });

  return buildGlb([pieceGeo, groundGeo], materials, nodes, [shogiImage, grassImage]);
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
  staticBoxes.push({ size, pos });
}

// Convex-hull collider from the piece's own mesh vertices (a shogi piece is convex). Dynamic bodies
// need a convex shape in Havok, so a hull — not a triangle mesh — is used. Falls back to a box.
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

function addPieceBody(shapeId, entity, pos, rot) {
  const cb = HK.HP_Body_Create();
  const bodyId = cb[1];
  HK.HP_Body_SetShape(bodyId, shapeId);
  HK.HP_Body_SetMotionType(bodyId, HK.MotionType.DYNAMIC);
  const mp = HK.HP_Shape_BuildMassProperties(shapeId);
  HK.HP_Body_SetMassProperties(bodyId, mp[1]);
  HK.HP_Body_SetPosition(bodyId, pos);
  HK.HP_Body_SetOrientation(bodyId, rot);
  HK.HP_World_AddBody(worldId, bodyId, false);
  pieces.push({ entity, bodyId, curPos: pos.slice(), curRot: rot.slice() });
}

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
    p.curPos[0] = pos[0]; p.curPos[1] = pos[1]; p.curPos[2] = pos[2];
    p.curRot[0] = r[0]; p.curRot[1] = r[1]; p.curRot[2] = r[2]; p.curRot[3] = r[3];
    if (!p.entity) continue;
    const m = mat4.fromRotationTranslation(
      mat4.create(), quat.fromValues(r[0], r[1], r[2], r[3]), vec3.fromValues(pos[0], pos[1], pos[2]));
    const inst = tcm.getInstance(p.entity);
    tcm.setTransform(inst, m);
    inst.delete();
  }
  tcm.commitLocalTransformTransaction();
}

// ---- Debug wireframe overlay ----
function makeBoxLineVerts(sx, sy, sz) {
  const hx = sx / 2, hy = sy / 2, hz = sz / 2;
  const c = [[-hx, -hy, -hz], [hx, -hy, -hz], [hx, hy, -hz], [-hx, hy, -hz], [-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]];
  const edges = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
  const v = [];
  for (const [a, b] of edges) v.push(...c[a], ...c[b]);
  return new Float32Array(v);
}

// Triangle-edge line list from the piece geometry — a faithful outline of the convex-hull collider.
function makePieceLineVerts(geo) {
  const pos = geo.positions, idx = geo.indices, v = [];
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
    v.push(pos[a], pos[a + 1], pos[a + 2], pos[b], pos[b + 1], pos[b + 2]);
    v.push(pos[b], pos[b + 1], pos[b + 2], pos[c], pos[c + 1], pos[c + 2]);
    v.push(pos[c], pos[c + 1], pos[c + 2], pos[a], pos[a + 1], pos[a + 2]);
  }
  return new Float32Array(v);
}

function initDebugCanvas(mainCanvas) {
  debugCanvas = document.createElement('canvas');
  debugCanvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none';
  debugCanvas.width = mainCanvas.width;
  debugCanvas.height = mainCanvas.height;
  mainCanvas.parentElement.appendChild(debugCanvas);
  const gl = debugGl = debugCanvas.getContext('webgl2');
  if (!gl) { console.warn('[debug] WebGL2 unavailable for wireframe overlay'); return; }
  const vs = gl.createShader(gl.VERTEX_SHADER);
  gl.shaderSource(vs, '#version 300 es\nin vec3 aPos; uniform mat4 uMVP;\nvoid main(){gl_Position=uMVP*vec4(aPos,1.0);}');
  gl.compileShader(vs);
  const fs = gl.createShader(gl.FRAGMENT_SHADER);
  gl.shaderSource(fs, '#version 300 es\nprecision mediump float; uniform vec4 uColor; out vec4 o;\nvoid main(){o=uColor;}');
  gl.compileShader(fs);
  debugProg = gl.createProgram();
  gl.attachShader(debugProg, vs); gl.attachShader(debugProg, fs);
  gl.linkProgram(debugProg);
  gl.deleteShader(vs); gl.deleteShader(fs);
  if (!gl.getProgramParameter(debugProg, gl.LINK_STATUS)) {
    console.warn('[debug] shader link error:', gl.getProgramInfoLog(debugProg));
    debugProg = null; return;
  }
  debugVbo = gl.createBuffer();
  unitCubeLines = makeBoxLineVerts(1, 1, 1);
}

function drawDebug(eye, center, up, aspect) {
  if (!debugGl || !debugProg) return;
  const gl = debugGl;
  gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  if (!showWireframe || !HK || !worldId) return;
  gl.enable(gl.DEPTH_TEST);
  gl.useProgram(debugProg);
  const aPos = gl.getAttribLocation(debugProg, 'aPos');
  const uMVP = gl.getUniformLocation(debugProg, 'uMVP');
  const uColor = gl.getUniformLocation(debugProg, 'uColor');
  const viewM = mat4.lookAt(mat4.create(), eye, center, up);
  const projM = mat4.perspective(mat4.create(), 75 * Math.PI / 180, aspect, 0.01, 10000.0);
  const vp = mat4.multiply(mat4.create(), projM, viewM);
  gl.bindBuffer(gl.ARRAY_BUFFER, debugVbo);
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);

  const model = mat4.create(), mvp = mat4.create(), sq = quat.create(), sp = vec3.create(), ss = vec3.create();
  function drawScaled(p, r, scale) {
    quat.set(sq, r[0], r[1], r[2], r[3]);
    vec3.set(sp, p[0], p[1], p[2]);
    vec3.set(ss, scale[0], scale[1], scale[2]);
    mat4.fromRotationTranslationScale(model, sq, sp, ss);
    mat4.multiply(mvp, vp, model);
    gl.uniformMatrix4fv(uMVP, false, mvp);
  }

  // Ground + walls (static, green)
  gl.uniform4fv(uColor, DEBUG_COLOR_STATIC);
  gl.bufferData(gl.ARRAY_BUFFER, unitCubeLines, gl.DYNAMIC_DRAW);
  const cubeCount = unitCubeLines.length / 3;
  for (const sb of staticBoxes) {
    drawScaled(sb.pos, IDENTITY_QUATERNION, sb.size);
    gl.drawArrays(gl.LINES, 0, cubeCount);
  }

  // Pieces (orange convex-hull / mesh outline at the body transform)
  if (pieceLines) {
    gl.uniform4fv(uColor, DEBUG_COLOR_DYNAMIC);
    gl.bufferData(gl.ARRAY_BUFFER, pieceLines, gl.DYNAMIC_DRAW);
    const pieceCount = pieceLines.length / 3;
    const one = [1, 1, 1];
    for (const p of pieces) {
      drawScaled(p.curPos, p.curRot, one);
      gl.drawArrays(gl.LINES, 0, pieceCount);
    }
  }
  gl.disableVertexAttribArray(aPos);
}

// ---- W-key wireframe toggle ----
function setWireframeVisible(visible) {
  showWireframe = visible;
  const hint = document.getElementById('hint');
  if (hint) hint.textContent = 'W: wireframe ' + (visible ? 'ON' : 'OFF');
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
  const canvas = document.getElementsByTagName('canvas')[0];
  engine = Filament.Engine.create(canvas);
  const scene = engine.createScene();

  // IBL for lighting + reflections; no skybox, so the background stays the dark clear colour.
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
  // Explicit LINEAR color grading; the default path trips a "uniform buffer too small" GL error
  // at feature level 1.
  const colorGrading = Filament.ColorGrading.Builder().toneMapping(ToneMapping.LINEAR).build(engine);
  view.setColorGrading(colorGrading);
  renderer.setClearOptions({ clearColor: [0.13, 0.14, 0.16, 1.0], clear: true });

  initDebugCanvas(canvas);

  // Physics world + static ground / walls (walls are wireframe-only).
  HK = await HavokPhysics();
  const w = HK.HP_World_Create();
  worldId = w[1];
  checkResult(HK.HP_World_SetGravity(worldId, [0, -10, 0]), 'HP_World_SetGravity');
  checkResult(HK.HP_World_SetIdealStepTime(worldId, FIXED_TIMESTEP), 'HP_World_SetIdealStepTime');
  createStaticBox(GROUND.size, GROUND.pos);
  for (const wd of WALLS) createStaticBox(wd.size, wd.pos);

  // Assign a spawn point to each piece, then build & load the GLB (pieces + ground).
  const pieceSpecs = [];
  for (let i = 0; i < PIECE_COUNT; i++) pieceSpecs.push({ position: randomDrop() });

  const pieceGeo = createShogiGeometry(PIECE_W, PIECE_H, PIECE_D);
  pieceLines = makePieceLineVerts(pieceGeo);

  const shogiImage = { bytes: await fetchBytes(SHOGI_URL), mimeType: 'image/png' };
  const grassImage = { bytes: await fetchBytes(GRASS_URL), mimeType: 'image/jpeg' };

  const glb = buildSceneGlb(pieceSpecs, pieceGeo, shogiImage, grassImage);
  const assetLoader = engine.createAssetLoader();
  asset = assetLoader.createAsset(glb);
  await new Promise((resolve) => {
    asset.loadResources(() => {
      assetLoader.delete();
      const rm = engine.getRenderableManager();
      for (const e of asset.getEntities()) {
        const inst = rm.getInstance(e);
        if (inst) { rm.setCastShadows(inst, true); rm.setReceiveShadows(inst, true); inst.delete(); }
      }
      resolve();
    }, () => {}, '');
  });

  // One shared convex-hull collider; match each piece node to its Filament entity and create its body.
  const pieceShape = createPieceShape(pieceGeo.positions);
  for (let i = 0; i < pieceSpecs.length; i++) {
    const named = asset.getEntitiesByName('piece' + i);
    const entity = named.length > 0 ? named[0] : null;
    if (entity) {
      const rm = engine.getRenderableManager();
      const inst = rm.getInstance(entity);
      if (inst) { rm.setCulling(inst, false); inst.delete(); }
    }
    addPieceBody(pieceShape, entity, pieceSpecs[i].position, randomQuat());
  }
  console.log('[Filament+Havok] pieces ready:', pieces.length);

  const center = [0, 2, 0];
  const orbitDist = 30;
  const orbitHeight = 18;

  let aspect = 1;
  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.width = Math.floor(window.innerWidth * dpr);
    const height = canvas.height = Math.floor(window.innerHeight * dpr);
    if (debugCanvas) { debugCanvas.width = width; debugCanvas.height = height; }
    aspect = width / height;
    view.setViewport([0, 0, width, height]);
    const fovAxis = aspect < 1 ? Fov.HORIZONTAL : Fov.VERTICAL;
    camera.setProjectionFov(75, aspect, 0.1, 1000.0, fovAxis);
  }
  window.addEventListener('resize', resize);
  resize();

  setWireframeVisible(showWireframe);

  let angle = 0.5;
  function render() {
    requestAnimationFrame(render);

    if (asset) {
      let e = asset.popRenderable();
      while (e.getId() !== 0) { scene.addEntity(e); e = asset.popRenderable(); }
    }

    if (HK && worldId) {
      try { stepAndSync(); } catch (e) { console.error('[physics] error:', e); HK = null; }
    }

    angle += 0.004;
    const eye = [center[0] + Math.sin(angle) * orbitDist, orbitHeight, center[2] + Math.cos(angle) * orbitDist];
    const up = [0, 1, 0];
    camera.lookAt(eye, center, up);

    renderer.render(swapChain, view);
    drawDebug(eye, center, up, aspect);
  }
  requestAnimationFrame(render);
}
