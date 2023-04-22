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
const dataSet = [
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
    const colorHash = {
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
let canvas;const FPS = 60;    // default is 60 FPS
const PHYSICS_SCALE = 1/10;

async function init() {

    canvas = document.querySelector("#c");
    globalThis.HK = await HavokPhysics();
    engine = new BABYLON.Engine(canvas, true);

    scene = createScene();

    engine.runRenderLoop(function () {
        scene.render();
    });
};

const createScene = function() {

    scene = new BABYLON.Scene(engine);
    scene.enablePhysics(new BABYLON.Vector3(0, -9.8, 0), new BABYLON.HavokPlugin());
    scene.getPhysicsEngine().setTimeStep(scene.getAnimationRatio());

    const camera = new BABYLON.ArcRotateCamera("Camera", -2.2, 1.0, 500, BABYLON.Vector3.Zero(), scene);
    camera.setPosition(new BABYLON.Vector3(0, 50 * PHYSICS_SCALE, -500 * PHYSICS_SCALE));
    camera.attachControl(canvas);
    new BABYLON.HemisphericLight("hemi", new BABYLON.Vector3(0, 1, 0), scene);
    new BABYLON.DirectionalLight("dir01", new BABYLON.Vector3(0.0, -1.0, 0.5), scene);

    const mat = new BABYLON.StandardMaterial("ground", scene);
    const t = new BABYLON.Texture("../../../../assets/textures/grass.jpg", scene); // grass.jpg

    t.uScale = t.vScale = 2;
    mat.diffuseTexture = t;
    mat.specularColor = BABYLON.Color3.Black();
    const g = BABYLON.Mesh.CreateBox("ground", 400 * PHYSICS_SCALE, scene);
    g.position.y = -100 * PHYSICS_SCALE;
    g.scaling.y = 0.01;
    g.material = mat;
    gAggregate = new BABYLON.PhysicsAggregate(g, BABYLON.PhysicsShapeType.BOX, {
        move: false,
        mass: 0,
        friction: 1.0,
        restitution: 1.0
    }, scene);

    // Get a random number between two limits
    const randomNumber = function(min, max) {
        if (min == max) {
            return (min);
        }
        const random = Math.random();
        return ((random * (max - min)) + min);
    };

    const objects = [];
    const getPosition = function(y) {
        return new BABYLON.Vector3(randomNumber(-25, 25) * PHYSICS_SCALE, (randomNumber(0, 100) + y) * PHYSICS_SCALE, randomNumber(-25, 25) * PHYSICS_SCALE);
    };

    const BOX_SIZE = 15;
    let i = 0;
    for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
            i = x + (15 - y) * 16;
            const s = BABYLON.Mesh.CreateBox("Box" + String(i), BOX_SIZE * PHYSICS_SCALE, scene);
            const x1 = (-130 + x * BOX_SIZE * 1.2 + Math.random()) * PHYSICS_SCALE;
            const y1 = (30 + y * BOX_SIZE * 1.2) * PHYSICS_SCALE;
            const z1 = (1.0 * Math.random()) * PHYSICS_SCALE;
            s.position = new BABYLON.Vector3(x1, y1, z1);
            const matCube = new BABYLON.StandardMaterial("ball", scene);
            const rgbColor = getRgbColor(dataSet[i]);
            matCube.diffuseColor = new BABYLON.Color3(rgbColor[0], rgbColor[1], rgbColor[2]);
            s.material = matCube;
            s.aggregate = new BABYLON.PhysicsAggregate(s, BABYLON.PhysicsShapeType.BOX, { mass: 1, friction: 1.0, restitution: 0.0}, scene);

            // SAVE OBJECT
            objects.push(s);
        }
    }
    scene.registerBeforeRender(function() {
        objects.forEach(function(obj) {
            if (obj.position.y < -100 * PHYSICS_SCALE) {
                obj.position = getPosition(200);
                //obj.aggregate.body.setLinearVelocity(new BABYLON.Vector3(0,0,0));
                obj.aggregate = new BABYLON.PhysicsAggregate(obj, BABYLON.PhysicsShapeType.BOX, { mass: 1, friction: 1.0, restitution: 0.0}, scene);
            }
        });
        scene.activeCamera.alpha += Math.PI * 1.0 / 180.0 * scene.getAnimationRatio();
    });

    return scene;
};

init();
