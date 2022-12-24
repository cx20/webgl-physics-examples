let world;
let groundBody;
let body;
let bodys = [];
let entities = [];
const SCALE = 1/10;
const DOT_SIZE = 8;

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
        size: [200*SCALE, 2*SCALE, 200*SCALE],
        pos: [0, 0, 0],
        rot: [0, 0, 0],
        move: false,
        density: 1,
        friction: 0.5,
        restitution: 0.1,
    });
}

function readyCubeVerticesData() {
    const primitive = new Rn.Cube();
    primitive.generate({ 
        widthVector: Rn.Vector3.fromCopy3(0.5, 0.5, 0.5)
    });

    const texture = new Rn.Texture();
    texture.generateTextureFromUri('../../../../assets/textures/grass.jpg');
    primitive.material.setTextureParameter(Rn.ShaderSemantics.DiffuseColorTexture, texture);

    return primitive;
}

const load = async function () {
    Rn.Config.maxCameraNumber = 20;
    await Rn.ModuleManager.getInstance().loadModule('webgl');
    await Rn.ModuleManager.getInstance().loadModule('pbr');

    initOimo();

    const c = document.getElementById('world');
    const gl = await Rn.System.init({
        approach: Rn.ProcessApproach.DataTexture,
        canvas: c
    });
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

    bodys.push(groundBody);

    // Ground
    const mesh1 = new Rn.Mesh();
    mesh1.addPrimitive(primitive);
    const entity1 = Rn.EntityHelper.createMeshEntity();
    entity1.tryToSetTag({tag:"type", value:"ground"});

    entities.push(entity1);
    const meshComponent1 = entity1.getMesh();

    meshComponent1.setMesh(mesh1);
    entity1.localScale = Rn.Vector3.fromCopyArray([200*SCALE, 2*SCALE, 200*SCALE]);
    
    populate();

    const startTime = Date.now();
   
    // camera
    const cameraEntity = Rn.EntityHelper.createCameraControllerEntity();
    cameraEntity.localPosition = Rn.Vector3.fromCopyArray([0 * SCALE, 100.0 * SCALE, 200 * SCALE]);
    cameraEntity.localEulerAngles = Rn.Vector3.fromCopyArray([-0.5, 0.0, 0.0]);
    const cameraComponent = cameraEntity.getCamera();
    cameraComponent.zNear = 0.1;
    cameraComponent.zFar = 1000;
    cameraComponent.setFovyAndChangeFocalLength(45);
    cameraComponent.aspect = window.innerWidth / window.innerHeight;

    // Lights
    const lightEntity1 = Rn.EntityHelper.createLightEntity();
    const lightComponent1 = lightEntity1.getLight();
    lightComponent1.type = Rn.LightType.Directional;
    lightEntity1.localEulerAngles = Rn.Vector3.fromCopyArray([-Math.PI / 2, -Math.PI / 4, Math.PI / 4]);

    const lightEntity2 = Rn.EntityHelper.createLightEntity();
    const lightComponent2 = lightEntity2.getLight();
    lightComponent2.type = Rn.LightType.Directional;
    lightEntity2.localEulerAngles = Rn.Vector3.fromCopyArray([Math.PI / 2, Math.PI / 4, -Math.PI / 4]);
  
    function updatePhysics() {
        world.step();
        let i = bodys.length;
        while (i--) {
            let body = bodys[i];
            let entity = entities[i];
            let p = body.getPosition();
            let q = body.getQuaternion();
            entity.localPosition = Rn.Vector3.fromCopyArray([p.x, p.y, p.z]);
            entity.localRotation = Rn.Vector4.fromCopyArray4([q.x, q.y, q.z, q.w]);
        }
    }

    const draw = function(time) {
        updatePhysics();

        gl.disable(gl.CULL_FACE); // TODO:
		Rn.System.processAuto();

        requestAnimationFrame(draw);
    }

    draw();

}

function populate() {
    let max = 256;
    let w = DOT_SIZE*0.2;
    let h = DOT_SIZE*1.5;
    let d = DOT_SIZE;

    let i;
    let y;
    for ( let z = 0; z < 16; z++ ) {
        for ( let x = 0; x < 16; x ++ ) {
            i = x + (z) * 16;
            let c = getRgbColor(dataSet[i]);
            y = 1;
            bodys[i+1] = world.add({
                type: "box",
                size: [w*SCALE, h*SCALE, d*SCALE],
                pos: [(-8+x)*DOT_SIZE*SCALE, y*DOT_SIZE*SCALE, (-8+z)*DOT_SIZE*1.2*SCALE],
                rot: [0, 0, 0],
                move: true,
                density: 1,
                friction: 0.5,
                restitution: 0.1,
            });

            let modelMaterial = Rn.MaterialHelper.createPbrUberMaterial({isLighting: true});
            modelMaterial.setParameter(
                Rn.ShaderSemantics.BaseColorFactor,
                Rn.Vector4.fromCopyArray4([c.r / 0xff, c.g / 0xff, c.b / 0xff, 1])
            );

            const primitive = new Rn.Cube();
            primitive.generate({ 
                widthVector: Rn.Vector3.fromCopy3(0.5, 0.5, 0.5),
                material: modelMaterial
            });

            const mesh = new Rn.Mesh();
            mesh.addPrimitive(primitive);
            const entity = Rn.EntityHelper.createMeshEntity();

            entities.push(entity);
            const meshComponent = entity.getMesh();

            meshComponent.setMesh(mesh);
            entity.localScale = Rn.Vector3.fromCopyArray([w*SCALE, h*SCALE, d*SCALE]);

        }
    }

    let size = bodys.length;
    for ( i = 0; i < 16; i++ ) 
    {
        w = DOT_SIZE;
        h = DOT_SIZE;
        d = DOT_SIZE;
        x = 0;
        y = 2;
        z = i;
        bodys[size+i] = world.add({
            type: "box",
            size: [w*SCALE, h*SCALE, d*SCALE],
            pos: [(-8.4+x)*DOT_SIZE*SCALE, y*DOT_SIZE*SCALE, (-8+z)*DOT_SIZE*1.2*SCALE],
            rot: [0, 0, 0],
            move: true,
            density: 1,
            friction: 0.5,
            restitution: 0.1,
        });

        let modelMaterial = Rn.MaterialHelper.createPbrUberMaterial({isLighting: true});
        modelMaterial.setParameter(
            Rn.ShaderSemantics.BaseColorFactor,
            Rn.Vector4.fromCopyArray4([1, 0, 0, 1])
        );

        modelMaterial.setParameter(
            Rn.ShaderSemantics.BaseColorFactor,
            Rn.Vector4.fromCopyArray4([1, 0, 0, 1])
        );

        const primitive = new Rn.Cube();
        primitive.generate({ 
            widthVector: Rn.Vector3.fromCopy3(0.5, 0.5, 0.5),
            material: modelMaterial
        });

        const mesh = new Rn.Mesh();
        mesh.addPrimitive(primitive);
        const entity = Rn.EntityHelper.createMeshEntity();

        entities.push(entity);
        const meshComponent = entity.getMesh();

        meshComponent.setMesh(mesh);
        entity.localScale = Rn.Vector3.fromCopyArray([w*SCALE, h*SCALE, d*SCALE]);
    }
}

document.body.onload = load;
