import Rn from 'rhodonite';

// Rhodonite (rendering) + Havok low-level API (physics). Textured eraser boxes rain into a walled
// basket on a ground slab; each collider is a box matching the eraser's extents.

const FIXED_TIMESTEP = 1 / 60;
const IDENTITY_QUATERNION = [0, 0, 0, 1];
const ERASER_COUNT = 200;
// Flat eraser box (full side lengths) and its half-extents.
const ERASER_SIZE = [2.4, 0.6, 1.2];
const EHALF = [ERASER_SIZE[0] / 2, ERASER_SIZE[1] / 2, ERASER_SIZE[2] / 2];

// Six eraser faces in atlas-column order: +x, -x, +y, -y, +z, -z (right, left, top, bottom, front, back).
const ERASER_FACE_TEXTURES = [
  '../../../../assets/textures/eraser_003/eraser_right.png',
  '../../../../assets/textures/eraser_003/eraser_left.png',
  '../../../../assets/textures/eraser_003/eraser_top.png',
  '../../../../assets/textures/eraser_003/eraser_bottom.png',
  '../../../../assets/textures/eraser_003/eraser_front.png',
  '../../../../assets/textures/eraser_003/eraser_back.png',
];

let HK, worldId, engine;
const entities = [];
const bodyIds = [];

let showWireframe = true;
const debugEntities = [];          // all collider wireframes (for the W toggle)
const eraserDebugEntities = [];    // per-eraser wireframes, parallel to bodyIds
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

