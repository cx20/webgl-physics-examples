import * as pc from 'playcanvas';
import { CameraControls } from 'playcanvas/scripts/esm/camera-controls.mjs';
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

const _DBG_COLOR_DYNAMIC = new pc.Color(0, 1, 0, 1);
const _DBG_COLOR_STATIC  = new pc.Color(1, 1, 0, 1);

function drawPhysicsDebug(app, entities) {
    for (const entity of entities) {
        const col = entity.collision;
        if (!col || col.type !== 'box') continue;
        const isDynamic = entity.rigidbody?.type === pc.BODYTYPE_DYNAMIC;
        const color = isDynamic ? _DBG_COLOR_DYNAMIC : _DBG_COLOR_STATIC;
        const mat = new pc.Mat4().setTRS(entity.getPosition(), entity.getRotation(), pc.Vec3.ONE);
        const h = col.halfExtents;
        app.drawWireAlignedBox(new pc.Vec3(-h.x, -h.y, -h.z), new pc.Vec3(h.x, h.y, h.z), color, false, undefined, mat);
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

	function createEraserMesh() {
		let mesh = new pc.Mesh(app.graphicsDevice);
        mesh.setPositions(positions);
        mesh.setNormals(normals);
        mesh.setUvs(0, textureCoords);
        mesh.setIndices(indices);
        mesh.update();

        return mesh;
	}

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
        fov: 45,
        nearClip: 0.01,
        farClip: 1000
    });
    camera.addComponent('script');
    app.root.addChild(camera);
    const cc = camera.script.create(CameraControls);
    cc.enableFly = false;
    // Head-on camera matching the reference Havok eraser sample (eye at (0,0,40) looking at origin).
    cc.reset(new pc.Vec3(0, 0, 0), new pc.Vec3(0, 0, 40));

    // No walls: the reference Havok eraser sample has a single flat floor that the heap overflows.
    let boxDataSet = [];

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

    const SCALE = 2;
	let eraserMesh = createEraserMesh();
	let textureMaterial = createTextureMaterial("https://cx20.github.io/webgl-physics-examples/assets/textures/eraser_001/eraser.png");
	textureMaterial.cull = pc.CULLFACE_NONE;

	function createEraser(x, y, z) {
		let eraser = new pc.Entity("eraser");
		eraser.setLocalPosition(x, y, z);
		eraser.addComponent("collision", {
			type: "box",
			halfExtents: new pc.Vec3(1 * SCALE, 0.2 * SCALE, 0.5 * SCALE)
		});
		eraser.addComponent("rigidbody", {
			type: "dynamic",
			restitution: 0.5
		});
		let eraserModel = new pc.Entity("eraserModel");
		eraserModel.addComponent("render", {
			meshInstances: [new pc.MeshInstance(eraserMesh, textureMaterial)]
        });
		eraserModel.setLocalScale(SCALE, SCALE, SCALE);
		eraser.addChild(eraserModel);
		app.root.addChild(eraser);
		return eraser;
	}


    // Small low floor (no walls), matching the reference Havok eraser sample: a 20 x 0.1 x 20 slab
    // at y = -10 that the heap overflows.
    let floor = new pc.Entity("floor");
    floor.setLocalPosition(0, -10, 0);
    floor.addComponent("collision", { type: "box", halfExtents: [10, 0.05, 10] });
    floor.addComponent("rigidbody", { type: "static", friction: 0.6, restitution: 0.1 });
    let floorModel = new pc.Entity("floorModel");
    floorModel.setLocalScale(20, 0.1, 20);
    //let floorMaterial = createColorMaterial(new pc.Color(0.8, 0.8, 0.8));
    let floorMaterial = createTextureMaterial("../../../../assets/textures/grass.jpg");
    floorModel.addComponent("model", { type: "box", material: floorMaterial });
    floor.addChild(floorModel);
    app.root.addChild(floor);
    staticDebugEntities.push(floor);

    let numErasers = 0;
    let erasers = [];
    function spawnEraser() {
		let x = -5 + Math.random() * 10;
		let y = 20 + Math.random() * 10;
		let z = -5 + Math.random() * 10;
		let erase = createEraser(x, y, z);
		erasers.push(erase);
        numErasers++;
    }

    let time = 0;
    let maxErasers = 200;
    app.on("update", function (dt) {
        time += dt;
        if (time > 0.05 && numErasers < maxErasers) {
            spawnEraser();
            time = 0;
        }

        for (let i = 0; i < numErasers; i++ ) {
            let eraser = erasers[i];
            if (eraser.localPosition.y < -15) {
                let x = -5 + Math.random() * 10;
                let y = 20 + Math.random() * 10;
                let z = -5 + Math.random() * 10;
                eraser.setLocalPosition(x, y, z);
                eraser.rigidbody.linearVelocity = pc.Vec3.ZERO;
                eraser.rigidbody.angularVelocity = pc.Vec3.ZERO;
                eraser.rigidbody.syncEntityToBody();
            }
        }

        if (showWireframe) {
            drawPhysicsDebug(app, staticDebugEntities);
            drawPhysicsDebug(app, erasers);
        }
    });
}