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
const BOX_SIZE = 2;
const DOMINO_W = BOX_SIZE * 0.15;
const DOMINO_H = BOX_SIZE * 1.5;
const DOMINO_D = BOX_SIZE * 1.0;
const BALL_RADIUS = BOX_SIZE / 2;

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

function createStaticBody(shapeSize, position) {
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

  const grassTex = await Rn.Texture.loadFromUrl(engine, '../../../../assets/textures/grass.jpg');
  const sampler = new Rn.Sampler(engine, {
    magFilter: Rn.TextureParameter.Linear,
    minFilter: Rn.TextureParameter.Linear,
    wrapS: Rn.TextureParameter.Repeat,
    wrapT: Rn.TextureParameter.Repeat,
  });

  // Ground
  createStaticBody([100, 0.2, 100], [0, 0, 0]);
  const groundMat = Rn.MaterialHelper.createPbrUberMaterial(engine, { isLighting: true });
  groundMat.setTextureParameter('baseColorTexture', grassTex, sampler);
  const groundEntity = Rn.MeshHelper.createCube(engine, { material: groundMat });
  groundEntity.getTransform().localPosition = Rn.Vector3.fromCopyArray([0, 0, 0]);
  groundEntity.getTransform().localScale = Rn.Vector3.fromCopyArray([100, 0.2, 100]);
  entities.push(groundEntity);

  // Shared domino physics shape
  const dsRes = HK.HP_Shape_CreateBox([0, 0, 0], IDENTITY_QUATERNION, [DOMINO_W, DOMINO_H, DOMINO_D]);
  checkResult(dsRes[0], 'HP_Shape_CreateBox domino');
  const dominoShapeId = dsRes[1];
  const dmRes = HK.HP_Shape_BuildMassProperties(dominoShapeId);
  checkResult(dmRes[0], 'HP_Shape_BuildMassProperties domino');
  const dominoMassProps = dmRes[1];

  // Shared ball physics shape
  const bsRes = HK.HP_Shape_CreateSphere([0, 0, 0], BALL_RADIUS);
  checkResult(bsRes[0], 'HP_Shape_CreateSphere ball');
  const ballShapeId = bsRes[1];
  const bmRes = HK.HP_Shape_BuildMassProperties(ballShapeId);
  checkResult(bmRes[0], 'HP_Shape_BuildMassProperties ball');
  const ballMassProps = bmRes[1];

  const footballTex = await Rn.Texture.loadFromUrl(engine, '../../../../assets/textures/football.png');

  // Pre-build one cube mesh per unique color key
  const cubeMeshByKey = {};
  for (const [key, color] of Object.entries(colorHash)) {
    const mat = Rn.MaterialHelper.createPbrUberMaterial(engine, { isLighting: true });
    mat.setParameter('baseColorFactor', Rn.Vector4.fromCopyArray4([color[0], color[1], color[2], 1]));
    const helper = Rn.MeshHelper.createCube(engine, { material: mat });
    cubeMeshByKey[key] = helper.getMesh().mesh;
  }

  // Pre-build shared sphere mesh for balls
  const ballMat = Rn.MaterialHelper.createPbrUberMaterial(engine, { isLighting: true });
  ballMat.setTextureParameter('baseColorTexture', footballTex, sampler);
  const ballHelper = Rn.MeshHelper.createSphere(engine, {
    radius: BALL_RADIUS,
    widthSegments: 16,
    heightSegments: 16,
    material: ballMat,
  });
  const sharedBallMesh = ballHelper.getMesh().mesh;

  // 16x16 dominos
  for (let row = 0; row < 16; row++) {
    for (let col = 0; col < 16; col++) {
      const colorKey = dataSet[row * 16 + col];
      const x1 = -8 * BOX_SIZE + col * BOX_SIZE;
      const y1 = BOX_SIZE;
      const z1 = -8 * BOX_SIZE + row * BOX_SIZE * 1.2;

      const bRes = HK.HP_Body_Create();
      checkResult(bRes[0], 'HP_Body_Create domino');
      const bodyId = bRes[1];
      HK.HP_Body_SetShape(bodyId, dominoShapeId);
      HK.HP_Body_SetMotionType(bodyId, HK.MotionType.DYNAMIC);
      HK.HP_Body_SetMassProperties(bodyId, dominoMassProps);
      HK.HP_Body_SetPosition(bodyId, [x1, y1, z1]);
      HK.HP_Body_SetOrientation(bodyId, IDENTITY_QUATERNION);
      HK.HP_World_AddBody(worldId, bodyId, false);
      bodyIds.push(bodyId);

      const entity = Rn.createMeshEntity(engine);
      entity.getMesh().setMesh(cubeMeshByKey[colorKey]);
      entity.getTransform().localScale = Rn.Vector3.fromCopyArray([DOMINO_W, DOMINO_H, DOMINO_D]);
      entities.push(entity);
    }
  }

  // 16 balls
  for (let i = 0; i < 16; i++) {
    const x1 = -8 * BOX_SIZE - 0.5;
    const y1 = 8;
    const z1 = -8 * BOX_SIZE + (15 - i) * BOX_SIZE * 1.2;

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
    entity.getMesh().setMesh(sharedBallMesh);
    entities.push(entity);
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

  // Physics entities start at index 1 (after ground)
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
