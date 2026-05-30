// Filament + Havok — "Falling Marbles" sample (using glTF, no glTF Physics extension).
//
// Loads the IridescenceMetallicSpheres glTF with Google Filament and drops every sphere into a
// hand-built Havok scene: a ground box and four low walls. Each glTF sphere gets a dynamic Havok
// sphere body; bodies that fall out respawn above the box.
//
// Collider wireframes are loaded as a second gltfio asset built in-code (LINES primitives with
// KHR_materials_unlit), so they render in the same Filament pass as the marbles — no second canvas,
// no compositor stutter. Press W to toggle the wireframes in / out of the scene.
//
// NOTE: this is the iridescence parameter-sweep model (~340 spheres, each with its own
// KHR_materials_iridescence material), so it is GPU-heavy by nature.

const GLTF_URL = 'https://cx20.github.io/gltf-test/tutorialModels/IridescenceMetallicSpheres/glTF/IridescenceMetallicSpheres.gltf';
const IBL_URL = 'https://cx20.github.io/gltf-test/textures/ktx/papermill/papermill_ibl.ktx';
const SKY_URL = 'https://cx20.github.io/gltf-test/textures/ktx/papermill/papermill_skybox.ktx';

const FIXED_TIMESTEP = 1 / 60;
const RESET_Y_THRESHOLD = -10;
const IDENTITY_QUATERNION = [0, 0, 0, 1];
const WIREFRAME_OUTSET = 1.005;

const COLOR_DYNAMIC = [1.0, 0.5, 0.2, 1.0];
const COLOR_STATIC = [0.2, 1.0, 0.4, 1.0];

const GROUND = { size: [40, 4, 40], pos: [0, -2, 0] };
const WALLS = [
  { size: [10, 10, 1], pos: [0, 5, -5] },
  { size: [10, 10, 1], pos: [0, 5, 5] },
  { size: [1, 10, 10], pos: [-5, 5, 0] },
  { size: [1, 10, 10], pos: [5, 5, 0] },
];

let HK = null;
let worldId = null;

let engine = null;
let scene = null;
let asset = null;
let showWireframe = true;

const marbles = [];                  // { entity, wireframeEntity, bodyId, nodeScale, parentInvWorldMat, radius }
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

function buildWorldTransforms(gltfJson) {
  const nodes = gltfJson.nodes || [];
  const worldMats = nodes.map(() => mat4.create());
  const roots = (gltfJson.scenes || [])[gltfJson.scene || 0]?.nodes || [];
  function compute(i, parentMat) {
    const n = nodes[i];
    const local = mat4.create();
    if (n.matrix) {
      mat4.set(local, ...n.matrix);
    } else {
      const t = n.translation || [0, 0, 0], r = n.rotation || [0, 0, 0, 1], s = n.scale || [1, 1, 1];
      mat4.fromRotationTranslationScale(local, quat.fromValues(r[0], r[1], r[2], r[3]), vec3.fromValues(t[0], t[1], t[2]), vec3.fromValues(s[0], s[1], s[2]));
    }
    mat4.multiply(worldMats[i], parentMat, local);
    for (const c of (n.children || [])) compute(c, worldMats[i]);
  }
  for (const r of roots) compute(r, mat4.create());
  return worldMats;
}

function buildNodeEntityMap(gltfJson, filamentAsset, filamentEngine) {
  const all = filamentAsset.getEntities();
  const rootId = filamentAsset.getRoot().getId();
  const candidates = all.filter(e => e.getId() !== rootId);
  const tcm = filamentEngine.getTransformManager();
  const nodes = gltfJson.nodes || [];
  const map = new Map();
  const probes = candidates.map(e => {
    const inst = tcm.getInstance(e);
    const lm = tcm.getTransform(inst);
    inst.delete();
    return { entity: e, t: [lm[12], lm[13], lm[14]] };
  });
  const used = new Set();
  for (let ni = 0; ni < nodes.length; ni++) {
    const t = nodes[ni].translation || [0, 0, 0];
    let best = -1, bestDist = Infinity;
    for (let i = 0; i < probes.length; i++) {
      if (used.has(i)) continue;
      const dx = probes[i].t[0] - t[0], dy = probes[i].t[1] - t[1], dz = probes[i].t[2] - t[2];
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bestDist) { bestDist = d; best = i; }
    }
    if (best >= 0 && bestDist < 0.01) { map.set(ni, probes[best].entity); used.add(best); }
  }
  return map;
}

