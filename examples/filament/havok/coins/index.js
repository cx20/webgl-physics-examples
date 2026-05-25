// Filament + Havok — Falling Coins sample (PBR).
//
// Gold / silver / copper coins pour down like a waterfall, simulated by Havok and rendered by Google
// Filament with real physically-based metals. There is no PBR .filamat we can load, so the scene is
// emitted as an in-code glTF (GLB): three metallic-roughness cylinder meshes (one per metal, sharing
// a normal map for the minted relief) plus a flat ground slab, referenced by N coin nodes. The GLB
// is loaded through Filament's gltfio, whose ubershader provides the metallic-roughness PBR (and
// computes tangents from the meshes' UVs + normals); the papermill IBL supplies the reflections that
// make the metals read. Each coin is simulated as a Havok sphere (so it rolls and cascades) and the
// matching node is synced every frame; coins that settle or fall off the edge recycle to the top to
// keep the stream flowing.
//
// Collider wireframes are drawn on a separate transparent WebGL2 canvas overlaid with the same
// camera (Filament can't easily draw lines). Press W to toggle them.
//
// Libraries are loaded as globals via <script> tags: Filament, HavokPhysics, gl-matrix
// (vec3 / quat / mat4).

const IBL_URL = 'https://cx20.github.io/gltf-test/textures/ktx/papermill/papermill_ibl.ktx';
const SKY_URL = 'https://cx20.github.io/gltf-test/textures/ktx/papermill/papermill_skybox.ktx';
const NORMAL_URL = '../../../../assets/textures/rockn.png';

// sRGB hex base colours from the three.js sample. metallic=1 so baseColor is the metal's tint.
const COIN_TYPES = [
  { name: 'gold',   colorHex: 0xffc356, diameter: 1.0, height: 0.10,  metalness: 1.0, roughness: 0.20 },
  { name: 'silver', colorHex: 0xf8f5ea, diameter: 0.8, height: 0.075, metalness: 1.0, roughness: 0.40 },
  { name: 'copper', colorHex: 0xf3a28a, diameter: 0.6, height: 0.05,  metalness: 1.0, roughness: 0.20 },
];

const COIN_COUNT = 500;
const COIN_SEGMENTS = 32;       // radial segments of each cylinder
const DROP_HALF = 3.0;          // horizontal spread of the spawn column
const SPAWN_Y_MIN = 24;         // recycled coins re-enter at the top of this band
const SPAWN_Y_MAX = 32;
const COLUMN_Y_MIN = 2;         // initial fill spans the whole column for an instant waterfall
const COLUMN_Y_MAX = 32;

const FIXED_TIMESTEP = 1 / 60;
const IDENTITY_QUATERNION = [0, 0, 0, 1];
const RESET_Y_THRESHOLD = -8;   // fell off the ground edge -> recycle to the top
// A coin that has come to rest near the ground is lifted back to the top so the stream never stops.
const SETTLE_Y = 3.0;
const SETTLE_MOVE_SQ = 0.0025;  // squared per-frame movement below which a coin counts as "still"
const SETTLE_FRAMES = 18;
const GROUND = { size: [24, 2, 24], pos: [0, -1, 0] };  // top surface at y = 0

const DEBUG_COLOR_DYNAMIC = [1.0, 0.5, 0.2, 1.0];
const DEBUG_COLOR_STATIC = [0.2, 1.0, 0.4, 1.0];

let HK = null;
let worldId = null;

let engine = null;
let asset = null;
const coins = [];       // { entity, bodyId, typeIndex, curPos, curRot, restFrames }
const staticBoxes = []; // ground, for the debug overlay

let debugCanvas = null, debugGl = null, debugProg = null, debugVbo = null, showWireframe = true;
let unitCubeLines = null;
const coinLinesByType = [];  // sphere outline verts, per coin type

