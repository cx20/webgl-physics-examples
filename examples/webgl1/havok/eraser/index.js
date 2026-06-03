const HAVOK_WASM_URL = 'https://cx20.github.io/gltf-test/libs/babylonjs/dev/HavokPhysics.wasm';
let c = document.getElementById("c");
let gl = c.getContext("experimental-webgl");
let showWireframe = true;
gl.clearColor(0.5, 0.5, 0.8, 1.0);
gl.enable(gl.DEPTH_TEST);
gl.depthFunc(gl.LEQUAL);
let ext = gl.getExtension("ANGLE_instanced_arrays");

resizeCanvas();
window.addEventListener("resize", function () {
    resizeCanvas();
});

window.addEventListener('keydown', event => {
    const isWKey = event.code === 'KeyW' || event.key === 'w' || event.key === 'W';
    if (!isWKey || event.repeat) return;
    showWireframe = !showWireframe;
    const hint = document.getElementById('hint');
    if (hint) hint.textContent = 'W: wireframe ' + (showWireframe ? 'ON' : 'OFF');
});

function resizeCanvas() {
    c.width = window.innerWidth;
    c.height = window.innerHeight;
    gl.viewport(0, 0, c.width, c.height);
}

let p1 = gl.createProgram();
let type = [gl.VERTEX_SHADER, gl.FRAGMENT_SHADER];
let src = [vs.text, fs.text];
for (let i = 0; i < 2; i++) {
    let shader = gl.createShader(type[i]);
    gl.shaderSource(shader, src[i]);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) { alert(gl.getShaderInfoLog(shader)); }
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
gl.uniformMatrix4fv(gl.getUniformLocation(p1, "pMatrix"), false, perspMatrix);

// Flat eraser box (full side lengths) and its half-extents.
const ERASER_SIZE = [2.4, 0.6, 1.2];
const EHALF = [ERASER_SIZE[0] / 2, ERASER_SIZE[1] / 2, ERASER_SIZE[2] / 2];

