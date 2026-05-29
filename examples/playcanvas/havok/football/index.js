import * as pc from 'playcanvas';

// ‥‥‥‥‥‥‥‥‥‥‥‥‥□□□
// ‥‥‥‥‥‥〓〓〓〓〓‥‥□□□
// ‥‥‥‥‥〓〓〓〓〓〓〓〓〓□□
// ‥‥‥‥‥■■■□□■□‥■■■
// ‥‥‥‥■□■□□□■□□■■■
// ‥‥‥‥■□■■□□□■□□□■
// ‥‥‥‥■■□□□□■■■■■‥
// ‥‥‥‥‥‥□□□□□□□■‥‥
// ‥‥■■■■■〓■■■〓■‥‥‥
// ‥■■■■■■■〓■■■〓‥‥■
// □□■■■■■■〓〓〓〓〓‥‥■
// □□□‥〓〓■〓〓□〓〓□〓■■
// ‥□‥■〓〓〓〓〓〓〓〓〓〓■■
// ‥‥■■■〓〓〓〓〓〓〓〓〓■■
// ‥■■■〓〓〓〓〓〓〓‥‥‥‥‥
// ‥■‥‥〓〓〓〓‥‥‥‥‥‥‥‥
const dataSet = [
    "無","無","無","無","無","無","無","無","無","無","無","無","無","肌","肌","肌",
    "無","無","無","無","無","無","赤","赤","赤","赤","赤","無","無","肌","肌","肌",
    "無","無","無","無","無","赤","赤","赤","赤","赤","赤","赤","赤","赤","肌","肌",
    "無","無","無","無","無","茶","茶","茶","肌","肌","茶","肌","無","赤","赤","赤",
    "無","無","無","無","茶","肌","茶","肌","肌","肌","茶","肌","肌","赤","赤","赤",
    "無","無","無","無","茶","肌","茶","茶","肌","肌","肌","茶","肌","肌","肌","赤",
    "無","無","無","無","茶","茶","肌","肌","肌","肌","茶","茶","茶","茶","赤","無",
    "無","無","無","無","無","無","肌","肌","肌","肌","肌","肌","肌","赤","無","無",
    "無","無","赤","赤","赤","赤","赤","青","赤","赤","赤","青","赤","無","無","無",
    "無","赤","赤","赤","赤","赤","赤","赤","青","赤","赤","赤","青","無","無","茶",
    "肌","肌","赤","赤","赤","赤","赤","赤","青","青","青","青","青","無","無","茶",
    "肌","肌","肌","無","青","青","赤","青","青","黄","青","青","黄","青","茶","茶",
    "無","肌","無","茶","青","青","青","青","青","青","青","青","青","青","茶","茶",
    "無","無","茶","茶","茶","青","青","青","青","青","青","青","青","青","茶","茶",
    "無","茶","茶","茶","青","青","青","青","青","青","青","無","無","無","無","無",
    "無","茶","無","無","青","青","青","青","無","無","無","無","無","無","無","無"
];

const colorHash = {
    "無": [0xDC/0xFF, 0xAA/0xFF, 0x6B/0xFF],
    "白": [1, 1, 1],       "肌": [1, 0.8, 0.8],
    "茶": [0.5, 0, 0],     "赤": [1, 0, 0],
    "黄": [1, 1, 0],       "緑": [0, 1, 0],
    "水": [0, 1, 1],       "青": [0, 0, 1],
    "紫": [0.5, 0, 0.5]
};

const FIXED_TIMESTEP = 1 / 60;
const IDENTITY_QUATERNION = [0, 0, 0, 1];
const BALL_SIZE = 1;
const BASE_URL = 'https://cx20.github.io/webgl-physics-examples/assets/textures/';
const _DBG_COLOR_DYNAMIC = new pc.Color(0, 1, 0, 1);
const _DBG_COLOR_STATIC  = new pc.Color(1, 1, 0, 1);

let HK, worldId, app, camera;
let showWireframe = true;
const physicsObjects = [];
const staticDebugShapes = [];

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

function getTexture(file, w, h) {
    const tex = new pc.Texture(app.graphicsDevice, { width: w, height: h });
    const img = new Image();
    img.onload = () => {
        tex.minFilter = pc.FILTER_LINEAR; tex.magFilter = pc.FILTER_LINEAR;
        tex.addressU = pc.ADDRESS_CLAMP_TO_EDGE; tex.addressV = pc.ADDRESS_CLAMP_TO_EDGE;
        tex.setSource(img);
    };
    img.crossOrigin = 'anonymous';
    img.src = BASE_URL + file;
    return tex;
}

