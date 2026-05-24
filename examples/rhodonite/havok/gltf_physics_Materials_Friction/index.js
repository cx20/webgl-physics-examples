import Rn from 'rhodonite';

const MODEL_URL = 'https://raw.githubusercontent.com/eoineoineoin/glTF_Physics/master/samples/Materials_Friction/Materials_Friction.glb';
const FIXED_TIMESTEP = 1 / 60;
const RESET_Y_THRESHOLD = -20;
const IDENTITY_QUATERNION = [0, 0, 0, 1];

let HK, worldId, engine;
let showWireframe = true;

const dynamicNodes = [];   // { entity, debugEntity, bodyId, initialPosition, initialRotation }
const debugEntities = [];

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
  console.warn('[Friction] ' + label + ' returned:', result);
}

// Fetch the GLB JSON chunk to read the KHR_physics_rigid_bodies / KHR_implicit_shapes extensions.
async function fetchGltfJsonFromGlb(url) {
  const response = await fetch(url);
  const data = await response.arrayBuffer();
  const header = new Uint32Array(data, 0, 3);
  if (header[0] !== 0x46546c67) throw new Error('Invalid GLB header.');
  let offset = 12;
  const decoder = new TextDecoder();
  while (offset < data.byteLength) {
    const view = new DataView(data, offset, 8);
    const chunkLength = view.getUint32(0, true);
    const chunkType = view.getUint32(4, true);
    if (chunkType === 0x4e4f534a) {
      const chunkData = data.slice(offset + 8, offset + 8 + chunkLength);
      return JSON.parse(decoder.decode(chunkData).replace(/\0+$/, ''));
    }
    offset += 8 + chunkLength;
  }
  throw new Error('GLB JSON chunk is missing.');
}

function initPhysics() {
  const worldRes = HK.HP_World_Create();
  checkResult(worldRes[0], 'HP_World_Create');
  worldId = worldRes[1];
  checkResult(HK.HP_World_SetGravity(worldId, [0, -9.8, 0]), 'HP_World_SetGravity');
  checkResult(HK.HP_World_SetIdealStepTime(worldId, FIXED_TIMESTEP), 'HP_World_SetIdealStepTime');
}

function createImplicitShape(shapeDef, scale) {
  const sx = Math.abs(scale[0]);
  const sy = Math.abs(scale[1]);
  const sz = Math.abs(scale[2]);

  if (shapeDef.type === 'box' && shapeDef.box) {
    const s = shapeDef.box.size || [1, 1, 1];
    const size = [Math.abs(s[0] * sx), Math.abs(s[1] * sy), Math.abs(s[2] * sz)];
    const res = HK.HP_Shape_CreateBox([0, 0, 0], IDENTITY_QUATERNION, size);
    checkResult(res[0], 'HP_Shape_CreateBox');
    return { shapeId: res[1], size, shapeType: 'box', volume: Math.max(size[0] * size[1] * size[2], 0.0001) };
  }

  if (shapeDef.type === 'sphere' && shapeDef.sphere) {
    const baseR = shapeDef.sphere.radius !== undefined ? shapeDef.sphere.radius : 0.5;
    const r = Math.max(Math.abs(baseR * Math.max(sx, sy, sz)), 0.0001);
    const res = HK.HP_Shape_CreateSphere([0, 0, 0], r);
    checkResult(res[0], 'HP_Shape_CreateSphere');
    return { shapeId: res[1], size: [r * 2, r * 2, r * 2], shapeType: 'sphere', volume: Math.max((4 / 3) * Math.PI * r * r * r, 0.0001) };
  }

  return null;
}

// Apply the glTF physics material. restitutionCombine = MAXIMUM so the bouncy ball's
// high restitution wins against the non-bouncy floor (restitution 0).
function applyMaterial(shapeId, matDef) {
  if (!matDef || typeof HK.HP_Shape_SetMaterial !== 'function') return;
  const df = matDef.dynamicFriction !== undefined ? matDef.dynamicFriction : 0.5;
  const sf = matDef.staticFriction !== undefined ? matDef.staticFriction : 0.5;
  const r = matDef.restitution !== undefined ? matDef.restitution : 0.0;
  HK.HP_Shape_SetMaterial(shapeId, [df, sf, r, HK.MaterialCombine.MAXIMUM, HK.MaterialCombine.MAXIMUM]);
}

