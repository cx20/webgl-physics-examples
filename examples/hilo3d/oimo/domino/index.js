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
var dataSet = [
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
    var colorHash = {
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
var camera;
var stage;
var meshGround;
var meshBoxes = [];
var ticker;

// oimo variable
var world;
var oimoGround;
var oimoBoxes = [];
var rad = 0;

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

    var directionLight = new Hilo3d.DirectionalLight({
        color:new Hilo3d.Color(1, 1, 1),
        direction:new Hilo3d.Vector3(0, -1, 0)
    }).addTo(stage);
    
    var ambientLight = new Hilo3d.AmbientLight({
        color:new Hilo3d.Color(1, 1, 1),
        amount: .5
    }).addTo(stage);
}

function initWorld() {
    world = new OIMO.World({ 
        timestep: 1/60 * 2, 
        iterations: 8, 
        broadphase: 2, // 1 brute force, 2 sweep and prune, 3 volume tree
        worldscale: 1, // scale full world 
        random: true,  // randomize sample
        info: false,   // calculate statistic or not
        gravity: [0,-9.8,0] 
    });
}

function addGround() {
    var geometryGround = new Hilo3d.BoxGeometry();
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
    var DOT_SIZE = 8;
    var w = DOT_SIZE*0.2;
    var h = DOT_SIZE*1.5;
    var d = DOT_SIZE;
    var y = 2;
    var geometryBox = new Hilo3d.BoxGeometry();

    for (var x = 0; x < 16; x++) {
        for (var z = 0; z < 16; z++) {
            i = x + z * 16;
            var x1 = -60+x*(DOT_SIZE);
            var y1 = y*(DOT_SIZE);
            var z1 = -70+z*(DOT_SIZE)*1.2;
            var c = getRgbColor(dataSet[i]);

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
            
            var oimoBox = world.add({
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
    var DOT_SIZE = 8;
    var w = DOT_SIZE;
    var h = DOT_SIZE;
    var d = DOT_SIZE;
    var x = 0;
    var y = 0;
    var z = 0;
    var geometryBox = new Hilo3d.BoxGeometry();

    for (var i = 0; i < 16; i++) {
        w = DOT_SIZE;
        h = DOT_SIZE;
        d = DOT_SIZE;
        x = 0;
        y = 5;
        z = i;
        var x1 = -62+x*(DOT_SIZE);
        var y1 = y*(DOT_SIZE);
        var z1 = -70+z*(DOT_SIZE)*1.2;
        
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
        
        var oimoBox = world.add({
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
        for ( var i = 0; i < oimoBoxes.length; i++ ) {
            var oimoBox = oimoBoxes[i];
            var meshBox = meshBoxes[i];
            var pos = oimoBox.getPosition();
            meshBox.setPosition(pos.x, pos.y, pos.z);
            var rot = oimoBox.getQuaternion();
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
	