import Rn from 'rhodonite';

const FIXED_TIMESTEP = 1 / 60;
const IDENTITY_QUATERNION = [0, 0, 0, 1];
const CONE_COUNT = 200;
const CONE_HALF_HEIGHT = 2;
const CONE_RADIUS = 1;

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

function buildConeHullPoints(halfHeight, radius, segments = 16) {
  const pts = [];
  pts.push(0, halfHeight, 0);
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    pts.push(radius * Math.cos(a), -halfHeight, radius * Math.sin(a));
  }
  return new Float32Array(pts);
}

function createConeShape() {
  if (typeof HK.HP_Shape_CreateConvexHull === 'function') {
    const pts = buildConeHullPoints(CONE_HALF_HEIGHT, CONE_RADIUS);
    const nPoints = pts.length / 3;
    let shapeId = null;

    if (typeof HK._malloc === 'function' && HK.HEAPU8) {
      const ptr = HK._malloc(pts.byteLength);
      new Float32Array(HK.HEAPU8.buffer, ptr, pts.length).set(pts);
      const res = HK.HP_Shape_CreateConvexHull(ptr, nPoints);
      HK._free(ptr);
      const rc = enumToNumber(res[0]);
      const ok = enumToNumber(HK.Result.RESULT_OK);
      if (rc === ok && res[1]) shapeId = res[1];
    }

    if (!shapeId) {
      const res = HK.HP_Shape_CreateConvexHull(pts, nPoints);
      const rc = enumToNumber(res[0]);
      const ok = enumToNumber(HK.Result.RESULT_OK);
      if (rc === ok && res[1]) shapeId = res[1];
    }

    if (shapeId) return shapeId;
  }
  if (typeof HK.HP_Shape_CreateCylinder === 'function') {
    const res = HK.HP_Shape_CreateCylinder(
      [0, -CONE_HALF_HEIGHT, 0], [0, CONE_HALF_HEIGHT, 0], CONE_RADIUS
    );
    checkResult(res[0], 'HP_Shape_CreateCylinder cone fallback');
    return res[1];
  }
  const res = HK.HP_Shape_CreateBox([0, 0, 0], IDENTITY_QUATERNION,
    [CONE_RADIUS * 2, CONE_HALF_HEIGHT * 2, CONE_RADIUS * 2]);
  checkResult(res[0], 'HP_Shape_CreateBox cone fallback');
  return res[1];
}

function buildConeGeometry(halfHeight, radius, segments = 20) {
  const posArr = [];
  const normArr = [];
  const uvArr = [];
  const idxArr = [];

  // Tip vertex
  posArr.push(0, halfHeight, 0);
  normArr.push(0, 1, 0);
  uvArr.push(0.5, 0);

  // Base rim vertices
  const slopeLen = Math.sqrt(radius * radius + (2 * halfHeight) * (2 * halfHeight));
  const ny = radius / slopeLen;
  const nr = (2 * halfHeight) / slopeLen;

  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const cx = Math.cos(a);
    const cz = Math.sin(a);
    posArr.push(radius * cx, -halfHeight, radius * cz);
    normArr.push(nr * cx, ny, nr * cz);
    uvArr.push(i / segments, 1);
  }

  // Side triangles
  for (let i = 0; i < segments; i++) {
    idxArr.push(0, i + 1, i + 2);
  }

  // Base cap center
  const capCenter = posArr.length / 3;
  posArr.push(0, -halfHeight, 0);
  normArr.push(0, -1, 0);
  uvArr.push(0.5, 0.5);

  // Base cap rim
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    posArr.push(radius * Math.cos(a), -halfHeight, radius * Math.sin(a));
    normArr.push(0, -1, 0);
    uvArr.push(0.5 + 0.5 * Math.cos(a), 0.5 + 0.5 * Math.sin(a));
  }

  for (let i = 0; i < segments; i++) {
    idxArr.push(capCenter, capCenter + i + 2, capCenter + i + 1);
  }

  return {
    positions: new Float32Array(posArr),
    normals: new Float32Array(normArr),
    texcoords: new Float32Array(uvArr),
    indices: new Uint16Array(idxArr),
  };
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
  checkResult(HK.HP_World_SetGravity(worldId, [0, -9.8, 0]), 'HP_World_SetGravity');
  checkResult(HK.HP_World_SetIdealStepTime(worldId, FIXED_TIMESTEP), 'HP_World_SetIdealStepTime');

  const sampler = new Rn.Sampler(engine, {
    magFilter: Rn.TextureParameter.Linear,
    minFilter: Rn.TextureParameter.Linear,
    wrapS: Rn.TextureParameter.ClampToEdge,
    wrapT: Rn.TextureParameter.ClampToEdge,
  });
  const carrotTex = await Rn.Texture.loadFromUrl(engine, '../../../../assets/textures/carrot.jpg');

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

  // Cone physics shape
  const coneShapeId = createConeShape();
  const cmRes = HK.HP_Shape_BuildMassProperties(coneShapeId);
  checkResult(cmRes[0], 'HP_Shape_BuildMassProperties cone');
  const coneMassProps = cmRes[1];

  // Cone geometry
  const coneGeo = buildConeGeometry(CONE_HALF_HEIGHT, CONE_RADIUS, 20);

  for (let i = 0; i < CONE_COUNT; i++) {
    const x = -3.5 + Math.random() * 7;
    const y = 20 + Math.random() * 10;
    const z = -3.5 + Math.random() * 7;

    const bRes = HK.HP_Body_Create();
    checkResult(bRes[0], 'HP_Body_Create cone');
    const bodyId = bRes[1];
    HK.HP_Body_SetShape(bodyId, coneShapeId);
    HK.HP_Body_SetMotionType(bodyId, HK.MotionType.DYNAMIC);
    HK.HP_Body_SetMassProperties(bodyId, coneMassProps);
    HK.HP_Body_SetPosition(bodyId, [x, y, z]);
    HK.HP_Body_SetOrientation(bodyId, IDENTITY_QUATERNION);
    HK.HP_World_AddBody(worldId, bodyId, false);
    bodyIds.push(bodyId);

    const mat = Rn.MaterialHelper.createPbrUberMaterial(engine, { isLighting: true });
    mat.setTextureParameter('baseColorTexture', carrotTex, sampler);

    const primitive = Rn.Primitive.createPrimitive(engine, {
      indices: coneGeo.indices,
      attributeSemantics: [
        Rn.VertexAttribute.Position.XYZ,
        Rn.VertexAttribute.Normal.XYZ,
        Rn.VertexAttribute.Texcoord0.XY,
      ],
      attributes: [coneGeo.positions, coneGeo.normals, coneGeo.texcoords],
      material: mat,
      primitiveMode: Rn.PrimitiveMode.Triangles,
    });

    const mesh = new Rn.Mesh(engine);
    mesh.addPrimitive(primitive);
    const entity = Rn.createMeshEntity(engine);
    entity.getMesh().setMesh(mesh);
    entities.push(entity);
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
  lc1.intensity = 1;
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

  // 1 ground + 4 walls = 5 static entities before cone entities
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
        const ny = 20 + Math.random() * 10;
        const nz = -5 + Math.random() * 10;
        HK.HP_Body_SetPosition(bodyIds[i], [nx, ny, nz]);
        HK.HP_Body_SetLinearVelocity(bodyIds[i], [0, 0, 0]);
        HK.HP_Body_SetAngularVelocity(bodyIds[i], [0, 0, 0]);
      }
    }

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
