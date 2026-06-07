GLBoost.CONSOLE_OUT_FOR_DEBUGGING = true;

const FIXED_TIMESTEP = 1 / 60;
const IDENTITY_QUATERNION = [0, 0, 0, 1];
const PIECE_COUNT = 300;

// Head-on framing shared with the other Havok shogi samples: 45 deg FOV with the
// camera 40 units from the origin.
const CAMERA_FOVY = 45;
const CAMERA_DISTANCE = 40;

// glboost var
let canvas = document.getElementById("world");
let width = window.innerWidth;
let height = window.innerHeight;
let glBoostContext = new GLBoost.GLBoostMiddleContext(canvas);
let renderer;
let camera;
let scene;
let meshs = [];
let expression;

// havok var
let HK;
let worldId;
let bodyIds = [];

// collider wireframe (W key)
let debugMeshs = [];        // all collider wireframes (for the W toggle)
let pieceDebugMeshs = [];   // per-piece wireframes, parallel to bodyIds
let showWireframe = true;
const DEBUG_COLOR_DYNAMIC = new GLBoost.Vector4(1.0, 0.5, 0.2, 1.0);
const DEBUG_COLOR_STATIC = new GLBoost.Vector4(0.2, 1.0, 0.4, 1.0);

main();

async function main() {
    HK = await HavokPhysics();
    init();
}

// Havok returns enums as objects in some builds; normalise to a number.
function enumToNumber(value) {
    if (typeof value === 'number' || typeof value === 'bigint') return Number(value);
    if (!value || typeof value !== 'object') return NaN;
    if (typeof value.value === 'number' || typeof value.value === 'bigint') return Number(value.value);
    if (typeof value.m_value === 'number' || typeof value.m_value === 'bigint') return Number(value.m_value);
    return NaN;
}

function checkResult(result, label) {
    if (result === HK.Result.RESULT_OK) return;
    let rc = enumToNumber(result);
    let ok = enumToNumber(HK.Result.RESULT_OK);
    if (!Number.isNaN(rc) && !Number.isNaN(ok) && rc === ok) return;
    console.warn('[Havok] ' + label + ' returned:', result);
}