// Eraser box geometry: 24 vertices (6 faces) with per-face UVs into a 6-column atlas
// (+x, -x, +y, -y, +z, -z), so each face maps to one of the eraser_003 textures.
function buildEraser() {
    const faces = [
        { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },
        { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
        { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },
        { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
        { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
        { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
    ];
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    const localUV = [[0, 1], [1, 1], [1, 0], [0, 0]];
    const positions = [], normals = [], uvs = [], indices = [];
    const dotHalf = (a) => Math.abs(a[0]) * EHALF[0] + Math.abs(a[1]) * EHALF[1] + Math.abs(a[2]) * EHALF[2];
    faces.forEach((f, fi) => {
        const base = positions.length / 3;
        const halfU = dotHalf(f.u), halfV = dotHalf(f.v);
        for (let ci = 0; ci < 4; ci++) {
            const [su, sv] = corners[ci];
            positions.push(
                f.n[0] * EHALF[0] + f.u[0] * su * halfU + f.v[0] * sv * halfV,
                f.n[1] * EHALF[1] + f.u[1] * su * halfU + f.v[1] * sv * halfV,
                f.n[2] * EHALF[2] + f.u[2] * su * halfU + f.v[2] * sv * halfV,
            );
            normals.push(...f.n);
            uvs.push((localUV[ci][0] + fi) / 6, localUV[ci][1]);
        }
        indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    });
    return {
        position: new Float32Array(positions),
        normal: new Float32Array(normals),
        textureCoords: new Float32Array(uvs),
        indeces: new Uint16Array(indices),
    };
}

const eraserGeo = buildEraser();
let position = eraserGeo.position;
let normal = eraserGeo.normal;
let textureCoords = eraserGeo.textureCoords;
let indeces = eraserGeo.indeces;

let eraserIdxBuf = gl.createBuffer();
gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, eraserIdxBuf);
gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indeces, gl.STATIC_DRAW);
let indexCount = indeces.length;

let strides = [3, 3, 2];
let vertices = [position, normal, textureCoords];
let eraserVBOs = [];
for (let i = 0; i < strides.length; i++) {
    let buf = gl.createBuffer();
    eraserVBOs[i] = buf;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, vertices[i], gl.STATIC_DRAW);
    gl.vertexAttribPointer(i, strides[i], gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(i);
}

let max = 200;
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
ext.vertexAttribDivisorANGLE(idx, 1);

idx++;
gl.bindBuffer(gl.ARRAY_BUFFER, rotBuffer);
gl.bufferData(gl.ARRAY_BUFFER, rotArray, gl.STATIC_DRAW);
gl.enableVertexAttribArray(idx);
gl.vertexAttribPointer(idx, rotStride, gl.FLOAT, false, 0, 0);
ext.vertexAttribDivisorANGLE(idx, 1);

// Build a 6-column atlas (right,left,top,bottom,front,back) from the eraser_003 face images.
// The atlas is NPOT, so disable mipmaps and clamp to keep the WebGL 1.0 texture complete.
const ERASER_FACE_TEXTURES = [
    '../../../../assets/textures/eraser_003/eraser_right.png',
    '../../../../assets/textures/eraser_003/eraser_left.png',
    '../../../../assets/textures/eraser_003/eraser_top.png',
    '../../../../assets/textures/eraser_003/eraser_bottom.png',
    '../../../../assets/textures/eraser_003/eraser_front.png',
    '../../../../assets/textures/eraser_003/eraser_back.png',
];
let texture;
(async function loadEraserAtlas() {
    const cell = 256;
    const images = await Promise.all(ERASER_FACE_TEXTURES.map(async (s) => {
        const im = new Image();
        im.src = s;
        await im.decode();
        return im;
    }));
    const atlas = document.createElement('canvas');
    atlas.width = cell * 6;
    atlas.height = cell;
    const ctx2d = atlas.getContext('2d');
    for (let i = 0; i < 6; i++) ctx2d.drawImage(images[i], i * cell, 0, cell, cell);
    texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
})();

// Ground program
let p2 = gl.createProgram();
for (let i = 0; i < 2; i++) {
    let shader = gl.createShader([gl.VERTEX_SHADER, gl.FRAGMENT_SHADER][i]);
    gl.shaderSource(shader, [gvs.text, gfs.text][i]);
    gl.compileShader(shader);
    gl.attachShader(p2, shader);
    gl.deleteShader(shader);
}
gl.linkProgram(p2);
let mvpLoc = gl.getUniformLocation(p2, "mvpMatrix");

// View matrix (same camera as vertex shader)
let vMatrix = mat4.create();
mat4.lookAt(vMatrix, [0, 0, 40], [0, 0, 0], [0, 1, 0]);

// Ground box (matches physics body size [20, 0.1, 20] centered at y=-10)
const GW = 10, GH = 0.05, GD = 10;
let groundBox = new Float32Array([
    -GW, GH, -GD, GW, GH, -GD, GW, GH, GD, -GW, GH, GD,
    -GW, -GH, -GD, GW, -GH, -GD, GW, -GH, GD, -GW, -GH, GD,
    -GW, -GH, GD, GW, -GH, GD, GW, GH, GD, -GW, GH, GD,
    -GW, -GH, -GD, GW, -GH, -GD, GW, GH, -GD, -GW, GH, -GD,
    GW, -GH, -GD, GW, -GH, GD, GW, GH, GD, GW, GH, -GD,
    -GW, -GH, -GD, -GW, -GH, GD, -GW, GH, GD, -GW, GH, -GD
]);
let groundBoxIdx = new Uint16Array([
    0, 1, 2, 0, 2, 3,
    4, 7, 6, 4, 6, 5,
    8, 9, 10, 8, 10, 11,
    12, 15, 14, 12, 14, 13,
    16, 17, 18, 16, 18, 19,
    20, 23, 22, 20, 22, 21
]);
let groundVBO = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, groundVBO);
gl.bufferData(gl.ARRAY_BUFFER, groundBox, gl.STATIC_DRAW);
let groundIBO = gl.createBuffer();
gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, groundIBO);
gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, groundBoxIdx, gl.STATIC_DRAW);
let groundIdxCount = groundBoxIdx.length;
gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, eraserIdxBuf);

