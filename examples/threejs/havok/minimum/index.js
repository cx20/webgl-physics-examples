import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const FIXED_TIMESTEP = 1 / 60;
const IDENTITY_QUATERNION = [0, 0, 0, 1];
const SHOW_DEBUG_COLLIDERS = true;

let HK, worldId;
let scene, camera, renderer, controls;
let meshGround, meshCube;
let groundBodyId, cubeBodyId;
let debugGround, debugCube;

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

function initThree() {
  const container = document.getElementById('container');
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(30, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.y = 3;
  camera.position.z = 6;

  const loader = new THREE.TextureLoader();
  const texture = loader.load('../../../../assets/textures/frog.jpg');
  const material = new THREE.MeshBasicMaterial({ map: texture });

  meshGround = new THREE.Mesh(new THREE.BoxGeometry(4, 0.1, 4), material);
  meshGround.position.y = 0;
  scene.add(meshGround);

  meshCube = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
  scene.add(meshCube);

  renderer = new THREE.WebGLRenderer();
  renderer.setClearColor(0xffffff);
  renderer.setSize(window.innerWidth, window.innerHeight);
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
  checkResult(HK.HP_World_SetGravity(worldId, [0, -9.81, 0]), 'HP_World_SetGravity');
  checkResult(HK.HP_World_SetIdealStepTime(worldId, FIXED_TIMESTEP), 'HP_World_SetIdealStepTime');

  // Ground (static)
  const gsRes = HK.HP_Shape_CreateBox([0, 0, 0], IDENTITY_QUATERNION, [4, 0.1, 4]);
  checkResult(gsRes[0], 'HP_Shape_CreateBox ground');
  const gbRes = HK.HP_Body_Create();
  checkResult(gbRes[0], 'HP_Body_Create ground');
  groundBodyId = gbRes[1];
  HK.HP_Body_SetShape(groundBodyId, gsRes[1]);
  HK.HP_Body_SetMotionType(groundBodyId, HK.MotionType.STATIC);
  HK.HP_Body_SetPosition(groundBodyId, [0, 0, 0]);
  HK.HP_Body_SetOrientation(groundBodyId, IDENTITY_QUATERNION);
  HK.HP_World_AddBody(worldId, groundBodyId, false);
  if (SHOW_DEBUG_COLLIDERS) {
    debugGround = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(4, 0.1, 4)),
      new THREE.LineBasicMaterial({ color: 0x44ee88 })
    );
    scene.add(debugGround);
  }

  // Cube (dynamic)
  const csRes = HK.HP_Shape_CreateBox([0, 0, 0], IDENTITY_QUATERNION, [1, 1, 1]);
  checkResult(csRes[0], 'HP_Shape_CreateBox cube');
  const cbRes = HK.HP_Body_Create();
  checkResult(cbRes[0], 'HP_Body_Create cube');
  cubeBodyId = cbRes[1];
  HK.HP_Body_SetShape(cubeBodyId, csRes[1]);
  HK.HP_Body_SetMotionType(cubeBodyId, HK.MotionType.DYNAMIC);
  const mRes = HK.HP_Shape_BuildMassProperties(csRes[1]);
  checkResult(mRes[0], 'HP_Shape_BuildMassProperties cube');
  HK.HP_Body_SetMassProperties(cubeBodyId, mRes[1]);
  HK.HP_Body_SetPosition(cubeBodyId, [0, 2, 0]);
  const rotQuat = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(1, 0, 1).normalize(), Math.PI * 10 / 180
  );
  HK.HP_Body_SetOrientation(cubeBodyId, [rotQuat.x, rotQuat.y, rotQuat.z, rotQuat.w]);
  HK.HP_World_AddBody(worldId, cubeBodyId, false);
  if (SHOW_DEBUG_COLLIDERS) {
    debugCube = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
      new THREE.LineBasicMaterial({ color: 0xff8844 })
    );
    debugCube.position.set(0, 2, 0);
    scene.add(debugCube);
  }
}

function updatePhysics() {
  HK.HP_World_Step(worldId, FIXED_TIMESTEP);
  const [, pos] = HK.HP_Body_GetPosition(cubeBodyId);
  const [, ori] = HK.HP_Body_GetOrientation(cubeBodyId);
  meshCube.position.set(pos[0], pos[1], pos[2]);
  meshCube.quaternion.set(ori[0], ori[1], ori[2], ori[3]);
  if (SHOW_DEBUG_COLLIDERS && debugCube) {
    debugCube.position.set(pos[0], pos[1], pos[2]);
    debugCube.quaternion.set(ori[0], ori[1], ori[2], ori[3]);
  }
}

function animate() {
  controls.update();
  requestAnimationFrame(animate);
  renderer.render(scene, camera);
}

async function main() {
  HK = await HavokPhysics();
  initThree();
  initPhysics();
  setInterval(updatePhysics, 1000 / 60);
  animate();
}

main().catch(console.error);