function init() {
    scene = glBoostContext.createScene();
    renderer = glBoostContext.createRenderer({
        canvas: canvas,
        clearColor: {red: 0.17, green: 0.19, blue: 0.22, alpha: 1}
    });
    renderer.resize(width, height);

    // Head-on camera matching the other Havok shogi samples (effective camera
    // distance 40 looking at the origin, 45 deg FOV); mouse drag orbits.
    // GLBoost's camera controller rescales the eye->center distance by
    // 1 / tan(fovy/2), so pre-multiply by tan(fovy/2) to keep the framing.
    let eyeZ = CAMERA_DISTANCE * Math.tan((CAMERA_FOVY / 2) * Math.PI / 180);
    camera = glBoostContext.createPerspectiveCamera({
        eye: new GLBoost.Vector3(0, 0, eyeZ),
        center: new GLBoost.Vector3(0.0, 0.0, 0.0),
        up: new GLBoost.Vector3(0.0, 1.0, 0.0)
    }, {
        fovy: CAMERA_FOVY,
        aspect: width/height,
        zNear: 0.1,
        zFar: 1000.0
    });
    camera.cameraController = glBoostContext.createCameraController();
    scene.addChild(camera);

    let directionalLight1 = glBoostContext.createDirectionalLight(new GLBoost.Vector3(0.8, 0.8, 0.8), new GLBoost.Vector3(30, 30, 30));
    scene.addChild( directionalLight1 );
    let directionalLight2 = glBoostContext.createDirectionalLight(new GLBoost.Vector3(0.6, 0.6, 0.6), new GLBoost.Vector3(-30, -30, -30));
    scene.addChild( directionalLight2 );

    // Havok world
    let worldRes = HK.HP_World_Create();
    checkResult(worldRes[0], 'HP_World_Create');
    worldId = worldRes[1];
    checkResult(HK.HP_World_SetGravity(worldId, [0, -9.8, 0]), 'HP_World_SetGravity');
    checkResult(HK.HP_World_SetIdealStepTime(worldId, FIXED_TIMESTEP), 'HP_World_SetIdealStepTime');

    // Ground: small low floor (no walls), matching the other Havok shogi samples -
    // a 13 x 0.1 x 13 slab at y = -10 that the heap overflows.
    createStaticBox([13, 0.1, 13], [0, -10, 0]);
    let groundGeo = glBoostContext.createCube(new GLBoost.Vector3(13, 0.1, 13), new GLBoost.Vector4(0.24, 0.25, 0.26, 1));
    let groundMaterial = glBoostContext.createClassicMaterial();
    groundMaterial.shaderClass = GLBoost.HalfLambertShader;
    let mground = glBoostContext.createMesh(groundGeo, groundMaterial);
    mground.translate = new GLBoost.Vector3(0, -10, 0);
    scene.addChild( mground );

    // Ground collider wireframe (matches the Havok ground box, full size 13x0.1x13)
    let groundWireGeo = createWireframeBoxGeometry(13, 0.1, 13, DEBUG_COLOR_STATIC);
    let groundWireMesh = glBoostContext.createMesh(groundWireGeo, glBoostContext.createClassicMaterial());
    groundWireMesh.translate = new GLBoost.Vector3(0, -10, 0);
    scene.addChild(groundWireMesh);
    debugMeshs.push(groundWireMesh);

    populate();

    // loop
    expression = glBoostContext.createExpressionAndRenderPasses(1);
    expression.renderPasses[0].scene = scene;
    expression.prepareToRender();
    loop();
}

