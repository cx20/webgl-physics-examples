let c = document.getElementById("c");
let gl = c.getContext("webgl2");
gl.clearColor(0.0, 0.0, 0.0, 1.0);
gl.enable(gl.DEPTH_TEST);
gl.depthFunc(gl.LEQUAL);

resizeCanvas();
window.addEventListener("resize", function(){
    resizeCanvas();
});

function resizeCanvas() {
    c.width = window.innerWidth;
    c.height = window.innerHeight;
    gl.viewport(0, 0, c.width, c.height);
}

let p1 = gl.createProgram();
let type = [gl.VERTEX_SHADER, gl.FRAGMENT_SHADER];
let src = [vs.text.trim(), fs.text.trim()];
for (let i = 0; i < 2; i++) {
    let shader = gl.createShader(type[i]);
    gl.shaderSource(shader, src[i]);
    gl.compileShader(shader);
    console.log(gl.getShaderInfoLog(shader));
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {alert(gl.getShaderInfoLog(shader));}
    gl.attachShader(p1, shader);
    gl.deleteShader(shader);
}
gl.linkProgram(p1);
gl.useProgram(p1);
let perspective = function (fovy, aspect, near, far) {
    let top = near * Math.tan(fovy * Math.PI / 360.0);
    let right = top * aspect;
    let u = right * 2;
    let v = top * 2;
    let w = far - near;
    return new Float32Array([
        near * 2 / u, 0, 0, 0,
        0, near * 2 / v, 0, 0,
        0, 0, -(far + near) / w, -1,
        0, 0, -(far * near * 2) / w, 0
    ]);
};
let perspMatrix = perspective(45, c.width / c.height, 0.1, 1000.0);
gl.uniformMatrix4fv(
    gl.getUniformLocation(p1, "pMatrix"),
    false,
    perspMatrix
);

let DOT_SIZE = 2;
let w = DOT_SIZE * 0.8 * 1.0;
let h = DOT_SIZE * 0.8 * 1.0;
let d = DOT_SIZE * 0.8 * 0.2;
const SHOGI_PHYSICS_SIZE = [w, h * 1.2, d * 1.4];

let position = new Float32Array([
    // Front face
    -0.5 * w,  -0.5 * h,  0.7 * d, // v0
     0.5 * w,  -0.5 * h,  0.7 * d, // v1
     0.35 * w,  0.5 * h,  0.4 * d, // v2
    -0.35 * w,  0.5 * h,  0.4 * d, // v3
    // Back face
    -0.5 * w,  -0.5 * h, -0.7 * d, // v4
     0.5 * w,  -0.5 * h, -0.7 * d, // v5
     0.35 * w,  0.5 * h, -0.4 * d, // v6
    -0.35 * w,  0.5 * h, -0.4 * d, // v7
    // Top face
     0.35 * w,  0.5 * h,  0.4 * d, // v2
    -0.35 * w,  0.5 * h,  0.4 * d, // v3
    -0.35 * w,  0.5 * h, -0.4 * d, // v7
     0.35 * w,  0.5 * h, -0.4 * d, // v6
    // Bottom face
    -0.5 * w,  -0.5 * h,  0.7 * d, // v0
     0.5 * w,  -0.5 * h,  0.7 * d, // v1
     0.5 * w,  -0.5 * h, -0.7 * d, // v5
    -0.5 * w,  -0.5 * h, -0.7 * d, // v4
    // Right face
     0.5 * w,  -0.5 * h,  0.7 * d, // v1
     0.35 * w,  0.5 * h,  0.4 * d, // v2
     0.35 * w,  0.5 * h, -0.4 * d, // v6
     0.5 * w,  -0.5 * h, -0.7 * d, // v5
    // Left face
    -0.5 * w,  -0.5 * h,  0.7 * d, // v0
    -0.35 * w,  0.5 * h,  0.4 * d, // v3
    -0.35 * w,  0.5 * h, -0.4 * d, // v7
    -0.5 * w,  -0.5 * h, -0.7 * d, // v4
    // Front2 face
    -0.35 * w,  0.5 * h,  0.4 * d,  // v3
     0.35 * w,  0.5 * h,  0.4 * d,  // v2
     0.0 * w,   0.6 * h,  0.35 * d, // v8
    // Back2 face
    -0.35 * w,  0.5 * h, -0.4 * d,  // v7
     0.35 * w,  0.5 * h, -0.4 * d,  // v6
     0.0 * w,   0.6 * h, -0.35 * d, // v9
    // Right2 Face
     0.35 * w,  0.5 * h,  0.4 * d,  // v2
     0.35 * w,  0.5 * h, -0.4 * d,  // v6
     0.0 * w,   0.6 * h, -0.35 * d, // v9
     0.0 * w,   0.6 * h,  0.35 * d, // v8
    // Left2 Face
    -0.35 * w,  0.5 * h,  0.4 * d,  // v3
    -0.35 * w,  0.5 * h, -0.4 * d,  // v7
     0.0 * w,   0.6 * h, -0.35 * d, // v9
     0.0 * w,   0.6 * h,  0.35 * d  // v8
]);

