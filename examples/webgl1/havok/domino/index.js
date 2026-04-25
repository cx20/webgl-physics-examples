const HAVOK_WASM_URL = 'https://cx20.github.io/gltf-test/libs/babylonjs/dev/HavokPhysics.wasm';
// forked from gaziya's "Domino  (WebGL2 + Oimo.js)" http://jsdo.it/gaziya/46vq

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

function getRgbColor(c) {
    const colorHash = {
        "無": [0xDC / 0xFF, 0xAA / 0xFF, 0x6B / 0xFF],
        "白": [0xFF / 0xFF, 0xFF / 0xFF, 0xFF / 0xFF],
        "肌": [0xFF / 0xFF, 0xCC / 0xFF, 0xCC / 0xFF],
        "茶": [0x80 / 0xFF, 0x00 / 0xFF, 0x00 / 0xFF],
        "赤": [0xFF / 0xFF, 0x00 / 0xFF, 0x00 / 0xFF],
        "黄": [0xFF / 0xFF, 0xFF / 0xFF, 0x00 / 0xFF],
        "緑": [0x00 / 0xFF, 0xFF / 0xFF, 0x00 / 0xFF],
        "水": [0x00 / 0xFF, 0xFF / 0xFF, 0xFF / 0xFF],
        "青": [0x00 / 0xFF, 0x00 / 0xFF, 0xFF / 0xFF],
        "紫": [0x80 / 0xFF, 0x00 / 0xFF, 0x80 / 0xFF]
    };
    return colorHash[c];
}

const canvas = document.getElementById('c');
const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');

if (!gl) {
    throw new Error('WebGL 1.0 is not supported.');
}

const IDENTITY_QUATERNION = [0, 0, 0, 1];
const DOMINO_COUNT = 256;
const DOMINO_W = 2;
const DOMINO_H = 4;
const DOMINO_D = 0.6;
const GROUND_HALF_HEIGHT = 0.2;
const GROUND_Y = -GROUND_HALF_HEIGHT;
const DOMINO_START_CLEARANCE = 0.05;

let HK;
let worldId;
const dominoBodyIds = [];
const dominoColors = [];

let program;
let attribPosition;
let attribNormal;
let uniformProjection;
let uniformModelView;
let uniformColor;

let vertexBuffer;
let normalBuffer;
let indexBuffer;
let indexCount = 0;

const projectionMatrix = mat4.create();
const viewMatrix = mat4.create();
const modelMatrix = mat4.create();
const modelViewMatrix = mat4.create();

function enumToNumber(value) {
    if (typeof value === 'number') {
        return value;
    }
    if (typeof value === 'bigint') {
        return Number(value);
    }
    if (typeof value === 'string') {
        const parsed = Number(value.trim());
        return Number.isNaN(parsed) ? NaN : parsed;
    }
    if (!value || typeof value !== 'object') {
        return NaN;
    }

    if (typeof value.value === 'number' || typeof value.value === 'bigint') {
        return Number(value.value);
    }
    if (typeof value.m_value === 'number' || typeof value.m_value === 'bigint') {
        return Number(value.m_value);
    }
    if (typeof value.value === 'function') {
        const v = value.value();
        const n = enumToNumber(v);
        if (!Number.isNaN(n)) {
            return n;
        }
    }
    if (typeof value.valueOf === 'function') {
        const v = value.valueOf();
        if (v !== value) {
            const n = enumToNumber(v);
            if (!Number.isNaN(n)) {
                return n;
            }
        }
    }

    return NaN;
}

function checkResult(result, label) {
    if (result === HK.Result.RESULT_OK) {
        return;
    }

    const resultCode = enumToNumber(result);
    const okCode = enumToNumber(HK.Result.RESULT_OK);

    if (!Number.isNaN(resultCode) && !Number.isNaN(okCode) && resultCode === okCode) {
        return;
    }

    if (typeof result === 'object' && typeof HK.Result.RESULT_OK === 'object') {
        try {
            if (JSON.stringify(result) === JSON.stringify(HK.Result.RESULT_OK)) {
                return;
            }
        } catch (_e) {
            // Ignore stringify failures and throw below.
        }
    }

    throw new Error(label + ' failed with code: ' + String(result));
}

function createShader(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(shader));
    }
    return shader;
}

function createProgram(vsSource, fsSource) {
    const vertexShader = createShader(gl.VERTEX_SHADER, vsSource);
    const fragmentShader = createShader(gl.FRAGMENT_SHADER, fsSource);
    const shaderProgram = gl.createProgram();
    gl.attachShader(shaderProgram, vertexShader);
    gl.attachShader(shaderProgram, fragmentShader);
    gl.linkProgram(shaderProgram);

    if (!gl.getProgramParameter(shaderProgram, gl.LINK_STATUS)) {
        throw new Error(gl.getProgramInfoLog(shaderProgram));
    }
    return shaderProgram;
}