function createStaticBox(size, pos) {
  const s = HK.HP_Shape_CreateBox([0, 0, 0], IDENTITY_QUATERNION, size);
  const b = HK.HP_Body_Create();
  const bodyId = b[1];
  HK.HP_Body_SetShape(bodyId, s[1]);
  HK.HP_Body_SetMotionType(bodyId, HK.MotionType.STATIC);
  HK.HP_Body_SetPosition(bodyId, pos);
  HK.HP_Body_SetOrientation(bodyId, IDENTITY_QUATERNION);
  HK.HP_World_AddBody(worldId, bodyId, false);
}

function randomDrop() {
  return [(Math.random() - 0.5) * 8, 15 + Math.random() * 20, (Math.random() - 0.5) * 8];
}

async function initMarbles(meshUrl, filamentAsset, filamentEngine) {
  const gltfJson = JSON.parse(await (await fetch(meshUrl)).text());
  const nodes = gltfJson.nodes || [];
  const accessors = gltfJson.accessors || [];
  const meshesDef = gltfJson.meshes || [];
  const worldMats = buildWorldTransforms(gltfJson);
  const parentMap = new Map();
  for (let i = 0; i < nodes.length; i++) for (const c of (nodes[i].children || [])) parentMap.set(c, i);
  const nodeEntityMap = buildNodeEntityMap(gltfJson, filamentAsset, filamentEngine);

  const w = HK.HP_World_Create();
  worldId = w[1];
  checkResult(HK.HP_World_SetGravity(worldId, [0, -10, 0]), 'HP_World_SetGravity');
  checkResult(HK.HP_World_SetIdealStepTime(worldId, FIXED_TIMESTEP), 'HP_World_SetIdealStepTime');

  createStaticBox(GROUND.size, GROUND.pos);
  for (const wd of WALLS) createStaticBox(wd.size, wd.pos);

  function geomRadiusFor(meshIndex) {
    const prim = meshesDef[meshIndex]?.primitives?.[0];
    const acc = prim && accessors[prim.attributes.POSITION];
    if (!acc || !acc.min || !acc.max) return 1;
    let r = 0;
    for (let k = 0; k < 3; k++) r = Math.max(r, Math.abs(acc.min[k]), Math.abs(acc.max[k]));
    return r || 1;
  }

  for (let i = 0; i < nodes.length; i++) {
    const name = nodes[i].name || '';
    if (!name.includes('Sphere') || nodes[i].mesh === undefined) continue;

    const worldScale = vec3.create();
    mat4.getScaling(worldScale, worldMats[i]);
    const radius = Math.max(geomRadiusFor(nodes[i].mesh) * worldScale[0], 0.1);

    const drop = randomDrop();
    const ss = HK.HP_Shape_CreateSphere([0, 0, 0], radius);
    const mp = HK.HP_Shape_BuildMassProperties(ss[1]);
    const b = HK.HP_Body_Create();
    const bodyId = b[1];
    HK.HP_Body_SetShape(bodyId, ss[1]);
    HK.HP_Body_SetMotionType(bodyId, HK.MotionType.DYNAMIC);
    HK.HP_Body_SetMassProperties(bodyId, mp[1]);
    HK.HP_Body_SetPosition(bodyId, drop);
    HK.HP_Body_SetOrientation(bodyId, IDENTITY_QUATERNION);
    HK.HP_World_AddBody(worldId, bodyId, false);

    const parentInvWorldMat = mat4.create();
    const pIdx = parentMap.get(i);
    if (pIdx !== undefined) mat4.invert(parentInvWorldMat, worldMats[pIdx]);
    const named = filamentAsset.getEntitiesByName(name);
    const entity = named.length > 0 ? named[0] : (nodeEntityMap.get(i) || null);
    if (entity) {
      const rm = filamentEngine.getRenderableManager();
      const inst = rm.getInstance(entity);
      if (inst) { rm.setCulling(inst, false); inst.delete(); }
    }
    marbles.push({ entity, wireframeEntity: null, bodyId, nodeScale: [worldScale[0], worldScale[1], worldScale[2]], parentInvWorldMat, radius });
  }
  console.log('[Filament+Havok] marbles ready:', marbles.length);
}

