import Rn from 'rhodonite';

const DUCK_URL = 'https://rawcdn.githack.com/cx20/gltf-test/5465cc37/sampleModels/Duck/glTF/Duck.gltf';
const FIXED_TIMESTEP = 1 / 60;
const IDENTITY_QUATERNION = [0, 0, 0, 1];

const cubeSizeX = 16 / 16 * 5;
const cubeSizeY = 16 / 16 * 5;
const cubeSizeZ = 9 / 16 * 5;

let HK, worldId, engine;
let duckBodyId;
let duckExpression, duckRenderPass;
let groundEntity, wireEntity;
let expression;
let started = false;

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

function rotateVec3ByQuat(v, q) {
  const [vx, vy, vz] = v;
  const [qx, qy, qz, qw] = q;
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  return [
    vx + qw * tx + qy * tz - qz * ty,
    vy + qw * ty + qz * tx - qx * tz,
    vz + qw * tz + qx * ty - qy * tx,
  ];
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

  // Duck body
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

const load = async function() {
  HK = await HavokPhysics();

  const canvas = document.getElementById('world');
  engine = await Rn.Engine.init({
    approach: Rn.ProcessApproach.DataTexture,
    canvas,
  });

  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
  function resizeCanvas() {
    engine.resizeCanvas(window.innerWidth, window.innerHeight);
  }

  initPhysics();

  // Ground plane (visual)
  const groundMat = Rn.MaterialHelper.createPbrUberMaterial(engine, { isLighting: true });
  groundMat.setParameter('baseColorFactor', Rn.Vector4.fromCopyArray4([1, 1, 1, 1]));
  groundEntity = Rn.MeshHelper.createCube(engine, { material: groundMat });
  groundEntity.getTransform().localPosition = Rn.Vector3.fromCopyArray([0, -5, 0]);
  groundEntity.getTransform().localScale = Rn.Vector3.fromCopyArray([300, 8, 300]);

  // Wireframe box (visual bounding box indicator)
  const wireMat = Rn.MaterialHelper.createClassicUberMaterial(engine);
  wireMat.setParameter('diffuseColorFactor', Rn.Vector4.fromCopyArray4([0, 1, 0, 1]));
  wireEntity = Rn.MeshHelper.createCube(engine, { material: wireMat });
  wireEntity.getTransform().localScale = Rn.Vector3.fromCopyArray([cubeSizeX * 2, cubeSizeY * 2, cubeSizeZ * 2]);

  // Camera
  const cameraEntity = Rn.createCameraControllerEntity(engine);
  cameraEntity.localPosition = Rn.Vector3.fromCopyArray([20, 20, 30]);
  cameraEntity.localEulerAngles = Rn.Vector3.fromCopyArray([-0.27, 0.59, 0]);
  const cameraComponent = cameraEntity.getCamera();
  cameraComponent.zNear = 1;
  cameraComponent.zFar = 10000;
  cameraComponent.setFovyAndChangeFocalLength(30);
  cameraComponent.aspect = window.innerWidth / window.innerHeight;

  // Light
  const lightEntity = Rn.createLightEntity(engine);
  const lightComponent = lightEntity.getLight();
  lightComponent.type = Rn.LightType.Directional;
  lightComponent.intensity = 2;
  lightEntity.localEulerAngles = Rn.Vector3.fromCopyArray([-Math.PI / 4, -Math.PI / 4, 0]);

  // Base render pass (ground + wire box)
  const renderPass = new Rn.RenderPass(engine);
  renderPass.cameraComponent = cameraComponent;
  renderPass.toClearColorBuffer = true;
  renderPass.clearColor = Rn.Vector4.fromCopyArray4([0, 0, 0, 1]);
  renderPass.addEntities([groundEntity, wireEntity]);

  expression = new Rn.Expression();
  expression.addRenderPasses([renderPass]);

  // Load Duck glTF
  const gltfExpression = await Rn.GltfImporter.importFromUrl(engine, DUCK_URL, {
    defaultMaterialHelperArgumentArray: [{ makeOutputSrgb: false }],
  });

  // Scale duck and adjust position offset
  const duckRenderPassObj = gltfExpression.renderPasses[0];
  duckRenderPassObj.cameraComponent = cameraComponent;
  duckRenderPassObj.toClearColorBuffer = false;

  // Scale duck entities
  duckRenderPassObj.entities.forEach(entity => {
    const sg = entity.getSceneGraph ? entity.getSceneGraph() : null;
    if (sg && !sg.parent) {
      entity.getTransform().localScale = Rn.Vector3.fromCopyArray([5, 5, 5]);
    }
  });

  expression.addRenderPasses([duckRenderPassObj]);

  document.addEventListener('click', () => {
    if (duckBodyId !== undefined) {
      HK.HP_Body_SetLinearVelocity(duckBodyId, [0, 5, 0]);
    }
  });

  setInterval(() => {
    HK.HP_World_Step(worldId, FIXED_TIMESTEP);
    const [, pos] = HK.HP_Body_GetPosition(duckBodyId);
    const [, ori] = HK.HP_Body_GetOrientation(duckBodyId);

    wireEntity.getTransform().localPosition = Rn.Vector3.fromCopyArray([pos[0], pos[1], pos[2]]);
    wireEntity.getTransform().localRotation = Rn.Quaternion.fromCopyArray([ori[0], ori[1], ori[2], ori[3]]);

    duckRenderPassObj.entities.forEach(entity => {
      const sg = entity.getSceneGraph ? entity.getSceneGraph() : null;
      if (sg && !sg.parent) {
        const [ox, oy, oz] = rotateVec3ByQuat([0, -cubeSizeY, 0], ori);
        entity.getTransform().localPosition = Rn.Vector3.fromCopyArray([pos[0] + ox, pos[1] + oy, pos[2] + oz]);
        entity.getTransform().localRotation = Rn.Quaternion.fromCopyArray([ori[0], ori[1], ori[2], ori[3]]);
      }
    });
  }, 1000 / 60);

  const draw = function() {
    engine.process([expression]);
    requestAnimationFrame(draw);
  };
  draw();
};

document.body.onload = load;
