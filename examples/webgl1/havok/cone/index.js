const { mat4, vec3, quat } = glMatrix;

const CONE_COUNT = 120;
const BASKET_HALF = 3.0;
const WALL_RENDER_Y_OFFSET = 0.03;
const CONE_TEXTURE = '../../../../assets/textures/carrot.jpg';
const SHOW_DEBUG_PHYSICS = false;
const CONE_HULL_SEGMENTS = 16;

let canvas;
let gl;
let program;
let lineProgram;
let attribs;
let uniforms;
let lineAttribs;
let lineUniforms;
let coneMesh;
let cubeMesh;
let debugBoxMesh;
let debugConeMesh;
let coneTexture;
let whiteTexture;

const IDENTITY_QUATERNION = [0, 0, 0, 1];

let HK;
let worldId;
let cones = [];
let ground;
let basketWalls = [];
const coneShapeCache = new Map();

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

    return {
        positionBuffer,
        normalBuffer,
        uvBuffer,
        vertexCount: data.vertexCount
    };
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
    gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        1,
        1,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        new Uint8Array([r, g, b, a])
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    return texture;
}

function generateCubeMesh() {
    const p = [
        -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5,
        -0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5,
        0.5, -0.5, -0.5, -0.5, -0.5, -0.5, -0.5, 0.5, -0.5,
        0.5, -0.5, -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5,
        -0.5, -0.5, -0.5, -0.5, -0.5, 0.5, -0.5, 0.5, 0.5,
        -0.5, -0.5, -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, -0.5,
        0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5,
        0.5, -0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5,
        -0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, -0.5,
        -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, -0.5, 0.5, -0.5,
        -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, -0.5, 0.5,
        -0.5, -0.5, -0.5, 0.5, -0.5, 0.5, -0.5, -0.5, 0.5
    ];
    const n = [
        0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1,
        0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1,
        -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0,
        1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0,
        0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0,
        0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0
    ];
    const u = [
        0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1,
        0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1,
        0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1,
        0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1,
        0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1,
        0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1
    ];
    return {
        positions: new Float32Array(p),
        normals: new Float32Array(n),
        uvs: new Float32Array(u),
        vertexCount: p.length / 3
    };
}

function generateConeMesh(segments) {
    const positions = [];
    const normals = [];
    const uvs = [];

    for (let i = 0; i < segments; i++) {
        const a0 = (i / segments) * Math.PI * 2;
        const a1 = ((i + 1) / segments) * Math.PI * 2;
        const x0 = Math.cos(a0);
        const z0 = Math.sin(a0);
        const x1 = Math.cos(a1);
        const z1 = Math.sin(a1);

        const p0 = [x0, -0.5, z0];
        const p1 = [x1, -0.5, z1];
        const apex = [0, 0.5, 0];

        const e1 = vec3.sub(vec3.create(), p1, p0);
        const e2 = vec3.sub(vec3.create(), apex, p0);
        const sideN = vec3.normalize(vec3.create(), vec3.cross(vec3.create(), e1, e2));

        positions.push(...p0, ...p1, ...apex);
        normals.push(...sideN, ...sideN, ...sideN);
        uvs.push(i / segments, 0, (i + 1) / segments, 0, (i + 0.5) / segments, 1);

        const center = [0, -0.5, 0];
        const baseN = [0, -1, 0];
        positions.push(...center, ...p1, ...p0);
        normals.push(...baseN, ...baseN, ...baseN);
        uvs.push(0.5, 0.5, 0.5 + x1 * 0.5, 0.5 + z1 * 0.5, 0.5 + x0 * 0.5, 0.5 + z0 * 0.5);
    }

    return {
        positions: new Float32Array(positions),
        normals: new Float32Array(normals),
        uvs: new Float32Array(uvs),
        vertexCount: positions.length / 3
    };
}

function createDebugWireframeBoxMesh() {
    const positions = new Float32Array([
        -0.5, -0.5, -0.5,
         0.5, -0.5, -0.5,
         0.5,  0.5, -0.5,
        -0.5,  0.5, -0.5,
        -0.5, -0.5,  0.5,
         0.5, -0.5,  0.5,
         0.5,  0.5,  0.5,
        -0.5,  0.5,  0.5
    ]);
    const indices = new Uint16Array([
        0, 1, 1, 2, 2, 3, 3, 0,
        4, 5, 5, 6, 6, 7, 7, 4,
        0, 4, 1, 5, 2, 6, 3, 7
    ]);

    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

    const indexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

    return {
        positionBuffer,
        indexBuffer,
        count: indices.length
    };
}

