// Filament + Havok — glTF Physics "Materials_Friction" sample.
//
// Renders the Khronos glTF_Physics "Materials_Friction" model with Google Filament and
// simulates it with Havok, driven by the KHR_physics_rigid_bodies / KHR_implicit_shapes
// extensions embedded in the GLB (box colliders with per-collider friction materials).
//
// Collider wireframes are loaded as a second gltfio asset built in-code (LINES primitives with
// KHR_materials_unlit), so they render in the same Filament pass as the model — no second canvas,
// no compositor stutter. Press W to toggle the wireframe entities in / out of the scene.
//
// Libraries are loaded as globals via <script> tags: Filament, HavokPhysics, and gl-matrix
// (vec3 / quat / mat4).

const MODEL_URL = 'https://raw.githubusercontent.com/eoineoineoin/glTF_Physics/master/samples/Materials_Friction/Materials_Friction.glb';
const IBL_URL = 'https://cx20.github.io/gltf-test/textures/ktx/papermill/papermill_ibl.ktx';
const SKY_URL = 'https://cx20.github.io/gltf-test/textures/ktx/papermill/papermill_skybox.ktx';

const FIXED_TIMESTEP = 1 / 60;
const RESET_Y_THRESHOLD = -20;
const IDENTITY_QUATERNION = [0, 0, 0, 1];

const DEBUG_COLOR_DYNAMIC = [1.0, 0.5, 0.2, 1.0]; // orange = moving bodies
const DEBUG_COLOR_STATIC = [0.2, 1.0, 0.4, 1.0];  // green  = static bodies

let HK = null;
let worldId = null;

// Filament objects
let engine = null;
let scene = null;
let asset = null;

// Physics <-> Filament bookkeeping; wireframeEntity is filled in by loadWireframeAsset().
const physicsNodes = [];   // dynamic bodies: { entity, bodyId, nodeScale, initPos, initRot, parentInvWorldMat, size, wireframeEntity }
const staticBodies = [];   // static bodies:  { bodyId, size, wireframeEntity }

// Camera framing (computed from collider bounds)
const sceneMin = [Infinity, Infinity, Infinity];
const sceneMax = [-Infinity, -Infinity, -Infinity];

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

function applyPhysicsMaterial(shapeId, materialDef) {
  if (!materialDef || typeof HK.HP_Shape_SetMaterial !== 'function') return;
  const dynamicFriction = materialDef.dynamicFriction !== undefined ? materialDef.dynamicFriction : 0.5;
  const staticFriction = materialDef.staticFriction !== undefined ? materialDef.staticFriction : 0.5;
  const restitution = materialDef.restitution !== undefined ? materialDef.restitution : 0.0;
  HK.HP_Shape_SetMaterial(shapeId, [
    dynamicFriction,
    staticFriction,
    restitution,
    HK.MaterialCombine.MAXIMUM,
    HK.MaterialCombine.MINIMUM,
  ]);
}

// Extract a rotation quaternion from a matrix that may carry non-uniform scale: gl-matrix's
// mat4.getRotation is wrong unless each basis column is normalized first.
function getRotationFromMat(out, m) {
  const sx = Math.hypot(m[0], m[1], m[2]) || 1;
  const sy = Math.hypot(m[4], m[5], m[6]) || 1;
  const sz = Math.hypot(m[8], m[9], m[10]) || 1;
  const n = [
    m[0] / sx, m[1] / sx, m[2] / sx, 0,
    m[4] / sy, m[5] / sy, m[6] / sy, 0,
    m[8] / sz, m[9] / sz, m[10] / sz, 0,
    0, 0, 0, 1,
  ];
  return mat4.getRotation(out, n);
}