function populate() {

    let w = 1.6;
    let h = 1.6;
    let d = 0.32;
    // Collider matches the other Havok samples' SHOGI_PHYSICS_SIZE = [w, h*1.2, d*1.4].
    let colliderSize = [w, h * 1.2, d * 1.4];

    let positions = [
        // Front face
        [-0.5 * w,  -0.5 * h,  0.7 * d], // v0
        [ 0.5 * w,  -0.5 * h,  0.7 * d], // v1
        [ 0.35 * w,  0.5 * h,  0.4 * d], // v2
        [-0.35 * w,  0.5 * h,  0.4 * d], // v3
        // Back face
        [-0.5 * w,  -0.5 * h, -0.7 * d], // v4
        [ 0.5 * w,  -0.5 * h, -0.7 * d], // v5
        [ 0.35 * w,  0.5 * h, -0.4 * d], // v6
        [-0.35 * w,  0.5 * h, -0.4 * d], // v7
        // Top face
        [ 0.35 * w,  0.5 * h,  0.4 * d], // v2
        [-0.35 * w,  0.5 * h,  0.4 * d], // v3
        [-0.35 * w,  0.5 * h, -0.4 * d], // v7
        [ 0.35 * w,  0.5 * h, -0.4 * d], // v6
        // Bottom face
        [-0.5 * w,  -0.5 * h,  0.7 * d], // v0
        [ 0.5 * w,  -0.5 * h,  0.7 * d], // v1
        [ 0.5 * w,  -0.5 * h, -0.7 * d], // v5
        [-0.5 * w,  -0.5 * h, -0.7 * d], // v4
        // Right face
        [ 0.5 * w,  -0.5 * h,  0.7 * d], // v1
        [ 0.35 * w,  0.5 * h,  0.4 * d], // v2
        [ 0.35 * w,  0.5 * h, -0.4 * d], // v6
        [ 0.5 * w,  -0.5 * h, -0.7 * d], // v5
        // Left face
        [-0.5 * w,  -0.5 * h,  0.7 * d], // v0
        [-0.35 * w,  0.5 * h,  0.4 * d], // v3
        [-0.35 * w,  0.5 * h, -0.4 * d], // v7
        [-0.5 * w,  -0.5 * h, -0.7 * d], // v4
        // Front2 face
        [-0.35 * w,  0.5 * h,  0.4 * d],  // v3
        [ 0.35 * w,  0.5 * h,  0.4 * d],  // v2
        [ 0.0 * w,   0.6 * h,  0.35 * d], // v8
        // Back2 face
        [-0.35 * w,  0.5 * h, -0.4 * d],  // v7
        [ 0.35 * w,  0.5 * h, -0.4 * d],  // v6
        [ 0.0 * w,   0.6 * h, -0.35 * d], // v9
        // Right2 Face
        [ 0.35 * w,  0.5 * h,  0.4 * d],  // v2
        [ 0.35 * w,  0.5 * h, -0.4 * d],  // v6
        [ 0.0 * w,   0.6 * h, -0.35 * d], // v9
        [ 0.0 * w,   0.6 * h,  0.35 * d], // v8
        // Left2 Face
        [-0.35 * w,  0.5 * h,  0.4 * d],  // v3
        [-0.35 * w,  0.5 * h, -0.4 * d],  // v7
        [ 0.0 * w,   0.6 * h, -0.35 * d], // v9
        [ 0.0 * w,   0.6 * h,  0.35 * d]  // v8
    ];

    let texcoords = [
        // Front face
        [0.5,          0.5], // v1
        [0.75,         0.5], // v0
        [0.75 -0.25/8, 1.0], // v3
        [0.5  +0.25/8, 1.0], // v2

        // Back face
        [0.5 ,         0.5], // v5
        [0.25,         0.5], // v4
        [0.25 +0.25/8, 1.0], // v7
        [0.5  -0.25/8, 1.0], // v6

        // Top face
        [0.75, 0.5], // v2
        [0.5,  0.5], // v3
        [0.5,  0.0], // v7
        [0.75, 0.0], // v6

        // Bottom face
        [0.0,  0.5], // v0
        [0.25, 0.5], // v1
        [0.25, 1.0], // v5
        [0.0,  1.0], // v4

        // Right face
        [0.0,  0.5], // v1
        [0.0,  0.0], // v2
        [0.25, 0.0], // v6
        [0.25, 0.5], // v5

        // Left face
        [0.5,  0.5], // v0
        [0.5,  0.0], // v3
        [0.25, 0.0], // v7
        [0.25, 0.5], // v4

        // Front2 face
        [0.75,  0.0], // v3
        [1.0,   0.0], // v2
        [1.0,   0.5], // v8
        // Back2 face
        [0.75,  0.0], // v7
        [1.0,   0.0], // v6
        [1.0,   0.5], // v9
        // Right2 Face
        [0.75,  0.0], // v2
        [1.0,   0.0], // v6
        [1.0,   0.5], // v9
        [0.75,  0.5], // v8
        // Left2 Face
        [0.75,  0.0], // v3
        [1.0,   0.0], // v7
        [1.0,   0.5], // v9
        [0.75,  0.5]  // v8
    ];

    let indices = [
         0,  1,  2,    0,  2 , 3,  // Front face
         4,  5,  6,    4,  6 , 7,  // Back face
         8,  9, 10,    8, 10, 11,  // Top face
        12, 13, 14,   12, 14, 15,  // Bottom face
        16, 17, 18,   16, 18, 19,  // Right face
        20, 21, 22,   20, 22, 23,  // Left face
        24, 25, 26,                // Front2 face
        27, 28, 29,                // Back2 face
        30, 33, 31,   33, 32, 31,  // Right2 face
        34, 35, 36,   34, 36, 37   // Left2 face
    ];

    // Shared visual mesh data (one geometry/material reused by every piece)
    let geometry = glBoostContext.createGeometry();
    let texture = glBoostContext.createTexture('../../../../assets/textures/shogi_001/shogi.png');
    let material = glBoostContext.createClassicMaterial();
    material.setTexture(texture);
    material.shaderClass = GLBoost.HalfLambertShader;
    geometry.setVerticesData({
        position: positions,
        texcoord: texcoords
    }, [indices], GLBoost.TRIANGLE);

    // Shared physics shape + mass properties
    let psRes = HK.HP_Shape_CreateBox([0, 0, 0], IDENTITY_QUATERNION, colliderSize);
    checkResult(psRes[0], 'HP_Shape_CreateBox shogi');
    let pieceShapeId = psRes[1];
    let pmRes = HK.HP_Shape_BuildMassProperties(pieceShapeId);
    checkResult(pmRes[0], 'HP_Shape_BuildMassProperties shogi');
    let pieceMassProps = pmRes[1];

    // Shared collider wireframe (one geometry/material reused by every piece),
    // matching the Havok piece box [w, h*1.2, d*1.4].
    let pieceWireGeo = createWireframeBoxGeometry(colliderSize[0], colliderSize[1], colliderSize[2], DEBUG_COLOR_DYNAMIC);
    let pieceWireMaterial = glBoostContext.createClassicMaterial();

    for (let i = 0; i < PIECE_COUNT; i++) {
        let x = (Math.random() - 0.5) * 15;
        let y = (Math.random() + 1.0) * 15;
        let z = (Math.random() - 0.5) * 15;
        let q = randomQuaternion();

        let bRes = HK.HP_Body_Create();
        checkResult(bRes[0], 'HP_Body_Create shogi');
        let bodyId = bRes[1];
        HK.HP_Body_SetShape(bodyId, pieceShapeId);
        HK.HP_Body_SetMotionType(bodyId, HK.MotionType.DYNAMIC);
        HK.HP_Body_SetMassProperties(bodyId, pieceMassProps);
        HK.HP_Body_SetPosition(bodyId, [x, y, z]);
        HK.HP_Body_SetOrientation(bodyId, q);
        HK.HP_World_AddBody(worldId, bodyId, false);
        bodyIds.push(bodyId);

        let mesh = glBoostContext.createMesh(geometry, material);
        meshs[i] = mesh;
        mesh.translate = new GLBoost.Vector3(x, y, z);
        mesh.quaternion = new GLBoost.Quaternion(q[0], q[1], q[2], q[3]);
        scene.addChild(mesh);

        // Per-piece collider wireframe (shares geometry/material with the others)
        let debugMesh = glBoostContext.createMesh(pieceWireGeo, pieceWireMaterial);
        debugMesh.translate = new GLBoost.Vector3(x, y, z);
        debugMesh.quaternion = new GLBoost.Quaternion(q[0], q[1], q[2], q[3]);
        scene.addChild(debugMesh);
        debugMeshs.push(debugMesh);
        pieceDebugMeshs[i] = debugMesh;
    }

    setWireframeVisible(showWireframe);
}

