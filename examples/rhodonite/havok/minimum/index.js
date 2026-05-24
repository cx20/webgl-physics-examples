import Rn from 'rhodonite';

const FIXED_TIMESTEP = 1 / 60;
const IDENTITY_QUATERNION = [0, 0, 0, 1];

let HK, worldId;
let engine;
let entityGround, entityCube;
let groundBodyId, cubeBodyId;

let showWireframe = true;
const debugEntities = [];     // collider wireframes (W toggles visibility)
let cubeDebugEntity = null;   // dynamic cube wireframe (follows the body)
const DEBUG_COLOR_DYNAMIC = [1.0, 0.5, 0.2, 1.0];
const DEBUG_COLOR_STATIC = [0.2, 1.0, 0.4, 1.0];

// PbrUber + RN_USE_WIREFRAME, with calcBaryCentricCoord() on the mesh so the wireframe shader
// can draw the collider edges (mirrors the other Rhodonite + Havok samples).
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

function initPhysics() {
  const worldRes = HK.HP_World_Create();
  worldId = worldRes[1];
  HK.HP_World_SetGravity(worldId, [0, -9.81, 0]);
  HK.HP_World_SetIdealStepTime(worldId, FIXED_TIMESTEP);

  // Ground (static)
  const gsRes = HK.HP_Shape_CreateBox([0, 0, 0], IDENTITY_QUATERNION, [4, 0.1, 4]);
  const gbRes = HK.HP_Body_Create();
  groundBodyId = gbRes[1];
  HK.HP_Body_SetShape(groundBodyId, gsRes[1]);
  HK.HP_Body_SetMotionType(groundBodyId, HK.MotionType.STATIC);
  HK.HP_Body_SetPosition(groundBodyId, [0, 0, 0]);
  HK.HP_Body_SetOrientation(groundBodyId, IDENTITY_QUATERNION);
  HK.HP_World_AddBody(worldId, groundBodyId, false);

  // Cube (dynamic)
  const csRes = HK.HP_Shape_CreateBox([0, 0, 0], IDENTITY_QUATERNION, [1, 1, 1]);
  const cbRes = HK.HP_Body_Create();
  cubeBodyId = cbRes[1];
  HK.HP_Body_SetShape(cubeBodyId, csRes[1]);
  HK.HP_Body_SetMotionType(cubeBodyId, HK.MotionType.DYNAMIC);
  const mRes = HK.HP_Shape_BuildMassProperties(csRes[1]);
  HK.HP_Body_SetMassProperties(cubeBodyId, mRes[1]);
  HK.HP_Body_SetPosition(cubeBodyId, [0, 2, 0]);
  const angle = Math.PI * 10 / 180;
  const s = Math.sin(angle / 2);
  const c = Math.cos(angle / 2);
  const inv = 1 / Math.sqrt(2);
  HK.HP_Body_SetOrientation(cubeBodyId, [inv * s, 0, inv * s, c]);
  HK.HP_World_AddBody(worldId, cubeBodyId, false);
}

const load = async function() {
  HK = await HavokPhysics();

  const canvas = document.getElementById('world');

  engine = await Rn.Engine.init({
    approach: Rn.ProcessApproach.DataTexture,
    canvas: canvas,
  });

  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  function resizeCanvas() {
    engine.resizeCanvas(window.innerWidth, window.innerHeight);
  }

  const texture = await Rn.Texture.loadFromUrl(engine, '../../../../assets/textures/frog.jpg');

  const sampler = new Rn.Sampler(engine, {
    magFilter: Rn.TextureParameter.Linear,
    minFilter: Rn.TextureParameter.Linear,
    wrapS: Rn.TextureParameter.ClampToEdge,
    wrapT: Rn.TextureParameter.ClampToEdge,
  });

  const material = Rn.MaterialHelper.createClassicUberMaterial(engine);
  material.setTextureParameter('diffuseColorTexture', texture, sampler);

  // Ground
  entityGround = Rn.MeshHelper.createCube(engine, { material });
  entityGround.getTransform().localPosition = Rn.Vector3.fromCopyArray([0, 0, 0]);
  entityGround.getTransform().localScale = Rn.Vector3.fromCopyArray([4, 0.1, 4]);

  // Cube
  entityCube = Rn.MeshHelper.createCube(engine, { material });
  entityCube.getTransform().localScale = Rn.Vector3.fromCopyArray([1, 1, 1]);

  initPhysics();

  // Collider wireframes (green = static ground, orange = dynamic cube)
  createDebugBox([4, 0.1, 4], [0, 0, 0], DEBUG_COLOR_STATIC);
  cubeDebugEntity = createDebugBox([1, 1, 1], [0, 2, 0], DEBUG_COLOR_DYNAMIC);

  // Camera
  const cameraEntity = Rn.createCameraControllerEntity(engine);
  cameraEntity.localPosition = Rn.Vector3.fromCopyArray([0, 3, 6]);
  cameraEntity.localEulerAngles = Rn.Vector3.fromCopyArray([-0.4, 0, 0]);
  const cameraComponent = cameraEntity.getCamera();
  cameraComponent.zNear = 0.1;
  cameraComponent.zFar = 100;
  cameraComponent.setFovyAndChangeFocalLength(45);
  cameraComponent.aspect = window.innerWidth / window.innerHeight;

  // RenderPass
  const renderPass = new Rn.RenderPass(engine);
  renderPass.cameraComponent = cameraComponent;
  renderPass.toClearColorBuffer = true;
  renderPass.clearColor = Rn.Vector4.fromCopyArray4([0, 0, 0, 1]);
  renderPass.addEntities([entityGround, entityCube]);

  // Collider wireframes are drawn in a second pass on top of the model (no depth test)
  // so the whole collider shape is visible, not just its silhouette.
  const debugRenderPass = new Rn.RenderPass(engine);
  debugRenderPass.cameraComponent = cameraComponent;
  debugRenderPass.toClearColorBuffer = false;
  try { debugRenderPass.isDepthTest = false; } catch (e) {}
  debugRenderPass.addEntities(debugEntities);

  // Expression
  const expression = new Rn.Expression();
  expression.addRenderPasses([renderPass, debugRenderPass]);

  setWireframeVisible(showWireframe);

  const draw = function() {
    HK.HP_World_Step(worldId, FIXED_TIMESTEP);

    const [, pos] = HK.HP_Body_GetPosition(cubeBodyId);
    const [, ori] = HK.HP_Body_GetOrientation(cubeBodyId);

    entityCube.getTransform().localPosition = Rn.Vector3.fromCopyArray([pos[0], pos[1], pos[2]]);
    entityCube.getTransform().localRotation = Rn.Quaternion.fromCopyArray([ori[0], ori[1], ori[2], ori[3]]);

    if (cubeDebugEntity) {
      cubeDebugEntity.getTransform().localPosition = Rn.Vector3.fromCopyArray([pos[0], pos[1], pos[2]]);
      cubeDebugEntity.getTransform().localRotation = Rn.Quaternion.fromCopyArray([ori[0], ori[1], ori[2], ori[3]]);
    }

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
