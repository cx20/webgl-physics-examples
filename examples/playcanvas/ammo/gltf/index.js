import * as pc from 'playcanvas';
import { loadWasmModuleAsync } from "https://rawcdn.githack.com/playcanvas/engine/f8e929634cf7b057f7c80ac206a4f3d2d11843dc/examples/src/wasm-loader.js";

loadWasmModuleAsync(
    'Ammo', 
    'https://rawcdn.githack.com/playcanvas/engine/f8e929634cf7b057f7c80ac206a4f3d2d11843dc/examples/src/lib/ammo/ammo.wasm.js',
    'https://rawcdn.githack.com/playcanvas/engine/f8e929634cf7b057f7c80ac206a4f3d2d11843dc/examples/src/lib/ammo/ammo.wasm.wasm',
    init);

function init() {
    let canvas = document.getElementById("c");

    let app = new pc.Application(canvas);
    app.start();

    app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
    app.setCanvasResolution(pc.RESOLUTION_AUTO);

    window.addEventListener("resize", function () {
        app.resizeCanvas(canvas.width, canvas.height);
    });

    app.scene.ambientLight = new pc.Color(0.2, 0.2, 0.2);

    function createColorMaterial(color) {
        var material = new pc.PhongMaterial();
        material.diffuse = color;
        material.update()
        return material;
    }

    function createTransparentMaterial(color) {
        var material = new pc.PhongMaterial();
        material.opacity = 0.5;
        material.blendType = pc.BLEND_NORMAL;
        material.diffuse = color;
        material.update()
        return material;
    }

    function createTextureMaterial(imageFile) {
        let material = new pc.PhongMaterial();
        material.diffuseMap = getTexture(imageFile);
        material.update()

        return material;
    }
    
    function getTexture(imageFile) {
        let texture = new pc.gfx.Texture(app.graphicsDevice);
        let img = new Image();
        img.onload = function() {
            texture.minFilter = pc.gfx.FILTER_LINEAR;
            texture.magFilter = pc.gfx.FILTER_LINEAR;
            texture.addressU = pc.gfx.ADDRESS_CLAMP_TO_EDGE;
            texture.addressV = pc.gfx.ADDRESS_CLAMP_TO_EDGE;
            texture.setSource(img);
        };
        img.crossOrigin = "anonymous";
        img.src = imageFile;
        return texture;
    }

    let whiteMaterial = createColorMaterial(new pc.Color(0.5, 0.5, 0.5));
    let transparentMaterial = createTransparentMaterial(new pc.Color(1, 1, 1));

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
    camera.translate(0, 5, 10);
    camera.lookAt(0, 0, 0);
    app.root.addChild(camera);

    let duckBody = new pc.Entity("duckBody");
    let url =  'https://rawcdn.githack.com/cx20/gltf-test/5465cc37/sampleModels/Duck/glTF/Duck.gltf';
    let filename = url.split('/').pop();
    app.assets.loadFromUrlAndFilename(url, filename, "container", function (err, asset) {
        var resource = asset.resource;
        let duckModel = new pc.Entity('duckModel');
        duckModel.addComponent('model', {
            type: "asset",
            asset: resource.model
        });
        let aabb = duckModel.model.meshInstances[0].aabb;
        let center = aabb.center;
        let half = aabb.halfExtents;
        duckModel.setLocalPosition(-center.x, -center.y, -center.z);
        duckBody.setLocalPosition(0, 10, 0);
        duckBody.addComponent("collision", { type: "box", halfExtents: [half.x, half.y, half.z] });
        duckBody.addComponent("rigidbody", { type: "dynamic", restitution: 0.5 });
        duckBody.addChild(duckModel);

        let boundingBoxModel = new pc.Entity("boundingBox");
        boundingBoxModel.setLocalScale(half.x*2, half.y*2, half.z*2);
        boundingBoxModel.addComponent("model", { type: "box", material: transparentMaterial });
        duckBody.addChild(boundingBoxModel);

        duckBody.setLocalEulerAngles(0, 0, 0.5);
        app.root.addChild(duckBody);
    });

    let floor = new pc.Entity("floor");
    floor.setLocalPosition(0, -0.5, 0);
    floor.addComponent("collision", { type: "box", halfExtents: [5, 0.5, 5] });
    floor.addComponent("rigidbody", { type: "static", restitution: 0.5 });
    let floorModel = new pc.Entity("floorModel");
    floorModel.setLocalScale(10, 1, 10);
    floorModel.addComponent("model", { type: "box", material: whiteMaterial });
    floor.addChild(floorModel);
    app.root.addChild(floor);

    let angle = 0;
    let time = 0;
    let maxErasers = 200;
    const EXCEPTED_FPS = 60;
    app.on("update", function (dt) {
        let ADJUST_SPEED = dt / (1/EXCEPTED_FPS);
        angle += 0.5 * ADJUST_SPEED;
        camera.setLocalPosition(Math.sin(Math.PI*angle/180) * 4, 3, Math.cos(Math.PI*angle/180) * 4);
        camera.lookAt(0, 0, 0);
    });
}
