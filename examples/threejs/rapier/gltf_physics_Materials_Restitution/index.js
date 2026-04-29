import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import RAPIER from 'https://cdn.skypack.dev/@dimforge/rapier3d-compat@0.17.3';

const MODEL_URL = 'https://raw.githubusercontent.com/eoineoineoin/glTF_Physics/master/samples/Materials_Restitution/Materials_Restitution.glb';
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

function buildColliderDesc(shapeDef, worldScale, friction, restitution) {
  if (!shapeDef) return null;

  let colliderDesc = null;

  if (shapeDef.type === 'box' && shapeDef.box) {
    const size = shapeDef.box.size || [1, 1, 1];
    colliderDesc = RAPIER.ColliderDesc.cuboid(
      Math.max(Math.abs(size[0] * worldScale.x) * 0.5, 0.0001),
      Math.max(Math.abs(size[1] * worldScale.y) * 0.5, 0.0001),
      Math.max(Math.abs(size[2] * worldScale.z) * 0.5, 0.0001)
    );
  } else if (shapeDef.type === 'sphere' && shapeDef.sphere) {
    const baseRadius = shapeDef.sphere.radius !== undefined ? shapeDef.sphere.radius : 0.5;
    const maxScale = Math.max(Math.abs(worldScale.x), Math.abs(worldScale.y), Math.abs(worldScale.z));
    colliderDesc = RAPIER.ColliderDesc.ball(Math.max(baseRadius * maxScale, 0.0001));
  } else if (shapeDef.type === 'capsule' && shapeDef.capsule) {
    const cd = shapeDef.capsule;
    const avgRadius = ((cd.radiusTop ?? 0.5) + (cd.radiusBottom ?? 0.5)) * 0.5;
    const scaleXZ = Math.max(Math.abs(worldScale.x), Math.abs(worldScale.z));
    colliderDesc = RAPIER.ColliderDesc.capsule(
      Math.max((cd.height ?? 1.0) * Math.abs(worldScale.y) * 0.5, 0),
      Math.max(avgRadius * scaleXZ, 0.0001)
    );
  } else if (shapeDef.type === 'cylinder' && shapeDef.cylinder) {
    const cd = shapeDef.cylinder;
    const maxRadius = Math.max(cd.radiusTop ?? 0.5, cd.radiusBottom ?? 0.5);
    const scaleXZ = Math.max(Math.abs(worldScale.x), Math.abs(worldScale.z));
    colliderDesc = RAPIER.ColliderDesc.cylinder(
      Math.max((cd.height ?? 1.0) * Math.abs(worldScale.y) * 0.5, 0.0001),
      Math.max(maxRadius * scaleXZ, 0.0001)
    );
  } else {
    return null;
  }

  colliderDesc.setFriction(friction);
  colliderDesc.setRestitution(restitution);
  colliderDesc.setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max);
  return colliderDesc;
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
      continue;
    }

    const shapeIndex = physicsExt.collider.geometry.shape;
    if (shapeIndex === undefined) {
      continue;
    }

    const shapeDef = shapeDefs[shapeIndex];
    if (!shapeDef) {
      continue;
    }

    object.updateWorldMatrix(true, false);
    object.matrixWorld.decompose(tmpWorldPosition, tmpWorldQuaternion, tmpWorldScale);

    const motion = physicsExt.motion || null;
    const materialDef = physicsExt.collider.physicsMaterial !== undefined
      ? materialDefs[physicsExt.collider.physicsMaterial]
      : null;

    const friction = materialDef?.dynamicFriction !== undefined ? materialDef.dynamicFriction : 0.5;
    const restitution = materialDef?.restitution !== undefined ? materialDef.restitution : 0.0;

    const colliderDesc = buildColliderDesc(shapeDef, tmpWorldScale, friction, restitution);
    if (!colliderDesc) {
      continue;
    }

    const bodyDesc = motion
      ? RAPIER.RigidBodyDesc.dynamic()
      : RAPIER.RigidBodyDesc.fixed();
    bodyDesc.setTranslation(tmpWorldPosition.x, tmpWorldPosition.y, tmpWorldPosition.z);
    bodyDesc.setRotation({
      x: tmpWorldQuaternion.x,
      y: tmpWorldQuaternion.y,
      z: tmpWorldQuaternion.z,
      w: tmpWorldQuaternion.w
    });

    const body = world.createRigidBody(bodyDesc);
    world.createCollider(colliderDesc, body);

    const node = {
      object,
      body,
      initialPosition: { x: tmpWorldPosition.x, y: tmpWorldPosition.y, z: tmpWorldPosition.z },
      initialQuaternion: {
        x: tmpWorldQuaternion.x,
        y: tmpWorldQuaternion.y,
        z: tmpWorldQuaternion.z,
        w: tmpWorldQuaternion.w
      }
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
    const p = node.body.translation();
    const q = node.body.rotation();
    tmpWorldPosition.set(p.x, p.y, p.z);
    tmpWorldQuaternion.set(q.x, q.y, q.z, q.w);
    setObjectWorldTransform(node.object, tmpWorldPosition, tmpWorldQuaternion);
  }
}

function resetDynamicBodiesIfNeeded() {
  for (const node of dynamicNodes) {
    const p = node.body.translation();
    if (p.y >= RESET_Y_THRESHOLD) {
      continue;
    }
    node.body.setTranslation(node.initialPosition, true);
    node.body.setRotation(node.initialQuaternion, true);
    node.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    node.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

async function main() {
  await RAPIER.init();

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

  world = new RAPIER.World({ x: 0, y: -9.8, z: 0 });
  world.timestep = FIXED_TIMESTEP;

  await loadModelAndBuildPhysics();

  function animate() {
    world.step();
    resetDynamicBodiesIfNeeded();
    updatePhysicsTransforms();
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  }

  animate();
}

main().catch(console.error);
