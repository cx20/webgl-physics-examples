let DOT_SIZE = 8;
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

// glboost var
let canvas;
let renderer;
let camera;
let scene;
let meshs = [];
let glBoostContext;
let mground1;

//oimo var
let world;
let groundBody;
let G = -10;
let bodys = [];

init();

function init() {
    canvas = document.getElementById("world");
    let width = window.innerWidth;
    let height = window.innerHeight;
    glBoostContext = new GLBoost.GLBoostMiddleContext(canvas);
    renderer = glBoostContext.createRenderer({ canvas: canvas, clearColor: {red:0, green:0, blue:0, alpha:1}});
    renderer.resize(width, height);
    scene = glBoostContext.createScene();

    camera = glBoostContext.createPerspectiveCamera({
        eye: new GLBoost.Vector3(0.0, 50, 100),
        center: new GLBoost.Vector3(0.0, 0.0, 0.0),
        up: new GLBoost.Vector3(0.0, 1.0, 0.0)
    }, {
        fovy: 45.0,
        aspect: width/height,
        zNear: 0.001,
        zFar: 3000.0
    });
    camera.cameraController = glBoostContext.createCameraController();
    scene.addChild(camera);

    let directionalLight1 = glBoostContext.createDirectionalLight(new GLBoost.Vector3(1, 1, 1), new GLBoost.Vector3(30, 30, 30));
    scene.addChild( directionalLight1 );
    let directionalLight2 = glBoostContext.createDirectionalLight(new GLBoost.Vector3(1, 1, 1), new GLBoost.Vector3(-30, -30, -30));
    scene.addChild( directionalLight2 );

    let texture = glBoostContext.createTexture('../../../../assets/textures/grass.jpg');
    let material = glBoostContext.createClassicMaterial();
    material.setTexture(texture);
    material.baseColor = new GLBoost.Vector4(1, 1, 1, 1);

    let geo1 = glBoostContext.createCube(new GLBoost.Vector3(200, 2, 200), new GLBoost.Vector4(1, 1, 1, 1));
    mground1 = glBoostContext.createMesh(geo1, material);
    mground1.dirty = true;
    scene.addChild(mground1);

    // oimo init
    world = new OIMO.World({ 
        timestep: 1/10, 
        iterations: 8, 
        broadphase: 2, // 1 brute force, 2 sweep and prune, 3 volume tree
        worldscale: 1, // scale full world 
        random: true,  // randomize sample
        info: false,   // calculate statistic or not
        gravity: [0,-9.8,0] 
    });
    populate();

    // loop
    expression = glBoostContext.createExpressionAndRenderPasses(1);
    expression.renderPasses[0].scene = scene;
    expression.prepareToRender();

    animate();
}

function populate() {
    let max = 256;

    // reset old
    world.clear();

    groundBody = world.add({
        type: "box",
        size: [200, 2, 200],
        pos: [0, -20, 0],
        rot: [0, 0, 0],
        move: false,
        density: 1,
        friction: 0.5,
        restitution: 0.1,
    });

    let p = groundBody.getPosition();
    let q = groundBody.getQuaternion();
    mground1.translate = new GLBoost.Vector3(p.x, p.y, p.z);
    mground1.quaternion = new GLBoost.Quaternion(q.x, q.y, q.z, q.w);

    let texture_football = glBoostContext.createTexture('../../../../assets/textures/football.png');

    let w = DOT_SIZE;
    let h = DOT_SIZE;
    let d = DOT_SIZE;

    let i;
    let y;
    for ( let x = 0; x < 16; x++ ) {
        for ( let y = 0; y < 16; y ++ ) {
            i = x + (15-y) * 16;
            let c = getRgbColor(dataSet[i]);
            z = 0;
            let x2 = (-8+x)*DOT_SIZE * 1.1 + Math.random();
            let y2 = (1+y)*DOT_SIZE * 1.1 + Math.random();
            let z2 = z*DOT_SIZE + Math.random();
            bodys[i] = world.add({
                type: "sphere",
                size: [w*0.5],
                pos: [x2, y2, z2],
                rot: [0, 0, 0],
                move: true,
                density: 1,
                friction: 0.5,
                restitution: 0.1,
            });

            let material = glBoostContext.createClassicMaterial();
            material.shaderClass = GLBoost.LambertShader;
            material.setTexture(texture_football);
            let color = new GLBoost.Vector4(c.r / 0xff, c.g / 0xff, c.b / 0xff, 1.0);
            let geoBall = glBoostContext.createSphere(w*0.5, 24, 24, color);

            meshs[i] = glBoostContext.createMesh(geoBall, material);
            scene.addChild(meshs[i]);
        }
    }
}

function animate() {
    renderer.clearCanvas();
    renderer.draw(expression);
    
    world.step();
    
    let p, r, m, x, y, z;
    let i = bodys.length;
    let mesh;

    while (i--) {
        let body = bodys[i];
        let mesh = meshs[i];
        let p = body.getPosition();
        let q = body.getQuaternion();
        mesh.translate = new GLBoost.Vector3(p.x, p.y, p.z);
        mesh.quaternion = new GLBoost.Quaternion(q.x, q.y, q.z, q.w);
    }

    requestAnimationFrame(animate);
}
