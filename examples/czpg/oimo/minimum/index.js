let world;
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

    let groundBody = world.add({
        type: "box",
        size: [4, 0.1, 4],
        pos: [0, 0, 0],
        rot: [0, 0, 0],
        move: false,
        density: 1,
        friction: 0.5,
        restitution: 0.1,
    });
    body = world.add({
        type: "box",
        size: [1, 1, 1],
        pos: [0, 2, 0],
        rot: [10, 0, 10],
        move: true,
        density: 1,
        friction: 0.5,
        restitution: 0.2
    });
}

let renderer;
let context;
let scene;
let camera;
let modelCube;
let modelGround;
let shader;
let controler;
let cameraControler

function initCzpg() {
    renderer = new CZPG.Renderer('c').setSize('100%', '100%').clear(1.0, 1.0, 1.0, 1.0);
    //renderer = new CZPG.Renderer('c').setSize(window.innerWidth, window.innerHeight).clear(1.0, 1.0, 1.0, 1.0);
    context = renderer.context;
    scene = new CZPG.Scene(renderer);
    controler = scene.controler;
    context.canvas.width = window.innerWidth;
    context.canvas.height = window.innerHeight;    
    camera = new CZPG.PerspectiveCamera(45, context.canvas.width/context.canvas.height, 0.01, 100);
    camera.position = [0, 3, 6];
    camera.updateViewMatrix(); // lookAt target is [0,0,0] by default
    // Is there need a orbit control? cause it rotate by default...
    cameraControler = new CZPG.OrbitControls(camera, context.canvas, controler);
    cameraControler.enableDamping = true;
    cameraControler.autoRotate = true;

    const textures = CZPG.createTextures(context, { 
        pic: {
            src : '../../../../assets/textures/frog.jpg',
            min : context.LINEAR_MIPMAP_LINEAR,
            mag : context.LINEAR,
        },
    });

    modelCube = CZPG.Cube.createModel();
    modelCube.scale = [1, 1, 1];
    shader = new CZPG.FlatTextureShader(context, camera, textures.pic);
    scene.add({shader: shader, model: modelCube});

    modelGround = CZPG.Cube.createModel();
    modelGround.position = [0, 0, 0];
    modelGround.scale = [4, 0.1, 4];
    scene.add({shader: shader, model: modelGround});

}

function animate() {
    let resized = false;
    let rad = 0;
    let loop = new CZPG.Render(function(timespan) {
        resized = renderer.clear(1.0, 1.0, 1.0, 1.0).fixCanvasToDisplay(window.devicePixelRatio);
        if(resized) camera.updateProjMatrix( context.canvas.width / context.canvas.height );
        updatePhysics();
        cameraControler.update();
        scene.render();
    }).start();
}    

function updatePhysics() {
    world.step();
    
    let p = body.position;
    let q = body.quaternion;

    modelCube.position = [p.x, p.y, p.z];
    modelCube.quaternion = [q.x, q.y, q.z, q.w];
}

initOimo();
initCzpg();
animate();
