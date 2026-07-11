import Rn from 'rhodonite';

let entities = [];
const PHYSICS_SCALE = 1/10;
let engine;

let showWireframe = true;
const debugEntities = [];        // all collider wireframes (W toggles visibility)
const ballEntities = [];         // physics-driven ball entities
const ballDebugEntities = [];    // per-ball wireframes, parallel to ballEntities
const DEBUG_COLOR_DYNAMIC = [1.0, 0.5, 0.2, 1.0];
const DEBUG_COLOR_STATIC = [0.2, 1.0, 0.4, 1.0];

// Mirror the Rhodonite + Havok balls sample: PbrUber + RN_USE_WIREFRAME with
// barycentric coords so the wireframe shader can draw the collider edges.
function makeDebugMaterial(color) {
  const mat = Rn.MaterialHelper.createPbrUberMaterial(engine, { isLighting: false, isSkinning: false, isMorphing: false });
  try { mat.addShaderDefine('RN_USE_WIREFRAME'); } catch (e) {}
  try { mat.setParameter('wireframe', Rn.Vector3.fromCopy3(1, 0, 1)); } catch (e) {}
  try { mat.setParameter('baseColorFactor', Rn.Vector4.fromCopyArray4(color)); } catch (e) {}
  return mat;
}

// Static box collider wireframe (full size), placed at a fixed transform.
function createDebugBox(scale, pos, color) {
  const entity = Rn.MeshHelper.createCube(engine, { material: makeDebugMaterial(color) });
  entity.getTransform().localScale = Rn.Vector3.fromCopyArray([scale[0], scale[1], scale[2]]);
  entity.getTransform().localPosition = Rn.Vector3.fromCopyArray([pos[0], pos[1], pos[2]]);
  try { entity.getMesh().calcBaryCentricCoord(); } catch (e) {}
  debugEntities.push(entity);
  return entity;
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

const dataSet = [
    {imageFile:"../../../../assets/textures/Basketball.jpg", scale:1.0},
    {imageFile:"../../../../assets/textures/BeachBall.jpg",  scale:0.9},
    {imageFile:"../../../../assets/textures/Football.jpg",   scale:1.0},
    {imageFile:"../../../../assets/textures/Softball.jpg",   scale:0.3},
    {imageFile:"../../../../assets/textures/TennisBall.jpg", scale:0.3},
];

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

    const textures = await Promise.all(dataSet.map(d => Rn.Texture.loadFromUrl(engine, d.imageFile)));

    const sampler = new Rn.Sampler(engine, {
      magFilter: Rn.TextureParameter.Linear,
      minFilter: Rn.TextureParameter.Linear,
      wrapS: Rn.TextureParameter.Repeat,
      wrapT: Rn.TextureParameter.Repeat,
    });

    const materialGround = Rn.MaterialHelper.createPbrUberMaterial(engine, {
        isLighting: true
    });
    materialGround.setParameter('baseColorFactor', Rn.Vector4.fromCopyArray4([0x3D/0xFF, 0x41/0xFF, 0x43/0xFF, 1]));

    const materialGroundTrans = Rn.MaterialHelper.createPbrUberMaterial(engine, {
        isLighting: true
    });
    materialGroundTrans.setParameter('baseColorFactor', Rn.Vector4.fromCopyArray4([0x3D/0xFF, 0x41/0xFF, 0x43/0xFF, 0.6]));
    materialGroundTrans.alphaMode = Rn.AlphaMode.Blend;

    // Ground
    const entity1 = Rn.MeshHelper.createCube(engine, {
        physics: {
            use: true,
            engine: 'rapier',
            move: false,
            density: 1,
            friction: 0.6,
            restitution: 0.5,
        },
        material: materialGround
    });
    entity1.tryToSetTag({
        tag: "type",
        value: "ground"
    });
    entity1.scale = Rn.Vector3.fromCopyArray([200 * PHYSICS_SCALE, 20 * PHYSICS_SCALE, 200 * PHYSICS_SCALE]);
    entity1.position = Rn.Vector3.fromCopyArray([0, -20 * PHYSICS_SCALE, 0]);
    entities.push(entity1);
    createDebugBox([200 * PHYSICS_SCALE, 20 * PHYSICS_SCALE, 200 * PHYSICS_SCALE], [0, -20 * PHYSICS_SCALE, 0], DEBUG_COLOR_STATIC);

    // Box walls (shared transparent material)
    const boxDataSet = [
        { size:[48, 50,  4], pos:[ 0, 15,-25] },
        { size:[48, 50,  4], pos:[ 0, 15, 25] },
        { size:[ 4, 50, 48], pos:[-25, 15, 0] },
        { size:[ 4, 50, 48], pos:[ 25, 15, 0] }
    ];

    for (let i = 0; i < boxDataSet.length; i++) {
        const size = boxDataSet[i].size;
        const pos = boxDataSet[i].pos;

        const wallEntity = Rn.MeshHelper.createCube(engine, {
            physics: {
                use: true,
                engine: 'rapier',
                move: false,
                density: 1,
                friction: 0.6,
                restitution: 0.5,
            },
            material: materialGroundTrans
        });
        wallEntity.tryToSetTag({
            tag: "type",
            value: "wall"
        });
        wallEntity.scale = Rn.Vector3.fromCopyArray([size[0] * PHYSICS_SCALE, size[1] * PHYSICS_SCALE, size[2] * PHYSICS_SCALE]);
        wallEntity.position = Rn.Vector3.fromCopyArray([pos[0] * PHYSICS_SCALE, pos[1] * PHYSICS_SCALE, pos[2] * PHYSICS_SCALE]);
        entities.push(wallEntity);
        createDebugBox(
            [size[0] * PHYSICS_SCALE, size[1] * PHYSICS_SCALE, size[2] * PHYSICS_SCALE],
            [pos[0] * PHYSICS_SCALE, pos[1] * PHYSICS_SCALE, pos[2] * PHYSICS_SCALE],
            DEBUG_COLOR_STATIC
        );
    }

    // Pre-build one material per ball type
    const materials = dataSet.map((d, idx) => {
        const mat = Rn.MaterialHelper.createPbrUberMaterial(engine, { isLighting: true });
        mat.setTextureParameter('baseColorTexture', textures[idx], sampler);
        return mat;
    });

    // Shared ball collider wireframe (unit-radius sphere reused by every ball, scaled per
    // entity by its radius). The wireframe shader needs un-indexed geometry + barycentric coords.
    const ballWireHelper = Rn.MeshHelper.createSphere(engine, {
        radius: 1,
        widthSegments: 12,
        heightSegments: 8,
        material: makeDebugMaterial(DEBUG_COLOR_DYNAMIC),
    });
    try { ballWireHelper.getSceneGraph().isVisible = false; } catch (e) {}
    const ballWireMesh = ballWireHelper.getMesh().mesh;
    try {
        for (const prim of ballWireMesh.primitives) prim.convertToUnindexedGeometry();
        ballWireMesh._calcBaryCentricCoord();
    } catch (e) { console.warn('[Balls] baryCentric failed:', e); }

    populate(materials, ballWireMesh);

    // camera
    const cameraEntity = Rn.createCameraControllerEntity(engine);
    cameraEntity.localPosition = Rn.Vector3.fromCopyArray([0 * PHYSICS_SCALE, 100 * PHYSICS_SCALE, 160 * PHYSICS_SCALE]);
    cameraEntity.localEulerAngles = Rn.Vector3.fromCopyArray([-0.1, 0.0, 0.0]);
    const cameraComponent = cameraEntity.getCamera();
    cameraComponent.zNear = 0.1;
    cameraComponent.zFar = 400;
    cameraComponent.setFovyAndChangeFocalLength(60);
    cameraComponent.aspect = window.innerWidth / window.innerHeight;

    // Lights
    const lightEntity1 = Rn.createLightEntity(engine);
    const lightComponent1 = lightEntity1.getLight();
    lightComponent1.type = Rn.LightType.Directional;
    lightComponent1.intensity = 1.5;
    lightEntity1.localEulerAngles = Rn.Vector3.fromCopyArray([-Math.PI / 4, Math.PI / 6, 0]);

    const lightEntity2 = Rn.createLightEntity(engine);
    const lightComponent2 = lightEntity2.getLight();
    lightComponent2.type = Rn.LightType.Directional;
    lightComponent2.intensity = 0.8;
    lightEntity2.localEulerAngles = Rn.Vector3.fromCopyArray([Math.PI / 4, -Math.PI / 6, 0]);

    // renderPass
    const renderPass = new Rn.RenderPass(engine);
    renderPass.cameraComponent = cameraComponent;
    renderPass.toClearColorBuffer = true;
    renderPass.clearColor = Rn.Vector4.fromCopyArray4([0, 0, 0, 1]);
    renderPass.addEntities(entities);

    // Collider wireframes are drawn in a second pass on top of the model (no depth test).
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
        // Sync per-ball collider wireframes to the physics-driven ball transforms.
        for (let i = 0; i < ballEntities.length; i++) {
            const t = ballEntities[i].getTransform();
            const dt = ballDebugEntities[i].getTransform();
            const p = t.localPosition;
            const q = t.localRotation;
            dt.localPosition = Rn.Vector3.fromCopyArray([p.x, p.y, p.z]);
            dt.localRotation = Rn.Quaternion.fromCopyArray([q.x, q.y, q.z, q.w]);
        }
        engine.process([expression]);
        requestAnimationFrame(draw);
    }

    draw();

}

