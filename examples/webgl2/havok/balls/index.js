const HAVOK_WASM_URL = 'https://cx20.github.io/gltf-test/libs/babylonjs/dev/HavokPhysics.wasm';
import Module from 'https://esm.run/manifold-3d';

const { mat4, vec3, quat } = glMatrix;

const BALL_COUNT = 150;
const BASKET_HALF = 2.5;
const WALL_RENDER_Y_OFFSET = 0.03;
const IDENTITY_QUATERNION = [0, 0, 0, 1];
const TEXTURE_FILES = [
    '../../../../assets/textures/Basketball.jpg',
    '../../../../assets/textures/BeachBall.jpg',
    '../../../../assets/textures/Football.jpg',
    '../../../../assets/textures/Softball.jpg',
    '../../../../assets/textures/TennisBall.jpg'
];
const BALL_SIZE_SCALES = [1.0, 0.9, 1.0, 0.3, 0.3];

let canvas;
let gl;
let program;
let attribs;
let uniforms;
let sphereMesh;
let cubeMesh;
let textures = [];
let whiteTexture;

let HK;
let worldId;
let balls = [];
let basketWalls = [];

let viewProj = mat4.create();
let projection = mat4.create();
let view = mat4.create();
let model = mat4.create();

function resize() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';
    gl.viewport(0, 0, canvas.width, canvas.height);
}

function createShader(glCtx, type, source) {
    const shader = glCtx.createShader(type);
    glCtx.shaderSource(shader, source);
    glCtx.compileShader(shader);
    if (!glCtx.getShaderParameter(shader, glCtx.COMPILE_STATUS)) {
        throw new Error(glCtx.getShaderInfoLog(shader));
    }
    return shader;
}

function createProgram(glCtx, vsSource, fsSource) {
    const vs = createShader(glCtx, glCtx.VERTEX_SHADER, vsSource);
    const fs = createShader(glCtx, glCtx.FRAGMENT_SHADER, fsSource);
    const prog = glCtx.createProgram();
    glCtx.attachShader(prog, vs);
    glCtx.attachShader(prog, fs);
    glCtx.linkProgram(prog);
    if (!glCtx.getProgramParameter(prog, glCtx.LINK_STATUS)) {
        throw new Error(glCtx.getProgramInfoLog(prog));
    }
    return prog;
}

function sphericalUV(x, y, z) {
    const len = Math.hypot(x, y, z);
    if (len === 0) return [0.5, 0.5];
    const nx = x / len;
    const ny = y / len;
    const nz = z / len;
    const u = 0.5 - Math.atan2(nz, nx) / (2 * Math.PI);
    const v = 0.5 - Math.asin(Math.max(-1, Math.min(1, ny))) / Math.PI;
    return [u, v];
}

function boxUV(x, y, z) {
    const ax = Math.abs(x);
    const ay = Math.abs(y);
    const az = Math.abs(z);
    if (ax >= ay && ax >= az) return [(z / ax + 1) / 2, (y / ax + 1) / 2];
    if (ay >= ax && ay >= az) return [(x / ay + 1) / 2, (z / ay + 1) / 2];
    return [(x / az + 1) / 2, (y / az + 1) / 2];
}

function fixSeamUVs(uv0, uv1, uv2) {
    let u0 = uv0[0], u1 = uv1[0], u2 = uv2[0];
    if (Math.abs(u0 - u1) > 0.5) { if (u0 < u1) u0 += 1.0; else u1 += 1.0; }
    if (Math.abs(u1 - u2) > 0.5) { if (u1 < u2) u1 += 1.0; else u2 += 1.0; }
    if (Math.abs(u0 - u2) > 0.5) { if (u0 < u2) u0 += 1.0; else u2 += 1.0; }
    return [[u0, uv0[1]], [u1, uv1[1]], [u2, uv2[1]]];
}

