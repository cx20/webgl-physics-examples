import Rn from 'rhodonite';

const GLTF_URL = 'https://cx20.github.io/gltf-test/tutorialModels/IridescenceMetallicSpheres/glTF/IridescenceMetallicSpheres.gltf';
const FIXED_TIMESTEP = 1 / 60;
const IDENTITY_QUATERNION = [0, 0, 0, 1];

let HK, worldId, engine;
const entities = [];
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

function createStaticBody(size, pos) {
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

  const worldRes = HK.HP_World_Create();
  checkResult(worldRes[0], 'HP_World_Create');
  worldId = worldRes[1];
  checkResult(HK.HP_World_SetGravity(worldId, [0, -10, 0]), 'HP_World_SetGravity');
  checkResult(HK.HP_World_SetIdealStepTime(worldId, FIXED_TIMESTEP), 'HP_World_SetIdealStepTime');

  // Ground
  createStaticBody([40, 4, 40], [0, -2, 0]);
  const groundMat = Rn.MaterialHelper.createPbrUberMaterial(engine, { isLighting: true });
  groundMat.setParameter('baseColorFactor', Rn.Vector4.fromCopyArray4([0.24, 0.25, 0.26, 1]));
  const groundEntity = Rn.MeshHelper.createCube(engine, { material: groundMat });
  groundEntity.getTransform().localPosition = Rn.Vector3.fromCopyArray([0, -2, 0]);
  groundEntity.getTransform().localScale = Rn.Vector3.fromCopyArray([40, 4, 40]);
  entities.push(groundEntity);

  // Walls
  const wallDefs = [
    { size: [10, 10, 1], pos: [0, 5, -5] },
    { size: [10, 10, 1], pos: [0, 5,  5] },
    { size: [1, 10, 10], pos: [-5, 5, 0] },
    { size: [1, 10, 10], pos: [ 5, 5, 0] },
  ];
  for (const { size, pos } of wallDefs) {
    createStaticBody(size, pos);
    const wallMat = Rn.MaterialHelper.createPbrUberMaterial(engine, { isLighting: true });
    wallMat.setParameter('baseColorFactor', Rn.Vector4.fromCopyArray4([0.24, 0.25, 0.26, 0.4]));
    const wallEntity = Rn.MeshHelper.createCube(engine, { material: wallMat });
    wallEntity.getTransform().localPosition = Rn.Vector3.fromCopyArray(pos);
    wallEntity.getTransform().localScale = Rn.Vector3.fromCopyArray(size);
    entities.push(wallEntity);
  }

  // Camera
  const cameraEntity = Rn.createCameraControllerEntity(engine);
  cameraEntity.localPosition = Rn.Vector3.fromCopyArray([18, 20, 30]);
  cameraEntity.localEulerAngles = Rn.Vector3.fromCopyArray([-0.55, 0.52, 0]);
  const cameraComponent = cameraEntity.getCamera();
  cameraComponent.zNear = 0.01;
  cameraComponent.zFar = 1000;
  cameraComponent.setFovyAndChangeFocalLength(60);
  cameraComponent.aspect = window.innerWidth / window.innerHeight;

  // Lights
  const lightEntity1 = Rn.createLightEntity(engine);
  const lc1 = lightEntity1.getLight();
  lc1.type = Rn.LightType.Directional;
  lc1.intensity = 3;
  lightEntity1.localEulerAngles = Rn.Vector3.fromCopyArray([-Math.PI / 4, Math.PI / 6, 0]);
  const lightEntity2 = Rn.createLightEntity(engine);
  const lc2 = lightEntity2.getLight();
  lc2.type = Rn.LightType.Directional;
  lc2.intensity = 1;
  lightEntity2.localEulerAngles = Rn.Vector3.fromCopyArray([Math.PI / 4, -Math.PI / 4, 0]);

  // RenderPass for static geometry
  const renderPass = new Rn.RenderPass(engine);
  renderPass.cameraComponent = cameraComponent;
  renderPass.toClearColorBuffer = true;
  renderPass.clearColor = Rn.Vector4.fromCopyArray4([0.13, 0.13, 0.13, 1]);
  renderPass.addEntities(entities);

  const expression = new Rn.Expression();
  expression.addRenderPasses([renderPass]);

  // Load gltf
  const gltfExpression = await Rn.GltfImporter.importFromUrl(engine, GLTF_URL, {
    defaultMaterialHelperArgumentArray: [{ makeOutputSrgb: false }],
  });

  const gltfRenderPass = gltfExpression.renderPasses[0];
  gltfRenderPass.cameraComponent = cameraComponent;
  gltfRenderPass.toClearColorBuffer = false;

  const sphereEntities = [];
  const physicsRadius = 0.5;

  gltfRenderPass.entities.forEach(entity => {
    const name = entity.uniqueName || '';
    if (name.includes('Plane')) {
      const sg = entity.getSceneGraph ? entity.getSceneGraph() : null;
      if (sg) sg.isVisible = false;
    } else if (name.includes('Sphere')) {
      const dropX = (Math.random() - 0.5) * 8;
      const dropY = 15 + Math.random() * 20;
      const dropZ = (Math.random() - 0.5) * 8;

      entity.getTransform().localPosition = Rn.Vector3.fromCopyArray([dropX, dropY, dropZ]);

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

      bodyIds.push(bodyId);
      sphereEntities.push(entity);
    }
  });

  expression.addRenderPasses([gltfRenderPass]);

  setInterval(() => {
    HK.HP_World_Step(worldId, FIXED_TIMESTEP);
    for (let i = 0; i < bodyIds.length; i++) {
      const [, pos] = HK.HP_Body_GetPosition(bodyIds[i]);
      const [, ori] = HK.HP_Body_GetOrientation(bodyIds[i]);
      sphereEntities[i].getTransform().localPosition = Rn.Vector3.fromCopyArray([pos[0], pos[1], pos[2]]);
      sphereEntities[i].getTransform().localRotation = Rn.Quaternion.fromCopyArray([ori[0], ori[1], ori[2], ori[3]]);

      if (pos[1] < -10) {
        const x = (Math.random() - 0.5) * 8;
        const y = 15 + Math.random() * 20;
        const z = (Math.random() - 0.5) * 8;
        HK.HP_Body_SetPosition(bodyIds[i], [x, y, z]);
        HK.HP_Body_SetLinearVelocity(bodyIds[i], [0, 0, 0]);
        HK.HP_Body_SetAngularVelocity(bodyIds[i], [0, 0, 0]);
      }
    }
  }, 1000 / 60);

  let angle = 0;
  const draw = function() {
    angle += 0.005;
    cameraEntity.localPosition = Rn.Vector3.fromCopyArray([
      Math.sin(angle) * 34,
      20,
      Math.cos(angle) * 34,
    ]);
    cameraEntity.localEulerAngles = Rn.Vector3.fromCopyArray([-0.55, angle, 0]);

    engine.process([expression]);
    requestAnimationFrame(draw);
  };
  draw();
};

document.body.onload = load;