function createBoxGeometry() {
    const positions = new Float32Array([
        // front
        -0.5, -0.5,  0.5,   0.5, -0.5,  0.5,   0.5,  0.5,  0.5,  -0.5,  0.5,  0.5,
        // back
         0.5, -0.5, -0.5,  -0.5, -0.5, -0.5,  -0.5,  0.5, -0.5,   0.5,  0.5, -0.5,
        // left
        -0.5, -0.5, -0.5,  -0.5, -0.5,  0.5,  -0.5,  0.5,  0.5,  -0.5,  0.5, -0.5,
        // right
         0.5, -0.5,  0.5,   0.5, -0.5, -0.5,   0.5,  0.5, -0.5,   0.5,  0.5,  0.5,
        // top
        -0.5,  0.5,  0.5,   0.5,  0.5,  0.5,   0.5,  0.5, -0.5,  -0.5,  0.5, -0.5,
        // bottom
        -0.5, -0.5, -0.5,   0.5, -0.5, -0.5,   0.5, -0.5,  0.5,  -0.5, -0.5,  0.5
    ]);

    const normals = new Float32Array([
        // front
         0,  0,  1,   0,  0,  1,   0,  0,  1,   0,  0,  1,
        // back
         0,  0, -1,   0,  0, -1,   0,  0, -1,   0,  0, -1,
        // left
        -1,  0,  0,  -1,  0,  0,  -1,  0,  0,  -1,  0,  0,
        // right
         1,  0,  0,   1,  0,  0,   1,  0,  0,   1,  0,  0,
        // top
         0,  1,  0,   0,  1,  0,   0,  1,  0,   0,  1,  0,
        // bottom
         0, -1,  0,   0, -1,  0,   0, -1,  0,   0, -1,  0
    ]);

    const indices = new Uint16Array([
         0,  1,  2,   0,  2,  3,
         4,  5,  6,   4,  6,  7,
         8,  9, 10,   8, 10, 11,
        12, 13, 14,  12, 14, 15,
        16, 17, 18,  16, 18, 19,
        20, 21, 22,  20, 22, 23
    ]);

    vertexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

    normalBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, normals, gl.STATIC_DRAW);

    indexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

    indexCount = indices.length;
}

function resize() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';
    gl.viewport(0, 0, canvas.width, canvas.height);
}

function createBody(shapeId, motionType, position, rotation, setMass) {
    const created = HK.HP_Body_Create();
    checkResult(created[0], 'HP_Body_Create');
    const bodyId = created[1];

    checkResult(HK.HP_Body_SetShape(bodyId, shapeId), 'HP_Body_SetShape');
    checkResult(HK.HP_Body_SetMotionType(bodyId, motionType), 'HP_Body_SetMotionType');

    if (setMass) {
        const massResult = HK.HP_Shape_BuildMassProperties(shapeId);
        checkResult(massResult[0], 'HP_Shape_BuildMassProperties');
        checkResult(HK.HP_Body_SetMassProperties(bodyId, massResult[1]), 'HP_Body_SetMassProperties');
    }

    checkResult(HK.HP_Body_SetPosition(bodyId, position), 'HP_Body_SetPosition');
    checkResult(HK.HP_Body_SetOrientation(bodyId, rotation), 'HP_Body_SetOrientation');
    checkResult(HK.HP_World_AddBody(worldId, bodyId, false), 'HP_World_AddBody');

    return bodyId;
}

