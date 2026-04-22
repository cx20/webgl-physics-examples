import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const MODEL_URL = 'https://raw.githubusercontent.com/eoineoineoin/glTF_Physics/master/samples/Materials_Friction/Materials_Friction.glb';
const FIXED_TIMESTEP = 1 / 60;
const RESET_Y_THRESHOLD = -20;
const IDENTITY_QUATERNION = [0, 0, 0, 1];
const SHOW_DEBUG_BOXES = false;

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
  if (typeof value.value === 'function') {
    const nested = enumToNumber(value.value());
    if (!Number.isNaN(nested)) {
      return nested;
    }
  }
  if (typeof value.valueOf === 'function') {
    const nestedValue = value.valueOf();
    if (nestedValue !== value) {
      const nested = enumToNumber(nestedValue);
      if (!Number.isNaN(nested)) {
        return nested;
      }
    }
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
    } catch (_error) {
      // ignore JSON comparison errors
    }
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
    HK.MaterialCombine.MAXIMUM,
    HK.MaterialCombine.MINIMUM
  ]);
}

function createPhysicsShape(worldScale, shapeDef, motionDef, materialDef) {
  if (!shapeDef || shapeDef.type !== 'box' || !shapeDef.box) {
    throw new Error('This sample supports KHR_implicit_shapes box colliders only.');
  }

  const size = [
    Math.abs(shapeDef.box.size[0] * worldScale.x),
    Math.abs(shapeDef.box.size[1] * worldScale.y),
    Math.abs(shapeDef.box.size[2] * worldScale.z)
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

function maybeCreateDebugBox(node) {
  if (!SHOW_DEBUG_BOXES) {
    return;
  }

  const wire = new THREE.Mesh(
    new THREE.BoxGeometry(node.debugSize[0], node.debugSize[1], node.debugSize[2]),
    new THREE.MeshBasicMaterial({
      color: node.isDynamic ? 0xff6030 : 0x30e070,
      wireframe: true
    })
  );
  scene.add(wire);
  node.debugMesh = wire;
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
      debugSize: created.size,
      isDynamic: !!motionDef,
      debugMesh: null
    };

    physicsNodes.push(node);
    if (motionDef) {
      dynamicNodes.push(node);
    }

    processedNodeIndices.add(association.nodes);

    maybeCreateDebugBox(node);
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

    if (SHOW_DEBUG_BOXES) {
      for (const node of physicsNodes) {
        if (!node.debugMesh) {
          continue;
        }
        node.object.updateWorldMatrix(true, false);
        node.object.matrixWorld.decompose(tmpWorldPosition, tmpWorldQuaternion, tmpWorldScale);
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
