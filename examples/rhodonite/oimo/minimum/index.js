import Rn from 'rhodonite';

let world;
let groundBody;
let body;

function initOimo() {
    world = new OIMO.World({ 
        timestep: 1/60, 
        iterations: 8, 
        broadphase: 2, // 1 brute force, 2 sweep and prune, 3 volume tree
        worldscale: 1, // scale full world 
        random: true,  // randomize sample
        info: false,   // calculate statistic or not
        gravity: [0,-9.8,0] 
    });

    groundBody = world.add({
        type: "box",
        size: [200, 2, 200],
        pos: [0, 0, 0],
        rot: [0, 0, 0],
        move: false,
        density: 1,
        friction: 0.5,
        restitution: 0.1,
    });
    body = world.add({
        type: "box",
        size: [50, 50, 50],
        pos: [0, 100, 0],
        rot: [10, 0, 10],
        move: true,
        density: 1,
        friction: 0.5,
        restitution: 0.2
    });
}

const load = async function () {
    await Rn.ModuleManager.getInstance().loadModule('webgl');
    await Rn.ModuleManager.getInstance().loadModule('pbr');
    const c = document.getElementById('world');
    const gl = await Rn.System.init({
        approach: Rn.ProcessApproach.DataTexture,
        canvas: c
    });
    
    initOimo();

    resizeCanvas();
    
    window.addEventListener("resize", function(){
        resizeCanvas();
    });
    
    function resizeCanvas() {
        c.width = window.innerWidth;
        c.height = window.innerHeight;
        gl.viewport(0, 0, c.width, c.height);
    }
    
    const entities = [];

    const texture = new Rn.Texture();
    texture.generateTextureFromUri('../../../../assets/textures/frog.jpg');

    // Ground
    const entity1 = Rn.MeshHelper.createCube();
    entity1.tryToSetTag({tag:"type", value:"ground"});
    entity1.localScale = Rn.Vector3.fromCopyArray([200/2, 2/2, 200/2]);
    entity1.getMesh().mesh.getPrimitiveAt(0).material.setTextureParameter(Rn.ShaderSemantics.DiffuseColorTexture, texture);
    entities.push(entity1);

    // Cube
    const entity2 = Rn.MeshHelper.createCube();
    entity2.tryToSetTag({tag:"type", value:"cube"});
    entity2.localScale = Rn.Vector3.fromCopyArray([50/2, 50/2, 50/2]);
    entity2.getMesh().mesh.getPrimitiveAt(0).material.setTextureParameter(Rn.ShaderSemantics.DiffuseColorTexture, texture);
    entities.push(entity2);

    const startTime = Date.now();
   
    // camera
    const cameraEntity = Rn.EntityHelper.createCameraControllerEntity();
    cameraEntity.localPosition = Rn.Vector3.fromCopyArray([0, 50, 200]);
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
    
    function updatePhysics() {
        world.step();
        let p = body.getPosition();
        let q = body.getQuaternion();

        entities.forEach(function (entity) {
            if ( entity.getTagValue("type") == "cube" ) {
                entity.localPosition = Rn.Vector3.fromCopyArray([p.x, p.y, p.z]);
                entity.localRotation = Rn.Vector4.fromCopyArray4([q.x, q.y, q.z, q.w]);
            }
        });
    }

    const draw = function(time) {
        updatePhysics();

        Rn.System.process([expression]);
        
        requestAnimationFrame(draw);
    }

    draw();

}

document.body.onload = load;
