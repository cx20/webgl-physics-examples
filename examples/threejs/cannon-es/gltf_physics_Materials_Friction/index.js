import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as CANNON from 'cannon';

const MODEL_URL = 'https://raw.githubusercontent.com/eoineoineoin/glTF_Physics/master/samples/Materials_Friction/Materials_Friction.glb';
const FIXED_TIMESTEP = 1 / 60;
const RESET_Y_THRESHOLD = -20;

let camera;
let scene;
let renderer;
let controls;
let world;

const physicsNodes = [];
const dynamicNodes = [];
const processedNodeIndices = new Set();
const dynamicMaterialEntries = [];
const staticMaterialEntries = [];

const tmpWorldPosition = new THREE.Vector3();
const tmpWorldQuaternion = new THREE.Quaternion();
const tmpWorldScale = new THREE.Vector3();
const tmpParentPosition = new THREE.Vector3();
const tmpParentQuaternion = new THREE.Quaternion();
const tmpParentScale = new THREE.Vector3();

async function fetchGltfJsonFromGlb(url) {
  const response = await fetch(url);
  const data = await response.arrayBuffer();
  const header = new Uint32Array(data, 0, 3);

  if (header[0] !== 0x46546c67) {
    throw new Error('Invalid GLB header.');
  }

  let offset = 12;
  const decoder = new TextDecoder();

  while (offset < data.byteLength) {
    const view = new DataView(data, offset, 8);
    const chunkLength = view.getUint32(0, true);
    const chunkType = view.getUint32(4, true);

    if (chunkType === 0x4e4f534a) {
      const chunkData = data.slice(offset + 8, offset + 8 + chunkLength);
      return JSON.parse(decoder.decode(chunkData).replace(/\0+$/, ''));
    }

    offset += 8 + chunkLength;
  }

  throw new Error('GLB JSON chunk is missing.');
}

