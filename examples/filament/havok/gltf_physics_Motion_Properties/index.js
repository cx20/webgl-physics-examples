// Filament + Havok — glTF Physics "MotionProperties" sample.
//
// Renders the Khronos glTF_Physics "MotionProperties" model with Google Filament and simulates it
// with Havok via the KHR_physics_rigid_bodies / KHR_implicit_shapes extensions. This scene shows
// the motion properties of the extension: gravityFactor (balloons float up), a modified
// centerOfMass (wobbly toy), and locked / infinite inertia (wheel, box). It uses box / capsule /
// cylinder implicit shapes plus convex-hull and triangle-mesh colliders.
//
// Collider wireframes are loaded as a second gltfio asset built in-code (LINES primitives with
// KHR_materials_unlit), so they render in the same Filament pass as the model — no second canvas,
// no compositor stutter. Press W to toggle the wireframe entities in / out of the scene.
//
// Libraries are loaded as globals via <script> tags: Filament, HavokPhysics, gl-matrix
// (vec3 / quat / mat4).

const MODEL_URL = 'https://raw.githubusercontent.com/eoineoineoin/glTF_Physics/master/samples/MotionProperties/MotionProperties.glb';
const IBL_URL = 'https://cx20.github.io/gltf-test/textures/ktx/papermill/papermill_ibl.ktx';
const SKY_URL = 'https://cx20.github.io/gltf-test/textures/ktx/papermill/papermill_skybox.ktx';

const FIXED_TIMESTEP = 1 / 60;
const RESET_Y_THRESHOLD = -30;
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
const physicsNodes = [];   // dynamic bodies (transform-synced + Y-reset, with wireframeEntity)
const staticBodies = [];   // static bodies (wireframeEntity placed once at the initial transform)

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
  const df = materialDef.dynamicFriction !== undefined ? materialDef.dynamicFriction : 0.5;
  const sf = materialDef.staticFriction !== undefined ? materialDef.staticFriction : 0.5;
  const re = materialDef.restitution !== undefined ? materialDef.restitution : 0.0;
  const combineMap = {
    minimum: HK.MaterialCombine.MINIMUM,
    maximum: HK.MaterialCombine.MAXIMUM,
    multiply: HK.MaterialCombine.MULTIPLY,
    average: HK.MaterialCombine.ARITHMETIC_MEAN !== undefined ? HK.MaterialCombine.ARITHMETIC_MEAN : HK.MaterialCombine.MINIMUM,
  };
  const frictionCombine = combineMap[materialDef.frictionCombine] !== undefined ? combineMap[materialDef.frictionCombine] : HK.MaterialCombine.MINIMUM;
  const restitutionCombine = combineMap[materialDef.restitutionCombine] !== undefined ? combineMap[materialDef.restitutionCombine] : HK.MaterialCombine.MAXIMUM;
  HK.HP_Shape_SetMaterial(shapeId, [df, sf, re, frictionCombine, restitutionCombine]);
}

// Rotation from a possibly non-uniformly-scaled matrix: normalize basis columns first
// (gl-matrix mat4.getRotation is wrong otherwise).
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

// Decode every accessor referenced by the GLB into a flat Float32Array / Uint32Array, keyed by
// accessor index. Needed for mesh colliders (reads POSITION + indices).
function buildAccessorCache(gltfJson, bufferData) {
  const cache = {};
  const bufferViews = gltfJson.bufferViews || [];
  (gltfJson.accessors || []).forEach((acc, idx) => {
    if (acc.bufferView === undefined) { cache[idx] = new Float32Array(0); return; }
    const bv = bufferViews[acc.bufferView];
    const byteOff = (bv.byteOffset || 0) + (acc.byteOffset || 0);
    const count = acc.count;
    const typeMap = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
    const compMap = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
    const numComps = typeMap[acc.type] || 1;
    const compBytes = compMap[acc.componentType] || 4;
    const stride = bv.byteStride || (compBytes * numComps);
    const isIndex = (acc.componentType === 5123 || acc.componentType === 5125);
    const out = new (isIndex ? Uint32Array : Float32Array)(count * numComps);
    const SrcType = acc.componentType === 5123 ? Uint16Array
      : acc.componentType === 5125 ? Uint32Array
      : acc.componentType === 5121 ? Uint8Array
      : Float32Array;
    for (let i = 0; i < count; i++) {
      const src = new SrcType(bufferData, byteOff + i * stride, numComps);
      for (let k = 0; k < numComps; k++) out[i * numComps + k] = src[k];
    }
    cache[idx] = out;
  });
  return cache;
}

