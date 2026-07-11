import Rn from 'rhodonite';

// Rhodonite (rendering) + Rapier (physics, raw world/rigid-body API). A Duck glTF drops onto a
// ground slab with a box collider; click to bounce it. Mirrors the Rhodonite + Havok glTF sample.

const DUCK_URL = 'https://rawcdn.githack.com/cx20/gltf-test/5465cc37/sampleModels/Duck/glTF/Duck.gltf';

const cubeSizeX = 16 / 16 * 5;
const cubeSizeY = 16 / 16 * 5;
const cubeSizeZ = 9 / 16 * 5;

let RAPIER, world, engine;
let duckBody;
let groundEntity, wireEntity;
let expression;
let showWireframe = true;

const debugEntities = [];      // collider wireframes (W toggles visibility)
const DEBUG_COLOR_DYNAMIC = [1.0, 0.5, 0.2, 1.0];
const DEBUG_COLOR_STATIC = [0.2, 1.0, 0.4, 1.0];

// PbrUber + RN_USE_WIREFRAME with calcBaryCentricCoord() so the wireframe shader can draw the
// collider edges (mirrors the other Rhodonite samples).
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

function rotateVec3ByQuat(v, q) {
  const [vx, vy, vz] = v;
  const [qx, qy, qz, qw] = q;
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  return [
    vx + qw * tx + qy * tz - qz * ty,
    vy + qw * ty + qz * tx - qx * tz,
    vz + qw * tz + qx * ty - qy * tx,
  ];
}

function initPhysics() {
  world = new RAPIER.World({ x: 0, y: -9.8, z: 0 });

  // Ground (static). Rapier cuboid takes half-extents; the Havok box size [800, 8, 800] is full.
  const groundBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -5, 0));
  world.createCollider(RAPIER.ColliderDesc.cuboid(400, 4, 400), groundBody);

  // Duck body: box collider (half-extents = cubeSize*), spinning as it falls.
  duckBody = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 20, 0).setAngvel({ x: 0, y: 0, z: 3.5 })
  );
  world.createCollider(RAPIER.ColliderDesc.cuboid(cubeSizeX, cubeSizeY, cubeSizeZ).setDensity(1), duckBody);
}