// Physics wireframe box (unit cube edges) for debug rendering.
let debugBoxVBO;
let debugBoxIBO;
let debugBoxIndexCount = 0;

function createDebugWireframeBoxMesh() {
    const positions = new Float32Array([
        -0.5, -0.5, -0.5,
        0.5, -0.5, -0.5,
        0.5, 0.5, -0.5,
        -0.5, 0.5, -0.5,
        -0.5, -0.5, 0.5,
        0.5, -0.5, 0.5,
        0.5, 0.5, 0.5,
        -0.5, 0.5, 0.5
    ]);
    const indices = new Uint16Array([
        0, 1, 1, 2, 2, 3, 3, 0,
        4, 5, 5, 6, 6, 7, 7, 4,
        0, 4, 1, 5, 2, 6, 3, 7
    ]);
    debugBoxVBO = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, debugBoxVBO);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
    debugBoxIBO = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, debugBoxIBO);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
    debugBoxIndexCount = indices.length;
}

function drawPhysicsWireframes() {
    if (!showWireframe || !debugBoxVBO || !debugBoxIBO) {
        return;
    }
    gl.useProgram(p2);
    gl.bindBuffer(gl.ARRAY_BUFFER, debugBoxVBO);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, debugBoxIBO);

    for (let i = 0; i < max; i++) {
        const pIdx = i * posStride;
        const qIdx = i * rotStride;
        const pos = [posArray[pIdx], posArray[pIdx + 1], posArray[pIdx + 2]];
        const rot = [rotArray[qIdx], rotArray[qIdx + 1], rotArray[qIdx + 2], rotArray[qIdx + 3]];
        let modelMat = mat4.create();
        mat4.fromRotationTranslation(modelMat, rot, pos);
        mat4.scale(modelMat, modelMat, ERASER_SIZE);
        let mvpMat = mat4.create();
        mat4.multiply(mvpMat, vMatrix, modelMat);
        mat4.multiply(mvpMat, perspMatrix, mvpMat);
        gl.uniformMatrix4fv(mvpLoc, false, mvpMat);
        gl.drawElements(gl.LINES, debugBoxIndexCount, gl.UNSIGNED_SHORT, 0);
    }
}

// physics
const IDENTITY_QUATERNION = [0, 0, 0, 1];
let HK;
let worldId;
let groundBodyId;

let genPosition = function () {
    return {
        x: (Math.random() - 0.5) * 12,
        y: (Math.random() + 1.0) * 14,
        z: (Math.random() - 0.5) * 12
    };
};

function randomQuaternion() {
    const x = Math.random() * Math.PI * 2, y = Math.random() * Math.PI * 2, z = Math.random() * Math.PI * 2;
    const cx = Math.cos(x * 0.5), sx = Math.sin(x * 0.5);
    const cy = Math.cos(y * 0.5), sy = Math.sin(y * 0.5);
    const cz = Math.cos(z * 0.5), sz = Math.sin(z * 0.5);
    return [
        sx * cy * cz + cx * sy * sz,
        cx * sy * cz - sx * cy * sz,
        cx * cy * sz - sx * sy * cz,
        cx * cy * cz + sx * sy * sz
    ];
}

function enumToNumber(value) {
    if (typeof value === 'number') return value;
    if (typeof value === 'bigint') return Number(value);
    if (!value || typeof value !== 'object') return NaN;
    if (typeof value.value === 'number' || typeof value.value === 'bigint') return Number(value.value);
    return NaN;
}

function checkResult(result, label) {
    if (result === HK.Result.RESULT_OK) return;
    const rc = enumToNumber(result), ok = enumToNumber(HK.Result.RESULT_OK);
    if (!Number.isNaN(rc) && !Number.isNaN(ok) && rc === ok) return;
    console.warn('[Havok] ' + label + ' returned:', result);
}

