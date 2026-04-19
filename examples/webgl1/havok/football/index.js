const { mat4 } = glMatrix;

const DOT_ROWS = [
    '.............ppp',
    '......rrrrr..ppp',
    '.....rrrrrrrrrpp',
    '.....nnnppnp.rrr',
    '....npnpppnpprrr',
    '....npnnpppnpppr',
    '....nnppppnnnnr.',
    '......pppppppr..',
    '..rrrrrbrrrbr...',
    '.rrrrrrrrbrrrb..n',
    'pprrrrrrbbbbb..n',
    'ppp.bbrbbybbybnn',
    '.p.nbbbbbbbbbbnn',
    '..nnnbbbbbbbbbnn',
    '.nnnbbbbbbb.....',
    '.n..bbbb........'
];

const BALL_COUNT = DOT_ROWS.length * DOT_ROWS[0].length;
const IDENTITY_QUATERNION = [0, 0, 0, 1];

const FOOTBALL_TEXTURE = '../../../../assets/textures/Football.jpg';
const GROUND_TEXTURE = '../../../../assets/textures/grass.jpg';

const canvas = document.getElementById('c');
const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');

if (!gl) {
    throw new Error('WebGL 1.0 is not supported.');
}

let HK;
let worldId;
let groundBodyId;
const ballBodyIds = [];
const ballSpawnPositions = [];
const ballTints = [];

let program;
let attribPosition;
let attribNormal;
let attribTexCoord;
let uniformViewProj;
let uniformModel;
let uniformTexture;
let uniformTint;
let uniformLightDir;
let uniformAlpha;

let sphereMesh;
let planeMesh;
let footballTexture;
let grassTexture;

const projectionMatrix = mat4.create();
const viewMatrix = mat4.create();
const viewProjMatrix = mat4.create();
const modelMatrix = mat4.create();

function enumToNumber(value) {
    if (typeof value === 'number') return value;
    if (typeof value === 'bigint') return Number(value);
    if (typeof value === 'string') {
        const parsed = Number(value.trim());
        return Number.isNaN(parsed) ? NaN : parsed;
    }
    if (!value || typeof value !== 'object') return NaN;

    if (typeof value.value === 'number' || typeof value.value === 'bigint') {
        return Number(value.value);
    }
    if (typeof value.m_value === 'number' || typeof value.m_value === 'bigint') {
        return Number(value.m_value);
    }
    if (typeof value.value === 'function') {
        const n = enumToNumber(value.value());
        if (!Number.isNaN(n)) return n;
    }
    if (typeof value.valueOf === 'function') {
        const v = value.valueOf();
        if (v !== value) {
            const n = enumToNumber(v);
            if (!Number.isNaN(n)) return n;
        }
    }

    return NaN;
}

function checkResult(result, label) {
    if (result === HK.Result.RESULT_OK) return;

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
    const vs = createShader(gl.VERTEX_SHADER, vsSource);
    const fs = createShader(gl.FRAGMENT_SHADER, fsSource);
    const p = gl.createProgram();
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        throw new Error(gl.getProgramInfoLog(p));
    }
    return p;
}

function isPowerOf2(v) {
    return (v & (v - 1)) === 0;
}

function loadTexture(url) {
    return new Promise((resolve) => {
        const tex = gl.createTexture();
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);

            if (isPowerOf2(img.width) && isPowerOf2(img.height)) {
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
                gl.generateMipmap(gl.TEXTURE_2D);
            } else {
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            }

            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            resolve(tex);
        };
        img.src = url;
    });
}

function createSphereGeometry(radius, latSegments, lonSegments) {
    const positions = [];
    const normals = [];
    const uvs = [];
    const indices = [];

    for (let y = 0; y <= latSegments; y++) {
        const v = y / latSegments;
        const theta = v * Math.PI;
        const sinTheta = Math.sin(theta);
        const cosTheta = Math.cos(theta);

        for (let x = 0; x <= lonSegments; x++) {
            const u = x / lonSegments;
            const phi = u * Math.PI * 2;
            const sinPhi = Math.sin(phi);
            const cosPhi = Math.cos(phi);

            const nx = cosPhi * sinTheta;
            const ny = cosTheta;
            const nz = sinPhi * sinTheta;

            positions.push(nx * radius, ny * radius, nz * radius);
            normals.push(nx, ny, nz);
            uvs.push(1 - u, 1 - v);
        }
    }

    for (let y = 0; y < latSegments; y++) {
        for (let x = 0; x < lonSegments; x++) {
            const a = y * (lonSegments + 1) + x;
            const b = a + lonSegments + 1;
            indices.push(a, b, a + 1, b, b + 1, a + 1);
        }
    }

    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);

    const normalBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(normals), gl.STATIC_DRAW);

    const uvBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(uvs), gl.STATIC_DRAW);

    const indexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);

    return {
        positionBuffer,
        normalBuffer,
        uvBuffer,
        indexBuffer,
        indexCount: indices.length
    };
}