function createDebugWireframeConeMesh(segments) {
    const positions = [];
    const indices = [];

    positions.push(0, 0.5, 0);
    const apexIndex = 0;

    for (let i = 0; i < segments; i++) {
        const angle = (i / segments) * Math.PI * 2;
        positions.push(Math.cos(angle), -0.5, Math.sin(angle));
    }

    for (let i = 0; i < segments; i++) {
        const curr = 1 + i;
        const next = 1 + ((i + 1) % segments);
        indices.push(curr, next);
        indices.push(apexIndex, curr);
    }

    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);

    const indexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);

    return {
        positionBuffer,
        indexBuffer,
        count: indices.length
    };
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

    const rc = enumToNumber(result);
    const ok = enumToNumber(HK.Result.RESULT_OK);
    if (!Number.isNaN(rc) && !Number.isNaN(ok) && rc === ok) return;

    if (typeof result === 'object' && typeof HK.Result.RESULT_OK === 'object') {
        try {
            if (JSON.stringify(result) === JSON.stringify(HK.Result.RESULT_OK)) return;
        } catch (_e) {
        }
    }

    throw new Error(label + ' failed with code: ' + String(result));
}

function createBody(shapeId, motionType, position, rotation, setMass, options = {}) {
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

    if (options.linearDamping !== undefined) {
        checkResult(HK.HP_Body_SetLinearDamping(bodyId, options.linearDamping), 'HP_Body_SetLinearDamping');
    }
    if (options.angularDamping !== undefined) {
        checkResult(HK.HP_Body_SetAngularDamping(bodyId, options.angularDamping), 'HP_Body_SetAngularDamping');
    }

    checkResult(HK.HP_World_AddBody(worldId, bodyId, false), 'HP_World_AddBody');
    return bodyId;
}

function createConeConvexHullShape(radius, height, segments = CONE_HULL_SEGMENTS) {
    const key = radius.toFixed(3) + ':' + height.toFixed(3) + ':' + segments;
    if (coneShapeCache.has(key)) {
        return coneShapeCache.get(key);
    }

    if (typeof HK.HP_Shape_CreateConvexHull !== 'function' || typeof HK._malloc !== 'function') {
        throw new Error('Havok convex hull API is not available in this runtime.');
    }

    const numVertices = segments + 1;
    const floatsPerVertex = 3;
    const byteSize = numVertices * floatsPerVertex * 4;
    const ptr = HK._malloc(byteSize);
    const verts = new Float32Array(HK.HEAPF32.buffer, ptr, numVertices * floatsPerVertex);
    const halfHeight = height * 0.5;

    for (let i = 0; i < segments; i++) {
        const angle = (i / segments) * Math.PI * 2;
        verts[i * 3 + 0] = Math.cos(angle) * radius;
        verts[i * 3 + 1] = -halfHeight;
        verts[i * 3 + 2] = Math.sin(angle) * radius;
    }

    verts[segments * 3 + 0] = 0;
    verts[segments * 3 + 1] = halfHeight;
    verts[segments * 3 + 2] = 0;

    const created = HK.HP_Shape_CreateConvexHull(ptr, numVertices);
    HK._free(ptr);
    checkResult(created[0], 'HP_Shape_CreateConvexHull cone');

    const shapeId = created[1];
    coneShapeCache.set(key, shapeId);
    return shapeId;
}

function randomConePosition(reset) {
    return [
        (Math.random() - 0.5) * (BASKET_HALF * 1.5),
        (reset ? 9 : 6) + Math.random() * (reset ? 8 : 14),
        (Math.random() - 0.5) * (BASKET_HALF * 1.5)
    ];
}

function randomConeQuaternion() {
    const q = quat.create();
    quat.fromEuler(q, Math.random() * 20, Math.random() * 360, Math.random() * 20);
    return [q[0], q[1], q[2], q[3]];
}

