import * as pc from 'playcanvas';
import { CameraControls } from 'playcanvas/scripts/esm/camera-controls.mjs';

const FIXED_TIMESTEP = 1 / 60;
const IDENTITY_QUATERNION = [0, 0, 0, 1];
const BASE_URL = 'https://cx20.github.io/webgl-physics-examples/assets/textures/';
const _DBG_COLOR_DYNAMIC = new pc.Color(0, 1, 0, 1);
const _DBG_COLOR_STATIC  = new pc.Color(1, 1, 0, 1);

let HK, worldId, app, camera;
let showWireframe = true;

const physicsObjects = [];   // {entity, bodyId, hw: [x,y,z]}
const staticDebugShapes = []; // {pos: [x,y,z], hw: [x,y,z]}

function drawDebug() {
    for (const s of staticDebugShapes) {
        const mat = new pc.Mat4().setTRS(new pc.Vec3(...s.pos), new pc.Quat(), pc.Vec3.ONE);
        app.drawWireAlignedBox(new pc.Vec3(-s.hw[0], -s.hw[1], -s.hw[2]), new pc.Vec3(s.hw[0], s.hw[1], s.hw[2]), _DBG_COLOR_STATIC, false, undefined, mat);
    }
    for (const obj of physicsObjects) {
        const mat = new pc.Mat4().setTRS(obj.entity.getPosition(), obj.entity.getRotation(), pc.Vec3.ONE);
        app.drawWireAlignedBox(new pc.Vec3(-obj.hw[0], -obj.hw[1], -obj.hw[2]), new pc.Vec3(obj.hw[0], obj.hw[1], obj.hw[2]), _DBG_COLOR_DYNAMIC, false, undefined, mat);
    }
}

function getTexture(file, w, h) {
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
    img.src = BASE_URL + file;
    return tex;
}

function createBoxBody(x, y, z, hw, hh, hd, isDynamic) {
    // HP_Shape_CreateBox takes full side lengths, so pass 2x the half-extents.
    const shapeId = HK.HP_Shape_CreateBox([0, 0, 0], IDENTITY_QUATERNION, [hw * 2, hh * 2, hd * 2])[1];
    const bodyId  = HK.HP_Body_Create()[1];
    HK.HP_Body_SetShape(bodyId, shapeId);
    HK.HP_Body_SetPosition(bodyId, [x, y, z]);
    HK.HP_Body_SetOrientation(bodyId, IDENTITY_QUATERNION);
    if (isDynamic) {
        HK.HP_Body_SetMotionType(bodyId, HK.MotionType.DYNAMIC);
        HK.HP_Body_SetMassProperties(bodyId, HK.HP_Shape_BuildMassProperties(shapeId)[1]);
    } else {
        HK.HP_Body_SetMotionType(bodyId, HK.MotionType.STATIC);
    }
    HK.HP_World_AddBody(worldId, bodyId, false);
    return bodyId;
}

function createBoxEntity(x, y, z, w, h, d, material) {
    const entity = new pc.Entity();
    entity.addComponent('model', { type: 'box', material });
    entity.setLocalScale(w, h, d);
    entity.setPosition(x, y, z);
    app.root.addChild(entity);
    return entity;
}

function initPhysics() {
    worldId = HK.HP_World_Create()[1];
    HK.HP_World_SetGravity(worldId, [0, -9.81, 0]);
    HK.HP_World_SetIdealStepTime(worldId, FIXED_TIMESTEP);

    const frogMat = new pc.StandardMaterial();
    frogMat.diffuseMap = getTexture('frog.jpg', 256, 256);
    frogMat.update();

    const floorMat = new pc.StandardMaterial();
    floorMat.diffuse = new pc.Color(0.5, 0.5, 0.5);
    floorMat.update();

    // Floor (static)
    createBoxBody(0, -0.5, 0, 5, 0.5, 5, false);
    createBoxEntity(0, -0.5, 0, 10, 1, 10, floorMat);
    staticDebugShapes.push({ pos: [0, -0.5, 0], hw: [5, 0.5, 5] });

    // Cube (dynamic)
    const bodyId = createBoxBody(0, 3, 0, 0.5, 0.5, 0.5, true);
    const entity = createBoxEntity(0, 3, 0, 1, 1, 1, frogMat);
    physicsObjects.push({ entity, bodyId, hw: [0.5, 0.5, 0.5] });
}

function updatePhysics() {
    HK.HP_World_Step(worldId, FIXED_TIMESTEP);
    for (const obj of physicsObjects) {
        const [, pos] = HK.HP_Body_GetPosition(obj.bodyId);
        const [, ori] = HK.HP_Body_GetOrientation(obj.bodyId);
        obj.entity.setPosition(pos[0], pos[1], pos[2]);
        obj.entity.setRotation(new pc.Quat(ori[0], ori[1], ori[2], ori[3]));
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
    camera.addComponent('camera', { clearColor: new pc.Color(0.5, 0.5, 0.8), farClip: 50 });
    camera.addComponent('script');
    app.root.addChild(camera);
    const cc = camera.script.create(CameraControls);
    cc.enableFly = false;
    cc.reset(new pc.Vec3(0, 0, 0), new pc.Vec3(0, 5, 15));

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
