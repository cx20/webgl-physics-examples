import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const FIXED_TIMESTEP = 1 / 60;
const IDENTITY_QUATERNION = [0, 0, 0, 1];
const DUCK_URL = 'https://rawcdn.githack.com/cx20/gltf-test/5465cc37/sampleModels/Duck/glTF/Duck.gltf';

const cubeSizeX = 16 / 16 * 5;
const cubeSizeY = 16 / 16 * 5;
const cubeSizeZ = 9 / 16 * 5;

let HK, worldId;
let scene, camera, renderer, controls;
let duck, wireframeCube;
let duckBodyId;

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
  camera = new THREE.PerspectiveCamera(30, window.innerWidth / window.innerHeight, 1, 10000);
  camera.position.set(20, 3, 20);

  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x000000, 1, 200);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x000000, 1);
  container.appendChild(renderer.domElement);

  const light = new THREE.DirectionalLight(0xffffff, 2);
  light.position.set(10, 10, -10);
  scene.add(light);
  scene.add(new THREE.AmbientLight(0x404040));

  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(300, 300),
    new THREE.MeshPhongMaterial({ color: 0xffffff, specular: 0xeeeeee, shininess: 50 })
  );
  plane.position.y = -5;
  plane.rotation.x = -Math.PI / 2;
  scene.add(plane);

  wireframeCube = new THREE.Mesh(
    new THREE.BoxGeometry(cubeSizeX * 2, cubeSizeY * 2, cubeSizeZ * 2),
    new THREE.MeshBasicMaterial({ color: 0x00ff00, wireframe: true })
  );
  scene.add(wireframeCube);

  controls = new OrbitControls(camera, renderer.domElement);

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

  // Ground
  const gsRes = HK.HP_Shape_CreateBox([0, 0, 0], IDENTITY_QUATERNION, [800, 8, 800]);
  checkResult(gsRes[0], 'HP_Shape_CreateBox ground');
  const gbRes = HK.HP_Body_Create();
  checkResult(gbRes[0], 'HP_Body_Create ground');
  const groundId = gbRes[1];
  HK.HP_Body_SetShape(groundId, gsRes[1]);
  HK.HP_Body_SetMotionType(groundId, HK.MotionType.STATIC);
  HK.HP_Body_SetPosition(groundId, [0, -5, 0]);
  HK.HP_Body_SetOrientation(groundId, IDENTITY_QUATERNION);
  HK.HP_World_AddBody(worldId, groundId, false);

  // Duck body (box collider matching duck bounding box)
  const collisionSize = [cubeSizeX * 2, cubeSizeY * 2, cubeSizeZ * 2];
  const dsRes = HK.HP_Shape_CreateBox([0, 0, 0], IDENTITY_QUATERNION, collisionSize);
  checkResult(dsRes[0], 'HP_Shape_CreateBox duck');
  const dbRes = HK.HP_Body_Create();
  checkResult(dbRes[0], 'HP_Body_Create duck');
  duckBodyId = dbRes[1];
  HK.HP_Body_SetShape(duckBodyId, dsRes[1]);
  HK.HP_Body_SetMotionType(duckBodyId, HK.MotionType.DYNAMIC);
  const dmRes = HK.HP_Shape_BuildMassProperties(dsRes[1]);
  checkResult(dmRes[0], 'HP_Shape_BuildMassProperties duck');
  HK.HP_Body_SetMassProperties(duckBodyId, dmRes[1]);
  HK.HP_Body_SetPosition(duckBodyId, [0, 20, 0]);
  HK.HP_Body_SetOrientation(duckBodyId, IDENTITY_QUATERNION);
  HK.HP_Body_SetAngularVelocity(duckBodyId, [0, 0, 3.5]);
  HK.HP_World_AddBody(worldId, duckBodyId, false);
}

function loadDuck() {
  const loader = new GLTFLoader();
  loader.load(DUCK_URL, (data) => {
    const object = data.scene;
    object.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.translateY(child.position.y - 100);
      }
    });
    object.scale.set(5, 5, 5);
    duck = object;
    duck.castShadow = true;
    scene.add(duck);

    setInterval(updatePhysics, 1000 / 60);
    animate();
  });
}

function updatePhysics() {
  HK.HP_World_Step(worldId, FIXED_TIMESTEP);
  const [, pos] = HK.HP_Body_GetPosition(duckBodyId);
  const [, ori] = HK.HP_Body_GetOrientation(duckBodyId);
  duck.position.set(pos[0], pos[1], pos[2]);
  duck.quaternion.set(ori[0], ori[1], ori[2], ori[3]);
  wireframeCube.position.set(pos[0], pos[1], pos[2]);
  wireframeCube.quaternion.set(ori[0], ori[1], ori[2], ori[3]);
}

function animate() {
  controls.update();
  requestAnimationFrame(animate);
  renderer.render(scene, camera);
}

document.addEventListener('click', () => {
  if (duckBodyId !== undefined) {
    HK.HP_Body_SetLinearVelocity(duckBodyId, [0, 5, 0]);
  }
});

async function main() {
  HK = await HavokPhysics();
  initThree();
  initPhysics();
  loadDuck();
}

main().catch(console.error);
