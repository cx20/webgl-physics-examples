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

function collectCompoundChildren(nodeIndex, gltfJson, result, excluded) {
  const nd = gltfJson.nodes[nodeIndex];
  for (const childIndex of (nd.children || [])) {
    const childNd = gltfJson.nodes[childIndex];
    const childExt = childNd?.extensions?.KHR_physics_rigid_bodies;
    if (childExt?.motion) continue;
    if (childExt?.collider?.geometry) {
      result.push(childIndex);
      excluded.add(childIndex);
    }
    collectCompoundChildren(childIndex, gltfJson, result, excluded);
  }
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

  // Pass 1: compound bodies — parent has motion but no self-collider; children supply colliders
  for (let nodeIndex = 0; nodeIndex < gltfJson.nodes.length; nodeIndex++) {
    const nodeDef = gltfJson.nodes[nodeIndex];
    const physicsExt = nodeDef?.extensions?.KHR_physics_rigid_bodies;
    if (!physicsExt?.motion || physicsExt.collider?.geometry) continue;

    const childIndices = [];
    collectCompoundChildren(nodeIndex, gltfJson, childIndices, processedNodeIndices);
    if (childIndices.length === 0) continue;

    const parentObject = await gltf.parser.getDependency('node', nodeIndex);
    if (!parentObject) continue;

    parentObject.updateWorldMatrix(true, false);
    parentObject.matrixWorld.decompose(tmpWorldPosition, tmpWorldQuaternion, tmpWorldScale);

    const motion = physicsExt.motion;
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic();
    bodyDesc.setTranslation(tmpWorldPosition.x, tmpWorldPosition.y, tmpWorldPosition.z);
    bodyDesc.setRotation({
      x: tmpWorldQuaternion.x, y: tmpWorldQuaternion.y,
      z: tmpWorldQuaternion.z, w: tmpWorldQuaternion.w
    });

    if (motion.mass === 0) bodyDesc.lockTranslations();
    if (motion.gravityFactor !== undefined) bodyDesc.setGravityScale(motion.gravityFactor);
    if (motion.linearVelocity) {
      const lv = motion.linearVelocity;
      bodyDesc.setLinvel(lv[0], lv[1], lv[2]);
    }
    if (motion.angularVelocity) {
      const av = motion.angularVelocity;
      bodyDesc.setAngvel({ x: av[0], y: av[1], z: av[2] });
    }
    if (motion.inertiaDiagonal) {
      const [ix, iy, iz] = motion.inertiaDiagonal;
      if (ix === 0 || iy === 0 || iz === 0) {
        let bodyQuat = tmpWorldQuaternion.clone();
        if (motion.inertiaOrientation) {
          const io = motion.inertiaOrientation;
          bodyQuat.multiply(new THREE.Quaternion(io[0], io[1], io[2], io[3]));
        }
        const diag = [ix, iy, iz];
        const localAxes = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
        let allowX = false, allowY = false, allowZ = false;
        for (let j = 0; j < 3; j++) {
          if (diag[j] !== 0) {
            const v = new THREE.Vector3(...localAxes[j]).applyQuaternion(bodyQuat);
            const ax = Math.abs(v.x), ay = Math.abs(v.y), az = Math.abs(v.z);
            if (ax >= ay && ax >= az) allowX = true;
            else if (ay >= ax && ay >= az) allowY = true;
            else allowZ = true;
          }
        }
        bodyDesc.enabledRotations(allowX, allowY, allowZ);
      }
    }

    const body = world.createRigidBody(bodyDesc);

    const parentInvQuat = tmpWorldQuaternion.clone().invert();
    const parentPos = tmpWorldPosition.clone();

    for (const childIndex of childIndices) {
      const childNd = gltfJson.nodes[childIndex];
      const childExt = childNd.extensions.KHR_physics_rigid_bodies;
      const shapeIndex = childExt.collider.geometry.shape;
      const shapeDef = shapeIndex !== undefined ? shapeDefs[shapeIndex] : null;

      const childObject = await gltf.parser.getDependency('node', childIndex);
      if (!childObject) continue;

      childObject.updateWorldMatrix(true, false);
      const childWorldPos = new THREE.Vector3();
      const childWorldQuat = new THREE.Quaternion();
      const childWorldScale = new THREE.Vector3();
      childObject.matrixWorld.decompose(childWorldPos, childWorldQuat, childWorldScale);

      const matIdx = childExt.collider.physicsMaterial;
      const matDef = matIdx !== undefined ? materialDefs[matIdx] : null;
      const friction = matDef?.dynamicFriction !== undefined ? matDef.dynamicFriction : 0.5;
      const restitution = matDef?.restitution !== undefined ? matDef.restitution : 0.0;

      let colliderDesc;
      if (shapeDef) {
        colliderDesc = buildColliderDesc(shapeDef, childWorldScale, friction, restitution);
      } else {
        const points = getConvexPoints(childObject, childWorldScale);
        if (points) {
          colliderDesc = RAPIER.ColliderDesc.convexHull(points);
          if (colliderDesc) {
            colliderDesc.setFriction(friction).setRestitution(restitution);
            colliderDesc.setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max);
          }
        }
      }
      if (!colliderDesc) continue;

      const relPos = childWorldPos.clone().sub(parentPos).applyQuaternion(parentInvQuat);
      const relQuat = parentInvQuat.clone().multiply(childWorldQuat);
      colliderDesc.setTranslation(relPos.x, relPos.y, relPos.z);
      colliderDesc.setRotation({ x: relQuat.x, y: relQuat.y, z: relQuat.z, w: relQuat.w });
      world.createCollider(colliderDesc, body);
    }

    physicsNodes.push({
      object: parentObject,
      body,
      initialPosition: { x: tmpWorldPosition.x, y: tmpWorldPosition.y, z: tmpWorldPosition.z },
      initialQuaternion: {
        x: tmpWorldQuaternion.x, y: tmpWorldQuaternion.y,
        z: tmpWorldQuaternion.z, w: tmpWorldQuaternion.w
      },
      motion
    });
    dynamicNodes.push(physicsNodes[physicsNodes.length - 1]);
    processedNodeIndices.add(nodeIndex);
  }

  // Pass 2: single-body nodes
  for (let nodeIndex = 0; nodeIndex < gltfJson.nodes.length; nodeIndex++) {
    if (processedNodeIndices.has(nodeIndex)) continue;

    const nodeDef = gltfJson.nodes[nodeIndex];
    const physicsExt = nodeDef?.extensions?.KHR_physics_rigid_bodies;
    if (!physicsExt || !physicsExt.collider?.geometry) continue;

    const shapeIndex = physicsExt.collider.geometry.shape;
    const shapeDef = shapeIndex !== undefined ? shapeDefs[shapeIndex] : null;

    const object = await gltf.parser.getDependency('node', nodeIndex);
    if (!object) continue;

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
          if (colliderDesc) {
            colliderDesc.setFriction(friction).setRestitution(restitution);
            colliderDesc.setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max);
          }
        }
      } else {
        colliderDesc = getMeshColliderDesc(object, tmpWorldScale);
        if (colliderDesc) {
          colliderDesc.setFriction(friction).setRestitution(restitution);
          colliderDesc.setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max);
        }
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
      if (motion.mass === 0) bodyDesc.lockTranslations();
      if (motion.gravityFactor !== undefined) bodyDesc.setGravityScale(motion.gravityFactor);
      if (motion.linearVelocity) {
        const lv = motion.linearVelocity;
        bodyDesc.setLinvel(lv[0], lv[1], lv[2]);
      }
      if (motion.angularVelocity) {
        const av = motion.angularVelocity;
        bodyDesc.setAngvel({ x: av[0], y: av[1], z: av[2] });
      }
      if (motion.inertiaDiagonal) {
        const [ix, iy, iz] = motion.inertiaDiagonal;
        if (ix === 0 || iy === 0 || iz === 0) {
          let bodyQuat = tmpWorldQuaternion.clone();
          if (motion.inertiaOrientation) {
            const io = motion.inertiaOrientation;
            bodyQuat.multiply(new THREE.Quaternion(io[0], io[1], io[2], io[3]));
          }
          const diag = [ix, iy, iz];
          const localAxes = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
          let allowX = false, allowY = false, allowZ = false;
          for (let j = 0; j < 3; j++) {
            if (diag[j] !== 0) {
              const v = new THREE.Vector3(...localAxes[j]).applyQuaternion(bodyQuat);
              const ax = Math.abs(v.x), ay = Math.abs(v.y), az = Math.abs(v.z);
              if (ax >= ay && ax >= az) allowX = true;
              else if (ay >= ax && ay >= az) allowY = true;
              else allowZ = true;
            }
          }
          bodyDesc.enabledRotations(allowX, allowY, allowZ);
        }
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
