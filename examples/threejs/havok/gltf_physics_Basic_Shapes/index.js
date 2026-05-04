import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const MODEL_URL = 'https://raw.githubusercontent.com/eoineoineoin/glTF_Physics/master/samples/ShapeTypes/ShapeTypes.glb';
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

function createImplicitShape(worldScale, shapeDef, motionDef, materialDef) {
  if (!shapeDef) {
    throw new Error('Invalid KHR_implicit_shapes definition.');
  }

  let shapeId;
  let size;
  let volume = 0.0001;

  if (shapeDef.type === 'box' && shapeDef.box) {
    const s = shapeDef.box.size || [1, 1, 1];
    size = [
      Math.abs(s[0] * worldScale.x),
      Math.abs(s[1] * worldScale.y),
      Math.abs(s[2] * worldScale.z)
    ];
    const res = HK.HP_Shape_CreateBox([0, 0, 0], IDENTITY_QUATERNION, size);
    checkResult(res[0], 'HP_Shape_CreateBox');
    shapeId = res[1];
    volume = Math.max(size[0] * size[1] * size[2], 0.0001);

  } else if (shapeDef.type === 'sphere' && shapeDef.sphere) {
    const baseR = shapeDef.sphere.radius !== undefined ? shapeDef.sphere.radius : 0.5;
    const maxS = Math.max(Math.abs(worldScale.x), Math.abs(worldScale.y), Math.abs(worldScale.z));
    const r = Math.max(Math.abs(baseR * maxS), 0.0001);
    const res = HK.HP_Shape_CreateSphere([0, 0, 0], r);
    checkResult(res[0], 'HP_Shape_CreateSphere');
    shapeId = res[1];
    size = [r * 2, r * 2, r * 2];
    volume = Math.max((4.0 / 3.0) * Math.PI * r * r * r, 0.0001);

  } else if (shapeDef.type === 'capsule' && shapeDef.capsule) {
    const cd = shapeDef.capsule;
    const rTop = cd.radiusTop !== undefined ? cd.radiusTop : 0.5;
    const rBot = cd.radiusBottom !== undefined ? cd.radiusBottom : 0.5;
    const h = cd.height !== undefined ? cd.height : 1.0;
    const avgR = (rTop + rBot) * 0.5;
    const sXZ = Math.max(Math.abs(worldScale.x), Math.abs(worldScale.z));
    const sr = Math.max(avgR * sXZ, 0.0001);
    const shaftH = Math.max(h * Math.abs(worldScale.y) * 0.5, 0);
    const res = HK.HP_Shape_CreateCapsule([0, -shaftH, 0], [0, shaftH, 0], sr);
    checkResult(res[0], 'HP_Shape_CreateCapsule');
    shapeId = res[1];
    size = [sr * 2, shaftH * 2 + sr * 2, sr * 2];
    volume = Math.max(Math.PI * sr * sr * shaftH * 2 + (4.0 / 3.0) * Math.PI * sr * sr * sr, 0.0001);

  } else if (shapeDef.type === 'cylinder' && shapeDef.cylinder) {
    const cyd = shapeDef.cylinder;
    const rT = cyd.radiusTop !== undefined ? cyd.radiusTop : 0.5;
    const rB = cyd.radiusBottom !== undefined ? cyd.radiusBottom : 0.5;
    const cH = cyd.height !== undefined ? cyd.height : 1.0;
    const maxR = Math.max(rT, rB, 0.0001);
    const sXZ = Math.max(Math.abs(worldScale.x), Math.abs(worldScale.z));
    const sr = Math.max(maxR * sXZ, 0.0001);
    const sHH = Math.max(cH * Math.abs(worldScale.y) * 0.5, 0.0001);
    if (typeof HK.HP_Shape_CreateCylinder === 'function') {
      const res = HK.HP_Shape_CreateCylinder([0, -sHH, 0], [0, sHH, 0], sr);
      checkResult(res[0], 'HP_Shape_CreateCylinder');
      shapeId = res[1];
    } else {
      const res = HK.HP_Shape_CreateBox([0, 0, 0], IDENTITY_QUATERNION, [sr * 2, sHH * 2, sr * 2]);
      checkResult(res[0], 'HP_Shape_CreateBox (cyl fallback)');
      shapeId = res[1];
    }
    size = [sr * 2, sHH * 2, sr * 2];
    volume = Math.max(Math.PI * sr * sr * sHH * 2, 0.0001);

  } else {
    throw new Error('Unsupported KHR_implicit_shapes type: ' + shapeDef.type);
  }

  if (motionDef) {
    const specMass = motionDef.mass;
    const density = (specMass !== undefined && specMass > 0) ? specMass / volume : 1;
    checkResult(HK.HP_Shape_SetDensity(shapeId, density), 'HP_Shape_SetDensity');
  }

  if (materialDef && typeof HK.HP_Shape_SetMaterial === 'function') {
    const df = materialDef.dynamicFriction !== undefined ? materialDef.dynamicFriction : 0.5;
    const sf = materialDef.staticFriction !== undefined ? materialDef.staticFriction : 0.5;
    const r = materialDef.restitution !== undefined ? materialDef.restitution : 0.0;
    HK.HP_Shape_SetMaterial(shapeId, [df, sf, r, HK.MaterialCombine.MAXIMUM, HK.MaterialCombine.MAXIMUM]);
  }

  return { shapeId, size: size || [1, 1, 1], shapeType: shapeDef.type };
}

