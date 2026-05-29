import * as pc from 'playcanvas';
import { CameraControls } from 'playcanvas/scripts/esm/camera-controls.mjs';

// PlayCanvas (rendering) + Havok low-level API (physics).
// glTF marbles pour into an open box. Each marble collides as a sphere; the visual
// is a clone of a sphere node taken from the IridescenceMetallicSpheres glTF.

const FIXED_TIMESTEP = 1 / 60;
const IDENTITY_QUATERNION = [0, 0, 0, 1];
const BASE_URL = 'https://cx20.github.io/gltf-test';
const HDR_URL = 'https://cx20.github.io/gltf-test/textures/hdr/papermill_playcanvas_texture-tool.hdr';
const MODEL_URL = BASE_URL + '/tutorialModels/IridescenceMetallicSpheres/glTF/IridescenceMetallicSpheres.gltf';

const MARBLE_COUNT = 220;
const BOX_HALF = 5;
const SPAWN_MARGIN = 0.7;
const MARBLE_RADIUS = 0.5;
const MARBLE_VISUAL_SCALE = 0.42;

const _DBG_COLOR_DYNAMIC = new pc.Color(0, 1, 0, 1);
const _DBG_COLOR_STATIC  = new pc.Color(1, 1, 0, 1);

let HK, worldId, app, camera;
let showWireframe = true;
const physicsObjects = [];    // {entity, bodyId, radius}
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
    for (const obj of physicsObjects) {
        _drawWireSphere(obj.entity.getPosition(), obj.radius, _DBG_COLOR_DYNAMIC);
    }
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

function randomSpawn() {
    const min = -BOX_HALF + SPAWN_MARGIN, max = BOX_HALF - SPAWN_MARGIN;
    return [randomRange(min, max), randomRange(2, 10), randomRange(min, max)];
}

function randomQuaternion() {
    const q = new pc.Quat();
    q.setFromEulerAngles(randomRange(0, 360), randomRange(0, 360), randomRange(0, 360));
    return [q.x, q.y, q.z, q.w];
}

function collectSphereEntities(entity, output) {
    if (entity.name.indexOf('Sphere') !== -1 && (entity.render || entity.model)) output.push(entity);
    for (const child of entity.children) collectSphereEntities(child, output);
}

function enableShadows(entity) {
    if (entity.render) { entity.render.castShadows = true; entity.render.receiveShadows = true; }
    if (entity.model)  { entity.model.castShadows = true;  entity.model.receiveShadows = true; }
    for (const child of entity.children) enableShadows(child);
}