function manifoldToArrays(manifold, uvFunc, options = {}) {
    const mesh = manifold.getMesh();
    const vertProps = mesh.vertProperties;
    const triVerts = mesh.triVerts;
    const smoothSphere = !!options.smoothSphere;
    const fixSeam = !!options.fixSeam;

    const positions = [];
    const normals = [];
    const uvs = [];

    for (let i = 0; i < triVerts.length; i += 3) {
        const i0 = triVerts[i];
        const i1 = triVerts[i + 1];
        const i2 = triVerts[i + 2];

        const p0 = [vertProps[i0 * 3], vertProps[i0 * 3 + 1], vertProps[i0 * 3 + 2]];
        const p1 = [vertProps[i1 * 3], vertProps[i1 * 3 + 1], vertProps[i1 * 3 + 2]];
        const p2 = [vertProps[i2 * 3], vertProps[i2 * 3 + 1], vertProps[i2 * 3 + 2]];

        positions.push(...p0, ...p1, ...p2);

        if (smoothSphere) {
            const n0 = vec3.normalize(vec3.create(), p0);
            const n1 = vec3.normalize(vec3.create(), p1);
            const n2 = vec3.normalize(vec3.create(), p2);
            normals.push(...n0, ...n1, ...n2);
        } else {
            const a = vec3.sub(vec3.create(), p1, p0);
            const b = vec3.sub(vec3.create(), p2, p0);
            const n = vec3.normalize(vec3.create(), vec3.cross(vec3.create(), a, b));
            normals.push(...n, ...n, ...n);
        }

        let uv0 = uvFunc(...p0);
        let uv1 = uvFunc(...p1);
        let uv2 = uvFunc(...p2);
        if (fixSeam) {
            [uv0, uv1, uv2] = fixSeamUVs(uv0, uv1, uv2);
        }
        uvs.push(...uv0, ...uv1, ...uv2);
    }

    return {
        positions: new Float32Array(positions),
        normals: new Float32Array(normals),
        uvs: new Float32Array(uvs),
        vertexCount: positions.length / 3
    };
}

function createMeshBuffers(data) {
    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, data.positions, gl.STATIC_DRAW);

    const normalBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, data.normals, gl.STATIC_DRAW);

    const uvBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, data.uvs, gl.STATIC_DRAW);

    return { positionBuffer, normalBuffer, uvBuffer, vertexCount: data.vertexCount };
}

function bindMesh(mesh) {
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.positionBuffer);
    gl.vertexAttribPointer(attribs.position, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(attribs.position);

    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.normalBuffer);
    gl.vertexAttribPointer(attribs.normal, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(attribs.normal);

    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.uvBuffer);
    gl.vertexAttribPointer(attribs.uv, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(attribs.uv);
}

function isPowerOf2(value) {
    return (value & (value - 1)) === 0;
}

