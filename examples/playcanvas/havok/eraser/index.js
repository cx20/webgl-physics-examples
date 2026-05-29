import * as pc from 'playcanvas';

// PlayCanvas (rendering) + Havok low-level API (physics).
// Textured erasers rain into a walled basket. The visual is a custom box mesh (same
// vertex/UV layout as the three.js / ammo.js versions so eraser.png maps the same way)
// and the collider is a box matching the eraser's extents.

const FIXED_TIMESTEP = 1 / 60;
const IDENTITY_QUATERNION = [0, 0, 0, 1];
const SCALE = 2;
const MAX_ERASERS = 200;
const ERASER_TEX = 'https://cx20.github.io/webgl-physics-examples/assets/textures/eraser_001/eraser.png';
const GRASS_TEX  = 'https://cx20.github.io/webgl-physics-examples/assets/textures/grass.jpg';

// Eraser box mesh (half-extents of the base mesh, before SCALE).
const MESH_W = 1.0, MESH_H = 0.2, MESH_D = 0.5;
const positions = [
    -MESH_W, -MESH_H,  MESH_D,   MESH_W, -MESH_H,  MESH_D,   MESH_W,  MESH_H,  MESH_D,  -MESH_W,  MESH_H,  MESH_D,
    -MESH_W, -MESH_H, -MESH_D,   MESH_W, -MESH_H, -MESH_D,   MESH_W,  MESH_H, -MESH_D,  -MESH_W,  MESH_H, -MESH_D,
     MESH_W,  MESH_H,  MESH_D,  -MESH_W,  MESH_H,  MESH_D,  -MESH_W,  MESH_H, -MESH_D,   MESH_W,  MESH_H, -MESH_D,
    -MESH_W, -MESH_H,  MESH_D,   MESH_W, -MESH_H,  MESH_D,   MESH_W, -MESH_H, -MESH_D,  -MESH_W, -MESH_H, -MESH_D,
     MESH_W, -MESH_H,  MESH_D,   MESH_W,  MESH_H,  MESH_D,   MESH_W,  MESH_H, -MESH_D,   MESH_W, -MESH_H, -MESH_D,
    -MESH_W, -MESH_H,  MESH_D,  -MESH_W,  MESH_H,  MESH_D,  -MESH_W,  MESH_H, -MESH_D,  -MESH_W, -MESH_H, -MESH_D
];
const normals = [
     0, -1,  0,  0, -1,  0,  0, -1,  0,  0, -1,  0,
     0,  1,  0,  0,  1,  0,  0,  1,  0,  0,  1,  0,
     0,  0, -1,  0,  0, -1,  0,  0, -1,  0,  0, -1,
     0,  0,  1,  0,  0,  1,  0,  0,  1,  0,  0,  1,
    -1,  0,  0, -1,  0,  0, -1,  0,  0, -1,  0,  0,
     1,  0,  0,  1,  0,  0,  1,  0,  0,  1,  0,  0
];
const uvs = [
    0.5,  1.0,  0.75, 1.0,  0.75, 0.5,  0.5,  0.5,
    0.25, 1.0,  0.5,  1.0,  0.5,  0.5,  0.25, 0.5,
    0.75, 0.5,  0.5,  0.5,  0.5,  0.0,  0.75, 0.0,
    0.0,  1.0,  0.25, 1.0,  0.25, 0.5,  0.0,  0.5,
    0.0,  0.5,  0.0,  0.0,  0.25, 0.0,  0.25, 0.5,
    0.5,  0.5,  0.5,  0.0,  0.25, 0.0,  0.25, 0.5
];
const indices = [
     0,  2,  1,  0,  3,  2,
     4,  5,  6,  4,  6,  7,
     8,  9, 10,  8, 10, 11,
    12, 15, 14, 12, 14, 13,
    16, 17, 18, 16, 18, 19,
    20, 23, 22, 20, 22, 21
];

// Collider half-extents = scaled mesh half-extents.
const HALF = [MESH_W * SCALE, MESH_H * SCALE, MESH_D * SCALE];

const _DBG_COLOR_DYNAMIC = new pc.Color(0, 1, 0, 1);
const _DBG_COLOR_STATIC  = new pc.Color(1, 1, 0, 1);

let HK, worldId, app, camera;
let showWireframe = true;
let eraserShapeId = null, eraserMass = null, eraserMesh = null, eraserMat = null;
let spawnTimer = 0;
const erasers = [];           // {entity, bodyId}
const staticDebugShapes = []; // {pos:[x,y,z], hw:[x,y,z]}

function drawDebug() {
    for (const s of staticDebugShapes) {
        const mat = new pc.Mat4().setTRS(new pc.Vec3(...s.pos), new pc.Quat(), pc.Vec3.ONE);
        app.drawWireAlignedBox(new pc.Vec3(-s.hw[0], -s.hw[1], -s.hw[2]), new pc.Vec3(s.hw[0], s.hw[1], s.hw[2]), _DBG_COLOR_STATIC, false, undefined, mat);
    }
    for (const e of erasers) {
        const mat = new pc.Mat4().setTRS(e.entity.getPosition(), e.entity.getRotation(), pc.Vec3.ONE);
        app.drawWireAlignedBox(new pc.Vec3(-HALF[0], -HALF[1], -HALF[2]), new pc.Vec3(HALF[0], HALF[1], HALF[2]), _DBG_COLOR_DYNAMIC, false, undefined, mat);
    }
}