// Map glTF node index -> Filament entity. Filament's getEntities() does not preserve glTF node
// order, so match by initial local translation (name is tried first by the caller).
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

// ---- Shape creation ----
function createImplicitShape(shapeDef, worldScale, motionDef, matDef) {
  let shapeId, shapeType, size;
  if (shapeDef.box) {
    const bs = shapeDef.box.size || [1, 1, 1];
    size = [Math.abs(bs[0] * worldScale[0]), Math.abs(bs[1] * worldScale[1]), Math.abs(bs[2] * worldScale[2])];
    shapeType = 'box';
    const c = HK.HP_Shape_CreateBox([0, 0, 0], IDENTITY_QUATERNION, size);
    checkResult(c[0], 'HP_Shape_CreateBox'); shapeId = c[1];
    if (motionDef) { const v = Math.max(size[0] * size[1] * size[2], 0.0001); checkResult(HK.HP_Shape_SetDensity(shapeId, motionDef.mass != null ? motionDef.mass / v : 1), 'SetDensity'); }
  } else if (shapeDef.sphere) {
    const r = (shapeDef.sphere.radius || 0.5) * Math.max(worldScale[0], worldScale[1], worldScale[2]);
    shapeType = 'sphere'; size = [r * 2, r * 2, r * 2];
    const c = HK.HP_Shape_CreateSphere([0, 0, 0], r);
    checkResult(c[0], 'HP_Shape_CreateSphere'); shapeId = c[1];
    if (motionDef) { const v = Math.max(4 / 3 * Math.PI * r ** 3, 0.0001); checkResult(HK.HP_Shape_SetDensity(shapeId, motionDef.mass != null ? motionDef.mass / v : 1), 'SetDensity'); }
  } else if (shapeDef.capsule) {
    const rTop = shapeDef.capsule.radiusTop ?? shapeDef.capsule.radius ?? 0.5;
    const rBot = shapeDef.capsule.radiusBottom ?? shapeDef.capsule.radius ?? 0.5;
    const r = (rTop + rBot) / 2 * Math.max(worldScale[0], worldScale[2]);
    const hh = (shapeDef.capsule.height ?? 1.0) * worldScale[1] / 2;
    shapeType = 'capsule'; size = [r * 2, hh * 2 + r * 2, r * 2];
    const c = HK.HP_Shape_CreateCapsule([0, -hh, 0], [0, hh, 0], r);
    checkResult(c[0], 'HP_Shape_CreateCapsule'); shapeId = c[1];
    if (motionDef) { const v = Math.max(Math.PI * r * r * hh * 2 + 4 / 3 * Math.PI * r ** 3, 0.0001); checkResult(HK.HP_Shape_SetDensity(shapeId, motionDef.mass != null ? motionDef.mass / v : 1), 'SetDensity'); }
  } else if (shapeDef.cylinder) {
    const rTop = shapeDef.cylinder.radiusTop ?? shapeDef.cylinder.radius ?? 0.5;
    const rBot = shapeDef.cylinder.radiusBottom ?? shapeDef.cylinder.radius ?? 0.5;
    const r = Math.max(rTop, rBot) * Math.max(worldScale[0], worldScale[2]);
    const hh = (shapeDef.cylinder.height ?? 1.0) * worldScale[1] / 2;
    shapeType = 'cylinder'; size = [r * 2, hh * 2, r * 2];
    let c;
    if (typeof HK.HP_Shape_CreateCylinder === 'function') {
      c = HK.HP_Shape_CreateCylinder([0, -hh, 0], [0, hh, 0], r); checkResult(c[0], 'HP_Shape_CreateCylinder');
    } else {
      c = HK.HP_Shape_CreateBox([0, 0, 0], IDENTITY_QUATERNION, [r * 2, hh * 2, r * 2]); checkResult(c[0], 'HP_Shape_CreateBox (cyl)');
    }
    shapeId = c[1];
    if (motionDef) { const v = Math.max(Math.PI * r * r * hh * 2, 0.0001); checkResult(HK.HP_Shape_SetDensity(shapeId, motionDef.mass != null ? motionDef.mass / v : 1), 'SetDensity'); }
  } else {
    return null;
  }
  applyPhysicsMaterial(shapeId, matDef);
  return { shapeId, shapeType, size };
}