function initPhysics() {
    const world = HK.HP_World_Create();
    checkResult(world[0], 'HP_World_Create');
    worldId = world[1];

    checkResult(HK.HP_World_SetGravity(worldId, [0, -9.8, 0]), 'HP_World_SetGravity');
    checkResult(HK.HP_World_SetIdealStepTime(worldId, 1 / 60), 'HP_World_SetIdealStepTime');

    // Ground
    const groundShapeResult = HK.HP_Shape_CreateBox([0, 0, 0], IDENTITY_QUATERNION, [100, GROUND_HALF_HEIGHT, 100]);
    checkResult(groundShapeResult[0], 'HP_Shape_CreateBox (ground)');
    createBody(groundShapeResult[1], HK.MotionType.STATIC, [0, GROUND_Y, 0], IDENTITY_QUATERNION, false);

    // Domino shape (shared across all domino bodies)
    const dominoShapeResult = HK.HP_Shape_CreateBox([0, 0, 0], IDENTITY_QUATERNION, [DOMINO_W, DOMINO_H, DOMINO_D]);
    checkResult(dominoShapeResult[0], 'HP_Shape_CreateBox (domino)');
    const dominoShapeId = dominoShapeResult[1];
    checkResult(HK.HP_Shape_SetDensity(dominoShapeId, 1), 'HP_Shape_SetDensity');

    // Trigger rotation: -15 degrees around X axis (tips the domino toward -Z)
    const tiltAngle = -15 * Math.PI / 180;
    const tiltHalf = tiltAngle / 2;
    const triggerRotation = [Math.sin(tiltHalf), 0, 0, Math.cos(tiltHalf)];

    for (let i = 0; i < DOMINO_COUNT; i++) {
        const x = (Math.floor(i / 16) - 8) * 3;
        const y = GROUND_Y + GROUND_HALF_HEIGHT + DOMINO_H + DOMINO_START_CLEARANCE;
        const z = (8 - (i % 16)) * 3;

        // First piece in each column (i % 16 === 0) is tilted to trigger the chain
        const rotation = (i % 16 === 0) ? triggerRotation : IDENTITY_QUATERNION;

        const bodyId = createBody(dominoShapeId, HK.MotionType.DYNAMIC, [x, y, z], rotation, true);
        dominoBodyIds.push(bodyId);
        dominoColors.push(getRgbColor(dataSet[i]));
    }
}

function drawBox(position, rotation, scale, color) {
    mat4.fromRotationTranslationScale(modelMatrix, rotation, position, scale);
    mat4.multiply(modelViewMatrix, viewMatrix, modelMatrix);

    gl.uniformMatrix4fv(uniformProjection, false, projectionMatrix);
    gl.uniformMatrix4fv(uniformModelView, false, modelViewMatrix);
    gl.uniform3fv(uniformColor, color);

    gl.drawElements(gl.TRIANGLES, indexCount, gl.UNSIGNED_SHORT, 0);
}

function render(timeMs) {
    checkResult(HK.HP_World_Step(worldId, 1 / 60), 'HP_World_Step');

    const t = timeMs * 0.001;
    const eye = [Math.sin(t * 0.1) * 80, 50, Math.cos(t * 0.1) * 80];

    mat4.perspective(projectionMatrix, Math.PI / 4, canvas.width / canvas.height, 0.1, 300.0);
    mat4.lookAt(viewMatrix, eye, [0, 0, 0], [0, 1, 0]);

    gl.clearColor(0.05, 0.05, 0.1, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.useProgram(program);

    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.enableVertexAttribArray(attribPosition);
    gl.vertexAttribPointer(attribPosition, 3, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
    gl.enableVertexAttribArray(attribNormal);
    gl.vertexAttribPointer(attribNormal, 3, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);

    // Draw ground
    drawBox([0, GROUND_Y, 0], IDENTITY_QUATERNION, [100, GROUND_HALF_HEIGHT, 100], [0.5, 0.45, 0.4]);

    // Draw dominos
    for (let i = 0; i < DOMINO_COUNT; i++) {
        const posResult = HK.HP_Body_GetPosition(dominoBodyIds[i]);
        checkResult(posResult[0], 'HP_Body_GetPosition');
        const rotResult = HK.HP_Body_GetOrientation(dominoBodyIds[i]);
        checkResult(rotResult[0], 'HP_Body_GetOrientation');
        drawBox(posResult[1], rotResult[1], [DOMINO_W, DOMINO_H, DOMINO_D], dominoColors[i]);
    }

    requestAnimationFrame(render);
}

async function init() {
    HK = await HavokPhysics({
        locateFile: function (path) {
            if (path && path.endsWith('.wasm')) {
                return HAVOK_WASM_URL;
            }
            return path;
        }
    });

    resize();
    window.addEventListener('resize', resize);

    gl.enable(gl.DEPTH_TEST);

    program = createProgram(
        document.getElementById('vs').textContent,
        document.getElementById('fs').textContent
    );

    attribPosition = gl.getAttribLocation(program, 'position');
    attribNormal = gl.getAttribLocation(program, 'normal');
    uniformProjection = gl.getUniformLocation(program, 'pjMatrix');
    uniformModelView = gl.getUniformLocation(program, 'mvMatrix');
    uniformColor = gl.getUniformLocation(program, 'uColor');

    createBoxGeometry();
    initPhysics();

    requestAnimationFrame(render);
}

init().catch((err) => {
    console.error(err);
});
