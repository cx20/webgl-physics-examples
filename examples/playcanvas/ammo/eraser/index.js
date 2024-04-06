import { loadWasmModuleAsync } from "https://rawcdn.githack.com/playcanvas/engine/f8e929634cf7b057f7c80ac206a4f3d2d11843dc/examples/src/wasm-loader.js";

const w = 1.0;
const h = 0.2;
const d = 0.5;
let positions = [ 
    // Front face
    -w, -h,  d, // v0
     w, -h,  d, // v1
     w,  h,  d, // v2
    -w,  h,  d, // v3
    // Back face
    -w, -h, -d, // v4
     w, -h, -d, // v5
     w,  h, -d, // v6
    -w,  h, -d, // v7
    // Top face
     w,  h,  d, // v2
    -w,  h,  d, // v3
    -w,  h, -d, // v7
     w,  h, -d, // v6
    // Bottom face
    -w, -h,  d, // v0
     w, -h,  d, // v1
     w, -h, -d, // v5
    -w, -h, -d, // v4
     // Right face
     w, -h,  d, // v1
     w,  h,  d, // v2
     w,  h, -d, // v6
     w, -h, -d, // v5
     // Left face
    -w, -h,  d, // v0
    -w,  h,  d, // v3
    -w,  h, -d, // v7
    -w, -h, -d  // v4
];
let normals = [
     0, -1,  0,  0, -1,  0,  0, -1,  0,  0, -1,  0,
     0,  1,  0,  0,  1,  0,  0,  1,  0,  0,  1,  0,
     0,  0, -1,  0,  0, -1,  0,  0, -1,  0,  0, -1,
     0,  0,  1,  0,  0,  1,  0,  0,  1,  0,  0,  1,
    -1,  0,  0, -1,  0,  0, -1,  0,  0, -1,  0,  0,
     1,  0,  0,  1,  0,  0,  1,  0,  0,  1,  0,  0
];
let textureCoords = [
    // Front face
    0.5,  1.0, // v0
    0.75, 1.0, // v1
    0.75, 0.5, // v2
    0.5,  0.5, // v3

    // Back face
    0.25, 1.0, // v4
    0.5,  1.0, // v5
    0.5,  0.5, // v6
    0.25, 0.5, // v7

    // Top face
    0.75, 0.5, // v2
    0.5,  0.5, // v3
    0.5,  0.0, // v7
    0.75, 0.0, // v6

    // Bottom face
    0.0,  1.0, // v0
    0.25, 1.0, // v1
    0.25, 0.5, // v5
    0.0,  0.5, // v4

    // Right face
    0.0,  0.5, // v1
    0.0,  0.0, // v2
    0.25, 0.0, // v6
    0.25, 0.5, // v5

    // Left face
    0.5,  0.5, // v0
    0.5,  0.0, // v3
    0.25, 0.0, // v7
    0.25, 0.5  // v4
];
let indices = [
     0,  2,  1,  0,  3,  2,
     4,  5,  6,  4,  6,  7,
     8,  9, 10,  8, 10, 11,
    12, 15, 14, 12, 14, 13,
    16, 17, 18, 16, 18, 19,
    20, 23, 22, 20, 22, 21
];
let options = {
    indices: indices,
    normals: normals,
    uvs: textureCoords
};

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

    let Cube = pc.createScript('cube');
    Cube.prototype.initialize = function () {
        let node = new pc.scene.GraphNode();
        let mesh = pc.createMesh(app.graphicsDevice, positions, options);

        let material = new pc.StandardMaterial();
        material.diffuseMap = getTexture("https://cx20.github.io/webgl-physics-examples/assets/textures/eraser_001/eraser.png");
        material.cull = pc.CULLFACE_NONE;

        let instance = new pc.scene.MeshInstance(node, mesh, material);

        let model = new pc.scene.Model();
        model.graph = node;
        model.meshInstances = [ instance ];

        this.entity.addChild(node);
        app.scene.addModel(model);
    };

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
            height: 256
        });
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

    const SCALE = 2;
    let eraserBody = new pc.Entity("eraserBody");
    eraserBody.setLocalPosition(0, 20, 0);
    eraserBody.addComponent("collision", { type: "box", halfExtents: [1 * SCALE, 0.2 * SCALE, 0.5 * SCALE] });
    eraserBody.addComponent("rigidbody", { type: "dynamic", restitution: 0.5 });
    let eraserModel = new pc.Entity("eraserModel");
    eraserModel.setLocalScale(SCALE, SCALE, SCALE);
    eraserModel.addComponent('script');
    eraserModel.script.create('cube');
    eraserBody.addChild(eraserModel);
    //app.root.addChild(eraserBody);

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

    let numErasers = 0;
    let erasers = [];
    function spawnEraser() {
        var clone = eraserBody.clone();
        let x = -5 + Math.random() * 10;
        let y = 20 + Math.random() * 10;
        let z = -5 + Math.random() * 10;
        clone.setLocalPosition(x, y, z);
        erasers.push(clone);
        app.root.addChild(clone);
        numErasers++;
    }

    let angle = 0;
    let time = 0;
    let maxErasers = 200;
    const EXCEPTED_FPS = 60;
    app.on("update", function (dt) {
        let ADJUST_SPEED = dt / (1/EXCEPTED_FPS);
        angle += 0.5 * ADJUST_SPEED;
        time += dt;
        if (time > 0.05 && numErasers < maxErasers) {
            spawnEraser();
            time = 0;
        }
        
        for (let i = 0; i < numErasers; i++ ) {
            let eraser = erasers[i];
            if (eraser.localPosition.y < -10) {
                let x = -5 + Math.random() * 10;
                let y = 20 + Math.random() * 10;
                let z = -5 + Math.random() * 10;
                eraser.setLocalPosition(x, y, z);
                eraser.rigidbody.linearVelocity = pc.Vec3.ZERO;
                eraser.rigidbody.angularVelocity = pc.Vec3.ZERO;
                eraser.rigidbody.syncEntityToBody();
            }
        }
        
        camera.setLocalPosition(Math.sin(Math.PI*angle/180) * 40, 10, Math.cos(Math.PI*angle/180) * 40);
        camera.lookAt(0, 0, 0);
    });
}