// ---- In-code wireframe GLB ----
function alignTo4(n) { return (n + 3) & ~3; }
const LINE_BOX_INDICES = new Uint32Array([
  0, 1, 1, 2, 2, 3, 3, 0,
  4, 5, 5, 6, 6, 7, 7, 4,
  0, 4, 1, 5, 2, 6, 3, 7,
]);
function buildLineBoxPositions(hx, hy, hz, cx = 0, cy = 0, cz = 0) {
  return new Float32Array([
    cx - hx, cy - hy, cz - hz,  cx + hx, cy - hy, cz - hz,  cx + hx, cy + hy, cz - hz,  cx - hx, cy + hy, cz - hz,
    cx - hx, cy - hy, cz + hz,  cx + hx, cy - hy, cz + hz,  cx + hx, cy + hy, cz + hz,  cx - hx, cy + hy, cz + hz,
  ]);
}
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
  return { positions: positionArr, indices };
}

// `meshes`: array of { positions, indices, color }; `nodes`: array of { name, meshIndex }.
function buildWireframeGlb(meshes, nodes) {
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
  const gltfMeshes = [], gltfMaterials = [];
  for (const m of meshes) {
    const posBV = addBufferView(m.positions, 34962);
    const posAcc = accessors.length;
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < m.positions.length; i += 3) {
      const x = m.positions[i], y = m.positions[i + 1], z = m.positions[i + 2];
      if (x < minX) minX = x; if (y < minY) minY = y; if (z < minZ) minZ = z;
      if (x > maxX) maxX = x; if (y > maxY) maxY = y; if (z > maxZ) maxZ = z;
    }
    accessors.push({ bufferView: posBV, componentType: 5126, count: m.positions.length / 3, type: 'VEC3', min: [minX, minY, minZ], max: [maxX, maxY, maxZ] });
    const idxBV = addBufferView(m.indices, 34963);
    const idxAcc = accessors.length;
    accessors.push({ bufferView: idxBV, componentType: 5125, count: m.indices.length, type: 'SCALAR' });
    gltfMaterials.push({ extensions: { KHR_materials_unlit: {} }, pbrMetallicRoughness: { baseColorFactor: m.color } });
    gltfMeshes.push({ primitives: [{ mode: 1, attributes: { POSITION: posAcc }, indices: idxAcc, material: gltfMaterials.length - 1 }] });
  }
  const gltfNodes = nodes.map((n) => ({ name: n.name, mesh: n.meshIndex }));
  const gltf = {
    asset: { version: '2.0', generator: 'filament-havok-wireframe' },
    extensionsUsed: ['KHR_materials_unlit'],
    scene: 0,
    scenes: [{ nodes: gltfNodes.map((_, i) => i) }],
    nodes: gltfNodes, meshes: gltfMeshes, materials: gltfMaterials, accessors, bufferViews,
    buffers: [{ byteLength: binOffset }],
  };
  let jsonBytes = new TextEncoder().encode(JSON.stringify(gltf));
  const jsonPad = alignTo4(jsonBytes.length) - jsonBytes.length;
  if (jsonPad) { const t = new Uint8Array(jsonBytes.length + jsonPad); t.set(jsonBytes); t.fill(0x20, jsonBytes.length); jsonBytes = t; }
  const binBuf = new Uint8Array(alignTo4(binOffset));
  let o = 0; for (const ch of binChunks) { binBuf.set(ch, o); o += ch.byteLength; }
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

