import Rn from 'rhodonite';

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
    "無": [0xDC/255, 0xAA/255, 0x6B/255],
    "白": [1, 1, 1],
    "肌": [1, 0xCC/255, 0xCC/255],
    "茶": [0x80/255, 0, 0],
    "赤": [1, 0, 0],
    "黄": [1, 1, 0],
    "緑": [0, 1, 0],
    "水": [0, 1, 1],
    "青": [0, 0, 1],
    "紫": [0x80/255, 0, 0x80/255]
};

const FIXED_TIMESTEP = 1 / 60;
const IDENTITY_QUATERNION = [0, 0, 0, 1];
const BALL_SIZE = 1;

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

  const sampler = new Rn.Sampler(engine, {
    magFilter: Rn.TextureParameter.Linear,
    minFilter: Rn.TextureParameter.Linear,
    wrapS: Rn.TextureParameter.Repeat,
    wrapT: Rn.TextureParameter.Repeat,
  });
  const grassTex = await Rn.Texture.loadFromUrl(engine, '../../../../assets/textures/grass.jpg');
  const footballTex = await Rn.Texture.loadFromUrl(engine, '../../../../assets/textures/football.png');

  // Ground
  const gsRes = HK.HP_Shape_CreateBox([0, 0, 0], IDENTITY_QUATERNION, [20, 0.4, 20]);
  checkResult(gsRes[0], 'HP_Shape_CreateBox ground');
  const gbRes = HK.HP_Body_Create();
  checkResult(gbRes[0], 'HP_Body_Create ground');
  const groundId = gbRes[1];
  HK.HP_Body_SetShape(groundId, gsRes[1]);
  HK.HP_Body_SetMotionType(groundId, HK.MotionType.STATIC);
  HK.HP_Body_SetPosition(groundId, [0, 0, 0]);
  HK.HP_Body_SetOrientation(groundId, IDENTITY_QUATERNION);
  HK.HP_World_AddBody(worldId, groundId, false);

  const groundMat = Rn.MaterialHelper.createPbrUberMaterial(engine, { isLighting: true });
  groundMat.setTextureParameter('baseColorTexture', grassTex, sampler);
  const groundEntity = Rn.MeshHelper.createCube(engine, { material: groundMat });
  groundEntity.getTransform().localPosition = Rn.Vector3.fromCopyArray([0, 0, 0]);
  groundEntity.getTransform().localScale = Rn.Vector3.fromCopyArray([20, 0.4, 20]);
  entities.push(groundEntity);

  // Shared ball physics shape
  const radius = BALL_SIZE / 2;
  const bsRes = HK.HP_Shape_CreateSphere([0, 0, 0], radius);
  checkResult(bsRes[0], 'HP_Shape_CreateSphere ball');
  const ballShapeId = bsRes[1];
  const bmRes = HK.HP_Shape_BuildMassProperties(ballShapeId);
  checkResult(bmRes[0], 'HP_Shape_BuildMassProperties ball');
  const ballMassProps = bmRes[1];

  // Pre-build one sphere mesh per unique color key (all share the football texture)
  const sphereMeshByKey = {};
  for (const [key, color] of Object.entries(colorHash)) {
    const mat = Rn.MaterialHelper.createPbrUberMaterial(engine, { isLighting: true });
    mat.setParameter('baseColorFactor', Rn.Vector4.fromCopyArray4([color[0], color[1], color[2], 1]));
    mat.setTextureParameter('baseColorTexture', footballTex, sampler);
    const helper = Rn.MeshHelper.createSphere(engine, {
      radius,
      widthSegments: 16,
      heightSegments: 16,
      material: mat,
    });
    sphereMeshByKey[key] = helper.getMesh().mesh;
  }

  for (let x = 0; x < 16; x++) {
    for (let y = 0; y < 16; y++) {
      const colorKey = dataSet[y * 16 + x];
      const x1 = -10 + x * BALL_SIZE * 1.5 + Math.random() * 0.1;
      const y1 = (15 - y) * BALL_SIZE * 1.2 + 2 + Math.random() * 0.1;
      const z1 = Math.random() * 0.1;

      const bRes = HK.HP_Body_Create();
      checkResult(bRes[0], 'HP_Body_Create ball');
      const bodyId = bRes[1];
      HK.HP_Body_SetShape(bodyId, ballShapeId);
      HK.HP_Body_SetMotionType(bodyId, HK.MotionType.DYNAMIC);
      HK.HP_Body_SetMassProperties(bodyId, ballMassProps);
      HK.HP_Body_SetPosition(bodyId, [x1, y1, z1]);
      HK.HP_Body_SetOrientation(bodyId, IDENTITY_QUATERNION);
      HK.HP_World_AddBody(worldId, bodyId, false);
      bodyIds.push(bodyId);

      const entity = Rn.createMeshEntity(engine);
      entity.getMesh().setMesh(sphereMeshByKey[colorKey]);
      entities.push(entity);
    }
  }

  // Camera
  const cameraEntity = Rn.createCameraControllerEntity(engine);
  cameraEntity.localPosition = Rn.Vector3.fromCopyArray([8, 10, 24]);
  cameraEntity.localEulerAngles = Rn.Vector3.fromCopyArray([-0.35, 0.3, 0]);
  const cameraComponent = cameraEntity.getCamera();
  cameraComponent.zNear = 0.1;
  cameraComponent.zFar = 300;
  cameraComponent.setFovyAndChangeFocalLength(45);
  cameraComponent.aspect = window.innerWidth / window.innerHeight;

  // Light
  const lightEntity = Rn.createLightEntity(engine);
  const lightComponent = lightEntity.getLight();
  lightComponent.type = Rn.LightType.Directional;
  lightComponent.intensity = 1.5;
  lightEntity.localEulerAngles = Rn.Vector3.fromCopyArray([-Math.PI / 4, Math.PI / 6, 0]);

  // RenderPass
  const renderPass = new Rn.RenderPass(engine);
  renderPass.cameraComponent = cameraComponent;
  renderPass.toClearColorBuffer = true;
  renderPass.clearColor = Rn.Vector4.fromCopyArray4([0.1, 0.1, 0.15, 1]);
  renderPass.addEntities(entities);

  const expression = new Rn.Expression();
  expression.addRenderPasses([renderPass]);

  const physicsEntityOffset = 1;

  let angle = 0;
  const draw = function() {
    HK.HP_World_Step(worldId, FIXED_TIMESTEP);

    for (let i = 0; i < bodyIds.length; i++) {
      const [, pos] = HK.HP_Body_GetPosition(bodyIds[i]);
      const [, ori] = HK.HP_Body_GetOrientation(bodyIds[i]);
      const entity = entities[physicsEntityOffset + i];
      entity.getTransform().localPosition = Rn.Vector3.fromCopyArray([pos[0], pos[1], pos[2]]);
      entity.getTransform().localRotation = Rn.Quaternion.fromCopyArray([ori[0], ori[1], ori[2], ori[3]]);

      if (pos[1] < -10) {
        const nx = -5 + Math.random() * 10;
        const ny = 20 + Math.random() * 10;
        const nz = -5 + Math.random() * 10;
        HK.HP_Body_SetPosition(bodyIds[i], [nx, ny, nz]);
        HK.HP_Body_SetLinearVelocity(bodyIds[i], [0, 0, 0]);
        HK.HP_Body_SetAngularVelocity(bodyIds[i], [0, 0, 0]);
      }
    }

    angle += 0.005;
    cameraEntity.localPosition = Rn.Vector3.fromCopyArray([
      Math.sin(angle) * 28,
      10,
      Math.cos(angle) * 28,
    ]);
    cameraEntity.localEulerAngles = Rn.Vector3.fromCopyArray([-0.35, angle, 0]);

    engine.process([expression]);
    requestAnimationFrame(draw);
  };

  draw();
};

document.body.onload = load;
