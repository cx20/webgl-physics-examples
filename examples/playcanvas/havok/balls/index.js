import * as pc from 'playcanvas';

const dataSet = [
    { file: 'Basketball.jpg',  scale: 1.0, restitution: 0.6 },
    { file: 'BeachBall.jpg',   scale: 0.9, restitution: 0.7 },
    { file: 'Football.jpg',    scale: 1.0, restitution: 0.55 },
    { file: 'Softball.jpg',    scale: 0.3, restitution: 0.4 },
    { file: 'TennisBall.jpg',  scale: 0.3, restitution: 0.75 },
];

const FIXED_TIMESTEP = 1 / 60;
const IDENTITY_QUATERNION = [0, 0, 0, 1];
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

function createStaticBox(hw, pos) {
    // HP_Shape_CreateBox takes full side lengths, so pass 2x the half-extents.
    const shapeId = HK.HP_Shape_CreateBox([0, 0, 0], IDENTITY_QUATERNION, [hw[0] * 2, hw[1] * 2, hw[2] * 2])[1];
    const bodyId  = HK.HP_Body_Create()[1];
    HK.HP_Body_SetShape(bodyId, shapeId);
    HK.HP_Body_SetMotionType(bodyId, HK.MotionType.STATIC);
    HK.HP_Body_SetPosition(bodyId, pos);
    HK.HP_Body_SetOrientation(bodyId, IDENTITY_QUATERNION);
    HK.HP_World_AddBody(worldId, bodyId, false);
    staticDebugShapes.push({ pos, hw });
}

function initPhysics() {
    worldId = HK.HP_World_Create()[1];
    HK.HP_World_SetGravity(worldId, [0, -10, 0]);
    HK.HP_World_SetIdealStepTime(worldId, FIXED_TIMESTEP);

    // Ground
    createStaticBox([20, 2, 20], [0, -2, 0]);

    // Walls — full size is 2x the half-extents, so position them at +/-5 to form a
    // clean 10x10 pen that contains the balls (which spawn within +/-5).
    createStaticBox([5, 5, 0.5], [ 0, 5, -5]);
    createStaticBox([5, 5, 0.5], [ 0, 5,  5]);
    createStaticBox([0.5, 5, 5], [-5, 5, 0]);
    createStaticBox([0.5, 5, 5], [ 5, 5, 0]);

    const darkMat = new pc.StandardMaterial();
    darkMat.diffuse = new pc.Color(0.24, 0.25, 0.26);
    darkMat.update();

    const transMat = new pc.StandardMaterial();
    transMat.diffuse = new pc.Color(0.24, 0.25, 0.26);
    transMat.opacity = 0.4;
    transMat.blendType = pc.BLEND_NORMAL;
    transMat.update();

    // Ground mesh
    const ge = new pc.Entity();
    ge.addComponent('model', { type: 'box', material: darkMat });
    ge.setLocalScale(40, 4, 40);
    ge.setPosition(0, -2, 0);
    app.root.addChild(ge);

    // Wall meshes
    const wallDefs = [
        { size: [10, 10, 1], pos: [0, 5, -5] }, { size: [10, 10, 1], pos: [0, 5, 5] },
        { size: [1, 10, 10], pos: [-5, 5, 0] }, { size: [1, 10, 10], pos: [5, 5, 0] }
    ];
    for (const w of wallDefs) {
        const we = new pc.Entity();
        we.addComponent('model', { type: 'box', material: transMat });
        we.setLocalScale(...w.size);
        we.setPosition(...w.pos);
        app.root.addChild(we);
    }

    // Preload textures and create materials
    const textures = dataSet.map(d => getTexture(d.file, 512, 512));
    const materials = dataSet.map((d, i) => {
        const m = new pc.StandardMaterial();
        m.diffuseMap = textures[i];
        m.update();
        return m;
    });

    for (let i = 0; i < 200; i++) {
        const x = -5 + Math.random() * 10;
        const y = 6 + Math.random() * 13;
        const z = -5 + Math.random() * 10;
        const idx = Math.floor(Math.random() * dataSet.length);
        const scale = dataSet[idx].scale;
        const radius = scale * 0.5;
        const restitution = dataSet[idx].restitution;

        const shapeId = HK.HP_Shape_CreateSphere([0, 0, 0], radius)[1];
        if (typeof HK.HP_Shape_SetMaterial === 'function') {
            HK.HP_Shape_SetMaterial(shapeId, [0.5, 0.5, restitution, HK.MaterialCombine.MAXIMUM, HK.MaterialCombine.MAXIMUM]);
        }
        const massProps = HK.HP_Shape_BuildMassProperties(shapeId)[1];
        const bodyId = HK.HP_Body_Create()[1];
        HK.HP_Body_SetShape(bodyId, shapeId);
        HK.HP_Body_SetMotionType(bodyId, HK.MotionType.DYNAMIC);
        HK.HP_Body_SetMassProperties(bodyId, massProps);
        HK.HP_Body_SetPosition(bodyId, [x, y, z]);
        HK.HP_Body_SetOrientation(bodyId, IDENTITY_QUATERNION);
        HK.HP_World_AddBody(worldId, bodyId, false);

        const entity = new pc.Entity();
        entity.addComponent('model', { type: 'sphere', material: materials[idx] });
        entity.setLocalScale(scale, scale, scale);
        app.root.addChild(entity);
        physicsObjects.push({ entity, bodyId, radius });
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
            const x = -5 + Math.random() * 10, y = 10 + Math.random() * 8, z = -5 + Math.random() * 10;
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

    app.scene.ambientLight = new pc.Color(0.24, 0.25, 0.26);

    const light = new pc.Entity('light');
    light.addComponent('light', { type: 'directional', color: new pc.Color(1, 1, 1), castShadows: true, shadowResolution: 2048 });
    // A directional light's direction comes from its rotation, not its position;
    // setPosition() leaves it pointing the default way, so most balls only got the dim
    // ambient light and looked black. Orient it like the other examples instead.
    light.setLocalEulerAngles(45, 45, 45);
    app.root.addChild(light);

    camera = new pc.Entity('camera');
    camera.addComponent('camera', { clearColor: new pc.Color(0.24, 0.25, 0.26), farClip: 300 });
    app.root.addChild(camera);

    initPhysics();
    setInterval(updatePhysics, 1000 / 60);

    let angle = 0;
    app.on('update', (dt) => {
        angle += 0.25 * dt;
        camera.setPosition(Math.sin(angle) * 12, 8, Math.cos(angle) * 12);
        camera.lookAt(new pc.Vec3(0, 1.5, 0));
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