function getTexture(url, w, h) {
    const tex = new pc.Texture(app.graphicsDevice, { width: w, height: h });
    const img = new Image();
    img.onload = () => {
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

function spawnPosition() {
    return [randomRange(-5, 5), randomRange(20, 30), randomRange(-5, 5)];
}

function spawnEraser() {
    const bodyId = HK.HP_Body_Create()[1];
    HK.HP_Body_SetShape(bodyId, eraserShapeId);
    HK.HP_Body_SetMotionType(bodyId, HK.MotionType.DYNAMIC);
    HK.HP_Body_SetMassProperties(bodyId, eraserMass);
    HK.HP_Body_SetPosition(bodyId, spawnPosition());
    HK.HP_Body_SetOrientation(bodyId, randomQuaternion());
    HK.HP_World_AddBody(worldId, bodyId, false);

    const entity = new pc.Entity('eraser' + erasers.length);
    entity.addComponent('render', { meshInstances: [new pc.MeshInstance(eraserMesh, eraserMat)] });
    entity.setLocalScale(SCALE, SCALE, SCALE);
    app.root.addChild(entity);

    erasers.push({ entity, bodyId });
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
    wallMat.opacity = 0.5;
    wallMat.blendType = pc.BLEND_NORMAL;
    wallMat.update();

    // Load the eraser texture via the asset system and re-update the material once it
    // arrives, so the diffuse map is reliably picked up by the mesh material's shader.
    eraserMat = new pc.StandardMaterial();
    eraserMat.cull = pc.CULLFACE_NONE;
    eraserMat.update();
    app.assets.loadFromUrl(ERASER_TEX, 'texture', (err, asset) => {
        if (err) { console.error('Failed to load eraser texture:', err); return; }
        eraserMat.diffuseMap = asset.resource;
        eraserMat.update();
    });

    // Floor (static)
    createStaticBox(0, -2, 0, 20, 2, 20);
    const floor = new pc.Entity();
    floor.addComponent('model', { type: 'box', material: floorMat });
    floor.setLocalScale(40, 4, 40);
    floor.setPosition(0, -2, 0);
    app.root.addChild(floor);

    // Walls (static) — basket sides.
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

    // Shared eraser mesh + box collider (full side lengths = 2x half-extents).
    eraserMesh = new pc.Mesh(app.graphicsDevice);
    eraserMesh.setPositions(positions);
    eraserMesh.setNormals(normals);
    eraserMesh.setUvs(0, uvs);
    eraserMesh.setIndices(indices);
    eraserMesh.update();

    eraserShapeId = HK.HP_Shape_CreateBox([0, 0, 0], IDENTITY_QUATERNION, [HALF[0] * 2, HALF[1] * 2, HALF[2] * 2])[1];
    eraserMass    = HK.HP_Shape_BuildMassProperties(eraserShapeId)[1];
}

function updatePhysics() {
    HK.HP_World_Step(worldId, FIXED_TIMESTEP);
    for (const e of erasers) {
        const [, pos] = HK.HP_Body_GetPosition(e.bodyId);
        const [, ori] = HK.HP_Body_GetOrientation(e.bodyId);
        e.entity.setPosition(pos[0], pos[1], pos[2]);
        e.entity.setRotation(new pc.Quat(ori[0], ori[1], ori[2], ori[3]));

        if (pos[1] < -10) {
            HK.HP_Body_SetPosition(e.bodyId, spawnPosition());
            HK.HP_Body_SetOrientation(e.bodyId, randomQuaternion());
            HK.HP_Body_SetLinearVelocity(e.bodyId, [0, 0, 0]);
            HK.HP_Body_SetAngularVelocity(e.bodyId, [0, 0, 0]);
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

    app.scene.ambientLight = new pc.Color(0.2, 0.2, 0.2);

    const light = new pc.Entity('light');
    light.addComponent('light', { type: 'directional', color: new pc.Color(1, 1, 1), castShadows: true, shadowResolution: 2048 });
    light.setLocalEulerAngles(45, 45, 45);
    app.root.addChild(light);

    camera = new pc.Entity('camera');
    camera.addComponent('camera', { clearColor: new pc.Color(0.5, 0.5, 0.8), nearClip: 0.01, farClip: 1000, fov: 60 });
    app.root.addChild(camera);

    initPhysics();
    setInterval(updatePhysics, 1000 / 60);

    let angle = 0;
    app.on('update', (dt) => {
        angle += 0.5 * dt;
        camera.setPosition(Math.sin(angle) * 40, 10, Math.cos(angle) * 40);
        camera.lookAt(0, 0, 0);

        // Drip new erasers in until the basket is full.
        spawnTimer += dt;
        if (spawnTimer > 0.05 && erasers.length < MAX_ERASERS) { spawnEraser(); spawnTimer = 0; }

        if (showWireframe) drawDebug();
    });
}

window.addEventListener('keydown', (event) => {
    const isW = event.code === 'KeyW' || event.key === 'w' || event.key === 'W';
    if (!isW || event.repeat) return;
    showWireframe = !showWireframe;
    const hint = document.getElementById('hint');
    if (hint) hint.textContent = 'W: wireframe ' + (showWireframe ? 'ON' : 'OFF');
});

main().catch(console.error);
