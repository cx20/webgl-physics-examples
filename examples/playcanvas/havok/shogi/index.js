import * as pc from 'playcanvas';
import { CameraControls } from 'playcanvas/scripts/esm/camera-controls.mjs';

// PlayCanvas (rendering) + Havok low-level API (physics).
// Pentagon-prism shogi pieces tumble into an open box. The visual is a custom mesh
// (same vertex/UV layout as the three.js / Filament versions, so shogi.png maps the
// same way); the collider is a box approximating the piece.

const PIECE_W = 1.6;
const PIECE_H = 1.6;
const PIECE_D = 0.45;
const PIECE_COUNT = 220;
const FIXED_TIMESTEP = 1 / 60;
const IDENTITY_QUATERNION = [0, 0, 0, 1];
const SHOGI_TEX = 'https://cx20.github.io/webgl-physics-examples/assets/textures/shogi_001/shogi.png';
const GRASS_TEX = 'https://cx20.github.io/webgl-physics-examples/assets/textures/grass.jpg';

const _DBG_COLOR_DYNAMIC = new pc.Color(0, 1, 0, 1);
const _DBG_COLOR_STATIC  = new pc.Color(1, 1, 0, 1);

// Pentagon-prism shogi piece geometry.
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
         4,  6,  5,   4,  7,  6,
         8, 10,  9,   8, 11, 10,
        12, 14, 13,  12, 15, 14,
        16, 18, 17,  16, 19, 18,
        20, 21, 22,  20, 22, 23,
        24, 25, 26,
        27, 29, 28,
        30, 31, 33,  33, 31, 32,
        34, 36, 35,  34, 37, 36,
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

let HK, worldId, app, camera;
let showWireframe = true;
const pieces = [];            // {entity, bodyId, hw:[x,y,z]}
const staticDebugShapes = []; // {pos:[x,y,z], hw:[x,y,z]}

function drawDebug() {
    for (const s of staticDebugShapes) {
        const mat = new pc.Mat4().setTRS(new pc.Vec3(...s.pos), new pc.Quat(), pc.Vec3.ONE);
        app.drawWireAlignedBox(new pc.Vec3(-s.hw[0], -s.hw[1], -s.hw[2]), new pc.Vec3(s.hw[0], s.hw[1], s.hw[2]), _DBG_COLOR_STATIC, false, undefined, mat);
    }
    for (const p of pieces) {
        const mat = new pc.Mat4().setTRS(p.entity.getPosition(), p.entity.getRotation(), pc.Vec3.ONE);
        app.drawWireAlignedBox(new pc.Vec3(-p.hw[0], -p.hw[1], -p.hw[2]), new pc.Vec3(p.hw[0], p.hw[1], p.hw[2]), _DBG_COLOR_DYNAMIC, false, undefined, mat);
    }
}

function getTexture(url, w, h, flipY) {
    const tex = new pc.Texture(app.graphicsDevice, { width: w, height: h });
    const img = new Image();
    img.onload = () => {
        if (flipY === false) tex.flipY = false;
        tex.minFilter = pc.FILTER_LINEAR;
        tex.magFilter = pc.FILTER_LINEAR;
        tex.addressU = pc.ADDRESS_CLAMP_TO_EDGE;
        tex.addressV = pc.ADDRESS_CLAMP_TO_EDGE;
        tex.setSource(img);
    };
    img.crossOrigin = 'anonymous';
    img.src = url;
    return tex;
}

function createStaticBox(x, y, z, hw, hh, hd) {
    // HP_Shape_CreateBox takes full side lengths, so pass 2x the half-extents.
    const shapeId = HK.HP_Shape_CreateBox([0, 0, 0], IDENTITY_QUATERNION, [hw * 2, hh * 2, hd * 2])[1];
    const bodyId  = HK.HP_Body_Create()[1];
    HK.HP_Body_SetShape(bodyId, shapeId);
    HK.HP_Body_SetMotionType(bodyId, HK.MotionType.STATIC);
    HK.HP_Body_SetPosition(bodyId, [x, y, z]);
    HK.HP_Body_SetOrientation(bodyId, IDENTITY_QUATERNION);
    HK.HP_World_AddBody(worldId, bodyId, false);
    staticDebugShapes.push({ pos: [x, y, z], hw: [hw, hh, hd] });
}

function randomRange(min, max) { return Math.random() * (max - min) + min; }

function randomQuaternion() {
    const q = new pc.Quat();
    q.setFromEulerAngles(randomRange(0, 360), randomRange(0, 360), randomRange(0, 360));
    return [q.x, q.y, q.z, q.w];
}

