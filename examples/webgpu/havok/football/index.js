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

// viewProj(64) + model(64) + tintAlpha(16)
const UNIFORM_SIZE = 144;

const canvas = document.getElementById('c');

let HK;
let worldId;
const ballBodyIds = [];
const ballSpawnPositions = [];
const ballTints = [];

let device;
let context;
let format;
let pipeline;
let sampler;
let depthTexture;

let sphereMesh;
let planeMesh;

let footballTextureView;
let grassTextureView;

let groundUniformBuffer;
let groundBindGroup;
let ballUniformBuffers = [];
let ballBindGroups = [];

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

    return {
        positions: new Float32Array(positions),
        normals: new Float32Array(normals),
        uvs: new Float32Array(uvs),
        indices: new Uint16Array(indices)
    };
}

function createPlaneGeometry(size, uvRepeat) {
    const hs = size * 0.5;
    return {
        positions: new Float32Array([
            -hs, 0, -hs,
             hs, 0, -hs,
             hs, 0,  hs,
            -hs, 0,  hs
        ]),
        normals: new Float32Array([
            0, 1, 0,
            0, 1, 0,
            0, 1, 0,
            0, 1, 0
        ]),
        uvs: new Float32Array([
            0, 0,
            uvRepeat, 0,
            uvRepeat, uvRepeat,
            0, uvRepeat
        ]),
        indices: new Uint16Array([0, 1, 2, 0, 2, 3])
    };
}

function createBuffer(data, usage) {
    const buffer = device.createBuffer({ size: data.byteLength, usage: usage | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(buffer, 0, data);
    return buffer;
}

function createMesh(geo) {
    return {
        positionBuffer: createBuffer(geo.positions, GPUBufferUsage.VERTEX),
        normalBuffer: createBuffer(geo.normals, GPUBufferUsage.VERTEX),
        uvBuffer: createBuffer(geo.uvs, GPUBufferUsage.VERTEX),
        indexBuffer: createBuffer(geo.indices, GPUBufferUsage.INDEX),
        indexCount: geo.indices.length
    };
}

async function loadTextureView(url) {
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

    return texture.createView();
}

function createUniformBuffer() {
    return device.createBuffer({
        size: UNIFORM_SIZE,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
}

function createBindGroup(uniformBuffer, textureView) {
    return device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: uniformBuffer } },
            { binding: 1, resource: sampler },
            { binding: 2, resource: textureView }
        ]
    });
}

