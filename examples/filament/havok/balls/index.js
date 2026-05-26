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
// Collider wireframes are baked into the same GLB as LINES primitives with KHR_materials_unlit
// (orange = balls, green = ground + walls), so they render in the same Filament pass — no second
// canvas. Press W to toggle the wireframe entities in / out of the scene.
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
const WIREFRAME_OUTSET = 1.005; // slight outset so lines don't z-fight with textured surfaces

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

const COLOR_DYNAMIC = [1.0, 0.5, 0.2, 1.0]; // orange = ball colliders
const COLOR_STATIC = [0.2, 1.0, 0.4, 1.0];  // green  = ground + walls

let HK = null;
let worldId = null;

let engine = null;
let scene = null;
let asset = null;
let showWireframe = true;
const balls = [];                    // { entity, wireframeEntity, bodyId, radius }
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

// ---- Geometry (LINES wireframes) ----
// 12 edges of an axis-aligned box, as line-segment index pairs over the 8 corners.
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
    positions,
    indices: LINE_BOX_INDICES,
    min: [cx - hx, cy - hy, cz - hz],
    max: [cx + hx, cy + hy, cz + hz],
  };
}

// Three great circles (XY / XZ / YZ planes), each `segments` line segments.
function buildLineSphere(radius, segments = 16) {
  const positions = [];
  for (let plane = 0; plane < 3; plane++) {
    for (let i = 0; i < segments; i++) {
      const a0 = (i / segments) * Math.PI * 2, a1 = ((i + 1) / segments) * Math.PI * 2;
      const c0 = Math.cos(a0) * radius, s0 = Math.sin(a0) * radius;
      const c1 = Math.cos(a1) * radius, s1 = Math.sin(a1) * radius;
      if (plane === 0)      positions.push(c0, s0, 0, c1, s1, 0);
      else if (plane === 1) positions.push(c0, 0, s0, c1, 0, s1);
      else                  positions.push(0, c0, s0, 0, c1, s1);
    }
  }
  const positionArr = new Float32Array(positions);
  const indices = new Uint32Array(positionArr.length / 3);
  for (let i = 0; i < indices.length; i++) indices[i] = i;
  return {
    positions: positionArr,
    indices,
    min: [-radius, -radius, -radius],
    max: [radius, radius, radius],
  };
}

// ---- In-code GLB assembly ----
function alignTo4(n) { return (n + 3) & ~3; }