// Build a convex-hull or triangle-mesh shape from a mesh referenced by the collider geometry.
function createMeshShape(gltfJson, accessors, nodeWorldMat, geomDef, motionDef, matDef) {
  const isConvex = !!geomDef.convexHull || !!motionDef; // dynamic bodies need a convex shape
  let meshIndex = geomDef.mesh;
  if (meshIndex === undefined && geomDef.node !== undefined) meshIndex = gltfJson.nodes[geomDef.node]?.mesh;
  if (meshIndex === undefined) return null;
  const meshDef = gltfJson.meshes[meshIndex];
  const ws = vec3.create(); mat4.getScaling(ws, nodeWorldMat);

  const positions = [], indices = [], wireIndices = [];
  let vertexOffset = 0;
  for (const prim of meshDef.primitives) {
    const posData = accessors[prim.attributes.POSITION];
    if (!posData) continue;
    for (let j = 0; j < posData.length; j += 3) positions.push(posData[j] * ws[0], posData[j + 1] * ws[1], posData[j + 2] * ws[2]);
    const primIdx = [];
    if (prim.indices !== undefined) {
      const idxData = accessors[prim.indices];
      for (let j = 0; j < idxData.length; j++) primIdx.push(idxData[j] + vertexOffset);
    } else {
      const vc = posData.length / 3;
      for (let j = 0; j + 2 < vc; j += 3) primIdx.push(vertexOffset + j, vertexOffset + j + 1, vertexOffset + j + 2);
    }
    for (const k of primIdx) { wireIndices.push(k); if (!isConvex) indices.push(k); }
    vertexOffset += posData.length / 3;
  }
  if (positions.length === 0) return null;
  if (!isConvex) { // duplicate triangles reversed so the static trimesh is double-sided
    const base = indices.length;
    for (let j = 0; j + 2 < base; j += 3) indices.push(indices[j], indices[j + 2], indices[j + 1]);
  }

  const posF32 = new Float32Array(positions);
  const numVerts = positions.length / 3;
  let shapeId;
  if (typeof HK._malloc === 'function' && HK.HEAPU8) {
    const posOffset = HK._malloc(posF32.byteLength);
    new Float32Array(HK.HEAPU8.buffer, posOffset, posF32.length).set(posF32);
    try {
      if (isConvex) {
        const c = HK.HP_Shape_CreateConvexHull(posOffset, numVerts); checkResult(c[0], 'HP_Shape_CreateConvexHull'); shapeId = c[1];
      } else {
        const triOffset = HK._malloc(indices.length * 4);
        const triView = new Int32Array(HK.HEAPU8.buffer, triOffset, indices.length);
        for (let j = 0; j < indices.length; j++) triView[j] = indices[j];
        try { const c = HK.HP_Shape_CreateMesh(posOffset, numVerts, triOffset, indices.length / 3); checkResult(c[0], 'HP_Shape_CreateMesh'); shapeId = c[1]; }
        finally { HK._free(triOffset); }
      }
    } finally { HK._free(posOffset); }
  } else {
    if (isConvex) { const c = HK.HP_Shape_CreateConvexHull(posF32); checkResult(c[0], 'HP_Shape_CreateConvexHull'); shapeId = c[1]; }
    else { const c = HK.HP_Shape_CreateMesh(posF32, new Uint32Array(indices)); checkResult(c[0], 'HP_Shape_CreateMesh'); shapeId = c[1]; }
  }
  if (typeof shapeId === 'bigint') shapeId = Number(shapeId);

  // AABB (for density + camera framing) and a wireframe edge list (for debug display).
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let j = 0; j < positions.length; j += 3) {
    minX = Math.min(minX, positions[j]); maxX = Math.max(maxX, positions[j]);
    minY = Math.min(minY, positions[j + 1]); maxY = Math.max(maxY, positions[j + 1]);
    minZ = Math.min(minZ, positions[j + 2]); maxZ = Math.max(maxZ, positions[j + 2]);
  }
  if (!shapeId || shapeId <= 0) { // fallback to an AABB box
    const fb = HK.HP_Shape_CreateBox([0, 0, 0], IDENTITY_QUATERNION, [maxX - minX, maxY - minY, maxZ - minZ]);
    checkResult(fb[0], 'HP_Shape_CreateBox (mesh fallback)'); shapeId = fb[1];
    if (typeof shapeId === 'bigint') shapeId = Number(shapeId);
  }
  if (motionDef) {
    const v = Math.max((maxX - minX) * (maxY - minY) * (maxZ - minZ), 0.0001);
    checkResult(HK.HP_Shape_SetDensity(shapeId, (motionDef.mass != null && motionDef.mass > 0) ? motionDef.mass / v : 1), 'SetDensity mesh');
  }
  applyPhysicsMaterial(shapeId, matDef);

  const edgeVerts = [];
  for (let j = 0; j + 2 < wireIndices.length; j += 3) {
    const a = wireIndices[j] * 3, b = wireIndices[j + 1] * 3, c = wireIndices[j + 2] * 3;
    edgeVerts.push(positions[a], positions[a + 1], positions[a + 2], positions[b], positions[b + 1], positions[b + 2]);
    edgeVerts.push(positions[b], positions[b + 1], positions[b + 2], positions[c], positions[c + 1], positions[c + 2]);
    edgeVerts.push(positions[c], positions[c + 1], positions[c + 2], positions[a], positions[a + 1], positions[a + 2]);
  }
  return {
    shapeId, shapeType: 'mesh',
    aabb: { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] },
    meshVerts: edgeVerts.length > 0 ? new Float32Array(edgeVerts) : null,
  };
}

