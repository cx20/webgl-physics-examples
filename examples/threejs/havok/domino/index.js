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

function createStaticBox(shapeSize, position) {
  const sRes = HK.HP_Shape_CreateBox([0, 0, 0], IDENTITY_QUATERNION, shapeSize);
  checkResult(sRes[0], 'HP_Shape_CreateBox static');
  const bRes = HK.HP_Body_Create();
  checkResult(bRes[0], 'HP_Body_Create static');
  const bodyId = bRes[1];
  HK.HP_Body_SetShape(bodyId, sRes[1]);
  HK.HP_Body_SetMotionType(bodyId, HK.MotionType.STATIC);
  HK.HP_Body_SetPosition(bodyId, position);
  HK.HP_Body_SetOrientation(bodyId, IDENTITY_QUATERNION);
  HK.HP_World_AddBody(worldId, bodyId, false);
  return bodyId;
}

function createDynamic(shapeId, massProps, position) {
  const bRes = HK.HP_Body_Create();
  checkResult(bRes[0], 'HP_Body_Create dynamic');
  const bodyId = bRes[1];
  HK.HP_Body_SetShape(bodyId, shapeId);
  HK.HP_Body_SetMotionType(bodyId, HK.MotionType.DYNAMIC);
  HK.HP_Body_SetMassProperties(bodyId, massProps);
  HK.HP_Body_SetPosition(bodyId, position);
  HK.HP_Body_SetOrientation(bodyId, IDENTITY_QUATERNION);
  HK.HP_World_AddBody(worldId, bodyId, false);
  return bodyId;
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
  grassTex.wrapS = grassTex.wrapT = THREE.RepeatWrapping;
  grassTex.repeat.set(5, 5);

  // Ground
  createStaticBox([100, 0.2, 100], [0, 0, 0]);
  const groundMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(100, 100),
    new THREE.MeshLambertMaterial({ color: 0x777777, map: grassTex })
  );
  groundMesh.rotation.x = -Math.PI / 2;
  scene.add(groundMesh);
  if (SHOW_DEBUG_COLLIDERS) {
    const dbg = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(100, 0.2, 100)),
      new THREE.LineBasicMaterial({ color: 0x44ee88 })
    );
    scene.add(dbg);
  }

  const box_size = 2;
  const DOMINO_W = box_size * 0.15;
  const DOMINO_H = box_size * 1.5;
  const DOMINO_D = box_size * 1.0;

  // Shared domino shape
  const dsRes = HK.HP_Shape_CreateBox([0, 0, 0], IDENTITY_QUATERNION, [DOMINO_W, DOMINO_H, DOMINO_D]);
  checkResult(dsRes[0], 'HP_Shape_CreateBox domino');
  const dominoShapeId = dsRes[1];
  const dmRes = HK.HP_Shape_BuildMassProperties(dominoShapeId);
  checkResult(dmRes[0], 'HP_Shape_BuildMassProperties domino');
  const dominoMassProps = dmRes[1];

  // Shared ball shape
  const ballRadius = box_size / 2;
  const bsRes = HK.HP_Shape_CreateSphere([0, 0, 0], ballRadius);
  checkResult(bsRes[0], 'HP_Shape_CreateSphere ball');
  const ballShapeId = bsRes[1];
  const bmRes = HK.HP_Shape_BuildMassProperties(ballShapeId);
  checkResult(bmRes[0], 'HP_Shape_BuildMassProperties ball');
  const ballMassProps = bmRes[1];

  const footballTex = loader.load('../../../../assets/textures/football.png');

  // Create 16x16 dominos
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const x1 = -8 * box_size + x * box_size;
      const y1 = box_size;
      const z1 = -8 * box_size + y * box_size * 1.2;
      const color = colorHash[dataSet[y * 16 + x]];

      const bodyId = createDynamic(dominoShapeId, dominoMassProps, [x1, y1, z1]);
      bodyIds.push(bodyId);

      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(DOMINO_W, DOMINO_H, DOMINO_D),
        new THREE.MeshLambertMaterial({ color })
      );
      scene.add(mesh);
      meshes.push(mesh);
      if (SHOW_DEBUG_COLLIDERS) {
        const dbg = new THREE.LineSegments(
          new THREE.EdgesGeometry(new THREE.BoxGeometry(DOMINO_W, DOMINO_H, DOMINO_D)),
          new THREE.LineBasicMaterial({ color: 0xff8844 })
        );
        scene.add(dbg);
        debugMeshes.push(dbg);
      }
    }
  }

  // Create 16 balls
  for (let y = 0; y < 16; y++) {
    const x1 = -8 * box_size - 0.5;
    const y1 = 8;
    const z1 = -8 * box_size + (15 - y) * box_size * 1.2;

    const bodyId = createDynamic(ballShapeId, ballMassProps, [x1, y1, z1]);
    bodyIds.push(bodyId);

    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(ballRadius, 10, 10),
      new THREE.MeshLambertMaterial({ color: 0xffffff, map: footballTex })
    );
    scene.add(mesh);
    meshes.push(mesh);
    if (SHOW_DEBUG_COLLIDERS) {
      const dbg = new THREE.LineSegments(
        new THREE.WireframeGeometry(new THREE.SphereGeometry(ballRadius, 8, 6)),
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
