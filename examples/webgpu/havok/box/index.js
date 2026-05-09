const HAVOK_WASM_URL = 'https://cx20.github.io/gltf-test/libs/babylonjs/dev/HavokPhysics.wasm';
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
    '.rrrrrrrbrrrb..n',
    'pprrrrrrbbbbb..n',
    'ppp.bbrbbybbybnn',
    '.p.nbbbbbbbbbbnn',
    '..nnnbbbbbbbbbnn',
    '.nnnbbbbbbb.....',
    '.n..bbbb........'
];

const BOX_SIZE = 1;
const BOX_COUNT = DOT_ROWS.length * DOT_ROWS[0].length;
const IDENTITY_QUATERNION = [0, 0, 0, 1];

const LINE_ALIGN = 256;
const LINE_STRUCT_SIZE = 144;
const NUM_LINE_OBJECTS = BOX_COUNT + 1;

const GROUND_TEXTURE_FILE = '../../../../assets/textures/grass.jpg';
const GROUND_UV_REPEAT = 6;

const canvas = document.getElementById('c');

let HK;
let worldId;

let device;
let context;
let format;
let pipeline;
let sampler;
let depthTexture;
let whiteTextureView;
let groundTextureView;

let cubeMesh;
let groundMesh;

let linePipeline;
let showWireframe = true;
let debugBoxVertexBuffer;
let debugBoxIndexBuffer;
let debugBoxIndexCount = 0;
let lineUniformBuffer;
let lineBindGroup;
let lineUniformData;

const boxBodyIds = [];
const boxTints = [];
let groundRenderItem;
let boxRenderItems = [];

const viewProj = mat4.create();
const projection = mat4.create();
const view = mat4.create();
const model = mat4.create();

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

function getTintColor(code) {
    const map = {
        '.': [0xDC / 255, 0xAA / 255, 0x6B / 255],
        'p': [1.0, 0xCC / 255, 0xCC / 255],
        'n': [0x80 / 255, 0.0, 0.0],
        'r': [1.0, 0.0, 0.0],
        'y': [1.0, 1.0, 0.0],
        'b': [0.0, 0.0, 1.0]
    };
    return map[code] || [1, 1, 1];
}

function createBoxGeometry() {
    return {
        positions: new Float32Array([
            -0.5, -0.5,  0.5,   0.5, -0.5,  0.5,   0.5,  0.5,  0.5,
            -0.5, -0.5,  0.5,   0.5,  0.5,  0.5,  -0.5,  0.5,  0.5,

             0.5, -0.5, -0.5,  -0.5, -0.5, -0.5,  -0.5,  0.5, -0.5,
             0.5, -0.5, -0.5,  -0.5,  0.5, -0.5,   0.5,  0.5, -0.5,

            -0.5, -0.5, -0.5,  -0.5, -0.5,  0.5,  -0.5,  0.5,  0.5,
            -0.5, -0.5, -0.5,  -0.5,  0.5,  0.5,  -0.5,  0.5, -0.5,

             0.5, -0.5,  0.5,   0.5, -0.5, -0.5,   0.5,  0.5, -0.5,
             0.5, -0.5,  0.5,   0.5,  0.5, -0.5,   0.5,  0.5,  0.5,

            -0.5,  0.5,  0.5,   0.5,  0.5,  0.5,   0.5,  0.5, -0.5,
            -0.5,  0.5,  0.5,   0.5,  0.5, -0.5,  -0.5,  0.5, -0.5,

            -0.5, -0.5, -0.5,   0.5, -0.5, -0.5,   0.5, -0.5,  0.5,
            -0.5, -0.5, -0.5,   0.5, -0.5,  0.5,  -0.5, -0.5,  0.5
        ]),
        normals: new Float32Array([
             0,  0,  1,   0,  0,  1,   0,  0,  1,
             0,  0,  1,   0,  0,  1,   0,  0,  1,

             0,  0, -1,   0,  0, -1,   0,  0, -1,
             0,  0, -1,   0,  0, -1,   0,  0, -1,

            -1,  0,  0,  -1,  0,  0,  -1,  0,  0,
            -1,  0,  0,  -1,  0,  0,  -1,  0,  0,

             1,  0,  0,   1,  0,  0,   1,  0,  0,
             1,  0,  0,   1,  0,  0,   1,  0,  0,

             0,  1,  0,   0,  1,  0,   0,  1,  0,
             0,  1,  0,   0,  1,  0,   0,  1,  0,

             0, -1,  0,   0, -1,  0,   0, -1,  0,
             0, -1,  0,   0, -1,  0,   0, -1,  0
        ]),
        uvs: new Float32Array([
            0, 0, 1, 0, 1, 1,
            0, 0, 1, 1, 0, 1,

            0, 0, 1, 0, 1, 1,
            0, 0, 1, 1, 0, 1,

            0, 0, 1, 0, 1, 1,
            0, 0, 1, 1, 0, 1,

            0, 0, 1, 0, 1, 1,
            0, 0, 1, 1, 0, 1,

            0, 0, 1, 0, 1, 1,
            0, 0, 1, 1, 0, 1,

            0, 0, 1, 0, 1, 1,
            0, 0, 1, 1, 0, 1
        ])
    };
}

