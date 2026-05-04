import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const MODEL_URL = 'https://raw.githubusercontent.com/eoineoineoin/glTF_Physics/master/samples/Filtering/Filtering.glb';
const FIXED_TIMESTEP = 1 / 60;
const RESET_Y_THRESHOLD = -20;
const IDENTITY_QUATERNION = [0, 0, 0, 1];
const SHOW_DEBUG_COLLIDERS = true;

let HK;
let worldId;

let scene;
let camera;
let renderer;
let controls;

const physicsNodes = [];
const dynamicNodes = [];
const processedNodeIndices = new Set();

const tmpWorldPosition = new THREE.Vector3();
const tmpWorldQuaternion = new THREE.Quaternion();
const tmpWorldScale = new THREE.Vector3();
const tmpParentPosition = new THREE.Vector3();
const tmpParentQuaternion = new THREE.Quaternion();
const tmpParentScale = new THREE.Vector3();

function enumToNumber(value) {
  if (typeof value === 'number' || typeof value === 'bigint') {
    return Number(value);
  }
  if (!value || typeof value !== 'object') {
    return NaN;
  }
  if (typeof value.value === 'number' || typeof value.value === 'bigint') {
    return Number(value.value);
  }
  if (typeof value.m_value === 'number' || typeof value.m_value === 'bigint') {
    return Number(value.m_value);
  }
  return NaN;
}

function checkResult(result, label) {
  if (result === HK.Result.RESULT_OK) {
    return;
  }
  const resultCode = enumToNumber(result);
  const okCode = enumToNumber(HK.Result.RESULT_OK);
  if (!Number.isNaN(resultCode) && !Number.isNaN(okCode) && resultCode === okCode) {
    return;
  }
  if (typeof result === 'object' && typeof HK.Result.RESULT_OK === 'object') {
    try {
      if (JSON.stringify(result) === JSON.stringify(HK.Result.RESULT_OK)) {
        return;
      }
    } catch (_error) {}
  }
  throw new Error(label + ' failed with code: ' + String(result));
}

// Collision filtering helpers

function parseSystemList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  return String(value).split(/\s+/).filter(Boolean);
}

function buildSystemBitMap(filterDefs) {
  const map = new Map();
  let nextBit = 0;
  for (const f of filterDefs) {
    for (const sys of [...parseSystemList(f.collisionSystems), ...parseSystemList(f.collideWithSystems)]) {
      if (!map.has(sys)) {
        map.set(sys, 1 << nextBit++);
      }
    }
  }
  return map;
}

function applyCollisionFilter(shapeId, filterDef, systemBitMap) {
  if (!filterDef || typeof HK.HP_Shape_SetFilterInfo !== 'function') return;
  const membership = parseSystemList(filterDef.collisionSystems)
    .reduce((m, s) => m | (systemBitMap.get(s) || 0), 0);
  const collide = parseSystemList(filterDef.collideWithSystems)
    .reduce((m, s) => m | (systemBitMap.get(s) || 0), 0);
  HK.HP_Shape_SetFilterInfo(shapeId, [membership || 0xFFFF, collide || 0xFFFF]);
}

function initThree() {
  const container = document.getElementById('container');

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf6f7fa);

  camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 500);
  camera.position.set(10, 7, 10);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  const hemi = new THREE.HemisphereLight(0xffffff, 0x3f4650, 0.9);
  scene.add(hemi);

  const dir = new THREE.DirectionalLight(0xffffff, 1.0);
  dir.position.set(8, 16, 10);
  dir.castShadow = true;
  dir.shadow.camera.left = -16;
  dir.shadow.camera.right = 16;
  dir.shadow.camera.top = 16;
  dir.shadow.camera.bottom = -16;
  dir.shadow.camera.near = 0.1;
  dir.shadow.camera.far = 80;
  scene.add(dir);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.5;

  window.addEventListener('resize', onWindowResize);
}

function initPhysicsWorld() {
  const created = HK.HP_World_Create();
  checkResult(created[0], 'HP_World_Create');
  worldId = created[1];
  checkResult(HK.HP_World_SetGravity(worldId, [0, -9.8, 0]), 'HP_World_SetGravity');
  checkResult(HK.HP_World_SetIdealStepTime(worldId, FIXED_TIMESTEP), 'HP_World_SetIdealStepTime');
}

