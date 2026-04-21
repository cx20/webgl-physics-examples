const { mat4, vec3, quat } = glMatrix;

const CONE_COUNT = 160;
const BASKET_HALF = 3.0;
const WALL_RENDER_Y_OFFSET = 0.03;
const CONE_TEXTURE = '../../../../assets/textures/carrot.jpg';
const CONE_HULL_SEGMENTS = 16;

let canvas;
let device;
let context;
let format;
let pipeline;
let sampler;
let coneTextureView;
let whiteTextureView;
let staticRenderItems = [];
let coneRenderItems = [];
let depthTexture;

let coneMesh;
let cubeMesh;

const IDENTITY_QUATERNION = [0, 0, 0, 1];

let HK;
let worldId;
let cones = [];
let ground;
let basketWalls = [];
const coneShapeCache = new Map();

const viewProj = mat4.create();
const projection = mat4.create();
const view = mat4.create();
const model = mat4.create();
const rotationIdentity = quat.create();

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

function createVertexBuffer(data) {
    const buffer = device.createBuffer({
        size: data.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
    });
    device.queue.writeBuffer(buffer, 0, data);
    return buffer;
}

function createMesh(data) {
    return {
        positionBuffer: createVertexBuffer(data.positions),
        normalBuffer: createVertexBuffer(data.normals),
        uvBuffer: createVertexBuffer(data.uvs),
        vertexCount: data.vertexCount
    };
}

async function loadTexture(url) {
    const response = await fetch(url);
    const blob = await response.blob();
    const imageBitmap = await createImageBitmap(blob);

    const texture = device.createTexture({
        size: [imageBitmap.width, imageBitmap.height, 1],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
    });

    device.queue.copyExternalImageToTexture(
        { source: imageBitmap },
        { texture },
        [imageBitmap.width, imageBitmap.height]
    );

    return texture;
}

function createSolidTextureView(r, g, b, a) {
    const texture = device.createTexture({
        size: [1, 1, 1],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
    });
    device.queue.writeTexture(
        { texture },
        new Uint8Array([r, g, b, a]),
        { bytesPerRow: 4 },
        [1, 1, 1]
    );
    return texture.createView();
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
    const byteSize = numVertices * 3 * 4;
    const ptr = HK._malloc(byteSize);
    const verts = new Float32Array(HK.HEAPF32.buffer, ptr, numVertices * 3);
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

function createDepthTexture() {
    depthTexture = device.createTexture({
        size: { width: canvas.width, height: canvas.height, depthOrArrayLayers: 1 },
        format: 'depth24plus',
        usage: GPUTextureUsage.RENDER_ATTACHMENT
    });
}

function resize() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';
    context.configure({ device, format, alphaMode: 'opaque' });
    createDepthTexture();
}

function createRenderItem(textureView) {
    const uniformBuffer = device.createBuffer({
        size: 144,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: uniformBuffer } },
            { binding: 1, resource: sampler },
            { binding: 2, resource: textureView }
        ]
    });

    return { uniformBuffer, bindGroup };
}

function initRenderItems() {
    staticRenderItems = [
        createRenderItem(whiteTextureView),
        ...basketWalls.map(() => createRenderItem(whiteTextureView))
    ];
    coneRenderItems = cones.map(() => createRenderItem(coneTextureView));
}

function writeUniforms(uniformBuffer, tint) {
    device.queue.writeBuffer(uniformBuffer, 0, viewProj);
    device.queue.writeBuffer(uniformBuffer, 64, model);
    device.queue.writeBuffer(uniformBuffer, 128, new Float32Array(tint));
}

function drawMesh(pass, mesh, bindGroup) {
    pass.setVertexBuffer(0, mesh.positionBuffer);
    pass.setVertexBuffer(1, mesh.normalBuffer);
    pass.setVertexBuffer(2, mesh.uvBuffer);
    pass.setBindGroup(0, bindGroup);
    pass.draw(mesh.vertexCount, 1, 0, 0);
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

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
        colorAttachments: [{
            view: context.getCurrentTexture().createView(),
            clearValue: { r: 0.97, g: 0.97, b: 0.98, a: 1.0 },
            loadOp: 'clear',
            storeOp: 'store'
        }],
        depthStencilAttachment: {
            view: depthTexture.createView(),
            depthClearValue: 1.0,
            depthLoadOp: 'clear',
            depthStoreOp: 'store'
        }
    });

    pass.setPipeline(pipeline);

    mat4.fromRotationTranslationScale(model, rotationIdentity, ground.pos, ground.size);
    writeUniforms(staticRenderItems[0].uniformBuffer, [0.22, 0.22, 0.24, 1.0]);
    drawMesh(pass, cubeMesh, staticRenderItems[0].bindGroup);

    for (let i = 0; i < cones.length; i++) {
        const item = cones[i];
        const renderItem = coneRenderItems[i];
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
        writeUniforms(renderItem.uniformBuffer, [1, 1, 1, 1.0]);
        drawMesh(pass, coneMesh, renderItem.bindGroup);
    }

    for (let i = 0; i < basketWalls.length; i++) {
        const wall = basketWalls[i];
        const renderItem = staticRenderItems[i + 1];
        const wallPos = [wall.pos[0], wall.pos[1] + WALL_RENDER_Y_OFFSET, wall.pos[2]];
        mat4.fromRotationTranslationScale(model, rotationIdentity, wallPos, wall.size);
        writeUniforms(renderItem.uniformBuffer, [0.25, 0.28, 0.3, 0.28]);
        drawMesh(pass, cubeMesh, renderItem.bindGroup);
    }

    pass.end();
    device.queue.submit([encoder.finish()]);

    requestAnimationFrame(render);
}

async function main() {
    canvas = document.getElementById('c');

    if (!navigator.gpu) {
        throw new Error('WebGPU is not supported in this browser.');
    }

    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
        throw new Error('Failed to get GPU adapter.');
    }

    device = await adapter.requestDevice();
    context = canvas.getContext('webgpu');
    format = navigator.gpu.getPreferredCanvasFormat();

    coneMesh = createMesh(generateConeMesh(56));
    cubeMesh = createMesh(generateCubeMesh());

    const vs = device.createShaderModule({ code: document.getElementById('vs').textContent });
    const fs = device.createShaderModule({ code: document.getElementById('fs').textContent });

    pipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: {
            module: vs,
            entryPoint: 'main',
            buffers: [
                { arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] },
                { arrayStride: 12, attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x3' }] },
                { arrayStride: 8, attributes: [{ shaderLocation: 2, offset: 0, format: 'float32x2' }] }
            ]
        },
        fragment: {
            module: fs,
            entryPoint: 'main',
            targets: [{
                format,
                blend: {
                    color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
                    alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }
                }
            }]
        },
        primitive: {
            topology: 'triangle-list',
            cullMode: 'none'
        },
        depthStencil: {
            format: 'depth24plus',
            depthWriteEnabled: true,
            depthCompare: 'less'
        }
    });

    sampler = device.createSampler({
        magFilter: 'linear',
        minFilter: 'linear',
        mipmapFilter: 'linear'
    });

    const coneTexture = await loadTexture(CONE_TEXTURE);
    coneTextureView = coneTexture.createView();
    whiteTextureView = createSolidTextureView(255, 255, 255, 255);

    resize();
    window.addEventListener('resize', resize);

    HK = await HavokPhysics();
    initPhysics();
    initRenderItems();
    requestAnimationFrame(render);
}

main().catch((err) => {
    console.error(err);
});
