// PHYSICS DEBUG build of the WebGPU + Havok falling-eraser sample.
//
// Identical scene/physics to ../eraser, but instead of 200 erasers it drops a few probe erasers
// from known poses and graphs their post-landing behaviour on a 2D overlay (top-right): tilt
// angle, |angVel| and height over time, read from the Havok bodies each frame. Lets the Havok
// settling be compared side by side with the WGSL eraser_debug and the other libraries.

const HAVOK_WASM_URL = 'https://cx20.github.io/gltf-test/libs/babylonjs/dev/HavokPhysics.wasm';
const vertexShaderWGSL   = document.getElementById('vs').textContent;
const fragmentShaderWGSL = document.getElementById('fs').textContent;
const groundVertWGSL     = document.getElementById('gvs').textContent;
const groundFragWGSL     = document.getElementById('gfs').textContent;

let canvas, device, ctx, pipeline;
let positionBuffer, normalBuffer, texCoordBuffer, indexBuffer, indexNum;
let offsetBuffer, rotBuffer;
let uniformBuffer, bindGroup;
let groundPipeline, groundVBuffer, groundIBuffer, groundMVPBuffer, groundBindGroup, groundICount;
let depthTexture;
const IDENTITY_QUATERNION = [0, 0, 0, 1];
let HK, worldId, bodies;
let posArray, rotArray;

const LINE_ALIGN = 256;
const LINE_STRUCT_SIZE = 144;
const ERASER_VMAT = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -40, 1]);
let currentPMatrix = null;

let linePipeline;
let showWireframe = true;
let debugBoxVertexBuffer, debugBoxIndexBuffer, debugBoxIndexCount = 0;
let lineUniformBuffer, lineBindGroup, lineUniformData, eraserLineModel = null;

const MAX = 5;   // DEBUG: a few probe erasers (restore to 200 for the normal scene)
const NUM_LINE_OBJECTS = MAX + 1;

// DEBUG: 5 erasers dropped from known poses (matches the WGSL eraser_debug), plus on-screen graphs.
const DEBUG_COLORS = ['#ff5555', '#55dd55', '#5599ff', '#ffaa33', '#ff66dd'];
const DEBUG_LABELS = ['flat x=-6', 'flat x=0', 'tilt45 x=4', 'yaw x=-3', 'tumble x=6'];
const DEBUG_SETUP = [
    { x: -6, eul: [0.0, 0.0, 0.0], w: [0, 0, 0] },   // flat, far out
    { x:  0, eul: [0.0, 0.0, 0.0], w: [0, 0, 0] },   // flat, centre (baseline)
    { x:  4, eul: [0.8, 0.0, 0.0], w: [0, 0, 0] },   // tilted ~46 deg, should tip flat
    { x: -3, eul: [0.0, 0.0, 0.0], w: [0, 4, 0] },   // flat + yaw spin
    { x:  6, eul: [0.5, 0.5, 0.5], w: [3, 3, 3] },   // full tumble, far out
];
let debugCanvas = null, debugCtx = null, debugStartTime = 0, debugPrevT = 0;
const debugSamples = Array.from({ length: MAX }, () => []);  // per eraser: {t, tilt, w, y}
const debugPrevQuat = Array.from({ length: MAX }, () => null);

function quatFromEuler(x, y, z) {
    const cx = Math.cos(x * 0.5), sx = Math.sin(x * 0.5);
    const cy = Math.cos(y * 0.5), sy = Math.sin(y * 0.5);
    const cz = Math.cos(z * 0.5), sz = Math.sin(z * 0.5);
    return [sx * cy * cz + cx * sy * sz, cx * sy * cz - sx * cy * sz, cx * cy * sz + sx * sy * cz, cx * cy * cz - sx * sy * sz];
}
// Flat eraser box (full side lengths).
const ERASER_SIZE = [2.4, 0.6, 1.2];
const EHALF = [ERASER_SIZE[0] / 2, ERASER_SIZE[1] / 2, ERASER_SIZE[2] / 2];
// Six faces of the eraser texture, mapped to a 6-column atlas (+x,-x,+y,-y,+z,-z).
const ERASER_FACE_TEXTURES = [
    '../../../../assets/textures/eraser_003/eraser_right.png',
    '../../../../assets/textures/eraser_003/eraser_left.png',
    '../../../../assets/textures/eraser_003/eraser_top.png',
    '../../../../assets/textures/eraser_003/eraser_bottom.png',
    '../../../../assets/textures/eraser_003/eraser_front.png',
    '../../../../assets/textures/eraser_003/eraser_back.png',
];