function initPhysics() {
    const world = HK.HP_World_Create();
    checkResult(world[0], 'HP_World_Create');
    worldId = world[1];
    checkResult(HK.HP_World_SetGravity(worldId, [0, -9.8, 0]), 'HP_World_SetGravity');
    checkResult(HK.HP_World_SetIdealStepTime(worldId, 1 / 60), 'HP_World_SetIdealStepTime');

    ground = { size: [20, 2, 20], pos: [0, -2, 0] };
    basketWalls = [
        { size: [6.2, 5, 0.5], pos: [0, 1.5, -3.2] },
        { size: [6.2, 5, 0.5], pos: [0, 1.5, 3.2] },
        { size: [0.5, 5, 6.2], pos: [-3.2, 1.5, 0] },
        { size: [0.5, 5, 6.2], pos: [3.2, 1.5, 0] }
    ];

    const groundShape = HK.HP_Shape_CreateBox([0, 0, 0], IDENTITY_QUATERNION, ground.size);
    checkResult(groundShape[0], 'HP_Shape_CreateBox ground');
    createBody(groundShape[1], HK.MotionType.STATIC, ground.pos, IDENTITY_QUATERNION, false);

    for (const wall of basketWalls) {
        const wallShape = HK.HP_Shape_CreateBox([0, 0, 0], IDENTITY_QUATERNION, wall.size);
        checkResult(wallShape[0], 'HP_Shape_CreateBox wall');
        createBody(wallShape[1], HK.MotionType.STATIC, wall.pos, IDENTITY_QUATERNION, false);
    }

    cones = [];
    for (let i = 0; i < CONE_COUNT; i++) {
        const radius = 0.45 + Math.random() * 0.3;
        const height = 1.2 + Math.random() * 1.0;
        const coneShapeId = createConeConvexHullShape(radius, height);
        checkResult(HK.HP_Shape_SetDensity(coneShapeId, 1), 'HP_Shape_SetDensity cone');
        const body = createBody(
            coneShapeId,
            HK.MotionType.DYNAMIC,
            randomConePosition(false),
            randomConeQuaternion(),
            true,
            { linearDamping: 0.02, angularDamping: 0.02 }
        );
        cones.push({ body, radius, height });
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

function drawDebugBox(position, rotation, size, color) {
    const debugModel = mat4.create();
    mat4.fromRotationTranslationScale(debugModel, rotation, position, size);

    gl.useProgram(lineProgram);
    gl.uniformMatrix4fv(lineUniforms.viewProj, false, viewProj);
    gl.uniformMatrix4fv(lineUniforms.model, false, debugModel);
    gl.uniform4fv(lineUniforms.color, color);

    gl.bindBuffer(gl.ARRAY_BUFFER, debugBoxMesh.positionBuffer);
    gl.enableVertexAttribArray(lineAttribs.position);
    gl.vertexAttribPointer(lineAttribs.position, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, debugBoxMesh.indexBuffer);
    gl.drawElements(gl.LINES, debugBoxMesh.count, gl.UNSIGNED_SHORT, 0);
}

function drawDebugCone(position, rotation, radius, height, color) {
    const debugModel = mat4.create();
    mat4.fromRotationTranslationScale(debugModel, rotation, position, vec3.fromValues(radius, height, radius));

    gl.useProgram(lineProgram);
    gl.uniformMatrix4fv(lineUniforms.viewProj, false, viewProj);
    gl.uniformMatrix4fv(lineUniforms.model, false, debugModel);
    gl.uniform4fv(lineUniforms.color, color);

    gl.bindBuffer(gl.ARRAY_BUFFER, debugConeMesh.positionBuffer);
    gl.enableVertexAttribArray(lineAttribs.position);
    gl.vertexAttribPointer(lineAttribs.position, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, debugConeMesh.indexBuffer);
    gl.drawElements(gl.LINES, debugConeMesh.count, gl.UNSIGNED_SHORT, 0);
}

function drawPhysicsDebug() {
    if (!SHOW_DEBUG_PHYSICS) {
        return;
    }

    gl.disable(gl.CULL_FACE);

    drawDebugBox(ground.pos, quat.create(), ground.size, [0.65, 0.75, 0.9, 1.0]);

    for (const wall of basketWalls) {
        drawDebugBox(wall.pos, quat.create(), wall.size, [0.55, 0.65, 0.8, 1.0]);
    }

    for (const item of cones) {
        const pResult = HK.HP_Body_GetPosition(item.body);
        checkResult(pResult[0], 'HP_Body_GetPosition debug');
        const qResult = HK.HP_Body_GetOrientation(item.body);
        checkResult(qResult[0], 'HP_Body_GetOrientation debug');
        const p = pResult[1];
        const q = qResult[1];
        drawDebugCone(
            vec3.fromValues(p[0], p[1], p[2]),
            quat.fromValues(q[0], q[1], q[2], q[3]),
            item.radius,
            item.height,
            [0.1, 1.0, 0.2, 1.0]
        );
    }

    gl.useProgram(program);
}

function render(timeMs) {
    checkResult(HK.HP_World_Step(worldId, 1 / 60), 'HP_World_Step');

    for (const item of cones) {
        const pResult = HK.HP_Body_GetPosition(item.body);
        checkResult(pResult[0], 'HP_Body_GetPosition');
        const p = pResult[1];
        if (p[1] < -20) {
            checkResult(HK.HP_Body_SetPosition(item.body, randomConePosition(true)), 'HP_Body_SetPosition reset');
            checkResult(HK.HP_Body_SetOrientation(item.body, randomConeQuaternion()), 'HP_Body_SetOrientation reset');
            checkResult(HK.HP_Body_SetLinearVelocity(item.body, [0, 0, 0]), 'HP_Body_SetLinearVelocity reset');
            checkResult(HK.HP_Body_SetAngularVelocity(item.body, [0, 0, 0]), 'HP_Body_SetAngularVelocity reset');
        }
    }

    const t = timeMs * 0.001;
    const eye = vec3.fromValues(Math.sin(t * 0.2) * 24, 12, Math.cos(t * 0.2) * 24);
    mat4.lookAt(view, eye, [0, 3, 0], [0, 1, 0]);
    mat4.perspective(projection, Math.PI / 4, canvas.width / canvas.height, 0.1, 150);
    mat4.multiply(viewProj, projection, view);

    gl.clearColor(0.97, 0.97, 0.98, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.useProgram(program);
    gl.uniformMatrix4fv(uniforms.viewProj, false, viewProj);
    gl.uniform3f(uniforms.lightDir, 0.6, 0.9, 0.4);
    gl.uniform1f(uniforms.alpha, 1.0);

    mat4.fromRotationTranslationScale(model, quat.create(), ground.pos, ground.size);
    drawMesh(cubeMesh, whiteTexture, [0.22, 0.22, 0.24], model);

    for (const item of cones) {
        const pResult = HK.HP_Body_GetPosition(item.body);
        checkResult(pResult[0], 'HP_Body_GetPosition render');
        const qResult = HK.HP_Body_GetOrientation(item.body);
        checkResult(qResult[0], 'HP_Body_GetOrientation render');
        const p = pResult[1];
        const q = qResult[1];
        const rotation = quat.fromValues(q[0], q[1], q[2], q[3]);
        const s = vec3.fromValues(item.radius, item.height, item.radius);
        const tr = vec3.fromValues(p[0], p[1], p[2]);
        mat4.fromRotationTranslationScale(model, rotation, tr, s);
        drawMesh(coneMesh, coneTexture, [1, 1, 1], model);
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

    drawPhysicsDebug();

    gl.depthMask(true);
    gl.disable(gl.BLEND);

    requestAnimationFrame(render);
}

async function main() {
    canvas = document.getElementById('c');
    gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!gl) throw new Error('WebGL 1.0 is not supported.');

    resize();
    window.addEventListener('resize', resize);

    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);

    program = createProgram(
        gl,
        document.getElementById('vs').textContent,
        document.getElementById('fs').textContent
    );
    lineProgram = createProgram(
        gl,
        document.getElementById('vs-line').textContent,
        document.getElementById('fs-line').textContent
    );
    gl.useProgram(program);

    attribs = {
        position: gl.getAttribLocation(program, 'aPosition'),
        normal: gl.getAttribLocation(program, 'aNormal'),
        uv: gl.getAttribLocation(program, 'aTexCoord')
    };
    uniforms = {
        viewProj: gl.getUniformLocation(program, 'uViewProj'),
        model: gl.getUniformLocation(program, 'uModel'),
        texture: gl.getUniformLocation(program, 'uTexture'),
        tint: gl.getUniformLocation(program, 'uTint'),
        lightDir: gl.getUniformLocation(program, 'uLightDir'),
        alpha: gl.getUniformLocation(program, 'uAlpha')
    };
    lineAttribs = {
        position: gl.getAttribLocation(lineProgram, 'aPosition')
    };
    lineUniforms = {
        viewProj: gl.getUniformLocation(lineProgram, 'uViewProj'),
        model: gl.getUniformLocation(lineProgram, 'uModel'),
        color: gl.getUniformLocation(lineProgram, 'uColor')
    };
    gl.uniform1i(uniforms.texture, 0);

    coneMesh = createMeshBuffers(generateConeMesh(40));
    cubeMesh = createMeshBuffers(generateCubeMesh());
    debugBoxMesh = createDebugWireframeBoxMesh();
    debugConeMesh = createDebugWireframeConeMesh(CONE_HULL_SEGMENTS);

    coneTexture = await loadTexture(CONE_TEXTURE);
    whiteTexture = createSolidTexture(255, 255, 255, 255);

    HK = await HavokPhysics();
    initPhysics();
    requestAnimationFrame(render);
}

main().catch((err) => {
    console.error(err);
});
