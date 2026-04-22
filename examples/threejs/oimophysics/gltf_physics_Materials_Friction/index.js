import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const MODEL_URL = 'https://raw.githubusercontent.com/eoineoineoin/glTF_Physics/master/samples/Materials_Friction/Materials_Friction.glb';
const FIXED_TIMESTEP = 1 / 60;
const RESET_Y_THRESHOLD = -20;
const OIMO_DYNAMIC_FRICTION_SCALE = 0.35;

let camera;
let scene;
let renderer;
let controls;
let world;

const physicsNodes = [];
const dynamicNodes = [];
const processedNodeIndices = new Set();

const tmpWorldPosition = new THREE.Vector3();
const tmpWorldQuaternion = new THREE.Quaternion();
const tmpWorldScale = new THREE.Vector3();
const tmpParentPosition = new THREE.Vector3();
const tmpParentQuaternion = new THREE.Quaternion();
const tmpParentScale = new THREE.Vector3();
const tmpEuler = new THREE.Euler();

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

function initWorld() {
  world = new OIMO.World();
  world.gravity = new OIMO.Vec3(0, -9.80665, 0);
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

  const associations = gltf.parser.associations;

  root.traverse((object) => {
    const association = associations.get(object);
    if (!association || association.nodes === undefined) {
      return;
    }
    if (processedNodeIndices.has(association.nodes)) {
      return;
    }

    const nodeDef = gltfJson.nodes[association.nodes];
    const physicsExt = nodeDef?.extensions?.KHR_physics_rigid_bodies;
    if (!physicsExt || !physicsExt.collider?.geometry) {
      return;
    }

    const shapeDef = shapeDefs[physicsExt.collider.geometry.shape];
    if (!shapeDef || shapeDef.type !== 'box' || !shapeDef.box) {
      return;
    }

    object.matrixWorld.decompose(tmpWorldPosition, tmpWorldQuaternion, tmpWorldScale);

    const size = shapeDef.box.size || [1, 1, 1];
    const scaledSize = [
      Math.abs(size[0] * tmpWorldScale.x),
      Math.abs(size[1] * tmpWorldScale.y),
      Math.abs(size[2] * tmpWorldScale.z)
    ];

    const motion = physicsExt.motion || null;
    const materialDef = physicsExt.collider.physicsMaterial !== undefined
      ? materialDefs[physicsExt.collider.physicsMaterial]
      : null;

    const friction = materialDef?.dynamicFriction !== undefined ? materialDef.dynamicFriction : 0.5;
    const restitution = materialDef?.restitution !== undefined ? materialDef.restitution : 0.0;
    const isDynamic = !!motion;
    const effectiveFriction = isDynamic
      ? friction * OIMO_DYNAMIC_FRICTION_SCALE
      : (friction === 0 ? 1 : friction);

    const shapeConfig = new OIMO.ShapeConfig();
    shapeConfig.geometry = new OIMO.BoxGeometry(new OIMO.Vec3(scaledSize[0] * 0.5, scaledSize[1] * 0.5, scaledSize[2] * 0.5));
    shapeConfig.friction = effectiveFriction;
    shapeConfig.restitution = restitution;

    const bodyConfig = new OIMO.RigidBodyConfig();
    bodyConfig.type = isDynamic ? OIMO.RigidBodyType.DYNAMIC : OIMO.RigidBodyType.STATIC;
    bodyConfig.position = new OIMO.Vec3(tmpWorldPosition.x, tmpWorldPosition.y, tmpWorldPosition.z);

    const body = new OIMO.RigidBody(bodyConfig);
    tmpEuler.setFromQuaternion(tmpWorldQuaternion, 'XYZ');
    body.setRotationXyz(new OIMO.Vec3(tmpEuler.x, tmpEuler.y, tmpEuler.z));

    body.addShape(new OIMO.Shape(shapeConfig));
    world.addRigidBody(body);

    const node = {
      object,
      body,
      initialPosition: new OIMO.Vec3(tmpWorldPosition.x, tmpWorldPosition.y, tmpWorldPosition.z),
      initialEuler: new OIMO.Vec3(tmpEuler.x, tmpEuler.y, tmpEuler.z)
    };

    physicsNodes.push(node);
    if (isDynamic) {
      dynamicNodes.push(node);
    }

    processedNodeIndices.add(association.nodes);
  });
}

function updatePhysicsTransforms() {
  for (const node of physicsNodes) {
    const p = node.body.getPosition();
    const q = node.body.getOrientation();

    tmpWorldPosition.set(p.x, p.y, p.z);
    tmpWorldQuaternion.set(q.x, q.y, q.z, q.w);
    setObjectWorldTransform(node.object, tmpWorldPosition, tmpWorldQuaternion);
  }
}

function resetDynamicBodiesIfNeeded() {
  for (const node of dynamicNodes) {
    if (node.body.getPosition().y >= RESET_Y_THRESHOLD) {
      continue;
    }

    node.body.setPosition(new OIMO.Vec3(node.initialPosition.x, node.initialPosition.y, node.initialPosition.z));
    node.body.setRotationXyz(new OIMO.Vec3(node.initialEuler.x, node.initialEuler.y, node.initialEuler.z));
    node.body.setLinearVelocity(new OIMO.Vec3(0, 0, 0));
    node.body.setAngularVelocity(new OIMO.Vec3(0, 0, 0));
  }
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

async function main() {
  initThree();
  initWorld();
  await loadModelAndBuildPhysics();

  function animate() {
    world.step(FIXED_TIMESTEP);
    resetDynamicBodiesIfNeeded();
    updatePhysicsTransforms();

    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  }

  animate();
}

main().catch((error) => {
  console.error(error);
});
