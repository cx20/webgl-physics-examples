import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const FIXED_TIMESTEP = 1 / 60;
const IDENTITY_QUATERNION = [0, 0, 0, 1];
const CONE_COUNT = 200;
const CONE_HALF_HEIGHT = 2;
const CONE_RADIUS = 1;
const SHOW_DEBUG_COLLIDERS = true;

let HK, worldId;
let scene, camera, renderer, controls;
const meshes = [];
const bodyIds = [];
const debugMeshes = [];

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

function buildConeHullPoints(halfHeight, radius, segments = 16) {
  const pts = [];
  pts.push(0, halfHeight, 0);
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    pts.push(radius * Math.cos(a), -halfHeight, radius * Math.sin(a));
  }
  return new Float32Array(pts);
}

function createConeShape() {
  if (typeof HK.HP_Shape_CreateConvexHull === 'function') {
    const pts = buildConeHullPoints(CONE_HALF_HEIGHT, CONE_RADIUS);
    const nPoints = pts.length / 3;
    let shapeId = null;

    if (typeof HK._malloc === 'function' && HK.HEAPU8) {
      const ptr = HK._malloc(pts.byteLength);
      new Float32Array(HK.HEAPU8.buffer, ptr, pts.length).set(pts);
      const res = HK.HP_Shape_CreateConvexHull(ptr, nPoints);
      HK._free(ptr);
      const rc = enumToNumber(res[0]);
      const ok = enumToNumber(HK.Result.RESULT_OK);
      if (rc === ok && res[1]) shapeId = res[1];
    }

    if (!shapeId) {
      const res = HK.HP_Shape_CreateConvexHull(pts, nPoints);
      const rc = enumToNumber(res[0]);
      const ok = enumToNumber(HK.Result.RESULT_OK);
      if (rc === ok && res[1]) shapeId = res[1];
    }

    if (shapeId) return shapeId;
  }
  // Fallback: use a cylinder
  if (typeof HK.HP_Shape_CreateCylinder === 'function') {
    const res = HK.HP_Shape_CreateCylinder(
      [0, -CONE_HALF_HEIGHT, 0], [0, CONE_HALF_HEIGHT, 0], CONE_RADIUS
    );
    checkResult(res[0], 'HP_Shape_CreateCylinder cone fallback');
    return res[1];
  }
  // Last resort: box approximation
  const res = HK.HP_Shape_CreateBox([0, 0, 0], IDENTITY_QUATERNION,
    [CONE_RADIUS * 2, CONE_HALF_HEIGHT * 2, CONE_RADIUS * 2]);
  checkResult(res[0], 'HP_Shape_CreateBox cone fallback');
  return res[1];
}

function createStaticBox(size, pos) {
  const sRes = HK.HP_Shape_CreateBox([0, 0, 0], IDENTITY_QUATERNION, size);
  checkResult(sRes[0], 'HP_Shape_CreateBox static');
  const bRes = HK.HP_Body_Create();
  checkResult(bRes[0], 'HP_Body_Create static');
  const bodyId = bRes[1];
  HK.HP_Body_SetShape(bodyId, sRes[1]);
  HK.HP_Body_SetMotionType(bodyId, HK.MotionType.STATIC);
  HK.HP_Body_SetPosition(bodyId, pos);
  HK.HP_Body_SetOrientation(bodyId, IDENTITY_QUATERNION);
  HK.HP_World_AddBody(worldId, bodyId, false);
}