const load = async function() {
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

  // Rhodonite v0.19.9 added a Rapier physics backend. This sample drives Rapier directly
  // (raw world / rigid-body API), mirroring how the Havok version used the Havok low-level API.
  RAPIER = (await import('https://cdn.skypack.dev/@dimforge/rapier3d-compat@0.17.3')).default;
  await RAPIER.init();

  initPhysics();

  // Ground plane (visual)
  const groundMat = Rn.MaterialHelper.createPbrUberMaterial(engine, { isLighting: true });
  groundMat.setParameter('baseColorFactor', Rn.Vector4.fromCopyArray4([1, 1, 1, 1]));
  groundEntity = Rn.MeshHelper.createCube(engine, { material: groundMat });
  groundEntity.getTransform().localPosition = Rn.Vector3.fromCopyArray([0, -5, 0]);
  groundEntity.getTransform().localScale = Rn.Vector3.fromCopyArray([300, 8, 300]);

  // Collider wireframes: ground box (static, green) + duck box (dynamic, orange, follows the body).
  createDebugBox([800, 8, 800], [0, -5, 0], DEBUG_COLOR_STATIC);
  wireEntity = createDebugBox([cubeSizeX * 2, cubeSizeY * 2, cubeSizeZ * 2], [0, 20, 0], DEBUG_COLOR_DYNAMIC);

  // Camera
  const cameraEntity = Rn.createCameraControllerEntity(engine);
  cameraEntity.localPosition = Rn.Vector3.fromCopyArray([20, 20, 30]);
  cameraEntity.localEulerAngles = Rn.Vector3.fromCopyArray([-0.27, 0.59, 0]);
  const cameraComponent = cameraEntity.getCamera();
  cameraComponent.zNear = 1;
  cameraComponent.zFar = 10000;
  cameraComponent.setFovyAndChangeFocalLength(30);
  cameraComponent.aspect = window.innerWidth / window.innerHeight;

  // Light
  const lightEntity = Rn.createLightEntity(engine);
  const lightComponent = lightEntity.getLight();
  lightComponent.type = Rn.LightType.Directional;
  lightComponent.intensity = 2;
  lightEntity.localEulerAngles = Rn.Vector3.fromCopyArray([-Math.PI / 4, -Math.PI / 4, 0]);

  // Base render pass (ground + wire box)
  const renderPass = new Rn.RenderPass(engine);
  renderPass.cameraComponent = cameraComponent;
  renderPass.toClearColorBuffer = true;
  renderPass.clearColor = Rn.Vector4.fromCopyArray4([0, 0, 0, 1]);
  renderPass.addEntities([groundEntity]);

  expression = new Rn.Expression();
  expression.addRenderPasses([renderPass]);

  // Load Duck glTF
  const gltfExpression = await Rn.GltfImporter.importFromUrl(engine, DUCK_URL, {
    defaultMaterialHelperArgumentArray: [{ makeOutputSrgb: false }],
  });

  // Scale duck and adjust position offset
  const duckRenderPassObj = gltfExpression.renderPasses[0];
  duckRenderPassObj.cameraComponent = cameraComponent;
  duckRenderPassObj.toClearColorBuffer = false;

  // Scale duck entities
  duckRenderPassObj.entities.forEach(entity => {
    const sg = entity.getSceneGraph ? entity.getSceneGraph() : null;
    if (sg && !sg.parent) {
      entity.getTransform().localScale = Rn.Vector3.fromCopyArray([5, 5, 5]);
    }
  });

  expression.addRenderPasses([duckRenderPassObj]);

  // Collider wireframes drawn last, on top of everything, with no depth test
  // so the whole collider shape is visible, not just its silhouette.
  const debugRenderPass = new Rn.RenderPass(engine);
  debugRenderPass.cameraComponent = cameraComponent;
  debugRenderPass.toClearColorBuffer = false;
  try { debugRenderPass.isDepthTest = false; } catch (e) {}
  debugRenderPass.addEntities(debugEntities);
  expression.addRenderPasses([debugRenderPass]);

  setWireframeVisible(showWireframe);

  document.addEventListener('click', () => {
    if (duckBody) {
      duckBody.setLinvel({ x: 0, y: 5, z: 0 }, true);
    }
  });

  setInterval(() => {
    world.step();
    const p = duckBody.translation();
    const o = duckBody.rotation();
    const pos = [p.x, p.y, p.z];
    const ori = [o.x, o.y, o.z, o.w];

    wireEntity.getTransform().localPosition = Rn.Vector3.fromCopyArray([pos[0], pos[1], pos[2]]);
    wireEntity.getTransform().localRotation = Rn.Quaternion.fromCopyArray([ori[0], ori[1], ori[2], ori[3]]);

    duckRenderPassObj.entities.forEach(entity => {
      const sg = entity.getSceneGraph ? entity.getSceneGraph() : null;
      if (sg && !sg.parent) {
        const [ox, oy, oz] = rotateVec3ByQuat([0, -cubeSizeY, 0], ori);
        entity.getTransform().localPosition = Rn.Vector3.fromCopyArray([pos[0] + ox, pos[1] + oy, pos[2] + oz]);
        entity.getTransform().localRotation = Rn.Quaternion.fromCopyArray([ori[0], ori[1], ori[2], ori[3]]);
      }
    });
  }, 1000 / 60);

  const draw = function() {
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
  if (event.repeat) {
    return;
  }
  if (event.code === 'KeyW' || event.key === 'w' || event.key === 'W') {
    setWireframeVisible(!showWireframe);
  }
});

document.body.onload = load;