function initPhysics() {
    worldId = HK.HP_World_Create()[1];
    HK.HP_World_SetGravity(worldId, [0, -9.81, 0]);
    HK.HP_World_SetIdealStepTime(worldId, FIXED_TIMESTEP);

    const floorMat = new pc.StandardMaterial();
    floorMat.diffuse = new pc.Color(0.55, 0.58, 0.65);
    floorMat.update();

    const wallMat = new pc.StandardMaterial();
    wallMat.diffuse = new pc.Color(1, 1, 1);
    wallMat.opacity = 0.25;
    wallMat.blendType = pc.BLEND_NORMAL;
    wallMat.update();

    // Floor (static)
    createStaticBox(0, -2, 0, 20, 2, 20);
    const floor = new pc.Entity();
    floor.addComponent('model', { type: 'box', material: floorMat, castShadows: false });
    floor.setLocalScale(40, 4, 40);
    floor.setPosition(0, -2, 0);
    app.root.addChild(floor);

    // Walls (static) — open box pen on top of the floor.
    const wallData = [
        { size: [10, 10, 1], pos: [0, 5, -5] },
        { size: [10, 10, 1], pos: [0, 5,  5] },
        { size: [1, 10, 10], pos: [-5, 5, 0] },
        { size: [1, 10, 10], pos: [5, 5,  0] }
    ];
    for (const w of wallData) {
        createStaticBox(w.pos[0], w.pos[1], w.pos[2], w.size[0] / 2, w.size[1] / 2, w.size[2] / 2);
        const wall = new pc.Entity();
        wall.addComponent('model', { type: 'box', material: wallMat, castShadows: false });
        wall.setLocalScale(w.size[0], w.size[1], w.size[2]);
        wall.setPosition(w.pos[0], w.pos[1], w.pos[2]);
        app.root.addChild(wall);
    }

    // Shared sphere collider.
    const sphereShapeId = HK.HP_Shape_CreateSphere([0, 0, 0], MARBLE_RADIUS)[1];
    const sphereMass    = HK.HP_Shape_BuildMassProperties(sphereShapeId)[1];

    const filename = 'IridescenceMetallicSpheres.gltf';
    app.assets.loadFromUrlAndFilename(MODEL_URL, filename, 'container', (err, asset) => {
        if (err) { console.error(err); return; }
        const resource = asset.resource;
        const sourceRoot = resource.instantiateRenderEntity ?
            resource.instantiateRenderEntity() :
            resource.instantiateModelEntity();

        sourceRoot.enabled = false;
        app.root.addChild(sourceRoot);

        const templates = [];
        collectSphereEntities(sourceRoot, templates);
        if (templates.length === 0) { console.warn('No sphere nodes found in glTF.'); return; }

        for (let i = 0; i < MARBLE_COUNT; i++) {
            const spawn = randomSpawn();

            const bodyId = HK.HP_Body_Create()[1];
            HK.HP_Body_SetShape(bodyId, sphereShapeId);
            HK.HP_Body_SetMotionType(bodyId, HK.MotionType.DYNAMIC);
            HK.HP_Body_SetMassProperties(bodyId, sphereMass);
            HK.HP_Body_SetPosition(bodyId, spawn);
            HK.HP_Body_SetOrientation(bodyId, randomQuaternion());
            HK.HP_World_AddBody(worldId, bodyId, false);

            const visual = templates[i % templates.length].clone();
            visual.enabled = true;
            visual.setLocalPosition(0, 0, 0);
            visual.setLocalScale(MARBLE_VISUAL_SCALE, MARBLE_VISUAL_SCALE, MARBLE_VISUAL_SCALE);
            enableShadows(visual);

            const container = new pc.Entity('marble' + i);
            container.addChild(visual);
            app.root.addChild(container);

            physicsObjects.push({ entity: container, bodyId, radius: MARBLE_RADIUS });
        }
    });
}

function updatePhysics() {
    HK.HP_World_Step(worldId, FIXED_TIMESTEP);
    for (const obj of physicsObjects) {
        const [, pos] = HK.HP_Body_GetPosition(obj.bodyId);
        const [, ori] = HK.HP_Body_GetOrientation(obj.bodyId);
        obj.entity.setPosition(pos[0], pos[1], pos[2]);
        obj.entity.setRotation(new pc.Quat(ori[0], ori[1], ori[2], ori[3]));

        if (pos[1] < -10) {
            HK.HP_Body_SetPosition(obj.bodyId, randomSpawn());
            HK.HP_Body_SetOrientation(obj.bodyId, randomQuaternion());
            HK.HP_Body_SetLinearVelocity(obj.bodyId, [0, 0, 0]);
            HK.HP_Body_SetAngularVelocity(obj.bodyId, [0, 0, 0]);
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

    app.scene.ambientLight = new pc.Color(0.7, 0.7, 0.7);
    app.scene.skyboxIntensity = 1.0;
    app.scene.skyboxMip = 0;

    // HDR environment so the iridescent metals have something to reflect.
    app.assets.loadFromUrl(HDR_URL, 'texture', (err, asset) => {
        if (err) { console.error('Failed to load HDR environment:', err); return; }
        const source = asset.resource;
        const skybox = pc.EnvLighting.generateSkyboxCubemap(source, 256);
        const envAtlas = pc.EnvLighting.generateAtlas(source);
        app.scene.setSkybox([skybox, envAtlas]);
        app.scene.envAtlas = envAtlas;
    });

    const light = new pc.Entity('light');
    light.addComponent('light', { type: 'directional', color: new pc.Color(1, 1, 1), castShadows: true, shadowResolution: 2048, shadowBias: 0.3, normalOffsetBias: 0.02 });
    light.setLocalEulerAngles(45, 45, 45);
    app.root.addChild(light);

    camera = new pc.Entity('camera');
    camera.addComponent('camera', { clearColor: new pc.Color(0.17, 0.18, 0.22), nearClip: 0.01, farClip: 1000, fov: 60 });
    camera.addComponent('script');
    app.root.addChild(camera);
    const cc = camera.script.create(CameraControls);
    cc.enableFly = false;
    cc.reset(new pc.Vec3(0, 2, 0), new pc.Vec3(0, 9, 18));

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
