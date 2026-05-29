import * as pc from 'playcanvas';
import { CameraControls } from 'playcanvas/scripts/esm/camera-controls.mjs';

// PlayCanvas (rendering) + Havok low-level API (physics).
// Gold / silver / copper coins pour down onto an open floor. Each coin is drawn as a
// metallic cylinder (PBR metalness + a shared normal map for the minted relief) but
// collides as a sphere, so coins roll and cascade rather than stacking flat. Coins that
// settle near the floor or fall off the edge recycle back to the top.

const FIXED_TIMESTEP = 1 / 60;
const IDENTITY_QUATERNION = [0, 0, 0, 1];
const HDR_URL = 'https://cx20.github.io/gltf-test/textures/hdr/papermill_playcanvas_texture-tool.hdr';
const NORMAL_URL = 'https://cx20.github.io/webgl-physics-examples/assets/textures/rockn.png';

// sRGB base colours; with metalness=1 the base colour is the metal's tint.
const COIN_TYPES = [
    { name: 'gold',   color: [1.0, 0.765, 0.337],   diameter: 2.0, height: 0.20, gloss: 0.80 },
    { name: 'silver', color: [0.973, 0.961, 0.918], diameter: 1.6, height: 0.16, gloss: 0.60 },
    { name: 'copper', color: [0.953, 0.635, 0.541], diameter: 1.2, height: 0.12, gloss: 0.80 }
];

const COIN_COUNT = 350;
const DROP_HALF = 3.0;       // horizontal spread of the falling column
const SPAWN_Y_MIN = 24;      // recycled coins re-enter at the top of this band
const SPAWN_Y_MAX = 32;
const COLUMN_Y_MIN = 2;      // initial fill spans the whole column for an instant waterfall
const COLUMN_Y_MAX = 32;

const RESET_Y = -10;         // fell off the floor edge -> recycle
const SETTLE_Y = 4.0;        // a coin resting below this height is lifted back to the top
const SETTLE_MOVE = 0.01;    // per-step movement below which a coin counts as "still"
const SETTLE_FRAMES = 18;

const _DBG_COLOR_DYNAMIC = new pc.Color(0, 1, 0, 1);
const _DBG_COLOR_STATIC  = new pc.Color(1, 1, 0, 1);

let HK, worldId, app, camera;
let showWireframe = true;
const coins = [];             // {entity, bodyId, radius, rest, prev:[x,y,z]}
const staticDebugShapes = []; // {pos:[x,y,z], hw:[x,y,z]}

function _drawWireSphere(pos, radius, color) {
    const pts = [], segs = 16;
    for (let axis = 0; axis < 3; axis++) {
        let prev = null;
        for (let i = 0; i <= segs; i++) {
            const t = (i / segs) * Math.PI * 2, c = Math.cos(t) * radius, s = Math.sin(t) * radius;
            let cur;
            if      (axis === 0) cur = new pc.Vec3(pos.x,     pos.y + c, pos.z + s);
            else if (axis === 1) cur = new pc.Vec3(pos.x + c, pos.y,     pos.z + s);
            else                 cur = new pc.Vec3(pos.x + c, pos.y + s, pos.z    );
            if (prev) { pts.push(prev); pts.push(cur); }
            prev = cur;
        }
    }
    app.drawLines(pts, pts.map(() => color), false);
}

function drawDebug() {
    for (const s of staticDebugShapes) {
        const mat = new pc.Mat4().setTRS(new pc.Vec3(...s.pos), new pc.Quat(), pc.Vec3.ONE);
        app.drawWireAlignedBox(new pc.Vec3(-s.hw[0], -s.hw[1], -s.hw[2]), new pc.Vec3(s.hw[0], s.hw[1], s.hw[2]), _DBG_COLOR_STATIC, false, undefined, mat);
    }
    for (const c of coins) {
        _drawWireSphere(c.entity.getPosition(), c.radius, _DBG_COLOR_DYNAMIC);
    }
}

