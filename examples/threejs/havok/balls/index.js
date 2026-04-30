import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const FIXED_TIMESTEP = 1 / 60;
const IDENTITY_QUATERNION = [0, 0, 0, 1];

const dataSet = [
    { imageFile: '../../../../assets/textures/Basketball.jpg', scale: 1.0, restitution: 0.6 },
    { imageFile: '../../../../assets/textures/BeachBall.jpg',  scale: 0.9, restitution: 0.7 },
    { imageFile: '../../../../assets/textures/Football.jpg',   scale: 1.0, restitution: 0.55 },
    { imageFile: '../../../../assets/textures/Softball.jpg',   scale: 0.3, restitution: 0.4 },
    { imageFile: '../../../../assets/textures/TennisBall.jpg', scale: 0.3, restitution: 0.75 },
];

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
  camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 300);
  camera.position.set(10, 10, 16);

  scene.add(new THREE.AmbientLight(0x3D4143));
  const dirLight = new THREE.DirectionalLight(0xffffff, 1);
  dirLight.position.set(30, 100, 50);
  dirLight.castShadow = true;
  scene.add(dirLight);

  renderer = new THREE.WebGLRenderer();
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
  checkResult(HK.HP_World_SetGravity(worldId, [0, -10, 0]), 'HP_World_SetGravity');
  checkResult(HK.HP_World_SetIdealStepTime(worldId, FIXED_TIMESTEP), 'HP_World_SetIdealStepTime');

  const matGround = new THREE.MeshLambertMaterial({ color: 0x3D4143 });
  const matGroundTrans = new THREE.MeshLambertMaterial({ color: 0x3D4143, transparent: true, opacity: 0.6 });
  const geoBox = new THREE.BoxGeometry(1, 1, 1);

  // Ground
  createStaticBox([20, 2, 20], [0, -2, 0]);
  const groundMesh = new THREE.Mesh(geoBox, matGround);
  groundMesh.scale.set(20, 2, 20);
  groundMesh.position.set(0, -2, 0);
  groundMesh.receiveShadow = true;
  scene.add(groundMesh);

  // Walls
  const wallDefs = [
    { size: [5, 5,  0.5], pos: [ 0, 1.5, -2.5] },
    { size: [5, 5,  0.5], pos: [ 0, 1.5,  2.5] },
    { size: [0.5, 5, 5], pos: [-2.5, 1.5,  0] },
    { size: [0.5, 5, 5], pos: [ 2.5, 1.5,  0] },
  ];

  for (const { size, pos } of wallDefs) {
    createStaticBox(size, pos);
    const wallMesh = new THREE.Mesh(geoBox, matGroundTrans);
    wallMesh.scale.set(size[0], size[1], size[2]);
    wallMesh.position.set(pos[0], pos[1], pos[2]);
    scene.add(wallMesh);
  }

  // Balls
  const loader = new THREE.TextureLoader();
  const textures = dataSet.map(d => loader.load(d.imageFile));
  const geoSphere = new THREE.SphereGeometry(1, 20, 10);

  for (let i = 0; i < 200; i++) {
    const x = -5 + Math.random() * 10;
    const y = 6 + Math.random() * 13;
    const z = -5 + Math.random() * 10;
    const idx = Math.floor(Math.random() * dataSet.length);
    const scale = dataSet[idx].scale;
    const radius = scale * 0.5;

    const ssRes = HK.HP_Shape_CreateSphere([0, 0, 0], radius);
    checkResult(ssRes[0], 'HP_Shape_CreateSphere ball');
    if (typeof HK.HP_Shape_SetMaterial === 'function') {
      HK.HP_Shape_SetMaterial(ssRes[1], [0.5, 0.5, dataSet[idx].restitution, HK.MaterialCombine.MAXIMUM, HK.MaterialCombine.MAXIMUM]);
    }
    const smRes = HK.HP_Shape_BuildMassProperties(ssRes[1]);
    checkResult(smRes[0], 'HP_Shape_BuildMassProperties ball');
    const sbRes = HK.HP_Body_Create();
    checkResult(sbRes[0], 'HP_Body_Create ball');
    const bodyId = sbRes[1];
    HK.HP_Body_SetShape(bodyId, ssRes[1]);
    HK.HP_Body_SetMotionType(bodyId, HK.MotionType.DYNAMIC);
    HK.HP_Body_SetMassProperties(bodyId, smRes[1]);
    HK.HP_Body_SetPosition(bodyId, [x, y, z]);
    HK.HP_Body_SetOrientation(bodyId, IDENTITY_QUATERNION);
    HK.HP_World_AddBody(worldId, bodyId, false);
    bodyIds.push(bodyId);

    const mesh = new THREE.Mesh(
      geoSphere,
      new THREE.MeshLambertMaterial({ map: textures[idx] })
    );
    mesh.scale.setScalar(scale * 0.5);
    mesh.castShadow = true;
    scene.add(mesh);
    meshes.push(mesh);
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
      const y = 10 + Math.random() * 8;
      const z = -5 + Math.random() * 10;
      HK.HP_Body_SetPosition(bodyIds[i], [x, y, z]);
      HK.HP_Body_SetLinearVelocity(bodyIds[i], [0, 0, 0]);
      HK.HP_Body_SetAngularVelocity(bodyIds[i], [0, 0, 0]);
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