function applyPhysicsMaterial(shapeId, materialDef) {
  if (!materialDef || typeof HK.HP_Shape_SetMaterial !== 'function') return;
  const df = materialDef.dynamicFriction !== undefined ? materialDef.dynamicFriction : 0.5;
  const sf = materialDef.staticFriction !== undefined ? materialDef.staticFriction : 0.5;
  const r = materialDef.restitution !== undefined ? materialDef.restitution : 0.0;
  HK.HP_Shape_SetMaterial(shapeId, [df, sf, r, HK.MaterialCombine.MAXIMUM, HK.MaterialCombine.MINIMUM]);
}

function buildFrustumHullPoints(halfHeight, radiusBottom, radiusTop, segments = 16) {
  const pts = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const cos = Math.cos(a), sin = Math.sin(a);
    if (radiusBottom > 0.0001) pts.push(radiusBottom * cos, -halfHeight, radiusBottom * sin);
    if (radiusTop > 0.0001) pts.push(radiusTop * cos, halfHeight, radiusTop * sin);
  }
  if (radiusBottom <= 0.0001) pts.push(0, -halfHeight, 0);
  if (radiusTop <= 0.0001) pts.push(0, halfHeight, 0);
  return new Float32Array(pts);
}

function createConvexHullFromPoints(pts) {
  const nPoints = pts.length / 3;
  if (typeof HK._malloc === 'function' && HK.HEAPU8) {
    const ptr = HK._malloc(pts.byteLength);
    new Float32Array(HK.HEAPU8.buffer, ptr, pts.length).set(pts);
    let result;
    try {
      result = HK.HP_Shape_CreateConvexHull(ptr, nPoints);
    } finally {
      HK._free(ptr);
    }
    checkResult(result[0], 'HP_Shape_CreateConvexHull');
    return result[1];
  }
  const res = HK.HP_Shape_CreateConvexHull(pts, nPoints);
  checkResult(res[0], 'HP_Shape_CreateConvexHull');
  return res[1];
}

function createImplicitShape(worldScale, shapeDef, motionDef, materialDef) {
  if (!shapeDef) throw new Error('No shape definition provided.');

  let shapeId;
  let size;

  if (shapeDef.type === 'box' && shapeDef.box) {
    const s = shapeDef.box.size || [1, 1, 1];
    size = [Math.abs(s[0] * worldScale.x), Math.abs(s[1] * worldScale.y), Math.abs(s[2] * worldScale.z)];
    const res = HK.HP_Shape_CreateBox([0, 0, 0], IDENTITY_QUATERNION, size);
    checkResult(res[0], 'HP_Shape_CreateBox');
    shapeId = res[1];
    if (motionDef) {
      const volume = Math.max(size[0] * size[1] * size[2], 0.0001);
      const density = (motionDef.mass !== undefined && motionDef.mass > 0) ? motionDef.mass / volume : 1;
      checkResult(HK.HP_Shape_SetDensity(shapeId, density), 'HP_Shape_SetDensity');
    }
  } else if (shapeDef.type === 'sphere' && shapeDef.sphere) {
    const baseR = shapeDef.sphere.radius !== undefined ? shapeDef.sphere.radius : 0.5;
    const maxS = Math.max(Math.abs(worldScale.x), Math.abs(worldScale.y), Math.abs(worldScale.z));
    const r = Math.max(baseR * maxS, 0.0001);
    const res = HK.HP_Shape_CreateSphere([0, 0, 0], r);
    checkResult(res[0], 'HP_Shape_CreateSphere');
    shapeId = res[1];
    size = [r * 2, r * 2, r * 2];
  } else if (shapeDef.type === 'capsule' && shapeDef.capsule) {
    const cd = shapeDef.capsule;
    const rTop = cd.radiusTop !== undefined ? cd.radiusTop : (cd.radius !== undefined ? cd.radius : 0.5);
    const rBot = cd.radiusBottom !== undefined ? cd.radiusBottom : (cd.radius !== undefined ? cd.radius : 0.5);
    const h = cd.height !== undefined ? cd.height : 1.0;
    const sXZ = Math.max(Math.abs(worldScale.x), Math.abs(worldScale.z));
    const sr = Math.max((rTop + rBot) * 0.5 * sXZ, 0.0001);
    const shaftH = Math.max(h * Math.abs(worldScale.y) * 0.5, 0);
    const res = HK.HP_Shape_CreateCapsule([0, -shaftH, 0], [0, shaftH, 0], sr);
    checkResult(res[0], 'HP_Shape_CreateCapsule');
    shapeId = res[1];
    size = [sr * 2, shaftH * 2 + sr * 2, sr * 2];
  } else if (shapeDef.type === 'cylinder' && shapeDef.cylinder) {
    const cyd = shapeDef.cylinder;
    const rT = cyd.radiusTop !== undefined ? cyd.radiusTop : (cyd.radius !== undefined ? cyd.radius : 0.5);
    const rB = cyd.radiusBottom !== undefined ? cyd.radiusBottom : (cyd.radius !== undefined ? cyd.radius : 0.5);
    const cH = cyd.height !== undefined ? cyd.height : 1.0;
    const sXZ = Math.max(Math.abs(worldScale.x), Math.abs(worldScale.z));
    const rT_s = rT * sXZ;
    const rB_s = rB * sXZ;
    const sHH = Math.max(cH * Math.abs(worldScale.y) * 0.5, 0.0001);
    const maxR = Math.max(rT_s, rB_s, 0.0001);
    if (Math.abs(rT_s - rB_s) < 0.001 * maxR && typeof HK.HP_Shape_CreateCylinder === 'function') {
      const res = HK.HP_Shape_CreateCylinder([0, -sHH, 0], [0, sHH, 0], maxR);
      checkResult(res[0], 'HP_Shape_CreateCylinder');
      shapeId = res[1];
    } else {
      shapeId = createConvexHullFromPoints(buildFrustumHullPoints(sHH, rB_s, rT_s));
    }
    size = [maxR * 2, sHH * 2, maxR * 2];
  } else {
    throw new Error('Unsupported KHR_implicit_shapes type: ' + shapeDef.type);
  }

  applyPhysicsMaterial(shapeId, materialDef);
  return { shapeId, size: size || [1, 1, 1], shapeType: shapeDef.type };
}

