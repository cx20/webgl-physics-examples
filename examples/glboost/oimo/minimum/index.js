let renderer;
let camera;
let expression;
let meshGround;
let meshCube;

let world;
let groundBody;
let body;

function initOimo() {
    world = new OIMO.World({ 
        timestep: 1/30, 
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
        pos: [0, -20, 0],
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

function initBoost() {

    let canvas = document.getElementById("world");
    let width = window.innerWidth;
    let height = window.innerHeight;
    let glBoostContext = new GLBoost.GLBoostMiddleContext(canvas);
    renderer = glBoostContext.createRenderer({ canvas: canvas, clearColor: {red:1, green:1, blue:1, alpha:1}});
    renderer.resize(width, height);
    let scene = glBoostContext.createScene();
    
    let texture = glBoostContext.createTexture('../../../../assets/textures/frog.jpg'); // frog.jpg
    let material = glBoostContext.createClassicMaterial();
    material.setTexture(texture);
    material.baseColor = new GLBoost.Vector4(1, 1, 1, 1);
    
    let geometryGround = glBoostContext.createCube(new GLBoost.Vector3(200, 2, 200), new GLBoost.Vector4(1, 1, 1, 1));
    meshGround = glBoostContext.createMesh(geometryGround, material);
    scene.addChild(meshGround);

    let p = groundBody.getPosition();
    let q = groundBody.getQuaternion();
    meshGround.translate = new GLBoost.Vector3(p.x, p.y, p.z);
    meshGround.quaternion = new GLBoost.Quaternion(q.x, q.y, q.z, q.w);

    let geometryCube = glBoostContext.createCube(new GLBoost.Vector3(50, 50, 50), new GLBoost.Vector4(1, 1, 1, 1));
    meshCube = glBoostContext.createMesh(geometryCube, material);
    scene.addChild(meshCube);
    
    let directionalLight = glBoostContext.createDirectionalLight(new GLBoost.Vector3(1, 1, 1), new GLBoost.Vector3(0, 0, -1));
    scene.addChild( directionalLight );
    
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
    
    expression = glBoostContext.createExpressionAndRenderPasses(1);
    expression.renderPasses[0].scene = scene;
    expression.prepareToRender();
}

function updatePhysics() {
    world.step();
    let p = body.getPosition();
    let q = body.getQuaternion();
    meshCube.translate = new GLBoost.Vector3(p.x, p.y, p.z);
    meshCube.quaternion = new GLBoost.Quaternion(q.x, q.y, q.z, q.w);
}

function animate() {
    renderer.clearCanvas();
    renderer.draw(expression);
    updatePhysics();

    let rotateMatrix = GLBoost.Matrix33.rotateY(0.1);
    let rotatedVector = rotateMatrix.multiplyVector(camera.eye);
    camera.eye = rotatedVector;

    requestAnimationFrame(animate);
}

initOimo();
initBoost();
animate();
