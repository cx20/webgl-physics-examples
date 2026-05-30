import * as pc from 'playcanvas';
import { CameraControls } from 'playcanvas/scripts/esm/camera-controls.mjs';
import { loadWasmModuleAsync } from "https://rawcdn.githack.com/playcanvas/engine/f8e929634cf7b057f7c80ac206a4f3d2d11843dc/examples/src/wasm-loader.js";

const _DBG_COLOR_DYNAMIC = new pc.Color(0, 1, 0, 1);
const _DBG_COLOR_STATIC  = new pc.Color(1, 1, 0, 1);

function _drawWireCone(app, mat, radius, height, color) {
    const apex = new pc.Vec3();
    mat.transformPoint(new pc.Vec3(0, height * 0.5, 0), apex);
    const segs = 16;
    const pts = [];
    const ring = [];
    for (let i = 0; i <= segs; i++) {
        const t = (i / segs) * Math.PI * 2;
        const p = new pc.Vec3();
        mat.transformPoint(new pc.Vec3(Math.cos(t) * radius, -height * 0.5, Math.sin(t) * radius), p);
        ring.push(p);
        if (i > 0) { pts.push(ring[i - 1]); pts.push(p); }
    }
    const step = Math.floor(segs / 4);
    for (let k = 0; k < 4; k++) { pts.push(apex); pts.push(ring[k * step]); }
    app.drawLines(pts, pts.map(() => color), false);
}

function drawPhysicsDebug(app, entities) {
    for (const entity of entities) {
        const col = entity.collision;
        if (!col || !col.type) continue;
        const isDynamic = entity.rigidbody?.type === pc.BODYTYPE_DYNAMIC;
        const color = isDynamic ? _DBG_COLOR_DYNAMIC : _DBG_COLOR_STATIC;
        const mat = new pc.Mat4().setTRS(entity.getPosition(), entity.getRotation(), pc.Vec3.ONE);
        switch (col.type) {
            case 'box': {
                const h = col.halfExtents;
                app.drawWireAlignedBox(new pc.Vec3(-h.x, -h.y, -h.z), new pc.Vec3(h.x, h.y, h.z), color, false, undefined, mat);
                break;
            }
            case 'cone':
                _drawWireCone(app, mat, col.radius, col.height, color);
                break;
        }
    }
}

let showWireframe = true;

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

    window.addEventListener("keydown", function (event) {
        const isWKey = event.code === 'KeyW' || event.key === 'w' || event.key === 'W';
        if (!isWKey || event.repeat) return;
        showWireframe = !showWireframe;
        const hint = document.getElementById('hint');
        if (hint) hint.textContent = 'W: wireframe ' + (showWireframe ? 'ON' : 'OFF');
    });

    app.scene.ambientLight = new pc.Color(0.2, 0.2, 0.2);

    function createColorMaterial(color) {
        var material = new pc.StandardMaterial();
        material.diffuse = color;
        material.update()
        return material;
    }

    function createTransparentMaterial(color) {
        var material = new pc.StandardMaterial();
        material.opacity = 0.5;
        material.blendType = pc.BLEND_NORMAL;
        material.diffuse = color;
        material.update()
        return material;
    }

    function createTextureMaterial(imageFile) {
        let material = new pc.StandardMaterial();
        material.diffuseMap = getTexture(imageFile);
        material.update()

        return material;
    }
    
    function getTexture(imageFile) {
        let texture = new pc.Texture(app.graphicsDevice, {
            width: 512,
            height: 512
        });
        let img = new Image();
        img.onload = function() {
            texture.flipY = false;
            texture.minFilter = pc.FILTER_LINEAR;
            texture.magFilter = pc.FILTER_LINEAR;
            texture.addressU = pc.ADDRESS_CLAMP_TO_EDGE;
            texture.addressV = pc.ADDRESS_CLAMP_TO_EDGE;
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
    camera.addComponent('script');
    app.root.addChild(camera);
    const cc = camera.script.create(CameraControls);
    cc.enableFly = false;
    cc.reset(new pc.Vec3(0, 0, 0), new pc.Vec3(0, 10, 40));

    let boxDataSet = [
        { size:[10, 10,  1], pos:[ 0, 5,-5], rot:[0,0,0] },
        { size:[10, 10,  1], pos:[ 0, 5, 5], rot:[0,0,0] },
        { size:[ 1, 10, 10], pos:[-5, 5, 0], rot:[0,0,0] },
        { size:[ 1, 10, 10], pos:[ 5, 5, 0], rot:[0,0,0] } 
    ];

    const staticDebugEntities = [];
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
        staticDebugEntities.push(box);
    }

    const SCALE = 4;
    let carrotBody = new pc.Entity("carrotBody");
    carrotBody.setLocalPosition(0, 20, 0);
    carrotBody.addComponent("collision", { type: "cone", height: 1 * SCALE, radius: 0.25 * SCALE });
    carrotBody.addComponent("rigidbody", { type: "dynamic", restitution: 0.5 });
    let carrotModel = new pc.Entity("carrotModel");
    carrotModel.setLocalScale(SCALE/2, SCALE, SCALE/2);
    let carrotBodyMaterial = createTextureMaterial("../../../../assets/textures/carrot.jpg");
    carrotModel.addComponent("model", { type: "cone", material: carrotBodyMaterial });
    carrotBody.addChild(carrotModel);
    //app.root.addChild(carrotBody);

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
    staticDebugEntities.push(floor);

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

    let time = 0;
    let maxCarrots = 200;
    app.on("update", function (dt) {
        time += dt;
        if (time > 0.01 && numCarrots < maxCarrots) {
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

        if (showWireframe) {
            drawPhysicsDebug(app, staticDebugEntities);
            drawPhysicsDebug(app, carrots);
        }
    });
}
