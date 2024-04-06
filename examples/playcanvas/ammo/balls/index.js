import { loadWasmModuleAsync } from "https://rawcdn.githack.com/playcanvas/engine/f8e929634cf7b057f7c80ac206a4f3d2d11843dc/examples/src/wasm-loader.js";

const dataSet = [
    {imageFile:"../../../../assets/textures/Basketball.jpg", scale:1.0}, // Basketball.jpg
    {imageFile:"../../../../assets/textures/BeachBall.jpg",  scale:0.9}, // BeachBall.jpg
    {imageFile:"../../../../assets/textures/Football.jpg",   scale:1.0}, // Football.jpg
    {imageFile:"../../../../assets/textures/Softball.jpg",   scale:0.3}, // Softball.jpg
    {imageFile:"../../../../assets/textures/TennisBall.jpg", scale:0.3}, // TennisBall.jpg
];

loadWasmModuleAsync('Ammo', 'https://rawcdn.githack.com/playcanvas/engine/f8e929634cf7b057f7c80ac206a4f3d2d11843dc/examples/src/lib/ammo/ammo.wasm.js', 'https://rawcdn.githack.com/playcanvas/engine/f8e929634cf7b057f7c80ac206a4f3d2d11843dc/examples/src/lib/ammo/ammo.wasm.wasm', init);

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
        let texture = new pc.gfx.Texture(app.graphicsDevice, {
            width: 512,
            height: 512
        });
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

    //let textureMaterial = createTextureMaterial();

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

    let spheres = [];
    for (let i = 0; i < dataSet.length; i++ ) {
        let imageFile = dataSet[i].imageFile;
        let scale = dataSet[i].scale * 2    ;
        let sphere = new pc.Entity("sphere" + i);
        sphere.setLocalPosition(Math.random(), i * 10, Math.random());
        sphere.addComponent("collision", { type: "sphere", radius: scale/2 });
        sphere.addComponent("rigidbody", { type: "dynamic", friction: 0.4, restitution: 0.8 });
        let sphereModel = new pc.Entity("sphereModel" + i);
        sphereModel.setLocalScale(scale, scale, scale);
        let material = createTextureMaterial(imageFile);
        sphereModel.addComponent("model", { type: "sphere", material: material });
        sphere.addChild(sphereModel);
        spheres.push(sphere);
    }

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

    let numBalls = 0;
    let balls = [];
    function spawnBall() {
        let index = Math.floor(Math.random() * dataSet.length);
        var sphere = spheres[index];
        var clone = sphere.clone();
        let x = -5 + Math.random() * 10;
        let y = 20 + Math.random() * 10;
        let z = -5 + Math.random() * 10;
        clone.setLocalPosition(x, y, z);
        balls.push(clone);
        app.root.addChild(clone);
        numBalls++;
    }

    let angle = 0;
    let time = 0;
    let maxBalls = 200;
    const EXCEPTED_FPS = 60;
    app.on("update", function (dt) {
        let ADJUST_SPEED = dt / (1/EXCEPTED_FPS);
        angle += 0.5 * ADJUST_SPEED;
        time += dt;
        if (time > 0.05 && numBalls < maxBalls) {
            spawnBall();
            time = 0;
        }
        
        for (let i = 0; i < numBalls; i++ ) {
            let ball = balls[i];
            if (ball.localPosition.y < -10) {
                let x = -5 + Math.random() * 10;
                let y = 20 + Math.random() * 10;
                let z = -5 + Math.random() * 10;
                ball.setLocalPosition(x, y, z);
                ball.rigidbody.linearVelocity = pc.Vec3.ZERO;
                ball.rigidbody.angularVelocity = pc.Vec3.ZERO;
                ball.rigidbody.syncEntityToBody();
            }
        }
        
        camera.setLocalPosition(Math.sin(Math.PI*angle/180) * 40, 10, Math.cos(Math.PI*angle/180) * 40);
        camera.lookAt(0, 0, 0);
    });
}