function loadTexture(url) {
    return new Promise((resolve) => {
        const texture = gl.createTexture();
        const image = new Image();
        image.crossOrigin = 'anonymous';
        image.onload = () => {
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
            if (isPowerOf2(image.width) && isPowerOf2(image.height)) {
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
            resolve(texture);
        };
        image.src = url;
    });
}

function createSolidTexture(r, g, b, a) {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([r, g, b, a]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    return texture;
}

function enumToNumber(value) {
    if (typeof value === 'number') return value;
    if (typeof value === 'bigint') return Number(value);
    if (typeof value === 'string') {
        const parsed = Number(value.trim());
        return Number.isNaN(parsed) ? NaN : parsed;
    }
    if (!value || typeof value !== 'object') return NaN;
    if (typeof value.value === 'number' || typeof value.value === 'bigint') return Number(value.value);
    if (typeof value.m_value === 'number' || typeof value.m_value === 'bigint') return Number(value.m_value);
    if (typeof value.value === 'function') {
        const v = value.value();
        const n = enumToNumber(v);
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
    if (!Number.isNaN(resultCode) && !Number.isNaN(okCode) && resultCode === okCode) return;
    if (typeof result === 'object' && typeof HK.Result.RESULT_OK === 'object') {
        try {
            if (JSON.stringify(result) === JSON.stringify(HK.Result.RESULT_OK)) return;
        } catch (_e) {}
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
    checkResult(HK.HP_World_SetIdealStepTime(worldId, 1 / 60), 'HP_World_SetIdealStepTime');

    const groundShapeR = HK.HP_Shape_CreateBox([0, 0, 0], IDENTITY_QUATERNION, [20, 2, 20]);
    checkResult(groundShapeR[0], 'HP_Shape_CreateBox ground');
    HK.HP_Shape_SetMaterial(groundShapeR[1], [0.6, 0.6, 0.3, HK.MaterialCombine.MINIMUM, HK.MaterialCombine.MAXIMUM]);
    createBody(groundShapeR[1], HK.MotionType.STATIC, [0, -2, 0], IDENTITY_QUATERNION, false);

    basketWalls = [
        { size: [4.8, 5, 0.4], pos: [0, 1.5, -2.5] },
        { size: [4.8, 5, 0.4], pos: [0, 1.5,  2.5] },
        { size: [0.4, 5, 4.8], pos: [-2.5, 1.5, 0] },
        { size: [0.4, 5, 4.8], pos: [ 2.5, 1.5, 0] }
    ];
    for (const wall of basketWalls) {
        const shapeR = HK.HP_Shape_CreateBox([0, 0, 0], IDENTITY_QUATERNION, wall.size);
        checkResult(shapeR[0], 'HP_Shape_CreateBox wall');
        HK.HP_Shape_SetMaterial(shapeR[1], [0.4, 0.4, 0.3, HK.MaterialCombine.MINIMUM, HK.MaterialCombine.MAXIMUM]);
        createBody(shapeR[1], HK.MotionType.STATIC, wall.pos, IDENTITY_QUATERNION, false);
    }

    balls = [];
    for (let i = 0; i < BALL_COUNT; i++) {
        const textureIndex = Math.floor(Math.random() * BALL_SIZE_SCALES.length);
        const radius = (0.5 + Math.random() * 0.25) * BALL_SIZE_SCALES[textureIndex];
        const shapeR = HK.HP_Shape_CreateSphere([0, 0, 0], radius);
        checkResult(shapeR[0], 'HP_Shape_CreateSphere ball');
        const shapeId = shapeR[1];
        checkResult(HK.HP_Shape_SetDensity(shapeId, 1), 'HP_Shape_SetDensity');
            HK.HP_Shape_SetMaterial(shapeId, [0.4, 0.4, 0.75, HK.MaterialCombine.MINIMUM, HK.MaterialCombine.MAXIMUM]);
        const bodyId = createBody(
            shapeId,
            HK.MotionType.DYNAMIC,
            [
                (Math.random() - 0.5) * (BASKET_HALF * 1.4),
                6 + Math.random() * 13,
                (Math.random() - 0.5) * (BASKET_HALF * 1.4)
            ],
            IDENTITY_QUATERNION,
            true
        );
        balls.push({ bodyId, radius, textureIndex });
    }
}

function drawMesh(mesh, texture, tint, transform) {
    bindMesh(mesh);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniformMatrix4fv(uniforms.model, false, transform);
    gl.uniform3fv(uniforms.tint, tint);
    gl.drawArrays(gl.TRIANGLES, 0, mesh.vertexCount);
}

function render(timeMs) {
    checkResult(HK.HP_World_Step(worldId, 1 / 60), 'HP_World_Step');

    for (const item of balls) {
        const posR = HK.HP_Body_GetPosition(item.bodyId);
        checkResult(posR[0], 'HP_Body_GetPosition');
        if (posR[1][1] < -20) {
            checkResult(HK.HP_Body_SetPosition(item.bodyId, [
                (Math.random() - 0.5) * (BASKET_HALF * 1.4),
                10 + Math.random() * 8,
                (Math.random() - 0.5) * (BASKET_HALF * 1.4)
            ]), 'HP_Body_SetPosition reset');
            checkResult(HK.HP_Body_SetLinearVelocity(item.bodyId, [0, 0, 0]), 'HP_Body_SetLinearVelocity reset');
            checkResult(HK.HP_Body_SetAngularVelocity(item.bodyId, [0, 0, 0]), 'HP_Body_SetAngularVelocity reset');
        }
    }

    const t = timeMs * 0.001;
    const eye = vec3.fromValues(Math.sin(t * 0.2) * 24, 12, Math.cos(t * 0.2) * 24);
    mat4.lookAt(view, eye, [0, 4, 0], [0, 1, 0]);
    mat4.perspective(projection, Math.PI / 4, canvas.width / canvas.height, 0.1, 150);
    mat4.multiply(viewProj, projection, view);

    gl.clearColor(0.97, 0.97, 0.98, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.useProgram(program);
    gl.uniformMatrix4fv(uniforms.viewProj, false, viewProj);
    gl.uniform3f(uniforms.lightDir, 0.6, 0.9, 0.4);
    gl.uniform1f(uniforms.alpha, 1.0);

    mat4.fromRotationTranslationScale(model, quat.create(), [0, -2, 0], [20, 2, 20]);
    drawMesh(cubeMesh, whiteTexture, [0.22, 0.22, 0.24], model);

    for (const item of balls) {
        const posR = HK.HP_Body_GetPosition(item.bodyId);
        checkResult(posR[0], 'HP_Body_GetPosition render');
        const rotR = HK.HP_Body_GetOrientation(item.bodyId);
        checkResult(rotR[0], 'HP_Body_GetOrientation render');
        const s = vec3.fromValues(item.radius, item.radius, item.radius);
        mat4.fromRotationTranslationScale(model, rotR[1], posR[1], s);
        drawMesh(sphereMesh, textures[item.textureIndex], [1, 1, 1], model);
    }

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.uniform1f(uniforms.alpha, 0.28);

    for (const wall of basketWalls) {
        const wallPos = [wall.pos[0], wall.pos[1] + WALL_RENDER_Y_OFFSET, wall.pos[2]];
        mat4.fromRotationTranslationScale(model, quat.create(), wallPos, wall.size);
        drawMesh(cubeMesh, whiteTexture, [0.25, 0.28, 0.3], model);
    }

    gl.depthMask(true);
    gl.disable(gl.BLEND);

    requestAnimationFrame(render);
}

async function main() {
    canvas = document.getElementById('c');
    gl = canvas.getContext('webgl2');
    if (!gl) throw new Error('WebGL 2.0 is not supported.');

    resize();
    window.addEventListener('resize', resize);

    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);

    program = createProgram(
        gl,
        document.getElementById('vs').textContent,
        document.getElementById('fs').textContent
    );
    gl.useProgram(program);

    attribs = {
        position: gl.getAttribLocation(program, 'aPosition'),
        normal:   gl.getAttribLocation(program, 'aNormal'),
        uv:       gl.getAttribLocation(program, 'aTexCoord')
    };
    uniforms = {
        viewProj: gl.getUniformLocation(program, 'uViewProj'),
        model:    gl.getUniformLocation(program, 'uModel'),
        texture:  gl.getUniformLocation(program, 'uTexture'),
        tint:     gl.getUniformLocation(program, 'uTint'),
        lightDir: gl.getUniformLocation(program, 'uLightDir'),
        alpha:    gl.getUniformLocation(program, 'uAlpha')
    };
    gl.uniform1i(uniforms.texture, 0);

    const wasm = await Module();
    wasm.setup();
    const { Manifold } = wasm;

    const sphere = Manifold.sphere(1.0, 64);
    const sphereData = manifoldToArrays(sphere, sphericalUV, { smoothSphere: true, fixSeam: true });
    sphere.delete();

    const cube = Manifold.cube([1, 1, 1], true);
    const cubeData = manifoldToArrays(cube, boxUV, { smoothSphere: false, fixSeam: false });
    cube.delete();

    sphereMesh = createMeshBuffers(sphereData);
    cubeMesh = createMeshBuffers(cubeData);

    textures = await Promise.all(TEXTURE_FILES.map(loadTexture));
    whiteTexture = createSolidTexture(255, 255, 255, 255);

    HK = await HavokPhysics({
        locateFile: function (path) {
            if (path && path.endsWith('.wasm')) {
                return HAVOK_WASM_URL;
            }
            return path;
        }
    });
    initPhysics();

    requestAnimationFrame(render);
}

main().catch((err) => {
    console.error(err);
});
