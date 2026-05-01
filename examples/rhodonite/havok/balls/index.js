import Rn from 'rhodonite';

const FIXED_TIMESTEP = 1 / 60;
const IDENTITY_QUATERNION = [0, 0, 0, 1];

const dataSet = [
    { imageFile: '../../../../assets/textures/Basketball.jpg', scale: 1.0, restitution: 0.6 },
    { imageFile: '../../../../assets/textures/BeachBall.jpg',  scale: 0.9, restitution: 0.7 },
    { imageFile: '../../../../assets/textures/Football.jpg',   scale: 1.0, restitution: 0.55 },
    { imageFile: '../../../../assets/textures/Softball.jpg',   scale: 0.3, restitution: 0.4 },
    { imageFile: '../../../../assets/textures/TennisBall.jpg', scale: 0.3, restitution: 0.75 },
];

let HK, worldId, engine;
const entities = [];
const bodyIds = [];
const ballScales = [];

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

  const sampler = new Rn.Sampler(engine, {
    magFilter: Rn.TextureParameter.Linear,
    minFilter: Rn.TextureParameter.Linear,
    wrapS: Rn.TextureParameter.ClampToEdge,
    wrapT: Rn.TextureParameter.ClampToEdge,
  });

  // Load ball textures
  const textures = await Promise.all(
    dataSet.map(d => Rn.Texture.loadFromUrl(engine, d.imageFile))
  );

  // Ground
  createStaticBody([20, 2, 20], [0, -2, 0]);
  const groundMat = Rn.MaterialHelper.createPbrUberMaterial(engine, { isLighting: true });
  groundMat.setParameter('baseColorFactor', Rn.Vector4.fromCopyArray4([0.24, 0.25, 0.26, 1]));
  const groundEntity = Rn.MeshHelper.createCube(engine, { material: groundMat });
  groundEntity.getTransform().localPosition = Rn.Vector3.fromCopyArray([0, -2, 0]);
  groundEntity.getTransform().localScale = Rn.Vector3.fromCopyArray([20, 2, 20]);
  entities.push(groundEntity);

  // Walls (shared material)
  const wallMat = Rn.MaterialHelper.createPbrUberMaterial(engine, { isLighting: true });
  wallMat.setParameter('baseColorFactor', Rn.Vector4.fromCopyArray4([0.24, 0.25, 0.26, 0.4]));
  const wallDefs = [
    { size: [5, 5, 0.5], pos: [0, 1.5, -2.5] },
    { size: [5, 5, 0.5], pos: [0, 1.5,  2.5] },
    { size: [0.5, 5, 5], pos: [-2.5, 1.5, 0] },
    { size: [0.5, 5, 5], pos: [ 2.5, 1.5, 0] },
  ];
  for (const { size, pos } of wallDefs) {
    createStaticBody(size, pos);
    const wallEntity = Rn.MeshHelper.createCube(engine, { material: wallMat });
    wallEntity.getTransform().localPosition = Rn.Vector3.fromCopyArray(pos);
    wallEntity.getTransform().localScale = Rn.Vector3.fromCopyArray(size);
    entities.push(wallEntity);
  }

  // Pre-build 5 type-specific physics shapes and sphere meshes
  const typeData = dataSet.map((d, idx) => {
    const radius = d.scale * 0.5;
    const sRes = HK.HP_Shape_CreateSphere([0, 0, 0], radius);
    checkResult(sRes[0], 'HP_Shape_CreateSphere type ' + idx);
    if (typeof HK.HP_Shape_SetMaterial === 'function') {
      HK.HP_Shape_SetMaterial(sRes[1], [0.5, 0.5, d.restitution, HK.MaterialCombine.MAXIMUM, HK.MaterialCombine.MAXIMUM]);
    }
    const smRes = HK.HP_Shape_BuildMassProperties(sRes[1]);
    checkResult(smRes[0], 'HP_Shape_BuildMassProperties type ' + idx);

    const mat = Rn.MaterialHelper.createPbrUberMaterial(engine, { isLighting: true });
    mat.setTextureParameter('baseColorTexture', textures[idx], sampler);
    const helper = Rn.MeshHelper.createSphere(engine, {
      radius: 0.5,
      widthSegments: 20,
      heightSegments: 10,
      material: mat,
    });

    return { shapeId: sRes[1], massProps: smRes[1], mesh: helper.getMesh().mesh, scale: d.scale };
  });

  // Balls
  for (let i = 0; i < 200; i++) {
    const x = -5 + Math.random() * 10;
    const y = 6 + Math.random() * 13;
    const z = -5 + Math.random() * 10;
    const typeIdx = Math.floor(Math.random() * dataSet.length);
    const td = typeData[typeIdx];

    const sbRes = HK.HP_Body_Create();
    checkResult(sbRes[0], 'HP_Body_Create ball');
    const bodyId = sbRes[1];
    HK.HP_Body_SetShape(bodyId, td.shapeId);
    HK.HP_Body_SetMotionType(bodyId, HK.MotionType.DYNAMIC);
    HK.HP_Body_SetMassProperties(bodyId, td.massProps);
    HK.HP_Body_SetPosition(bodyId, [x, y, z]);
    HK.HP_Body_SetOrientation(bodyId, IDENTITY_QUATERNION);
    HK.HP_World_AddBody(worldId, bodyId, false);
    bodyIds.push(bodyId);
    ballScales.push(td.scale);

    const entity = Rn.createMeshEntity(engine);
    entity.getMesh().setMesh(td.mesh);
    entity.getTransform().localScale = Rn.Vector3.fromCopyArray([td.scale, td.scale, td.scale]);
    entities.push(entity);
  }

  // Camera
  const cameraEntity = Rn.createCameraControllerEntity(engine);
  cameraEntity.localPosition = Rn.Vector3.fromCopyArray([10, 10, 16]);
  cameraEntity.localEulerAngles = Rn.Vector3.fromCopyArray([-0.5, 0.55, 0]);
  const cameraComponent = cameraEntity.getCamera();
  cameraComponent.zNear = 0.01;
  cameraComponent.zFar = 300;
  cameraComponent.setFovyAndChangeFocalLength(60);
  cameraComponent.aspect = window.innerWidth / window.innerHeight;

  // Lights
  const lightEntity1 = Rn.createLightEntity(engine);
  const lc1 = lightEntity1.getLight();
  lc1.type = Rn.LightType.Directional;
  lc1.intensity = 1.5;
  lightEntity1.localEulerAngles = Rn.Vector3.fromCopyArray([-Math.PI / 4, Math.PI / 6, 0]);
  const lightEntity2 = Rn.createLightEntity(engine);
  const lc2 = lightEntity2.getLight();
  lc2.type = Rn.LightType.Directional;
  lc2.intensity = 0.5;
  lightEntity2.localEulerAngles = Rn.Vector3.fromCopyArray([Math.PI / 4, -Math.PI / 4, 0]);

  // RenderPass
  const renderPass = new Rn.RenderPass(engine);
  renderPass.cameraComponent = cameraComponent;
  renderPass.toClearColorBuffer = true;
  renderPass.clearColor = Rn.Vector4.fromCopyArray4([0.24, 0.25, 0.26, 1]);
  renderPass.addEntities(entities);

  const expression = new Rn.Expression();
  expression.addRenderPasses([renderPass]);

  // 1 ground + 4 walls = 5 static entities before ball entities
  const physicsEntityOffset = 5;

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
        const ny = 10 + Math.random() * 8;
        const nz = -5 + Math.random() * 10;
        HK.HP_Body_SetPosition(bodyIds[i], [nx, ny, nz]);
        HK.HP_Body_SetLinearVelocity(bodyIds[i], [0, 0, 0]);
        HK.HP_Body_SetAngularVelocity(bodyIds[i], [0, 0, 0]);
      }
    }

    angle += 0.005;
    cameraEntity.localPosition = Rn.Vector3.fromCopyArray([
      Math.sin(angle) * 18,
      10,
      Math.cos(angle) * 18,
    ]);
    cameraEntity.localEulerAngles = Rn.Vector3.fromCopyArray([-0.5, angle, 0]);

    engine.process([expression]);
    requestAnimationFrame(draw);
  };

  draw();
};

document.body.onload = load;
