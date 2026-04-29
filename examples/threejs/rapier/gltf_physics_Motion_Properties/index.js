import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import RAPIER from 'https://cdn.skypack.dev/@dimforge/rapier3d-compat@0.17.3';

const MODEL_URL = 'https://raw.githubusercontent.com/eoineoineoin/glTF_Physics/master/samples/MotionProperties/MotionProperties.glb';
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

function buildColliderDesc(shapeDef, worldScale, friction, restitution) {
  if (!shapeDef) {
    return null;
  }

  let colliderDesc = null;

  if (shapeDef.type === 'box' && shapeDef.box) {
    const size = shapeDef.box.size || [1, 1, 1];
    const hx = Math.max(Math.abs(size[0] * worldScale.x) * 0.5, 0.0001);
    const hy = Math.max(Math.abs(size[1] * worldScale.y) * 0.5, 0.0001);
    const hz = Math.max(Math.abs(size[2] * worldScale.z) * 0.5, 0.0001);
    colliderDesc = RAPIER.ColliderDesc.cuboid(hx, hy, hz);
  } else if (shapeDef.type === 'sphere' && shapeDef.sphere) {
    const baseRadius = shapeDef.sphere.radius !== undefined ? shapeDef.sphere.radius : 0.5;
    const maxScale = Math.max(Math.abs(worldScale.x), Math.abs(worldScale.y), Math.abs(worldScale.z));
    const radius = Math.max(baseRadius * maxScale, 0.0001);
    colliderDesc = RAPIER.ColliderDesc.ball(radius);
  } else if (shapeDef.type === 'capsule' && shapeDef.capsule) {
    const capsuleDef = shapeDef.capsule;
    const radiusTop = capsuleDef.radiusTop !== undefined ? capsuleDef.radiusTop : 0.5;
    const radiusBottom = capsuleDef.radiusBottom !== undefined ? capsuleDef.radiusBottom : 0.5;
    const height = capsuleDef.height !== undefined ? capsuleDef.height : 1.0;
    const avgRadius = (radiusTop + radiusBottom) * 0.5;
    const scaleXZ = Math.max(Math.abs(worldScale.x), Math.abs(worldScale.z));
    const scaledRadius = Math.max(avgRadius * scaleXZ, 0.0001);
    const scaledHalfShaft = Math.max(height * Math.abs(worldScale.y) * 0.5, 0);
    colliderDesc = RAPIER.ColliderDesc.capsule(scaledHalfShaft, scaledRadius);
  } else if (shapeDef.type === 'cylinder' && shapeDef.cylinder) {
    const cylDef = shapeDef.cylinder;
    const radiusTop = cylDef.radiusTop !== undefined ? cylDef.radiusTop : 0.5;
    const radiusBottom = cylDef.radiusBottom !== undefined ? cylDef.radiusBottom : 0.5;
    const height = cylDef.height !== undefined ? cylDef.height : 1.0;
    const maxRadius = Math.max(radiusTop, radiusBottom);
    const scaleXZ = Math.max(Math.abs(worldScale.x), Math.abs(worldScale.z));
    const scaledRadius = Math.max(maxRadius * scaleXZ, 0.0001);
    const scaledHalfHeight = Math.max(height * Math.abs(worldScale.y) * 0.5, 0.0001);
    colliderDesc = RAPIER.ColliderDesc.cylinder(scaledHalfHeight, scaledRadius);
  } else {
    return null;
  }

  colliderDesc.setFriction(friction);
  colliderDesc.setRestitution(restitution);
  return colliderDesc;
}

function getMeshColliderDesc(object, worldScale) {
  let posAttr = null;
  let indexArray = null;
  object.traverse((child) => {
    if (posAttr !== null) return;
    if (!child.isMesh || !child.geometry) return;
    const attr = child.geometry.getAttribute('position');
    if (!attr) return;
    posAttr = attr;
    indexArray = child.geometry.index ? child.geometry.index.array : null;
  });
  if (!posAttr) return null;
  const count = posAttr.count;
  const scaledPos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    scaledPos[i * 3]     = posAttr.getX(i) * worldScale.x;
    scaledPos[i * 3 + 1] = posAttr.getY(i) * worldScale.y;
    scaledPos[i * 3 + 2] = posAttr.getZ(i) * worldScale.z;
  }
  let indices;
  if (indexArray) {
    indices = new Uint32Array(indexArray);
  } else {
    indices = new Uint32Array(count);
    for (let i = 0; i < count; i++) indices[i] = i;
  }
  return RAPIER.ColliderDesc.trimesh(scaledPos, indices);
}

function getConvexPoints(object, worldScale) {
  let posAttr = null;
  object.traverse((child) => {
    if (posAttr !== null) return;
    if (!child.isMesh || !child.geometry) return;
    posAttr = child.geometry.getAttribute('position');
  });
  if (!posAttr) return null;
  const count = posAttr.count;
  const points = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    points[i * 3]     = posAttr.getX(i) * worldScale.x;
    points[i * 3 + 1] = posAttr.getY(i) * worldScale.y;
    points[i * 3 + 2] = posAttr.getZ(i) * worldScale.z;
  }
  return points;
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

    const shapeIndex = physicsExt.collider.geometry.shape;
    const shapeDef = shapeIndex !== undefined ? shapeDefs[shapeIndex] : null;

    const object = await gltf.parser.getDependency('node', nodeIndex);
    if (!object) {
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

    let colliderDesc;
    if (shapeDef) {
      colliderDesc = buildColliderDesc(shapeDef, tmpWorldScale, friction, restitution);
    } else if (physicsExt.collider.geometry.mesh !== undefined) {
      if (motion) {
        const points = getConvexPoints(object, tmpWorldScale);
        if (points) {
          colliderDesc = RAPIER.ColliderDesc.convexHull(points);
          if (colliderDesc) colliderDesc.setFriction(friction).setRestitution(restitution);
        }
      } else {
        colliderDesc = getMeshColliderDesc(object, tmpWorldScale);
        if (colliderDesc) colliderDesc.setFriction(friction).setRestitution(restitution);
      }
    }
    if (!colliderDesc) continue;

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

    if (motion) {
      if (motion.gravityFactor !== undefined) {
        bodyDesc.setGravityScale(motion.gravityFactor);
      }
      if (motion.linearVelocity) {
        const lv = motion.linearVelocity;
        bodyDesc.setLinvel(lv[0], lv[1], lv[2]);
      }
      if (motion.angularVelocity) {
        const av = motion.angularVelocity;
        bodyDesc.setAngvel({ x: av[0], y: av[1], z: av[2] });
      }
    }

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
      },
      motion
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

    const lv = node.motion?.linearVelocity;
    node.body.setLinvel(lv ? { x: lv[0], y: lv[1], z: lv[2] } : { x: 0, y: 0, z: 0 }, true);

    const av = node.motion?.angularVelocity;
    node.body.setAngvel(av ? { x: av[0], y: av[1], z: av[2] } : { x: 0, y: 0, z: 0 }, true);
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
