import * as pc from 'playcanvas';
import { loadWasmModuleAsync } from "https://rawcdn.githack.com/playcanvas/engine/f8e929634cf7b057f7c80ac206a4f3d2d11843dc/examples/src/wasm-loader.js";

const PIECE_W     = 1.6;
const PIECE_H     = 1.6;
const PIECE_D     = 0.45;
const PIECE_COUNT = 220;

// Pentagon-prism shogi piece geometry.
// Vertex layout matches the three.js / Filament versions so the same shogi.png UV mapping works.
function buildShogiGeometry(w, h, d) {
    const pos = [
        // Front (0-3)
        -0.5*w, -0.5*h,  0.7*d,   0.5*w, -0.5*h,  0.7*d,   0.35*w,  0.5*h,  0.4*d,  -0.35*w,  0.5*h,  0.4*d,
        // Back (4-7)
        -0.5*w, -0.5*h, -0.7*d,   0.5*w, -0.5*h, -0.7*d,   0.35*w,  0.5*h, -0.4*d,  -0.35*w,  0.5*h, -0.4*d,
        // Top (8-11)
         0.35*w,  0.5*h,  0.4*d,  -0.35*w,  0.5*h,  0.4*d,  -0.35*w,  0.5*h, -0.4*d,   0.35*w,  0.5*h, -0.4*d,
        // Bottom (12-15)
        -0.5*w, -0.5*h,  0.7*d,   0.5*w, -0.5*h,  0.7*d,   0.5*w, -0.5*h, -0.7*d,  -0.5*w, -0.5*h, -0.7*d,
        // Right (16-19)
         0.5*w, -0.5*h,  0.7*d,   0.35*w,  0.5*h,  0.4*d,   0.35*w,  0.5*h, -0.4*d,   0.5*w, -0.5*h, -0.7*d,
        // Left (20-23)
        -0.5*w, -0.5*h,  0.7*d,  -0.35*w,  0.5*h,  0.4*d,  -0.35*w,  0.5*h, -0.4*d,  -0.5*w, -0.5*h, -0.7*d,
        // Apex front (24-26)
        -0.35*w,  0.5*h,  0.4*d,   0.35*w,  0.5*h,  0.4*d,   0,  0.6*h,  0.35*d,
        // Apex back (27-29)
        -0.35*w,  0.5*h, -0.4*d,   0.35*w,  0.5*h, -0.4*d,   0,  0.6*h, -0.35*d,
        // Apex right (30-33)
         0.35*w,  0.5*h,  0.4*d,   0.35*w,  0.5*h, -0.4*d,   0,  0.6*h, -0.35*d,   0,  0.6*h,  0.35*d,
        // Apex left (34-37)
        -0.35*w,  0.5*h,  0.4*d,  -0.35*w,  0.5*h, -0.4*d,   0,  0.6*h, -0.35*d,   0,  0.6*h,  0.35*d,
    ];
    const uvs = [
        0.5, 0.5,  0.75, 0.5,  0.75-0.25/8, 1.0,  0.5+0.25/8, 1.0,
        0.5, 0.5,  0.25, 0.5,  0.25+0.25/8, 1.0,  0.5-0.25/8, 1.0,
        0.75, 0.5,  0.5, 0.5,  0.5, 0.0,  0.75, 0.0,
        0.0, 0.5,  0.25, 0.5,  0.25, 1.0,  0.0, 1.0,
        0.0, 0.5,  0.0, 0.0,  0.25, 0.0,  0.25, 0.5,
        0.5, 0.5,  0.5, 0.0,  0.25, 0.0,  0.25, 0.5,
        0.75, 0.0,  1.0, 0.0,  1.0, 0.5,
        0.75, 0.0,  1.0, 0.0,  1.0, 0.5,
        0.75, 0.0,  1.0, 0.0,  1.0, 0.5,  0.75, 0.5,
        0.75, 0.0,  1.0, 0.0,  1.0, 0.5,  0.75, 0.5,
    ];
    const indices = [
         0,  1,  2,   0,  2,  3,
         4,  5,  6,   4,  6,  7,
         8,  9, 10,   8, 10, 11,
        12, 13, 14,  12, 14, 15,
        16, 17, 18,  16, 18, 19,
        20, 21, 22,  20, 22, 23,
        24, 25, 26,
        27, 28, 29,
        30, 33, 31,  33, 32, 31,
        34, 35, 36,  34, 36, 37,
    ];
    return { pos, uvs, indices };
}

