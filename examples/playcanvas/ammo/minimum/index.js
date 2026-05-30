import * as pc from 'playcanvas';
import { CameraControls } from 'playcanvas/scripts/esm/camera-controls.mjs';

import { loadWasmModuleAsync } from "https://rawcdn.githack.com/playcanvas/engine/f8e929634cf7b057f7c80ac206a4f3d2d11843dc/examples/src/wasm-loader.js";

const _DBG_COLOR_DYNAMIC = new pc.Color(0, 1, 0, 1);
const _DBG_COLOR_STATIC  = new pc.Color(1, 1, 0, 1);

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
    let canvas = document.getElementById("c");

    let app = new pc.Application(canvas);
    app.start();

    app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
    app.setCanvasResolution(pc.RESOLUTION_AUTO);

    window.addEventListener("resize", function () {
        app.resizeCanvas(canvas.width, canvas.height);
    });

    window.addEventListener("keydown", function (event) {
        const isWKey = event.code === 'KeyW' || event.key === 'w' || event.key === 'W';
        if (!isWKey || event.repeat) return;
        showWireframe = !showWireframe;
        const hint = document.getElementById('hint');
        if (hint) hint.textContent = 'W: wireframe ' + (showWireframe ? 'ON' : 'OFF');
    });

    app.scene.ambientLight = new pc.Color(0.2, 0.2, 0.2);

    function createTextureMaterial() {
        let material = new pc.StandardMaterial();
        material.diffuseMap = getTexture();
        material.update()

        return material;
    }
    
    function getTexture() {
        let texture = new pc.Texture(app.graphicsDevice, {
            width: 256,
            height: 256
        });
        let img = new Image();
        img.onload = function() {
            texture.minFilter = pc.FILTER_LINEAR;
            texture.magFilter = pc.FILTER_LINEAR;
            texture.addressU = pc.ADDRESS_CLAMP_TO_EDGE;
            texture.addressV = pc.ADDRESS_CLAMP_TO_EDGE;
            texture.setSource(img);
        };
        img.crossOrigin = "anonymous";
        img.src = "https://cx20.github.io/webgl-physics-examples/assets/textures/frog.jpg"; // frog.jpg
        return texture;
    }

    let textureMaterial = createTextureMaterial();

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
    cc.reset(new pc.Vec3(0, 0, 0), new pc.Vec3(0, 5, 10));

    let box = new pc.Entity("box");
    box.setLocalPosition(0, 10, 0);
    box.addComponent("collision", { type: "box", halfExtents: [1, 1, 1] });
    box.addComponent("rigidbody", { type: "dynamic", restitution: 0.5 });
    let boxModel = new pc.Entity("boxModel");
    boxModel.setLocalScale(2, 2, 2);
    boxModel.addComponent("model", { type: "box", material: textureMaterial });
    box.addChild(boxModel);
    app.root.addChild(box);

    let floor = new pc.Entity("floor");
    floor.setLocalPosition(0, -0.5, 0);
    floor.addComponent("collision", { type: "box", halfExtents: [5, 0.5, 5] });
    floor.addComponent("rigidbody", { type: "static", restitution: 0.5 });
    let floorModel = new pc.Entity("floorModel");
    floorModel.setLocalScale(10, 1, 10);
    floorModel.addComponent("model", { type: "box", material: textureMaterial });
    floor.addChild(floorModel);
    app.root.addChild(floor);

    const debugEntities = [box, floor];
    app.on('update', function () {
        if (showWireframe) drawPhysicsDebug(app, debugEntities);
    });

}