function createStaticBox(size, pos) {
    let sRes = HK.HP_Shape_CreateBox([0, 0, 0], IDENTITY_QUATERNION, size);
    checkResult(sRes[0], 'HP_Shape_CreateBox static');
    let bRes = HK.HP_Body_Create();
    checkResult(bRes[0], 'HP_Body_Create static');
    let bodyId = bRes[1];
    HK.HP_Body_SetShape(bodyId, sRes[1]);
    HK.HP_Body_SetMotionType(bodyId, HK.MotionType.STATIC);
    HK.HP_Body_SetPosition(bodyId, pos);
    HK.HP_Body_SetOrientation(bodyId, IDENTITY_QUATERNION);
    HK.HP_World_AddBody(worldId, bodyId, false);
}

// A (roughly uniform) random unit quaternion as [x, y, z, w].
function randomQuaternion() {
    let x = Math.random() - 0.5;
    let y = Math.random() - 0.5;
    let z = Math.random() - 0.5;
    let w = Math.random() - 0.5;
    let len = Math.sqrt(x*x + y*y + z*z + w*w) || 1;
    return [x/len, y/len, z/len, w/len];
}

// Build a box-edge wireframe geometry (full size w x h x d, centred on the origin)
// as GL LINES, with a per-vertex colour so it draws as a solid coloured outline.
function createWireframeBoxGeometry(w, h, d, color) {
    let x = w / 2, y = h / 2, z = d / 2;
    let c = [
        new GLBoost.Vector3(-x, -y, -z), // 0
        new GLBoost.Vector3( x, -y, -z), // 1
        new GLBoost.Vector3( x,  y, -z), // 2
        new GLBoost.Vector3(-x,  y, -z), // 3
        new GLBoost.Vector3(-x, -y,  z), // 4
        new GLBoost.Vector3( x, -y,  z), // 5
        new GLBoost.Vector3( x,  y,  z), // 6
        new GLBoost.Vector3(-x,  y,  z)  // 7
    ];
    let edges = [
        [0, 1], [1, 5], [5, 4], [4, 0], // bottom face
        [3, 2], [2, 6], [6, 7], [7, 3], // top face
        [0, 3], [1, 2], [5, 6], [4, 7]  // verticals
    ];
    let positions = [];
    let colors = [];
    for (let e = 0; e < edges.length; e++) {
        positions.push(c[edges[e][0]]);
        positions.push(c[edges[e][1]]);
        colors.push(color);
        colors.push(color);
    }
    let geometry = glBoostContext.createGeometry();
    geometry.setVerticesData({
        position: positions,
        color: colors
    }, null, GLBoost.LINES);
    return geometry;
}

