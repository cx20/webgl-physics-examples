// Filament + Havok — Minimum sample (PBR).
//
// A textured cube falls onto a textured ground and settles, simulated by Havok and rendered by
// Filament with lit, physically-based materials. There is no lit .filamat we can load, so the scene
// is emitted as an in-code glTF (GLB): a cube mesh + a ground quad (both sharing the same JPEG as
// baseColorTexture, with hand-authored flat per-face normals so the lighting reads correctly),
// loaded through Filament's gltfio. The papermill IBL and a directional sun light the scene, so the
// cube is shaded instead of looking flat. The cube node is matched to its Havok box body and synced
// every frame.
//
// Collider wireframes are baked into the same GLB as LINES primitives with KHR_materials_unlit, so
// they render in the same Filament pass (no second canvas) — that single-canvas setup matches the
// raw WebGL2 sample and avoids the compositor stutter the previous overlay approach had. Press W to
// toggle the wireframe entities in / out of the scene.
//
// Libraries are loaded as globals via <script> tags: Filament, HavokPhysics, gl-matrix
// (vec3 / quat / mat4).

const IBL_URL = 'https://cx20.github.io/gltf-test/textures/ktx/papermill/papermill_ibl.ktx';
const TEXTURE_URL = '../../../../assets/textures/frog.jpg';

const FIXED_TIMESTEP = 1 / 60;
const IDENTITY_QUATERNION = [0, 0, 0, 1];
// Ground top surface sits at Y=0; body centre is half-height below.
// Height 0.5 prevents fast-falling cube from tunnelling through a thin slab.
const GROUND = { size: [4, 0.17, 4], pos: [0, -0.085, 0] };
const CUBE_SIZE = [1, 1, 1];
const CUBE_ROUGHNESS = 0.7;

// Unit cube geometry (24 verts so each face has its own UVs + flat normal).
const CUBE_POSITIONS = new Float32Array([
  -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5,        // Front  (+Z)
  -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, -0.5,    // Back   (-Z)
  0.5, 0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5,        // Top    (+Y)
  -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, -0.5, -0.5, -0.5, -0.5, -0.5,    // Bottom (-Y)
  0.5, -0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5, -0.5, -0.5,        // Right  (+X)
  -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5, -0.5, -0.5, -0.5, -0.5,    // Left   (-X)
]);
const CUBE_NORMALS = new Float32Array([
  0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1,        // Front
  0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1,    // Back
  0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0,        // Top
  0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0,    // Bottom
  1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0,        // Right
  -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0,    // Left
]);
const CUBE_UVS = new Float32Array([
  0, 0, 1, 0, 1, 1, 0, 1,   // Front
  1, 0, 1, 1, 0, 1, 0, 0,   // Back
  0, 1, 0, 0, 1, 0, 1, 1,   // Top
  1, 1, 0, 1, 0, 0, 1, 0,   // Bottom
  1, 0, 1, 1, 0, 1, 0, 0,   // Right
  0, 0, 1, 0, 1, 1, 0, 1,   // Left
]);
const CUBE_INDICES = new Uint32Array([
  0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 8, 9, 10, 8, 10, 11,
  12, 13, 14, 12, 14, 15, 16, 17, 18, 16, 18, 19, 20, 21, 22, 20, 22, 23,
]);

let HK = null;
let worldId = null;
let groundBodyId = null;
let cubeBodyId = null;

let engine = null;
let scene = null;
let asset = null;
let cubeEntity = null;
let cubeWireframeEntity = null;
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