// KHR_physics_rigid_bodies motion: mass=0 means infinite mass, inertiaDiagonal=0 means a locked
// axis. Havok honours these when written via HP_Body_SetMassProperties.
function applyMotionMassProperties(bodyId, motionDef) {
  if (!motionDef || typeof HK.HP_Body_GetMassProperties !== 'function' || typeof HK.HP_Body_SetMassProperties !== 'function') return;
  const hasMass = motionDef.mass !== undefined;
  const hasDiag = Array.isArray(motionDef.inertiaDiagonal);
  const hasOrient = Array.isArray(motionDef.inertiaOrientation);
  const hasCom = Array.isArray(motionDef.centerOfMass);
  if (!hasMass && !hasDiag && !hasOrient && !hasCom) return;
  const mpRes = HK.HP_Body_GetMassProperties(bodyId);
  checkResult(mpRes[0], 'HP_Body_GetMassProperties');
  const mp = mpRes[1]; let changed = false;
  if (Array.isArray(mp)) {
    let vec3Count = 0;
    for (let i = 0; i < mp.length; i++) {
      const slot = mp[i];
      if (!Array.isArray(slot)) { if (hasMass) { mp[i] = motionDef.mass; changed = true; } continue; }
      if (slot.length === 4 && hasOrient) {
        slot[0] = motionDef.inertiaOrientation[0]; slot[1] = motionDef.inertiaOrientation[1];
        slot[2] = motionDef.inertiaOrientation[2]; slot[3] = motionDef.inertiaOrientation[3];
        changed = true; continue;
      }
      if (slot.length === 3) {
        if (vec3Count === 0 && hasCom) { slot[0] = motionDef.centerOfMass[0]; slot[1] = motionDef.centerOfMass[1]; slot[2] = motionDef.centerOfMass[2]; changed = true; }
        else if (vec3Count === 1 && hasDiag) { slot[0] = motionDef.inertiaDiagonal[0]; slot[1] = motionDef.inertiaDiagonal[1]; slot[2] = motionDef.inertiaDiagonal[2]; changed = true; }
        vec3Count++;
      }
    }
  }
  if (changed) checkResult(HK.HP_Body_SetMassProperties(bodyId, mp), 'HP_Body_SetMassProperties override');
}

function createBody(shapeId, motionType, position, rotation, setMass, motionDef) {
  const c = HK.HP_Body_Create(); checkResult(c[0], 'HP_Body_Create');
  const bodyId = c[1];
  checkResult(HK.HP_Body_SetShape(bodyId, shapeId), 'HP_Body_SetShape');
  checkResult(HK.HP_Body_SetMotionType(bodyId, motionType), 'HP_Body_SetMotionType');
  if (setMass) {
    const mr = HK.HP_Shape_BuildMassProperties(shapeId); checkResult(mr[0], 'HP_Shape_BuildMassProperties');
    checkResult(HK.HP_Body_SetMassProperties(bodyId, mr[1]), 'HP_Body_SetMassProperties');
    applyMotionMassProperties(bodyId, motionDef);
  }
  if (motionDef && motionDef.gravityFactor !== undefined && typeof HK.HP_Body_SetGravityFactor === 'function') {
    checkResult(HK.HP_Body_SetGravityFactor(bodyId, motionDef.gravityFactor), 'HP_Body_SetGravityFactor');
  }
  checkResult(HK.HP_Body_SetPosition(bodyId, position), 'HP_Body_SetPosition');
  checkResult(HK.HP_Body_SetOrientation(bodyId, rotation), 'HP_Body_SetOrientation');
  checkResult(HK.HP_World_AddBody(worldId, bodyId, false), 'HP_World_AddBody');
  return bodyId;
}