function setWireframeVisible(visible) {
    showWireframe = visible;
    for (let i = 0; i < debugMeshs.length; i++) {
        debugMeshs[i].isVisible = visible;
    }
    let hint = document.getElementById('hint');
    if (hint) {
        hint.textContent = 'W: wireframe ' + (visible ? 'ON' : 'OFF');
    }
}

window.addEventListener('keydown', function(event) {
    if (event.repeat) return;
    if (event.code === 'KeyW' || event.key === 'w' || event.key === 'W') {
        setWireframeVisible(!showWireframe);
    }
});

// MAIN LOOP

function loop() {
    HK.HP_World_Step(worldId, FIXED_TIMESTEP);

    for (let i = 0; i < bodyIds.length; i++) {
        let posRes = HK.HP_Body_GetPosition(bodyIds[i]);
        let oriRes = HK.HP_Body_GetOrientation(bodyIds[i]);
        let pos = posRes[1];
        let ori = oriRes[1];

        let mesh = meshs[i];
        mesh.translate = new GLBoost.Vector3(pos[0], pos[1], pos[2]);
        mesh.quaternion = new GLBoost.Quaternion(ori[0], ori[1], ori[2], ori[3]);

        let debugMesh = pieceDebugMeshs[i];
        if (debugMesh) {
            debugMesh.translate = new GLBoost.Vector3(pos[0], pos[1], pos[2]);
            debugMesh.quaternion = new GLBoost.Quaternion(ori[0], ori[1], ori[2], ori[3]);
        }

        if (pos[1] < -15) {
            let x = (Math.random() - 0.5) * 15;
            let y = (Math.random() + 1.0) * 15;
            let z = (Math.random() - 0.5) * 15;
            let q = randomQuaternion();
            HK.HP_Body_SetPosition(bodyIds[i], [x, y, z]);
            HK.HP_Body_SetOrientation(bodyIds[i], q);
            HK.HP_Body_SetLinearVelocity(bodyIds[i], [0, 0, 0]);
            HK.HP_Body_SetAngularVelocity(bodyIds[i], [0, 0, 0]);
        }
    }

    renderer.clearCanvas();
    renderer.draw(expression);

    requestAnimationFrame(loop);
}
