if (wasmSupported()) {
    loadWasmModuleAsync('Ammo', 'https://playcanvas.github.io/lib/ammo/ammo.wasm.js', 'https://playcanvas.github.io/lib/ammo/ammo.wasm.wasm', init);
} else {
    loadWasmModuleAsync('Ammo', 'https://playcanvas.github.io/lib/ammo/ammo.js', '', init);
}

function init() {
    let canvas = document.getElementById("c");

    let app = new pc.Application(canvas);
    app.start();

    app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
    app.setCanvasResolution(pc.RESOLUTION_AUTO);

    window.addEventListener("resize", function () {
        app.resizeCanvas(canvas.width, canvas.height);
    });

    let miniStats = new pcx.MiniStats(app);

    app.scene.ambientLight = new pc.Color(0.2, 0.2, 0.2);

    function createTextureMaterial() {
        let material = new pc.scene.PhongMaterial();
        material.diffuseMap = getTexture();
        material.update()

        return material;
    }
    
    function getTexture() {
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
    camera.translate(0, 5, 10);
    camera.lookAt(0, 0, 0);
    app.root.addChild(camera);

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

}