function expandSceneBounds(pos, boundRadius) {
  for (let k = 0; k < 3; k++) {
    sceneMin[k] = Math.min(sceneMin[k], pos[k] - boundRadius);
    sceneMax[k] = Math.max(sceneMax[k], pos[k] + boundRadius);
  }
}

function boundRadiusFor(shape) {
  if (shape.aabb) {
    const e = [shape.aabb.max[0] - shape.aabb.min[0], shape.aabb.max[1] - shape.aabb.min[1], shape.aabb.max[2] - shape.aabb.min[2]];
    const cen = [Math.abs(shape.aabb.min[0] + e[0] / 2), Math.abs(shape.aabb.min[1] + e[1] / 2), Math.abs(shape.aabb.min[2] + e[2] / 2)];
    return 0.5 * Math.hypot(e[0], e[1], e[2]) + Math.hypot(cen[0], cen[1], cen[2]);
  }
  return 0.5 * Math.hypot(shape.size[0], shape.size[1], shape.size[2]);
}

async function initPhysicsFromUrl(meshUrl, filamentAsset, filamentEngine) {
  const ab = await (await fetch(meshUrl)).arrayBuffer();
  const head = new Uint8Array(ab, 0, 4);
  const isGlb = head[0] === 0x67 && head[1] === 0x6c && head[2] === 0x54 && head[3] === 0x46;
  let gltfJson, bufferData;
  if (isGlb) {
    const dv = new DataView(ab);
    const jsonLen = dv.getUint32(12, true);
    gltfJson = JSON.parse(new TextDecoder().decode(new Uint8Array(ab, 20, jsonLen)));
    bufferData = ab.slice(20 + jsonLen + 8); // skip JSON chunk + BIN chunk header (8 bytes)
  } else {
    gltfJson = JSON.parse(new TextDecoder().decode(new Uint8Array(ab)));
    bufferData = new ArrayBuffer(0);
  }

  const ext = gltfJson.extensions || {};
  const shapeDefs = ext.KHR_implicit_shapes?.shapes || [];
  const matDefs = ext.KHR_physics_rigid_bodies?.physicsMaterials || [];
  const nodes = gltfJson.nodes || [];
  const worldMats = buildWorldTransforms(gltfJson);
  const accessors = buildAccessorCache(gltfJson, bufferData);

  const parentMap = new Map();
  for (let i = 0; i < nodes.length; i++) for (const c of (nodes[i].children || [])) parentMap.set(c, i);

  const nodeEntityMap = buildNodeEntityMap(gltfJson, filamentAsset, filamentEngine);

  const created = HK.HP_World_Create();
  checkResult(created[0], 'HP_World_Create');
  worldId = created[1];
  checkResult(HK.HP_World_SetGravity(worldId, [0, -9.8, 0]), 'HP_World_SetGravity');
  checkResult(HK.HP_World_SetIdealStepTime(worldId, FIXED_TIMESTEP), 'HP_World_SetIdealStepTime');

  for (let i = 0; i < nodes.length; i++) {
    const physExt = nodes[i].extensions?.KHR_physics_rigid_bodies;
    const geom = physExt?.collider?.geometry;
    if (!geom) continue;
    const motionDef = physExt.motion || null;
    const matDef = physExt.collider.physicsMaterial !== undefined ? matDefs[physExt.collider.physicsMaterial] : null;
    const worldScale = vec3.create();
    mat4.getScaling(worldScale, worldMats[i]);

    let shape;
    if (geom.shape !== undefined) {
      const shapeDef = shapeDefs[geom.shape];
      if (!shapeDef) continue;
      shape = createImplicitShape(shapeDef, worldScale, motionDef, matDef);
    } else {
      shape = createMeshShape(gltfJson, accessors, worldMats[i], geom, motionDef, matDef);
    }
    if (!shape) continue;

    const wPos = vec3.create(); mat4.getTranslation(wPos, worldMats[i]);
    const wRot = quat.create(); getRotationFromMat(wRot, worldMats[i]);
    const initPos = [wPos[0], wPos[1], wPos[2]];
    const initRot = [wRot[0], wRot[1], wRot[2], wRot[3]];

    const bodyId = createBody(
      shape.shapeId,
      motionDef ? HK.MotionType.DYNAMIC : HK.MotionType.STATIC,
      initPos, initRot, !!motionDef, motionDef,
    );
    expandSceneBounds(initPos, boundRadiusFor(shape));

    if (motionDef) {
      const nodeScale = [worldScale[0], worldScale[1], worldScale[2]];
      const parentInvWorldMat = mat4.create();
      const pIdx = parentMap.get(i);
      if (pIdx !== undefined) mat4.invert(parentInvWorldMat, worldMats[pIdx]);
      const name = nodes[i].name;
      const named = name ? filamentAsset.getEntitiesByName(name) : [];
      const entity = named.length > 0 ? named[0] : (nodeEntityMap.get(i) || null);
      if (!entity) console.warn('[physics] no Filament entity for node', i, name || '(unnamed)');
      physicsNodes.push({ entity, bodyId, nodeScale, initPos, initRot, parentInvWorldMat, shape });
      if (entity) {
        const rm = filamentEngine.getRenderableManager();
        const inst = rm.getInstance(entity);
        if (inst) { rm.setCulling(inst, false); inst.delete(); }
      }
    } else {
      staticBodies.push({ bodyId, shape });
    }
  }

  console.log('[Filament+Havok] physics ready:', physicsNodes.length, 'dynamic,', staticBodies.length, 'static');
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
      // Wireframe lives at the scene root, so no parentInv is needed; its vertices already encode
      // the collider's size, so no scale is applied either.
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

function makeCapsuleLineVerts(radius, halfHeight, segments = 16) {
  const v = [];
  for (let s = 0; s < 2; s++) {
    const y = s === 0 ? -halfHeight : halfHeight;
    for (let i = 0; i < segments; i++) {
      const a0 = (i / segments) * Math.PI * 2, a1 = ((i + 1) / segments) * Math.PI * 2;
      v.push(Math.cos(a0) * radius, y, Math.sin(a0) * radius, Math.cos(a1) * radius, y, Math.sin(a1) * radius);
    }
  }
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    v.push(Math.cos(a) * radius, -halfHeight, Math.sin(a) * radius, Math.cos(a) * radius, halfHeight, Math.sin(a) * radius);
  }
  for (let s = 0; s < 2; s++) {
    const sign = s === 0 ? -1 : 1, yOff = sign * halfHeight, half = segments / 2, baseAng = sign < 0 ? Math.PI : 0;
    for (let plane = 0; plane < 2; plane++) {
      for (let i = 0; i < half; i++) {
        const a0 = baseAng + (i / half) * Math.PI, a1 = baseAng + ((i + 1) / half) * Math.PI;
        const c0 = Math.cos(a0) * radius, s0 = Math.sin(a0) * radius, c1 = Math.cos(a1) * radius, s1 = Math.sin(a1) * radius;
        if (plane === 0) v.push(c0, yOff + s0, 0, c1, yOff + s1, 0);
        else v.push(0, yOff + s0, c0, 0, yOff + s1, c1);
      }
    }
  }
  return new Float32Array(v);
}

