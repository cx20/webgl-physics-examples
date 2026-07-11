import Rn from 'rhodonite';

let entities = [];
const PHYSICS_SCALE = 1/10;
const DOT_SIZE = 8;
let engine;

let showWireframe = true;
const debugEntities = [];
const dynamicEntities = [];
const dynamicDebugEntities = [];
const DEBUG_COLOR_DYNAMIC = [1.0, 0.5, 0.2, 1.0];
const DEBUG_COLOR_STATIC  = [0.2, 1.0, 0.4, 1.0];

// ‥‥‥‥‥‥‥‥‥‥‥‥‥□□□
// ‥‥‥‥‥‥〓〓〓〓〓‥‥□□□
// ‥‥‥‥‥〓〓〓〓〓〓〓〓〓□□
// ‥‥‥‥‥■■■□□■□‥■■■
// ‥‥‥‥■□■□□□■□□■■■
// ‥‥‥‥■□■■□□□■□□□■
// ‥‥‥‥■■□□□□■■■■■‥
// ‥‥‥‥‥‥□□□□□□□■‥‥
// ‥‥■■■■■〓■■■〓■‥‥‥
// ‥■■■■■■■〓■■■〓‥‥■
// □□■■■■■■〓〓〓〓〓‥‥■
// □□□‥〓〓■〓〓□〓〓□〓■■
// ‥□‥■〓〓〓〓〓〓〓〓〓〓■■
// ‥‥■■■〓〓〓〓〓〓〓〓〓■■
// ‥■■■〓〓〓〓〓〓〓‥‥‥‥‥
// ‥■‥‥〓〓〓〓‥‥‥‥‥‥‥‥
let dataSet = [
    "無","無","無","無","無","無","無","無","無","無","無","無","無","肌","肌","肌",
    "無","無","無","無","無","無","赤","赤","赤","赤","赤","無","無","肌","肌","肌",
    "無","無","無","無","無","赤","赤","赤","赤","赤","赤","赤","赤","赤","肌","肌",
    "無","無","無","無","無","茶","茶","茶","肌","肌","茶","肌","無","赤","赤","赤",
    "無","無","無","無","茶","肌","茶","肌","肌","肌","茶","肌","肌","赤","赤","赤",
    "無","無","無","無","茶","肌","茶","茶","肌","肌","肌","茶","肌","肌","肌","赤",
    "無","無","無","無","茶","茶","肌","肌","肌","肌","茶","茶","茶","茶","赤","無",
    "無","無","無","無","無","無","肌","肌","肌","肌","肌","肌","肌","赤","無","無",
    "無","無","赤","赤","赤","赤","赤","青","赤","赤","赤","青","赤","無","無","無",
    "無","赤","赤","赤","赤","赤","赤","赤","青","赤","赤","赤","青","無","無","茶",
    "肌","肌","赤","赤","赤","赤","赤","赤","青","青","青","青","青","無","無","茶",
    "肌","肌","肌","無","青","青","赤","青","青","黄","青","青","黄","青","茶","茶",
    "無","肌","無","茶","青","青","青","青","青","青","青","青","青","青","茶","茶",
    "無","無","茶","茶","茶","青","青","青","青","青","青","青","青","青","茶","茶",
    "無","茶","茶","茶","青","青","青","青","青","青","青","無","無","無","無","無",
    "無","茶","無","無","青","青","青","青","無","無","無","無","無","無","無","無"
];

const colorHash = {
    "無": [0xDC/0xff, 0xAA/0xff, 0x6B/0xff],
    "白": [1, 1, 1],
    "肌": [1, 0xcc/0xff, 0xcc/0xff],
    "茶": [0x80/0xff, 0, 0],
    "赤": [1, 0, 0],
    "黄": [1, 1, 0],
    "緑": [0, 1, 0],
    "水": [0, 1, 1],
    "青": [0, 0, 1],
    "紫": [0x80/0xff, 0, 0x80/0xff]
};

function makeDebugMaterial(color) {
  const mat = Rn.MaterialHelper.createPbrUberMaterial(engine, { isLighting: false, isSkinning: false, isMorphing: false });
  try { mat.addShaderDefine('RN_USE_WIREFRAME'); } catch (e) {}
  try { mat.setParameter('wireframe', Rn.Vector3.fromCopy3(1, 0, 1)); } catch (e) {}
  try { mat.setParameter('baseColorFactor', Rn.Vector4.fromCopyArray4(color)); } catch (e) {}
  return mat;
}