function createMeshShape(colliderScale, geomDef, meshIndexToGeos, jsonNodes, motionDef) {
  let meshIndex = geomDef.mesh;
  if (meshIndex === undefined && geomDef.node !== undefined) {
    meshIndex = jsonNodes[geomDef.node]?.mesh;
  }
  if (meshIndex === undefined) return null;

  const isConvex = !!geomDef.convexHull || !!motionDef;
  const geoList = meshIndexToGeos.get(meshIndex);
  if (!geoList || geoList.length === 0) return null;

  const allPositions = [];
  const allIndices = [];
  let vertexOffset = 0;

  for (const geo of geoList) {
    const pos = geo.attributes.position.array;
    for (let i = 0; i < pos.length; i += 3) {
      allPositions.push(pos[i] * colliderScale.x, pos[i + 1] * colliderScale.y, pos[i + 2] * colliderScale.z);
    }
    if (!isConvex) {
      if (geo.index) {
        const idx = geo.index.array;
        for (let i = 0; i < idx.length; i++) allIndices.push(idx[i] + vertexOffset);
      } else {
        const vCount = pos.length / 3;
        for (let i = 0; i + 2 < vCount; i += 3) {
          allIndices.push(vertexOffset + i, vertexOffset + i + 1, vertexOffset + i + 2);
        }
      }
    }
    vertexOffset += pos.length / 3;
  }

  const posFloat32 = new Float32Array(allPositions);
  const numVertices = allPositions.length / 3;
  let shapeId;

  try {
    if (isConvex) {
      if (typeof HK._malloc === 'function' && HK.HEAPU8) {
        const posBytes = posFloat32.length * 4;
        const posOffset = HK._malloc(posBytes);
        new Float32Array(HK.HEAPU8.buffer, posOffset, posFloat32.length).set(posFloat32);
        try {
          const res = HK.HP_Shape_CreateConvexHull(posOffset, numVertices);
          checkResult(res[0], 'HP_Shape_CreateConvexHull');
          shapeId = res[1];
        } finally {
          HK._free(posOffset);
        }
      } else {
        const res = HK.HP_Shape_CreateConvexHull(posFloat32);
        checkResult(res[0], 'HP_Shape_CreateConvexHull');
        shapeId = res[1];
      }
    } else {
      const indUint32 = new Uint32Array(allIndices);
      const numTris = allIndices.length / 3;
      if (typeof HK._malloc === 'function' && HK.HEAPU8) {
        const posBytes = posFloat32.length * 4;
        const posOffset = HK._malloc(posBytes);
        new Float32Array(HK.HEAPU8.buffer, posOffset, posFloat32.length).set(posFloat32);
        const triBytes = indUint32.length * 4;
        const triOffset = HK._malloc(triBytes);
        new Int32Array(HK.HEAPU8.buffer, triOffset, indUint32.length).set(new Int32Array(indUint32.buffer));
        try {
          const res = HK.HP_Shape_CreateMesh(posOffset, numVertices, triOffset, numTris);
          checkResult(res[0], 'HP_Shape_CreateMesh');
          shapeId = res[1];
        } finally {
          HK._free(triOffset);
          HK._free(posOffset);
        }
      } else {
        const res = HK.HP_Shape_CreateMesh(posFloat32, indUint32);
        checkResult(res[0], 'HP_Shape_CreateMesh');
        shapeId = res[1];
      }
    }
  } catch (e) {
    console.warn('[Havok] Mesh shape creation failed, using box fallback:', e.message);
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < allPositions.length; i += 3) {
      minX = Math.min(minX, allPositions[i]); maxX = Math.max(maxX, allPositions[i]);
      minY = Math.min(minY, allPositions[i + 1]); maxY = Math.max(maxY, allPositions[i + 1]);
      minZ = Math.min(minZ, allPositions[i + 2]); maxZ = Math.max(maxZ, allPositions[i + 2]);
    }
    const res = HK.HP_Shape_CreateBox([0, 0, 0], IDENTITY_QUATERNION, [
      Math.max(maxX - minX, 0.1), Math.max(maxY - minY, 0.1), Math.max(maxZ - minZ, 0.1)
    ]);
    checkResult(res[0], 'HP_Shape_CreateBox (mesh fallback)');
    shapeId = res[1];
  }

  if (!shapeId) return null;

  if (motionDef) {
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < allPositions.length; i += 3) {
      minX = Math.min(minX, allPositions[i]); maxX = Math.max(maxX, allPositions[i]);
      minY = Math.min(minY, allPositions[i + 1]); maxY = Math.max(maxY, allPositions[i + 1]);
      minZ = Math.min(minZ, allPositions[i + 2]); maxZ = Math.max(maxZ, allPositions[i + 2]);
    }
    const volume = Math.max((maxX - minX) * (maxY - minY) * (maxZ - minZ), 0.0001);
    const specMass = motionDef.mass;
    const density = (specMass !== undefined && specMass > 0) ? specMass / volume : 1;
    checkResult(HK.HP_Shape_SetDensity(shapeId, density), 'HP_Shape_SetDensity mesh');
  }

  return { shapeId, size: [1, 1, 1], shapeType: 'mesh' };
}