function populate(materials, ballWireMesh) {
    const max = 200;

    for (let i = 0; i < max; i++) {
        const x = -25 + Math.random() * 50;
        const y = 60 + Math.random() * 130;
        const z = -25 + Math.random() * 50;
        const w = 10 + Math.random() * 5;

        const pos = Math.floor(Math.random() * dataSet.length);
        const scale = dataSet[pos].scale;
        const radius = (w * scale) / 2;

        const entity = Rn.MeshHelper.createSphere(engine, {
            radius: radius * PHYSICS_SCALE,
            widthSegments: 20,
            heightSegments: 10,
            physics: {
                use: true,
                engine: 'rapier',
                move: true,
                density: 1,
                friction: 0.4,
                restitution: 0.6,
            },
            material: materials[pos]
        });
        entity.tryToSetTag({
            tag: "type",
            value: "ball"
        });
        entity.position = Rn.Vector3.fromCopyArray([x * PHYSICS_SCALE, y * PHYSICS_SCALE, z * PHYSICS_SCALE]);
        entities.push(entity);
        ballEntities.push(entity);

        const debugEntity = Rn.createMeshEntity(engine);
        debugEntity.getMesh().setMesh(ballWireMesh);
        const r = radius * PHYSICS_SCALE;
        debugEntity.getTransform().localScale = Rn.Vector3.fromCopyArray([r, r, r]);
        debugEntity.getTransform().localPosition = Rn.Vector3.fromCopyArray([x * PHYSICS_SCALE, y * PHYSICS_SCALE, z * PHYSICS_SCALE]);
        debugEntities.push(debugEntity);
        ballDebugEntities.push(debugEntity);
    }
}

document.body.onload = load;
