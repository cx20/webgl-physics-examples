import * as pc from 'playcanvas';

// PlayCanvas (rendering) + Havok low-level API (physics).
// A glTF Duck is dropped onto a floor. Its collider is an axis-aligned box sized
// to the model's bounding box; a translucent box shows the collider's extents.

const FIXED_TIMESTEP = 1 / 60;
const IDENTITY_QUATERNION = [0, 0, 0, 1];
const DUCK_URL = 'https://rawcdn.githack.com/cx20/gltf-test/5465cc37/sampleModels/Duck/glTF/Duck.gltf';
const _DBG_COLOR_DYNAMIC = new pc.Color(0, 1, 0, 1);
const _DBG_COLOR_STATIC  = new pc.Color(1, 1, 0, 1);

let HK, worldId, app, camera;
let showWireframe = true;
const physicsObjects = [];    // {entity, bodyId, hw:[x,y,z], spawn:[x,y,z]}
const staticDebugShapes = []; // {pos:[x,y,z], hw:[x,y,z]}

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

function createBoxBody(x, y, z, hw, hh, hd, isDynamic) {
    const shapeId = HK.HP_Shape_CreateBox([0, 0, 0], IDENTITY_QUATERNION, [hw, hh, hd])[1];
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

function initPhysics() {
    worldId = HK.HP_World_Create()[1];
    HK.HP_World_SetGravity(worldId, [0, -9.81, 0]);
    HK.HP_World_SetIdealStepTime(worldId, FIXED_TIMESTEP);

    const floorMat = new pc.StandardMaterial();
    floorMat.diffuse = new pc.Color(0.5, 0.5, 0.5);
    floorMat.update();

    // Floor (static)
    createBoxBody(0, -0.5, 0, 5, 0.5, 5, false);
    const floor = new pc.Entity();
    floor.addComponent('model', { type: 'box', material: floorMat });
    floor.setLocalScale(10, 1, 10);
    floor.setPosition(0, -0.5, 0);
    app.root.addChild(floor);
    staticDebugShapes.push({ pos: [0, -0.5, 0], hw: [5, 0.5, 5] });

    // Duck (dynamic) — box collider sized to the model's bounding box.
    const filename = DUCK_URL.split('/').pop();
    app.assets.loadFromUrlAndFilename(DUCK_URL, filename, 'container', (err, asset) => {
        if (err) { console.error(err); return; }
        const resource = asset.resource;

        const container = new pc.Entity('duckBody');

        const duckModel = new pc.Entity('duckModel');
        duckModel.addComponent('model', { type: 'asset', asset: resource.model });

        const aabb = duckModel.model.meshInstances[0].aabb;
        const center = aabb.center;
        const half = aabb.halfExtents;

        // Offset the model so its bounding-box centre sits on the body origin.
        duckModel.setLocalPosition(-center.x, -center.y, -center.z);
        container.addChild(duckModel);

        // Translucent box visualising the collider extents.
        const transMat = new pc.StandardMaterial();
        transMat.diffuse = new pc.Color(1, 1, 1);
        transMat.opacity = 0.5;
        transMat.blendType = pc.BLEND_NORMAL;
        transMat.update();
        const boundingBox = new pc.Entity('boundingBox');
        boundingBox.setLocalScale(half.x * 2, half.y * 2, half.z * 2);
        boundingBox.addComponent('model', { type: 'box', material: transMat });
        container.addChild(boundingBox);

        app.root.addChild(container);

        const spawn = [0, 10, 0];
        const bodyId = createBoxBody(spawn[0], spawn[1], spawn[2], half.x, half.y, half.z, true);
        physicsObjects.push({ entity: container, bodyId, hw: [half.x, half.y, half.z], spawn });
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
            HK.HP_Body_SetPosition(obj.bodyId, obj.spawn);
            HK.HP_Body_SetOrientation(obj.bodyId, IDENTITY_QUATERNION);
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

    app.scene.ambientLight = new pc.Color(0.2, 0.2, 0.2);

    const light = new pc.Entity('light');
    light.addComponent('light', { type: 'directional', color: new pc.Color(1, 1, 1), castShadows: true, shadowResolution: 2048 });
    light.setLocalEulerAngles(45, 45, 45);
    app.root.addChild(light);

    camera = new pc.Entity('camera');
    camera.addComponent('camera', { clearColor: new pc.Color(0.5, 0.5, 0.8), farClip: 50 });
    app.root.addChild(camera);

    initPhysics();
    setInterval(updatePhysics, 1000 / 60);

    let angle = 0;
    app.on('update', (dt) => {
        angle += 0.5 * dt;
        camera.setPosition(Math.sin(angle) * 4, 3, Math.cos(angle) * 4);
        camera.lookAt(0, 0, 0);
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
