import Rn from 'rhodonite';

// Rhodonite (rendering) + Rapier (physics, raw world/rigid-body API). Loads a glTF that uses the
// KHR_physics_rigid_bodies / KHR_implicit_shapes extensions with physics materials (restitution).
// Mirrors the Rhodonite + Havok Materials Restitution sample, with the physics engine swapped to Rapier.

const MODEL_URL = 'https://raw.githubusercontent.com/eoineoineoin/glTF_Physics/master/samples/Materials_Restitution/Materials_Restitution.glb';
const FIXED_TIMESTEP = 1 / 60;
const RESET_Y_THRESHOLD = -20;
const LABEL = 'Restitution';

let RAPIER, world, engine;
let showWireframe = true;

const dynamicNodes = [];   // { entity, debugEntity, body, initialPosition, initialRotation }
const debugEntities = [];

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
  world = new RAPIER.World({ x: 0, y: -9.8, z: 0 });
  world.timestep = FIXED_TIMESTEP;
}

// Build a Rapier collider descriptor for box / sphere implicit shapes, plus the { size, shapeType }
// metadata for the wireframe gizmo.
function createImplicitShape(shapeDef, scale) {
  const sx = Math.abs(scale[0]);
  const sy = Math.abs(scale[1]);
  const sz = Math.abs(scale[2]);

  if (shapeDef.type === 'box' && shapeDef.box) {
    const s = shapeDef.box.size || [1, 1, 1];
    const size = [Math.abs(s[0] * sx), Math.abs(s[1] * sy), Math.abs(s[2] * sz)];
    const colliderDesc = RAPIER.ColliderDesc.cuboid(
      Math.max(size[0] * 0.5, 0.0001), Math.max(size[1] * 0.5, 0.0001), Math.max(size[2] * 0.5, 0.0001)
    );
    return { colliderDesc, size, shapeType: 'box' };
  }

  if (shapeDef.type === 'sphere' && shapeDef.sphere) {
    const baseR = shapeDef.sphere.radius !== undefined ? shapeDef.sphere.radius : 0.5;
    const r = Math.max(Math.abs(baseR * Math.max(sx, sy, sz)), 0.0001);
    return { colliderDesc: RAPIER.ColliderDesc.ball(r), size: [r * 2, r * 2, r * 2], shapeType: 'sphere' };
  }

  return null;
}

// Apply the glTF physics material to the collider descriptor. Use the Max restitution combine rule
// (so a bouncy body wins against a non-bouncy floor), matching the three.js + Rapier sample.
function applyMaterial(colliderDesc, matDef) {
  const df = matDef?.dynamicFriction !== undefined ? matDef.dynamicFriction : 0.5;
  const r = matDef?.restitution !== undefined ? matDef.restitution : 0.0;
  colliderDesc.setFriction(df);
  colliderDesc.setRestitution(r);
  // Havok combines both friction and restitution with MAXIMUM, so an object's own material wins
  // against a low-friction / non-bouncy floor. Match that so the demo reads the same.
  try { colliderDesc.setFrictionCombineRule(RAPIER.CoefficientCombineRule.Max); } catch (e) {}
  try { colliderDesc.setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max); } catch (e) {}
}

function createBody(colliderDesc, isDynamic, position, rotation) {
  const bodyDesc = (isDynamic ? RAPIER.RigidBodyDesc.dynamic() : RAPIER.RigidBodyDesc.fixed())
    .setTranslation(position[0], position[1], position[2])
    .setRotation({ x: rotation[0], y: rotation[1], z: rotation[2], w: rotation[3] });
  const body = world.createRigidBody(bodyDesc);
  world.createCollider(colliderDesc, body);
  return body;
}

// Mirror Rhodonite's VRM spring-bone collider gizmo: a PbrUber material with the
// RN_USE_WIREFRAME shader define, and calcBaryCentricCoord() on the mesh so the wireframe
// shader has the barycentric coordinates it needs to draw the edges.
function makeDebugMaterial(color) {
  const mat = Rn.MaterialHelper.createPbrUberMaterial(engine, { isLighting: false, isSkinning: false, isMorphing: false });
  try { mat.addShaderDefine('RN_USE_WIREFRAME'); } catch (e) {}
  try { mat.setParameter('wireframe', Rn.Vector3.fromCopy3(1, 0, 1)); } catch (e) {}
  try { mat.setParameter('baseColorFactor', Rn.Vector4.fromCopyArray4(color)); } catch (e) {}
  return mat;
}

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
  try { entity.getMesh().calcBaryCentricCoord(); } catch (e) { console.warn('[' + LABEL + '] calcBaryCentricCoord failed:', e); }
  debugEntities.push(entity);
  return entity;
}

const load = async function () {
  // Rhodonite v0.19.9 added a Rapier physics backend. This sample drives Rapier directly
  // (raw world / rigid-body API), mirroring how the Havok version used the Havok low-level API.
  RAPIER = (await import('https://cdn.skypack.dev/@dimforge/rapier3d-compat@0.17.3')).default;
  await RAPIER.init();

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

  // Map glTF node -> Rhodonite entity by unique name (Rhodonite appends a _(NN) suffix, so
  // register the suffix-stripped name as well).
  const nameToEntity = new Map();
  for (const entity of modelRenderPass.entities) {
    const nm = entity.uniqueName;
    if (nm && !nameToEntity.has(nm)) {
      nameToEntity.set(nm, entity);
      const stripped = nm.replace(/_\(\d+\)$/, '');
      if (stripped && !nameToEntity.has(stripped)) nameToEntity.set(stripped, entity);
    }
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
    applyMaterial(shapeResult.colliderDesc, matDef);

    const position = [translation[0], translation[1], translation[2]];
    const body = createBody(shapeResult.colliderDesc, isDynamic, position, rotation);

    if (!isDynamic) {
      // Static collider (floor): a fixed wireframe box at the body's transform.
      const staticDebug = createDebugEntity(shapeResult, DEBUG_COLOR_STATIC);
      staticDebug.getTransform().localPosition = Rn.Vector3.fromCopyArray(position);
      staticDebug.getTransform().localRotation = Rn.Quaternion.fromCopyArray(rotation);
      continue;
    }

    const entity = nodeDef.name ? nameToEntity.get(nodeDef.name) : null;
    if (!entity) console.warn('[' + LABEL + '] no entity for node', nodeIndex, nodeDef.name);

    dynamicNodes.push({
      entity,
      debugEntity: createDebugEntity(shapeResult, DEBUG_COLOR_DYNAMIC),
      body,
      initialPosition: { x: position[0], y: position[1], z: position[2] },
      initialRotation: { x: rotation[0], y: rotation[1], z: rotation[2], w: rotation[3] },
    });
  }

  if (debugEntities.length > 0) debugRenderPass.addEntities(debugEntities);
  setWireframeVisible(showWireframe);

  setInterval(() => {
    world.step();
    for (const node of dynamicNodes) {
      const p = node.body.translation();
      if (p.y < RESET_Y_THRESHOLD) {
        node.body.setTranslation(node.initialPosition, true);
        node.body.setRotation(node.initialRotation, true);
        node.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        node.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        continue;
      }
      const pos = node.body.translation();
      const ori = node.body.rotation();
      const v = Rn.Vector3.fromCopyArray([pos.x, pos.y, pos.z]);
      const q = Rn.Quaternion.fromCopyArray([ori.x, ori.y, ori.z, ori.w]);
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