function createMeshShape(colliderScale, geomDef, meshIndexToGeos, jsonNodes, motionDef) {
  let meshIndex = geomDef.mesh;
  if (meshIndex === undefined && geomDef.node !== undefined) {
    meshIndex = jsonNodes[geomDef.node]?.mesh;
  }
  if (meshIndex === undefined) return null;

  const isConvex = !!geomDef.convexHull;
  const geoList = meshIndexToGeos.get(meshIndex);
  if (!geoList || geoList.length === 0) return null;

  const allPositions = [];
  const allIndices = [];
  let vertexOffset = 0;

  for (const geo of geoList) {
    const pos = geo.attributes.position.array;
    for (let i = 0; i < pos.length; i += 3) {
      allPositions.push(
        pos[i] * colliderScale.x,
        pos[i + 1] * colliderScale.y,
        pos[i + 2] * colliderScale.z
      );
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
      if (!motionDef) {
        const baseLen = allIndices.length;
        for (let i = 0; i + 2 < baseLen; i += 3) {
          allIndices.push(allIndices[i], allIndices[i + 2], allIndices[i + 1]);
        }
      }
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
    const fallbackSize = [Math.max(maxX - minX, 0.1), Math.max(maxY - minY, 0.1), Math.max(maxZ - minZ, 0.1)];
    const res = HK.HP_Shape_CreateBox([0, 0, 0], IDENTITY_QUATERNION, fallbackSize);
    checkResult(res[0], 'HP_Shape_CreateBox (mesh fallback)');
    shapeId = res[1];
  }

  if (!shapeId) return null;

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < allPositions.length; i += 3) {
    minX = Math.min(minX, allPositions[i]); maxX = Math.max(maxX, allPositions[i]);
    minY = Math.min(minY, allPositions[i + 1]); maxY = Math.max(maxY, allPositions[i + 1]);
    minZ = Math.min(minZ, allPositions[i + 2]); maxZ = Math.max(maxZ, allPositions[i + 2]);
  }
  const size = [maxX - minX, maxY - minY, maxZ - minZ];
  const volume = Math.max((maxX - minX) * (maxY - minY) * (maxZ - minZ), 0.0001);

  if (motionDef) {
    const specMass = motionDef.mass;
    const density = (specMass !== undefined && specMass > 0) ? specMass / volume : 1;
    checkResult(HK.HP_Shape_SetDensity(shapeId, density), 'HP_Shape_SetDensity mesh');
  }

  return { shapeId, size, shapeType: 'mesh' };
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

function createBody(shapeId, motionType, position, rotation, setMass) {
  const created = HK.HP_Body_Create();
  checkResult(created[0], 'HP_Body_Create');
  const bodyId = created[1];

  checkResult(HK.HP_Body_SetShape(bodyId, shapeId), 'HP_Body_SetShape');
  checkResult(HK.HP_Body_SetMotionType(bodyId, motionType), 'HP_Body_SetMotionType');

  if (setMass) {
    const massResult = HK.HP_Shape_BuildMassProperties(shapeId);
    checkResult(massResult[0], 'HP_Shape_BuildMassProperties');
    checkResult(HK.HP_Body_SetMassProperties(bodyId, massResult[1]), 'HP_Body_SetMassProperties');
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
    if (pResult[1][1] >= RESET_Y_THRESHOLD) {
      continue;
    }
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
  const associations = gltf.parser.associations;

  // Build nodeIndex → Object3D map and meshIndex → geometry[] map
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

  // Pass 1: Compound bodies (nodes with motion but no collider; children provide shapes)
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

        const childGeom = childExt.collider.geometry;
        const childObject = nodeIndexToObject.get(childIdx);
        if (!childObject) continue;

        childObject.updateWorldMatrix(true, false);
        childObject.matrixWorld.decompose(tmpWorldPosition, tmpWorldQuaternion, tmpWorldScale);

        const childMaterialDef = childExt.collider.physicsMaterial !== undefined
          ? materialDefs[childExt.collider.physicsMaterial]
          : null;

        let childShapeResult;
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
      const bodyId = createBody(containerShapeId, motionType, parentPos, parentQuat, true);

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

  // Pass 2: Single-shape bodies
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
    }

    if (!shapeResult) return;

    const position = [tmpWorldPosition.x, tmpWorldPosition.y, tmpWorldPosition.z];
    const rotation = [tmpWorldQuaternion.x, tmpWorldQuaternion.y, tmpWorldQuaternion.z, tmpWorldQuaternion.w];
    const motionType = motionDef
      ? (motionDef.isKinematic ? HK.MotionType.KINEMATIC : HK.MotionType.DYNAMIC)
      : HK.MotionType.STATIC;

    const bodyId = createBody(shapeResult.shapeId, motionType, position, rotation, !!motionDef);

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