function randomRange(min, max) { return Math.random() * (max - min) + min; }

function randomQuaternion() {
    const q = new pc.Quat();
    q.setFromEulerAngles(randomRange(0, 360), randomRange(0, 360), randomRange(0, 360));
    return [q.x, q.y, q.z, q.w];
}

function placeAtTop() {
    return [randomRange(-DROP_HALF, DROP_HALF), randomRange(SPAWN_Y_MIN, SPAWN_Y_MAX), randomRange(-DROP_HALF, DROP_HALF)];
}

function recycle(coin) {
    const p = placeAtTop();
    HK.HP_Body_SetPosition(coin.bodyId, p);
    HK.HP_Body_SetOrientation(coin.bodyId, randomQuaternion());
    HK.HP_Body_SetLinearVelocity(coin.bodyId, [0, 0, 0]);
    HK.HP_Body_SetAngularVelocity(coin.bodyId, [0, 0, 0]);
    coin.rest = 0;
    coin.prev = p;
}

function initPhysics() {
    worldId = HK.HP_World_Create()[1];
    HK.HP_World_SetGravity(worldId, [0, -9.81, 0]);
    HK.HP_World_SetIdealStepTime(worldId, FIXED_TIMESTEP);

    // Open floor (no walls), slate-grey.
    const floorMat = new pc.StandardMaterial();
    floorMat.useMetalness = true;
    floorMat.metalness = 0.0;
    floorMat.diffuse = new pc.Color(0.18, 0.19, 0.21);
    floorMat.gloss = 0.2;
    floorMat.update();

    // HP_Shape_CreateBox takes full side lengths, so pass 2x the half-extents.
    const floorShape = HK.HP_Shape_CreateBox([0, 0, 0], IDENTITY_QUATERNION, [12 * 2, 1 * 2, 12 * 2])[1];
    const floorBody  = HK.HP_Body_Create()[1];
    HK.HP_Body_SetShape(floorBody, floorShape);
    HK.HP_Body_SetMotionType(floorBody, HK.MotionType.STATIC);
    HK.HP_Body_SetPosition(floorBody, [0, -1, 0]);
    HK.HP_Body_SetOrientation(floorBody, IDENTITY_QUATERNION);
    HK.HP_World_AddBody(worldId, floorBody, false);

    const floor = new pc.Entity();
    floor.addComponent('model', { type: 'box', material: floorMat });
    floor.setLocalScale(24, 2, 24);
    floor.setPosition(0, -1, 0);
    app.root.addChild(floor);
    staticDebugShapes.push({ pos: [0, -1, 0], hw: [12, 1, 12] });

    // Coin materials: PBR metalness + shared normal map (assigned once the texture arrives).
    const coinMaterials = COIN_TYPES.map((t) => {
        const m = new pc.StandardMaterial();
        m.useMetalness = true;
        m.metalness = 1.0;
        m.diffuse = new pc.Color(t.color[0], t.color[1], t.color[2]);
        m.gloss = t.gloss;
        m.update();
        return m;
    });

    app.assets.loadFromUrl(NORMAL_URL, 'texture', (err, asset) => {
        if (err) { console.error('Failed to load coin normal map:', err); return; }
        const tex = asset.resource;
        tex.addressU = pc.ADDRESS_REPEAT;
        tex.addressV = pc.ADDRESS_REPEAT;
        for (const m of coinMaterials) { m.normalMap = tex; m.bumpiness = 0.6; m.update(); }
    });

    // One shared sphere collider + mass per coin type.
    const typeShapes = COIN_TYPES.map((t) => {
        const radius = t.diameter * 0.5;
        const shapeId = HK.HP_Shape_CreateSphere([0, 0, 0], radius)[1];
        return { radius, shapeId, mass: HK.HP_Shape_BuildMassProperties(shapeId)[1] };
    });

    for (let i = 0; i < COIN_COUNT; i++) {
        const ti = Math.floor(Math.random() * COIN_TYPES.length);
        const t = COIN_TYPES[ti];
        const ts = typeShapes[ti];

        // Initial fill across the whole column so the waterfall is full from frame one.
        const spawn = [randomRange(-DROP_HALF, DROP_HALF), randomRange(COLUMN_Y_MIN, COLUMN_Y_MAX), randomRange(-DROP_HALF, DROP_HALF)];

        const bodyId = HK.HP_Body_Create()[1];
        HK.HP_Body_SetShape(bodyId, ts.shapeId);
        HK.HP_Body_SetMotionType(bodyId, HK.MotionType.DYNAMIC);
        HK.HP_Body_SetMassProperties(bodyId, ts.mass);
        HK.HP_Body_SetPosition(bodyId, spawn);
        HK.HP_Body_SetOrientation(bodyId, randomQuaternion());
        HK.HP_World_AddBody(worldId, bodyId, false);

        const visual = new pc.Entity('coin' + i);
        visual.addComponent('model', { type: 'cylinder', material: coinMaterials[ti] });
        visual.setLocalScale(t.diameter, t.height, t.diameter);
        app.root.addChild(visual);

        coins.push({ entity: visual, bodyId, radius: ts.radius, rest: 0, prev: spawn });
    }
}

