// Hilo3d variable
let camera;
let stage;
let meshGround;
let meshBox;
let ticker;

// oimo variable
let world;
let oimoGround;
let oimoBox;
let rad = 0;

function initScene() {
    camera = new Hilo3d.PerspectiveCamera({
        aspect: innerWidth / innerHeight,
        far: 100,
        near: 0.1,
        x: 0,
        y: 3,
        z: 6
    });

    stage = new Hilo3d.Stage({
        container: document.getElementById('container'),
        camera: camera,
        clearColor: new Hilo3d.Color(1.0, 1.0, 1.0),
        width: innerWidth,
        height: innerHeight
    });
}

function initWorld() {
    world = new OIMO.World({ 
        timestep: 1/60, 
        iterations: 8, 
        broadphase: 2, // 1 brute force, 2 sweep and prune, 3 volume tree
        worldscale: 1, // scale full world 
        random: true,  // randomize sample
        info: false,   // calculate statistic or not
        gravity: [0,-9.8,0] 
    });
}

function addGround() {
    let geometryGround = new Hilo3d.BoxGeometry();
    geometryGround.setAllRectUV([[0, 1], [1, 1], [1, 0], [0, 0]]);

    meshGround = new Hilo3d.Mesh({
        scaleX: 4,
        scaleY: 0.1,
        scaleZ: 4,
        x: 0,
        y: 0,
        z: 0,
        geometry: geometryGround,
        material: new Hilo3d.BasicMaterial({
                lightType: 'NONE',
                diffuse:new Hilo3d.LazyTexture({
                src:'../../../../assets/textures/frog.jpg'
            })
        }),
    });

    oimoGround = world.add({
        type: "box",
        size: [4, 0.1, 4],
        pos: [0, 0, 0],
        rot: [0, 0, 0],
        move: false,
        density: 1
    });
    stage.addChild(meshGround);

    let orbitControls = new OrbitControls(stage, {
        isLockMove:true,
        isLockZ:true,
    });
}

function addBox() {
    let geometryBox = new Hilo3d.BoxGeometry();
    geometryBox.setAllRectUV([[0, 1], [1, 1], [1, 0], [0, 0]]);

    meshBox = new Hilo3d.Mesh({
        scaleX: 1,
        scaleY: 1,
        scaleZ: 1,
        x: 0,
        y: 2,
        z: 0,
        geometry: geometryBox,
        material: new Hilo3d.BasicMaterial({
            lightType: 'NONE',
            diffuse:new Hilo3d.LazyTexture({
                src:'../../../../assets/textures/frog.jpg'
            })
        }),
        onUpdate: function() {
        }
    });

    oimoBox = world.add({
        type: "box",
        size: [1, 1, 1],
        pos: [0, 2, 0],
        rot: [10, 0, 10],
        move: true,
        density: 1
    });

    stage.addChild(meshBox);
}

function animate() {
    meshGround.onUpdate = function() {
        world.step();

        let pos = oimoBox.getPosition();
        meshBox.setPosition(pos.x, pos.y, pos.z);
        let rot = oimoBox.getQuaternion();
        meshBox.quaternion.set(rot.x, rot.y, rot.z, rot.w);
        
        camera.lookAt( new Hilo3d.Vector3(0,0,0));
        camera.setPosition( 6 * Math.sin(rad), 3, 6 * Math.cos(rad));
        
        rad += Math.PI/180 * 0.1;
    };

    ticker = new Hilo3d.Ticker(60);
    ticker.addTick(stage);
    ticker.start(true);
}

initScene();
initWorld();
addGround();
addBox();
animate();