// World transforms (column-major mat4) for every glTF node, indexed by node index.
function buildWorldTransforms(gltfJson) {
  const nodes = gltfJson.nodes || [];
  const worldMats = nodes.map(() => mat4.create());
  const scenes = gltfJson.scenes || [];
  const roots = scenes[gltfJson.scene || 0]?.nodes || [];
  function computeNode(i, parentMat) {
    const n = nodes[i];
    const local = mat4.create();
    if (n.matrix) {
      mat4.set(local, ...n.matrix);
    } else {
      const t = n.translation || [0, 0, 0];
      const r = n.rotation || [0, 0, 0, 1];
      const s = n.scale || [1, 1, 1];
      mat4.fromRotationTranslationScale(local,
        quat.fromValues(r[0], r[1], r[2], r[3]),
        vec3.fromValues(t[0], t[1], t[2]),
        vec3.fromValues(s[0], s[1], s[2]));
    }
    mat4.multiply(worldMats[i], parentMat, local);
    for (const c of (n.children || [])) computeNode(c, worldMats[i]);
  }
  for (const r of roots) computeNode(r, mat4.create());
  return worldMats;
}

// Map glTF node index -> Filament entity. Filament's getEntities() does not preserve glTF node
// order (AssetLoader partitions renderables first), so match by initial local translation.
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
    if (best >= 0 && bestDist < 0.01) {
      map.set(ni, probes[best].entity);
      used.add(best);
    }
  }
  return map;
}

function createBoxShape(boxDef, worldScale, motionDef, materialDef) {
  const bs = boxDef.size || [1, 1, 1];
  // HP_Shape_CreateBox takes full extents (not half-extents).
  const size = [
    Math.abs(bs[0] * worldScale[0]),
    Math.abs(bs[1] * worldScale[1]),
    Math.abs(bs[2] * worldScale[2]),
  ];
  const created = HK.HP_Shape_CreateBox([0, 0, 0], IDENTITY_QUATERNION, size);
  checkResult(created[0], 'HP_Shape_CreateBox');
  const shapeId = created[1];
  if (motionDef) {
    const volume = Math.max(size[0] * size[1] * size[2], 0.0001);
    const density = motionDef.mass !== undefined ? motionDef.mass / volume : 1;
    checkResult(HK.HP_Shape_SetDensity(shapeId, density), 'HP_Shape_SetDensity');
  }
  applyPhysicsMaterial(shapeId, materialDef);
  return { shapeId, size };
}

function createBody(shapeId, motionType, position, rotation, setMass) {
  const created = HK.HP_Body_Create();
  checkResult(created[0], 'HP_Body_Create');
  const bodyId = created[1];
  checkResult(HK.HP_Body_SetShape(bodyId, shapeId), 'HP_Body_SetShape');
  checkResult(HK.HP_Body_SetMotionType(bodyId, motionType), 'HP_Body_SetMotionType');
  if (setMass) {
    const mass = HK.HP_Shape_BuildMassProperties(shapeId);
    checkResult(mass[0], 'HP_Shape_BuildMassProperties');
    checkResult(HK.HP_Body_SetMassProperties(bodyId, mass[1]), 'HP_Body_SetMassProperties');
  }
  checkResult(HK.HP_Body_SetPosition(bodyId, position), 'HP_Body_SetPosition');
  checkResult(HK.HP_Body_SetOrientation(bodyId, rotation), 'HP_Body_SetOrientation');
  checkResult(HK.HP_World_AddBody(worldId, bodyId, false), 'HP_World_AddBody');
  return bodyId;
}

function expandSceneBounds(pos, size) {
  // Rotation-safe loose bound: the box never extends past pos +/- half its diagonal.
  const r = 0.5 * Math.hypot(size[0], size[1], size[2]);
  for (let k = 0; k < 3; k++) {
    sceneMin[k] = Math.min(sceneMin[k], pos[k] - r);
    sceneMax[k] = Math.max(sceneMax[k], pos[k] + r);
  }
}