function createBody(shapeId, motionType, position, rotation, setMass) {
    const created = HK.HP_Body_Create();
    const bodyId = created[1];
    HK.HP_Body_SetShape(bodyId, shapeId);
    HK.HP_Body_SetMotionType(bodyId, motionType);
    if (setMass) {
        const massResult = HK.HP_Shape_BuildMassProperties(shapeId);
        HK.HP_Body_SetMassProperties(bodyId, massResult[1]);
    }
    HK.HP_Body_SetPosition(bodyId, position);
    HK.HP_Body_SetOrientation(bodyId, rotation);
    HK.HP_World_AddBody(worldId, bodyId, false);
    return bodyId;
}

function initPhysics() {
    const world = HK.HP_World_Create();
    worldId = world[1];
    HK.HP_World_SetGravity(worldId, [0, -9.8, 0]);
    HK.HP_World_SetIdealStepTime(worldId, 1 / 200);

    const groundShapeResult = HK.HP_Shape_CreateBox([0, 0, 0], IDENTITY_QUATERNION, [20, 0.1, 20]);
    groundBodyId = createBody(groundShapeResult[1], HK.MotionType.STATIC, [0, -10, 0], IDENTITY_QUATERNION, false);

    const eraserShapeResult = HK.HP_Shape_CreateBox([0, 0, 0], IDENTITY_QUATERNION, ERASER_SIZE);
    const eraserShapeId = eraserShapeResult[1];
    HK.HP_Shape_SetDensity(eraserShapeId, 1);

    let bodys = [];
    for (let i = 0; i < max; i++) {
        let p = genPosition();
        bodys[i] = createBody(eraserShapeId, HK.MotionType.DYNAMIC, [p.x, p.y, p.z], randomQuaternion(), true);
    }
    return bodys;
}

let bodys = [];

let data2buf = function () {
    let pIdx = 0;
    let qIdx = 0;
    for (let i = 0; i < max; i++) {
        const p = HK.HP_Body_GetPosition(bodys[i])[1];
        posArray[pIdx++] = p[0];
        posArray[pIdx++] = p[1];
        posArray[pIdx++] = p[2];
        const q = HK.HP_Body_GetOrientation(bodys[i])[1];
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
        HK.HP_World_Step(worldId, 1 / 200);
        for (let i = 0; i < max; i++) {
            let pos = HK.HP_Body_GetPosition(bodys[i])[1];
            if (pos[1] < -15) {
                let p = genPosition();
                HK.HP_Body_SetPosition(bodys[i], [p.x, p.y, p.z]);
                HK.HP_Body_SetOrientation(bodys[i], randomQuaternion());
                HK.HP_Body_SetLinearVelocity(bodys[i], [0, 0, 0]);
                HK.HP_Body_SetAngularVelocity(bodys[i], [0, 0, 0]);
            }
        }
        data2buf();
    }, 1000 / 200);
}

function render() {
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // Draw ground
    gl.useProgram(p2);
    let groundPos = HK.HP_Body_GetPosition(groundBodyId)[1];
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

    // Draw erasers
    gl.useProgram(p1);
    gl.bindBuffer(gl.ARRAY_BUFFER, eraserVBOs[0]);
    gl.vertexAttribPointer(0, strides[0], gl.FLOAT, false, 0, 0);
    if (texture) {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texture);
    }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, eraserIdxBuf);
    ext.drawElementsInstancedANGLE(gl.TRIANGLES, indexCount, gl.UNSIGNED_SHORT, 0, max);

    // Draw physics debug wireframes on top of erasers.
    drawPhysicsWireframes();

    requestAnimationFrame(render);
}

async function initHavokAndStart() {
    HK = await HavokPhysics({
        locateFile: function (path) {
            if (path && path.endsWith('.wasm')) return HAVOK_WASM_URL;
            return path;
        }
    });
    createDebugWireframeBoxMesh();
    bodys = initPhysics();
    data2buf();
    startPhysicsLoop();
    requestAnimationFrame(render);
}

initHavokAndStart().catch((err) => {
    console.error(err);
});
