import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ‥‥‥‥‥‥‥‥‥‥‥‥‥□□□
// ‥‥‥‥‥‥〓〓〓〓〓‥‥□□□
// ‥‥‥‥‥〓〓〓〓〓〓〓〓〓□□
// ‥‥‥‥‥■■■□□■□‥■■■
// ‥‥‥‥■□■□□□■□□■■■
// ‥‥‥‥■□■■□□□■□□□■
// ‥‥‥‥■■□□□□■■■■■‥
// ‥‥‥‥‥‥□□□□□□□■‥‥
// ‥‥■■■■■〓■■■〓■‥‥‥
// ‥■■■■■■■〓■■■〓‥‥■
// □□■■■■■■〓〓〓〓〓‥‥■
// □□□‥〓〓■〓〓□〓〓□〓■■
// ‥□‥■〓〓〓〓〓〓〓〓〓〓■■
// ‥‥■■■〓〓〓〓〓〓〓〓〓■■
// ‥■■■〓〓〓〓〓〓〓‥‥‥‥‥
// ‥■‥‥〓〓〓〓‥‥‥‥‥‥‥‥
const dataSet = [
    "無","無","無","無","無","無","無","無","無","無","無","無","無","肌","肌","肌",
    "無","無","無","無","無","無","赤","赤","赤","赤","赤","無","無","肌","肌","肌",
    "無","無","無","無","無","赤","赤","赤","赤","赤","赤","赤","赤","赤","肌","肌",
    "無","無","無","無","無","茶","茶","茶","肌","肌","茶","肌","無","赤","赤","赤",
    "無","無","無","無","茶","肌","茶","肌","肌","肌","茶","肌","肌","赤","赤","赤",
    "無","無","無","無","茶","肌","茶","茶","肌","肌","肌","茶","肌","肌","肌","赤",
    "無","無","無","無","茶","茶","肌","肌","肌","肌","茶","茶","茶","茶","赤","無",
    "無","無","無","無","無","無","肌","肌","肌","肌","肌","肌","肌","赤","無","無",
    "無","無","赤","赤","赤","赤","赤","青","赤","赤","赤","青","赤","無","無","無",
    "無","赤","赤","赤","赤","赤","赤","赤","青","赤","赤","赤","青","無","無","茶",
    "肌","肌","赤","赤","赤","赤","赤","赤","青","青","青","青","青","無","無","茶",
    "肌","肌","肌","無","青","青","赤","青","青","黄","青","青","黄","青","茶","茶",
    "無","肌","無","茶","青","青","青","青","青","青","青","青","青","青","茶","茶",
    "無","無","茶","茶","茶","青","青","青","青","青","青","青","青","青","茶","茶",
    "無","茶","茶","茶","青","青","青","青","青","青","青","無","無","無","無","無",
    "無","茶","無","無","青","青","青","青","無","無","無","無","無","無","無","無"
];

const colorHash = {
    "無": 0xDCAA6B, "白": 0xffffff, "肌": 0xffcccc, "茶": 0x800000,
    "赤": 0xff0000, "黄": 0xffff00, "緑": 0x00ff00, "水": 0x00ffff,
    "青": 0x0000ff, "紫": 0x800080
};

const FIXED_TIMESTEP = 1 / 60;
const IDENTITY_QUATERNION = [0, 0, 0, 1];
const BOX_SIZE = 1;

let HK, worldId;
let scene, camera, renderer, controls;

const meshes = [];
const bodyIds = [];

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
  camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 300);
  camera.position.set(8, 10, 24);
  camera.lookAt(new THREE.Vector3(0, 4, 0));

  renderer = new THREE.WebGLRenderer();
  renderer.setSize(window.innerWidth, window.innerHeight);
  container.appendChild(renderer.domElement);

  const dirLight = new THREE.DirectionalLight(0xffffff, 1);
  dirLight.position.set(0.4, 1, 0.3);
  scene.add(dirLight);
  scene.add(new THREE.AmbientLight(0x101020));

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
  checkResult(HK.HP_World_SetGravity(worldId, [0, -10, 0]), 'HP_World_SetGravity');
  checkResult(HK.HP_World_SetIdealStepTime(worldId, FIXED_TIMESTEP), 'HP_World_SetIdealStepTime');

  const loader = new THREE.TextureLoader();
  const grassTex = loader.load('../../../../assets/textures/grass.jpg');

  // Ground
  const gsRes = HK.HP_Shape_CreateBox([0, 0, 0], IDENTITY_QUATERNION, [30, 0.4, 30]);
  checkResult(gsRes[0], 'HP_Shape_CreateBox ground');
  const gbRes = HK.HP_Body_Create();
  checkResult(gbRes[0], 'HP_Body_Create ground');
  const groundId = gbRes[1];
  HK.HP_Body_SetShape(groundId, gsRes[1]);
  HK.HP_Body_SetMotionType(groundId, HK.MotionType.STATIC);
  HK.HP_Body_SetPosition(groundId, [0, 0, 0]);
  HK.HP_Body_SetOrientation(groundId, IDENTITY_QUATERNION);
  HK.HP_World_AddBody(worldId, groundId, false);

  const groundMesh = new THREE.Mesh(
    new THREE.BoxGeometry(30, 0.4, 30),
    new THREE.MeshBasicMaterial({ map: grassTex })
  );
  scene.add(groundMesh);

  // Shared box shape
  const bsRes = HK.HP_Shape_CreateBox([0, 0, 0], IDENTITY_QUATERNION, [BOX_SIZE, BOX_SIZE, BOX_SIZE]);
  checkResult(bsRes[0], 'HP_Shape_CreateBox box');
  const boxShapeId = bsRes[1];
  const bmRes = HK.HP_Shape_BuildMassProperties(boxShapeId);
  checkResult(bmRes[0], 'HP_Shape_BuildMassProperties box');
  const boxMassProps = bmRes[1];

  for (let x = 0; x < 16; x++) {
    for (let y = 0; y < 16; y++) {
      const i = x + (15 - y) * 16;
      const color = colorHash[dataSet[y * 16 + x]];
      const x1 = -12 + x * BOX_SIZE * 1.5 + Math.random() * 0.1;
      const y1 = (15 - y) * BOX_SIZE * 1.2 + Math.random() * 0.1;
      const z1 = Math.random() * 0.1;

      const bRes = HK.HP_Body_Create();
      checkResult(bRes[0], 'HP_Body_Create box');
      const bodyId = bRes[1];
      HK.HP_Body_SetShape(bodyId, boxShapeId);
      HK.HP_Body_SetMotionType(bodyId, HK.MotionType.DYNAMIC);
      HK.HP_Body_SetMassProperties(bodyId, boxMassProps);
      HK.HP_Body_SetPosition(bodyId, [x1, y1, z1]);
      HK.HP_Body_SetOrientation(bodyId, IDENTITY_QUATERNION);
      HK.HP_World_AddBody(worldId, bodyId, false);
      bodyIds.push(bodyId);

      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(BOX_SIZE, BOX_SIZE, BOX_SIZE),
        new THREE.MeshLambertMaterial({ color })
      );
      scene.add(mesh);
      meshes.push(mesh);
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

    if (pos[1] < -10) {
      const x = -5 + Math.random() * 10;
      const y = 20 + Math.random() * 10;
      const z = -5 + Math.random() * 10;
      HK.HP_Body_SetPosition(bodyIds[i], [x, y, z]);
      HK.HP_Body_SetLinearVelocity(bodyIds[i], [0, 0, 0]);
    }
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
