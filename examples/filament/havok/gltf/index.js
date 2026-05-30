// Filament + Havok — "Falling glTF" sample (no glTF Physics extension).
//
// Loads the classic Duck glTF with Google Filament and drives it with a hand-built Havok scene:
// a static ground box and a dynamic box collider sized to the duck. The duck tumbles as it falls;
// click anywhere to bounce it back up.
//
// Collider wireframes are loaded as a second gltfio asset built in-code (LINES primitives with
// KHR_materials_unlit), so they render in the same Filament pass as the duck — no second canvas,
// no compositor stutter. Press W to toggle the wireframes in / out of the scene.
//
// Libraries are loaded as globals via <script> tags: Filament, HavokPhysics, gl-matrix
// (vec3 / quat / mat4).

const DUCK_URL = 'https://rawcdn.githack.com/cx20/gltf-test/5465cc37/sampleModels/Duck/glTF/Duck.gltf';
const IBL_URL = 'https://cx20.github.io/gltf-test/textures/ktx/papermill/papermill_ibl.ktx';
const SKY_URL = 'https://cx20.github.io/gltf-test/textures/ktx/papermill/papermill_skybox.ktx';

const FIXED_TIMESTEP = 1 / 60;
const IDENTITY_QUATERNION = [0, 0, 0, 1];

const cubeSizeX = 5;
const cubeSizeY = 5;
const cubeSizeZ = 9 / 16 * 5;
const DUCK_SCALE = 5;
const GROUND_SIZE = [800, 8, 800];
const GROUND_POS = [0, -5, 0];
const WIREFRAME_OUTSET = 1.005;

const COLOR_DYNAMIC = [1.0, 0.5, 0.2, 1.0]; // orange = duck collider
const COLOR_STATIC = [0.2, 1.0, 0.4, 1.0];  // green  = ground

let HK = null;
let worldId = null;
let duckBodyId = null;

let engine = null;
let scene = null;
let asset = null;             // duck asset
let wireAsset = null;         // wireframe asset
let duckWireframeEntity = null;
let groundWireframeEntity = null;
let showWireframe = true;

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

function createStaticBox(size, pos) {
  const s = HK.HP_Shape_CreateBox([0, 0, 0], IDENTITY_QUATERNION, size);
  checkResult(s[0], 'HP_Shape_CreateBox static');
  const b = HK.HP_Body_Create();
  const bodyId = b[1];
  HK.HP_Body_SetShape(bodyId, s[1]);
  HK.HP_Body_SetMotionType(bodyId, HK.MotionType.STATIC);
  HK.HP_Body_SetPosition(bodyId, pos);
  HK.HP_Body_SetOrientation(bodyId, IDENTITY_QUATERNION);
  HK.HP_World_AddBody(worldId, bodyId, false);
  return bodyId;
}

