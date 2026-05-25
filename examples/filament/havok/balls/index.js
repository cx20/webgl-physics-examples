// Filament + Havok — Falling Balls sample (PBR).
//
// Many balls of five kinds (basketball, beach ball, football, softball, tennis ball) — each with its
// own texture, size and restitution (bounciness) — drop into a walled box, simulated by Havok and
// rendered by Filament with lit, physically-based materials.
//
// There is no lit .filamat we can load, so the balls are emitted as an in-code glTF (GLB): one
// textured metallic-roughness sphere mesh per kind (the ball texture as baseColorTexture, plus
// per-kind roughness) referenced by N nodes, loaded through Filament's gltfio. The papermill IBL
// and a directional sun light the scene, so the balls are shaded instead of looking flat. Each ball
// node is matched to a Havok sphere body and synced every frame.
//
// Collider wireframes are drawn on a separate transparent WebGL2 canvas overlaid with the same
// camera (Filament can't easily draw lines); the four walls are shown only as wireframes. Press W to
// toggle them.
//
// Libraries are loaded as globals via <script> tags: Filament, HavokPhysics, gl-matrix
// (vec3 / quat / mat4).

const IBL_URL = 'https://cx20.github.io/gltf-test/textures/ktx/papermill/papermill_ibl.ktx';
const GRASS_URL = '../../../../assets/textures/grass.jpg';

// All non-metal; rubber/felt/vinyl surfaces are rough (matte) so they don't read as shiny/metallic.
const dataSet = [
  { imageFile: '../../../../assets/textures/Basketball.jpg', scale: 1.0, restitution: 0.6,  roughness: 0.95 },
  { imageFile: '../../../../assets/textures/BeachBall.jpg',  scale: 0.9, restitution: 0.7,  roughness: 0.85 },
  { imageFile: '../../../../assets/textures/Football.jpg',   scale: 1.0, restitution: 0.55, roughness: 0.8 },
  { imageFile: '../../../../assets/textures/Softball.jpg',   scale: 0.3, restitution: 0.4,  roughness: 0.9 },
  { imageFile: '../../../../assets/textures/TennisBall.jpg', scale: 0.3, restitution: 0.75, roughness: 1.0 },
];
const BALL_COUNT = 200;
const SPHERE_SEGMENTS = 24;
const SPHERE_RINGS = 16;

const FIXED_TIMESTEP = 1 / 60;
const IDENTITY_QUATERNION = [0, 0, 0, 1];
const RESET_Y_THRESHOLD = -10;
const GROUND = { size: [20, 2, 20], pos: [0, -2, 0] };
const GROUND_TILES = 8;
const WALLS = [
  { size: [5, 5, 0.5], pos: [0, 1.5, -2.5] },
  { size: [5, 5, 0.5], pos: [0, 1.5, 2.5] },
  { size: [0.5, 5, 5], pos: [-2.5, 1.5, 0] },
  { size: [0.5, 5, 5], pos: [2.5, 1.5, 0] },
];

const DEBUG_COLOR_DYNAMIC = [1.0, 0.5, 0.2, 1.0];
const DEBUG_COLOR_STATIC = [0.2, 1.0, 0.4, 1.0];

let HK = null;
let worldId = null;

let engine = null;
let asset = null;
const balls = [];       // { entity, bodyId, radius, curPos, curRot }
const staticBoxes = []; // ground + walls, for the debug overlay