// Parse the GLB's physics extensions and build the Havok world. Materials_Friction uses only
// KHR_implicit_shapes box colliders, so this handles single box shapes (static + dynamic).
async function initPhysicsFromUrl(meshUrl, filamentAsset, filamentEngine) {
  const ab = await (await fetch(meshUrl)).arrayBuffer();
  const head = new Uint8Array(ab, 0, 4);
  const isGlb = head[0] === 0x67 && head[1] === 0x6c && head[2] === 0x54 && head[3] === 0x46;
  let gltfJson;
  if (isGlb) {
    const dv = new DataView(ab);
    const jsonLen = dv.getUint32(12, true);
    gltfJson = JSON.parse(new TextDecoder().decode(new Uint8Array(ab, 20, jsonLen)));
  } else {
    gltfJson = JSON.parse(new TextDecoder().decode(new Uint8Array(ab)));
  }

  const ext = gltfJson.extensions || {};
  const shapeDefs = ext.KHR_implicit_shapes?.shapes || [];
  const matDefs = ext.KHR_physics_rigid_bodies?.physicsMaterials || [];
  const nodes = gltfJson.nodes || [];
  const worldMats = buildWorldTransforms(gltfJson);

  const parentMap = new Map();
  for (let i = 0; i < nodes.length; i++) {
    for (const c of (nodes[i].children || [])) parentMap.set(c, i);
  }

  const nodeEntityMap = buildNodeEntityMap(gltfJson, filamentAsset, filamentEngine);

  const created = HK.HP_World_Create();
  checkResult(created[0], 'HP_World_Create');
  worldId = created[1];
  checkResult(HK.HP_World_SetGravity(worldId, [0, -9.8, 0]), 'HP_World_SetGravity');
  checkResult(HK.HP_World_SetIdealStepTime(worldId, FIXED_TIMESTEP), 'HP_World_SetIdealStepTime');

  for (let i = 0; i < nodes.length; i++) {
    const physExt = nodes[i].extensions?.KHR_physics_rigid_bodies;
    const geom = physExt?.collider?.geometry;
    if (geom?.shape === undefined) continue;
    const shapeDef = shapeDefs[geom.shape];
    if (!shapeDef || !shapeDef.box) continue; // this sample is box-only

    const motionDef = physExt.motion || null;
    const matDef = physExt.collider.physicsMaterial !== undefined ? matDefs[physExt.collider.physicsMaterial] : null;

    const worldScale = vec3.create();
    mat4.getScaling(worldScale, worldMats[i]);
    const shape = createBoxShape(shapeDef.box, worldScale, motionDef, matDef);

    const wPos = vec3.create(); mat4.getTranslation(wPos, worldMats[i]);
    const wRot = quat.create(); getRotationFromMat(wRot, worldMats[i]);
    const initPos = [wPos[0], wPos[1], wPos[2]];
    const initRot = [wRot[0], wRot[1], wRot[2], wRot[3]];

    const bodyId = createBody(
      shape.shapeId,
      motionDef ? HK.MotionType.DYNAMIC : HK.MotionType.STATIC,
      initPos, initRot, !!motionDef,
    );
    expandSceneBounds(initPos, shape.size);

    if (motionDef) {
      const nodeScale = [worldScale[0], worldScale[1], worldScale[2]];
      const parentInvWorldMat = mat4.create();
      const pIdx = parentMap.get(i);
      if (pIdx !== undefined) mat4.invert(parentInvWorldMat, worldMats[pIdx]);

      const name = nodes[i].name;
      const named = name ? filamentAsset.getEntitiesByName(name) : [];
      const entity = named.length > 0 ? named[0] : (nodeEntityMap.get(i) || null);
      if (!entity) console.warn('[physics] no Filament entity for node', i, name || '(unnamed)');

      const entry = { entity, bodyId, nodeScale, initPos, initRot, parentInvWorldMat, size: shape.size };
      physicsNodes.push(entry);

      // Keep dynamic renderables visible even when their (now stale) AABB leaves the frustum.
      if (entity) {
        const rm = filamentEngine.getRenderableManager();
        const inst = rm.getInstance(entity);
        if (inst) { rm.setCulling(inst, false); inst.delete(); }
      }
    } else {
      staticBodies.push({ bodyId, size: shape.size });
    }
  }

  console.log('[Filament+Havok] physics ready:',
    physicsNodes.length, 'dynamic,', staticBodies.length, 'static');
}