let normal = new Float32Array([
    // Front face (outward: +Z tilt)
     0,  0.0599,  0.9982,   0,  0.0599,  0.9982,   0,  0.0599,  0.9982,   0,  0.0599,  0.9982,
    // Back face (outward: -Z tilt)
     0, -0.0599, -0.9982,   0, -0.0599, -0.9982,   0, -0.0599, -0.9982,   0, -0.0599, -0.9982,
    // Top face (outward: +Y)
     0,  1,  0,   0,  1,  0,   0,  1,  0,   0,  1,  0,
    // Bottom face (outward: -Y)
     0, -1,  0,   0, -1,  0,   0, -1,  0,   0, -1,  0,
    // Right face (outward: +X tilt)
     0.9889,  0.1483,  0,   0.9889,  0.1483,  0,   0.9889,  0.1483,  0,   0.9889,  0.1483,  0,
    // Left face (outward: -X tilt)
    -0.9889,  0.1483,  0,  -0.9889,  0.1483,  0,  -0.9889,  0.1483,  0,  -0.9889,  0.1483,  0,
    // Front2 face
     0,  0.0995,  0.995,   0,  0.0995,  0.995,   0,  0.0995,  0.995,
    // Back2 face
     0, -0.0995, -0.995,   0, -0.0995, -0.995,   0, -0.0995, -0.995,
    // Right2 face
     0.2747,  0.9615,  0,   0.2747,  0.9615,  0,   0.2747,  0.9615,  0,   0.2747,  0.9615,  0,
    // Left2 face
    -0.2747,  0.9615,  0,  -0.2747,  0.9615,  0,  -0.2747,  0.9615,  0,  -0.2747,  0.9615,  0
]);

let textureCoords = new Float32Array([
    // Front face
    0.5,          0.5, // v0
    0.75,         0.5, // v1
    0.75 -0.25/8, 1.0, // v2
    0.5  +0.25/8, 1.0, // v3

    // Back face
    0.5 ,         0.5, // v5
    0.25,         0.5, // v4
    0.25 +0.25/8, 1.0, // v7
    0.5  -0.25/8, 1.0, // v6
    
    // Top face
    0.75, 0.5, // v2
    0.5,  0.5, // v3
    0.5,  0.0, // v7
    0.75, 0.0, // v6
    
    // Bottom face
    0.0,  0.5, // v0
    0.25, 0.5, // v1
    0.25, 1.0, // v5
    0.0,  1.0, // v4
    
    // Right face
    0.0,  0.5, // v1
    0.0,  0.0, // v2
    0.25, 0.0, // v6
    0.25, 0.5, // v5
    
    // Left face
    0.5,  0.5, // v0
    0.5,  0.0, // v3
    0.25, 0.0, // v7
    0.25, 0.5, // v4
    
    // Front2 face
    0.75,  0.0, // v3
    1.0,   0.0, // v2
    1.0,   0.5, // v8
    // Back2 face
    0.75,  0.0, // v7
    1.0,   0.0, // v6
    1.0,   0.5, // v9
    // Right2 Face
    0.75,  0.0, // v2
    1.0,   0.0, // v6
    1.0,   0.5, // v9
    0.75,  0.5, // v8
    // Left2 Face
    0.75,  0.0, // v3
    1.0,   0.0, // v7
    1.0,   0.5, // v9
    0.75,  0.5  // v8
]);

let indeces = new Int16Array([
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
]);
let shogiIdxBuf = gl.createBuffer();
gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, shogiIdxBuf);
gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indeces, gl.STATIC_DRAW);
let indexCount = indeces.length;

let strides = [3, 3, 2];
let vertices = [position, normal, textureCoords];
let shogiVBOs = [];
for (let i = 0; i < strides.length; i++) {
    let buf = gl.createBuffer();
    shogiVBOs[i] = buf;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, vertices[i], gl.STATIC_DRAW);
    gl.vertexAttribPointer(i, strides[i], gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(i);
}

