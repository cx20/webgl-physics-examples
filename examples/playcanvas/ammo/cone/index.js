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

    let miniStats = new pc.MiniStats(app);

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
            texture.flipY = false;
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
        fav: 60,
        nearClip: 0.01,
        farClip: 1000
    });
    camera.translate(18, 20, 30);
    camera.lookAt(0, 0, 0);
    app.root.addChild(camera);

    let boxDataSet = [
        { size:[10, 10,  1], pos:[ 0, 5,-5], rot:[0,0,0] },
        { size:[10, 10,  1], pos:[ 0, 5, 5], rot:[0,0,0] },
        { size:[ 1, 10, 10], pos:[-5, 5, 0], rot:[0,0,0] },
        { size:[ 1, 10, 10], pos:[ 5, 5, 0], rot:[0,0,0] } 
    ];

    let surfaces = [];
    for (let i = 0; i < boxDataSet.length; i++) {
        let size = boxDataSet[i].size
        let pos = boxDataSet[i].pos;
        let rot = boxDataSet[i].rot;

        let box = new pc.Entity("box");
        box.setLocalPosition(pos[0], pos[1], pos[2]);
        box.addComponent("collision", { type: "box", halfExtents: [size[0]/2, size[1]/2, size[2]/2] });
        box.addComponent("rigidbody", { type: "static", friction: 0.6, restitution: 0.5 });
        let boxModel = new pc.Entity("boxModel");
        boxModel.setLocalScale(size[0], size[1], size[2]);
        let whiteMaterial = createTransparentMaterial(new pc.Color(1, 1, 1));
        boxModel.addComponent("model", { type: "box", material: whiteMaterial });
        box.addChild(boxModel);
        app.root.addChild(box);
    }

    const SCALE = 4;
    let carrotBody = new pc.Entity("carrotBody");
    carrotBody.setLocalPosition(0, 10, 0);
    carrotBody.addComponent("collision", { type: "cone", height: 1 * SCALE, radius: 0.25 * SCALE });
    carrotBody.addComponent("rigidbody", { type: "dynamic", restitution: 0.5 });
    let carrotModel = new pc.Entity("carrotModel");
    carrotModel.setLocalScale(SCALE/2, SCALE, SCALE/2);
    let carrotBodyMaterial = createTextureMaterial("../../../../assets/textures/carrot.jpg");
    carrotModel.addComponent("model", { type: "cone", material: carrotBodyMaterial });
    carrotBody.addChild(carrotModel);
    app.root.addChild(carrotBody);

    let floor = new pc.Entity("floor");
    floor.setLocalPosition(0, -2, 0);
    floor.addComponent("collision", { type: "box", halfExtents: [20, 2, 20] });
    floor.addComponent("rigidbody", { type: "static", friction: 0.6, restitution: 0.8 });
    let floorModel = new pc.Entity("floorModel");
    floorModel.setLocalScale(40, 4, 40);
    //let floorMaterial = createColorMaterial(new pc.Color(0.8, 0.8, 0.8));
    let floorMaterial = createTextureMaterial("../../../../assets/textures/grass.jpg");
    floorModel.addComponent("model", { type: "box", material: floorMaterial });
    floor.addChild(floorModel);
    app.root.addChild(floor);

    let numCarrots = 0;
    let carrots = [];
    function spawnCarrot() {
        var clone = carrotBody.clone();
        let x = -5 + Math.random() * 10;
        let y = 20 + Math.random() * 10;
        let z = -5 + Math.random() * 10;
        clone.setLocalPosition(x, y, z);
        carrots.push(clone);
        app.root.addChild(clone);
        numCarrots++;
    }

    let angle = 0;
    let time = 0;
    let maxCarrots = 200;
    app.on("update", function (dt) {
        angle += 0.5;
        time += dt;
        if (time > 0.05 && numCarrots < maxCarrots) {
            spawnCarrot();
            time = 0;
        }
        
        for (let i = 0; i < numCarrots; i++ ) {
            let carrot = carrots[i];
            if (carrot.localPosition.y < -10) {
                let x = -5 + Math.random() * 10;
                let y = 20 + Math.random() * 10;
                let z = -5 + Math.random() * 10;
                carrot.setLocalPosition(x, y, z);
                carrot.rigidbody.linearVelocity = pc.Vec3.ZERO;
                carrot.rigidbody.angularVelocity = pc.Vec3.ZERO;
                carrot.rigidbody.syncEntityToBody();
            }
        }
        
        camera.setLocalPosition(Math.sin(Math.PI*angle/180) * 40, 10, Math.cos(Math.PI*angle/180) * 40);
        camera.lookAt(0, 0, 0);
    });
}
