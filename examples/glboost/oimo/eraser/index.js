const DOT_SIZE = 40;
const W = DOT_SIZE / 2 * 0.8 * 1.0;
const H = DOT_SIZE / 2 * 0.8 * 0.2;
const D = DOT_SIZE / 2 * 0.8 * 0.5;

// glboost var
let renderer;
let camera;
let scene;
let meshs = [];

//oimo var
let world;
let G = -10, nG = -10;
let wakeup = false;
let bodys = [];

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
let positions = [
    // Front face
    [-W, -H,  D], // v0
    [ W, -H,  D], // v1
    [ W,  H,  D], // v2
    [-W,  H,  D], // v3
    // Back face
    [-W, -H, -D], // v4
    [ W, -H, -D], // v5
    [ W,  H, -D], // v6
    [-W,  H, -D], // v7
    // Top face
    [ W,  H,  D], // v2
    [-W,  H,  D], // v3
    [-W,  H, -D], // v7
    [ W,  H, -D], // v6
    // Bottom face
    [-W, -H,  D], // v0
    [ W, -H,  D], // v1
    [ W, -H, -D], // v5
    [-W, -H, -D], // v4
    // Right face
    [ W, -H,  D], // v1
    [ W,  H,  D], // v2
    [ W,  H, -D], // v6
    [ W, -H, -D], // v5
    // Left face
    [-W, -H,  D], // v0
    [-W,  H,  D], // v3
    [-W,  H, -D], // v7
    [-W, -H, -D]  // v4
];

let texcoords = [
    // Front face
    [0.5,  1.0], // v0
    [0.75, 1.0], // v1
    [0.75, 0.5], // v2
    [0.5,  0.5], // v3

    // Back face
    [0.25, 1.0], // v4
    [0.5,  1.0], // v5
    [0.5,  0.5], // v6
    [0.25, 0.5], // v7

    // Top face
    [0.75, 0.5], // v2
    [0.5,  0.5], // v3
    [0.5,  0.0], // v7
    [0.75, 0.0], // v6

    // Bottom face
    [0.0,  1.0], // v0
    [0.25, 1.0], // v1
    [0.25, 0.5], // v5
    [0.0,  0.5], // v4

    // Right face
    [0.0,  0.5], // v1
    [0.0,  0.0], // v2
    [0.25, 0.0], // v6
    [0.25, 0.5], // v5

    // Left face
    [0.5,  0.5], // v0
    [0.5,  0.0], // v3
    [0.25, 0.0], // v7
    [0.25, 0.5]  // v4
];

let indices = [
     0,  1,  2,    0,  2 , 3,  // Front face
     4,  5,  6,    4,  6 , 7,  // Back face
     8,  9, 10,    8, 10, 11,  // Top face
    12, 13, 14,   12, 14, 15,  // Bottom face
    16, 17, 18,   16, 18, 19,  // Right face
    20, 21, 22,   20, 22, 23   // Left face
];

init();

function init() {
    let width = window.innerWidth;
    let height = window.innerHeight;
    let canvas = document.getElementById("world");
    glBoostContext = new GLBoost.GLBoostMiddleContext(canvas);
    renderer = glBoostContext.createRenderer({ canvas: canvas, clearColor: {red:0, green:0, blue:0, alpha:1}});
    renderer.resize(width, height);
    scene = glBoostContext.createScene();

    renderer = glBoostContext.createRenderer({
        canvas: canvas,
        clearColor: {red: 0, green: 0, blue: 0, alpha: 1}
    });

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
    
    let geo1 = glBoostContext.createCube(new GLBoost.Vector3(400, 40, 400), new GLBoost.Vector4(0.7, 0.7, 0.7, 1.0));
    let material = glBoostContext.createClassicMaterial();
    material.shaderClass = GLBoost.PhongShader;
    let mground1 = glBoostContext.createMesh(geo1, material);
    mground1.translate = new GLBoost.Vector3(0, -50, 0);
    mground1.dirty = true;
    scene.addChild( mground1 );

    // oimo init
    world = new OIMO.World({ 
        timestep: 1/60, 
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
    
    let max = 500;

    let ground2 = world.add({
        type: "box",
        size: [400, 40, 400],
        pos: [0, -50, 0],
        rot: [0, 0, 0],
        move: false,
        density: 1,
        friction: 0.5,
        restitution: 0.1,
    });

    let w = DOT_SIZE * 0.8 * 1.0;
    let h = DOT_SIZE * 0.8 * 0.2;
    let d = DOT_SIZE * 0.8 * 0.5;

    let texture = glBoostContext.createTexture('../../../../assets/textures/eraser_001/eraser.png');
    let material = glBoostContext.createClassicMaterial();
    material.setTexture(texture);


    for (let i = 0; i < max; i++) {
        let x = (Math.random() * 8) - 4;
        let y = (Math.random() * 8*2) + 10;
        let z = (Math.random() * 8) - 4;
        bodys[i] = world.add({
            type: "box",
            size: [w, h, d],
            pos: [x * DOT_SIZE, y * DOT_SIZE, z * DOT_SIZE],
            rot: [0, 0, 0],
            move: true,
            density: 1,
            friction: 0.5,
            restitution: 0.1,
        });

        let color = new GLBoost.Vector4(1, 1, 1, 1);
        let geoBox = glBoostContext.createGeometry();
        geoBox.setVerticesData({
            position: positions,
            texcoord: texcoords
        }, [indices], GLBoost.TRIANGLE);
        
        meshs[i] = glBoostContext.createMesh(geoBox, material);
        meshs[i].translate = new GLBoost.Vector3(x * DOT_SIZE, y * DOT_SIZE, z * DOT_SIZE);
        scene.addChild(meshs[i]);
    }
}

function animate() {
    renderer.clearCanvas();
    renderer.draw(expression);
    
    world.step();
    
    let p, r, m, x, y, z;
    let mesh;

    for ( let i = 0; i < bodys.length; i++ ) {
        let body = bodys[i];
        mesh = meshs[i];
        let p = body.getPosition();
        let q = body.getQuaternion();
        mesh.translate = new GLBoost.Vector3(p.x, p.y, p.z);
        mesh.quaternion = new GLBoost.Quaternion(q.x, q.y, q.z, q.w);
        if ( p.y < -300 ) {
            let x = (Math.random() * 8) - 4;
            let y = (Math.random() * 8*2) + 10;
            let z = (Math.random() * 8) - 4;
            bodys[i].resetPosition(x * DOT_SIZE, y * DOT_SIZE, z * DOT_SIZE);
        }
    }

    let rotateMatrixY = GLBoost.Matrix33.rotateY(0.1);
    let rotatedVector = rotateMatrixY.multiplyVector(camera.eye);
    camera.eye = rotatedVector;

    requestAnimationFrame(animate);
}