function createDebugMesh(shapeInfo, isDynamic) {
  const color = isDynamic ? 0xff8844 : 0x44ee88;
  const mat = new THREE.LineBasicMaterial({ color });
  const [w, h, d] = shapeInfo.size;
  let geo;
  if (shapeInfo.shapeType === 'sphere') {
    geo = new THREE.WireframeGeometry(new THREE.SphereGeometry(w / 2, 8, 6));
  } else if (shapeInfo.shapeType === 'capsule') {
    const r = w / 2;
    const shaftLen = Math.max(h - w, 0);
    geo = new THREE.WireframeGeometry(new THREE.CapsuleGeometry(r, shaftLen, 4, 8));
  } else if (shapeInfo.shapeType === 'cylinder') {
    geo = new THREE.EdgesGeometry(new THREE.CylinderGeometry(w / 2, w / 2, h, 12));
  } else {
    geo = new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, d));
  }
  const mesh = new THREE.LineSegments(geo, mat);
  scene.add(mesh);
  return mesh;
}

function createBody(shapeId, motionType, position, rotation, motionDef) {
  const created = HK.HP_Body_Create();
  checkResult(created[0], 'HP_Body_Create');
  const bodyId = created[1];

  checkResult(HK.HP_Body_SetShape(bodyId, shapeId), 'HP_Body_SetShape');
  checkResult(HK.HP_Body_SetMotionType(bodyId, motionType), 'HP_Body_SetMotionType');

  if (motionDef) {
    const massResult = HK.HP_Shape_BuildMassProperties(shapeId);
    checkResult(massResult[0], 'HP_Shape_BuildMassProperties');
    checkResult(HK.HP_Body_SetMassProperties(bodyId, massResult[1]), 'HP_Body_SetMassProperties');

    if (motionDef.gravityFactor !== undefined && typeof HK.HP_Body_SetGravityFactor === 'function') {
      checkResult(HK.HP_Body_SetGravityFactor(bodyId, motionDef.gravityFactor), 'HP_Body_SetGravityFactor');
    }
    if (Array.isArray(motionDef.linearVelocity) && typeof HK.HP_Body_SetLinearVelocity === 'function') {
      checkResult(HK.HP_Body_SetLinearVelocity(bodyId, motionDef.linearVelocity), 'HP_Body_SetLinearVelocity');
    }
    if (Array.isArray(motionDef.angularVelocity) && typeof HK.HP_Body_SetAngularVelocity === 'function') {
      checkResult(HK.HP_Body_SetAngularVelocity(bodyId, motionDef.angularVelocity), 'HP_Body_SetAngularVelocity');
    }
  }

  checkResult(HK.HP_Body_SetPosition(bodyId, position), 'HP_Body_SetPosition');
  checkResult(HK.HP_Body_SetOrientation(bodyId, rotation), 'HP_Body_SetOrientation');
  checkResult(HK.HP_World_AddBody(worldId, bodyId, false), 'HP_World_AddBody');
  return bodyId;
}