function initPhysics() {
  const w = HK.HP_World_Create();
  checkResult(w[0], 'HP_World_Create');
  worldId = w[1];
  checkResult(HK.HP_World_SetGravity(worldId, [0, -9.81, 0]), 'HP_World_SetGravity');
  checkResult(HK.HP_World_SetIdealStepTime(worldId, FIXED_TIMESTEP), 'HP_World_SetIdealStepTime');

  // Ground (static)
  const gs = HK.HP_Shape_CreateBox([0, 0, 0], IDENTITY_QUATERNION, GROUND.size);
  checkResult(gs[0], 'HP_Shape_CreateBox ground');
  const gb = HK.HP_Body_Create();
  groundBodyId = gb[1];
  HK.HP_Body_SetShape(groundBodyId, gs[1]);
  HK.HP_Body_SetMotionType(groundBodyId, HK.MotionType.STATIC);
  HK.HP_Body_SetPosition(groundBodyId, GROUND.pos);
  HK.HP_Body_SetOrientation(groundBodyId, IDENTITY_QUATERNION);
  HK.HP_World_AddBody(worldId, groundBodyId, false);

  // Cube (dynamic), dropped from above with a slight tilt so it tumbles as it lands.
  const cs = HK.HP_Shape_CreateBox([0, 0, 0], IDENTITY_QUATERNION, CUBE_SIZE);
  checkResult(cs[0], 'HP_Shape_CreateBox cube');
  const cb = HK.HP_Body_Create();
  cubeBodyId = cb[1];
  HK.HP_Body_SetShape(cubeBodyId, cs[1]);
  HK.HP_Body_SetMotionType(cubeBodyId, HK.MotionType.DYNAMIC);
  const mp = HK.HP_Shape_BuildMassProperties(cs[1]);
  HK.HP_Body_SetMassProperties(cubeBodyId, mp[1]);
  const groundTopY = GROUND.pos[1] + GROUND.size[1] / 2; // = 0
  HK.HP_Body_SetPosition(cubeBodyId, [0, groundTopY + CUBE_SIZE[1] / 2 + 2, 0]);
  const angle = Math.PI * 10 / 180;
  const sn = Math.sin(angle / 2), cs2 = Math.cos(angle / 2), inv = 1 / Math.sqrt(2);
  HK.HP_Body_SetOrientation(cubeBodyId, [inv * sn, 0, inv * sn, cs2]);
  HK.HP_World_AddBody(worldId, cubeBodyId, false);
}

// ---- In-code GLB assembly (textured cube + textured ground quad) ----
function alignTo4(n) { return (n + 3) & ~3; }