function makeCylinderLineVerts(radius, halfHeight, segments = 16) {
  const v = [];
  for (let s = 0; s < 2; s++) {
    const y = s === 0 ? -halfHeight : halfHeight;
    for (let i = 0; i < segments; i++) {
      const a0 = (i / segments) * Math.PI * 2, a1 = ((i + 1) / segments) * Math.PI * 2;
      v.push(Math.cos(a0) * radius, y, Math.sin(a0) * radius, Math.cos(a1) * radius, y, Math.sin(a1) * radius);
    }
  }
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    v.push(Math.cos(a) * radius, -halfHeight, Math.sin(a) * radius, Math.cos(a) * radius, halfHeight, Math.sin(a) * radius);
  }
  return new Float32Array(v);
}

function debugVertsFor(shape) {
  if (shape.debugVerts) return shape.debugVerts;
  let verts;
  if (shape.meshVerts) verts = shape.meshVerts;
  else if (shape.shapeType === 'sphere') verts = makeSphereLineVerts(shape.size[0] / 2);
  else if (shape.shapeType === 'capsule') verts = makeCapsuleLineVerts(shape.size[0] / 2, Math.max(shape.size[1] / 2 - shape.size[0] / 2, 0));
  else if (shape.shapeType === 'cylinder') verts = makeCylinderLineVerts(shape.size[0] / 2, shape.size[1] / 2);
  else verts = makeBoxLineVerts(shape.size[0], shape.size[1], shape.size[2]);
  shape.debugVerts = verts;
  return verts;
}

