import * as pc from 'playcanvas';
import { CameraControls } from 'playcanvas/scripts/esm/camera-controls.mjs';
import { loadWasmModuleAsync } from "https://rawcdn.githack.com/playcanvas/engine/f8e929634cf7b057f7c80ac206a4f3d2d11843dc/examples/src/wasm-loader.js";

const _DBG_COLOR_DYNAMIC = new pc.Color(0, 1, 0, 1);
const _DBG_COLOR_STATIC  = new pc.Color(1, 1, 0, 1);

let DOT_SIZE = 16;
let X_START_POS = -7;
let Y_START_POS =  0;
let Z_START_POS = -7;
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


// ***********    Initialize app   *******************
loadWasmModuleAsync(
    'Ammo',
    'https://rawcdn.githack.com/playcanvas/engine/f8e929634cf7b057f7c80ac206a4f3d2d11843dc/examples/src/lib/ammo/ammo.wasm.js',
    'https://rawcdn.githack.com/playcanvas/engine/f8e929634cf7b057f7c80ac206a4f3d2d11843dc/examples/src/lib/ammo/ammo.wasm.wasm',
    init);

function drawPhysicsDebug(app, entities) {
    for (const entity of entities) {
        const col = entity.collision;
        if (!col || col.type !== 'box') continue;
        const isDynamic = entity.rigidbody?.type === pc.BODYTYPE_DYNAMIC;
        const color = isDynamic ? _DBG_COLOR_DYNAMIC : _DBG_COLOR_STATIC;
        const mat = new pc.Mat4().setTRS(entity.getPosition(), entity.getRotation(), pc.Vec3.ONE);
        const h = col.halfExtents;
        app.drawWireAlignedBox(
            new pc.Vec3(-h.x, -h.y, -h.z),
            new pc.Vec3( h.x,  h.y,  h.z),
            color, false, undefined, mat
        );
    }
}

let showWireframe = true;

function init() {
    // create a few materials for our objects
    let black  = createMaterial(new pc.Color( 0xdc/0xff, 0xaa/0xff, 0x6b/0xff ));
    let white  = createMaterial(new pc.Color( 0xff/0xff, 0xff/0xff, 0xff/0xff ));
    let beige  = createMaterial(new pc.Color( 0xff/0xff, 0xcc/0xff, 0xcc/0xff ));
    let brown  = createMaterial(new pc.Color( 0x80/0xff, 0x00/0xff, 0x00/0xff ));
    let red    = createMaterial(new pc.Color( 0xff/0xff, 0x00/0xff, 0x00/0xff ));
    let yellow = createMaterial(new pc.Color( 0xff/0xff, 0xff/0xff, 0x00/0xff ));
    let green  = createMaterial(new pc.Color( 0x00/0xff, 0xff/0xff, 0x00/0xff ));
    let ltblue = createMaterial(new pc.Color( 0x00/0xff, 0xff/0xff, 0xff/0xff ));
    let blue   = createMaterial(new pc.Color( 0x00/0xff, 0x00/0xff, 0xff/0xff ));
    let purple = createMaterial(new pc.Color( 0x80/0xff, 0x00/0xff, 0x80/0xff ));

    function getRgbColor( c )
    {
        let colorHash = {
            "無":black,   // 0x000000,
            "白":white,   // 0xffffff,
            "肌":beige,   // 0xffcccc,
            "茶":brown,   // 0x800000,
            "赤":red,     // 0xff0000,
            "黄":yellow,  // 0xffff00,
            "緑":green,   // 0x00ff00,
            "水":ltblue,  // 0x00ffff,
            "青":blue,    // 0x0000ff,
            "紫":purple   // 0x800080
        };
        return colorHash[ c ];
    }

    let canvas = document.getElementById("c");

    let app = new pc.Application(canvas);
    app.start();

    app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
    app.setCanvasResolution(pc.RESOLUTION_AUTO);

    window.addEventListener("keydown", function (event) {
        const isWKey = event.code === 'KeyW' || event.key === 'w' || event.key === 'W';
        if (!isWKey || event.repeat) return;
        showWireframe = !showWireframe;
        const hint = document.getElementById('hint');
        if (hint) hint.textContent = 'W: wireframe ' + (showWireframe ? 'ON' : 'OFF');
    });

    app.scene.ambientLight = new pc.Color(0.2, 0.2, 0.2);

    function createMaterial (color) {
        var material = new pc.StandardMaterial();
        material.diffuse = color;
        material.update()
        return material;
    }

    let floor = new pc.Entity("floor");
    floor.setLocalScale(20, 1, 20);
    floor.addComponent("collision", { type: "box", halfExtents: [10, 0.5, 10] });
    floor.addComponent("rigidbody", { type: "static", restitution: 0.5 });
    let floorModel = new pc.Entity("floorModel");
    floorModel.addComponent("model", { type: "box", material: white });
    floor.addChild(floorModel);
    app.root.addChild(floor);

    let light = new pc.Entity("light");
    light.addComponent("light", {
        type: "directional",
        color: new pc.Color(1, 1, 1),
        castShadows: true,
        shadowResolution: 2048
    });
    //light.setLocalEulerAngles(45, 30, 0);
    light.setLocalEulerAngles(45, 45, 45);
    app.root.addChild(light);

    let camera = new pc.Entity("camera");
    camera.addComponent("camera", {
        clearColor: new pc.Color(0.5, 0.5, 0.8),
        farClip: 50
    });
    camera.addComponent('script');
    app.root.addChild(camera);
    const cc = camera.script.create(CameraControls);
    cc.enableFly = false;
    cc.reset(new pc.Vec3(0, 0, 0), new pc.Vec3(0, 10, 15));

    let domino = new pc.Entity("domino");
    domino.setLocalPosition(0, 5, 0);
    domino.addComponent("collision", { type: "box", halfExtents: [0.1, 0.7, 0.5] });
    domino.addComponent("rigidbody", { type: "dynamic", restitution: 0.5 });
    domino.setLocalScale(0.2, 1, 1);
    let dominoModel = new pc.Entity("dominoModel");
    dominoModel.setLocalScale(0.2, 1.4, 1);
    dominoModel.addComponent("model", { type: "box", material: red });
    domino.addChild(dominoModel);

    let boxTemplate = new pc.Entity("boxTemplate");
    boxTemplate.addComponent("rigidbody", { type: "dynamic", mass: 10, restitution: 0.5 });
    boxTemplate.addComponent("collision", { type: "box", halfExtents: [0.5, 0.5, 0.5] });
    let boxTemplateModel = new pc.Entity("boxTemplateModel");
    boxTemplateModel.addComponent("model", { type: "box", mateiral: red });
    boxTemplate.addChild(boxTemplateModel);

    const debugEntities = [floor];

    for (let i = 0; i < dataSet.length; i++) {
        let x = X_START_POS + (i % 16) * .8;
        let z = Z_START_POS + Math.floor( i / 16 ) * 1.1;

        let clone = domino.clone();
        clone.children[0].model.material = getRgbColor(dataSet[i]);
        clone.setLocalPosition( x, 1, z );
        app.root.addChild(clone);
        debugEntities.push(clone);
    }

    for (let i = 0; i < 16; i++) {
        let clone = boxTemplate.clone();
        let x = X_START_POS + -0.2;
        let z = Z_START_POS + i * 1.1;
        clone.setLocalPosition( x, 3, z );
        app.root.addChild(clone);
        debugEntities.push(clone);
    }

    app.on('update', function () {
        if (showWireframe) drawPhysicsDebug(app, debugEntities);
    });
}