function createPlaneGeometry(size, uvRepeat) {
    const hs = size * 0.5;
    const positions = new Float32Array([
        -hs, 0, -hs,
         hs, 0, -hs,
         hs, 0,  hs,
        -hs, 0,  hs
    ]);
    const normals = new Float32Array([
        0, 1, 0,
        0, 1, 0,
        0, 1, 0,
        0, 1, 0
    ]);
    const uvs = new Float32Array([
        0, 0,
        uvRepeat, 0,
        uvRepeat, uvRepeat,
        0, uvRepeat
    ]);
    const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);

    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

    const normalBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, normals, gl.STATIC_DRAW);

    const uvBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, uvs, gl.STATIC_DRAW);

    const indexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

    return {
        positionBuffer,
        normalBuffer,
        uvBuffer,
        indexBuffer,
        indexCount: indices.length
    };
}

function bindMesh(mesh) {
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.positionBuffer);
    gl.enableVertexAttribArray(attribPosition);
    gl.vertexAttribPointer(attribPosition, 3, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.normalBuffer);
    gl.enableVertexAttribArray(attribNormal);
    gl.vertexAttribPointer(attribNormal, 3, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.uvBuffer);
    gl.enableVertexAttribArray(attribTexCoord);
    gl.vertexAttribPointer(attribTexCoord, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.indexBuffer);
}

function getTintColor(code) {
    const map = {
        '.': [0xDC / 255, 0xAA / 255, 0x6B / 255],
        'p': [1.0, 0xCC / 255, 0xCC / 255],
        'n': [0x80 / 255, 0.0, 0.0],
        'r': [1.0, 0.0, 0.0],
        'y': [1.0, 1.0, 0.0],
        'b': [0.0, 0.0, 1.0]
    };
    return map[code] || [1.0, 1.0, 1.0];
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

    const groundShapeResult = HK.HP_Shape_CreateBox([0, 0, 0], IDENTITY_QUATERNION, [30, 0.4, 30]);
    checkResult(groundShapeResult[0], 'HP_Shape_CreateBox (ground)');
    groundBodyId = createBody(groundShapeResult[1], HK.MotionType.STATIC, [0, -2, 0], IDENTITY_QUATERNION, false);

    const ballShapeResult = HK.HP_Shape_CreateSphere([0, 0, 0], 0.5);
    checkResult(ballShapeResult[0], 'HP_Shape_CreateSphere (ball)');
    const ballShapeId = ballShapeResult[1];
    checkResult(HK.HP_Shape_SetDensity(ballShapeId, 1), 'HP_Shape_SetDensity');

    for (let y = 0; y < DOT_ROWS.length; y++) {
        const row = DOT_ROWS[y];
        for (let x = 0; x < row.length; x++) {
            const spawn = [
                -10 + x * 1.5 + Math.random() * 0.1,
                (DOT_ROWS.length - 1 - y) * 1.2 + Math.random() * 0.1,
                Math.random() * 0.1
            ];
            const bodyId = createBody(ballShapeId, HK.MotionType.DYNAMIC, spawn, IDENTITY_QUATERNION, true);
            ballBodyIds.push(bodyId);
            ballSpawnPositions.push(spawn);
            ballTints.push(getTintColor(row[x]));
        }
    }
}