function createStaticDebugBox(scale, pos) {
  const entity = Rn.MeshHelper.createCube(engine, { material: makeDebugMaterial(DEBUG_COLOR_STATIC) });
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

    const texture = await Rn.Texture.loadFromUrl(engine, '../../../../assets/textures/grass.jpg');

    const sampler = new Rn.Sampler(engine, {
      magFilter: Rn.TextureParameter.Linear,
      minFilter: Rn.TextureParameter.Linear,
      wrapS: Rn.TextureParameter.ClampToEdge,
      wrapT: Rn.TextureParameter.ClampToEdge,
    });

    const entity1 = Rn.MeshHelper.createCube(engine, {
        physics: {
            use: true,
            engine: 'rapier',
            move: false,
            density: 1,
            friction: 0.5,
            restitution: 0.2,
        },
    });
    entity1.tryToSetTag({
        tag: "type",
        value: "ground"
    });
    entity1.scale = Rn.Vector3.fromCopyArray([200 * PHYSICS_SCALE, 2 * PHYSICS_SCALE, 200 * PHYSICS_SCALE]);
    entity1.getMesh().mesh.getPrimitiveAt(0).material.setTextureParameter('diffuseColorTexture', texture, sampler);
    entities.push(entity1);
    createStaticDebugBox(
        [200 * PHYSICS_SCALE, 2 * PHYSICS_SCALE, 200 * PHYSICS_SCALE],
        [0, 0, 0]
    );

    // Pre-build one material per unique color key
    const matByKey = {};
    for (const [key, rgb] of Object.entries(colorHash)) {
        const mat = Rn.MaterialHelper.createPbrUberMaterial(engine, { isLighting: true });
        mat.setParameter('baseColorFactor', Rn.Vector4.fromCopyArray4([rgb[0], rgb[1], rgb[2], 1]));
        mat.setTextureParameter('diffuseColorTexture', texture, sampler);
        matByKey[key] = mat;
    }
    const ballMat = Rn.MaterialHelper.createPbrUberMaterial(engine, { isLighting: true });
    ballMat.setParameter('baseColorFactor', Rn.Vector4.fromCopyArray4([1, 0, 0, 1]));
    ballMat.setTextureParameter('diffuseColorTexture', texture, sampler);

    // Shared wireframe mesh for dynamic box colliders (unit cube, scaled per entity)
    const cubeWireHelper = Rn.MeshHelper.createCube(engine, {
        material: makeDebugMaterial(DEBUG_COLOR_DYNAMIC),
    });
    try { cubeWireHelper.getSceneGraph().isVisible = false; } catch (e) {}
    const cubeWireMesh = cubeWireHelper.getMesh().mesh;
    try {
        for (const prim of cubeWireMesh.primitives) prim.convertToUnindexedGeometry();
        cubeWireMesh._calcBaryCentricCoord();
    } catch (e) { console.warn('[Domino] baryCentric failed:', e); }

    populate(matByKey, ballMat, cubeWireMesh);

    // camera
    const cameraEntity = Rn.createCameraControllerEntity(engine);
    cameraEntity.localPosition = Rn.Vector3.fromCopyArray([0 * PHYSICS_SCALE, 60.0 * PHYSICS_SCALE, 120 * PHYSICS_SCALE]);
    cameraEntity.localEulerAngles = Rn.Vector3.fromCopyArray([-0.5, 0.0, 0.0]);
    const cameraComponent = cameraEntity.getCamera();
    cameraComponent.zNear = 0.1;
    cameraComponent.zFar = 300;
    cameraComponent.setFovyAndChangeFocalLength(45);
    cameraComponent.aspect = window.innerWidth / window.innerHeight;

    // Lights
    const lightEntity1 = Rn.createLightEntity(engine);
    const lightComponent1 = lightEntity1.getLight();
    lightComponent1.type = Rn.LightType.Directional;
    lightEntity1.localEulerAngles = Rn.Vector3.fromCopyArray([-Math.PI / 2, -Math.PI / 4, Math.PI / 4]);

    const lightEntity2 = Rn.createLightEntity(engine);
    const lightComponent2 = lightEntity2.getLight();
    lightComponent2.type = Rn.LightType.Directional;
    lightEntity2.localEulerAngles = Rn.Vector3.fromCopyArray([Math.PI / 2, Math.PI / 4, -Math.PI / 4]);

    // renderPass
    const renderPass = new Rn.RenderPass(engine);
    renderPass.cameraComponent = cameraComponent;
    renderPass.toClearColorBuffer = true;
    renderPass.clearColor = Rn.Vector4.fromCopyArray4([0, 0, 0, 1]);
    renderPass.addEntities(entities);

    // Collider wireframes drawn in a second pass on top (no depth test)
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
        // Sync dynamic box collider wireframes to physics-driven transforms
        for (let i = 0; i < dynamicEntities.length; i++) {
            const t = dynamicEntities[i].getTransform();
            const dt = dynamicDebugEntities[i].getTransform();
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

function populate(matByKey, ballMat, cubeWireMesh) {
    const w = DOT_SIZE * 0.2;
    const h = DOT_SIZE * 1.5;
    const d = DOT_SIZE;

    for (let z = 0; z < 16; z++) {
        for (let x = 0; x < 16; x++) {
            const i = x + z * 16;
            const colorKey = dataSet[i];
            const y = 1;

            const entity = Rn.MeshHelper.createCube(engine, {
                physics: {
                    use: true,
                    engine: 'rapier',
                    move: true,
                    density: 1,
                    friction: 0.5,
                    restitution: 0.2,
                },
                material: matByKey[colorKey]
            });
            entity.tryToSetTag({
                tag: "type",
                value: "domino"
            });
            entity.position = Rn.Vector3.fromCopyArray([(-8 + x) * DOT_SIZE * PHYSICS_SCALE, y * DOT_SIZE * PHYSICS_SCALE, (-8 + z) * DOT_SIZE * 1.2 * PHYSICS_SCALE]);
            entity.scale = Rn.Vector3.fromCopyArray([w * PHYSICS_SCALE, h * PHYSICS_SCALE, d * PHYSICS_SCALE]);
            entities.push(entity);

            const debugEntity = Rn.createMeshEntity(engine);
            debugEntity.getMesh().setMesh(cubeWireMesh);
            debugEntity.getTransform().localScale = Rn.Vector3.fromCopyArray([w * PHYSICS_SCALE, h * PHYSICS_SCALE, d * PHYSICS_SCALE]);
            const p0 = entity.getTransform().localPosition;
            debugEntity.getTransform().localPosition = Rn.Vector3.fromCopyArray([p0.x, p0.y, p0.z]);
            debugEntities.push(debugEntity);
            dynamicEntities.push(entity);
            dynamicDebugEntities.push(debugEntity);
        }
    }

    for (let i = 0; i < 16; i++) {
        const bw = DOT_SIZE;
        const bh = DOT_SIZE;
        const bd = DOT_SIZE;
        const x = 0;
        const y = 2;
        const z = i;

        const entity = Rn.MeshHelper.createCube(engine, {
            physics: {
                use: true,
                engine: 'rapier',
                move: true,
                density: 1,
                friction: 0.5,
                restitution: 0.2,
            },
            material: ballMat
        });
        entity.tryToSetTag({
            tag: "type",
            value: "cube"
        });
        entity.position = Rn.Vector3.fromCopyArray([(-8.4 + x) * DOT_SIZE * PHYSICS_SCALE, y * DOT_SIZE * PHYSICS_SCALE, (-8 + z) * DOT_SIZE * 1.2 * PHYSICS_SCALE]);
        entity.scale = Rn.Vector3.fromCopyArray([bw * PHYSICS_SCALE, bh * PHYSICS_SCALE, bd * PHYSICS_SCALE]);
        entities.push(entity);

        const debugEntity = Rn.createMeshEntity(engine);
        debugEntity.getMesh().setMesh(cubeWireMesh);
        debugEntity.getTransform().localScale = Rn.Vector3.fromCopyArray([bw * PHYSICS_SCALE, bh * PHYSICS_SCALE, bd * PHYSICS_SCALE]);
        const p0 = entity.getTransform().localPosition;
        debugEntity.getTransform().localPosition = Rn.Vector3.fromCopyArray([p0.x, p0.y, p0.z]);
        debugEntities.push(debugEntity);
        dynamicEntities.push(entity);
        dynamicDebugEntities.push(debugEntity);
    }
}

document.body.onload = load;
