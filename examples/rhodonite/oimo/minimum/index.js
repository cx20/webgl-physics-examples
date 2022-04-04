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

function readyCubeVerticesData() {
    let modelMaterial = Rn.MaterialHelper.createClassicUberMaterial();
    const primitive = new Rn.Cube();
    primitive.generate({ widthVector: Rn.Vector3.fromCopy3(0.5, 0.5, 0.5) });

    const texture = new Rn.Texture();
    texture.generateTextureFromUri('../../../../assets/textures/frog.jpg');
    primitive.material.setTextureParameter(Rn.ShaderSemantics.DiffuseColorTexture, texture);

    return primitive;
}

const load = async function () {
    Rn.Config.maxCameraNumber = 20;
    await Rn.ModuleManager.getInstance().loadModule('webgl');
    await Rn.ModuleManager.getInstance().loadModule('pbr');

    initOimo();

    const system = Rn.System.getInstance();
    const c = document.getElementById('world');
    const gl = system.setProcessApproachAndCanvas(Rn.ProcessApproach.FastestWebGL1, c);
    gl.enable(gl.DEPTH_TEST);

    resizeCanvas();
    
    window.addEventListener("resize", function(){
        resizeCanvas();
    });
    
    function resizeCanvas() {
        c.width = window.innerWidth;
        c.height = window.innerHeight;
        gl.viewport(0, 0, c.width, c.height);
    }
    
    const primitive = readyCubeVerticesData();

    const entities = [];
    // Ground
    const mesh1 = new Rn.Mesh();
    mesh1.addPrimitive(primitive);
    const entity1 = Rn.EntityHelper.createMeshEntity();
    entity1.tryToSetTag({tag:"type", value:"ground"});

    entities.push(entity1);
    const meshComponent1 = entity1.getMesh();

    meshComponent1.setMesh(mesh1);
    entity1.scale = Rn.Vector3.fromCopyArray([200, 2, 200]);

    // Cube
    const mesh2 = new Rn.Mesh();
    mesh2.addPrimitive(primitive);
    const entity2 = Rn.EntityHelper.createMeshEntity();
    entity2.tryToSetTag({tag:"type", value:"cube"});

    entities.push(entity2);
    const meshComponent2 = entity2.getMesh();

    meshComponent2.setMesh(mesh2);
    entity2.scale = Rn.Vector3.fromCopyArray([50, 50, 50]);

    const startTime = Date.now();
   
    // camera
    const cameraEntity = Rn.EntityHelper.createCameraControllerEntity();
    cameraEntity.translate = Rn.Vector3.fromCopyArray([0, 50, 200]);
    const cameraComponent = cameraEntity.getCamera();
    cameraComponent.zNear = 0.1;
    cameraComponent.zFar = 1000;
    cameraComponent.setFovyAndChangeFocalLength(45);
    cameraComponent.aspect = window.innerWidth / window.innerHeight;
    
    function updatePhysics() {
        world.step();
        let p = body.getPosition();
        let q = body.getQuaternion();

        entities.forEach(function (entity) {
            if ( entity.getTagValue("type") == "cube" ) {
                entity.translate = Rn.Vector3.fromCopyArray([p.x, p.y, p.z]);
                entity.quaternion = Rn.Vector4.fromCopyArray4([q.x, q.y, q.z, q.w]);
            }
        });
    }

    const draw = function(time) {
        updatePhysics();

        gl.disable(gl.CULL_FACE); // TODO:
        system.processAuto();

        requestAnimationFrame(draw);
    }

    draw();

}

document.body.onload = load;