function createBody(shapeId, motionType, position, rotation, motionDef, volume) {
  const bRes = HK.HP_Body_Create();
  checkResult(bRes[0], 'HP_Body_Create');
  const bodyId = bRes[1];
  HK.HP_Body_SetShape(bodyId, shapeId);
  HK.HP_Body_SetMotionType(bodyId, motionType);
  if (motionDef) {
    const mass = motionDef.mass;
    if (mass !== undefined && mass > 0) {
      HK.HP_Shape_SetDensity(shapeId, mass / volume);
    }
    const mp = HK.HP_Shape_BuildMassProperties(shapeId);
    checkResult(mp[0], 'HP_Shape_BuildMassProperties');
    HK.HP_Body_SetMassProperties(bodyId, mp[1]);
  }
  HK.HP_Body_SetPosition(bodyId, position);
  HK.HP_Body_SetOrientation(bodyId, rotation);
  HK.HP_World_AddBody(worldId, bodyId, false);
  return bodyId;
}

// Mirror Rhodonite's VRM spring-bone collider gizmo: a PbrUber material with the
// RN_USE_WIREFRAME shader define, and (crucially) calcBaryCentricCoord() on the mesh so
// the wireframe shader has the barycentric coordinates it needs to draw the edges.
function makeDebugMaterial(color) {
  const mat = Rn.MaterialHelper.createPbrUberMaterial(engine, { isLighting: false, isSkinning: false, isMorphing: false });
  try { mat.addShaderDefine('RN_USE_WIREFRAME'); } catch (e) {}
  try { mat.setParameter('wireframe', Rn.Vector3.fromCopy3(1, 0, 1)); } catch (e) {}
  try { mat.setParameter('baseColorFactor', Rn.Vector4.fromCopyArray4(color)); } catch (e) {}
  return mat;
}

// Draw the collider wireframe slightly larger than the visual mesh so it is not hidden
// by the (same-sized) rendered surface.
const DEBUG_SCALE = 1.0;
const DEBUG_COLOR_DYNAMIC = [1.0, 0.5, 0.2, 1.0];
const DEBUG_COLOR_STATIC = [0.2, 1.0, 0.4, 1.0];

function createDebugEntity(shapeResult, color) {
  const mat = makeDebugMaterial(color);
  let entity;
  if (shapeResult.shapeType === 'sphere') {
    const r = Math.max(shapeResult.size[0] * 0.5, 0.01) * DEBUG_SCALE;
    entity = Rn.MeshHelper.createSphere(engine, { radius: r, widthSegments: 16, heightSegments: 12, material: mat });
  } else {
    entity = Rn.MeshHelper.createCube(engine, { material: mat });
    entity.getTransform().localScale = Rn.Vector3.fromCopyArray([
      Math.max(shapeResult.size[0], 0.02) * DEBUG_SCALE,
      Math.max(shapeResult.size[1], 0.02) * DEBUG_SCALE,
      Math.max(shapeResult.size[2], 0.02) * DEBUG_SCALE
    ]);
  }
  try { entity.getMesh().calcBaryCentricCoord(); } catch (e) { console.warn('[Friction] calcBaryCentricCoord failed:', e); }
  debugEntities.push(entity);
  return entity;
}