function initThree() {
  const container = document.getElementById('container');
  scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0x3D4143));
  camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 1000);
  camera.position.set(18, 20, 30);

  const light = new THREE.DirectionalLight(0xffffff, 1);
  light.position.set(30, 100, 50);
  light.castShadow = true;
  scene.add(light);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  container.appendChild(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.autoRotate = true;

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

function initPhysics() {
  const worldRes = HK.HP_World_Create();
  checkResult(worldRes[0], 'HP_World_Create');
  worldId = worldRes[1];
  checkResult(HK.HP_World_SetGravity(worldId, [0, -9.8, 0]), 'HP_World_SetGravity');
  checkResult(HK.HP_World_SetIdealStepTime(worldId, FIXED_TIMESTEP), 'HP_World_SetIdealStepTime');

  const matGround = new THREE.MeshLambertMaterial({ color: 0x3D4143 });
  const matTrans = new THREE.MeshLambertMaterial({ color: 0x3D4143, transparent: true, opacity: 0.6 });
  const geoBox = new THREE.BoxGeometry(1, 1, 1);

  const loader = new THREE.TextureLoader();
  const carrotTex = loader.load('../../../../assets/textures/carrot.jpg');

  // Ground
  createStaticBox([40, 4, 40], [0, -2, 0]);
  const groundMesh = new THREE.Mesh(geoBox, matGround);
  groundMesh.scale.set(40, 4, 40);
  groundMesh.position.set(0, -2, 0);
  groundMesh.castShadow = true;
  groundMesh.receiveShadow = true;
  scene.add(groundMesh);
  if (SHOW_DEBUG_COLLIDERS) {
    const dbg = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(40, 4, 40)),
      new THREE.LineBasicMaterial({ color: 0x44ee88 })
    );
    dbg.position.set(0, -2, 0);
    scene.add(dbg);
  }

  // Walls
  const wallDefs = [
    { size: [10, 10,  1], pos: [ 0, 5, -5] },
    { size: [10, 10,  1], pos: [ 0, 5,  5] },
    { size: [ 1, 10, 10], pos: [-5, 5,  0] },
    { size: [ 1, 10, 10], pos: [ 5, 5,  0] },
  ];
  for (const { size, pos } of wallDefs) {
    createStaticBox(size, pos);
    const wallMesh = new THREE.Mesh(geoBox, matTrans);
    wallMesh.scale.set(size[0], size[1], size[2]);
    wallMesh.position.set(pos[0], pos[1], pos[2]);
    scene.add(wallMesh);
    if (SHOW_DEBUG_COLLIDERS) {
      const dbg = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(size[0], size[1], size[2])),
        new THREE.LineBasicMaterial({ color: 0x44ee88 })
      );
      dbg.position.set(pos[0], pos[1], pos[2]);
      scene.add(dbg);
    }
  }

  const coneShapeId = createConeShape();
  const cmRes = HK.HP_Shape_BuildMassProperties(coneShapeId);
  checkResult(cmRes[0], 'HP_Shape_BuildMassProperties cone');
  const coneMassProps = cmRes[1];

  const coneGeo = new THREE.CylinderGeometry(0.1, CONE_RADIUS, CONE_HALF_HEIGHT * 2, 20);
  const coneMat = new THREE.MeshLambertMaterial({ map: carrotTex });

  for (let i = 0; i < CONE_COUNT; i++) {
    const x = -3.5 + Math.random() * 7;
    const y = 20 + Math.random() * 10;
    const z = -3.5 + Math.random() * 7;

    const bRes = HK.HP_Body_Create();
    checkResult(bRes[0], 'HP_Body_Create cone');
    const bodyId = bRes[1];
    HK.HP_Body_SetShape(bodyId, coneShapeId);
    HK.HP_Body_SetMotionType(bodyId, HK.MotionType.DYNAMIC);
    HK.HP_Body_SetMassProperties(bodyId, coneMassProps);
    HK.HP_Body_SetPosition(bodyId, [x, y, z]);
    HK.HP_Body_SetOrientation(bodyId, IDENTITY_QUATERNION);
    HK.HP_World_AddBody(worldId, bodyId, false);
    bodyIds.push(bodyId);

    const mesh = new THREE.Mesh(coneGeo, coneMat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    meshes.push(mesh);
    if (SHOW_DEBUG_COLLIDERS) {
      const dbg = new THREE.LineSegments(
        new THREE.WireframeGeometry(new THREE.CylinderGeometry(0, CONE_RADIUS, CONE_HALF_HEIGHT * 2, 12)),
        new THREE.LineBasicMaterial({ color: 0xff8844 })
      );
      scene.add(dbg);
      debugMeshes.push(dbg);
    }
  }
}

function updatePhysics() {
  HK.HP_World_Step(worldId, FIXED_TIMESTEP);
  for (let i = 0; i < bodyIds.length; i++) {
    const [, pos] = HK.HP_Body_GetPosition(bodyIds[i]);
    const [, ori] = HK.HP_Body_GetOrientation(bodyIds[i]);
    meshes[i].position.set(pos[0], pos[1], pos[2]);
    meshes[i].quaternion.set(ori[0], ori[1], ori[2], ori[3]);
    if (SHOW_DEBUG_COLLIDERS && debugMeshes[i]) {
      debugMeshes[i].position.set(pos[0], pos[1], pos[2]);
      debugMeshes[i].quaternion.set(ori[0], ori[1], ori[2], ori[3]);
    }

    if (pos[1] < -10) {
      const x = -5 + Math.random() * 10;
      const y = 20 + Math.random() * 10;
      const z = -5 + Math.random() * 10;
      HK.HP_Body_SetPosition(bodyIds[i], [x, y, z]);
      HK.HP_Body_SetLinearVelocity(bodyIds[i], [0, 0, 0]);
      HK.HP_Body_SetAngularVelocity(bodyIds[i], [0, 0, 0]);
    }
  }
}

function loop() {
  renderer.render(scene, camera);
  controls.update();
  requestAnimationFrame(loop);
}

async function main() {
  HK = await HavokPhysics();
  initThree();
  initPhysics();
  setInterval(updatePhysics, 1000 / 60);
  loop();
}

main().catch(console.error);
