import Rn from 'rhodonite';

let engine;
let entityCube;

let showWireframe = true;
const debugEntities = [];     // collider wireframes (W toggles visibility)
let cubeDebugEntity = null;   // dynamic cube wireframe (follows the physics body)
const DEBUG_COLOR_DYNAMIC = [1.0, 0.5, 0.2, 1.0];
const DEBUG_COLOR_STATIC = [0.2, 1.0, 0.4, 1.0];

// PbrUber + RN_USE_WIREFRAME, with calcBaryCentricCoord() on the mesh so the wireframe shader
// can draw the collider edges (mirrors the Rhodonite + Havok samples).
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

const load = async function() {
    const c = document.getElementById('world');

    engine = await Rn.Engine.init({
      approach: Rn.ProcessApproach.DataTexture,
      canvas: c,
    });

    // Rhodonite v0.19.9 added a Rapier physics backend. Rapier is not bundled,
    // so load it and hand the module to RapierPhysicsStrategy.initialize().
    // (initialize() calls RAPIER.init() internally.)
    const RAPIER = (await import('https://cdn.skypack.dev/@dimforge/rapier3d-compat@0.17.3')).default;
    await Rn.RapierPhysicsStrategy.initialize(RAPIER);

    resizeCanvas();

    window.addEventListener("resize", function(){
        resizeCanvas();
    });

    function resizeCanvas() {
        engine.resizeCanvas(window.innerWidth, window.innerHeight);
    }

    const entities = [];

    const texture = await Rn.Texture.loadFromUrl(engine, '../../../../assets/textures/frog.jpg');

    const sampler = new Rn.Sampler(engine, {
      magFilter: Rn.TextureParameter.Linear,
      minFilter: Rn.TextureParameter.Linear,
      wrapS: Rn.TextureParameter.ClampToEdge,
      wrapT: Rn.TextureParameter.ClampToEdge,
    });

    const material = Rn.MaterialHelper.createClassicUberMaterial(engine);
    material.setTextureParameter('diffuseColorTexture', texture, sampler)

    // Ground
    const entity1 = Rn.MeshHelper.createCube(engine, {
        physics: {
            use: true,
            engine: 'rapier',
            move: false,
            density: 1,
            friction: 0.5,
            restitution: 0.2,
        },
        material: material
    });
    entity1.tryToSetTag({
        tag: "type",
        value: "ground"
    });
    entity1.scale = Rn.Vector3.fromCopyArray([4, 0.1, 4]);
    entities.push(entity1);

    // Cube
    const entity2 = Rn.MeshHelper.createCube(engine, {
        physics: {
            use: true,
            engine: 'rapier',
            move: true,
            density: 1,
            friction: 0.5,
            restitution: 0.2,
        },
        material: material
    });
    entity2.tryToSetTag({
        tag: "type",
        value: "cube"
    });
    entity2.position = Rn.Vector3.fromCopyArray([0, 2, 0]);
    entity2.scale = Rn.Vector3.fromCopyArray([1, 1, 1]);
    entities.push(entity2);
    entityCube = entity2;

    // Collider wireframes (green = static ground, orange = dynamic cube)
    createDebugBox([4, 0.1, 4], [0, 0, 0], DEBUG_COLOR_STATIC);
    cubeDebugEntity = createDebugBox([1, 1, 1], [0, 2, 0], DEBUG_COLOR_DYNAMIC);

    // camera
    const cameraEntity = Rn.createCameraControllerEntity(engine);
    cameraEntity.localPosition = Rn.Vector3.fromCopyArray([0, 3, 6]);
    cameraEntity.localEulerAngles = Rn.Vector3.fromCopyArray([-0.4, 0, 0]);
    const cameraComponent = cameraEntity.getCamera();
    cameraComponent.zNear = 0.1;
    cameraComponent.zFar = 100;
    cameraComponent.setFovyAndChangeFocalLength(45);
    cameraComponent.aspect = window.innerWidth / window.innerHeight;

    // renderPass
    const renderPass = new Rn.RenderPass(engine);
    renderPass.cameraComponent = cameraComponent;
    renderPass.toClearColorBuffer = true;
    renderPass.clearColor = Rn.Vector4.fromCopyArray4([0, 0, 0, 1]);
    renderPass.addEntities(entities);

    // Collider wireframes are drawn in a second pass on top of the model (no depth test)
    // so the whole collider shape is visible, not just its silhouette.
    const debugRenderPass = new Rn.RenderPass(engine);
    debugRenderPass.cameraComponent = cameraComponent;
    debugRenderPass.toClearColorBuffer = false;
    try { debugRenderPass.isDepthTest = false; } catch (e) {}
    debugRenderPass.addEntities(debugEntities);

    // expression
    const expression = new Rn.Expression();
    expression.addRenderPasses([renderPass, debugRenderPass]);

    setWireframeVisible(showWireframe);

    const draw = function(time) {
        // Rhodonite's physics drives the cube's transform; keep its wireframe in sync.
        if (cubeDebugEntity && entityCube) {
            const p = entityCube.getTransform().localPosition;
            const q = entityCube.getTransform().localRotation;
            cubeDebugEntity.getTransform().localPosition = Rn.Vector3.fromCopyArray([p.x, p.y, p.z]);
            cubeDebugEntity.getTransform().localRotation = Rn.Quaternion.fromCopyArray([q.x, q.y, q.z, q.w]);
        }

        engine.process([expression]);

        requestAnimationFrame(draw);
    }

    draw();

}

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