const load = async function () {
  HK = await HavokPhysics();

  const canvas = document.getElementById('world');
  engine = await Rn.Engine.init({ approach: Rn.ProcessApproach.DataTexture, canvas });

  function resizeCanvas() {
    engine.resizeCanvas(window.innerWidth, window.innerHeight);
  }
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  initPhysics();

  const gltfJson = await fetchGltfJsonFromGlb(MODEL_URL);

  // Camera: reuse the glTF camera node's transform for the intended framing.
  const camNode = gltfJson.nodes.find((n) => n.camera !== undefined) || {};
  const camPos = camNode.translation || [0, 2.5, 7.5];
  const camRot = camNode.rotation || [0, 0, 0, 1];
  const cameraEntity = Rn.createCameraEntity(engine);
  cameraEntity.localPosition = Rn.Vector3.fromCopyArray(camPos);
  cameraEntity.localRotation = Rn.Quaternion.fromCopyArray(camRot);
  const cameraComponent = cameraEntity.getCamera();
  cameraComponent.zNear = 0.1;
  cameraComponent.zFar = 100;
  cameraComponent.setFovyAndChangeFocalLength(30);
  cameraComponent.aspect = window.innerWidth / window.innerHeight;

  // Light
  const lightEntity = Rn.createLightEntity(engine);
  const lightComponent = lightEntity.getLight();
  lightComponent.type = Rn.LightType.Directional;
  lightComponent.intensity = 2;
  lightEntity.localEulerAngles = Rn.Vector3.fromCopyArray([-Math.PI / 4, -Math.PI / 4, 0]);

  // Load and render the glTF model first (clears color + depth).
  const gltfExpression = await Rn.GltfImporter.importFromUrl(engine, MODEL_URL, {
    defaultMaterialHelperArgumentArray: [{ makeOutputSrgb: false }],
  });
  const modelRenderPass = gltfExpression.renderPasses[0];
  modelRenderPass.cameraComponent = cameraComponent;
  modelRenderPass.toClearColorBuffer = true;
  modelRenderPass.clearColor = Rn.Vector4.fromCopyArray4([0.96, 0.97, 0.99, 1]);

  // Debug collider wireframes are drawn in a second pass on top of the model
  // (no depth test) so the whole collider shape is visible, not just its silhouette.
  const debugRenderPass = new Rn.RenderPass(engine);
  debugRenderPass.cameraComponent = cameraComponent;
  debugRenderPass.toClearColorBuffer = false;
  try { debugRenderPass.isDepthTest = false; } catch (e) {}

  const expression = new Rn.Expression();
  expression.addRenderPasses([modelRenderPass, debugRenderPass]);

  // Map glTF node -> Rhodonite entity by unique name (== glTF node name).
  const nameToEntity = new Map();
  for (const entity of modelRenderPass.entities) {
    const nm = entity.uniqueName;
    if (nm && !nameToEntity.has(nm)) nameToEntity.set(nm, entity);
  }

  const shapeDefs = gltfJson.extensions?.KHR_implicit_shapes?.shapes || [];
  const materialDefs = gltfJson.extensions?.KHR_physics_rigid_bodies?.physicsMaterials || [];
  const sceneNodeIndices = (gltfJson.scenes?.[gltfJson.scene || 0]?.nodes) || [];

  for (const nodeIndex of sceneNodeIndices) {
    const nodeDef = gltfJson.nodes[nodeIndex];
    const physicsExt = nodeDef?.extensions?.KHR_physics_rigid_bodies;
    if (!physicsExt) continue;

    const motion = physicsExt.motion || null;
    const geometry = physicsExt.collider?.geometry;
    if (geometry?.shape === undefined || !shapeDefs[geometry.shape]) continue;

    const isDynamic = !!motion;
    const translation = nodeDef.translation || [0, 0, 0];
    const rotation = nodeDef.rotation || [0, 0, 0, 1];
    const scale = nodeDef.scale || [1, 1, 1];

    const shapeResult = createImplicitShape(shapeDefs[geometry.shape], scale);
    if (!shapeResult) continue;

    const matDef = physicsExt.collider.physicsMaterial !== undefined
      ? materialDefs[physicsExt.collider.physicsMaterial]
      : null;
    applyMaterial(shapeResult.shapeId, matDef);

    const position = [translation[0], translation[1], translation[2]];
    const bodyId = createBody(
      shapeResult.shapeId,
      isDynamic ? HK.MotionType.DYNAMIC : HK.MotionType.STATIC,
      position, rotation, motion, shapeResult.volume
    );

    if (!isDynamic) {
      // Static collider (floor): a fixed wireframe box at the body's transform.
      const staticDebug = createDebugEntity(shapeResult, DEBUG_COLOR_STATIC);
      staticDebug.getTransform().localPosition = Rn.Vector3.fromCopyArray(position);
      staticDebug.getTransform().localRotation = Rn.Quaternion.fromCopyArray(rotation);
      continue;
    }

    const entity = nodeDef.name ? nameToEntity.get(nodeDef.name) : null;
    if (!entity) console.warn('[Friction] no entity for node', nodeIndex, nodeDef.name);

    dynamicNodes.push({
      entity,
      debugEntity: createDebugEntity(shapeResult, DEBUG_COLOR_DYNAMIC),
      bodyId,
      initialPosition: position,
      initialRotation: [rotation[0], rotation[1], rotation[2], rotation[3]],
    });
  }

  if (debugEntities.length > 0) debugRenderPass.addEntities(debugEntities);
  setWireframeVisible(showWireframe);

  setInterval(() => {
    HK.HP_World_Step(worldId, FIXED_TIMESTEP);
    for (const node of dynamicNodes) {
      const [, p] = HK.HP_Body_GetPosition(node.bodyId);
      if (p[1] < RESET_Y_THRESHOLD) {
        HK.HP_Body_SetPosition(node.bodyId, node.initialPosition);
        HK.HP_Body_SetOrientation(node.bodyId, node.initialRotation);
        HK.HP_Body_SetLinearVelocity(node.bodyId, [0, 0, 0]);
        HK.HP_Body_SetAngularVelocity(node.bodyId, [0, 0, 0]);
        continue;
      }
      const [, pos] = HK.HP_Body_GetPosition(node.bodyId);
      const [, ori] = HK.HP_Body_GetOrientation(node.bodyId);
      const v = Rn.Vector3.fromCopyArray([pos[0], pos[1], pos[2]]);
      const q = Rn.Quaternion.fromCopyArray([ori[0], ori[1], ori[2], ori[3]]);
      if (node.entity) {
        node.entity.getTransform().localPosition = v;
        node.entity.getTransform().localRotation = q;
      }
      if (node.debugEntity) {
        node.debugEntity.getTransform().localPosition = v;
        node.debugEntity.getTransform().localRotation = q;
      }
    }
  }, 1000 / 60);

  const draw = function () {
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