let max = 300;
let posStride = 3;
let rotStride = 4;
let posBuffer = gl.createBuffer();
let rotBuffer = gl.createBuffer();
let posArray = new Float32Array(max * posStride);
let rotArray = new Float32Array(max * rotStride);

let idx = strides.length;
gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
gl.bufferData(gl.ARRAY_BUFFER, posArray, gl.STATIC_DRAW);
gl.enableVertexAttribArray(idx);
gl.vertexAttribPointer(idx, posStride, gl.FLOAT, false, 0, 0);
gl.vertexAttribDivisor(idx, 1);

idx++;
gl.bindBuffer(gl.ARRAY_BUFFER, rotBuffer);
gl.bufferData(gl.ARRAY_BUFFER, rotArray, gl.STATIC_DRAW);
gl.enableVertexAttribArray(idx);
gl.vertexAttribPointer(idx, rotStride, gl.FLOAT, false, 0, 0);
gl.vertexAttribDivisor(idx, 1);

let img = new Image();
let texture;
img.onload = function(){
    texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.generateMipmap(gl.TEXTURE_2D);
};
img.src = "../../../../assets/textures/shogi_001/shogi.png";

// Ground program
let p2 = gl.createProgram();
for (let i = 0; i < 2; i++) {
    let shader = gl.createShader([gl.VERTEX_SHADER, gl.FRAGMENT_SHADER][i]);
    gl.shaderSource(shader, [gvs.text.trim(), gfs.text.trim()][i]);
    gl.compileShader(shader);
    gl.attachShader(p2, shader);
    gl.deleteShader(shader);
}
gl.linkProgram(p2);
let mvpLoc = gl.getUniformLocation(p2, "mvpMatrix");

// View matrix (same camera as vertex shader)
let vMatrix = mat4.create();
mat4.lookAt(vMatrix, [0, 0, 40], [0, 0, 0], [0, 1, 0]);

// Ground box (matches physics body size [13, 0.1, 13] centered at y=-10)
const GW = 6.5, GH = 0.05, GD = 6.5;
let groundBox = new Float32Array([
    // Top
    -GW,  GH, -GD,  GW,  GH, -GD,  GW,  GH,  GD, -GW,  GH,  GD,
    // Bottom
    -GW, -GH, -GD,  GW, -GH, -GD,  GW, -GH,  GD, -GW, -GH,  GD,
    // Front (+Z)
    -GW, -GH,  GD,  GW, -GH,  GD,  GW,  GH,  GD, -GW,  GH,  GD,
    // Back (-Z)
    -GW, -GH, -GD,  GW, -GH, -GD,  GW,  GH, -GD, -GW,  GH, -GD,
    // Right (+X)
     GW, -GH, -GD,  GW, -GH,  GD,  GW,  GH,  GD,  GW,  GH, -GD,
    // Left (-X)
    -GW, -GH, -GD, -GW, -GH,  GD, -GW,  GH,  GD, -GW,  GH, -GD
]);
let groundBoxIdx = new Uint16Array([
     0, 1, 2,  0, 2, 3,
     4, 7, 6,  4, 6, 5,
     8, 9,10,  8,10,11,
    12,15,14, 12,14,13,
    16,17,18, 16,18,19,
    20,23,22, 20,22,21
]);
let groundVBO = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, groundVBO);
gl.bufferData(gl.ARRAY_BUFFER, groundBox, gl.STATIC_DRAW);
let groundIBO = gl.createBuffer();
gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, groundIBO);
gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, groundBoxIdx, gl.STATIC_DRAW);
let groundIdxCount = groundBoxIdx.length;
gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, shogiIdxBuf);

// physics
const IDENTITY_QUATERNION = [0, 0, 0, 1];
let HK;
let worldId;
let groundBodyId;

