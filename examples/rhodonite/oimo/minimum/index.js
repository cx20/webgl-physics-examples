import Rn from 'rhodonite';

const PHYSICS_SCALE = 1/10;

let engine;

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
    entity1.scale = Rn.Vector3.fromCopyArray([200 / 2 * PHYSICS_SCALE, 2 / 2 * PHYSICS_SCALE, 200 / 2 * PHYSICS_SCALE]);
    entities.push(entity1);

    // Cube
    const entity2 = Rn.MeshHelper.createCube(engine, {
        physics: {
            use: true,
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
    entity2.position = Rn.Vector3.fromCopyArray([0, 100 * PHYSICS_SCALE, 0]);
    entity2.scale = Rn.Vector3.fromCopyArray([50 / 2 * PHYSICS_SCALE, 50 / 2 * PHYSICS_SCALE, 50 / 2 * PHYSICS_SCALE]);
    entities.push(entity2);

    const startTime = Date.now();

    // camera
    const cameraEntity = Rn.createCameraControllerEntity(engine);
    cameraEntity.localPosition = Rn.Vector3.fromCopyArray([0 * PHYSICS_SCALE, 50 * PHYSICS_SCALE, 200 * PHYSICS_SCALE]);
    const cameraComponent = cameraEntity.getCamera();
    cameraComponent.zNear = 0.1;
    cameraComponent.zFar = 1000;
    cameraComponent.setFovyAndChangeFocalLength(45);
    cameraComponent.aspect = window.innerWidth / window.innerHeight;

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

document.body.onload = load;
