import Rn from 'rhodonite';

const FIXED_TIMESTEP = 1 / 60;
const IDENTITY_QUATERNION = [0, 0, 0, 1];
const PIECE_COUNT = 220;

let HK, worldId, engine;
const entities = [];
const bodyIds = [];

let showWireframe = true;
const debugEntities = [];         // all collider wireframes (for the W toggle)
const pieceDebugEntities = [];    // per-piece wireframes, parallel to bodyIds
const DEBUG_COLOR_DYNAMIC = [1.0, 0.5, 0.2, 1.0];
const DEBUG_COLOR_STATIC = [0.2, 1.0, 0.4, 1.0];

// Mirror the other Rhodonite samples: PbrUber + RN_USE_WIREFRAME, with calcBaryCentricCoord()
// on the mesh so the wireframe shader can draw the edges.
function makeDebugMaterial(color) {
  const mat = Rn.MaterialHelper.createPbrUberMaterial(engine, { isLighting: false, isSkinning: false, isMorphing: false });
  try { mat.addShaderDefine('RN_USE_WIREFRAME'); } catch (e) {}
  try { mat.setParameter('wireframe', Rn.Vector3.fromCopy3(1, 0, 1)); } catch (e) {}
  try { mat.setParameter('baseColorFactor', Rn.Vector4.fromCopyArray4(color)); } catch (e) {}
  return mat;
}

function createDebugBox(size, pos, color) {
  const entity = Rn.MeshHelper.createCube(engine, { material: makeDebugMaterial(color) });
  entity.getTransform().localScale = Rn.Vector3.fromCopyArray([size[0], size[1], size[2]]);
  entity.getTransform().localPosition = Rn.Vector3.fromCopyArray(pos);
  try { entity.getMesh().calcBaryCentricCoord(); } catch (e) {}
  debugEntities.push(entity);
  return entity;
}

// Box wireframe geometry (full size w x h x d, centred on the origin).
function buildBoxGeometry(w, h, d) {
  const x = w / 2, y = h / 2, z = d / 2;
  const positions = new Float32Array([
    -x, -y, -z,  x, -y, -z,  x, y, -z,  -x, y, -z,
    -x, -y,  z,  x, -y,  z,  x, y,  z,  -x, y,  z,
  ]);
  const indices = new Uint16Array([
    0, 1, 2, 0, 2, 3,   4, 6, 5, 4, 7, 6,
    0, 4, 7, 0, 7, 3,   1, 5, 6, 1, 6, 2,
    3, 7, 6, 3, 6, 2,   0, 5, 1, 0, 4, 5,
  ]);
  return { positions, indices };
}

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