// ---- Physics step + transform sync ----
function physicsStep() {
  if (!HK || !worldId) return;
  checkResult(HK.HP_World_Step(worldId, FIXED_TIMESTEP), 'HP_World_Step');

  for (const entry of physicsNodes) {
    const pr = HK.HP_Body_GetPosition(entry.bodyId);
    if (pr[1][1] < RESET_Y_THRESHOLD) {
      checkResult(HK.HP_Body_SetPosition(entry.bodyId, entry.initPos), 'reset SetPosition');
      checkResult(HK.HP_Body_SetOrientation(entry.bodyId, entry.initRot), 'reset SetOrientation');
      checkResult(HK.HP_Body_SetLinearVelocity(entry.bodyId, [0, 0, 0]), 'reset SetLinearVelocity');
      checkResult(HK.HP_Body_SetAngularVelocity(entry.bodyId, [0, 0, 0]), 'reset SetAngularVelocity');
    }
  }

  const tcm = engine.getTransformManager();
  tcm.openLocalTransformTransaction();
  for (const entry of physicsNodes) {
    const pr = HK.HP_Body_GetPosition(entry.bodyId);
    const qr = HK.HP_Body_GetOrientation(entry.bodyId);
    const p = pr[1], r = qr[1];
    if (entry.entity) {
      const physWorld = mat4.fromRotationTranslationScale(
        mat4.create(),
        quat.fromValues(r[0], r[1], r[2], r[3]),
        vec3.fromValues(p[0], p[1], p[2]),
        vec3.fromValues(entry.nodeScale[0], entry.nodeScale[1], entry.nodeScale[2]),
      );
      const localMat = mat4.multiply(mat4.create(), entry.parentInvWorldMat, physWorld);
      const inst = tcm.getInstance(entry.entity);
      tcm.setTransform(inst, localMat);
      inst.delete();
    }
    if (entry.wireframeEntity) {
      const wireMat = mat4.fromRotationTranslation(mat4.create(),
        quat.fromValues(r[0], r[1], r[2], r[3]), vec3.fromValues(p[0], p[1], p[2]));
      const inst = tcm.getInstance(entry.wireframeEntity);
      tcm.setTransform(inst, wireMat);
      inst.delete();
    }
  }
  tcm.commitLocalTransformTransaction();
}

// ---- Debug wireframe overlay (separate transparent WebGL2 canvas) ----
function makeBoxLineVerts(sx, sy, sz) {
  const hx = sx / 2, hy = sy / 2, hz = sz / 2;
  const c = [
    [-hx, -hy, -hz], [hx, -hy, -hz], [hx, hy, -hz], [-hx, hy, -hz],
    [-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz],
  ];
  const edges = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
  const v = [];
  for (const [a, b] of edges) v.push(...c[a], ...c[b]);
  return new Float32Array(v);
}

// ---- In-code wireframe GLB (LINES primitives + KHR_materials_unlit) ----
function alignTo4(n) { return (n + 3) & ~3; }

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
    if (minX > maxX) { minX = minY = minZ = 0; maxX = maxY = maxZ = 0; }
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
  const meshes = [];
  const nodes = [];
  function seqIndices(n) { const out = new Uint32Array(n); for (let i = 0; i < n; i++) out[i] = i; return out; }
  for (let i = 0; i < physicsNodes.length; i++) {
    const v = makeBoxLineVerts(physicsNodes[i].size[0], physicsNodes[i].size[1], physicsNodes[i].size[2]);
    meshes.push({ positions: v, indices: seqIndices(v.length / 3), color: DEBUG_COLOR_DYNAMIC });
    nodes.push({ name: 'dynWire' + i, meshIndex: meshes.length - 1 });
  }
  for (let i = 0; i < staticBodies.length; i++) {
    const v = makeBoxLineVerts(staticBodies[i].size[0], staticBodies[i].size[1], staticBodies[i].size[2]);
    meshes.push({ positions: v, indices: seqIndices(v.length / 3), color: DEBUG_COLOR_STATIC });
    nodes.push({ name: 'staticWire' + i, meshIndex: meshes.length - 1 });
  }
  if (meshes.length === 0) return null;

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
  for (let i = 0; i < physicsNodes.length; i++) physicsNodes[i].wireframeEntity = a.getEntitiesByName('dynWire' + i)[0] || null;
  for (let i = 0; i < staticBodies.length; i++) staticBodies[i].wireframeEntity = a.getEntitiesByName('staticWire' + i)[0] || null;
  // Place static wireframes at their initial transform once; they don't move afterward.
  const tcm = engine.getTransformManager();
  tcm.openLocalTransformTransaction();
  for (const sb of staticBodies) {
    if (!sb.wireframeEntity) continue;
    const pr = HK.HP_Body_GetPosition(sb.bodyId);
    const qr = HK.HP_Body_GetOrientation(sb.bodyId);
    const p = pr[1], r = qr[1];
    const m = mat4.fromRotationTranslation(mat4.create(), quat.fromValues(r[0], r[1], r[2], r[3]), vec3.fromValues(p[0], p[1], p[2]));
    const inst = tcm.getInstance(sb.wireframeEntity);
    tcm.setTransform(inst, m);
    inst.delete();
  }
  tcm.commitLocalTransformTransaction();
  return a;
}

