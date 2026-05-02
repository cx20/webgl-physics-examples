import Rn from 'rhodonite';

let entities = [];
const PHYSICS_SCALE = 1/10;
const BALL_SIZE = 15;
let engine;

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
    "無": [0xDC/0xFF, 0xAA/0xFF, 0x6B/0xFF],
    "白": [1, 1, 1],
    "肌": [0xff/0xFF, 0xcc/0xFF, 0xcc/0xFF],
    "茶": [0x80/0xFF, 0, 0],
    "赤": [1, 0, 0],
    "黄": [1, 1, 0],
    "緑": [0, 1, 0],
    "水": [0, 1, 1],
    "青": [0, 0, 1],
    "紫": [0x80/0xFF, 0, 0x80/0xFF]
};

const load = async function() {
    const c = document.getElementById('world');

    engine = await Rn.Engine.init({
      approach: Rn.ProcessApproach.DataTexture,
      canvas: c,
    });

    resizeCanvas();

    window.addEventListener("resize", function(){
        resizeCanvas();
    });

    function resizeCanvas() {
        engine.resizeCanvas(window.innerWidth, window.innerHeight);
    }

    const grassTexture = await Rn.Texture.loadFromUrl(engine, '../../../../assets/textures/grass.jpg');
    const footballTexture = await Rn.Texture.loadFromUrl(engine, '../../../../assets/textures/football.png');

    const sampler = new Rn.Sampler(engine, {
      magFilter: Rn.TextureParameter.Linear,
      minFilter: Rn.TextureParameter.Linear,
      wrapS: Rn.TextureParameter.Repeat,
      wrapT: Rn.TextureParameter.Repeat,
    });

    const entity1 = Rn.MeshHelper.createCube(engine, {
        physics: {
            use: true,
            move: false,
            density: 1,
            friction: 1.0,
            restitution: 1.0,
        },
    });
    entity1.tryToSetTag({
        tag: "type",
        value: "ground"
    });
    entity1.scale = Rn.Vector3.fromCopyArray([200 * PHYSICS_SCALE, 0.4 * PHYSICS_SCALE, 200 * PHYSICS_SCALE]);
    entity1.position = Rn.Vector3.fromCopyArray([0, -20 * PHYSICS_SCALE, 0]);
    entity1.getMesh().mesh.getPrimitiveAt(0).material.setTextureParameter('diffuseColorTexture', grassTexture, sampler);
    entities.push(entity1);

    // Pre-build one material per unique color key (color factor + football texture)
    const matByKey = {};
    for (const [key, rgb] of Object.entries(colorHash)) {
        const mat = Rn.MaterialHelper.createPbrUberMaterial(engine, { isLighting: true });
        mat.setParameter('baseColorFactor', Rn.Vector4.fromCopyArray4([rgb[0], rgb[1], rgb[2], 1]));
        mat.setTextureParameter('baseColorTexture', footballTexture, sampler);
        matByKey[key] = mat;
    }

    populate(matByKey);

    // camera
    const cameraEntity = Rn.createCameraControllerEntity(engine);
    cameraEntity.localPosition = Rn.Vector3.fromCopyArray([0 * PHYSICS_SCALE, 60.0 * PHYSICS_SCALE, 240 * PHYSICS_SCALE]);
    cameraEntity.localEulerAngles = Rn.Vector3.fromCopyArray([0.0, 0.0, 0.0]);
    const cameraComponent = cameraEntity.getCamera();
    cameraComponent.zNear = 0.1;
    cameraComponent.zFar = 400;
    cameraComponent.setFovyAndChangeFocalLength(45);
    cameraComponent.aspect = window.innerWidth / window.innerHeight;

    // Lights
    const lightEntity1 = Rn.createLightEntity(engine);
    const lightComponent1 = lightEntity1.getLight();
    lightComponent1.type = Rn.LightType.Directional;
    lightComponent1.intensity = 1.5;
    lightEntity1.localEulerAngles = Rn.Vector3.fromCopyArray([-Math.PI / 2, -Math.PI / 4, Math.PI / 4]);

    const lightEntity2 = Rn.createLightEntity(engine);
    const lightComponent2 = lightEntity2.getLight();
    lightComponent2.type = Rn.LightType.Directional;
    lightComponent2.intensity = 1.5;
    lightEntity2.localEulerAngles = Rn.Vector3.fromCopyArray([Math.PI / 2, Math.PI / 4, -Math.PI / 4]);

    // renderPass
    const renderPass = new Rn.RenderPass(engine);
    renderPass.cameraComponent = cameraComponent;
    renderPass.toClearColorBuffer = true;
    renderPass.clearColor = Rn.Vector4.fromCopyArray4([0, 0, 0, 1]);
    renderPass.addEntities(entities);

    // expression
    const expression = new Rn.Expression();
    expression.addRenderPasses([renderPass]);

    const draw = function(time) {
        engine.process([expression]);
        requestAnimationFrame(draw);
    }

    draw();

}

function populate(matByKey) {
    let i = 0;
    for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
            i = x + (15 - y) * 16;
            const colorKey = dataSet[i];
            const x1 = (-130 + x * BALL_SIZE * 1.2 + Math.random()) * PHYSICS_SCALE;
            const y1 = (30 + y * BALL_SIZE * 1.2) * PHYSICS_SCALE;
            const z1 = (1.0 * Math.random()) * PHYSICS_SCALE;

            const entity = Rn.MeshHelper.createSphere(engine, {
                radius: BALL_SIZE / 2 * PHYSICS_SCALE,
                widthSegments: 16,
                heightSegments: 16,
                physics: {
                    use: true,
                    move: true,
                    density: 1,
                    friction: 0.4,
                    restitution: 0.6,
                },
                material: matByKey[colorKey]
            });
            entity.tryToSetTag({
                tag: "type",
                value: "ball"
            });
            entity.position = Rn.Vector3.fromCopyArray([x1, y1, z1]);
            entities.push(entity);
        }
    }
}

document.body.onload = load;
