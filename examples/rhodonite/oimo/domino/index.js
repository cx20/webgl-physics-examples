import Rn from 'rhodonite';

let entities = [];
const PHYSICS_SCALE = 1/10;
const DOT_SIZE = 8;
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

function getRgbColor( c )
{
    let colorHash = {
        "無":{r:0xDC,g:0xAA,b:0x6B},
        "白":{r:0xff,g:0xff,b:0xff},
        "肌":{r:0xff,g:0xcc,b:0xcc},
        "茶":{r:0x80,g:0x00,b:0x00},
        "赤":{r:0xff,g:0x00,b:0x00},
        "黄":{r:0xff,g:0xff,b:0x00},
        "緑":{r:0x00,g:0xff,b:0x00},
        "水":{r:0x00,g:0xff,b:0xff},
        "青":{r:0x00,g:0x00,b:0xff},
        "紫":{r:0x80,g:0x00,b:0x80}
    };
    return colorHash[ c ];
}

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

    populate(texture, sampler);

    const startTime = Date.now();

    // camera
    const cameraEntity = Rn.createCameraControllerEntity(engine);
    cameraEntity.localPosition = Rn.Vector3.fromCopyArray([0 * PHYSICS_SCALE, 100.0 * PHYSICS_SCALE, 200 * PHYSICS_SCALE]);
    cameraEntity.localEulerAngles = Rn.Vector3.fromCopyArray([-0.5, 0.0, 0.0]);
    const cameraComponent = cameraEntity.getCamera();
    cameraComponent.zNear = 0.1;
    cameraComponent.zFar = 1000;
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

    // expression
    const expression = new Rn.Expression();
    expression.addRenderPasses([renderPass]);

    const draw = function(time) {
        engine.process([expression]);

        requestAnimationFrame(draw);
    }

    draw();

}

function populate(texture, sampler) {
    let max = 256;
    let w = DOT_SIZE * 0.2;
    let h = DOT_SIZE * 1.5;
    let d = DOT_SIZE;

    let i;
    let x, y, z;
    for (z = 0; z < 16; z++) {
        for (x = 0; x < 16; x++) {
            i = x + (z) * 16;
            let c = getRgbColor(dataSet[i]);
            y = 1;

            let modelMaterial = Rn.MaterialHelper.createPbrUberMaterial(engine, {
                isLighting: true
            });
            modelMaterial.setParameter(
                'baseColorFactor',
                Rn.Vector4.fromCopyArray4([c.r / 0xff, c.g / 0xff, c.b / 0xff, 1])
            );

            const entity = Rn.MeshHelper.createCube(engine, {
                physics: {
                    use: true,
                    move: true,
                    density: 1,
                    friction: 0.5,
                    restitution: 0.2,
                },
                material: modelMaterial
            });
            entity.tryToSetTag({
                tag: "type",
                value: "domino"
            });
            entity.position = Rn.Vector3.fromCopyArray([(-8 + x) * DOT_SIZE * PHYSICS_SCALE, y * DOT_SIZE * PHYSICS_SCALE, (-8 + z) * DOT_SIZE * 1.2 * PHYSICS_SCALE]);
            entity.scale = Rn.Vector3.fromCopyArray([w * PHYSICS_SCALE, h * PHYSICS_SCALE, d * PHYSICS_SCALE]);
            entity.getMesh().mesh.getPrimitiveAt(0).material.setTextureParameter('diffuseColorTexture', texture, sampler);
            entities.push(entity);

        }
    }

    for (i = 0; i < 16; i++) {
        w = DOT_SIZE;
        h = DOT_SIZE;
        d = DOT_SIZE;
        x = 0;
        y = 2;
        z = i;
        let modelMaterial = Rn.MaterialHelper.createPbrUberMaterial(engine, {
            isLighting: true
        });
        modelMaterial.setParameter(
            'baseColorFactor',
            Rn.Vector4.fromCopyArray4([1, 0, 0, 1])
        );

 		const entity = Rn.MeshHelper.createCube(engine, {
            physics: {
                use: true,
                move: true,
                density: 1,
                friction: 0.5,
                restitution: 0.2,
            },
            material: modelMaterial
        });
        entity.tryToSetTag({
            tag: "type",
            value: "cube"
        });
        entity.position = Rn.Vector3.fromCopyArray([(-8.4 + x) * DOT_SIZE * PHYSICS_SCALE, y * DOT_SIZE * PHYSICS_SCALE, (-8 + z) * DOT_SIZE * 1.2 * PHYSICS_SCALE]);
        entity.scale = Rn.Vector3.fromCopyArray([w * PHYSICS_SCALE, h * PHYSICS_SCALE, d * PHYSICS_SCALE]);
        entity.getMesh().mesh.getPrimitiveAt(0).material.setTextureParameter('diffuseColorTexture', texture, sampler);
        entities.push(entity);

    }
}

document.body.onload = load;