function updateUniform(uniformBuffer, position, rotation, scale, tint, alpha) {
    mat4.fromRotationTranslationScale(modelMatrix, rotation, position, scale);

    const data = new Float32Array(UNIFORM_SIZE / 4);
    data.set(viewProjMatrix, 0);
    data.set(modelMatrix, 16);
    data[32] = tint[0];
    data[33] = tint[1];
    data[34] = tint[2];
    data[35] = alpha;

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

    const groundShapeResult = HK.HP_Shape_CreateBox([0, 0, 0], IDENTITY_QUATERNION, [30, 2, 30]);
    checkResult(groundShapeResult[0], 'HP_Shape_CreateBox (ground)');
    HK.HP_Shape_SetMaterial(groundShapeResult[1], [0.6, 0.6, 0.3, HK.MaterialCombine.MINIMUM, HK.MaterialCombine.MAXIMUM]);
    createBody(groundShapeResult[1], HK.MotionType.STATIC, [0, -2, 0], IDENTITY_QUATERNION, false);

    const ballShapeResult = HK.HP_Shape_CreateSphere([0, 0, 0], 0.5);
    checkResult(ballShapeResult[0], 'HP_Shape_CreateSphere (ball)');
    const ballShapeId = ballShapeResult[1];
    checkResult(HK.HP_Shape_SetDensity(ballShapeId, 1), 'HP_Shape_SetDensity');
    HK.HP_Shape_SetMaterial(ballShapeId, [0.4, 0.4, 0.75, HK.MaterialCombine.MINIMUM, HK.MaterialCombine.MAXIMUM]);

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

function resize() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';

    context.configure({ device, format, alphaMode: 'opaque' });

    depthTexture = device.createTexture({
        size: { width: canvas.width, height: canvas.height, depthOrArrayLayers: 1 },
        format: 'depth24plus',
        usage: GPUTextureUsage.RENDER_ATTACHMENT
    });
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

    updateUniform(groundUniformBuffer, [0, -2, 0], IDENTITY_QUATERNION, [1, 1, 1], [1, 1, 1], 1);

    for (let i = 0; i < BALL_COUNT; i++) {
        const posResult = HK.HP_Body_GetPosition(ballBodyIds[i]);
        checkResult(posResult[0], 'HP_Body_GetPosition draw');
        const rotResult = HK.HP_Body_GetOrientation(ballBodyIds[i]);
        checkResult(rotResult[0], 'HP_Body_GetOrientation draw');

        updateUniform(ballUniformBuffers[i], posResult[1], rotResult[1], [1, 1, 1], ballTints[i], 1);
    }

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
        colorAttachments: [{
            view: context.getCurrentTexture().createView(),
            clearValue: { r: 0.97, g: 0.97, b: 0.98, a: 1 },
            loadOp: 'clear',
            storeOp: 'store'
        }],
        depthStencilAttachment: {
            view: depthTexture.createView(),
            depthClearValue: 1,
            depthLoadOp: 'clear',
            depthStoreOp: 'store'
        }
    });

    pass.setPipeline(pipeline);

    // Ground
    pass.setVertexBuffer(0, planeMesh.positionBuffer);
    pass.setVertexBuffer(1, planeMesh.normalBuffer);
    pass.setVertexBuffer(2, planeMesh.uvBuffer);
    pass.setIndexBuffer(planeMesh.indexBuffer, 'uint16');
    pass.setBindGroup(0, groundBindGroup);
    pass.drawIndexed(planeMesh.indexCount, 1, 0, 0, 0);

    // Balls
    pass.setVertexBuffer(0, sphereMesh.positionBuffer);
    pass.setVertexBuffer(1, sphereMesh.normalBuffer);
    pass.setVertexBuffer(2, sphereMesh.uvBuffer);
    pass.setIndexBuffer(sphereMesh.indexBuffer, 'uint16');

    for (let i = 0; i < BALL_COUNT; i++) {
        pass.setBindGroup(0, ballBindGroups[i]);
        pass.drawIndexed(sphereMesh.indexCount, 1, 0, 0, 0);
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

    const vertexShader = device.createShaderModule({ code: document.getElementById('vs').textContent });
    const fragmentShader = device.createShaderModule({ code: document.getElementById('fs').textContent });

    pipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: {
            module: vertexShader,
            entryPoint: 'main',
            buffers: [
                { arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] },
                { arrayStride: 12, attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x3' }] },
                { arrayStride: 8, attributes: [{ shaderLocation: 2, offset: 0, format: 'float32x2' }] }
            ]
        },
        fragment: {
            module: fragmentShader,
            entryPoint: 'main',
            targets: [{ format }]
        },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        depthStencil: {
            format: 'depth24plus',
            depthWriteEnabled: true,
            depthCompare: 'less'
        }
    });

    sampler = device.createSampler({
        magFilter: 'linear',
        minFilter: 'linear',
        mipmapFilter: 'linear',
        addressModeU: 'repeat',
        addressModeV: 'repeat'
    });

    sphereMesh = createMesh(createSphereGeometry(0.5, 18, 24));
    planeMesh = createMesh(createPlaneGeometry(30, 6));

    footballTextureView = await loadTextureView(FOOTBALL_TEXTURE);
    grassTextureView = await loadTextureView(GROUND_TEXTURE);

    groundUniformBuffer = createUniformBuffer();
    groundBindGroup = createBindGroup(groundUniformBuffer, grassTextureView);

    ballUniformBuffers = [];
    ballBindGroups = [];
    for (let i = 0; i < BALL_COUNT; i++) {
        const ub = createUniformBuffer();
        ballUniformBuffers.push(ub);
        ballBindGroups.push(createBindGroup(ub, footballTextureView));
    }

    resize();
    window.addEventListener('resize', resize);

    initPhysics();

    requestAnimationFrame(render);
}

init().catch((err) => {
    console.error(err);
});
