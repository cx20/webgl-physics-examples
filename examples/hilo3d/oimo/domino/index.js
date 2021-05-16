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
        "無":[0xDC/0xFF, 0xAA/0xFF, 0x6B/0xFF],    // 段ボール色
        "白":[0xff/0xFF, 0xff/0xFF, 0xff/0xFF],
        "肌":[0xff/0xFF, 0xcc/0xFF, 0xcc/0xFF],
        "茶":[0x80/0xFF, 0x00/0xFF, 0x00/0xFF],
        "赤":[0xff/0xFF, 0x00/0xFF, 0x00/0xFF],
        "黄":[0xff/0xFF, 0xff/0xFF, 0x00/0xFF],
        "緑":[0x00/0xFF, 0xff/0xFF, 0x00/0xFF],
        "水":[0x00/0xFF, 0xff/0xFF, 0xff/0xFF],
        "青":[0x00/0xFF, 0x00/0xFF, 0xff/0xFF],
        "紫":[0x80/0xFF, 0x00/0xFF, 0x80/0xFF]
    };
    return colorHash[c];
}

// Hilo3d variable
let camera;
let stage;
let meshGround;
let meshBoxes = [];
let ticker;

// oimo variable
let world;
let oimoGround;
let oimoBoxes = [];
let rad = 0;

function initScene() {
    camera = new Hilo3d.PerspectiveCamera({
        aspect: innerWidth / innerHeight,
        far: 1000,
        near: 0.1,
        x: 0,
        y: 50,
        z: 200
    });

    stage = new Hilo3d.Stage({
        container: document.getElementById('container'),
        camera: camera,
        clearColor: new Hilo3d.Color(0.0, 0.0, 0.0),
        width: innerWidth,
        height: innerHeight
    });

    let directionLight = new Hilo3d.DirectionalLight({
        color:new Hilo3d.Color(1, 1, 1),
        direction:new Hilo3d.Vector3(0, -1, 0)
    }).addTo(stage);
    
    let ambientLight = new Hilo3d.AmbientLight({
        color:new Hilo3d.Color(1, 1, 1),
        amount: .5
    }).addTo(stage);

    let orbitControls = new OrbitControls(stage, {
        isLockMove:true,
        isLockZ:true,
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
        scaleX: 200,
        scaleY: 4,
        scaleZ: 200,
        x: 0,
        y: 0,
        z: 0,
        geometry: geometryGround,
        material: new Hilo3d.BasicMaterial({
            diffuse: new Hilo3d.Color(0x70/0xFF, 0x70/0xFF, 0x70/0xFF),
            lightType: 'PHONE'
        }),
    });

    oimoGround = world.add({
        type: "box",
        size: [200, 4, 200],
        pos: [0, 0, 0],
        rot: [0, 0, 0],
        move: false,
        density: 1
    });
    stage.addChild(meshGround);
}

function addBox() {
    let DOT_SIZE = 8;
    let w = DOT_SIZE*0.2;
    let h = DOT_SIZE*1.5;
    let d = DOT_SIZE;
    let y = 2;
    let geometryBox = new Hilo3d.BoxGeometry();

    for (let x = 0; x < 16; x++) {
        for (let z = 0; z < 16; z++) {
            i = x + z * 16;
            let x1 = -60+x*(DOT_SIZE);
            let y1 = y*(DOT_SIZE);
            let z1 = -70+z*(DOT_SIZE)*1.2;
            let c = getRgbColor(dataSet[i]);

            meshBox = new Hilo3d.Mesh({
                scaleX: w,
                scaleY: h,
                scaleZ: d,
                x: x1,
                y: y1,
                z: z1,
                geometry: geometryBox,
                material: new Hilo3d.BasicMaterial({
                    diffuse: new Hilo3d.Color(c[0], c[1], c[2]),
                    lightType: 'PHONE'
                })
            });
            meshBoxes.push(meshBox);
            stage.addChild(meshBox);
            
            let oimoBox = world.add({
                type: "box",
                size: [w, h, d],
                pos: [x1, y1, z1],
                rot: [0, 0, 0],
                move: true,
                density: 1
            });
            oimoBoxes.push(oimoBox);
        }
    }
}

function addBox2() {
    let DOT_SIZE = 8;
    let w = DOT_SIZE;
    let h = DOT_SIZE;
    let d = DOT_SIZE;
    let x = 0;
    let y = 0;
    let z = 0;
    let geometryBox = new Hilo3d.BoxGeometry();

    for (let i = 0; i < 16; i++) {
        w = DOT_SIZE;
        h = DOT_SIZE;
        d = DOT_SIZE;
        x = 0;
        y = 5;
        z = i;
        let x1 = -62+x*(DOT_SIZE);
        let y1 = y*(DOT_SIZE);
        let z1 = -70+z*(DOT_SIZE)*1.2;
        
        meshBox = new Hilo3d.Mesh({
            scaleX: w,
            scaleY: h,
            scaleZ: d,
            x: x1,
            y: y1,
            z: z1,
            geometry: geometryBox,
            material: new Hilo3d.BasicMaterial({
                diffuse: new Hilo3d.Color(1, 0, 0)
            })
        });
        meshBoxes.push(meshBox);
        stage.addChild(meshBox);
        
        let oimoBox = world.add({
            type: "box",
            size: [w, h, d],
            pos: [x1, y1, z1],
            rot: [0, 0, 0],
            move: true,
            density: 1
        });
        oimoBoxes.push(oimoBox);
    }
}


function animate() {
    meshGround.onUpdate = function() {
        world.step();
        for ( let i = 0; i < oimoBoxes.length; i++ ) {
            let oimoBox = oimoBoxes[i];
            let meshBox = meshBoxes[i];
            let pos = oimoBox.getPosition();
            meshBox.setPosition(pos.x, pos.y, pos.z);
            let rot = oimoBox.getQuaternion();
            meshBox.quaternion.set(rot.x, rot.y, rot.z, rot.w);
        }
        
        camera.lookAt( new Hilo3d.Vector3(0,0,0));
        camera.setPosition( 200 * Math.sin(rad), 100, 200 * Math.cos(rad));
        
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
addBox2();
animate();
