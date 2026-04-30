import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const FIXED_TIMESTEP = 1 / 60;
const IDENTITY_QUATERNION = [0, 0, 0, 1];
const PIECE_COUNT = 220;

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

function createShogiGeometry(w, h, d) {
  const positions = [
    -0.5 * w, -0.5 * h,  0.7 * d,   0.5 * w, -0.5 * h,  0.7 * d,
     0.35 * w, 0.5 * h,  0.4 * d,  -0.35 * w, 0.5 * h,  0.4 * d,
    -0.5 * w, -0.5 * h, -0.7 * d,   0.5 * w, -0.5 * h, -0.7 * d,
     0.35 * w, 0.5 * h, -0.4 * d,  -0.35 * w, 0.5 * h, -0.4 * d,
     0.35 * w, 0.5 * h,  0.4 * d,  -0.35 * w, 0.5 * h,  0.4 * d,
    -0.35 * w, 0.5 * h, -0.4 * d,   0.35 * w, 0.5 * h, -0.4 * d,
    -0.5 * w, -0.5 * h,  0.7 * d,   0.5 * w, -0.5 * h,  0.7 * d,
     0.5 * w, -0.5 * h, -0.7 * d,  -0.5 * w, -0.5 * h, -0.7 * d,
     0.5 * w, -0.5 * h,  0.7 * d,   0.35 * w, 0.5 * h,  0.4 * d,
     0.35 * w, 0.5 * h, -0.4 * d,   0.5 * w, -0.5 * h, -0.7 * d,
    -0.5 * w, -0.5 * h,  0.7 * d,  -0.35 * w, 0.5 * h,  0.4 * d,
    -0.35 * w, 0.5 * h, -0.4 * d,  -0.5 * w, -0.5 * h, -0.7 * d,
    -0.35 * w, 0.5 * h,  0.4 * d,   0.35 * w, 0.5 * h,  0.4 * d,
     0.0 * w,  0.6 * h,  0.35 * d,
    -0.35 * w, 0.5 * h, -0.4 * d,   0.35 * w, 0.5 * h, -0.4 * d,
     0.0 * w,  0.6 * h, -0.35 * d,
     0.35 * w, 0.5 * h,  0.4 * d,   0.35 * w, 0.5 * h, -0.4 * d,
     0.0 * w,  0.6 * h, -0.35 * d,   0.0 * w,  0.6 * h,  0.35 * d,
    -0.35 * w, 0.5 * h,  0.4 * d,  -0.35 * w, 0.5 * h, -0.4 * d,
     0.0 * w,  0.6 * h, -0.35 * d,   0.0 * w,  0.6 * h,  0.35 * d,
  ];
  const texcoords = [
    0.5, 0.5, 0.75, 0.5, 0.75 - 0.25/8, 1.0, 0.5 + 0.25/8, 1.0,
    0.5, 0.5, 0.25, 0.5, 0.25 + 0.25/8, 1.0, 0.5 - 0.25/8, 1.0,
    0.75, 0.5, 0.5, 0.5, 0.5, 0.0, 0.75, 0.0,
    0.0, 0.5, 0.25, 0.5, 0.25, 1.0, 0.0, 1.0,
    0.0, 0.5, 0.0, 0.0, 0.25, 0.0, 0.25, 0.5,
    0.5, 0.5, 0.5, 0.0, 0.25, 0.0, 0.25, 0.5,
    0.75, 0.0, 1.0, 0.0, 1.0, 0.5,
    0.75, 0.0, 1.0, 0.0, 1.0, 0.5,
    0.75, 0.0, 1.0, 0.0, 1.0, 0.5, 0.75, 0.5,
    0.75, 0.0, 1.0, 0.0, 1.0, 0.5, 0.75, 0.5,
  ];
  const indices = [
     0,  1,  2,   0,  2,  3,
     4,  5,  6,   4,  6,  7,
     8,  9, 10,   8, 10, 11,
    12, 13, 14,  12, 14, 15,
    16, 17, 18,  16, 18, 19,
    20, 21, 22,  20, 22, 23,
    24, 25, 26,
    27, 28, 29,
    30, 33, 31,  33, 32, 31,
    34, 35, 36,  34, 36, 37,
  ];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(texcoords, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function createStaticBox(size, pos, mat) {
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
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), mat);
  mesh.position.set(pos[0], pos[1], pos[2]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
}

function randomQuaternion() {
  const euler = new THREE.Euler(
    Math.random() * Math.PI,
    Math.random() * Math.PI,
    Math.random() * Math.PI
  );
  return new THREE.Quaternion().setFromEuler(euler);
}

function initThree() {
  const container = document.getElementById('container');
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x2b2f38);
  scene.add(new THREE.HemisphereLight(0xbfd6ff, 0x2a2a2a, 0.9));
  scene.add(new THREE.AmbientLight(0x666666, 1.3));

  camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 1000);
  camera.position.set(18, 24, 34);

  const light = new THREE.DirectionalLight(0xffffff, 2.1);
  light.position.set(30, 100, 50);
  light.castShadow = true;
  scene.add(light);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;
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

  const loader = new THREE.TextureLoader();
  const shogiTex = loader.load('../../../../assets/textures/shogi_001/shogi.png');
  shogiTex.wrapS = THREE.ClampToEdgeWrapping;
  shogiTex.wrapT = THREE.ClampToEdgeWrapping;
  shogiTex.flipY = false;

  const shogiMat = new THREE.MeshLambertMaterial({ map: shogiTex, side: THREE.DoubleSide });
  const groundMat = new THREE.MeshLambertMaterial({ color: 0x3D4143 });
  const wallMat = new THREE.MeshLambertMaterial({ color: 0x3D4143, transparent: true, opacity: 0.4 });

  createStaticBox([40, 4, 40], [0, -2, 0], groundMat);

  const wallData = [
    { size: [10, 10,  1], pos: [ 0, 5, -5] },
    { size: [10, 10,  1], pos: [ 0, 5,  5] },
    { size: [ 1, 10, 10], pos: [-5, 5,  0] },
    { size: [ 1, 10, 10], pos: [ 5, 5,  0] },
  ];
  for (const { size, pos } of wallData) {
    createStaticBox(size, pos, wallMat);
  }

  const pieceW = 1.6;
  const pieceH = 1.6;
  const pieceD = 0.45;

  const psRes = HK.HP_Shape_CreateBox([0, 0, 0], IDENTITY_QUATERNION, [pieceW, pieceH, pieceD * 1.4]);
  checkResult(psRes[0], 'HP_Shape_CreateBox shogi');
  const pieceShapeId = psRes[1];
  const pmRes = HK.HP_Shape_BuildMassProperties(pieceShapeId);
  checkResult(pmRes[0], 'HP_Shape_BuildMassProperties shogi');
  const pieceMassProps = pmRes[1];

  const pieceGeo = createShogiGeometry(pieceW, pieceH, pieceD);

  for (let i = 0; i < PIECE_COUNT; i++) {
    const x = (Math.random() - 0.5) * 8;
    const y = 12 + Math.random() * 26;
    const z = (Math.random() - 0.5) * 8;
    const q = randomQuaternion();

    const bRes = HK.HP_Body_Create();
    checkResult(bRes[0], 'HP_Body_Create shogi');
    const bodyId = bRes[1];
    HK.HP_Body_SetShape(bodyId, pieceShapeId);
    HK.HP_Body_SetMotionType(bodyId, HK.MotionType.DYNAMIC);
    HK.HP_Body_SetMassProperties(bodyId, pieceMassProps);
    HK.HP_Body_SetPosition(bodyId, [x, y, z]);
    HK.HP_Body_SetOrientation(bodyId, [q.x, q.y, q.z, q.w]);
    HK.HP_World_AddBody(worldId, bodyId, false);
    bodyIds.push(bodyId);

    const mesh = new THREE.Mesh(pieceGeo, shogiMat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
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
      const x = (Math.random() - 0.5) * 8;
      const y = 12 + Math.random() * 26;
      const z = (Math.random() - 0.5) * 8;
      const q = randomQuaternion();
      HK.HP_Body_SetPosition(bodyIds[i], [x, y, z]);
      HK.HP_Body_SetOrientation(bodyIds[i], [q.x, q.y, q.z, q.w]);
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