function computeNormals(pos, indices) {
    const n = new Array(pos.length).fill(0);
    for (let i = 0; i < indices.length; i += 3) {
        const a = indices[i] * 3, b = indices[i + 1] * 3, c = indices[i + 2] * 3;
        const ux = pos[b]   - pos[a],   uy = pos[b+1] - pos[a+1], uz = pos[b+2] - pos[a+2];
        const vx = pos[c]   - pos[a],   vy = pos[c+1] - pos[a+1], vz = pos[c+2] - pos[a+2];
        const nx = uy*vz - uz*vy, ny = uz*vx - ux*vz, nz = ux*vy - uy*vx;
        for (const k of [a, b, c]) { n[k] += nx; n[k+1] += ny; n[k+2] += nz; }
    }
    for (let i = 0; i < n.length; i += 3) {
        const l = Math.hypot(n[i], n[i+1], n[i+2]) || 1;
        n[i] /= l; n[i+1] /= l; n[i+2] /= l;
    }
    return n;
}

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
        app.drawWireAlignedBox(
            new pc.Vec3(-h.x, -h.y, -h.z),
            new pc.Vec3( h.x,  h.y,  h.z),
            color, false, undefined, mat
        );
    }
}

let showWireframe = true;

loadWasmModuleAsync(
    'Ammo',
    'https://rawcdn.githack.com/playcanvas/engine/f8e929634cf7b057f7c80ac206a4f3d2d11843dc/examples/src/lib/ammo/ammo.wasm.js',
    'https://rawcdn.githack.com/playcanvas/engine/f8e929634cf7b057f7c80ac206a4f3d2d11843dc/examples/src/lib/ammo/ammo.wasm.wasm',
    init
);