// Eraser box: 24 vertices (6 faces) with per-face UVs into a 6-column atlas (+x,-x,+y,-y,+z,-z).
function createEraserGeometry() {
  const faces = [
    { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },
    { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
    { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },
    { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
    { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
    { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
  ];
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  const localUV = [[0, 1], [1, 1], [1, 0], [0, 0]];
  const positions = [], normals = [], texcoords = [], indices = [];
  const dotHalf = (a) => Math.abs(a[0]) * EHALF[0] + Math.abs(a[1]) * EHALF[1] + Math.abs(a[2]) * EHALF[2];
  faces.forEach((f, fi) => {
    const base = positions.length / 3;
    const halfU = dotHalf(f.u), halfV = dotHalf(f.v);
    for (let ci = 0; ci < 4; ci++) {
      const [su, sv] = corners[ci];
      positions.push(
        f.n[0] * EHALF[0] + f.u[0] * su * halfU + f.v[0] * sv * halfV,
        f.n[1] * EHALF[1] + f.u[1] * su * halfU + f.v[1] * sv * halfV,
        f.n[2] * EHALF[2] + f.u[2] * su * halfU + f.v[2] * sv * halfV,
      );
      normals.push(...f.n);
      texcoords.push((localUV[ci][0] + fi) / 6, localUV[ci][1]);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  });
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    texcoords: new Float32Array(texcoords),
    indices: new Uint16Array(indices),
  };
}

// Build a 6-cell atlas (right,left,top,bottom,front,back) PNG data URL from the eraser_003 images.
async function buildEraserAtlasDataUrl() {
  const cell = 256;
  const images = await Promise.all(ERASER_FACE_TEXTURES.map(async (s) => {
    const im = new Image();
    im.src = s;
    await im.decode();
    return im;
  }));
  const canvas = document.createElement('canvas');
  canvas.width = cell * 6;
  canvas.height = cell;
  const ctx = canvas.getContext('2d');
  for (let i = 0; i < 6; i++) ctx.drawImage(images[i], i * cell, 0, cell, cell);
  return canvas.toDataURL('image/png');
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

const load = async function () {
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
  const eraserTex = await Rn.Texture.loadFromUrl(engine, await buildEraserAtlasDataUrl());

  // Ground
  createStaticBody([40, 4, 40], [0, -2, 0]);
  const groundMat = Rn.MaterialHelper.createPbrUberMaterial(engine, { isLighting: true });
  groundMat.setParameter('baseColorFactor', Rn.Vector4.fromCopyArray4([0.24, 0.4, 0.22, 1]));
  const groundEntity = Rn.MeshHelper.createCube(engine, { material: groundMat });
  groundEntity.getTransform().localPosition = Rn.Vector3.fromCopyArray([0, -2, 0]);
  groundEntity.getTransform().localScale = Rn.Vector3.fromCopyArray([40, 4, 40]);
  entities.push(groundEntity);
  createDebugBox([40, 4, 40], [0, -2, 0], DEBUG_COLOR_STATIC);

  // Walls
  const wallDefs = [
    { size: [10, 10, 1], pos: [0, 5, -5] },
    { size: [10, 10, 1], pos: [0, 5, 5] },
    { size: [1, 10, 10], pos: [-5, 5, 0] },
    { size: [1, 10, 10], pos: [5, 5, 0] },
  ];
  const wallMat = Rn.MaterialHelper.createPbrUberMaterial(engine, { isLighting: true });
  wallMat.setParameter('baseColorFactor', Rn.Vector4.fromCopyArray4([0.8, 0.8, 0.85, 0.35]));
  try {
    const blendMode = (Rn.AlphaMode && (Rn.AlphaMode.Blend ?? Rn.AlphaMode.Translucent));
    if (blendMode !== undefined && blendMode !== null) wallMat.alphaMode = blendMode;
  } catch (e) {}
  for (const { size, pos } of wallDefs) {
    createStaticBody(size, pos);
    const wallEntity = Rn.MeshHelper.createCube(engine, { material: wallMat });
    wallEntity.getTransform().localPosition = Rn.Vector3.fromCopyArray(pos);
    wallEntity.getTransform().localScale = Rn.Vector3.fromCopyArray(size);
    entities.push(wallEntity);
    createDebugBox(size, pos, DEBUG_COLOR_STATIC);
  }

  // Shared physics shape
  const psRes = HK.HP_Shape_CreateBox([0, 0, 0], IDENTITY_QUATERNION, ERASER_SIZE);
  checkResult(psRes[0], 'HP_Shape_CreateBox eraser');
  const eraserShapeId = psRes[1];
  HK.HP_Shape_SetDensity(eraserShapeId, 1);
  const pmRes = HK.HP_Shape_BuildMassProperties(eraserShapeId);
  checkResult(pmRes[0], 'HP_Shape_BuildMassProperties eraser');
  const eraserMassProps = pmRes[1];

  // Shared material, primitive, mesh — created ONCE for all erasers.
  const sharedMat = Rn.MaterialHelper.createPbrUberMaterial(engine, { isLighting: true });
  sharedMat.setTextureParameter('baseColorTexture', eraserTex, sampler);

  const geo = createEraserGeometry();
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

  // Shared box-shaped collider wireframe (one mesh reused by every eraser). The wireframe shader
  // needs un-indexed geometry + barycentric coords (what MeshComponent.calcBaryCentricCoord does).
  const eraserWireGeo = buildBoxGeometry(ERASER_SIZE[0], ERASER_SIZE[1], ERASER_SIZE[2]);
  const eraserWirePrimitive = Rn.Primitive.createPrimitive(engine, {
    indices: eraserWireGeo.indices,
    attributeSemantics: [Rn.VertexAttribute.Position.XYZ],
    attributes: [eraserWireGeo.positions],
    material: makeDebugMaterial(DEBUG_COLOR_DYNAMIC),
    primitiveMode: Rn.PrimitiveMode.Triangles,
  });
  const eraserWireMesh = new Rn.Mesh(engine);
  eraserWireMesh.addPrimitive(eraserWirePrimitive);
  try {
    for (const prim of eraserWireMesh.primitives) prim.convertToUnindexedGeometry();
    eraserWireMesh._calcBaryCentricCoord();
  } catch (e) { console.warn('[Eraser] baryCentric failed:', e); }

  for (let i = 0; i < ERASER_COUNT; i++) {
    const x = (Math.random() - 0.5) * 8;
    const y = 12 + Math.random() * 26;
    const z = (Math.random() - 0.5) * 8;
    const qx = Math.random() - 0.5;
    const qy = Math.random() - 0.5;
    const qz = Math.random() - 0.5;
    const qw = Math.random() - 0.5;
    const qlen = Math.sqrt(qx * qx + qy * qy + qz * qz + qw * qw);

    const bRes = HK.HP_Body_Create();
    checkResult(bRes[0], 'HP_Body_Create eraser');
    const bodyId = bRes[1];
    HK.HP_Body_SetShape(bodyId, eraserShapeId);
    HK.HP_Body_SetMotionType(bodyId, HK.MotionType.DYNAMIC);
    HK.HP_Body_SetMassProperties(bodyId, eraserMassProps);
    HK.HP_Body_SetPosition(bodyId, [x, y, z]);
    HK.HP_Body_SetOrientation(bodyId, [qx / qlen, qy / qlen, qz / qlen, qw / qlen]);
    HK.HP_World_AddBody(worldId, bodyId, false);
    bodyIds.push(bodyId);

    const entity = Rn.createMeshEntity(engine);
    entity.getMesh().setMesh(sharedMesh);
    entities.push(entity);

    const debugEntity = Rn.createMeshEntity(engine);
    debugEntity.getMesh().setMesh(eraserWireMesh);
    debugEntities.push(debugEntity);
    eraserDebugEntities.push(debugEntity);
  }

  // Camera
  const cameraEntity = Rn.createCameraControllerEntity(engine);
  cameraEntity.localPosition = Rn.Vector3.fromCopyArray([18, 24, 34]);
  cameraEntity.localEulerAngles = Rn.Vector3.fromCopyArray([-0.6, 0.5, 0]);
  const cameraComponent = cameraEntity.getCamera();
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
  renderPass.clearColor = Rn.Vector4.fromCopyArray4([0.5, 0.5, 0.8, 1]);
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

  // 1 ground + 4 walls = 5 static entities before eraser entities
  const physicsEntityOffset = 5;

  let angle = 0;
  const draw = function () {
    HK.HP_World_Step(worldId, FIXED_TIMESTEP);

    for (let i = 0; i < bodyIds.length; i++) {
      const [, pos] = HK.HP_Body_GetPosition(bodyIds[i]);
      const [, ori] = HK.HP_Body_GetOrientation(bodyIds[i]);
      const entity = entities[physicsEntityOffset + i];
      entity.getTransform().localPosition = Rn.Vector3.fromCopyArray([pos[0], pos[1], pos[2]]);
      entity.getTransform().localRotation = Rn.Quaternion.fromCopyArray([ori[0], ori[1], ori[2], ori[3]]);

      const debugEntity = eraserDebugEntities[i];
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
        const ql = Math.sqrt(qx2 * qx2 + qy2 * qy2 + qz2 * qz2 + qw2 * qw2);
        HK.HP_Body_SetPosition(bodyIds[i], [nx, ny, nz]);
        HK.HP_Body_SetOrientation(bodyIds[i], [qx2 / ql, qy2 / ql, qz2 / ql, qw2 / ql]);
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