// ---- In-code wireframe GLB (LINES primitives + KHR_materials_unlit) ----
function alignTo4(n) { return (n + 3) & ~3; }

// Builds a GLB from a list of meshes (each with positions + indices + color) and nodes (each
// referencing a mesh index by name). Returns the GLB bytes.
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

// One LINES mesh per physics body (each shape has unique geometry from debugVertsFor()) + one
// unlit material per body (orange dynamic, green static). The wireframe entity for each body
// follows the body's world transform every frame (or is placed once for static bodies).
async function loadWireframeAsset() {
  const meshes = [];
  const nodes = [];
  function makeSequentialIndices(vertCount) {
    const out = new Uint32Array(vertCount);
    for (let i = 0; i < vertCount; i++) out[i] = i;
    return out;
  }
  for (let i = 0; i < physicsNodes.length; i++) {
    const verts = debugVertsFor(physicsNodes[i].shape);
    meshes.push({ positions: verts, indices: makeSequentialIndices(verts.length / 3), color: DEBUG_COLOR_DYNAMIC });
    nodes.push({ name: 'dynWire' + i, meshIndex: meshes.length - 1 });
  }
  for (let i = 0; i < staticBodies.length; i++) {
    const verts = debugVertsFor(staticBodies[i].shape);
    meshes.push({ positions: verts, indices: makeSequentialIndices(verts.length / 3), color: DEBUG_COLOR_STATIC });
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
  for (let i = 0; i < physicsNodes.length; i++) {
    physicsNodes[i].wireframeEntity = a.getEntitiesByName('dynWire' + i)[0] || null;
  }
  for (let i = 0; i < staticBodies.length; i++) {
    staticBodies[i].wireframeEntity = a.getEntitiesByName('staticWire' + i)[0] || null;
  }
  // Place static wireframes at their bodies' initial world transforms; they don't move afterward.
  const tcm = engine.getTransformManager();
  tcm.openLocalTransformTransaction();
  for (const sb of staticBodies) {
    if (!sb.wireframeEntity) continue;
    const pr = HK.HP_Body_GetPosition(sb.bodyId);
    const qr = HK.HP_Body_GetOrientation(sb.bodyId);
    const p = pr[1], r = qr[1];
    const m = mat4.fromRotationTranslation(mat4.create(),
      quat.fromValues(r[0], r[1], r[2], r[3]), vec3.fromValues(p[0], p[1], p[2]));
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
  // Explicit LINEAR color grading; the default path trips a "uniform buffer too small" GL error
  // at feature level 1.
  const colorGrading = Filament.ColorGrading.Builder().toneMapping(ToneMapping.LINEAR).build(engine);
  view.setColorGrading(colorGrading);
  renderer.setClearOptions({ clearColor: [0.6, 0.6, 0.6, 1.0], clear: true });

  // Load the model. (The model carries KHR_lights_punctual lights; adding them makes Filament
  // froxelize punctual lighting, which trips "glDrawElementsInstanced: uniform buffer too small" on
  // base_lit_opaque at feature level 1. We light with IBL + a directional SUN instead — popping
  // renderables here uses popRenderable() which skips the punctual lights.)
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
  const center = [(sceneMin[0] + sceneMax[0]) / 2, (sceneMin[1] + sceneMax[1]) / 2, (sceneMin[2] + sceneMax[2]) / 2];
  const span = Math.max(sceneMax[0] - sceneMin[0], sceneMax[1] - sceneMin[1], sceneMax[2] - sceneMin[2], 1);
  const radius = span * 0.5;
  const camTarget = [...center];
  let camTheta  = 0.6;   // azimuth (rad)
  let camPhi    = Math.atan2(radius * 0.35, radius * 1.5);   // ~0.23
  let camRadius = Math.sqrt((radius * 1.5) ** 2 + (radius * 0.35) ** 2);
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
