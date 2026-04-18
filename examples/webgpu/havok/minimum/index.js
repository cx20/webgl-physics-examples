const vertexShaderWGSL = document.getElementById('vs').textContent;
const fragmentShaderWGSL = document.getElementById('fs').textContent;

const canvas = document.getElementById('c');
const IDENTITY_QUATERNION = [0, 0, 0, 1];

let HK;
let worldId;
let cubeBodyId;

let device;
let context;
let format;
let pipeline;
let depthTexture;

let vertexBuffer;
let uvBuffer;
let indexBuffer;
let indexCount = 0;

let textureView;
let sampler;

let groundUniformBuffer;
let cubeUniformBuffer;
let groundBindGroup;
let cubeBindGroup;

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

    vertexBuffer = device.createBuffer({
        size: positions.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
    });
    device.queue.writeBuffer(vertexBuffer, 0, positions);

    uvBuffer = device.createBuffer({
        size: uvs.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
    });
    device.queue.writeBuffer(uvBuffer, 0, uvs);

    indexBuffer = device.createBuffer({
        size: indices.byteLength,
        usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST
    });
    device.queue.writeBuffer(indexBuffer, 0, indices);

    indexCount = indices.length;
}

async function createTextureFromImage(src) {
    const img = document.createElement('img');
    img.src = src;
    await img.decode();
    const imageBitmap = await createImageBitmap(img);

    const texture = device.createTexture({
        size: [imageBitmap.width, imageBitmap.height, 1],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
    });

    device.queue.copyExternalImageToTexture(
        { source: imageBitmap },
        { texture },
        [imageBitmap.width, imageBitmap.height, 1]
    );

    return texture;
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

    const tiltHalf = Math.PI / 18;
    cubeBodyId = createBody(
        cubeShapeId,
        HK.MotionType.DYNAMIC,
        [0, 12, 0],
        [Math.sin(tiltHalf), 0, Math.sin(tiltHalf), Math.cos(tiltHalf)],
        true
    );
}

function createModelUniformData(position, rotation, scale) {
    mat4.fromRotationTranslationScale(modelMatrix, rotation, position, scale);
    const data = new Float32Array(32);
    data.set(viewProjectionMatrix, 0);
    data.set(modelMatrix, 16);
    return data;
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
    mat4.multiply(viewProjectionMatrix, projectionMatrix, viewMatrix);

    const groundData = createModelUniformData([0, -2.5, 0], IDENTITY_QUATERNION, [20, 1, 20]);
    device.queue.writeBuffer(groundUniformBuffer, 0, groundData);

    const cubePositionResult = HK.HP_Body_GetPosition(cubeBodyId);
    checkResult(cubePositionResult[0], 'HP_Body_GetPosition draw');
    const cubeRotationResult = HK.HP_Body_GetOrientation(cubeBodyId);
    checkResult(cubeRotationResult[0], 'HP_Body_GetOrientation draw');

    const cubeData = createModelUniformData(cubePositionResult[1], cubeRotationResult[1], [5, 5, 5]);
    device.queue.writeBuffer(cubeUniformBuffer, 0, cubeData);

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
        colorAttachments: [{
            view: context.getCurrentTexture().createView(),
            clearValue: { r: 1, g: 1, b: 1, a: 1 },
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
    pass.setVertexBuffer(1, uvBuffer);
    pass.setIndexBuffer(indexBuffer, 'uint16');

    pass.setBindGroup(0, groundBindGroup);
    pass.drawIndexed(indexCount, 1, 0, 0, 0);

    pass.setBindGroup(0, cubeBindGroup);
    pass.drawIndexed(indexCount, 1, 0, 0, 0);

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
                { arrayStride: 8, attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x2' }] }
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

    const tex = await createTextureFromImage('../../../../assets/textures/frog.jpg');
    textureView = tex.createView();

    sampler = device.createSampler({
        magFilter: 'linear',
        minFilter: 'linear'
    });

    groundUniformBuffer = device.createBuffer({
        size: 128,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    cubeUniformBuffer = device.createBuffer({
        size: 128,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });

    groundBindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: groundUniformBuffer } },
            { binding: 1, resource: sampler },
            { binding: 2, resource: textureView }
        ]
    });

    cubeBindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: cubeUniformBuffer } },
            { binding: 1, resource: sampler },
            { binding: 2, resource: textureView }
        ]
    });

    resize();
    window.addEventListener('resize', resize);

    initPhysics();

    requestAnimationFrame(render);
}

init().catch((err) => {
    console.error(err);
});