function setLineSlot(slotIndex, vpMatrix, modelMat, r, g, b, a) {
    const base = slotIndex * (LINE_ALIGN / 4);
    lineUniformData.set(vpMatrix, base);
    lineUniformData.set(modelMat, base + 16);
    lineUniformData[base + 32] = r;
    lineUniformData[base + 33] = g;
    lineUniformData[base + 34] = b;
    lineUniformData[base + 35] = a;
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
    const bodyId = HK.HP_Body_Create()[1];
    HK.HP_Body_SetShape(bodyId, shapeId);
    HK.HP_Body_SetMotionType(bodyId, motionType);
    if (setMass) {
        HK.HP_Body_SetMassProperties(bodyId, HK.HP_Shape_BuildMassProperties(shapeId)[1]);
    }
    HK.HP_Body_SetPosition(bodyId, position);
    HK.HP_Body_SetOrientation(bodyId, rotation);
    HK.HP_World_AddBody(worldId, bodyId, false);
    return bodyId;
}

// Eraser box: 24 vertices (6 faces) with per-face UVs into a 6-column atlas.
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
        for (let c = 0; c < 4; c++) {
            const [su, sv] = corners[c];
            positions.push(
                f.n[0] * EHALF[0] + f.u[0] * su * halfU + f.v[0] * sv * halfV,
                f.n[1] * EHALF[1] + f.u[1] * su * halfU + f.v[1] * sv * halfV,
                f.n[2] * EHALF[2] + f.u[2] * su * halfU + f.v[2] * sv * halfV,
            );
            normals.push(...f.n);
            uvs.push((localUV[c][0] + fi) / 6, localUV[c][1]);
        }
        indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    });
    return {
        positions: new Float32Array(positions),
        normals: new Float32Array(normals),
        uvs: new Float32Array(uvs),
        indices: new Uint16Array(indices),
    };
}