function initPhysics() {
    worldId = HK.HP_World_Create()[1];
    HK.HP_World_SetGravity(worldId, [0, -10, 0]);
    HK.HP_World_SetIdealStepTime(worldId, FIXED_TIMESTEP);

    const grassTex   = getTexture('grass.jpg', 512, 512);
    const footballTex = getTexture('football.png', 1024, 512);

    // Ground
    const gsId = HK.HP_Shape_CreateBox([0, 0, 0], IDENTITY_QUATERNION, [20, 0.4, 20])[1];
    const gbId = HK.HP_Body_Create()[1];
    HK.HP_Body_SetShape(gbId, gsId);
    HK.HP_Body_SetMotionType(gbId, HK.MotionType.STATIC);
    HK.HP_Body_SetPosition(gbId, [0, 0, 0]);
    HK.HP_Body_SetOrientation(gbId, IDENTITY_QUATERNION);
    HK.HP_World_AddBody(worldId, gbId, false);

    const grassMat = new pc.StandardMaterial();
    grassMat.diffuseMap = grassTex;
    grassMat.update();
    const groundEntity = new pc.Entity();
    groundEntity.addComponent('model', { type: 'box', material: grassMat });
    groundEntity.setLocalScale(40, 0.8, 40);
    app.root.addChild(groundEntity);
    staticDebugShapes.push({ pos: [0, 0, 0], hw: [20, 0.4, 20] });

    // Shared ball shape
    const radius = BALL_SIZE / 2;
    const ballShapeId  = HK.HP_Shape_CreateSphere([0, 0, 0], radius)[1];
    const ballMassProps = HK.HP_Shape_BuildMassProperties(ballShapeId)[1];

    const ballMat = new pc.StandardMaterial();
    ballMat.diffuseMap = footballTex;
    ballMat.update();

    for (let x = 0; x < 16; x++) {
        for (let y = 0; y < 16; y++) {
            const [r, g, b] = colorHash[dataSet[y * 16 + x]];
            const x1 = -10 + x * BALL_SIZE * 1.5 + Math.random() * 0.1;
            const y1 = (15 - y) * BALL_SIZE * 1.2 + 2 + Math.random() * 0.1;
            const z1 = Math.random() * 0.1;

            const bodyId = HK.HP_Body_Create()[1];
            HK.HP_Body_SetShape(bodyId, ballShapeId);
            HK.HP_Body_SetMotionType(bodyId, HK.MotionType.DYNAMIC);
            HK.HP_Body_SetMassProperties(bodyId, ballMassProps);
            HK.HP_Body_SetPosition(bodyId, [x1, y1, z1]);
            HK.HP_Body_SetOrientation(bodyId, IDENTITY_QUATERNION);
            HK.HP_World_AddBody(worldId, bodyId, false);

            const tintMat = new pc.StandardMaterial();
            tintMat.diffuse = new pc.Color(r, g, b);
            tintMat.diffuseMapTint = true;
            tintMat.diffuseMap = footballTex;
            tintMat.update();

            const entity = new pc.Entity();
            entity.addComponent('model', { type: 'sphere', material: tintMat });
            entity.setLocalScale(radius * 2, radius * 2, radius * 2);
            app.root.addChild(entity);
            physicsObjects.push({ entity, bodyId, radius });
        }
    }
}

function updatePhysics() {
    HK.HP_World_Step(worldId, FIXED_TIMESTEP);
    for (const obj of physicsObjects) {
        const [, pos] = HK.HP_Body_GetPosition(obj.bodyId);
        const [, ori] = HK.HP_Body_GetOrientation(obj.bodyId);
        obj.entity.setPosition(pos[0], pos[1], pos[2]);
        obj.entity.setRotation(new pc.Quat(ori[0], ori[1], ori[2], ori[3]));

        if (pos[1] < -10) {
            const x = -5 + Math.random() * 10, y = 20 + Math.random() * 10, z = -5 + Math.random() * 10;
            HK.HP_Body_SetPosition(obj.bodyId, [x, y, z]);
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
    camera.addComponent('camera', { clearColor: new pc.Color(0.5, 0.5, 0.8), farClip: 300 });
    app.root.addChild(camera);

    initPhysics();
    setInterval(updatePhysics, 1000 / 60);

    let angle = 0;
    app.on('update', (dt) => {
        angle += 0.25 * dt;
        camera.setPosition(Math.sin(angle) * 28, 12, Math.cos(angle) * 28);
        camera.lookAt(new pc.Vec3(0, 4, 0));
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
