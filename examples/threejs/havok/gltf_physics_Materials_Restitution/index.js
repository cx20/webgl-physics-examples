import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const MODEL_URL = 'https://raw.githubusercontent.com/eoineoineoin/glTF_Physics/master/samples/Materials_Restitution/Materials_Restitution.glb';
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

function applyPhysicsMaterial(shapeId, materialDef) {
  if (!materialDef || typeof HK.HP_Shape_SetMaterial !== 'function') {
    return;
  }
  const dynamicFriction = materialDef.dynamicFriction !== undefined ? materialDef.dynamicFriction : 0.5;
  const staticFriction = materialDef.staticFriction !== undefined ? materialDef.staticFriction : 0.5;
  const restitution = materialDef.restitution !== undefined ? materialDef.restitution : 0.0;
  HK.HP_Shape_SetMaterial(shapeId, [
    dynamicFriction,
    staticFriction,
    restitution,
    HK.MaterialCombine.MINIMUM,
    HK.MaterialCombine.MAXIMUM
  ]);
}

function createPhysicsShape(worldScale, shapeDef, motionDef, materialDef) {
  if (!shapeDef) {
    throw new Error('No shape definition provided.');
  }

  const avgScale = (Math.abs(worldScale.x) + Math.abs(worldScale.y) + Math.abs(worldScale.z)) / 3;
  let shapeId;
  let size;
  let shapeType;

  if (shapeDef.type === 'box' && shapeDef.box) {
    size = [
      Math.abs(shapeDef.box.size[0] * worldScale.x),
      Math.abs(shapeDef.box.size[1] * worldScale.y),
      Math.abs(shapeDef.box.size[2] * worldScale.z)
    ];
    shapeType = 'box';
    const created = HK.HP_Shape_CreateBox([0, 0, 0], IDENTITY_QUATERNION, size);
    checkResult(created[0], 'HP_Shape_CreateBox');
    shapeId = created[1];
    if (motionDef) {
      const volume = Math.max(size[0] * size[1] * size[2], 0.0001);
      const density = (motionDef.mass !== undefined && motionDef.mass > 0) ? motionDef.mass / volume : 1;
      checkResult(HK.HP_Shape_SetDensity(shapeId, density), 'HP_Shape_SetDensity');
    }
  } else if (shapeDef.type === 'sphere' && shapeDef.sphere) {
    const radius = shapeDef.sphere.radius * avgScale;
    shapeType = 'sphere';
    size = [radius * 2, radius * 2, radius * 2];
    const created = HK.HP_Shape_CreateSphere([0, 0, 0], radius);
    checkResult(created[0], 'HP_Shape_CreateSphere');
    shapeId = created[1];
    if (motionDef && motionDef.mass !== undefined && motionDef.mass > 0) {
      const volume = Math.max((4 / 3) * Math.PI * Math.pow(radius, 3), 0.0001);
      checkResult(HK.HP_Shape_SetDensity(shapeId, motionDef.mass / volume), 'HP_Shape_SetDensity sphere');
    }
  } else if (shapeDef.type === 'capsule' && shapeDef.capsule) {
    const cd = shapeDef.capsule;
    const rTop = cd.radiusTop !== undefined ? cd.radiusTop : (cd.radius !== undefined ? cd.radius : 0.5);
    const rBot = cd.radiusBottom !== undefined ? cd.radiusBottom : (cd.radius !== undefined ? cd.radius : 0.5);
    const h = cd.height !== undefined ? cd.height : 1.0;
    const sXZ = Math.max(Math.abs(worldScale.x), Math.abs(worldScale.z));
    const sr = Math.max((rTop + rBot) * 0.5 * sXZ, 0.0001);
    const shaftH = Math.max(h * Math.abs(worldScale.y) * 0.5, 0);
    shapeType = 'capsule';
    size = [sr * 2, shaftH * 2 + sr * 2, sr * 2];
    const created = HK.HP_Shape_CreateCapsule([0, -shaftH, 0], [0, shaftH, 0], sr);
    checkResult(created[0], 'HP_Shape_CreateCapsule');
    shapeId = created[1];
  } else if (shapeDef.type === 'cylinder' && shapeDef.cylinder) {
    const cyd = shapeDef.cylinder;
    const rT = cyd.radiusTop !== undefined ? cyd.radiusTop : (cyd.radius !== undefined ? cyd.radius : 0.5);
    const rB = cyd.radiusBottom !== undefined ? cyd.radiusBottom : (cyd.radius !== undefined ? cyd.radius : 0.5);
    const cH = cyd.height !== undefined ? cyd.height : 1.0;
    const sXZ = Math.max(Math.abs(worldScale.x), Math.abs(worldScale.z));
    const sHH = Math.max(cH * Math.abs(worldScale.y) * 0.5, 0.0001);
    const sr = Math.max(Math.max(rT, rB) * sXZ, 0.0001);
    shapeType = 'cylinder';
    size = [sr * 2, sHH * 2, sr * 2];
    if (typeof HK.HP_Shape_CreateCylinder === 'function') {
      const created = HK.HP_Shape_CreateCylinder([0, -sHH, 0], [0, sHH, 0], sr);
      checkResult(created[0], 'HP_Shape_CreateCylinder');
      shapeId = created[1];
    } else {
      const created = HK.HP_Shape_CreateBox([0, 0, 0], IDENTITY_QUATERNION, [sr * 2, sHH * 2, sr * 2]);
      checkResult(created[0], 'HP_Shape_CreateBox (cyl fallback)');
      shapeId = created[1];
    }
  } else {
    throw new Error('Unsupported KHR_implicit_shapes type: ' + shapeDef.type);
  }

  applyPhysicsMaterial(shapeId, materialDef);
  return { shapeId, size, shapeType };
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

  root.traverse((object) => {
    const association = associations.get(object);
    if (!association || association.nodes === undefined) {
      return;
    }
    if (processedNodeIndices.has(association.nodes)) {
      return;
    }

    const nodeDef = json.nodes[association.nodes];
    const physicsExt = nodeDef?.extensions?.KHR_physics_rigid_bodies;
    if (!physicsExt || !physicsExt.collider || !physicsExt.collider.geometry) {
      return;
    }

    const shapeIndex = physicsExt.collider.geometry.shape;
    const shapeDef = shapeDefs[shapeIndex];
    if (!shapeDef) {
      return;
    }

    const motionDef = physicsExt.motion || null;
    const materialDef = physicsExt.collider.physicsMaterial !== undefined
      ? materialDefs[physicsExt.collider.physicsMaterial]
      : null;

    object.matrixWorld.decompose(tmpWorldPosition, tmpWorldQuaternion, tmpWorldScale);

    const created = createPhysicsShape(tmpWorldScale, shapeDef, motionDef, materialDef);
    const bodyId = createBody(
      created.shapeId,
      motionDef ? HK.MotionType.DYNAMIC : HK.MotionType.STATIC,
      [tmpWorldPosition.x, tmpWorldPosition.y, tmpWorldPosition.z],
      [tmpWorldQuaternion.x, tmpWorldQuaternion.y, tmpWorldQuaternion.z, tmpWorldQuaternion.w],
      !!motionDef
    );

    const node = {
      object,
      bodyId,
      initialPosition: [tmpWorldPosition.x, tmpWorldPosition.y, tmpWorldPosition.z],
      initialRotation: [tmpWorldQuaternion.x, tmpWorldQuaternion.y, tmpWorldQuaternion.z, tmpWorldQuaternion.w],
      isDynamic: !!motionDef,
      debugMesh: SHOW_DEBUG_COLLIDERS ? createDebugMesh(created, !!motionDef) : null
    };

    physicsNodes.push(node);
    if (motionDef) {
      dynamicNodes.push(node);
    }
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