let genPosition = function () {
    return {
        x: (Math.random() - 0.5) * 15,
        y: (Math.random() + 1.0) * 15,
        z: (Math.random() - 0.5) * 15
    };
};

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
        }
    }

    throw new Error(label + ' failed with code: ' + String(result));
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
    checkResult(HK.HP_World_SetIdealStepTime(worldId, 1 / 200), 'HP_World_SetIdealStepTime');

    const groundShapeResult = HK.HP_Shape_CreateBox([0, 0, 0], IDENTITY_QUATERNION, [13, 0.1, 13]);
    checkResult(groundShapeResult[0], 'HP_Shape_CreateBox (ground)');
    const groundShapeId = groundShapeResult[1];
    groundBodyId = createBody(groundShapeId, HK.MotionType.STATIC, [0, -10, 0], IDENTITY_QUATERNION, false);

    const shogiShapeResult = HK.HP_Shape_CreateBox([0, 0, 0], IDENTITY_QUATERNION, SHOGI_PHYSICS_SIZE);
    checkResult(shogiShapeResult[0], 'HP_Shape_CreateBox (shogi)');
    const shogiShapeId = shogiShapeResult[1];
    checkResult(HK.HP_Shape_SetDensity(shogiShapeId, 1), 'HP_Shape_SetDensity');

    let bodys = [];
    for (let i = 0; i < max; i++) {
        let p = genPosition();
        bodys[i] = createBody(shogiShapeId, HK.MotionType.DYNAMIC, [p.x, p.y, p.z], IDENTITY_QUATERNION, true);
    }
    return bodys;
}

let bodys = [];

let data2buf = function () {
    let pIdx = 0;
    let qIdx = 0;
    for (let i = 0; i < max; i++) {
        const pResult = HK.HP_Body_GetPosition(bodys[i]);
        checkResult(pResult[0], 'HP_Body_GetPosition');
        const p = pResult[1];
        posArray[pIdx++] = p[0];
        posArray[pIdx++] = p[1];
        posArray[pIdx++] = p[2];

        const qResult = HK.HP_Body_GetOrientation(bodys[i]);
        checkResult(qResult[0], 'HP_Body_GetOrientation');
        const q = qResult[1];
        rotArray[qIdx++] = q[0];
        rotArray[qIdx++] = q[1];
        rotArray[qIdx++] = q[2];
        rotArray[qIdx++] = q[3];
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, posArray, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, rotBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, rotArray, gl.STATIC_DRAW);
};
function startPhysicsLoop() {
    setInterval(function () {
        checkResult(HK.HP_World_Step(worldId, 1 / 200), 'HP_World_Step');
        for (let i = 0; i < max; i++) {
            const posResult = HK.HP_Body_GetPosition(bodys[i]);
            checkResult(posResult[0], 'HP_Body_GetPosition');
            let pos = posResult[1];
            if (pos[1] < -15) {
                let p = genPosition();
                checkResult(HK.HP_Body_SetPosition(bodys[i], [p.x, p.y, p.z]), 'HP_Body_SetPosition reset');
                checkResult(HK.HP_Body_SetOrientation(bodys[i], IDENTITY_QUATERNION), 'HP_Body_SetOrientation reset');
                checkResult(HK.HP_Body_SetLinearVelocity(bodys[i], [0, 0, 0]), 'HP_Body_SetLinearVelocity reset');
                checkResult(HK.HP_Body_SetAngularVelocity(bodys[i], [0, 0, 0]), 'HP_Body_SetAngularVelocity reset');
            }
        }
        data2buf();
    }, 1000 / 200);
}

function render() {
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // Draw ground
    gl.useProgram(p2);
    const groundPosResult = HK.HP_Body_GetPosition(groundBodyId);
    checkResult(groundPosResult[0], 'HP_Body_GetPosition ground');
    let groundPos = groundPosResult[1];
    let mMat = mat4.create();
    mat4.translate(mMat, mMat, [groundPos[0], groundPos[1], groundPos[2]]);
    let mvpMat = mat4.create();
    mat4.multiply(mvpMat, vMatrix, mMat);
    mat4.multiply(mvpMat, perspMatrix, mvpMat);
    gl.uniformMatrix4fv(mvpLoc, false, mvpMat);
    gl.bindBuffer(gl.ARRAY_BUFFER, groundVBO);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, groundIBO);
    gl.drawElements(gl.TRIANGLES, groundIdxCount, gl.UNSIGNED_SHORT, 0);

    // Draw shogi pieces
    gl.useProgram(p1);
    gl.bindBuffer(gl.ARRAY_BUFFER, shogiVBOs[0]);
    gl.vertexAttribPointer(0, strides[0], gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, shogiIdxBuf);
    gl.drawElementsInstanced(gl.TRIANGLES, indexCount, gl.UNSIGNED_SHORT, 0, max);

    requestAnimationFrame(render);
}

async function initHavokAndStart() {
    HK = await HavokPhysics();
    bodys = initPhysics();
    data2buf();
    startPhysicsLoop();
    requestAnimationFrame(render);
}

initHavokAndStart().catch((err) => {
    console.error(err);
});