function setObjectWorldTransform(object, worldPosition, worldQuaternion) {
  if (!object.parent) {
    object.position.copy(worldPosition);
    object.quaternion.copy(worldQuaternion);
    return;
  }
  object.parent.updateWorldMatrix(true, false);
  object.parent.matrixWorld.decompose(tmpParentPosition, tmpParentQuaternion, tmpParentScale);
  object.position.copy(worldPosition).sub(tmpParentPosition);
  object.position.applyQuaternion(tmpParentQuaternion.clone().invert());
  object.position.divide(tmpParentScale);
  object.quaternion.copy(tmpParentQuaternion.clone().invert().multiply(worldQuaternion));
}

function updatePhysicsTransforms() {
  for (const node of physicsNodes) {
    const pResult = HK.HP_Body_GetPosition(node.bodyId);
    checkResult(pResult[0], 'HP_Body_GetPosition');
    const qResult = HK.HP_Body_GetOrientation(node.bodyId);
    checkResult(qResult[0], 'HP_Body_GetOrientation');
    tmpWorldPosition.set(pResult[1][0], pResult[1][1], pResult[1][2]);
    tmpWorldQuaternion.set(qResult[1][0], qResult[1][1], qResult[1][2], qResult[1][3]);
    setObjectWorldTransform(node.object, tmpWorldPosition, tmpWorldQuaternion);
  }
}

function resetDynamicBodiesIfNeeded() {
  for (const node of dynamicNodes) {
    const pResult = HK.HP_Body_GetPosition(node.bodyId);
    checkResult(pResult[0], 'HP_Body_GetPosition reset');
    if (pResult[1][1] >= RESET_Y_THRESHOLD) continue;
    checkResult(HK.HP_Body_SetPosition(node.bodyId, node.initialPosition), 'HP_Body_SetPosition reset');
    checkResult(HK.HP_Body_SetOrientation(node.bodyId, node.initialRotation), 'HP_Body_SetOrientation reset');
    checkResult(HK.HP_Body_SetLinearVelocity(node.bodyId, [0, 0, 0]), 'HP_Body_SetLinearVelocity reset');
    checkResult(HK.HP_Body_SetAngularVelocity(node.bodyId, [0, 0, 0]), 'HP_Body_SetAngularVelocity reset');
  }
}

function collectDescendantColliders(nodeIndex, jsonNodes, result, excludedSet) {
  const nodeDef = jsonNodes[nodeIndex];
  for (const childIdx of (nodeDef.children || [])) {
    const childDef = jsonNodes[childIdx];
    const childExt = childDef?.extensions?.KHR_physics_rigid_bodies;
    if (childExt?.motion) continue;
    if (childExt?.collider?.geometry) {
      result.push(childIdx);
      excludedSet.add(childIdx);
    }
    collectDescendantColliders(childIdx, jsonNodes, result, excludedSet);
  }
}

