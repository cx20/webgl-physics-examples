import Rn from 'rhodonite';

const PHYSICS_SCALE = 1/10;

const load = async function() {
    await Rn.ModuleManager.getInstance().loadModule('webgl');
    await Rn.ModuleManager.getInstance().loadModule('pbr');
    const c = document.getElementById('world');

    await Rn.System.init({
      approach: Rn.ProcessApproach.DataTexture,
      canvas: c,
    });

    resizeCanvas();
    
    window.addEventListener("resize", function(){
        resizeCanvas();
    });

    function resizeCanvas() {
        Rn.System.resizeCanvas(window.innerWidth, window.innerHeight);
    }
    
    const entities = [];

    const texture = new Rn.Texture();
    texture.generateTextureFromUri('../../../../assets/textures/frog.jpg');

    const sampler = new Rn.Sampler({
      magFilter: Rn.TextureParameter.Linear,
      minFilter: Rn.TextureParameter.Linear,
      wrapS: Rn.TextureParameter.ClampToEdge,
      wrapT: Rn.TextureParameter.ClampToEdge,
    });
    sampler.create();
    
    // Ground
    const entity1 = Rn.MeshHelper.createCube({
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
    entity1.scale = Rn.Vector3.fromCopyArray([200 / 2 * PHYSICS_SCALE, 2 / 2 * PHYSICS_SCALE, 200 / 2 * PHYSICS_SCALE]);
    entity1.getMesh().mesh.getPrimitiveAt(0).material.setTextureParameter(Rn.ShaderSemantics.DiffuseColorTexture, texture, sampler);
    entities.push(entity1);

    // Cube
    const entity2 = Rn.MeshHelper.createCube({
        physics: {
            use: true,
            move: true,
            density: 1,
            friction: 0.5,
            restitution: 0.2,
        },
    });
    entity2.tryToSetTag({
        tag: "type",
        value: "cube"
    });
    entity2.position = Rn.Vector3.fromCopyArray([0, 100 * PHYSICS_SCALE, 0]);
    entity2.scale = Rn.Vector3.fromCopyArray([50 / 2 * PHYSICS_SCALE, 50 / 2 * PHYSICS_SCALE, 50 / 2 * PHYSICS_SCALE]);
    entity2.getMesh().mesh.getPrimitiveAt(0).material.setTextureParameter(Rn.ShaderSemantics.DiffuseColorTexture, texture, sampler);
    entities.push(entity2);

    const startTime = Date.now();

    // camera
    const cameraEntity = Rn.EntityHelper.createCameraControllerEntity();
    cameraEntity.localPosition = Rn.Vector3.fromCopyArray([0 * PHYSICS_SCALE, 50 * PHYSICS_SCALE, 200 * PHYSICS_SCALE]);
    const cameraComponent = cameraEntity.getCamera();
    cameraComponent.zNear = 0.1;
    cameraComponent.zFar = 1000;
    cameraComponent.setFovyAndChangeFocalLength(45);
    cameraComponent.aspect = window.innerWidth / window.innerHeight;

    // renderPass
    const renderPass = new Rn.RenderPass();
    renderPass.cameraComponent = cameraComponent;
    renderPass.toClearColorBuffer = true;
    renderPass.clearColor = Rn.Vector4.fromCopyArray4([0, 0, 0, 1]);
    renderPass.addEntities(entities);

    // expression
    const expression = new Rn.Expression();
    expression.addRenderPasses([renderPass]);

    const draw = function(time) {
        Rn.System.process([expression]);

        requestAnimationFrame(draw);
    }

    draw();

}

document.body.onload = load;