function createWorld() {
  world = new CANNON.World();
  world.gravity.set(0, -9.81, 0);
  world.broadphase = new CANNON.NaiveBroadphase();
  world.solver.iterations = 10;
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

function addContactMaterialForPair(dynamicEntry, staticEntry) {
  world.addContactMaterial(new CANNON.ContactMaterial(
    dynamicEntry.material,
    staticEntry.material,
    {
      friction: dynamicEntry.friction,
      restitution: Math.max(dynamicEntry.restitution, staticEntry.restitution)
    }
  ));
}

function registerBodyMaterialPair(materialEntry, isDynamic) {
  if (isDynamic) {
    dynamicMaterialEntries.push(materialEntry);
    for (const staticEntry of staticMaterialEntries) {
      addContactMaterialForPair(materialEntry, staticEntry);
    }
  } else {
    staticMaterialEntries.push(materialEntry);
    for (const dynamicEntry of dynamicMaterialEntries) {
      addContactMaterialForPair(dynamicEntry, materialEntry);
    }
  }
}

async function loadModelAndBuildPhysics() {
  const loader = new GLTFLoader();
  const [gltf, gltfJson] = await Promise.all([
    loader.loadAsync(MODEL_URL),
    fetchGltfJsonFromGlb(MODEL_URL)
  ]);

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

  const shapeDefs = gltfJson.extensions?.KHR_implicit_shapes?.shapes || [];
  const scenePhysics = gltfJson.extensions?.KHR_physics_rigid_bodies || {};
  const materialDefs = scenePhysics.physicsMaterials || [];

  for (let nodeIndex = 0; nodeIndex < gltfJson.nodes.length; nodeIndex++) {
    if (processedNodeIndices.has(nodeIndex)) {
      continue;
    }

    const nodeDef = gltfJson.nodes[nodeIndex];
    const physicsExt = nodeDef?.extensions?.KHR_physics_rigid_bodies;
    if (!physicsExt || !physicsExt.collider?.geometry) {
      continue;
    }

    const object = await gltf.parser.getDependency('node', nodeIndex);
    if (!object) {
      console.warn('Physics node not found for index:', nodeIndex, nodeDef.name);
      continue;
    }

    const shapeDef = shapeDefs[physicsExt.collider.geometry.shape];
    if (!shapeDef || shapeDef.type !== 'box' || !shapeDef.box) {
      continue;
    }

    object.updateWorldMatrix(true, false);
    object.matrixWorld.decompose(tmpWorldPosition, tmpWorldQuaternion, tmpWorldScale);

    const size = shapeDef.box.size || [1, 1, 1];
    const halfExtents = [
      Math.abs(size[0] * tmpWorldScale.x) * 0.5,
      Math.abs(size[1] * tmpWorldScale.y) * 0.5,
      Math.abs(size[2] * tmpWorldScale.z) * 0.5
    ];

    const motion = physicsExt.motion || null;
    const materialDef = physicsExt.collider.physicsMaterial !== undefined
      ? materialDefs[physicsExt.collider.physicsMaterial]
      : null;

    const friction = materialDef?.dynamicFriction !== undefined ? materialDef.dynamicFriction : 0.5;
    const restitution = materialDef?.restitution !== undefined ? materialDef.restitution : 0.0;
    const effectiveFriction = !motion && friction === 0 ? 1 : friction;

    const material = new CANNON.Material('node_' + nodeIndex);
    material.friction = effectiveFriction;
    material.restitution = restitution;

    const body = new CANNON.Body({
      mass: motion ? (motion.mass !== undefined ? motion.mass : 1) : 0,
      material,
      allowSleep: !motion ? true : false
    });
    body.addShape(new CANNON.Box(new CANNON.Vec3(halfExtents[0], halfExtents[1], halfExtents[2])));
    body.position.set(tmpWorldPosition.x, tmpWorldPosition.y, tmpWorldPosition.z);
    body.quaternion.set(tmpWorldQuaternion.x, tmpWorldQuaternion.y, tmpWorldQuaternion.z, tmpWorldQuaternion.w);
    world.addBody(body);

    const materialEntry = {
      material,
      friction: motion ? friction : effectiveFriction,
      restitution
    };
    registerBodyMaterialPair(materialEntry, !!motion);

    const node = {
      object,
      body,
      initialPosition: new CANNON.Vec3(tmpWorldPosition.x, tmpWorldPosition.y, tmpWorldPosition.z),
      initialQuaternion: new CANNON.Quaternion(tmpWorldQuaternion.x, tmpWorldQuaternion.y, tmpWorldQuaternion.z, tmpWorldQuaternion.w)
    };

    physicsNodes.push(node);
    if (motion) {
      dynamicNodes.push(node);
    }

    processedNodeIndices.add(nodeIndex);
  }
}

function updatePhysicsTransforms() {
  for (const node of physicsNodes) {
    tmpWorldPosition.set(node.body.position.x, node.body.position.y, node.body.position.z);
    tmpWorldQuaternion.set(node.body.quaternion.x, node.body.quaternion.y, node.body.quaternion.z, node.body.quaternion.w);
    setObjectWorldTransform(node.object, tmpWorldPosition, tmpWorldQuaternion);
  }
}

function resetDynamicBodiesIfNeeded() {
  for (const node of dynamicNodes) {
    if (node.body.position.y >= RESET_Y_THRESHOLD) {
      continue;
    }

    node.body.position.copy(node.initialPosition);
    node.body.quaternion.copy(node.initialQuaternion);
    node.body.velocity.set(0, 0, 0);
    node.body.angularVelocity.set(0, 0, 0);
    node.body.force.set(0, 0, 0);
    node.body.torque.set(0, 0, 0);
    node.body.wakeUp();
  }
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

async function main() {
  initThree();
  createWorld();
  await loadModelAndBuildPhysics();

  let accumulator = 0;
  const clock = new THREE.Clock();

  function animate() {
    const delta = Math.min(clock.getDelta(), 0.1);
    accumulator += delta;

    while (accumulator >= FIXED_TIMESTEP) {
      world.step(FIXED_TIMESTEP, FIXED_TIMESTEP, 1);
      resetDynamicBodiesIfNeeded();
      updatePhysicsTransforms();
      accumulator -= FIXED_TIMESTEP;
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