function initPhysics() {
    worldId = HK.HP_World_Create()[1];
    HK.HP_World_SetGravity(worldId, [0, -9.81, 0]);
    HK.HP_World_SetIdealStepTime(worldId, FIXED_TIMESTEP);

    const floorMat = new pc.StandardMaterial();
    floorMat.diffuseMap = getTexture(GRASS_TEX, 72, 72);
    floorMat.update();

    const wallMat = new pc.StandardMaterial();
    wallMat.diffuse = new pc.Color(1, 1, 1);
    wallMat.opacity = 0.3;
    wallMat.blendType = pc.BLEND_NORMAL;
    wallMat.update();

    const shogiMat = new pc.StandardMaterial();
    shogiMat.diffuseMap = getTexture(SHOGI_TEX, 1024, 512, false);
    shogiMat.cull = pc.CULLFACE_NONE;
    shogiMat.update();

    // Floor (static)
    createStaticBox(0, -2, 0, 20, 2, 20);
    const floor = new pc.Entity();
    floor.addComponent('model', { type: 'box', material: floorMat });
    floor.setLocalScale(40, 4, 40);
    floor.setPosition(0, -2, 0);
    app.root.addChild(floor);

    // Walls (static)
    const wallData = [
        { size: [10, 10, 1], pos: [0, 5, -5] },
        { size: [10, 10, 1], pos: [0, 5,  5] },
        { size: [1, 10, 10], pos: [-5, 5, 0] },
        { size: [1, 10, 10], pos: [5, 5,  0] }
    ];
    for (const w of wallData) {
        createStaticBox(w.pos[0], w.pos[1], w.pos[2], w.size[0] / 2, w.size[1] / 2, w.size[2] / 2);
        const wall = new pc.Entity();
        wall.addComponent('model', { type: 'box', material: wallMat });
        wall.setLocalScale(w.size[0], w.size[1], w.size[2]);
        wall.setPosition(w.pos[0], w.pos[1], w.pos[2]);
        app.root.addChild(wall);
    }

    // Shared shogi mesh + box collider.
    const geo = buildShogiGeometry(PIECE_W, PIECE_H, PIECE_D);
    const shogiMesh = new pc.Mesh(app.graphicsDevice);
    shogiMesh.setPositions(geo.pos);
    shogiMesh.setNormals(computeNormals(geo.pos, geo.indices));
    shogiMesh.setUvs(0, geo.uvs);
    shogiMesh.setIndices(geo.indices);
    shogiMesh.update();

    const hw = PIECE_W / 2, hh = PIECE_H / 2, hd = PIECE_D * 0.7;
    // HP_Shape_CreateBox takes full side lengths, so pass 2x the half-extents.
    const pieceShape = HK.HP_Shape_CreateBox([0, 0, 0], IDENTITY_QUATERNION, [hw * 2, hh * 2, hd * 2])[1];
    const pieceMass  = HK.HP_Shape_BuildMassProperties(pieceShape)[1];

    for (let i = 0; i < PIECE_COUNT; i++) {
        const spawn = [(Math.random() - 0.5) * 8, 2 + Math.random() * 36, (Math.random() - 0.5) * 8];

        const bodyId = HK.HP_Body_Create()[1];
        HK.HP_Body_SetShape(bodyId, pieceShape);
        HK.HP_Body_SetMotionType(bodyId, HK.MotionType.DYNAMIC);
        HK.HP_Body_SetMassProperties(bodyId, pieceMass);
        HK.HP_Body_SetPosition(bodyId, spawn);
        HK.HP_Body_SetOrientation(bodyId, randomQuaternion());
        HK.HP_World_AddBody(worldId, bodyId, false);

        const entity = new pc.Entity('piece' + i);
        entity.addComponent('render', { meshInstances: [new pc.MeshInstance(shogiMesh, shogiMat)] });
        app.root.addChild(entity);

        pieces.push({ entity, bodyId, hw: [hw, hh, hd] });
    }
}

function updatePhysics() {
    HK.HP_World_Step(worldId, FIXED_TIMESTEP);
    for (const p of pieces) {
        const [, pos] = HK.HP_Body_GetPosition(p.bodyId);
        const [, ori] = HK.HP_Body_GetOrientation(p.bodyId);
        p.entity.setPosition(pos[0], pos[1], pos[2]);
        p.entity.setRotation(new pc.Quat(ori[0], ori[1], ori[2], ori[3]));

        if (pos[1] < -10) {
            HK.HP_Body_SetPosition(p.bodyId, [(Math.random() - 0.5) * 8, 12 + Math.random() * 26, (Math.random() - 0.5) * 8]);
            HK.HP_Body_SetOrientation(p.bodyId, randomQuaternion());
            HK.HP_Body_SetLinearVelocity(p.bodyId, [0, 0, 0]);
            HK.HP_Body_SetAngularVelocity(p.bodyId, [0, 0, 0]);
        }
    }
}

async function main() {
    HK = await HavokPhysics();

    const canvas = document.getElementById('c');
    app = new pc.Application(canvas);
    app.start();
    app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
    app.setCanvasResolution(pc.RESOLUTION_AUTO);
    window.addEventListener('resize', () => app.resizeCanvas(canvas.width, canvas.height));

    app.scene.ambientLight = new pc.Color(0.8, 0.8, 0.8);

    const light = new pc.Entity('light');
    light.addComponent('light', { type: 'directional', color: new pc.Color(1, 1, 1), intensity: 2.0, castShadows: true, shadowResolution: 2048, shadowBias: 0.2, normalOffsetBias: 0.05 });
    light.setLocalEulerAngles(45, 45, 45);
    app.root.addChild(light);

    camera = new pc.Entity('camera');
    camera.addComponent('camera', { clearColor: new pc.Color(0.13, 0.14, 0.16), nearClip: 0.01, farClip: 1000, fov: 60 });
    camera.addComponent('script');
    app.root.addChild(camera);
    const cc = camera.script.create(CameraControls);
    cc.enableFly = false;
    cc.reset(new pc.Vec3(0, 4, 0), new pc.Vec3(0, 14, 28));

    initPhysics();
    setInterval(updatePhysics, 1000 / 60);

    app.on('update', () => { if (showWireframe) drawDebug(); });
}

window.addEventListener('keydown', (event) => {
    const isW = event.code === 'KeyW' || event.key === 'w' || event.key === 'W';
    if (!isW || event.repeat) return;
    showWireframe = !showWireframe;
    const hint = document.getElementById('hint');
    if (hint) hint.textContent = 'W: wireframe ' + (showWireframe ? 'ON' : 'OFF');
});

main().catch(console.error);