function buildSceneGlb(textureBytes) {
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

  function addTriMeshAccessors(positions, normals, uvs, indices, min, max) {
    const posBV = addBufferView(positions, 34962);
    const posAcc = accessors.length;
    accessors.push({ bufferView: posBV, componentType: 5126, count: positions.length / 3, type: 'VEC3', min, max });
    const nrmBV = addBufferView(normals, 34962);
    const nrmAcc = accessors.length;
    accessors.push({ bufferView: nrmBV, componentType: 5126, count: normals.length / 3, type: 'VEC3' });
    const uvBV = addBufferView(uvs, 34962);
    const uvAcc = accessors.length;
    accessors.push({ bufferView: uvBV, componentType: 5126, count: uvs.length / 2, type: 'VEC2' });
    const idxBV = addBufferView(indices, 34963);
    const idxAcc = accessors.length;
    accessors.push({ bufferView: idxBV, componentType: 5125, count: indices.length, type: 'SCALAR' });
    return { POSITION: posAcc, NORMAL: nrmAcc, TEXCOORD_0: uvAcc, indices: idxAcc };
  }

  // For LINES primitives we only need POSITION + indices (no normals / UVs).
  function addLineMeshAccessors(positions, indices, min, max) {
    const posBV = addBufferView(positions, 34962);
    const posAcc = accessors.length;
    accessors.push({ bufferView: posBV, componentType: 5126, count: positions.length / 3, type: 'VEC3', min, max });
    const idxBV = addBufferView(indices, 34963);
    const idxAcc = accessors.length;
    accessors.push({ bufferView: idxBV, componentType: 5125, count: indices.length, type: 'SCALAR' });
    return { POSITION: posAcc, indices: idxAcc };
  }

  // The 12 edges of an axis-aligned box, as line-segment index pairs.
  const LINE_BOX_INDICES = new Uint32Array([
    0, 1, 1, 2, 2, 3, 3, 0,    // bottom square
    4, 5, 5, 6, 6, 7, 7, 4,    // top square
    0, 4, 1, 5, 2, 6, 3, 7,    // verticals
  ]);
  function lineBoxPositions(hx, hy, hz) {
    return new Float32Array([
      -hx, -hy, -hz,  hx, -hy, -hz,  hx, hy, -hz,  -hx, hy, -hz,
      -hx, -hy,  hz,  hx, -hy,  hz,  hx, hy,  hz,  -hx, hy,  hz,
    ]);
  }

  // Cube mesh.
  const cube = addTriMeshAccessors(CUBE_POSITIONS, CUBE_NORMALS, CUBE_UVS, CUBE_INDICES, [-0.5, -0.5, -0.5], [0.5, 0.5, 0.5]);

  // Ground: full 6-face box so it looks solid from any angle (not just a top-face quad).
  const gcx = GROUND.pos[0], gcy = GROUND.pos[1], gcz = GROUND.pos[2];
  const ghx = GROUND.size[0] / 2, ghy = GROUND.size[1] / 2, ghz = GROUND.size[2] / 2;
  const groundPositions = new Float32Array([
    gcx-ghx, gcy-ghy, gcz+ghz,  gcx+ghx, gcy-ghy, gcz+ghz,  gcx+ghx, gcy+ghy, gcz+ghz,  gcx-ghx, gcy+ghy, gcz+ghz,  // Front (+Z)
    gcx-ghx, gcy-ghy, gcz-ghz,  gcx+ghx, gcy-ghy, gcz-ghz,  gcx+ghx, gcy+ghy, gcz-ghz,  gcx-ghx, gcy+ghy, gcz-ghz,  // Back  (-Z)
    gcx+ghx, gcy+ghy, gcz+ghz,  gcx-ghx, gcy+ghy, gcz+ghz,  gcx-ghx, gcy+ghy, gcz-ghz,  gcx+ghx, gcy+ghy, gcz-ghz,  // Top   (+Y)
    gcx-ghx, gcy-ghy, gcz+ghz,  gcx+ghx, gcy-ghy, gcz+ghz,  gcx+ghx, gcy-ghy, gcz-ghz,  gcx-ghx, gcy-ghy, gcz-ghz,  // Bottom(-Y)
    gcx+ghx, gcy-ghy, gcz+ghz,  gcx+ghx, gcy+ghy, gcz+ghz,  gcx+ghx, gcy+ghy, gcz-ghz,  gcx+ghx, gcy-ghy, gcz-ghz,  // Right (+X)
    gcx-ghx, gcy-ghy, gcz+ghz,  gcx-ghx, gcy+ghy, gcz+ghz,  gcx-ghx, gcy+ghy, gcz-ghz,  gcx-ghx, gcy-ghy, gcz-ghz,  // Left  (-X)
  ]);
  const groundNormals = new Float32Array([
     0,  0,  1,  0,  0,  1,  0,  0,  1,  0,  0,  1,  // Front
     0,  0, -1,  0,  0, -1,  0,  0, -1,  0,  0, -1,  // Back
     0,  1,  0,  0,  1,  0,  0,  1,  0,  0,  1,  0,  // Top
     0, -1,  0,  0, -1,  0,  0, -1,  0,  0, -1,  0,  // Bottom
     1,  0,  0,  1,  0,  0,  1,  0,  0,  1,  0,  0,  // Right
    -1,  0,  0, -1,  0,  0, -1,  0,  0, -1,  0,  0,  // Left
  ]);
  const groundUVs = new Float32Array([
    0, 0, 1, 0, 1, 1, 0, 1,   // Front
    1, 0, 1, 1, 0, 1, 0, 0,   // Back
    0, 1, 0, 0, 1, 0, 1, 1,   // Top
    1, 1, 0, 1, 0, 0, 1, 0,   // Bottom
    1, 0, 1, 1, 0, 1, 0, 0,   // Right
    0, 0, 1, 0, 1, 1, 0, 1,   // Left
  ]);
  const groundIndices = new Uint32Array([
     0,  1,  2,  0,  2,  3,   4,  5,  6,  4,  6,  7,   8,  9, 10,  8, 10, 11,
    12, 13, 14, 12, 14, 15,  16, 17, 18, 16, 18, 19,  20, 21, 22, 20, 22, 23,
  ]);
  const ground = addTriMeshAccessors(
    groundPositions, groundNormals, groundUVs, groundIndices,
    [gcx-ghx, gcy-ghy, gcz-ghz], [gcx+ghx, gcy+ghy, gcz+ghz],
  );

  // Wireframe boxes. Slightly outset (~0.5%) so the lines sit just outside the textured geometry
  // and don't z-fight with the cube / ground triangle surfaces.
  const cubeWireHX = CUBE_SIZE[0] / 2 * 1.005, cubeWireHY = CUBE_SIZE[1] / 2 * 1.005, cubeWireHZ = CUBE_SIZE[2] / 2 * 1.005;
  const cubeWire = addLineMeshAccessors(
    lineBoxPositions(cubeWireHX, cubeWireHY, cubeWireHZ),
    LINE_BOX_INDICES,
    [-cubeWireHX, -cubeWireHY, -cubeWireHZ], [cubeWireHX, cubeWireHY, cubeWireHZ],
  );
  const gHX = GROUND.size[0] / 2 * 1.005, gHY = GROUND.size[1] / 2 * 1.005, gHZ = GROUND.size[2] / 2 * 1.005;
  // The ground wireframe bakes the ground's world Y centre in (collider sits at GROUND.pos).
  const gMidY = GROUND.pos[1];
  const groundWirePositions = new Float32Array([
    -gHX, gMidY - gHY, -gHZ,  gHX, gMidY - gHY, -gHZ,  gHX, gMidY + gHY, -gHZ,  -gHX, gMidY + gHY, -gHZ,
    -gHX, gMidY - gHY,  gHZ,  gHX, gMidY - gHY,  gHZ,  gHX, gMidY + gHY,  gHZ,  -gHX, gMidY + gHY,  gHZ,
  ]);
  const groundWire = addLineMeshAccessors(
    groundWirePositions, LINE_BOX_INDICES,
    [-gHX, gMidY - gHY, -gHZ], [gHX, gMidY + gHY, gHZ],
  );

  // Single embedded image shared by both PBR materials.
  const imgBV = addBufferView(textureBytes, undefined);

  const gltf = {
    asset: { version: '2.0', generator: 'filament-havok-minimum' },
    extensionsUsed: ['KHR_materials_unlit'],
    scene: 0,
    scenes: [{ nodes: [0, 1, 2, 3] }],
    nodes: [
      { name: 'cube', mesh: 0 },
      { name: 'ground', mesh: 1 },
      { name: 'cubeWireframe', mesh: 2 },
      { name: 'groundWireframe', mesh: 3 },
    ],
    meshes: [
      { primitives: [{ attributes: { POSITION: cube.POSITION, NORMAL: cube.NORMAL, TEXCOORD_0: cube.TEXCOORD_0 }, indices: cube.indices, material: 0 }] },
      { primitives: [{ attributes: { POSITION: ground.POSITION, NORMAL: ground.NORMAL, TEXCOORD_0: ground.TEXCOORD_0 }, indices: ground.indices, material: 1 }] },
      // mode 1 = LINES (glTF spec). gltfio maps that to Filament's PrimitiveType.LINES.
      { primitives: [{ mode: 1, attributes: { POSITION: cubeWire.POSITION }, indices: cubeWire.indices, material: 2 }] },
      { primitives: [{ mode: 1, attributes: { POSITION: groundWire.POSITION }, indices: groundWire.indices, material: 3 }] },
    ],
    materials: [
      // doubleSided so back-face culling can't hide faces whose winding happens to be reversed
      // (the hand-authored cube indices are not all CCW outward; doubleSided keeps every face
      // visible without having to rewind every index).
      { name: 'cube',   pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0.0, roughnessFactor: CUBE_ROUGHNESS }, doubleSided: true },
      { name: 'ground', pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0.0, roughnessFactor: 0.9 },            doubleSided: true },
      // Unlit so the wireframes show as solid coloured lines regardless of lighting.
      { name: 'cubeWireframe',   extensions: { KHR_materials_unlit: {} }, pbrMetallicRoughness: { baseColorFactor: [1.0, 0.5, 0.2, 1.0] } },
      { name: 'groundWireframe', extensions: { KHR_materials_unlit: {} }, pbrMetallicRoughness: { baseColorFactor: [0.2, 1.0, 0.4, 1.0] } },
    ],
    images: [{ bufferView: imgBV, mimeType: 'image/jpeg' }],
    samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }],
    textures: [{ sampler: 0, source: 0 }],
    accessors, bufferViews,
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