// ---- W-key wireframe toggle (adds / removes the wireframe entities from the scene) ----
function setWireframeVisible(visible) {
  showWireframe = visible;
  const hint = document.getElementById('hint');
  if (hint) hint.textContent = 'W: wireframe ' + (visible ? 'ON' : 'OFF');
  if (!scene) return;
  for (const entry of physicsNodes) {
    if (!entry.wireframeEntity) continue;
    if (visible) scene.addEntity(entry.wireframeEntity); else scene.remove(entry.wireframeEntity);
  }
  for (const sb of staticBodies) {
    if (!sb.wireframeEntity) continue;
    if (visible) scene.addEntity(sb.wireframeEntity); else scene.remove(sb.wireframeEntity);
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
  // Use an explicit LINEAR color grading (matches the reference viewer); relying on Filament's
  // default color grading triggers a "uniform buffer too small" GL error at feature level 1.
  const colorGrading = Filament.ColorGrading.Builder().toneMapping(ToneMapping.LINEAR).build(engine);
  view.setColorGrading(colorGrading);
  renderer.setClearOptions({ clearColor: [0.6, 0.6, 0.6, 1.0], clear: true });

  // Load the model. The model carries KHR_lights_punctual lights, but addEntities() would add them
  // and trip "glDrawElementsInstanced: uniform buffer too small" on base_lit_opaque at feature
  // level 1. We skip them by using popRenderable() (which only yields renderables) and light the
  // scene with IBL + a directional SUN instead.
  const bytes = new Uint8Array(await (await fetch(MODEL_URL)).arrayBuffer());
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
        if (inst) { rm.setCastShadows(inst, true); inst.delete(); }
      }
      resolve();
    }, () => {}, '');
  });

  // Build physics from the GLB's KHR_physics extensions, then load the wireframe asset.
  HK = await HavokPhysics();
  await initPhysicsFromUrl(MODEL_URL, asset, engine);
  await loadWireframeAsset();

  // Frame the camera on the collider bounds.
  const center = [
    (sceneMin[0] + sceneMax[0]) / 2,
    (sceneMin[1] + sceneMax[1]) / 2,
    (sceneMin[2] + sceneMax[2]) / 2,
  ];
  const span = Math.max(
    sceneMax[0] - sceneMin[0],
    sceneMax[1] - sceneMin[1],
    sceneMax[2] - sceneMin[2],
    1,
  );
  const radius = span * 0.5;
  const camTarget = [...center];
  let camTheta  = 0.6;   // azimuth (rad)
  let camPhi    = Math.atan2(radius * 0.4, radius * 1.6);   // ~0.24
  let camRadius = Math.sqrt((radius * 1.6) ** 2 + (radius * 0.4) ** 2);
  const far = Math.max(2000, radius * 60);

  let aspect = 1;
  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.width = Math.floor(window.innerWidth * dpr);
    const height = canvas.height = Math.floor(window.innerHeight * dpr);
    aspect = width / height;
    view.setViewport([0, 0, width, height]);
    const fovAxis = aspect < 1 ? Fov.HORIZONTAL : Fov.VERTICAL;
    camera.setProjectionFov(75, aspect, 0.1, far, fovAxis);
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