// ---- Colour helper ----
function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function hexToLinear(hex) {
  return [
    srgbToLinear(((hex >> 16) & 0xff) / 255),
    srgbToLinear(((hex >> 8) & 0xff) / 255),
    srgbToLinear((hex & 0xff) / 255),
  ];
}

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
// Y-aligned cylinder of the given radius and half-height. Caps get their own flat-shaded vertices.
function buildCylinderGeometry(radius, halfHeight, segments) {
  const positions = [], normals = [], uvs = [], indices = [];

  // Side: seam-duplicated ring of top/bottom pairs so the rim UV runs cleanly 0..1.
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const cx = Math.cos(a), sz = Math.sin(a), u = i / segments;
    positions.push(radius * cx, halfHeight, radius * sz); normals.push(cx, 0, sz); uvs.push(u, 0);
    positions.push(radius * cx, -halfHeight, radius * sz); normals.push(cx, 0, sz); uvs.push(u, 1);
  }
  for (let i = 0; i < segments; i++) {
    const t0 = i * 2, b0 = i * 2 + 1, t1 = (i + 1) * 2, b1 = (i + 1) * 2 + 1;
    indices.push(t0, b0, b1, t0, b1, t1);
  }

  // Top cap (fan around a centre vertex; planar radial UV maps the relief onto the face).
  const topCenter = positions.length / 3;
  positions.push(0, halfHeight, 0); normals.push(0, 1, 0); uvs.push(0.5, 0.5);
  const topRing = positions.length / 3;
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    positions.push(radius * Math.cos(a), halfHeight, radius * Math.sin(a)); normals.push(0, 1, 0);
    uvs.push(0.5 + 0.5 * Math.cos(a), 0.5 + 0.5 * Math.sin(a));
  }
  for (let i = 0; i < segments; i++) indices.push(topCenter, topRing + i, topRing + ((i + 1) % segments));

  // Bottom cap (reversed winding).
  const botCenter = positions.length / 3;
  positions.push(0, -halfHeight, 0); normals.push(0, -1, 0); uvs.push(0.5, 0.5);
  const botRing = positions.length / 3;
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    positions.push(radius * Math.cos(a), -halfHeight, radius * Math.sin(a)); normals.push(0, -1, 0);
    uvs.push(0.5 + 0.5 * Math.cos(a), 0.5 + 0.5 * Math.sin(a));
  }
  for (let i = 0; i < segments; i++) indices.push(botCenter, botRing + ((i + 1) % segments), botRing + i);

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    indices: new Uint32Array(indices),
    min: [-radius, -halfHeight, -radius],
    max: [radius, halfHeight, radius],
  };
}

function buildQuadGeometry(halfX, halfZ, y) {
  return {
    positions: new Float32Array([-halfX, y, -halfZ, halfX, y, -halfZ, halfX, y, halfZ, -halfX, y, halfZ]),
    normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]),
    uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    min: [-halfX, y, -halfZ],
    max: [halfX, y, halfZ],
  };
}

// ---- In-code GLB assembly ----
// Generic builder: meshGeos (each carrying a `material` index), materials, and nodes (each
// referencing a mesh by index). Produces a single self-contained GLB (JSON + embedded BIN).
function alignTo4(n) { return (n + 3) & ~3; }

function buildGlb(meshGeos, materials, nodes, imageBytes) {
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

  // Embedded shared normal map (PNG bytes in a bufferView), if supplied.
  const textureBlocks = {};
  if (imageBytes) {
    const imgBV = addBufferView(imageBytes, undefined);
    textureBlocks.images = [{ bufferView: imgBV, mimeType: 'image/png' }];
    textureBlocks.samplers = [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }];
    textureBlocks.textures = [{ sampler: 0, source: 0 }];
  }

  const gltf = {
    asset: { version: '2.0', generator: 'filament-havok-coins' },
    scene: 0,
    scenes: [{ nodes: nodes.map((_, i) => i) }],
    nodes, meshes, materials, accessors, bufferViews,
    ...textureBlocks,
    buffers: [{ byteLength: binOffset }],
  };

  // JSON chunk (4-byte padded with spaces).
  let jsonBytes = new TextEncoder().encode(JSON.stringify(gltf));
  const jsonPad = alignTo4(jsonBytes.length) - jsonBytes.length;
  if (jsonPad) {
    const t = new Uint8Array(jsonBytes.length + jsonPad);
    t.set(jsonBytes); t.fill(0x20, jsonBytes.length);
    jsonBytes = t;
  }

  // BIN chunk (4-byte padded with zeros).
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