let debugCanvas = null, debugGl = null, debugProg = null, debugVbo = null, showWireframe = true;
let unitCubeLines = null, unitSphereLines = null;

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
// UV-sphere of the given radius. Normals = unit position (needed for lighting); UVs match the
// original sample so the equirectangular ball textures map the same way.
function buildSphereGeometry(radius, segments, rings) {
  const positions = [], normals = [], uvs = [], indices = [];
  for (let y = 0; y <= rings; y++) {
    const v = y / rings, theta = v * Math.PI, st = Math.sin(theta), ct = Math.cos(theta);
    for (let x = 0; x <= segments; x++) {
      const u = x / segments, phi = u * 2 * Math.PI;
      const nx = st * Math.cos(phi), ny = ct, nz = st * Math.sin(phi);
      positions.push(nx * radius, ny * radius, nz * radius);
      normals.push(nx, ny, nz);
      uvs.push(u, v);
    }
  }
  for (let y = 0; y < rings; y++) {
    for (let x = 0; x < segments; x++) {
      const a = y * (segments + 1) + x, b = a + segments + 1;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    indices: new Uint32Array(indices),
    min: [-radius, -radius, -radius],
    max: [radius, radius, radius],
  };
}

function buildQuadGeometry(halfX, halfZ, y, tiles) {
  return {
    positions: new Float32Array([-halfX, y, -halfZ, halfX, y, -halfZ, halfX, y, halfZ, -halfX, y, halfZ]),
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

  // Embedded textures (JPEG/PNG bytes in bufferViews) shared by one REPEAT sampler.
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
    asset: { version: '2.0', generator: 'filament-havok-balls' },
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

// One textured sphere mesh/material per ball kind (mesh/material 0..N-1) + a grass ground slab
// (mesh/material N). Ball nodes are named "ball<i>" so they can be matched to Havok bodies.
function buildSceneGlb(ballSpecs, ballImages, grassImage) {
  const meshGeos = dataSet.map((d, ti) => {
    const g = buildSphereGeometry(d.scale * 0.5, SPHERE_SEGMENTS, SPHERE_RINGS);
    g.material = ti;
    return g;
  });
  const groundIndex = dataSet.length;
  const groundGeo = buildQuadGeometry(GROUND.size[0] / 2, GROUND.size[2] / 2, GROUND.pos[1] + GROUND.size[1] / 2, GROUND_TILES);
  groundGeo.material = groundIndex;
  meshGeos.push(groundGeo);

  const materials = dataSet.map((d, ti) => ({
    name: 'ball' + ti,
    pbrMetallicRoughness: {
      baseColorTexture: { index: ti },
      metallicFactor: 0.0,
      roughnessFactor: d.roughness,
    },
  }));
  materials.push({
    name: 'ground',
    pbrMetallicRoughness: { baseColorTexture: { index: groundIndex }, metallicFactor: 0.0, roughnessFactor: 0.9 },
    doubleSided: true,
  });

  const nodes = ballSpecs.map((b, i) => ({ name: 'ball' + i, mesh: b.typeIndex, translation: b.position }));
  nodes.push({ name: 'ground', mesh: groundIndex });

  const images = ballImages.concat([grassImage]);
  return buildGlb(meshGeos, materials, nodes, images);
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

function createBallShape(typeIndex) {
  const d = dataSet[typeIndex];
  const s = HK.HP_Shape_CreateSphere([0, 0, 0], d.scale * 0.5);
  if (typeof HK.HP_Shape_SetMaterial === 'function') {
    HK.HP_Shape_SetMaterial(s[1], [0.5, 0.5, d.restitution, HK.MaterialCombine.MAXIMUM, HK.MaterialCombine.MAXIMUM]);
  }
  return s[1];
}

function addBallBody(shapeId, typeIndex, entity, pos) {
  const cb = HK.HP_Body_Create();
  const bodyId = cb[1];
  HK.HP_Body_SetShape(bodyId, shapeId);
  HK.HP_Body_SetMotionType(bodyId, HK.MotionType.DYNAMIC);
  const mp = HK.HP_Shape_BuildMassProperties(shapeId);
  HK.HP_Body_SetMassProperties(bodyId, mp[1]);
  HK.HP_Body_SetPosition(bodyId, pos);
  HK.HP_Body_SetOrientation(bodyId, IDENTITY_QUATERNION);
  HK.HP_World_AddBody(worldId, bodyId, false);
  balls.push({ entity, bodyId, radius: dataSet[typeIndex].scale * 0.5, curPos: pos.slice(), curRot: [0, 0, 0, 1] });
}

function randomDrop(yBase, ySpread) {
  return [-5 + Math.random() * 10, yBase + Math.random() * ySpread, -5 + Math.random() * 10];
}

function stepAndSync() {
  checkResult(HK.HP_World_Step(worldId, FIXED_TIMESTEP), 'HP_World_Step');
  const tcm = engine.getTransformManager();
  tcm.openLocalTransformTransaction();
  for (const b of balls) {
    let p = HK.HP_Body_GetPosition(b.bodyId)[1];
    if (p[1] < RESET_Y_THRESHOLD) {
      HK.HP_Body_SetPosition(b.bodyId, randomDrop(10, 8));
      HK.HP_Body_SetLinearVelocity(b.bodyId, [0, 0, 0]);
      HK.HP_Body_SetAngularVelocity(b.bodyId, [0, 0, 0]);
      p = HK.HP_Body_GetPosition(b.bodyId)[1];
    }
    const r = HK.HP_Body_GetOrientation(b.bodyId)[1];
    b.curPos[0] = p[0]; b.curPos[1] = p[1]; b.curPos[2] = p[2];
    b.curRot[0] = r[0]; b.curRot[1] = r[1]; b.curRot[2] = r[2]; b.curRot[3] = r[3];
    if (!b.entity) continue;
    const m = mat4.fromRotationTranslation(
      mat4.create(), quat.fromValues(r[0], r[1], r[2], r[3]), vec3.fromValues(p[0], p[1], p[2]));
    const inst = tcm.getInstance(b.entity);
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

function makeSphereLineVerts(radius, segments = 12) {
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
  unitSphereLines = makeSphereLineVerts(1);
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

  // Balls (orange spheres)
  gl.uniform4fv(uColor, DEBUG_COLOR_DYNAMIC);
  gl.bufferData(gl.ARRAY_BUFFER, unitSphereLines, gl.DYNAMIC_DRAW);
  const sphCount = unitSphereLines.length / 3;
  const s = [0, 0, 0];
  for (const b of balls) {
    s[0] = s[1] = s[2] = b.radius;
    drawScaled(b.curPos, b.curRot, s);
    gl.drawArrays(gl.LINES, 0, sphCount);
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

  // Assign a kind + spawn point to each ball, then build & load the GLB (balls + ground).
  const ballSpecs = [];
  for (let i = 0; i < BALL_COUNT; i++) {
    ballSpecs.push({ typeIndex: Math.floor(Math.random() * dataSet.length), position: randomDrop(6, 13) });
  }
  const ballShapes = dataSet.map((_, ti) => createBallShape(ti));

  const ballImages = [];
  for (const d of dataSet) ballImages.push({ bytes: await fetchBytes(d.imageFile), mimeType: 'image/jpeg' });
  const grassImage = { bytes: await fetchBytes(GRASS_URL), mimeType: 'image/jpeg' };

  const glb = buildSceneGlb(ballSpecs, ballImages, grassImage);
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

  // Match each ball node to its Filament entity and create its Havok body.
  for (let i = 0; i < ballSpecs.length; i++) {
    const spec = ballSpecs[i];
    const named = asset.getEntitiesByName('ball' + i);
    const entity = named.length > 0 ? named[0] : null;
    if (entity) {
      const rm = engine.getRenderableManager();
      const inst = rm.getInstance(entity);
      if (inst) { rm.setCulling(inst, false); inst.delete(); }
    }
    addBallBody(ballShapes[spec.typeIndex], spec.typeIndex, entity, spec.position);
  }
  console.log('[Filament+Havok] balls ready:', balls.length);

  const center = [0, 0, 0];
  const orbitDist = 18;
  const orbitHeight = 10;

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