function createShogiGeometry(w, h, d) {
  const positions = new Float32Array([
    -0.5*w, -0.5*h,  0.7*d,   0.5*w, -0.5*h,  0.7*d,   0.35*w,  0.5*h,  0.4*d,  -0.35*w,  0.5*h,  0.4*d,
    -0.5*w, -0.5*h, -0.7*d,   0.5*w, -0.5*h, -0.7*d,   0.35*w,  0.5*h, -0.4*d,  -0.35*w,  0.5*h, -0.4*d,
     0.35*w, 0.5*h,  0.4*d,  -0.35*w, 0.5*h,  0.4*d,  -0.35*w,  0.5*h, -0.4*d,   0.35*w,  0.5*h, -0.4*d,
    -0.5*w, -0.5*h,  0.7*d,   0.5*w, -0.5*h,  0.7*d,   0.5*w, -0.5*h, -0.7*d,  -0.5*w, -0.5*h, -0.7*d,
     0.5*w, -0.5*h,  0.7*d,   0.35*w, 0.5*h,  0.4*d,   0.35*w,  0.5*h, -0.4*d,   0.5*w, -0.5*h, -0.7*d,
    -0.5*w, -0.5*h,  0.7*d,  -0.35*w, 0.5*h,  0.4*d,  -0.35*w,  0.5*h, -0.4*d,  -0.5*w, -0.5*h, -0.7*d,
    -0.35*w, 0.5*h,  0.4*d,   0.35*w, 0.5*h,  0.4*d,   0.0*w,   0.6*h,  0.35*d,
    -0.35*w, 0.5*h, -0.4*d,   0.35*w, 0.5*h, -0.4*d,   0.0*w,   0.6*h, -0.35*d,
     0.35*w, 0.5*h,  0.4*d,   0.35*w, 0.5*h, -0.4*d,   0.0*w,   0.6*h, -0.35*d,  0.0*w,  0.6*h,  0.35*d,
    -0.35*w, 0.5*h,  0.4*d,  -0.35*w, 0.5*h, -0.4*d,   0.0*w,   0.6*h, -0.35*d,  0.0*w,  0.6*h,  0.35*d,
  ]);

  const nFY = 0.3, nFZ = 0.9;
  const normals = new Float32Array([
     0, nFY,  nFZ,   0, nFY,  nFZ,   0, nFY,  nFZ,   0, nFY,  nFZ,
     0, nFY, -nFZ,   0, nFY, -nFZ,   0, nFY, -nFZ,   0, nFY, -nFZ,
     0, 1, 0,   0, 1, 0,   0, 1, 0,   0, 1, 0,
     0, -1, 0,  0, -1, 0,  0, -1, 0,  0, -1, 0,
     nFZ, nFY, 0,  nFZ, nFY, 0,  nFZ, nFY, 0,  nFZ, nFY, 0,
    -nFZ, nFY, 0, -nFZ, nFY, 0, -nFZ, nFY, 0, -nFZ, nFY, 0,
     0, 0.5, 0.87,  0, 0.5, 0.87,  0, 0.5, 0.87,
     0, 0.5, -0.87, 0, 0.5, -0.87, 0, 0.5, -0.87,
     0.87, 0.5, 0,  0.87, 0.5, 0,  0.87, 0.5, 0,  0.87, 0.5, 0,
    -0.87, 0.5, 0, -0.87, 0.5, 0, -0.87, 0.5, 0, -0.87, 0.5, 0,
  ]);

  const texcoords = new Float32Array([
    0.5, 0.5,  0.75, 0.5,  0.75-0.25/8, 1.0,  0.5+0.25/8, 1.0,
    0.5, 0.5,  0.25, 0.5,  0.25+0.25/8, 1.0,  0.5-0.25/8, 1.0,
    0.75, 0.5, 0.5, 0.5,  0.5, 0.0,  0.75, 0.0,
    0.0, 0.5,  0.25, 0.5,  0.25, 1.0,  0.0, 1.0,
    0.0, 0.5,  0.0, 0.0,  0.25, 0.0,  0.25, 0.5,
    0.5, 0.5,  0.5, 0.0,  0.25, 0.0,  0.25, 0.5,
    0.75, 0.0, 1.0, 0.0,  1.0, 0.5,
    0.75, 0.0, 1.0, 0.0,  1.0, 0.5,
    0.75, 0.0, 1.0, 0.0,  1.0, 0.5,  0.75, 0.5,
    0.75, 0.0, 1.0, 0.0,  1.0, 0.5,  0.75, 0.5,
  ]);

  const indices = new Uint16Array([
     0,  1,  2,   0,  2,  3,
     4,  6,  5,   4,  7,  6,
     8,  9, 10,   8, 10, 11,
    12, 14, 13,  12, 15, 14,
    16, 18, 17,  16, 19, 18,
    20, 21, 22,  20, 22, 23,
    24, 25, 26,
    27, 29, 28,
    30, 31, 33,  31, 32, 33,
    34, 36, 35,  34, 37, 36,
  ]);

  return { positions, normals, texcoords, indices };
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
  const shogiTex = await Rn.Texture.loadFromUrl(engine, '../../../../assets/textures/shogi_001/shogi.png');

  // Ground
  createStaticBody([40, 4, 40], [0, -2, 0]);
  const groundMat = Rn.MaterialHelper.createPbrUberMaterial(engine, { isLighting: true });
  groundMat.setParameter('baseColorFactor', Rn.Vector4.fromCopyArray4([0.24, 0.25, 0.26, 1]));
  const groundEntity = Rn.MeshHelper.createCube(engine, { material: groundMat });
  groundEntity.getTransform().localPosition = Rn.Vector3.fromCopyArray([0, -2, 0]);
  groundEntity.getTransform().localScale = Rn.Vector3.fromCopyArray([40, 4, 40]);
  entities.push(groundEntity);
  createDebugBox([40, 4, 40], [0, -2, 0], DEBUG_COLOR_STATIC);

  // Walls
  const wallDefs = [
    { size: [10, 10, 1], pos: [0, 5, -5] },
    { size: [10, 10, 1], pos: [0, 5,  5] },
    { size: [1, 10, 10], pos: [-5, 5, 0] },
    { size: [1, 10, 10], pos: [ 5, 5, 0] },
  ];
  const wallMat = Rn.MaterialHelper.createPbrUberMaterial(engine, { isLighting: true });
  wallMat.setParameter('baseColorFactor', Rn.Vector4.fromCopyArray4([0.24, 0.25, 0.26, 0.4]));
  for (const { size, pos } of wallDefs) {
    createStaticBody(size, pos);
    const wallEntity = Rn.MeshHelper.createCube(engine, { material: wallMat });
    wallEntity.getTransform().localPosition = Rn.Vector3.fromCopyArray(pos);
    wallEntity.getTransform().localScale = Rn.Vector3.fromCopyArray(size);
    entities.push(wallEntity);
    createDebugBox(size, pos, DEBUG_COLOR_STATIC);
  }

  const pieceW = 1.6;
  const pieceH = 1.6;
  const pieceD = 0.45;

  // Shared physics shape
  const psRes = HK.HP_Shape_CreateBox([0, 0, 0], IDENTITY_QUATERNION, [pieceW, pieceH, pieceD * 1.4]);
  checkResult(psRes[0], 'HP_Shape_CreateBox shogi');
  const pieceShapeId = psRes[1];
  const pmRes = HK.HP_Shape_BuildMassProperties(pieceShapeId);
  checkResult(pmRes[0], 'HP_Shape_BuildMassProperties shogi');
  const pieceMassProps = pmRes[1];

  // Shared material, primitive, mesh — created ONCE for all pieces
  const sharedMat = Rn.MaterialHelper.createPbrUberMaterial(engine, { isLighting: true });
  sharedMat.setTextureParameter('baseColorTexture', shogiTex, sampler);

  const geo = createShogiGeometry(pieceW, pieceH, pieceD);
  const sharedPrimitive = Rn.Primitive.createPrimitive(engine, {
    indices: geo.indices,
    attributeSemantics: [
      Rn.VertexAttribute.Position.XYZ,
      Rn.VertexAttribute.Normal.XYZ,
      Rn.VertexAttribute.Texcoord0.XY,
    ],
    attributes: [geo.positions, geo.normals, geo.texcoords],
    material: sharedMat,
    primitiveMode: Rn.PrimitiveMode.Triangles,
  });
  const sharedMesh = new Rn.Mesh(engine);
  sharedMesh.addPrimitive(sharedPrimitive);

  // Shared box-shaped collider wireframe (one mesh reused by every piece, like the visual mesh,
  // so the debug pass instances rather than issuing 220 separate draws). The wireframe shader
  // needs un-indexed geometry + barycentric coords (what MeshComponent.calcBaryCentricCoord does).
  const pieceWireGeo = buildBoxGeometry(pieceW, pieceH, pieceD * 1.4);
  const pieceWirePrimitive = Rn.Primitive.createPrimitive(engine, {
    indices: pieceWireGeo.indices,
    attributeSemantics: [Rn.VertexAttribute.Position.XYZ],
    attributes: [pieceWireGeo.positions],
    material: makeDebugMaterial(DEBUG_COLOR_DYNAMIC),
    primitiveMode: Rn.PrimitiveMode.Triangles,
  });
  const pieceWireMesh = new Rn.Mesh(engine);
  pieceWireMesh.addPrimitive(pieceWirePrimitive);
  try {
    for (const prim of pieceWireMesh.primitives) prim.convertToUnindexedGeometry();
    pieceWireMesh._calcBaryCentricCoord();
  } catch (e) { console.warn('[Shogi] baryCentric failed:', e); }

  for (let i = 0; i < PIECE_COUNT; i++) {
    const x = (Math.random() - 0.5) * 8;
    const y = 12 + Math.random() * 26;
    const z = (Math.random() - 0.5) * 8;
    const qx = Math.random() - 0.5;
    const qy = Math.random() - 0.5;
    const qz = Math.random() - 0.5;
    const qw = Math.random() - 0.5;
    const qlen = Math.sqrt(qx*qx + qy*qy + qz*qz + qw*qw);

    const bRes = HK.HP_Body_Create();
    checkResult(bRes[0], 'HP_Body_Create shogi');
    const bodyId = bRes[1];
    HK.HP_Body_SetShape(bodyId, pieceShapeId);
    HK.HP_Body_SetMotionType(bodyId, HK.MotionType.DYNAMIC);
    HK.HP_Body_SetMassProperties(bodyId, pieceMassProps);
    HK.HP_Body_SetPosition(bodyId, [x, y, z]);
    HK.HP_Body_SetOrientation(bodyId, [qx/qlen, qy/qlen, qz/qlen, qw/qlen]);
    HK.HP_World_AddBody(worldId, bodyId, false);
    bodyIds.push(bodyId);

    const entity = Rn.createMeshEntity(engine);
    entity.getMesh().setMesh(sharedMesh);
    entities.push(entity);

    const debugEntity = Rn.createMeshEntity(engine);
    debugEntity.getMesh().setMesh(pieceWireMesh);
    debugEntities.push(debugEntity);
    pieceDebugEntities.push(debugEntity);
  }

  // Camera
  const cameraEntity = Rn.createCameraControllerEntity(engine);
  cameraEntity.localPosition = Rn.Vector3.fromCopyArray([18, 24, 34]);
  cameraEntity.localEulerAngles = Rn.Vector3.fromCopyArray([-0.6, 0.5, 0]);
  const cameraComponent = cameraEntity.getCamera();
  // Larger zNear (and tighter zFar) for better depth-buffer precision; the camera orbits far
  // from the scene, so this avoids z-fighting. (0.01 / 1000 was far too wide a range.)
  cameraComponent.zNear = 1.0;
  cameraComponent.zFar = 200;
  cameraComponent.setFovyAndChangeFocalLength(60);
  cameraComponent.aspect = window.innerWidth / window.innerHeight;

  // Lights
  const lightEntity1 = Rn.createLightEntity(engine);
  const lc1 = lightEntity1.getLight();
  lc1.type = Rn.LightType.Directional;
  lc1.intensity = 2.1;
  lightEntity1.localEulerAngles = Rn.Vector3.fromCopyArray([-Math.PI / 4, Math.PI / 6, 0]);
  const lightEntity2 = Rn.createLightEntity(engine);
  const lc2 = lightEntity2.getLight();
  lc2.type = Rn.LightType.Directional;
  lc2.intensity = 0.9;
  lightEntity2.localEulerAngles = Rn.Vector3.fromCopyArray([Math.PI / 4, -Math.PI / 4, 0]);

  // RenderPass
  const renderPass = new Rn.RenderPass(engine);
  renderPass.cameraComponent = cameraComponent;
  renderPass.toClearColorBuffer = true;
  renderPass.clearColor = Rn.Vector4.fromCopyArray4([0.17, 0.19, 0.22, 1]);
  renderPass.addEntities(entities);

  // Collider wireframes are drawn in a second pass on top of the model (no depth test).
  const debugRenderPass = new Rn.RenderPass(engine);
  debugRenderPass.cameraComponent = cameraComponent;
  debugRenderPass.toClearColorBuffer = false;
  try { debugRenderPass.isDepthTest = false; } catch (e) {}
  debugRenderPass.addEntities(debugEntities);

  const expression = new Rn.Expression();
  expression.addRenderPasses([renderPass, debugRenderPass]);

  setWireframeVisible(showWireframe);

  // 1 ground + 4 walls = 5 static entities before piece entities
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

      const debugEntity = pieceDebugEntities[i];
      debugEntity.getTransform().localPosition = Rn.Vector3.fromCopyArray([pos[0], pos[1], pos[2]]);
      debugEntity.getTransform().localRotation = Rn.Quaternion.fromCopyArray([ori[0], ori[1], ori[2], ori[3]]);

      if (pos[1] < -10) {
        const nx = (Math.random() - 0.5) * 8;
        const ny = 12 + Math.random() * 26;
        const nz = (Math.random() - 0.5) * 8;
        const qx2 = Math.random() - 0.5;
        const qy2 = Math.random() - 0.5;
        const qz2 = Math.random() - 0.5;
        const qw2 = Math.random() - 0.5;
        const ql = Math.sqrt(qx2*qx2 + qy2*qy2 + qz2*qz2 + qw2*qw2);
        HK.HP_Body_SetPosition(bodyIds[i], [nx, ny, nz]);
        HK.HP_Body_SetOrientation(bodyIds[i], [qx2/ql, qy2/ql, qz2/ql, qw2/ql]);
        HK.HP_Body_SetLinearVelocity(bodyIds[i], [0, 0, 0]);
        HK.HP_Body_SetAngularVelocity(bodyIds[i], [0, 0, 0]);
      }
    }

    angle += 0.004;
    cameraEntity.localPosition = Rn.Vector3.fromCopyArray([
      Math.sin(angle) * 40,
      24,
      Math.cos(angle) * 40,
    ]);
    cameraEntity.localEulerAngles = Rn.Vector3.fromCopyArray([-0.6, angle, 0]);

    engine.process([expression]);
    requestAnimationFrame(draw);
  };

  draw();
};

function setWireframeVisible(visible) {
  showWireframe = visible;
  for (const entity of debugEntities) {
    try { entity.getSceneGraph().isVisible = visible; } catch (e) {}
  }
  const hint = document.getElementById('hint');
  if (hint) {
    hint.textContent = 'W: wireframe ' + (visible ? 'ON' : 'OFF');
  }
}

window.addEventListener('keydown', (event) => {
  if (event.repeat) return;
  if (event.code === 'KeyW' || event.key === 'w' || event.key === 'W') {
    setWireframeVisible(!showWireframe);
  }
});

document.body.onload = load;