// Coins (mesh/material 0..2) + a flat ground slab (mesh/material 3). Coin nodes are named
// "coin<i>" so they can be matched to Havok bodies after load.
function buildSceneGlb(coinSpecs, normalImageBytes) {
  const meshGeos = COIN_TYPES.map((t, ti) => {
    const g = buildCylinderGeometry(t.diameter * 0.5, t.height * 0.5, COIN_SEGMENTS);
    g.material = ti;
    return g;
  });
  const groundMatIndex = COIN_TYPES.length;
  const groundMeshIndex = COIN_TYPES.length;
  const groundGeo = buildQuadGeometry(GROUND.size[0] / 2, GROUND.size[2] / 2, GROUND.pos[1] + GROUND.size[1] / 2);
  groundGeo.material = groundMatIndex;
  meshGeos.push(groundGeo);

  const materials = COIN_TYPES.map((t) => {
    const lin = hexToLinear(t.colorHex);
    const mat = {
      name: t.name,
      pbrMetallicRoughness: {
        baseColorFactor: [lin[0], lin[1], lin[2], 1.0],
        metallicFactor: t.metalness,
        roughnessFactor: t.roughness,
      },
      doubleSided: true,
    };
    if (normalImageBytes) mat.normalTexture = { index: 0, scale: 0.6 };
    return mat;
  });
  materials.push({
    name: 'ground',
    pbrMetallicRoughness: { baseColorFactor: [0.18, 0.19, 0.21, 1.0], metallicFactor: 0.0, roughnessFactor: 0.9 },
    doubleSided: true,
  });

  const nodes = coinSpecs.map((c, i) => ({ name: 'coin' + i, mesh: c.typeIndex, translation: c.position }));
  nodes.push({ name: 'ground', mesh: groundMeshIndex });

  return buildGlb(meshGeos, materials, nodes, normalImageBytes);
}

// ---- Scene setup ----
function randomXZ() {
  return [-DROP_HALF + Math.random() * (2 * DROP_HALF), -DROP_HALF + Math.random() * (2 * DROP_HALF)];
}

// Spawn point at the top of the falling column (used when recycling).
function randomDropTop() {
  const [x, z] = randomXZ();
  return [x, SPAWN_Y_MIN + Math.random() * (SPAWN_Y_MAX - SPAWN_Y_MIN), z];
}

// Initial fill spread over the whole column so the waterfall is full from the first frame.
function randomDropColumn() {
  const [x, z] = randomXZ();
  return [x, COLUMN_Y_MIN + Math.random() * (COLUMN_Y_MAX - COLUMN_Y_MIN), z];
}

// Uniform random orientation so coins land at varied angles.
function randomQuat() {
  const u1 = Math.random(), u2 = Math.random(), u3 = Math.random();
  const s1 = Math.sqrt(1 - u1), s2 = Math.sqrt(u1);
  return [
    s1 * Math.sin(2 * Math.PI * u2),
    s1 * Math.cos(2 * Math.PI * u2),
    s2 * Math.sin(2 * Math.PI * u3),
    s2 * Math.cos(2 * Math.PI * u3),
  ];
}

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

// Coins collide as spheres (radius = coin radius), like the three.js sample, so they roll and
// cascade rather than stacking flat.
function createCoinShape(typeIndex) {
  const r = COIN_TYPES[typeIndex].diameter * 0.5;
  const res = HK.HP_Shape_CreateSphere([0, 0, 0], r);
  checkResult(res[0], 'HP_Shape_CreateSphere coin');
  return res[1];
}