// ---- W-key wireframe toggle (adds / removes the wireframe entities from the scene) ----
function setWireframeVisible(visible) {
  showWireframe = visible;
  const hint = document.getElementById('hint');
  if (hint) hint.textContent = 'W: wireframe ' + (visible ? 'ON' : 'OFF');
  if (!scene || !cubeWireframeEntity || !groundWireframeEntity) return;
  if (visible) {
    scene.addEntity(cubeWireframeEntity);
    scene.addEntity(groundWireframeEntity);
  } else {
    scene.remove(cubeWireframeEntity);
    scene.remove(groundWireframeEntity);
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
  renderer.setClearOptions({ clearColor: [0.13, 0.13, 0.15, 1.0], clear: true });

  HK = await HavokPhysics();
  initPhysics();

  // Build & load the scene GLB (cube + ground + LINE wireframes, all in one asset / one canvas).
  const textureBytes = await fetchBytes(TEXTURE_URL);
  const glb = buildSceneGlb(textureBytes);
  const assetLoader = engine.createAssetLoader();
  asset = assetLoader.createAsset(glb);
  await new Promise((resolve) => {
    asset.loadResources(() => {
      assetLoader.delete();
      // Pop every renderable into the scene right now so the wireframe toggle can manage them by
      // name immediately (no further popRenderable in the render loop).
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
  cubeEntity = asset.getEntitiesByName('cube')[0] || null;
  cubeWireframeEntity = asset.getEntitiesByName('cubeWireframe')[0] || null;
  groundWireframeEntity = asset.getEntitiesByName('groundWireframe')[0] || null;
  if (!cubeEntity) console.warn('[Filament+Havok] cube entity not found');
  if (!cubeWireframeEntity || !groundWireframeEntity) console.warn('[Filament+Havok] wireframe entities not found');

  // Orbit camera state (spherical coordinates around camTarget).
  const camTarget = [0, 0.5, 0];
  let camTheta  = 0.5;   // azimuth (rad)
  let camPhi    = 0.40;  // elevation above horizon (rad); ~23°
  let camRadius = 6.7;   // distance from target

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
    camRadius = Math.max(1.0, Math.min(50.0, camRadius));
  }, { passive: false });

  setWireframeVisible(showWireframe);

  const tcm = engine.getTransformManager();
  // Reusable scratch so the render loop doesn't allocate every frame.
  const tmpMat = mat4.create(), tmpQuat = quat.create(), tmpVec = vec3.create();
  function render(now) {
    requestAnimationFrame(render);

    if (HK && worldId) {
      checkResult(HK.HP_World_Step(worldId, FIXED_TIMESTEP), 'HP_World_Step');
      if (cubeEntity || cubeWireframeEntity) {
        const pr = HK.HP_Body_GetPosition(cubeBodyId);
        const qr = HK.HP_Body_GetOrientation(cubeBodyId);
        const p = pr[1], q = qr[1];
        quat.set(tmpQuat, q[0], q[1], q[2], q[3]);
        vec3.set(tmpVec, p[0], p[1], p[2]);
        mat4.fromRotationTranslation(tmpMat, tmpQuat, tmpVec);
        if (cubeEntity) {
          const inst = tcm.getInstance(cubeEntity);
          tcm.setTransform(inst, tmpMat);
          inst.delete();
        }
        if (cubeWireframeEntity) {
          const inst = tcm.getInstance(cubeWireframeEntity);
          tcm.setTransform(inst, tmpMat);
          inst.delete();
        }
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
