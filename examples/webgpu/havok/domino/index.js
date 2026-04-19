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

const vertexShaderWGSL = document.getElementById('vs').textContent;
const fragmentShaderWGSL = document.getElementById('fs').textContent;

const canvas = document.getElementById('c');

const IDENTITY_QUATERNION = [0, 0, 0, 1];
const DOMINO_COUNT = 256;
const DOMINO_W = 2;
const DOMINO_H = 4;
const DOMINO_D = 0.6;

// Uniform buffer layout: viewProjection(64) + model(64) + color(12) + pad(4) = 144 bytes
const UNIFORM_BUFFER_SIZE = 144;

let HK;
let worldId;
const dominoBodyIds = [];
const dominoColors = [];

let device;
let context;
let format;
let pipeline;
let depthTexture;

let vertexBuffer;
let normalBuffer;
let indexBuffer;
let indexCount = 0;

let groundUniformBuffer;
let groundBindGroup;
const dominoUniformBuffers = [];
const dominoBindGroups = [];

const projectionMatrix = mat4.create();
const viewMatrix = mat4.create();
const modelMatrix = mat4.create();
const viewProjectionMatrix = mat4.create();

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

function resize() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';

    context.configure({
        device,
        format,
        alphaMode: 'opaque'
    });

    depthTexture = device.createTexture({
        size: { width: canvas.width, height: canvas.height, depthOrArrayLayers: 1 },
        format: 'depth24plus',
        usage: GPUTextureUsage.RENDER_ATTACHMENT
    });
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

    vertexBuffer = device.createBuffer({
        size: positions.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
    });
    device.queue.writeBuffer(vertexBuffer, 0, positions);

    normalBuffer = device.createBuffer({
        size: normals.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
    });
    device.queue.writeBuffer(normalBuffer, 0, normals);

    indexBuffer = device.createBuffer({
        size: indices.byteLength,
        usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST
    });
    device.queue.writeBuffer(indexBuffer, 0, indices);

    indexCount = indices.length;
}

function createUniformBuffer() {
    return device.createBuffer({
        size: UNIFORM_BUFFER_SIZE,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
}

function createBindGroupForBuffer(uniformBuffer) {
    return device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: uniformBuffer } }
        ]
    });
}

function writeUniformData(uniformBuffer, position, rotation, scale, color) {
    mat4.fromRotationTranslationScale(modelMatrix, rotation, position, scale);

    const data = new Float32Array(UNIFORM_BUFFER_SIZE / 4);
    data.set(viewProjectionMatrix, 0);   // offset 0:  16 floats (64 bytes)
    data.set(modelMatrix, 16);           // offset 16: 16 floats (64 bytes)
    data[32] = color[0];                 // offset 32: r
    data[33] = color[1];                 // offset 33: g
    data[34] = color[2];                 // offset 34: b
    // data[35] = 0 (padding)
    device.queue.writeBuffer(uniformBuffer, 0, data);
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
    const groundShapeResult = HK.HP_Shape_CreateBox([0, 0, 0], IDENTITY_QUATERNION, [100, 0.2, 100]);
    checkResult(groundShapeResult[0], 'HP_Shape_CreateBox (ground)');
    createBody(groundShapeResult[1], HK.MotionType.STATIC, [0, -0.1, 0], IDENTITY_QUATERNION, false);

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
        const y = DOMINO_H / 2;
        const z = (8 - (i % 16)) * 3;

        // First piece in each column (i % 16 === 0) is tilted to trigger the chain
        const rotation = (i % 16 === 0) ? triggerRotation : IDENTITY_QUATERNION;

        const bodyId = createBody(dominoShapeId, HK.MotionType.DYNAMIC, [x, y, z], rotation, true);
        dominoBodyIds.push(bodyId);
        dominoColors.push(getRgbColor(dataSet[i]));
    }
}

function render(timeMs) {
    checkResult(HK.HP_World_Step(worldId, 1 / 60), 'HP_World_Step');

    const t = timeMs * 0.001;
    const eye = [Math.sin(t * 0.1) * 80, 50, Math.cos(t * 0.1) * 80];

    mat4.perspective(projectionMatrix, Math.PI / 4, canvas.width / canvas.height, 0.1, 300.0);
    mat4.lookAt(viewMatrix, eye, [0, 0, 0], [0, 1, 0]);
    mat4.multiply(viewProjectionMatrix, projectionMatrix, viewMatrix);

    // Update ground uniform
    writeUniformData(groundUniformBuffer, [0, -0.1, 0], IDENTITY_QUATERNION, [100, 0.2, 100], [0.5, 0.45, 0.4]);

    // Update domino uniforms
    for (let i = 0; i < DOMINO_COUNT; i++) {
        const posResult = HK.HP_Body_GetPosition(dominoBodyIds[i]);
        checkResult(posResult[0], 'HP_Body_GetPosition');
        const rotResult = HK.HP_Body_GetOrientation(dominoBodyIds[i]);
        checkResult(rotResult[0], 'HP_Body_GetOrientation');
        writeUniformData(dominoUniformBuffers[i], posResult[1], rotResult[1], [DOMINO_W, DOMINO_H, DOMINO_D], dominoColors[i]);
    }

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
        colorAttachments: [{
            view: context.getCurrentTexture().createView(),
            clearValue: { r: 0.05, g: 0.05, b: 0.1, a: 1 },
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
    pass.setVertexBuffer(0, vertexBuffer);
    pass.setVertexBuffer(1, normalBuffer);
    pass.setIndexBuffer(indexBuffer, 'uint16');

    // Draw ground
    pass.setBindGroup(0, groundBindGroup);
    pass.drawIndexed(indexCount, 1, 0, 0, 0);

    // Draw dominos
    for (let i = 0; i < DOMINO_COUNT; i++) {
        pass.setBindGroup(0, dominoBindGroups[i]);
        pass.drawIndexed(indexCount, 1, 0, 0, 0);
    }

    pass.end();
    device.queue.submit([encoder.finish()]);

    requestAnimationFrame(render);
}

async function init() {
    if (!navigator.gpu) {
        throw new Error('WebGPU is not supported in this browser.');
    }

    HK = await HavokPhysics();

    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
        throw new Error('Failed to get GPU adapter.');
    }

    device = await adapter.requestDevice();
    context = canvas.getContext('webgpu');
    format = navigator.gpu.getPreferredCanvasFormat();

    const vs = device.createShaderModule({ code: vertexShaderWGSL });
    const fs = device.createShaderModule({ code: fragmentShaderWGSL });

    pipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: {
            module: vs,
            entryPoint: 'main',
            buffers: [
                { arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] },
                { arrayStride: 12, attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x3' }] }
            ]
        },
        fragment: {
            module: fs,
            entryPoint: 'main',
            targets: [{ format }]
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

    createBoxGeometry();

    // Create ground uniform buffer and bind group
    groundUniformBuffer = createUniformBuffer();
    groundBindGroup = createBindGroupForBuffer(groundUniformBuffer);

    // Create domino uniform buffers and bind groups
    for (let i = 0; i < DOMINO_COUNT; i++) {
        const buf = createUniformBuffer();
        dominoUniformBuffers.push(buf);
        dominoBindGroups.push(createBindGroupForBuffer(buf));
    }

    resize();
    window.addEventListener('resize', resize);

    initPhysics();

    requestAnimationFrame(render);
}

init().catch((err) => {
    console.error(err);
});