async function loadWireframeAsset() {
  // One shared unit-sphere mesh, scaled per marble in stepAndSync; one box mesh per static
  // (size + position baked).
  const sphereGeo = buildLineSphere(WIREFRAME_OUTSET);
  const meshes = [{ positions: sphereGeo.positions, indices: sphereGeo.indices, color: COLOR_DYNAMIC }];
  const staticDefs = [{ size: GROUND.size, pos: GROUND.pos }, ...WALLS];
  for (const d of staticDefs) {
    const hx = d.size[0] / 2 * WIREFRAME_OUTSET, hy = d.size[1] / 2 * WIREFRAME_OUTSET, hz = d.size[2] / 2 * WIREFRAME_OUTSET;
    meshes.push({ positions: buildLineBoxPositions(hx, hy, hz, d.pos[0], d.pos[1], d.pos[2]), indices: LINE_BOX_INDICES.slice(), color: COLOR_STATIC });
  }
  const nodes = [];
  marbles.forEach((_, i) => nodes.push({ name: 'marbleWire' + i, meshIndex: 0 }));
  staticDefs.forEach((_, i) => nodes.push({ name: 'staticWire' + i, meshIndex: 1 + i }));

  const glb = buildWireframeGlb(meshes, nodes);
  const loader = engine.createAssetLoader();
  const a = loader.createAsset(glb);
  await new Promise((resolve) => {
    a.loadResources(() => {
      loader.delete();
      let e = a.popRenderable();
      while (e.getId() !== 0) { scene.addEntity(e); e = a.popRenderable(); }
      const rm = engine.getRenderableManager();
      for (const ent of a.getEntities()) {
        const inst = rm.getInstance(ent);
        if (inst) { rm.setCulling(inst, false); inst.delete(); }
      }
      resolve();
    }, () => {}, '');
  });
  for (let i = 0; i < marbles.length; i++) marbles[i].wireframeEntity = a.getEntitiesByName('marbleWire' + i)[0] || null;
  for (let i = 0; i < staticDefs.length; i++) {
    const ent = a.getEntitiesByName('staticWire' + i)[0];
    if (ent) staticWireframeEntities.push(ent);
  }
  return a;
}

let tmpMat = null, tmpQuat = null, tmpVec = null, tmpScale = null;

function physicsStep() {
  if (!HK || !worldId) return;
  checkResult(HK.HP_World_Step(worldId, FIXED_TIMESTEP), 'HP_World_Step');

  const tcm = engine.getTransformManager();
  tcm.openLocalTransformTransaction();
  for (const m of marbles) {
    let pr = HK.HP_Body_GetPosition(m.bodyId);
    if (pr[1][1] < RESET_Y_THRESHOLD) {
      const drop = randomDrop();
      HK.HP_Body_SetPosition(m.bodyId, drop);
      HK.HP_Body_SetLinearVelocity(m.bodyId, [0, 0, 0]);
      HK.HP_Body_SetAngularVelocity(m.bodyId, [0, 0, 0]);
      pr = HK.HP_Body_GetPosition(m.bodyId);
    }
    const qr = HK.HP_Body_GetOrientation(m.bodyId);
    const p = pr[1], r = qr[1];
    quat.set(tmpQuat, r[0], r[1], r[2], r[3]);
    vec3.set(tmpVec, p[0], p[1], p[2]);
    // Visual entity: world-space transform reparented under the original glTF parent (since the
    // visual is a child of some glTF node, we apply parentInv * worldFromBody).
    if (m.entity) {
      vec3.set(tmpScale, m.nodeScale[0], m.nodeScale[1], m.nodeScale[2]);
      mat4.fromRotationTranslationScale(tmpMat, tmpQuat, tmpVec, tmpScale);
      const localMat = mat4.multiply(mat4.create(), m.parentInvWorldMat, tmpMat);
      const inst = tcm.getInstance(m.entity);
      tcm.setTransform(inst, localMat);
      inst.delete();
    }
    // Wireframe entity: lives at the root, so the unscaled (or radius-scaled) body transform goes
    // straight in.
    if (m.wireframeEntity) {
      vec3.set(tmpScale, m.radius, m.radius, m.radius);
      mat4.fromRotationTranslationScale(tmpMat, tmpQuat, tmpVec, tmpScale);
      const inst = tcm.getInstance(m.wireframeEntity);
      tcm.setTransform(inst, tmpMat);
      inst.delete();
    }
  }
  tcm.commitLocalTransformTransaction();
}

