import Rn from 'rhodonite';

const GLTF_URL = 'https://cx20.github.io/gltf-test/tutorialModels/IridescenceMetallicSpheres/glTF/IridescenceMetallicSpheres.gltf';
const FIXED_TIMESTEP = 1 / 60;
const IDENTITY_QUATERNION = [0, 0, 0, 1];

let HK, worldId, engine;
const entities = [];
const bodyIds = [];

let showWireframe = true;
const debugEntities = [];        // all collider wireframes (W toggles visibility)
const marbleDebugEntities = [];  // per-marble wireframes, parallel to bodyIds
const DEBUG_COLOR_DYNAMIC = [1.0, 0.5, 0.2, 1.0];
const DEBUG_COLOR_STATIC = [0.2, 1.0, 0.4, 1.0];

// PbrUber + RN_USE_WIREFRAME with calcBaryCentricCoord() so the wireframe shader can draw the
// collider edges (mirrors the other Rhodonite + Havok samples).
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
  createDebugBox([40, 4, 40], [0, -2, 0], DEBUG_COLOR_STATIC);

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
    createDebugBox(size, pos, DEBUG_COLOR_STATIC);
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
  // The glTF marble geometry is a radius-1 sphere (POSITION min/max = +/-1, no node scale),
  // so the collider must use radius 1 to match the visible mesh.
  const physicsRadius = 1.0;

  // Shared marble collider wireframe (one sphere mesh reused by every marble, instanced so the
  // debug pass doesn't add hundreds of extra unique meshes). Needs un-indexed geometry + barycentric.
  const marbleWireHelper = Rn.MeshHelper.createSphere(engine, {
    radius: physicsRadius,
    widthSegments: 8,
    heightSegments: 6,
    material: makeDebugMaterial(DEBUG_COLOR_DYNAMIC),
  });
  try { marbleWireHelper.getSceneGraph().isVisible = false; } catch (e) {} // hide the origin helper entity
  const marbleWireMesh = marbleWireHelper.getMesh().mesh;
  try {
    for (const prim of marbleWireMesh.primitives) prim.convertToUnindexedGeometry();
    marbleWireMesh._calcBaryCentricCoord();
  } catch (e) { console.warn('[Marbles] baryCentric failed:', e); }

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

      const debugEntity = Rn.createMeshEntity(engine);
      debugEntity.getMesh().setMesh(marbleWireMesh);
      debugEntity.getTransform().localPosition = Rn.Vector3.fromCopyArray([dropX, dropY, dropZ]);
      debugEntities.push(debugEntity);
      marbleDebugEntities.push(debugEntity);
    }
  });

  expression.addRenderPasses([gltfRenderPass]);

  // Collider wireframes drawn last, on top of everything, with no depth test
  // so the whole collider shape is visible, not just its silhouette.
  const debugRenderPass = new Rn.RenderPass(engine);
  debugRenderPass.cameraComponent = cameraComponent;
  debugRenderPass.toClearColorBuffer = false;
  try { debugRenderPass.isDepthTest = false; } catch (e) {}
  debugRenderPass.addEntities(debugEntities);
  expression.addRenderPasses([debugRenderPass]);

  setWireframeVisible(showWireframe);

  setInterval(() => {
    HK.HP_World_Step(worldId, FIXED_TIMESTEP);
    for (let i = 0; i < bodyIds.length; i++) {
      const [, pos] = HK.HP_Body_GetPosition(bodyIds[i]);
      const [, ori] = HK.HP_Body_GetOrientation(bodyIds[i]);
      sphereEntities[i].getTransform().localPosition = Rn.Vector3.fromCopyArray([pos[0], pos[1], pos[2]]);
      sphereEntities[i].getTransform().localRotation = Rn.Quaternion.fromCopyArray([ori[0], ori[1], ori[2], ori[3]]);

      const debugEntity = marbleDebugEntities[i];
      debugEntity.getTransform().localPosition = Rn.Vector3.fromCopyArray([pos[0], pos[1], pos[2]]);
      debugEntity.getTransform().localRotation = Rn.Quaternion.fromCopyArray([ori[0], ori[1], ori[2], ori[3]]);

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