async function createEraserAtlasTexture() {
    const cell = 256;
    const images = await Promise.all(ERASER_FACE_TEXTURES.map(async (src) => {
        const img = document.createElement('img');
        img.src = src;
        await img.decode();
        return img;
    }));
    const atlas = document.createElement('canvas');
    atlas.width = cell * 6;
    atlas.height = cell;
    const c2d = atlas.getContext('2d');
    for (let i = 0; i < 6; i++) c2d.drawImage(images[i], i * cell, 0, cell, cell);
    const bitmap = await createImageBitmap(atlas);
    const tex = device.createTexture({
        size: [atlas.width, atlas.height, 1],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    device.queue.copyExternalImageToTexture({ source: bitmap }, { texture: tex }, [atlas.width, atlas.height, 1]);
    return tex;
}

async function init() {
    canvas = document.getElementById('c');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    window.addEventListener('resize', () => {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        if (depthTexture) depthTexture.destroy();
        depthTexture = createDepthTexture();
        currentPMatrix = makePerspective(45, canvas.width / canvas.height, 0.1, 1000.0);
        device.queue.writeBuffer(uniformBuffer, 0, currentPMatrix);
    });

    window.addEventListener('keydown', event => {
        const isWKey = event.code === 'KeyW' || event.key === 'w' || event.key === 'W';
        if (!isWKey || event.repeat) return;
        showWireframe = !showWireframe;
        const hint = document.getElementById('hint');
        if (hint) hint.textContent = 'W: wireframe ' + (showWireframe ? 'ON' : 'OFF');
    });

    const gpu = navigator['gpu'];
    if (!gpu) { alert('WebGPU is not supported.'); return; }
    const adapter = await gpu.requestAdapter();
    if (!adapter) { alert('Failed to get GPU adapter.'); return; }
    device = await adapter.requestDevice();

    ctx = canvas.getContext('webgpu');
    const format = gpu.getPreferredCanvasFormat();
    ctx.configure({ device, format, alphaMode: 'opaque' });

    const geo = buildEraser();
    positionBuffer = makeVertexBuffer(geo.positions);
    normalBuffer = makeVertexBuffer(geo.normals);
    texCoordBuffer = makeVertexBuffer(geo.uvs);
    indexBuffer = makeIndexBuffer(geo.indices);
    indexNum = geo.indices.length;

    posArray = new Float32Array(MAX * 3);
    rotArray = new Float32Array(MAX * 4);
    offsetBuffer = device.createBuffer({ size: MAX * 3 * 4, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    rotBuffer = device.createBuffer({ size: MAX * 4 * 4, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });

    uniformBuffer = device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    currentPMatrix = makePerspective(45, canvas.width / canvas.height, 0.1, 1000.0);
    device.queue.writeBuffer(uniformBuffer, 0, currentPMatrix);

    const eraserTexture = await createEraserAtlasTexture();
    const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });

    pipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: {
            module: device.createShaderModule({ code: vertexShaderWGSL }),
            entryPoint: 'main',
            buffers: [
                { arrayStride: 3 * 4, stepMode: 'vertex', attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] },
                { arrayStride: 3 * 4, stepMode: 'vertex', attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x3' }] },
                { arrayStride: 2 * 4, stepMode: 'vertex', attributes: [{ shaderLocation: 2, offset: 0, format: 'float32x2' }] },
                { arrayStride: 3 * 4, stepMode: 'instance', attributes: [{ shaderLocation: 3, offset: 0, format: 'float32x3' }] },
                { arrayStride: 4 * 4, stepMode: 'instance', attributes: [{ shaderLocation: 4, offset: 0, format: 'float32x4' }] },
            ],
        },
        fragment: { module: device.createShaderModule({ code: fragmentShaderWGSL }), entryPoint: 'main', targets: [{ format }] },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        depthStencil: { depthWriteEnabled: true, depthCompare: 'less', format: 'depth24plus-stencil8' },
    });

    bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: uniformBuffer } },
            { binding: 1, resource: sampler },
            { binding: 2, resource: eraserTexture.createView() },
        ],
    });

    groundPipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: {
            module: device.createShaderModule({ code: groundVertWGSL }),
            entryPoint: 'main',
            buffers: [{ arrayStride: 3 * 4, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] }],
        },
        fragment: { module: device.createShaderModule({ code: groundFragWGSL }), entryPoint: 'main', targets: [{ format }] },
        primitive: { topology: 'triangle-list' },
        depthStencil: { depthWriteEnabled: true, depthCompare: 'less', format: 'depth24plus-stencil8' },
    });

    const groundPositions = new Float32Array([
        -10, 0.05, -10, 10, 0.05, -10, 10, 0.05, 10, -10, 0.05, 10,
        -10, -0.05, -10, 10, -0.05, -10, 10, -0.05, 10, -10, -0.05, 10,
        -10, -0.05, 10, 10, -0.05, 10, 10, 0.05, 10, -10, 0.05, 10,
        -10, -0.05, -10, 10, -0.05, -10, 10, 0.05, -10, -10, 0.05, -10,
        10, -0.05, -10, 10, -0.05, 10, 10, 0.05, 10, 10, 0.05, -10,
        -10, -0.05, -10, -10, -0.05, 10, -10, 0.05, 10, -10, 0.05, -10,
    ]);
    const groundIdx = new Uint16Array([
        0, 1, 2, 0, 2, 3, 4, 7, 6, 4, 6, 5, 8, 9, 10, 8, 10, 11,
        12, 15, 14, 12, 14, 13, 16, 17, 18, 16, 18, 19, 20, 23, 22, 20, 22, 21,
    ]);
    groundICount = groundIdx.length;
    groundVBuffer = makeVertexBuffer(groundPositions);
    groundIBuffer = makeIndexBuffer(groundIdx);
    groundMVPBuffer = device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    groundBindGroup = device.createBindGroup({
        layout: groundPipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: groundMVPBuffer } }],
    });
    const vMat = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -40, 1]);
    const mMat = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, -10, 0, 1]);
    device.queue.writeBuffer(groundMVPBuffer, 0, mat4mul(mat4mul(currentPMatrix, vMat), mMat));

    depthTexture = createDepthTexture();

    HK = await HavokPhysics({
        locateFile: function (path) {
            if (path && path.endsWith('.wasm')) return HAVOK_WASM_URL;
            return path;
        }
    });
    worldId = HK.HP_World_Create()[1];
    HK.HP_World_SetGravity(worldId, [0, -9.8, 0]);
    HK.HP_World_SetIdealStepTime(worldId, 1 / 200);

    const groundShape = HK.HP_Shape_CreateBox([0, 0, 0], IDENTITY_QUATERNION, [20, 0.1, 20])[1];
    createBody(groundShape, HK.MotionType.STATIC, [0, -10, 0], IDENTITY_QUATERNION, false);

    const eraserShape = HK.HP_Shape_CreateBox([0, 0, 0], IDENTITY_QUATERNION, ERASER_SIZE)[1];
    HK.HP_Shape_SetDensity(eraserShape, 1);

    bodies = [];
    for (let i = 0; i < MAX; i++) {
        // DEBUG: deterministic pose so the post-landing settling is reproducible.
        const s = DEBUG_SETUP[i % DEBUG_SETUP.length];
        const q = quatFromEuler(s.eul[0], s.eul[1], s.eul[2]);
        bodies[i] = createBody(eraserShape, HK.MotionType.DYNAMIC, [s.x, 14, 0], q, true);
        HK.HP_Body_SetAngularVelocity(bodies[i], s.w);
    }
    debugStartTime = performance.now();

    const lineBGL = device.createBindGroupLayout({
        entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: LINE_STRUCT_SIZE } }],
    });
    linePipeline = device.createRenderPipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [lineBGL] }),
        vertex: {
            module: device.createShaderModule({ code: document.getElementById('vs-line').textContent }),
            entryPoint: 'main',
            buffers: [{ arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] }],
        },
        fragment: { module: device.createShaderModule({ code: document.getElementById('fs-line').textContent }), entryPoint: 'main', targets: [{ format }] },
        primitive: { topology: 'line-list' },
        depthStencil: { format: 'depth24plus-stencil8', depthWriteEnabled: false, depthCompare: 'less-equal' },
    });

    const boxLineVerts = new Float32Array([
        -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, -0.5,
        -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5,
    ]);
    const boxLineIndices = new Uint16Array([0, 1, 1, 2, 2, 3, 3, 0, 4, 5, 5, 6, 6, 7, 7, 4, 0, 4, 1, 5, 2, 6, 3, 7]);
    debugBoxIndexCount = boxLineIndices.length;
    debugBoxVertexBuffer = device.createBuffer({ size: boxLineVerts.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(debugBoxVertexBuffer, 0, boxLineVerts);
    debugBoxIndexBuffer = device.createBuffer({ size: boxLineIndices.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(debugBoxIndexBuffer, 0, boxLineIndices);

    lineUniformBuffer = device.createBuffer({ size: NUM_LINE_OBJECTS * LINE_ALIGN, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    lineUniformData = new Float32Array(NUM_LINE_OBJECTS * LINE_ALIGN / 4);
    lineBindGroup = device.createBindGroup({ layout: lineBGL, entries: [{ binding: 0, resource: { buffer: lineUniformBuffer, size: LINE_STRUCT_SIZE } }] });
    eraserLineModel = mat4.create();

    updateInstanceArrays();

    setInterval(function () {
        HK.HP_World_Step(worldId, 1 / 200);
        for (let i = 0; i < MAX; i++) {
            const pos = HK.HP_Body_GetPosition(bodies[i])[1];
            if (pos[1] < -15) {
                const p = genPosition();
                HK.HP_Body_SetPosition(bodies[i], [p.x, p.y, p.z]);
                HK.HP_Body_SetOrientation(bodies[i], randomQuaternion());
                HK.HP_Body_SetLinearVelocity(bodies[i], [0, 0, 0]);
                HK.HP_Body_SetAngularVelocity(bodies[i], [0, 0, 0]);
            }
        }
        updateInstanceArrays();
    }, 1000 / 200);

    requestAnimationFrame(render);
}

function randomQuaternion() {
    const q = [0, 0, 0, 1];
    const x = Math.random() * Math.PI * 2, y = Math.random() * Math.PI * 2, z = Math.random() * Math.PI * 2;
    const cx = Math.cos(x * 0.5), sx = Math.sin(x * 0.5);
    const cy = Math.cos(y * 0.5), sy = Math.sin(y * 0.5);
    const cz = Math.cos(z * 0.5), sz = Math.sin(z * 0.5);
    q[0] = sx * cy * cz + cx * sy * sz;
    q[1] = cx * sy * cz - sx * cy * sz;
    q[2] = cx * cy * sz - sx * sy * cz;
    q[3] = cx * cy * cz + sx * sy * sz;
    return q;
}

function genPosition() {
    return { x: (Math.random() - 0.5) * 12, y: (Math.random() + 1.0) * 14, z: (Math.random() - 0.5) * 12 };
}

function updateInstanceArrays() {
    let pIdx = 0, qIdx = 0;
    for (let i = 0; i < MAX; i++) {
        const p = HK.HP_Body_GetPosition(bodies[i])[1];
        posArray[pIdx++] = p[0]; posArray[pIdx++] = p[1]; posArray[pIdx++] = p[2];
        const q = HK.HP_Body_GetOrientation(bodies[i])[1];
        rotArray[qIdx++] = q[0]; rotArray[qIdx++] = q[1]; rotArray[qIdx++] = q[2]; rotArray[qIdx++] = q[3];
    }
}

function makePerspective(fovy, aspect, near, far) {
    const top = near * Math.tan(fovy * Math.PI / 360.0);
    const right = top * aspect;
    const u = right * 2, v = top * 2, ww = far - near;
    return new Float32Array([
        near * 2 / u, 0, 0, 0,
        0, near * 2 / v, 0, 0,
        0, 0, -(far + near) / ww, -1,
        0, 0, -(far * near * 2) / ww, 0,
    ]);
}

function mat4mul(a, b) {
    const r = new Float32Array(16);
    for (let c = 0; c < 4; c++) {
        for (let row = 0; row < 4; row++) {
            let s = 0;
            for (let k = 0; k < 4; k++) s += a[k * 4 + row] * b[c * 4 + k];
            r[c * 4 + row] = s;
        }
    }
    return r;
}

function makeVertexBuffer(data) {
    const buf = device.createBuffer({ size: data.byteLength, usage: GPUBufferUsage.VERTEX, mappedAtCreation: true });
    new Float32Array(buf.getMappedRange()).set(data);
    buf.unmap();
    return buf;
}

function makeIndexBuffer(data) {
    const buf = device.createBuffer({ size: data.byteLength, usage: GPUBufferUsage.INDEX, mappedAtCreation: true });
    new Uint16Array(buf.getMappedRange()).set(data);
    buf.unmap();
    return buf;
}

function createDepthTexture() {
    return device.createTexture({
        size: { width: canvas.width, height: canvas.height, depthOrArrayLayers: 1 },
        format: 'depth24plus-stencil8',
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
}

function render() {
    device.queue.writeBuffer(offsetBuffer, 0, posArray);
    device.queue.writeBuffer(rotBuffer, 0, rotArray);

    if (currentPMatrix && eraserLineModel) {
        const lineViewProj = mat4mul(currentPMatrix, ERASER_VMAT);
        mat4.fromRotationTranslation(eraserLineModel, IDENTITY_QUATERNION, [0, -10, 0]);
        mat4.scale(eraserLineModel, eraserLineModel, [20, 0.1, 20]);
        setLineSlot(0, lineViewProj, eraserLineModel, 0, 1, 0, 1);
        for (let i = 0; i < MAX; i++) {
            const pos = [posArray[i * 3], posArray[i * 3 + 1], posArray[i * 3 + 2]];
            const rot = [rotArray[i * 4], rotArray[i * 4 + 1], rotArray[i * 4 + 2], rotArray[i * 4 + 3]];
            mat4.fromRotationTranslation(eraserLineModel, rot, pos);
            mat4.scale(eraserLineModel, eraserLineModel, ERASER_SIZE);
            setLineSlot(i + 1, lineViewProj, eraserLineModel, 1, 1, 0, 1);
        }
        device.queue.writeBuffer(lineUniformBuffer, 0, lineUniformData);
    }

    const textureView = ctx.getCurrentTexture().createView();
    const commandEncoder = device.createCommandEncoder();
    const passEncoder = commandEncoder.beginRenderPass({
        colorAttachments: [{ view: textureView, loadOp: 'clear', clearValue: { r: 0.5, g: 0.5, b: 0.8, a: 1.0 }, storeOp: 'store' }],
        depthStencilAttachment: {
            view: depthTexture.createView(),
            depthClearValue: 1.0, depthLoadOp: 'clear', depthStoreOp: 'store',
            stencilClearValue: 0, stencilLoadOp: 'clear', stencilStoreOp: 'store',
        },
    });

    passEncoder.setPipeline(groundPipeline);
    passEncoder.setVertexBuffer(0, groundVBuffer);
    passEncoder.setIndexBuffer(groundIBuffer, 'uint16');
    passEncoder.setBindGroup(0, groundBindGroup);
    passEncoder.drawIndexed(groundICount, 1, 0, 0, 0);

    passEncoder.setPipeline(pipeline);
    passEncoder.setVertexBuffer(0, positionBuffer);
    passEncoder.setVertexBuffer(1, normalBuffer);
    passEncoder.setVertexBuffer(2, texCoordBuffer);
    passEncoder.setVertexBuffer(3, offsetBuffer);
    passEncoder.setVertexBuffer(4, rotBuffer);
    passEncoder.setIndexBuffer(indexBuffer, 'uint16');
    passEncoder.setBindGroup(0, bindGroup);
    passEncoder.drawIndexed(indexNum, MAX, 0, 0, 0);

    if (showWireframe && linePipeline) {
        passEncoder.setPipeline(linePipeline);
        passEncoder.setVertexBuffer(0, debugBoxVertexBuffer);
        passEncoder.setIndexBuffer(debugBoxIndexBuffer, 'uint16');
        for (let i = 0; i < NUM_LINE_OBJECTS; i++) {
            passEncoder.setBindGroup(0, lineBindGroup, [i * LINE_ALIGN]);
            passEncoder.drawIndexed(debugBoxIndexCount);
        }
    }

    passEncoder.end();
    device.queue.submit([commandEncoder.finish()]);

    // DEBUG: sample each eraser from Havok and update the graphs.
    const t = (performance.now() - debugStartTime) / 1000;
    const dt = t - debugPrevT; debugPrevT = t;
    for (let i = 0; i < MAX; i++) {
        const p = HK.HP_Body_GetPosition(bodies[i])[1];
        const q = HK.HP_Body_GetOrientation(bodies[i])[1];
        // |angVel| by finite-differencing the orientation (the dot of two unit quaternions is the
        // cosine of half the rotation between them), so this needs no get-angular-velocity API.
        let wMag = 0;
        const qp = debugPrevQuat[i];
        if (qp && dt > 1e-4) {
            const dotq = q[0] * qp[0] + q[1] * qp[1] + q[2] * qp[2] + q[3] * qp[3];
            wMag = 2 * Math.acos(Math.min(1, Math.abs(dotq))) / dt;
        }
        debugPrevQuat[i] = q;
        // Tilt of the big face from horizontal: angle of the eraser's local up-axis from world up.
        // 0 deg = lying flat, ~90 deg = standing on an edge. |upY| so either large face counts flat.
        const upY = 1 - 2 * (q[0] * q[0] + q[2] * q[2]);
        const tilt = Math.acos(Math.min(1, Math.abs(upY))) * 180 / Math.PI;
        const s = debugSamples[i];
        s.push({ t, tilt, w: wMag, y: p[1] });
        if (s.length > 900) s.shift();
    }
    drawDebugViz();

    requestAnimationFrame(render);
}

// DEBUG: three stacked time-series graphs (tilt angle, |angVel|, height) on a 2D overlay canvas,
// so the post-landing behaviour is visible without console logs (matches the WGSL eraser_debug).
function drawDebugViz() {
    if (!debugCanvas) {
        debugCanvas = document.createElement('canvas');
        debugCanvas.width = 520; debugCanvas.height = 420;
        Object.assign(debugCanvas.style, {
            position: 'fixed', right: '8px', top: '8px', zIndex: 9999,
            background: 'rgba(0,0,0,0.72)', border: '1px solid #444', borderRadius: '4px',
        });
        document.body.appendChild(debugCanvas);
        debugCtx = debugCanvas.getContext('2d');
    }
    const ctx = debugCtx, W = debugCanvas.width;
    ctx.clearRect(0, 0, W, debugCanvas.height);
    ctx.font = '11px monospace'; ctx.textBaseline = 'middle';

    // Legend
    let lx = 10;
    for (let k = 0; k < MAX; k++) {
        ctx.fillStyle = DEBUG_COLORS[k];
        ctx.fillRect(lx, 6, 10, 10);
        ctx.fillText(DEBUG_LABELS[k], lx + 13, 12);
        lx += 13 + ctx.measureText(DEBUG_LABELS[k]).width + 12;
    }

    // Common time window across all erasers (last ~8 s).
    let tMax = 0;
    for (const s of debugSamples) if (s.length) tMax = Math.max(tMax, s[s.length - 1].t);
    const tMin = Math.max(0, tMax - 8);

    const panels = [
        { title: 'tilt angle (deg) - 0=flat, ~90=on edge', key: 'tilt', lo: 0, hi: 95, guide: 0 },
        { title: '|angVel| (rad/s) - should settle to 0', key: 'w', lo: 0, hi: 6, guide: 0 },
        { title: 'height y - rests ~ -9.65 if flat', key: 'y', lo: -11, hi: 16, guide: -9.65 },
    ];
    const padL = 38, padR = 10, top0 = 26, ph = 116, gap = 16;

    panels.forEach((p, pi) => {
        const y0 = top0 + pi * (ph + gap), x0 = padL, pw = W - padL - padR;
        ctx.strokeStyle = '#666'; ctx.lineWidth = 1; ctx.strokeRect(x0, y0, pw, ph);
        ctx.fillStyle = '#ccc'; ctx.fillText(p.title, x0, y0 - 7);
        const vy = (v) => y0 + ph - ((v - p.lo) / (p.hi - p.lo)) * ph;
        ctx.fillStyle = '#888';
        for (let g = 0; g <= 4; g++) {
            const v = p.lo + (p.hi - p.lo) * g / 4, yy = vy(v);
            ctx.strokeStyle = '#333'; ctx.beginPath(); ctx.moveTo(x0, yy); ctx.lineTo(x0 + pw, yy); ctx.stroke();
            ctx.fillText(v.toFixed(p.key === 'y' ? 0 : (p.hi <= 6 ? 1 : 0)), 2, yy);
        }
        if (p.guide >= p.lo && p.guide <= p.hi) {
            ctx.strokeStyle = '#00ff9988'; ctx.setLineDash([4, 3]); ctx.beginPath();
            ctx.moveTo(x0, vy(p.guide)); ctx.lineTo(x0 + pw, vy(p.guide)); ctx.stroke(); ctx.setLineDash([]);
        }
        for (let k = 0; k < MAX; k++) {
            const s = debugSamples[k];
            ctx.strokeStyle = DEBUG_COLORS[k]; ctx.lineWidth = 1.5; ctx.beginPath();
            let started = false;
            for (const pt of s) {
                if (pt.t < tMin) continue;
                const xx = x0 + ((pt.t - tMin) / (tMax - tMin || 1)) * pw;
                const yy = Math.max(y0, Math.min(y0 + ph, vy(pt[p.key])));
                if (!started) { ctx.moveTo(xx, yy); started = true; } else ctx.lineTo(xx, yy);
            }
            ctx.stroke();
        }
    });
}

init();
