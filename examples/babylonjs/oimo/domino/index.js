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
        "無":[0xDC/0xFF, 0xAA/0xFF, 0x6B/0xFF],
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

let engine;
let scene;
let canvas;
let FPS = 60;    // default is 60 FPS
let PHYSICS_SCALE = 1/10;

document.addEventListener("DOMContentLoaded", function () {
    onload();
}, false);

window.addEventListener("resize", function () {
    if (engine) {
        engine.resize();
    }
},false);

let onload = function () {
    canvas = document.querySelector("#c");
    engine = new BABYLON.Engine(canvas, true);

    createScene();

    engine.runRenderLoop(function () {
        scene.render();
        scene.activeCamera.alpha += (2 * Math.PI)/(FPS * 10);
    });

    setTimeout(adjustSceneFps, 1000);
    function adjustSceneFps() {
        FPS = engine.getFps();
        scene.getPhysicsEngine().setTimeStep(1 / FPS);
    }
};

let createScene = function() {

    scene = new BABYLON.Scene(engine);
    scene.enablePhysics(new BABYLON.Vector3(0, -9.8, 0), new BABYLON.OimoJSPlugin());
    scene.getPhysicsEngine().setTimeStep(1 / FPS);

    let camera = new BABYLON.ArcRotateCamera("Camera", -2.2, 1.0, 500, BABYLON.Vector3.Zero(), scene);
    camera.setPosition(new BABYLON.Vector3(0, 100 * PHYSICS_SCALE, -300 * PHYSICS_SCALE));
    camera.attachControl(canvas);
    new BABYLON.HemisphericLight("hemi", new BABYLON.Vector3(0, 1, 0), scene);
    new BABYLON.DirectionalLight("dir01", new BABYLON.Vector3(0.0, -1.0, 0.5), scene);

    let mat = new BABYLON.StandardMaterial("ground", scene);
    let t = new BABYLON.Texture("../../../../assets/textures/grass.jpg", scene); // grass.jpg

    t.uScale = t.vScale = 2;
    mat.diffuseTexture = t;
    mat.specularColor = BABYLON.Color3.Black();
    let g = BABYLON.Mesh.CreateBox("ground", 400 * PHYSICS_SCALE, scene);
    g.position.y = -20 * PHYSICS_SCALE;
    g.scaling.y = 0.01;
    g.material = mat;
    g.physicsImpostor = new BABYLON.PhysicsImpostor(g, BABYLON.PhysicsImpostor.BoxImpostor, {
        move: false,
        mass: 0,
        friction: 1.0,
        restitution: 1.0
    }, scene);

    // Get a random number between two limits
    let randomNumber = function(min, max) {
        if (min == max) {
            return (min);
        }
        let random = Math.random();
        return ((random * (max - min)) + min);
    };

    let objects = [];
    let getPosition = function(y) {
        return new BABYLON.Vector3(randomNumber(-25, 25) * PHYSICS_SCALE, (randomNumber(0, 100) + y) * PHYSICS_SCALE, randomNumber(-25, 25) * PHYSICS_SCALE);
    };

    const DOMINO_SIZE = 15;
    let pos = 0;
    for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
            pos = x + (15 - y) * 16;
            let domino = BABYLON.Mesh.CreateBox("Domino" + String(pos), DOMINO_SIZE * PHYSICS_SCALE, scene);
            x1 = (-100 + x * DOMINO_SIZE * 1.0) * PHYSICS_SCALE;
            y1 = (-10) * PHYSICS_SCALE;
            z1 = (-150 + y * DOMINO_SIZE * 1.2) * PHYSICS_SCALE;
            domino.position = new BABYLON.Vector3(x1, y1, z1);
            domino.scaling = new BABYLON.Vector3(0.1, 1.0, 1.0);
            let materialDomino = new BABYLON.StandardMaterial("domino", scene);
            rgbColor = getRgbColor(dataSet[pos]);
            materialDomino.diffuseColor = new BABYLON.Color3(rgbColor[0], rgbColor[1], rgbColor[2]);
            domino.material = materialDomino;
            domino.physicsImpostor = new BABYLON.PhysicsImpostor(domino, BABYLON.PhysicsImpostor.BoxImpostor, {
                mass: 1
            }, scene);
        }
    }
    const BALL_SIZE = 15;
    for (let y = 0; y < 16; y++) {
        let ball = BABYLON.Mesh.CreateSphere("ball" + String(y), 16, BALL_SIZE * PHYSICS_SCALE, scene);
        x1 = -105 * PHYSICS_SCALE;
        y1 = (10 + Math.random()) * PHYSICS_SCALE;
        z1 = (-150 + y * BALL_SIZE * 1.2) * PHYSICS_SCALE;
        ball.position = new BABYLON.Vector3(x1, y1, z1);
        ball.rotation.x = 0.1;
        ball.rotation.y = 0.1;
        ball.rotation.z = 0.1;
        materialBall = new BABYLON.StandardMaterial("ball", scene);
        materialBall.diffuseTexture = new BABYLON.Texture("../../../../assets/textures/football.png", scene);
        rgbColor = getRgbColor("白");
        materialBall.emissiveColor = new BABYLON.Color3(rgbColor[0], rgbColor[1], rgbColor[2]);
        ball.material = materialBall;
        ball.physicsImpostor = new BABYLON.PhysicsImpostor(ball, BABYLON.PhysicsImpostor.SphereImpostor, {
            mass: 1
        }, scene);
    }
    scene.registerBeforeRender(function() {
        objects.forEach(function(obj) {
            if (obj.position.y < -100 * PHYSICS_SCALE) {
                obj.position = getPosition(200);
                obj.physicsImpostor.setLinearVelocity(new BABYLON.Vector3(0,0,0));
            }
        });
    });
/*    
*/
};
