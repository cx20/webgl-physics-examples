import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HDRCubeTextureLoader } from 'three/addons/loaders/HDRCubeTextureLoader.js';

const GLTF_URL = 'https://cx20.github.io/gltf-test/tutorialModels/IridescenceMetallicSpheres/glTF/IridescenceMetallicSpheres.gltf';
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
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.shadowMap.enabled = true;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  container.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x222222);

  const BASE_HDR = 'https://cx20.github.io/gltf-test/textures/papermill_hdr/specular/';
  new HDRCubeTextureLoader().load([
    'specular_posx_0.hdr', 'specular_negx_0.hdr',
    'specular_posy_0.hdr', 'specular_negy_0.hdr',
    'specular_posz_0.hdr', 'specular_negz_0.hdr',
  ].map(f => BASE_HDR + f), (hdrCubeMap) => {
    hdrCubeMap.mapping = THREE.CubeReflectionMapping;
    const pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileCubemapShader();
    scene.environment = pmrem.fromCubemap(hdrCubeMap).texture;
    scene.background = hdrCubeMap;
    pmrem.dispose();
  });

  camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 1000);
  camera.position.set(18, 20, 30);

  scene.add(new THREE.AmbientLight(0x404040, 3));
  const dirLight = new THREE.DirectionalLight(0xffffff, 3);
  dirLight.position.set(30, 100, 50);
  dirLight.castShadow = true;
  scene.add(dirLight);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.autoRotate = true;
  controls.autoRotateSpeed = 1.0;

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

  const groundMat = new THREE.MeshLambertMaterial({ color: 0x3D4143 });
  const groundMesh = new THREE.Mesh(new THREE.BoxGeometry(40, 4, 40), groundMat);
  groundMesh.position.set(0, -2, 0);
  groundMesh.receiveShadow = true;
  scene.add(groundMesh);
  createStaticBox([40, 4, 40], [0, -2, 0]);
  if (SHOW_DEBUG_COLLIDERS) {
    const dbg = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(40, 4, 40)),
      new THREE.LineBasicMaterial({ color: 0x44ee88 })
    );
    dbg.position.set(0, -2, 0);
    scene.add(dbg);
  }

  const wallMat = new THREE.MeshLambertMaterial({ color: 0x3D4143, transparent: true, opacity: 0.4 });
  const wallDefs = [
    { size: [10, 10,  1], pos: [ 0, 5, -5] },
    { size: [10, 10,  1], pos: [ 0, 5,  5] },
    { size: [ 1, 10, 10], pos: [-5, 5,  0] },
    { size: [ 1, 10, 10], pos: [ 5, 5,  0] },
  ];
  for (const { size, pos } of wallDefs) {
    createStaticBox(size, pos);
    const wallMesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), wallMat);
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
}

function loadMarbles() {
  const loader = new GLTFLoader();
  loader.load(GLTF_URL, (gltf) => {
    const sphereNodes = [];
    gltf.scene.traverse((child) => {
      if (child.isMesh && child.name.includes('Sphere')) {
        sphereNodes.push(child);
      }
    });

    sphereNodes.forEach((mesh) => {
      const worldPos   = new THREE.Vector3();
      const worldQuat  = new THREE.Quaternion();
      const worldScale = new THREE.Vector3();
      mesh.getWorldPosition(worldPos);
      mesh.getWorldQuaternion(worldQuat);
      mesh.getWorldScale(worldScale);

      mesh.geometry.computeBoundingSphere();
      const geomRadius = mesh.geometry.boundingSphere.radius;
      const physicsRadius = Math.max(geomRadius * worldScale.x, 0.1);

      mesh.removeFromParent();
      scene.add(mesh);
      mesh.castShadow = true;
      mesh.scale.copy(worldScale);

      const dropX = (Math.random() - 0.5) * 8;
      const dropY = 15 + Math.random() * 20;
      const dropZ = (Math.random() - 0.5) * 8;
      mesh.position.set(dropX, dropY, dropZ);

      const ssRes = HK.HP_Shape_CreateSphere([0, 0, 0], physicsRadius);
      checkResult(ssRes[0], 'HP_Shape_CreateSphere marble');
      const smRes = HK.HP_Shape_BuildMassProperties(ssRes[1]);
      checkResult(smRes[0], 'HP_Shape_BuildMassProperties marble');
      const sbRes = HK.HP_Body_Create();
      checkResult(sbRes[0], 'HP_Body_Create marble');
      const bodyId = sbRes[1];
      HK.HP_Body_SetShape(bodyId, ssRes[1]);
      HK.HP_Body_SetMotionType(bodyId, HK.MotionType.DYNAMIC);
      HK.HP_Body_SetMassProperties(bodyId, smRes[1]);
      HK.HP_Body_SetPosition(bodyId, [dropX, dropY, dropZ]);
      HK.HP_Body_SetOrientation(bodyId, IDENTITY_QUATERNION);
      HK.HP_World_AddBody(worldId, bodyId, false);

      meshes.push(mesh);
      bodyIds.push(bodyId);
      if (SHOW_DEBUG_COLLIDERS) {
        const dbg = new THREE.LineSegments(
          new THREE.WireframeGeometry(new THREE.SphereGeometry(physicsRadius, 8, 6)),
          new THREE.LineBasicMaterial({ color: 0xff8844 })
        );
        scene.add(dbg);
        debugMeshes.push(dbg);
      }
    });

    setInterval(updatePhysics, 1000 / 60);
    loop();
  });
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
      const x = (Math.random() - 0.5) * 8;
      const y = 15 + Math.random() * 20;
      const z = (Math.random() - 0.5) * 8;
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
  loadMarbles();
}

main().catch(console.error);