function initPhysics() {
  const w = HK.HP_World_Create();
  worldId = w[1];
  checkResult(HK.HP_World_SetGravity(worldId, [0, -9.8, 0]), 'HP_World_SetGravity');
  checkResult(HK.HP_World_SetIdealStepTime(worldId, FIXED_TIMESTEP), 'HP_World_SetIdealStepTime');

  createStaticBox(GROUND_SIZE, GROUND_POS);

  const size = [cubeSizeX * 2, cubeSizeY * 2, cubeSizeZ * 2];
  const ds = HK.HP_Shape_CreateBox([0, 0, 0], IDENTITY_QUATERNION, size);
  const db = HK.HP_Body_Create();
  duckBodyId = db[1];
  HK.HP_Body_SetShape(duckBodyId, ds[1]);
  HK.HP_Body_SetMotionType(duckBodyId, HK.MotionType.DYNAMIC);
  const mp = HK.HP_Shape_BuildMassProperties(ds[1]);
  HK.HP_Body_SetMassProperties(duckBodyId, mp[1]);
  HK.HP_Body_SetPosition(duckBodyId, [0, 20, 0]);
  HK.HP_Body_SetOrientation(duckBodyId, IDENTITY_QUATERNION);
  HK.HP_Body_SetAngularVelocity(duckBodyId, [0, 0, 3.5]);
  HK.HP_World_AddBody(worldId, duckBodyId, false);
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

// Build an in-code GLB containing N LINES wireframes, each with its own POSITION + indices
// accessors, sharing N materials (one per `color`). Each node is named so the caller can find its
// entity after gltfio loads the asset.
function buildWireframeGlb(specs) {
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
  const meshes = [];
  const materials = [];
  const nodes = [];
  for (const spec of specs) {
    const posBV = addBufferView(spec.positions, 34962);
    const posAcc = accessors.length;
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < spec.positions.length; i += 3) {
      const x = spec.positions[i], y = spec.positions[i + 1], z = spec.positions[i + 2];
      if (x < minX) minX = x; if (y < minY) minY = y; if (z < minZ) minZ = z;
      if (x > maxX) maxX = x; if (y > maxY) maxY = y; if (z > maxZ) maxZ = z;
    }
    accessors.push({ bufferView: posBV, componentType: 5126, count: spec.positions.length / 3, type: 'VEC3', min: [minX, minY, minZ], max: [maxX, maxY, maxZ] });
    const idxBV = addBufferView(spec.indices, 34963);
    const idxAcc = accessors.length;
    accessors.push({ bufferView: idxBV, componentType: 5125, count: spec.indices.length, type: 'SCALAR' });
    materials.push({ name: spec.name + 'Mat', extensions: { KHR_materials_unlit: {} }, pbrMetallicRoughness: { baseColorFactor: spec.color } });
    meshes.push({ primitives: [{ mode: 1, attributes: { POSITION: posAcc }, indices: idxAcc, material: materials.length - 1 }] });
    nodes.push({ name: spec.name, mesh: meshes.length - 1 });
  }
  const gltf = {
    asset: { version: '2.0', generator: 'filament-havok-wireframe' },
    extensionsUsed: ['KHR_materials_unlit'],
    scene: 0,
    scenes: [{ nodes: nodes.map((_, i) => i) }],
    nodes, meshes, materials, accessors, bufferViews,
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
  const dhx = cubeSizeX * WIREFRAME_OUTSET, dhy = cubeSizeY * WIREFRAME_OUTSET, dhz = cubeSizeZ * WIREFRAME_OUTSET;
  const ghx = GROUND_SIZE[0] / 2 * WIREFRAME_OUTSET, ghy = GROUND_SIZE[1] / 2 * WIREFRAME_OUTSET, ghz = GROUND_SIZE[2] / 2 * WIREFRAME_OUTSET;
  const specs = [
    { name: 'duckWire',   positions: buildLineBoxPositions(dhx, dhy, dhz),                                       indices: LINE_BOX_INDICES.slice(), color: COLOR_DYNAMIC },
    { name: 'groundWire', positions: buildLineBoxPositions(ghx, ghy, ghz, GROUND_POS[0], GROUND_POS[1], GROUND_POS[2]), indices: LINE_BOX_INDICES.slice(), color: COLOR_STATIC },
  ];
  const glb = buildWireframeGlb(specs);
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
  duckWireframeEntity = a.getEntitiesByName('duckWire')[0] || null;
  groundWireframeEntity = a.getEntitiesByName('groundWire')[0] || null;
  return a;
}

// ---- W-key wireframe toggle ----
function setWireframeVisible(visible) {
  showWireframe = visible;
  const hint = document.getElementById('hint');
  if (hint) hint.textContent = 'W: wireframe ' + (visible ? 'ON' : 'OFF');
  if (!scene) return;
  for (const ent of [duckWireframeEntity, groundWireframeEntity]) {
    if (!ent) continue;
    if (visible) scene.addEntity(ent); else scene.remove(ent);
  }
}

window.addEventListener('keydown', (event) => {
  if (event.repeat) return;
  if (event.code === 'KeyW' || event.key === 'w' || event.key === 'W') {
    setWireframeVisible(!showWireframe);
  }
});

document.addEventListener('click', () => {
  if (duckBodyId !== null && HK && worldId) {
    HK.HP_Body_SetLinearVelocity(duckBodyId, [0, 5, 0]);
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

let tmpMat = null, tmpQuat = null, tmpVec = null;

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
  renderer.setClearOptions({ clearColor: [0.6, 0.6, 0.6, 1.0], clear: true });

  // Load the Duck (.gltf with external .bin + texture, resolved against its folder).
  const bytes = new Uint8Array(await (await fetch(DUCK_URL)).arrayBuffer());
  const basePath = DUCK_URL.substring(0, DUCK_URL.lastIndexOf('/') + 1);
  const assetLoader = engine.createAssetLoader();
  asset = assetLoader.createAsset(bytes);
  await new Promise((resolve) => {
    asset.loadResources(() => {
      assetLoader.delete();
      let e = asset.popRenderable();
      while (e.getId() !== 0) { scene.addEntity(e); e = asset.popRenderable(); }
      const rm = engine.getRenderableManager();
      for (const e of asset.getEntities()) {
        const inst = rm.getInstance(e);
        if (inst) { rm.setCastShadows(inst, true); rm.setCulling(inst, false); inst.delete(); }
      }
      resolve();
    }, () => {}, basePath);
  });

  HK = await HavokPhysics();
  initPhysics();

  // Wireframe asset (duck box + ground box, both unlit LINES).
  wireAsset = await loadWireframeAsset();

  // Camera: auto-orbit framing the duck's fall onto the ground.
  const camTarget = [0, 4, 0];
  let camTheta  = 0.4;   // azimuth (rad)
  let camPhi    = 0.30;   // elevation (rad)
  let camRadius = 27.2;

  let aspect = 1;
  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.width = Math.floor(window.innerWidth * dpr);
    const height = canvas.height = Math.floor(window.innerHeight * dpr);
    aspect = width / height;
    view.setViewport([0, 0, width, height]);
    const fovAxis = aspect < 1 ? Fov.HORIZONTAL : Fov.VERTICAL;
    camera.setProjectionFov(75, aspect, 0.1, 5000.0, fovAxis);
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

  const root = asset.getRoot();
  const tcm = engine.getTransformManager();
  const offsetLocal = vec3.fromValues(0, -cubeSizeY, 0);

  function render(now) {
    requestAnimationFrame(render);

    if (HK && worldId) {
      checkResult(HK.HP_World_Step(worldId, FIXED_TIMESTEP), 'HP_World_Step');
      const pr = HK.HP_Body_GetPosition(duckBodyId);
      const qr = HK.HP_Body_GetOrientation(duckBodyId);
      const p = pr[1], q = qr[1];
      const rot = quat.fromValues(q[0], q[1], q[2], q[3]);
      // Duck visual = body transform, scaled, shifted down so it sits centered in the collider.
      const off = vec3.transformQuat(vec3.create(), offsetLocal, rot);
      const m = mat4.fromRotationTranslationScale(
        mat4.create(), rot,
        vec3.fromValues(p[0] + off[0], p[1] + off[1], p[2] + off[2]),
        vec3.fromValues(DUCK_SCALE, DUCK_SCALE, DUCK_SCALE),
      );
      const rootInst = tcm.getInstance(root);
      tcm.setTransform(rootInst, m);
      rootInst.delete();
      // Duck wireframe = body transform directly (positions are baked at collider half-extents).
      if (duckWireframeEntity) {
        quat.set(tmpQuat, q[0], q[1], q[2], q[3]);
        vec3.set(tmpVec, p[0], p[1], p[2]);
        mat4.fromRotationTranslation(tmpMat, tmpQuat, tmpVec);
        const inst = tcm.getInstance(duckWireframeEntity);
        tcm.setTransform(inst, tmpMat);
        inst.delete();
      }
    }

    const ex = camTarget[0] + camRadius * Math.cos(camPhi) * Math.sin(camTheta);
    const ey = camTarget[1] + camRadius * Math.sin(camPhi);
    const ez = camTarget[2] + camRadius * Math.cos(camPhi) * Math.cos(camTheta);
    camera.lookAt([ex, ey, ez], camTarget, [0, 1, 0]);

    renderer.render(swapChain, view);
  }
  requestAnimationFrame(render);
}