function updatePhysics() {
    HK.HP_World_Step(worldId, FIXED_TIMESTEP);
    for (const coin of coins) {
        const [, pos] = HK.HP_Body_GetPosition(coin.bodyId);
        const [, ori] = HK.HP_Body_GetOrientation(coin.bodyId);
        coin.entity.setPosition(pos[0], pos[1], pos[2]);
        coin.entity.setRotation(new pc.Quat(ori[0], ori[1], ori[2], ori[3]));

        if (pos[1] < RESET_Y) { recycle(coin); continue; }

        // "Still" detection via per-step movement (Havok exposes no velocity getter here).
        const dx = pos[0] - coin.prev[0], dy = pos[1] - coin.prev[1], dz = pos[2] - coin.prev[2];
        const moved = Math.sqrt(dx * dx + dy * dy + dz * dz);
        coin.prev = pos;

        if (pos[1] < SETTLE_Y && moved < SETTLE_MOVE) {
            if (++coin.rest > SETTLE_FRAMES) recycle(coin);
        } else {
            coin.rest = 0;
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

    app.scene.ambientLight = new pc.Color(0.5, 0.5, 0.5);
    app.scene.skyboxIntensity = 1.0;
    app.scene.skyboxMip = 1;

    // HDR environment so the metals have something to reflect.
    app.assets.loadFromUrl(HDR_URL, 'texture', (err, asset) => {
        if (err) { console.error('Failed to load HDR environment:', err); return; }
        const source = asset.resource;
        const skybox = pc.EnvLighting.generateSkyboxCubemap(source, 256);
        const envAtlas = pc.EnvLighting.generateAtlas(source);
        app.scene.setSkybox([skybox, envAtlas]);
        app.scene.envAtlas = envAtlas;
    });

    const light = new pc.Entity('light');
    light.addComponent('light', { type: 'directional', color: new pc.Color(1, 1, 1), intensity: 1.2, castShadows: true, shadowResolution: 2048, shadowBias: 0.2, normalOffsetBias: 0.05 });
    light.setLocalEulerAngles(50, 30, 0);
    app.root.addChild(light);

    camera = new pc.Entity('camera');
    camera.addComponent('camera', { clearColor: new pc.Color(0.13, 0.14, 0.16), nearClip: 0.01, farClip: 1000, fov: 60 });
    camera.addComponent('script');
    app.root.addChild(camera);
    const cc = camera.script.create(CameraControls);
    cc.enableFly = false;
    cc.reset(new pc.Vec3(0, 6, 0), new pc.Vec3(0, 18, 32));

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
