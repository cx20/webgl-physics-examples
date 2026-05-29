import * as pc from 'playcanvas';

// PlayCanvas (rendering) + Havok low-level API (physics).
// Carrot-textured cones rain into a walled basket. Havok has no primitive cone shape,
// so the collider is a convex hull built from the cone's vertices (matching the
// webgpu/havok/cone approach); the visual is PlayCanvas' cone primitive.

const FIXED_TIMESTEP = 1 / 60;
const IDENTITY_QUATERNION = [0, 0, 0, 1];
const SCALE = 4;
const CONE_RADIUS = 0.25 * SCALE;   // 1.0
const CONE_HEIGHT = 1.0 * SCALE;    // 4.0
const CONE_HULL_SEGMENTS = 16;
const MAX_CARROTS = 200;
const CARROT_TEX = 'https://cx20.github.io/webgl-physics-examples/assets/textures/carrot.jpg';
const GRASS_TEX  = 'https://cx20.github.io/webgl-physics-examples/assets/textures/grass.jpg';

const _DBG_COLOR_DYNAMIC = new pc.Color(0, 1, 0, 1);
const _DBG_COLOR_STATIC  = new pc.Color(1, 1, 0, 1);

let HK, worldId, app, camera;
let showWireframe = true;
let coneShapeId = null, coneMass = null, carrotMat = null;
let spawnTimer = 0;
const carrots = [];           // {entity, bodyId}
const staticDebugShapes = []; // {pos:[x,y,z], hw:[x,y,z]}

function _drawWireCone(mat, radius, height, color) {
    const apex = new pc.Vec3();
    mat.transformPoint(new pc.Vec3(0, height * 0.5, 0), apex);
    const segs = 16, pts = [], ring = [];
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

function drawDebug() {
    for (const s of staticDebugShapes) {
        const mat = new pc.Mat4().setTRS(new pc.Vec3(...s.pos), new pc.Quat(), pc.Vec3.ONE);
        app.drawWireAlignedBox(new pc.Vec3(-s.hw[0], -s.hw[1], -s.hw[2]), new pc.Vec3(s.hw[0], s.hw[1], s.hw[2]), _DBG_COLOR_STATIC, false, undefined, mat);
    }
    for (const c of carrots) {
        const mat = new pc.Mat4().setTRS(c.entity.getPosition(), c.entity.getRotation(), pc.Vec3.ONE);
        _drawWireCone(mat, CONE_RADIUS, CONE_HEIGHT, _DBG_COLOR_DYNAMIC);
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

// Build a cone-shaped convex hull: a ring of base vertices plus a single apex.
function createConeConvexHullShape(radius, height, segments) {
    if (typeof HK.HP_Shape_CreateConvexHull !== 'function' || typeof HK._malloc !== 'function') {
        throw new Error('Havok convex hull API is not available in this runtime.');
    }
    const numVertices = segments + 1;
    const ptr = HK._malloc(numVertices * 3 * 4);
    const verts = new Float32Array(HK.HEAPF32.buffer, ptr, numVertices * 3);
    const halfHeight = height * 0.5;
    for (let i = 0; i < segments; i++) {
        const angle = (i / segments) * Math.PI * 2;
        verts[i * 3 + 0] = Math.cos(angle) * radius;
        verts[i * 3 + 1] = -halfHeight;
        verts[i * 3 + 2] = Math.sin(angle) * radius;
    }
    verts[segments * 3 + 0] = 0;
    verts[segments * 3 + 1] = halfHeight;
    verts[segments * 3 + 2] = 0;

    const created = HK.HP_Shape_CreateConvexHull(ptr, numVertices);
    HK._free(ptr);
    return created[1];
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

function spawnCarrot() {
    const bodyId = HK.HP_Body_Create()[1];
    HK.HP_Body_SetShape(bodyId, coneShapeId);
    HK.HP_Body_SetMotionType(bodyId, HK.MotionType.DYNAMIC);
    HK.HP_Body_SetMassProperties(bodyId, coneMass);
    HK.HP_Body_SetPosition(bodyId, spawnPosition());
    HK.HP_Body_SetOrientation(bodyId, randomQuaternion());
    HK.HP_World_AddBody(worldId, bodyId, false);

    const entity = new pc.Entity('carrot' + carrots.length);
    entity.addComponent('model', { type: 'cone', material: carrotMat });
    entity.setLocalScale(SCALE / 2, SCALE, SCALE / 2);
    app.root.addChild(entity);

    carrots.push({ entity, bodyId });
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

    carrotMat = new pc.StandardMaterial();
    carrotMat.diffuseMap = getTexture(CARROT_TEX, 100, 100, false);
    carrotMat.update();

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

    // Shared cone collider (convex hull) + mass.
    coneShapeId = createConeConvexHullShape(CONE_RADIUS, CONE_HEIGHT, CONE_HULL_SEGMENTS);
    coneMass    = HK.HP_Shape_BuildMassProperties(coneShapeId)[1];
}

function updatePhysics() {
    HK.HP_World_Step(worldId, FIXED_TIMESTEP);
    for (const c of carrots) {
        const [, pos] = HK.HP_Body_GetPosition(c.bodyId);
        const [, ori] = HK.HP_Body_GetOrientation(c.bodyId);
        c.entity.setPosition(pos[0], pos[1], pos[2]);
        c.entity.setRotation(new pc.Quat(ori[0], ori[1], ori[2], ori[3]));

        if (pos[1] < -10) {
            HK.HP_Body_SetPosition(c.bodyId, spawnPosition());
            HK.HP_Body_SetOrientation(c.bodyId, randomQuaternion());
            HK.HP_Body_SetLinearVelocity(c.bodyId, [0, 0, 0]);
            HK.HP_Body_SetAngularVelocity(c.bodyId, [0, 0, 0]);
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

        // Drip new carrots in until the basket is full.
        spawnTimer += dt;
        if (spawnTimer > 0.05 && carrots.length < MAX_CARROTS) { spawnCarrot(); spawnTimer = 0; }

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