// Builds the full scene GLB: textured ball meshes + ground + LINES wireframes, all sharing one
// embedded sampler. Triangle meshes carry POSITION + NORMAL + TEXCOORD_0; LINES meshes carry only
// POSITION (the wireframes are unlit, no UVs needed).
function buildSceneGlb(ballSpecs, ballImages, grassImage) {
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

  // ---- PBR ball meshes (one per type) ----
  const ballMeshIndexByType = dataSet.map((d, ti) => {
    const accs = addTriMesh(buildSphereGeometry(d.scale * 0.5, SPHERE_SEGMENTS, SPHERE_RINGS));
    materials.push({
      name: 'ball' + ti,
      pbrMetallicRoughness: { baseColorTexture: { index: ti }, metallicFactor: 0.0, roughnessFactor: d.roughness },
    });
    meshes.push({ primitives: [{ attributes: { POSITION: accs.POSITION, NORMAL: accs.NORMAL, TEXCOORD_0: accs.TEXCOORD_0 }, indices: accs.indices, material: materials.length - 1 }] });
    return meshes.length - 1;
  });

  // ---- Ground PBR ----
  const groundAccs = addTriMesh(buildQuadGeometry(GROUND.size[0] / 2, GROUND.size[2] / 2, GROUND.pos[1] + GROUND.size[1] / 2, GROUND_TILES));
  materials.push({
    name: 'ground',
    pbrMetallicRoughness: { baseColorTexture: { index: dataSet.length }, metallicFactor: 0.0, roughnessFactor: 0.9 },
    doubleSided: true,
  });
  meshes.push({ primitives: [{ attributes: { POSITION: groundAccs.POSITION, NORMAL: groundAccs.NORMAL, TEXCOORD_0: groundAccs.TEXCOORD_0 }, indices: groundAccs.indices, material: materials.length - 1 }] });
  const groundMeshIndex = meshes.length - 1;

  // ---- Unlit wireframe materials (shared by all wireframe meshes) ----
  const ballWireMatIndex = materials.length;
  materials.push({ name: 'ballWireframe', extensions: { KHR_materials_unlit: {} }, pbrMetallicRoughness: { baseColorFactor: COLOR_DYNAMIC } });
  const staticWireMatIndex = materials.length;
  materials.push({ name: 'staticWireframe', extensions: { KHR_materials_unlit: {} }, pbrMetallicRoughness: { baseColorFactor: COLOR_STATIC } });

  // ---- LINES ball wireframe meshes (one per type, radius baked) ----
  const ballWireMeshIndexByType = dataSet.map((d) => {
    const accs = addLineMesh(buildLineSphere(d.scale * 0.5 * WIREFRAME_OUTSET));
    meshes.push({ primitives: [{ mode: 1, attributes: { POSITION: accs.POSITION }, indices: accs.indices, material: ballWireMatIndex }] });
    return meshes.length - 1;
  });

  // ---- LINES static wireframes (ground + walls, size + position baked) ----
  const staticDefs = [{ size: GROUND.size, pos: GROUND.pos }, ...WALLS];
  const staticWireMeshIndices = staticDefs.map((d) => {
    const hx = d.size[0] / 2 * WIREFRAME_OUTSET, hy = d.size[1] / 2 * WIREFRAME_OUTSET, hz = d.size[2] / 2 * WIREFRAME_OUTSET;
    const accs = addLineMesh(buildLineBox(hx, hy, hz, d.pos[0], d.pos[1], d.pos[2]));
    meshes.push({ primitives: [{ mode: 1, attributes: { POSITION: accs.POSITION }, indices: accs.indices, material: staticWireMatIndex }] });
    return meshes.length - 1;
  });

  // ---- Nodes ----
  const nodes = [];
  ballSpecs.forEach((b, i) => nodes.push({ name: 'ball' + i, mesh: ballMeshIndexByType[b.typeIndex], translation: b.position }));
  nodes.push({ name: 'ground', mesh: groundMeshIndex });
  ballSpecs.forEach((b, i) => nodes.push({ name: 'ballWireframe' + i, mesh: ballWireMeshIndexByType[b.typeIndex], translation: b.position }));
  staticWireMeshIndices.forEach((mi, i) => nodes.push({ name: 'staticWireframe' + i, mesh: mi }));

  // ---- Embedded images (ball JPEGs + grass) ----
  const images = ballImages.concat([grassImage]);
  const imgs = [], texs = [];
  images.forEach((im, i) => {
    const bv = addBufferView(im.bytes, undefined);
    imgs.push({ bufferView: bv, mimeType: im.mimeType });
    texs.push({ sampler: 0, source: i });
  });

  const gltf = {
    asset: { version: '2.0', generator: 'filament-havok-balls' },
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

function createBallShape(typeIndex) {
  const d = dataSet[typeIndex];
  const s = HK.HP_Shape_CreateSphere([0, 0, 0], d.scale * 0.5);
  if (typeof HK.HP_Shape_SetMaterial === 'function') {
    HK.HP_Shape_SetMaterial(s[1], [0.5, 0.5, d.restitution, HK.MaterialCombine.MAXIMUM, HK.MaterialCombine.MAXIMUM]);
  }
  return s[1];
}

function addBallBody(shapeId, typeIndex, entity, wireframeEntity, pos) {
  const cb = HK.HP_Body_Create();
  const bodyId = cb[1];
  HK.HP_Body_SetShape(bodyId, shapeId);
  HK.HP_Body_SetMotionType(bodyId, HK.MotionType.DYNAMIC);
  const mp = HK.HP_Shape_BuildMassProperties(shapeId);
  HK.HP_Body_SetMassProperties(bodyId, mp[1]);
  HK.HP_Body_SetPosition(bodyId, pos);
  HK.HP_Body_SetOrientation(bodyId, IDENTITY_QUATERNION);
  HK.HP_World_AddBody(worldId, bodyId, false);
  balls.push({ entity, wireframeEntity, bodyId, radius: dataSet[typeIndex].scale * 0.5 });
}

function randomDrop(yBase, ySpread) {
  return [-5 + Math.random() * 10, yBase + Math.random() * ySpread, -5 + Math.random() * 10];
}

// Scratch buffers reused by stepAndSync so the per-frame transform updates don't allocate. The
// gl-matrix globals aren't ready at module-load time under every loader (and not at all in our
// Node validator), so they're filled in from main() once gl-matrix is available.
let tmpMat = null, tmpQuat = null, tmpVec = null;

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
    quat.set(tmpQuat, r[0], r[1], r[2], r[3]);
    vec3.set(tmpVec, p[0], p[1], p[2]);
    mat4.fromRotationTranslation(tmpMat, tmpQuat, tmpVec);
    if (b.entity) {
      const inst = tcm.getInstance(b.entity);
      tcm.setTransform(inst, tmpMat);
      inst.delete();
    }
    if (b.wireframeEntity) {
      const inst = tcm.getInstance(b.wireframeEntity);
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
  for (const b of balls) {
    if (!b.wireframeEntity) continue;
    if (visible) scene.addEntity(b.wireframeEntity); else scene.remove(b.wireframeEntity);
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

  // Physics world + static ground / walls (walls are wireframe-only).
  HK = await HavokPhysics();
  const w = HK.HP_World_Create();
  worldId = w[1];
  checkResult(HK.HP_World_SetGravity(worldId, [0, -10, 0]), 'HP_World_SetGravity');
  checkResult(HK.HP_World_SetIdealStepTime(worldId, FIXED_TIMESTEP), 'HP_World_SetIdealStepTime');
  createStaticBox(GROUND.size, GROUND.pos);
  for (const wd of WALLS) createStaticBox(wd.size, wd.pos);

  // Assign a kind + spawn point to each ball, then build & load the GLB (balls + ground + wires).
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

  // Match each ball node to its Filament entity + wireframe entity, then create its Havok body.
  for (let i = 0; i < ballSpecs.length; i++) {
    const spec = ballSpecs[i];
    const entity = asset.getEntitiesByName('ball' + i)[0] || null;
    const wireframeEntity = asset.getEntitiesByName('ballWireframe' + i)[0] || null;
    addBallBody(ballShapes[spec.typeIndex], spec.typeIndex, entity, wireframeEntity, spec.position);
  }
  // Static wireframes don't move, but we still want them in the toggle set.
  for (let i = 0; i < 1 + WALLS.length; i++) {
    const ent = asset.getEntitiesByName('staticWireframe' + i)[0];
    if (ent) staticWireframeEntities.push(ent);
  }
  console.log('[Filament+Havok] balls ready:', balls.length, 'static wires:', staticWireframeEntities.length);

  const center = [0, 0, 0];
  const orbitDist = 18;
  const orbitHeight = 10;

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

  setWireframeVisible(showWireframe);

  // Camera orbit driven directly by wall time (matches the raw WebGL2 sample) — pure function of
  // `now`, no accumulator drift when requestAnimationFrame's frame interval jitters.
  const ORBIT_SPEED = 0.24; // rad/s
  const ORBIT_PHASE = 0.5;
  function render(now) {
    requestAnimationFrame(render);

    if (HK && worldId) {
      try { stepAndSync(); } catch (e) { console.error('[physics] error:', e); HK = null; }
    }

    const angle = ORBIT_PHASE + now * 0.001 * ORBIT_SPEED;
    const eye = [center[0] + Math.sin(angle) * orbitDist, orbitHeight, center[2] + Math.cos(angle) * orbitDist];
    const up = [0, 1, 0];
    camera.lookAt(eye, center, up);

    renderer.render(swapChain, view);
  }
  requestAnimationFrame(render);
}
