const dataSet = [
    {imageFile:"../../../../assets/textures/Basketball.jpg", scale:1.0}, // Basketball.jpg
    {imageFile:"../../../../assets/textures/BeachBall.jpg",  scale:0.9}, // BeachBall.jpg
    {imageFile:"../../../../assets/textures/Football.jpg",   scale:1.0}, // Football.jpg
    {imageFile:"../../../../assets/textures/Softball.jpg",   scale:0.3}, // Softball.jpg
    {imageFile:"../../../../assets/textures/TennisBall.jpg", scale:0.3}, // TennisBall.jpg
];

// glboost var
let glBoostContext;
let renderer;
let camera;
let scene;
let meshs = [];

//oimo var
let world;
let G = -10, nG = -10;
let wakeup = false;
let bodys = [];

init();

function init() {
    let width = window.innerWidth;
    let height = window.innerHeight;
    let canvas = document.getElementById("world");
    glBoostContext = new GLBoost.GLBoostMiddleContext(canvas);
    renderer = glBoostContext.createRenderer({ canvas: canvas, clearColor: {red:0, green:0, blue:0, alpha:1}});
    renderer.resize(width, height);
    scene = glBoostContext.createScene();

    camera = glBoostContext.createPerspectiveCamera({
        eye: new GLBoost.Vector3(0.0, 100, 200),
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

    // oimo init
    world = new OIMO.World({ 
        timestep: 1/30, 
        iterations: 8, 
        broadphase: 2, // 1 brute force, 2 sweep and prune, 3 volume tree
        worldscale: 1, // scale full world 
        random: true,  // randomize sample
        info: false,   // calculate statistic or not
        gravity: [0,-9.8,0] 
    });

    populate();

    // animate
    expression = glBoostContext.createExpressionAndRenderPasses(1);
    expression.renderPasses[0].scene = scene;
    expression.prepareToRender();

    animate();
}

function populate() {
    let max = 256;

    let ground2 = world.add({
        type: "box",
        size: [400, 40, 400],
        pos: [0, -20, 0],
        rot: [0, 0, 0],
        move: false,
        density: 1,
        friction: 0.5,
        restitution: 0.1,
    });
    
    addStaticBox([400, 40, 400], [0,-20,0], [0,0,0]);
    
    let boxDataSet = [
        { size:[100, 100,  10], pos:[  0, 50,-50], rot:[0,0,0] },
        { size:[100, 100,  10], pos:[  0, 50, 50], rot:[0,0,0] },
        { size:[ 10, 100, 100], pos:[-50, 50,  0], rot:[0,0,0] },
        { size:[ 10, 100, 100], pos:[ 50, 50,  0], rot:[0,0,0] } 
    ];
    
    let surfaces = [];
    for ( let i = 0; i < boxDataSet.length; i++ ) {
        let size = boxDataSet[i].size
        let pos  = boxDataSet[i].pos;
        let rot  = boxDataSet[i].rot;

        surfaces[i] = world.add({
            type: "box",
            size: size,
            pos: pos,
            rot: rot,
            move: false,
            density: 1,
            friction: 0.5,
            restitution: 0.1,
        });

        addStaticBox(size, pos, rot, true);
    }

    let w;	
    let h;
    let d;
    let textures = [];
    let materials = [];
    for (let i = 0; i < dataSet.length; i++) {
        let imageFile = dataSet[i].imageFile;

        textures[i] = glBoostContext.createTexture(imageFile);
        materials[i] = glBoostContext.createClassicMaterial();

        materials[i].setTexture(textures[i]);
        materials[i].shaderClass = GLBoost.LambertShader;
   }

    let x, y, z;
    let i = max;
    while (i--){
        x = -50 + Math.random()*100;
        y = 200 + Math.random()*100;
        z = -50 + Math.random()*100;
        w = 20 + Math.random()*10;
        h = 10 + Math.random()*10;
        d = 10 + Math.random()*10;
        let pos = Math.floor(Math.random() * dataSet.length);
        let scale = dataSet[pos].scale;
        w *= scale;
        bodys[i] = world.add({
            type: "sphere",
            size: [w*0.5],
            pos: [x, y, z],
            rot: [0, 0, 0],
            move: true,
            density: 1,
            friction: 0.5,
            restitution: 0.1,
        });

        let geoBox = glBoostContext.createSphere(w*0.5, 24, 24, null);
        meshs[i] = glBoostContext.createMesh(geoBox, materials[pos]);
        meshs[i].translate = new GLBoost.Vector3(w*0.5, w*0.5, w*0.5);
        scene.addChild(meshs[i]);
    }
}

function addStaticBox(size, position, rotation, spec) {
    let geo1 = glBoostContext.createCube(new GLBoost.Vector3(size[0], size[1], size[2]), new GLBoost.Vector4(0.5, 0.5, 0.5, 1));
    
    let material = glBoostContext.createClassicMaterial();
    material.shaderClass = GLBoost.LambertShader;
    material.baseColor = new GLBoost.Vector4(0.5, 0.5, 0.5, 0.5);
    
    let mground1 = glBoostContext.createMesh(geo1, material);
    mground1.translate = new GLBoost.Vector3(position[0], position[1], position[2]);
    
    if ( spec ) {
        mground1.opacity = 0.5;
    }
    mground1.dirty = true;
    scene.addChild( mground1 );
}

function animate() {
    renderer.clearCanvas();
    renderer.draw(expression);
    
    world.step();
    
    let p, r, m, x, y, z;
    let i = bodys.length;
    let mesh;
    wakeup = false;

    if (G !== nG) {
        wakeup = true;
        G = nG;
    }

    while (i--) {
        let body = bodys[i];
        mesh = meshs[i];
        let p = body.getPosition();
        let q = body.getQuaternion();
        mesh.translate = new GLBoost.Vector3(p.x, p.y, p.z);
        mesh.quaternion = new GLBoost.Quaternion(q.x, q.y, q.z, q.w);
        if ( p.y < -300 ) {
            x = -50 + Math.random()*100;
            y = 200 + Math.random()*100;
            z = -50 + Math.random()*100;
            bodys[i].resetPosition(x, y, z);
        }
    }

    let rotateMatrixY = GLBoost.Matrix33.rotateY(1);
    let rotatedVector = rotateMatrixY.multiplyVector(camera.eye);
    camera.eye = rotatedVector;

    requestAnimationFrame(animate);
}