function resetIfOut(bodyId, spawn) {
    const posResult = HK.HP_Body_GetPosition(bodyId);
    checkResult(posResult[0], 'HP_Body_GetPosition');

    if (posResult[1][1] < -30) {
        const resetPos = [spawn[0], spawn[1] + 20 + Math.random() * 5, spawn[2]];
        checkResult(HK.HP_Body_SetPosition(bodyId, resetPos), 'HP_Body_SetPosition reset');
        checkResult(HK.HP_Body_SetOrientation(bodyId, IDENTITY_QUATERNION), 'HP_Body_SetOrientation reset');
        checkResult(HK.HP_Body_SetLinearVelocity(bodyId, [0, 0, 0]), 'HP_Body_SetLinearVelocity reset');
        checkResult(HK.HP_Body_SetAngularVelocity(bodyId, [0, 0, 0]), 'HP_Body_SetAngularVelocity reset');
    }
}

function drawMesh(mesh, texture, tint, alpha, position, rotation, scale) {
    bindMesh(mesh);

    mat4.fromRotationTranslationScale(modelMatrix, rotation, position, scale);

    gl.uniformMatrix4fv(uniformModel, false, modelMatrix);
    gl.uniform3fv(uniformTint, tint);
    gl.uniform1f(uniformAlpha, alpha);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);

    gl.drawElements(gl.TRIANGLES, mesh.indexCount, gl.UNSIGNED_SHORT, 0);
}

function render(timeMs) {
    checkResult(HK.HP_World_Step(worldId, 1 / 60), 'HP_World_Step');

    for (let i = 0; i < BALL_COUNT; i++) {
        resetIfOut(ballBodyIds[i], ballSpawnPositions[i]);
    }

    const t = timeMs * 0.001;
    const eye = [Math.sin(t * 0.2) * 20, 10, Math.cos(t * 0.2) * 20];

    mat4.perspective(projectionMatrix, Math.PI / 4, canvas.width / canvas.height, 0.1, 120);
    mat4.lookAt(viewMatrix, eye, [0, 8, 0], [0, 1, 0]);
    mat4.multiply(viewProjMatrix, projectionMatrix, viewMatrix);

    gl.clearColor(0.97, 0.97, 0.98, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.useProgram(program);
    gl.uniformMatrix4fv(uniformViewProj, false, viewProjMatrix);
    gl.uniform3fv(uniformLightDir, [0.6, 0.9, 0.4]);
    gl.uniform1i(uniformTexture, 0);

    drawMesh(planeMesh, grassTexture, [1, 1, 1], 1.0, [0, -2, 0], IDENTITY_QUATERNION, [1, 1, 1]);

    for (let i = 0; i < BALL_COUNT; i++) {
        const posResult = HK.HP_Body_GetPosition(ballBodyIds[i]);
        checkResult(posResult[0], 'HP_Body_GetPosition draw');
        const rotResult = HK.HP_Body_GetOrientation(ballBodyIds[i]);
        checkResult(rotResult[0], 'HP_Body_GetOrientation draw');

        drawMesh(
            sphereMesh,
            footballTexture,
            ballTints[i],
            1.0,
            posResult[1],
            rotResult[1],
            [1, 1, 1]
        );
    }

    requestAnimationFrame(render);
}

async function init() {
    HK = await HavokPhysics();

    resize();
    window.addEventListener('resize', resize);

    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);

    program = createProgram(
        document.getElementById('vs').textContent,
        document.getElementById('fs').textContent
    );

    attribPosition = gl.getAttribLocation(program, 'aPosition');
    attribNormal = gl.getAttribLocation(program, 'aNormal');
    attribTexCoord = gl.getAttribLocation(program, 'aTexCoord');

    uniformViewProj = gl.getUniformLocation(program, 'uViewProj');
    uniformModel = gl.getUniformLocation(program, 'uModel');
    uniformTexture = gl.getUniformLocation(program, 'uTexture');
    uniformTint = gl.getUniformLocation(program, 'uTint');
    uniformLightDir = gl.getUniformLocation(program, 'uLightDir');
    uniformAlpha = gl.getUniformLocation(program, 'uAlpha');

    sphereMesh = createSphereGeometry(0.5, 18, 24);
    planeMesh = createPlaneGeometry(60, 6);

    footballTexture = await loadTexture(FOOTBALL_TEXTURE);
    grassTexture = await loadTexture(GROUND_TEXTURE);

    initPhysics();

    requestAnimationFrame(render);
}

init().catch((err) => {
    console.error(err);
});