function createGroundPlaneData(repeat) {
    return {
        positions: new Float32Array([
            -0.5, 0.0, -0.5,
             0.5, 0.0, -0.5,
             0.5, 0.0,  0.5,
            -0.5, 0.0, -0.5,
             0.5, 0.0,  0.5,
            -0.5, 0.0,  0.5
        ]),
        normals: new Float32Array([
            0, 1, 0,
            0, 1, 0,
            0, 1, 0,
            0, 1, 0,
            0, 1, 0,
            0, 1, 0
        ]),
        uvs: new Float32Array([
            0, 0,
            repeat, 0,
            repeat, repeat,
            0, 0,
            repeat, repeat,
            0, repeat
        ])
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
        vertexCount: data.positions.length / 3
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

function setLineSlot(slotIndex, vpMatrix, modelMat, r, g, b, a) {
    const base = slotIndex * (LINE_ALIGN / 4);
    lineUniformData.set(vpMatrix, base);
    lineUniformData.set(modelMat, base + 16);
    lineUniformData[base + 32] = r;
    lineUniformData[base + 33] = g;
    lineUniformData[base + 34] = b;
    lineUniformData[base + 35] = a;
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
    createBody(groundShapeResult[1], HK.MotionType.STATIC, [0, -2, 0], IDENTITY_QUATERNION, false);

    const boxShapeResult = HK.HP_Shape_CreateBox([0, 0, 0], IDENTITY_QUATERNION, [BOX_SIZE, BOX_SIZE, BOX_SIZE]);
    checkResult(boxShapeResult[0], 'HP_Shape_CreateBox (box)');
    const boxShapeId = boxShapeResult[1];
    checkResult(HK.HP_Shape_SetDensity(boxShapeId, 1), 'HP_Shape_SetDensity');

    for (let y = 0; y < DOT_ROWS.length; y++) {
        const row = DOT_ROWS[y];
        for (let x = 0; x < row.length; x++) {
            const bodyId = createBody(
                boxShapeId,
                HK.MotionType.DYNAMIC,
                [
                    -12 + x * BOX_SIZE * 1.5 + Math.random() * 0.1,
                    (DOT_ROWS.length - 1 - y) * BOX_SIZE * 1.2 + Math.random() * 0.1,
                    Math.random() * 0.1
                ],
                IDENTITY_QUATERNION,
                true
            );

            boxBodyIds.push(bodyId);
            boxTints.push(getTintColor(row[x]));
        }
    }
}

function initRenderItems() {
    groundRenderItem = createRenderItem(groundTextureView);
    boxRenderItems = boxBodyIds.map(() => createRenderItem(whiteTextureView));
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

function render(timeMs) {
    checkResult(HK.HP_World_Step(worldId, 1 / 60), 'HP_World_Step');

    const t = timeMs * 0.001;
    const eye = [Math.sin(t * 0.2) * 24, 12, Math.cos(t * 0.2) * 24];
    mat4.lookAt(view, eye, [0, 8, 0], [0, 1, 0]);
    mat4.perspective(projection, Math.PI / 4, canvas.width / canvas.height, 0.1, 150);
    mat4.multiply(viewProj, projection, view);

    mat4.fromRotationTranslationScale(model, IDENTITY_QUATERNION, [0, -2, 0], [30, 0.4, 30]);
    setLineSlot(0, viewProj, model, 0, 1, 0, 1);
    for (let i = 0; i < BOX_COUNT; i++) {
        const posR = HK.HP_Body_GetPosition(boxBodyIds[i]);
        const rotR = HK.HP_Body_GetOrientation(boxBodyIds[i]);
        mat4.fromRotationTranslationScale(model, rotR[1], posR[1], [BOX_SIZE, BOX_SIZE, BOX_SIZE]);
        setLineSlot(i + 1, viewProj, model, 1, 1, 0, 1);
    }
    device.queue.writeBuffer(lineUniformBuffer, 0, lineUniformData);

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

    mat4.fromRotationTranslationScale(model, IDENTITY_QUATERNION, [0, -2, 0], [30, 0.4, 30]);
    writeUniforms(groundRenderItem.uniformBuffer, [1, 1, 1, 1]);
    drawMesh(pass, groundMesh, groundRenderItem.bindGroup);

    for (let i = 0; i < BOX_COUNT; i++) {
        const posResult = HK.HP_Body_GetPosition(boxBodyIds[i]);
        checkResult(posResult[0], 'HP_Body_GetPosition draw');
        const rotResult = HK.HP_Body_GetOrientation(boxBodyIds[i]);
        checkResult(rotResult[0], 'HP_Body_GetOrientation draw');

        mat4.fromRotationTranslationScale(model, rotResult[1], posResult[1], [BOX_SIZE, BOX_SIZE, BOX_SIZE]);
        writeUniforms(boxRenderItems[i].uniformBuffer, [boxTints[i][0], boxTints[i][1], boxTints[i][2], 1]);
        drawMesh(pass, cubeMesh, boxRenderItems[i].bindGroup);
    }

    if (showWireframe) {
pass.setPipeline(linePipeline);
    pass.setVertexBuffer(0, debugBoxVertexBuffer);
    pass.setIndexBuffer(debugBoxIndexBuffer, 'uint16');
    for (let i = 0; i < NUM_LINE_OBJECTS; i++) {
        pass.setBindGroup(0, lineBindGroup, [i * LINE_ALIGN]);
        pass.drawIndexed(debugBoxIndexCount);
    }

    }

    pass.end();
    device.queue.submit([encoder.finish()]);

    requestAnimationFrame(render);
}

async function init() {
    if (!navigator.gpu) {
        throw new Error('WebGPU is not supported in this browser.');
    }

    HK = await HavokPhysics({
        locateFile: function (path) {
            if (path && path.endsWith('.wasm')) {
                return HAVOK_WASM_URL;
            }
            return path;
        }
    });

    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
        throw new Error('Failed to get GPU adapter.');
    }

    device = await adapter.requestDevice();
    context = canvas.getContext('webgpu');
    format = navigator.gpu.getPreferredCanvasFormat();

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

    sampler = device.createSampler({
        addressModeU: 'repeat',
        addressModeV: 'repeat',
        magFilter: 'linear',
        minFilter: 'linear',
        mipmapFilter: 'nearest'
    });

    cubeMesh = createMesh(createBoxGeometry());
    groundMesh = createMesh(createGroundPlaneData(GROUND_UV_REPEAT));

    whiteTextureView = createSolidTextureView(255, 255, 255, 255);
    const groundTexture = await loadTexture(GROUND_TEXTURE_FILE);
    groundTextureView = groundTexture.createView();

    resize();
    window.addEventListener('resize', resize);

    window.addEventListener('keydown', event => {
        if (event.key.toLowerCase() !== 'w' || event.repeat) return;
        showWireframe = !showWireframe;
        const hint = document.getElementById('hint');
        if (hint) hint.textContent = 'W: wireframe ' + (showWireframe ? 'ON' : 'OFF');
    });


    initPhysics();
    initRenderItems();

    const vsLine = device.createShaderModule({ code: document.getElementById('vs-line').textContent });
    const fsLine = device.createShaderModule({ code: document.getElementById('fs-line').textContent });

    const lineBGL = device.createBindGroupLayout({
        entries: [{
            binding: 0,
            visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
            buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: LINE_STRUCT_SIZE }
        }]
    });

    linePipeline = device.createRenderPipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [lineBGL] }),
        vertex: {
            module: vsLine,
            entryPoint: 'main',
            buffers: [{ arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] }]
        },
        fragment: { module: fsLine, entryPoint: 'main', targets: [{ format }] },
        primitive: { topology: 'line-list' },
        depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less-equal' }
    });

    const boxLineVerts = new Float32Array([
        -0.5, -0.5, -0.5,   0.5, -0.5, -0.5,   0.5,  0.5, -0.5,  -0.5,  0.5, -0.5,
        -0.5, -0.5,  0.5,   0.5, -0.5,  0.5,   0.5,  0.5,  0.5,  -0.5,  0.5,  0.5
    ]);
    const boxLineIndices = new Uint16Array([
        0,1, 1,2, 2,3, 3,0,
        4,5, 5,6, 6,7, 7,4,
        0,4, 1,5, 2,6, 3,7
    ]);
    debugBoxIndexCount = boxLineIndices.length;

    debugBoxVertexBuffer = device.createBuffer({ size: boxLineVerts.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(debugBoxVertexBuffer, 0, boxLineVerts);
    debugBoxIndexBuffer = device.createBuffer({ size: boxLineIndices.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(debugBoxIndexBuffer, 0, boxLineIndices);

    lineUniformBuffer = device.createBuffer({ size: NUM_LINE_OBJECTS * LINE_ALIGN, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    lineUniformData = new Float32Array(NUM_LINE_OBJECTS * LINE_ALIGN / 4);
    lineBindGroup = device.createBindGroup({
        layout: lineBGL,
        entries: [{ binding: 0, resource: { buffer: lineUniformBuffer, size: LINE_STRUCT_SIZE } }]
    });

    requestAnimationFrame(render);
}

init().catch((err) => {
    console.error(err);
});
