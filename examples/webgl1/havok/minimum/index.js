const HAVOK_WASM_URL = 'https://cx20.github.io/gltf-test/libs/babylonjs/dev/HavokPhysics.wasm';
const canvas = document.getElementById('c');
const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');

if (!gl) {
    throw new Error('WebGL 1.0 is not supported.');
}

const IDENTITY_QUATERNION = [0, 0, 0, 1];

let HK;
let worldId;
let cubeBodyId;

let program;
let attribPosition;
let attribUv;
let uniformProjection;
let uniformModelView;
let uniformTexture;

let boxVertexBuffer;
let boxUvBuffer;
let boxIndexBuffer;
let boxIndexCount = 0;

let texture;

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

    // Fallback for opaque embind enum wrappers in some builds.
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
        -0.5, -0.5, 0.5,
         0.5, -0.5, 0.5,
         0.5, 0.5, 0.5,
        -0.5, 0.5, 0.5,

         0.5, -0.5, -0.5,
        -0.5, -0.5, -0.5,
        -0.5, 0.5, -0.5,
         0.5, 0.5, -0.5,

        -0.5, -0.5, -0.5,
        -0.5, -0.5, 0.5,
        -0.5, 0.5, 0.5,
        -0.5, 0.5, -0.5,

         0.5, -0.5, 0.5,
         0.5, -0.5, -0.5,
         0.5, 0.5, -0.5,
         0.5, 0.5, 0.5,

        -0.5, 0.5, 0.5,
         0.5, 0.5, 0.5,
         0.5, 0.5, -0.5,
        -0.5, 0.5, -0.5,

        -0.5, -0.5, -0.5,
         0.5, -0.5, -0.5,
         0.5, -0.5, 0.5,
        -0.5, -0.5, 0.5
    ]);

    const uvs = new Float32Array([
        0, 0, 1, 0, 1, 1, 0, 1,
        0, 0, 1, 0, 1, 1, 0, 1,
        0, 0, 1, 0, 1, 1, 0, 1,
        0, 0, 1, 0, 1, 1, 0, 1,
        0, 0, 1, 0, 1, 1, 0, 1,
        0, 0, 1, 0, 1, 1, 0, 1
    ]);

    const indices = new Uint16Array([
         0,  1,  2,  0,  2,  3,
         4,  5,  6,  4,  6,  7,
         8,  9, 10,  8, 10, 11,
        12, 13, 14, 12, 14, 15,
        16, 17, 18, 16, 18, 19,
        20, 21, 22, 20, 22, 23
    ]);

    boxVertexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, boxVertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

    boxUvBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, boxUvBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, uvs, gl.STATIC_DRAW);

    boxIndexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, boxIndexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

    boxIndexCount = indices.length;
}

function loadTexture(url) {
    return new Promise((resolve) => {
        const image = new Image();
        image.crossOrigin = 'anonymous';
        image.onload = () => {
            const tex = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            resolve(tex);
        };
        image.src = url;
    });
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

    const groundShapeResult = HK.HP_Shape_CreateBox([0, 0, 0], IDENTITY_QUATERNION, [20, 1, 20]);
    checkResult(groundShapeResult[0], 'HP_Shape_CreateBox (ground)');
    const groundShapeId = groundShapeResult[1];

    const cubeShapeResult = HK.HP_Shape_CreateBox([0, 0, 0], IDENTITY_QUATERNION, [5, 5, 5]);
    checkResult(cubeShapeResult[0], 'HP_Shape_CreateBox (cube)');
    const cubeShapeId = cubeShapeResult[1];

    checkResult(HK.HP_Shape_SetDensity(cubeShapeId, 1), 'HP_Shape_SetDensity');

    createBody(groundShapeId, HK.MotionType.STATIC, [0, -2.5, 0], IDENTITY_QUATERNION, false);

    cubeBodyId = createBody(
        cubeShapeId,
        HK.MotionType.DYNAMIC,
        [0, 12, 0],
        [Math.sin(Math.PI / 18), 0, Math.sin(Math.PI / 18), Math.cos(Math.PI / 18)],
        true
    );
}

function drawBox(position, rotation, scale) {
    mat4.fromRotationTranslationScale(modelMatrix, rotation, position, scale);
    mat4.multiply(modelViewMatrix, viewMatrix, modelMatrix);

    gl.uniformMatrix4fv(uniformProjection, false, projectionMatrix);
    gl.uniformMatrix4fv(uniformModelView, false, modelViewMatrix);

    gl.drawElements(gl.TRIANGLES, boxIndexCount, gl.UNSIGNED_SHORT, 0);
}

function updateCubeReset() {
    const positionResult = HK.HP_Body_GetPosition(cubeBodyId);
    checkResult(positionResult[0], 'HP_Body_GetPosition');
    const position = positionResult[1];

    if (position[1] < -30) {
        checkResult(HK.HP_Body_SetPosition(cubeBodyId, [0, 12, 0]), 'HP_Body_SetPosition reset');
        checkResult(HK.HP_Body_SetOrientation(cubeBodyId, IDENTITY_QUATERNION), 'HP_Body_SetOrientation reset');
        checkResult(HK.HP_Body_SetLinearVelocity(cubeBodyId, [0, 0, 0]), 'HP_Body_SetLinearVelocity reset');
        checkResult(HK.HP_Body_SetAngularVelocity(cubeBodyId, [0, 0, 0]), 'HP_Body_SetAngularVelocity reset');
    }
}

function render(timeMs) {
    checkResult(HK.HP_World_Step(worldId, 1 / 60), 'HP_World_Step');

    updateCubeReset();

    const t = timeMs * 0.001;
    const eye = [Math.sin(t * 0.3) * 35, 20, Math.cos(t * 0.3) * 35];

    mat4.perspective(projectionMatrix, Math.PI / 4, canvas.width / canvas.height, 0.1, 200.0);
    mat4.lookAt(viewMatrix, eye, [0, 3, 0], [0, 1, 0]);

    gl.clearColor(1, 1, 1, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, boxVertexBuffer);
    gl.vertexAttribPointer(attribPosition, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(attribPosition);

    gl.bindBuffer(gl.ARRAY_BUFFER, boxUvBuffer);
    gl.vertexAttribPointer(attribUv, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(attribUv);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, boxIndexBuffer);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(uniformTexture, 0);

    drawBox([0, -2.5, 0], IDENTITY_QUATERNION, [20, 1, 20]);

    const cubePositionResult = HK.HP_Body_GetPosition(cubeBodyId);
    checkResult(cubePositionResult[0], 'HP_Body_GetPosition draw');
    const cubeRotationResult = HK.HP_Body_GetOrientation(cubeBodyId);
    checkResult(cubeRotationResult[0], 'HP_Body_GetOrientation draw');
    const cubePosition = cubePositionResult[1];
    const cubeRotation = cubeRotationResult[1];
    drawBox(cubePosition, cubeRotation, [5, 5, 5]);

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
    attribUv = gl.getAttribLocation(program, 'textureCoord');
    uniformProjection = gl.getUniformLocation(program, 'pjMatrix');
    uniformModelView = gl.getUniformLocation(program, 'mvMatrix');
    uniformTexture = gl.getUniformLocation(program, 'texture');

    createBoxGeometry();
    texture = await loadTexture('../../../../assets/textures/frog.jpg');

    initPhysics();

    requestAnimationFrame(render);
}

init().catch((err) => {
    console.error(err);
});
