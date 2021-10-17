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

function generateEntity() {
    const repo = Rn.EntityRepository.getInstance();
    const entity = repo.createEntity([Rn.TransformComponent, Rn.SceneGraphComponent, Rn.MeshComponent, Rn.MeshRendererComponent]);
    return entity;
}

function readyBasicVerticesData() {

    // Cube data
    //             1.0 y 
    //              ^  -1.0 
    //              | / z
    //              |/       x
    // -1.0 -----------------> +1.0
    //            / |
    //      +1.0 /  |
    //           -1.0
    // 
    //         [7]------[6]
    //        / |      / |
    //      [3]------[2] |
    //       |  |     |  |
    //       | [4]----|-[5]
    //       |/       |/
    //      [0]------[1]
    //
    const positions = new Float32Array([ 
        // Front face
        -0.5, -0.5,  0.5, // v0
         0.5, -0.5,  0.5, // v1
         0.5,  0.5,  0.5, // v2
        -0.5,  0.5,  0.5, // v3
        // Back face
        -0.5, -0.5, -0.5, // v4
         0.5, -0.5, -0.5, // v5
         0.5,  0.5, -0.5, // v6
        -0.5,  0.5, -0.5, // v7
        // Top face
         0.5,  0.5,  0.5, // v2
        -0.5,  0.5,  0.5, // v3
        -0.5,  0.5, -0.5, // v7
         0.5,  0.5, -0.5, // v6
        // Bottom face
        -0.5, -0.5,  0.5, // v0
         0.5, -0.5,  0.5, // v1
         0.5, -0.5, -0.5, // v5
        -0.5, -0.5, -0.5, // v4
         // Right face
         0.5, -0.5,  0.5, // v1
         0.5,  0.5,  0.5, // v2
         0.5,  0.5, -0.5, // v6
         0.5, -0.5, -0.5, // v5
         // Left face
        -0.5, -0.5,  0.5, // v0
        -0.5,  0.5,  0.5, // v3
        -0.5,  0.5, -0.5, // v7
        -0.5, -0.5, -0.5  // v4
    ]);
    
    const texcoords = new Float32Array([ 
        // Front face
        0.0, 0.0,
        1.0, 0.0,
        1.0, 1.0,
        0.0, 1.0,
        
        // Back face
        1.0, 0.0,
        1.0, 1.0,
        0.0, 1.0,
        0.0, 0.0,
        
        // Top face
        0.0, 1.0,
        0.0, 0.0,
        1.0, 0.0,
        1.0, 1.0,
        
        // Bottom face
        1.0, 1.0,
        0.0, 1.0,
        0.0, 0.0,
        1.0, 0.0,
        
        // Right face
        1.0, 0.0,
        1.0, 1.0,
        0.0, 1.0,
        0.0, 0.0,
        
        // Left face
        0.0, 0.0,
        1.0, 0.0,
        1.0, 1.0,
        0.0, 1.0
    ]);

    const indices = new Uint32Array([
         0,  1,  2,    0,  2 , 3,  // Front face
         4,  5,  6,    4,  6 , 7,  // Back face
         8,  9, 10,    8, 10, 11,  // Top face
        12, 13, 14,   12, 14, 15,  // Bottom face
        16, 17, 18,   16, 18, 19,  // Right face
        20, 21, 22,   20, 22, 23   // Left face
    ]);
        
    const primitive = Rn.Primitive.createPrimitive({
        indices: indices,
        attributeCompositionTypes: [Rn.CompositionType.Vec3, Rn.CompositionType.Vec2],
        attributeSemantics: [Rn.VertexAttribute.Position, Rn.VertexAttribute.Texcoord0],
        attributes: [positions, texcoords],
        primitiveMode: Rn.PrimitiveMode.Triangles
    });

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
    
    gl.clearColor(1.0, 1.0, 1.0, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const primitive = readyBasicVerticesData();

    Rn.MeshRendererComponent.manualTransparentSids = [];

    const entities = [];
    // Ground
    const mesh1 = new Rn.Mesh();
    mesh1.addPrimitive(primitive);
    const entity1 = generateEntity();
    entity1.tryToSetTag({tag:"type", value:"ground"});

    entities.push(entity1);
    const meshComponent1 = entity1.getComponent(Rn.MeshComponent);

    meshComponent1.setMesh(mesh1);
    entity1.getTransform().scale = new Rn.Vector3(200, 2, 200);
    entity1.getTransform().toUpdateAllTransform = false;

    // Cube
    const mesh2 = new Rn.Mesh();
    mesh2.addPrimitive(primitive);
    const entity2 = generateEntity();
    entity2.tryToSetTag({tag:"type", value:"cube"});

    entities.push(entity2);
    const meshComponent2 = entity2.getComponent(Rn.MeshComponent);

    meshComponent2.setMesh(mesh2);
    entity2.getTransform().scale = new Rn.Vector3(50, 50, 50);
    entity2.getTransform().toUpdateAllTransform = false;

    const startTime = Date.now();
    let p = null;
    const rotationVec3 = Rn.MutableVector3.zero();
    let count = 0

    // camera
    const cameraComponent = createCameraComponent();
    cameraComponent.zNear = 0.1;
    cameraComponent.zFar = 1000;
    cameraComponent.setFovyAndChangeFocalLength(45);
    cameraComponent.aspect = window.innerWidth / window.innerHeight;
    const cameraEntity = cameraComponent.entity;
    cameraEntity.getTransform().translate = new Rn.Vector3(0, 50, 200);

    // renderPass
    const renderPass = new Rn.RenderPass();
    renderPass.cameraComponent = cameraComponent;
    renderPass.toClearColorBuffer = true;
    renderPass.addEntities(entities);

    // expression
    const expression = new Rn.Expression();
    expression.addRenderPasses([renderPass]);

    function createCameraComponent() {
        const entityRepository = Rn.EntityRepository.getInstance();
        const cameraEntity = entityRepository.createEntity([Rn.TransformComponent, Rn.SceneGraphComponent, Rn.CameraComponent]);
        const cameraComponent = cameraEntity.getComponent(Rn.CameraComponent);
        return cameraComponent;
    }
    
    function updatePhysics() {
        world.step();
        let p = body.getPosition();
        let q = body.getQuaternion();

        entities.forEach(function (entity) {
            if ( entity.getTagValue("type") == "cube" ) {
                entity.getTransform().translate = new Rn.Vector3(p.x, p.y, p.z);
                //entity.getTransform().quaternion = new Rn.Vector4(q.x, q.y, q.z, q.w);
                entity.getTransform().quaternion = Rn.Vector4.fromCopyArray4([q.x, q.y, q.z, q.w]);
            }
        });
    }

    const draw = function(time) {
        updatePhysics();

        gl.disable(gl.CULL_FACE); // TODO:
        system.process([expression]);

        count++;
        requestAnimationFrame(draw);
    }

    draw();

}

document.body.onload = load;