function addCoinBody(shapeId, typeIndex, entity, pos, rot) {
  const cb = HK.HP_Body_Create();
  const bodyId = cb[1];
  HK.HP_Body_SetShape(bodyId, shapeId);
  HK.HP_Body_SetMotionType(bodyId, HK.MotionType.DYNAMIC);
  const mp = HK.HP_Shape_BuildMassProperties(shapeId);
  HK.HP_Body_SetMassProperties(bodyId, mp[1]);
  HK.HP_Body_SetPosition(bodyId, pos);
  HK.HP_Body_SetOrientation(bodyId, rot);
  HK.HP_World_AddBody(worldId, bodyId, false);
  coins.push({ entity, bodyId, typeIndex, curPos: pos.slice(), curRot: rot.slice(), restFrames: 0 });
}

function recycleCoin(c) {
  HK.HP_Body_SetPosition(c.bodyId, randomDropTop());
  HK.HP_Body_SetOrientation(c.bodyId, randomQuat());
  HK.HP_Body_SetLinearVelocity(c.bodyId, [0, 0, 0]);
  HK.HP_Body_SetAngularVelocity(c.bodyId, [0, 0, 0]);
  c.restFrames = 0;
}

function stepAndSync() {
  checkResult(HK.HP_World_Step(worldId, FIXED_TIMESTEP), 'HP_World_Step');
  const tcm = engine.getTransformManager();
  tcm.openLocalTransformTransaction();
  for (const c of coins) {
    let pos = HK.HP_Body_GetPosition(c.bodyId)[1];
    const dx = pos[0] - c.curPos[0], dy = pos[1] - c.curPos[1], dz = pos[2] - c.curPos[2];
    const still = (dx * dx + dy * dy + dz * dz) < SETTLE_MOVE_SQ;
    if (pos[1] < SETTLE_Y && still) c.restFrames++; else c.restFrames = 0;
    if (pos[1] < RESET_Y_THRESHOLD || c.restFrames > SETTLE_FRAMES) {
      recycleCoin(c);
      pos = HK.HP_Body_GetPosition(c.bodyId)[1];
    }
    const r = HK.HP_Body_GetOrientation(c.bodyId)[1];
    c.curPos[0] = pos[0]; c.curPos[1] = pos[1]; c.curPos[2] = pos[2];
    c.curRot[0] = r[0]; c.curRot[1] = r[1]; c.curRot[2] = r[2]; c.curRot[3] = r[3];
    if (!c.entity) continue;
    const m = mat4.fromRotationTranslation(
      mat4.create(), quat.fromValues(r[0], r[1], r[2], r[3]), vec3.fromValues(pos[0], pos[1], pos[2]));
    const inst = tcm.getInstance(c.entity);
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

function makeSphereLineVerts(radius, segments = 16) {
  const v = [];
  for (let c = 0; c < 3; c++) {
    for (let i = 0; i < segments; i++) {
      const a0 = (i / segments) * Math.PI * 2, a1 = ((i + 1) / segments) * Math.PI * 2;
      const c0 = Math.cos(a0) * radius, s0 = Math.sin(a0) * radius, c1 = Math.cos(a1) * radius, s1 = Math.sin(a1) * radius;
      if (c === 0) v.push(c0, s0, 0, c1, s1, 0);
      else if (c === 1) v.push(c0, 0, s0, c1, 0, s1);
      else v.push(0, c0, s0, 0, c1, s1);
    }
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
  for (const t of COIN_TYPES) coinLinesByType.push(makeSphereLineVerts(t.diameter * 0.5));
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
  function setMVP(p, r, scale) {
    quat.set(sq, r[0], r[1], r[2], r[3]);
    vec3.set(sp, p[0], p[1], p[2]);
    vec3.set(ss, scale[0], scale[1], scale[2]);
    mat4.fromRotationTranslationScale(model, sq, sp, ss);
    mat4.multiply(mvp, vp, model);
    gl.uniformMatrix4fv(uMVP, false, mvp);
  }

  // Ground (static, green).
  gl.uniform4fv(uColor, DEBUG_COLOR_STATIC);
  gl.bufferData(gl.ARRAY_BUFFER, unitCubeLines, gl.DYNAMIC_DRAW);
  const cubeCount = unitCubeLines.length / 3;
  for (const sb of staticBoxes) {
    setMVP(sb.pos, IDENTITY_QUATERNION, sb.size);
    gl.drawArrays(gl.LINES, 0, cubeCount);
  }

  // Coins (orange sphere outlines at the body position), grouped by type.
  gl.uniform4fv(uColor, DEBUG_COLOR_DYNAMIC);
  const one = [1, 1, 1];
  for (let ti = 0; ti < COIN_TYPES.length; ti++) {
    const lines = coinLinesByType[ti];
    if (!lines) continue;
    gl.bufferData(gl.ARRAY_BUFFER, lines, gl.DYNAMIC_DRAW);
    const count = lines.length / 3;
    for (const c of coins) {
      if (c.typeIndex !== ti) continue;
      setMVP(c.curPos, IDENTITY_QUATERNION, one);
      gl.drawArrays(gl.LINES, 0, count);
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

// ---- Filament app ----
Filament.init([IBL_URL, SKY_URL], () => {
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

  const ibl = engine.createIblFromKtx1(IBL_URL);
  ibl.setIntensity(50000);
  scene.setIndirectLight(ibl);
  scene.setSkybox(engine.createSkyFromKtx1(SKY_URL));

  const sun = Filament.EntityManager.get().create();
  Filament.LightManager.Builder(LightType.SUN)
    .color([0.98, 0.92, 0.89])
    .intensity(50000.0)
    .direction([0.6, -1.0, -0.8])
    .sunAngularRadius(1.9)
    .sunHaloSize(10.0)
    .sunHaloFalloff(80.0)
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

  // Physics world + static ground.
  HK = await HavokPhysics();
  const w = HK.HP_World_Create();
  worldId = w[1];
  checkResult(HK.HP_World_SetGravity(worldId, [0, -9.8, 0]), 'HP_World_SetGravity');
  checkResult(HK.HP_World_SetIdealStepTime(worldId, FIXED_TIMESTEP), 'HP_World_SetIdealStepTime');
  createStaticBox(GROUND.size, GROUND.pos);

  // Assign a coin type + spawn point to each coin, then build & load the GLB (coins + ground).
  const coinSpecs = [];
  for (let i = 0; i < COIN_COUNT; i++) {
    coinSpecs.push({ typeIndex: Math.floor(Math.random() * COIN_TYPES.length), position: randomDropColumn() });
  }
  const coinShapes = COIN_TYPES.map((_, ti) => createCoinShape(ti));

  const normalBytes = new Uint8Array(await (await fetch(NORMAL_URL)).arrayBuffer());
  const glb = buildSceneGlb(coinSpecs, normalBytes);
  const assetLoader = engine.createAssetLoader();
  asset = assetLoader.createAsset(glb);
  await new Promise((resolve) => {
    asset.loadResources(() => {
      assetLoader.delete();
      const rm = engine.getRenderableManager();
      for (const e of asset.getEntities()) {
        const inst = rm.getInstance(e);
        if (inst) { rm.setCastShadows(inst, true); inst.delete(); }
      }
      resolve();
    }, () => {}, '');
  });

  // Match each coin node to its Filament entity and create its Havok body.
  for (let i = 0; i < coinSpecs.length; i++) {
    const spec = coinSpecs[i];
    const named = asset.getEntitiesByName('coin' + i);
    const entity = named.length > 0 ? named[0] : null;
    if (entity) {
      const rm = engine.getRenderableManager();
      const inst = rm.getInstance(entity);
      if (inst) { rm.setCulling(inst, false); inst.delete(); }
    }
    addCoinBody(coinShapes[spec.typeIndex], spec.typeIndex, entity, spec.position, randomQuat());
  }
  console.log('[Filament+Havok] coins ready:', coins.length);

  const center = [0, 6, 0];
  const orbitDist = 32;
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