function init() {
    const canvas = document.getElementById("c");
    const app = new pc.Application(canvas);
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

    app.scene.ambientLight = new pc.Color(0.5, 0.5, 0.5);

    function createTransparentMaterial(color) {
        const m = new pc.StandardMaterial();
        m.diffuse = color;
        m.opacity = 0.3;
        m.blendType = pc.BLEND_NORMAL;
        m.update();
        return m;
    }

    function getTexture(imageFile, flipY) {
        const texture = new pc.Texture(app.graphicsDevice, { width: 512, height: 512 });
        const img = new Image();
        img.onload = function () {
            if (flipY === false) texture.flipY = false;
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

    function createTextureMaterial(imageFile, flipY) {
        const m = new pc.StandardMaterial();
        m.diffuseMap = getTexture(imageFile, flipY);
        m.cull = pc.CULLFACE_NONE;
        m.update();
        return m;
    }

    const light = new pc.Entity("light");
    light.addComponent("light", {
        type: "directional",
        color: new pc.Color(1, 1, 1),
        castShadows: true,
        shadowResolution: 2048,
        shadowBias: 0.2,
        normalOffsetBias: 0.05
    });
    light.setLocalEulerAngles(45, 45, 45);
    app.root.addChild(light);

    const camera = new pc.Entity("camera");
    camera.addComponent("camera", {
        clearColor: new pc.Color(0.13, 0.14, 0.16),
        nearClip: 0.01,
        farClip: 1000,
        fov: 60
    });
    app.root.addChild(camera);

    const wallMat  = createTransparentMaterial(new pc.Color(1, 1, 1));
    const floorMat = createTextureMaterial("../../../../assets/textures/grass.jpg");
    const shogiMat = createTextureMaterial("../../../../assets/textures/shogi_001/shogi.png", false);

    const floor = new pc.Entity("floor");
    floor.setLocalPosition(0, -2, 0);
    floor.addComponent("collision", { type: "box", halfExtents: [20, 2, 20] });
    floor.addComponent("rigidbody", { type: "static", friction: 0.6, restitution: 0.2 });
    const floorModel = new pc.Entity("floorModel");
    floorModel.setLocalScale(40, 4, 40);
    floorModel.addComponent("model", { type: "box", material: floorMat });
    floor.addChild(floorModel);
    app.root.addChild(floor);

    const wallData = [
        { size: [10, 10,  1], pos: [ 0, 5, -5] },
        { size: [10, 10,  1], pos: [ 0, 5,  5] },
        { size: [ 1, 10, 10], pos: [-5, 5,  0] },
        { size: [ 1, 10, 10], pos: [ 5, 5,  0] },
    ];

    const staticDebugEntities = [floor];
    for (const wd of wallData) {
        const box = new pc.Entity("wall");
        box.setLocalPosition(wd.pos[0], wd.pos[1], wd.pos[2]);
        box.addComponent("collision", {
            type: "box",
            halfExtents: [wd.size[0] / 2, wd.size[1] / 2, wd.size[2] / 2]
        });
        box.addComponent("rigidbody", { type: "static", friction: 0.6, restitution: 0.2 });
        const boxModel = new pc.Entity("wallModel");
        boxModel.setLocalScale(wd.size[0], wd.size[1], wd.size[2]);
        boxModel.addComponent("model", { type: "box", material: wallMat });
        box.addChild(boxModel);
        app.root.addChild(box);
        staticDebugEntities.push(box);
    }

    // Build the shared shogi mesh (pentagon-prism).
    const geo     = buildShogiGeometry(PIECE_W, PIECE_H, PIECE_D);
    const normals = computeNormals(geo.pos, geo.indices);
    const shogiMesh = new pc.Mesh(app.graphicsDevice);
    shogiMesh.setPositions(geo.pos);
    shogiMesh.setNormals(normals);
    shogiMesh.setUvs(0, geo.uvs);
    shogiMesh.setIndices(geo.indices);
    shogiMesh.update();

    // Box collision half-extents that tightly wrap the pentagon-prism mesh.
    const halfW = PIECE_W / 2;
    const halfH = PIECE_H / 2;
    const halfD = PIECE_D * 0.7;

    function createPiece(x, y, z) {
        const piece = new pc.Entity("piece");
        piece.setLocalPosition(x, y, z);
        piece.setLocalEulerAngles(
            Math.random() * 360,
            Math.random() * 360,
            Math.random() * 360
        );
        piece.addComponent("collision", {
            type: "box",
            halfExtents: [halfW, halfH, halfD]
        });
        piece.addComponent("rigidbody", {
            type: "dynamic",
            mass: 1,
            friction: 0.4,
            restitution: 0.3
        });
        const visual = new pc.Entity("visual");
        visual.addComponent("render", {
            meshInstances: [new pc.MeshInstance(shogiMesh, shogiMat)]
        });
        piece.addChild(visual);
        app.root.addChild(piece);
        return piece;
    }

    const pieces = [];
    for (let i = 0; i < PIECE_COUNT; i++) {
        const x = (Math.random() - 0.5) * 8;
        const y = 2 + Math.random() * 36;
        const z = (Math.random() - 0.5) * 8;
        pieces.push(createPiece(x, y, z));
    }

    let angle = 0;
    const EXPECTED_FPS = 60;
    app.on("update", function (dt) {
        const adj = dt / (1 / EXPECTED_FPS);
        angle += 0.4 * adj;

        camera.setLocalPosition(
            Math.sin(Math.PI * angle / 180) * 28,
            14,
            Math.cos(Math.PI * angle / 180) * 28
        );
        camera.lookAt(0, 4, 0);

        for (const piece of pieces) {
            if (piece.getPosition().y < -10) {
                const x = (Math.random() - 0.5) * 8;
                const y = 12 + Math.random() * 26;
                const z = (Math.random() - 0.5) * 8;
                piece.setLocalPosition(x, y, z);
                piece.setLocalEulerAngles(
                    Math.random() * 360,
                    Math.random() * 360,
                    Math.random() * 360
                );
                piece.rigidbody.linearVelocity  = pc.Vec3.ZERO;
                piece.rigidbody.angularVelocity = pc.Vec3.ZERO;
                piece.rigidbody.syncEntityToBody();
            }
        }

        if (showWireframe) {
            drawPhysicsDebug(app, staticDebugEntities);
            drawPhysicsDebug(app, pieces);
        }
    });
}