// ---- W-key wireframe toggle ----
function setWireframeVisible(visible) {
  showWireframe = visible;
  const hint = document.getElementById('hint');
  if (hint) hint.textContent = 'W: wireframe ' + (visible ? 'ON' : 'OFF');
  if (!scene) return;
  for (const m of marbles) {
    if (!m.wireframeEntity) continue;
    if (visible) scene.addEntity(m.wireframeEntity); else scene.remove(m.wireframeEntity);
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

// ---- Filament app ----
Filament.init([IBL_URL, SKY_URL], () => {
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
  tmpScale = vec3.create();

  const canvas = document.getElementsByTagName('canvas')[0];
  engine = Filament.Engine.create(canvas);
  scene = engine.createScene();

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
  view.setColorGrading(Filament.ColorGrading.Builder().toneMapping(ToneMapping.LINEAR).build(engine));
  renderer.setClearOptions({ clearColor: [0.13, 0.13, 0.13, 1.0], clear: true });

  // Load the marbles model (.gltf with an external .bin, resolved against its folder).
  const bytes = new Uint8Array(await (await fetch(GLTF_URL)).arrayBuffer());
  const basePath = GLTF_URL.substring(0, GLTF_URL.lastIndexOf('/') + 1);
  const assetLoader = engine.createAssetLoader();
  asset = assetLoader.createAsset(bytes);
  await new Promise((resolve) => {
    asset.loadResources(() => {
      assetLoader.delete();
      const rm = engine.getRenderableManager();
      for (const e of asset.getEntities()) {
        const inst = rm.getInstance(e);
        if (inst) { rm.setCastShadows(inst, true); inst.delete(); }
      }
      resolve();
    }, () => {}, basePath);
  });

  HK = await HavokPhysics();
  await initMarbles(GLTF_URL, asset, engine);

  // Only the marble spheres are shown; the model's annotation meshes (the "Thin Film Thickness"
  // scale bar, axis line, and backing planes) are kept out of the scene. Pop them all once here so
  // the render loop doesn't have to.
  const marbleIds = new Set();
  for (const m of marbles) if (m.entity) marbleIds.add(m.entity.getId());
  if (asset) {
    let e = asset.popRenderable();
    while (e.getId() !== 0) {
      if (marbleIds.has(e.getId())) scene.addEntity(e);
      e = asset.popRenderable();
    }
  }

  await loadWireframeAsset();

  const camTarget = [0, 3, 0];
  let camTheta  = 0.4;   // azimuth (rad)
  let camPhi    = 0.46;   // elevation (rad)
  let camRadius = 29.1;

  let aspect = 1;
  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.width = Math.floor(window.innerWidth * dpr);
    const height = canvas.height = Math.floor(window.innerHeight * dpr);
    aspect = width / height;
    view.setViewport([0, 0, width, height]);
    const fovAxis = aspect < 1 ? Fov.HORIZONTAL : Fov.VERTICAL;
    camera.setProjectionFov(75, aspect, 0.1, 2000.0, fovAxis);
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
    try { physicsStep(); } catch (e) { console.error('[physics] step error:', e); HK = null; }
    const ex = camTarget[0] + camRadius * Math.cos(camPhi) * Math.sin(camTheta);
    const ey = camTarget[1] + camRadius * Math.sin(camPhi);
    const ez = camTarget[2] + camRadius * Math.cos(camPhi) * Math.cos(camTheta);
    camera.lookAt([ex, ey, ez], camTarget, [0, 1, 0]);
    renderer.render(swapChain, view);
  }
  requestAnimationFrame(render);
}