async function loadModelAndBuildPhysics() {
  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync(MODEL_URL);
  const root = gltf.scene;
  scene.add(root);

  root.traverse((object) => {
    if (object.isMesh) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });

  root.updateWorldMatrix(true, true);

  const box = new THREE.Box3().setFromObject(root);
  const center = box.getCenter(new THREE.Vector3());
  const radius = box.getSize(new THREE.Vector3()).length() * 0.45;
  controls.target.copy(center);
  camera.position.set(center.x + radius, center.y + radius * 0.45, center.z + radius);
  camera.far = Math.max(200, radius * 40);
  camera.updateProjectionMatrix();
  controls.update();

  const json = gltf.parser.json;
  const shapeDefs = json.extensions?.KHR_implicit_shapes?.shapes || [];
  const scenePhysics = json.extensions?.KHR_physics_rigid_bodies || {};
  const materialDefs = scenePhysics.physicsMaterials || [];
  const filterDefs = scenePhysics.collisionFilters || [];
  const associations = gltf.parser.associations;

  const systemBitMap = buildSystemBitMap(filterDefs);

  const nodeIndexToObject = new Map();
  const meshIndexToGeos = new Map();

  root.traverse((object) => {
    const assoc = associations.get(object);
    if (!assoc) return;
    if (assoc.nodes !== undefined && !nodeIndexToObject.has(assoc.nodes)) {
      nodeIndexToObject.set(assoc.nodes, object);
    }
    if (object.isMesh && assoc.meshes !== undefined) {
      if (!meshIndexToGeos.has(assoc.meshes)) meshIndexToGeos.set(assoc.meshes, []);
      meshIndexToGeos.get(assoc.meshes).push(object.geometry);
    }
  });

  const excludedNodeIndices = new Set();

  // Pass 1: compound bodies
  if (typeof HK.HP_Shape_CreateContainer === 'function') {
    for (let i = 0; i < (json.nodes || []).length; i++) {
      const nodeDef = json.nodes[i];
      const physicsExt = nodeDef?.extensions?.KHR_physics_rigid_bodies;
      if (!physicsExt?.motion || physicsExt.collider) continue;

      const childColliderIndices = [];
      collectDescendantColliders(i, json.nodes, childColliderIndices, excludedNodeIndices);
      if (childColliderIndices.length === 0) continue;

      const parentObject = nodeIndexToObject.get(i);
      if (!parentObject) continue;

      parentObject.updateWorldMatrix(true, false);
      parentObject.matrixWorld.decompose(tmpWorldPosition, tmpWorldQuaternion, tmpWorldScale);
      const parentPos = [tmpWorldPosition.x, tmpWorldPosition.y, tmpWorldPosition.z];
      const parentQuat = [tmpWorldQuaternion.x, tmpWorldQuaternion.y, tmpWorldQuaternion.z, tmpWorldQuaternion.w];
      const parentQuatInv = tmpWorldQuaternion.clone().invert();

      const containerRes = HK.HP_Shape_CreateContainer();
      checkResult(containerRes[0], 'HP_Shape_CreateContainer');
      const containerShapeId = containerRes[1];

      for (const childIdx of childColliderIndices) {
        const childDef = json.nodes[childIdx];
        const childExt = childDef?.extensions?.KHR_physics_rigid_bodies;
        if (!childExt?.collider?.geometry) continue;

        const childObject = nodeIndexToObject.get(childIdx);
        if (!childObject) continue;

        childObject.updateWorldMatrix(true, false);
        childObject.matrixWorld.decompose(tmpWorldPosition, tmpWorldQuaternion, tmpWorldScale);

        const childMaterialDef = childExt.collider.physicsMaterial !== undefined
          ? materialDefs[childExt.collider.physicsMaterial]
          : null;

        let childShapeResult;
        const childGeom = childExt.collider.geometry;
        if (childGeom.shape !== undefined) {
          childShapeResult = createImplicitShape(tmpWorldScale, shapeDefs[childGeom.shape], null, childMaterialDef);
        } else {
          childShapeResult = createMeshShape(tmpWorldScale, childGeom, meshIndexToGeos, json.nodes, null);
        }
        if (!childShapeResult) continue;

        const relPos = new THREE.Vector3(tmpWorldPosition.x, tmpWorldPosition.y, tmpWorldPosition.z)
          .sub(new THREE.Vector3(...parentPos))
          .applyQuaternion(parentQuatInv);
        const relQuat = parentQuatInv.clone().multiply(tmpWorldQuaternion);

        HK.HP_Shape_AddChild(containerShapeId, childShapeResult.shapeId, [
          [relPos.x, relPos.y, relPos.z],
          [relQuat.x, relQuat.y, relQuat.z, relQuat.w],
          [1, 1, 1]
        ]);
      }

      const motionDef = physicsExt.motion;
      const motionType = motionDef.isKinematic ? HK.MotionType.KINEMATIC : HK.MotionType.DYNAMIC;
      const bodyId = createBody(containerShapeId, motionType, parentPos, parentQuat, motionDef);

      const node = {
        object: parentObject,
        bodyId,
        initialPosition: parentPos,
        initialRotation: parentQuat,
        isDynamic: true
      };
      physicsNodes.push(node);
      dynamicNodes.push(node);
      processedNodeIndices.add(i);
    }
  }

  // Pass 2: single-shape bodies
  root.traverse((object) => {
    const association = associations.get(object);
    if (!association || association.nodes === undefined) return;
    if (processedNodeIndices.has(association.nodes)) return;
    if (excludedNodeIndices.has(association.nodes)) return;

    const nodeDef = json.nodes[association.nodes];
    const physicsExt = nodeDef?.extensions?.KHR_physics_rigid_bodies;
    if (!physicsExt?.collider?.geometry) return;

    const geomDef = physicsExt.collider.geometry;
    const motionDef = physicsExt.motion || null;
    const materialDef = physicsExt.collider.physicsMaterial !== undefined
      ? materialDefs[physicsExt.collider.physicsMaterial]
      : null;
    const filterIndex = physicsExt.collider.collisionFilter;
    const filterDef = filterIndex !== undefined ? filterDefs[filterIndex] : null;

    object.matrixWorld.decompose(tmpWorldPosition, tmpWorldQuaternion, tmpWorldScale);

    let shapeResult;
    if (geomDef.shape !== undefined) {
      try {
        shapeResult = createImplicitShape(tmpWorldScale, shapeDefs[geomDef.shape], motionDef, materialDef);
      } catch (e) {
        console.warn('[Havok] createImplicitShape failed:', e.message);
        return;
      }
    } else {
      shapeResult = createMeshShape(tmpWorldScale, geomDef, meshIndexToGeos, json.nodes, motionDef);
      if (!shapeResult) return;
    }

    applyCollisionFilter(shapeResult.shapeId, filterDef, systemBitMap);

    const position = [tmpWorldPosition.x, tmpWorldPosition.y, tmpWorldPosition.z];
    const rotation = [tmpWorldQuaternion.x, tmpWorldQuaternion.y, tmpWorldQuaternion.z, tmpWorldQuaternion.w];
    const motionType = motionDef
      ? (motionDef.isKinematic ? HK.MotionType.KINEMATIC : HK.MotionType.DYNAMIC)
      : HK.MotionType.STATIC;

    const bodyId = createBody(shapeResult.shapeId, motionType, position, rotation, motionDef);

    const node = {
      object,
      bodyId,
      initialPosition: position,
      initialRotation: rotation,
      isDynamic: !!motionDef,
      debugMesh: SHOW_DEBUG_COLLIDERS ? createDebugMesh(shapeResult, !!motionDef) : null
    };
    physicsNodes.push(node);
    if (motionDef) dynamicNodes.push(node);
    processedNodeIndices.add(association.nodes);
  });
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

async function main() {
  initThree();
  HK = await HavokPhysics();
  initPhysicsWorld();
  await loadModelAndBuildPhysics();

  let accumulator = 0;
  const clock = new THREE.Clock();

  function animate() {
    const delta = Math.min(clock.getDelta(), 0.1);
    accumulator += delta;
    while (accumulator >= FIXED_TIMESTEP) {
      checkResult(HK.HP_World_Step(worldId, FIXED_TIMESTEP), 'HP_World_Step');
      resetDynamicBodiesIfNeeded();
      updatePhysicsTransforms();
      accumulator -= FIXED_TIMESTEP;
    }
    if (SHOW_DEBUG_COLLIDERS) {
      for (const node of physicsNodes) {
        if (!node.debugMesh) continue;
        node.object.getWorldPosition(tmpWorldPosition);
        node.object.getWorldQuaternion(tmpWorldQuaternion);
        node.debugMesh.position.copy(tmpWorldPosition);
        node.debugMesh.quaternion.copy(tmpWorldQuaternion);
      }
    }
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  }

  animate();
}

main().catch((error) => {
  console.error(error);
});
