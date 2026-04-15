// WebGPU + Oimo.js Domino Example
// forked from gaziya's "Domino (WebGL2 + Oimo.js)" http://jsdo.it/gaziya/46vq

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

const colorMap = {
    "無": [0xDC/255, 0xAA/255, 0x6B/255],
    "白": [1.0, 1.0, 1.0],
    "肌": [1.0, 0xCC/255, 0xCC/255],
    "茶": [0x80/255, 0.0, 0.0],
    "赤": [1.0, 0.0, 0.0],
    "黄": [1.0, 1.0, 0.0],
    "緑": [0.0, 1.0, 0.0],
    "水": [0.0, 1.0, 1.0],
    "青": [0.0, 0.0, 1.0],
    "紫": [0x80/255, 0.0, 0x80/255]
};

const NUMBER = 256;
const BW = 1, BH = 2, BD = 0.3;

let canvas, device, ctx, format;
let pipeline, uniformBuffer, bindGroup;
let positionBuf, normalBuf, indexBuf, indexCount;
let offsetBuf, quatBuf, colBuf;
let depthTexture;
let world, bodys;
let posArray, quatArray;

async function init() {
    canvas = document.getElementById('c');
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;

    window.addEventListener('resize', () => {
        canvas.width  = window.innerWidth;
        canvas.height = window.innerHeight;
        depthTexture.destroy();
        depthTexture = createDepthTexture();
        const pMatrix = makePerspective(45, canvas.width / canvas.height, 0.1, 200);
        device.queue.writeBuffer(uniformBuffer, 0, pMatrix);
    });

    const gpu = navigator['gpu'];
    if (!gpu) { alert('WebGPU is not supported.'); return; }
    const adapter = await gpu.requestAdapter();
    if (!adapter) { alert('Failed to get GPU adapter.'); return; }
    device = await adapter.requestDevice();

    ctx = canvas.getContext('webgpu');
    format = gpu.getPreferredCanvasFormat();
    ctx.configure({ device, format, alphaMode: 'opaque' });

    // --- Geometry ---
    const positions = new Float32Array([
        -BW, -BH, -BD, -BW, -BH,  BD,  BW, -BH,  BD,  BW, -BH, -BD,
        -BW,  BH, -BD, -BW,  BH,  BD,  BW,  BH,  BD,  BW,  BH, -BD,
        -BW, -BH, -BD, -BW,  BH, -BD,  BW,  BH, -BD,  BW, -BH, -BD,
        -BW, -BH,  BD, -BW,  BH,  BD,  BW,  BH,  BD,  BW, -BH,  BD,
        -BW, -BH, -BD, -BW, -BH,  BD, -BW,  BH,  BD, -BW,  BH, -BD,
         BW, -BH, -BD,  BW, -BH,  BD,  BW,  BH,  BD,  BW,  BH, -BD]);
    const normals = new Float32Array([
         0, -1,  0,  0, -1,  0,  0, -1,  0,  0, -1,  0,
         0,  1,  0,  0,  1,  0,  0,  1,  0,  0,  1,  0,
         0,  0, -1,  0,  0, -1,  0,  0, -1,  0,  0, -1,
         0,  0,  1,  0,  0,  1,  0,  0,  1,  0,  0,  1,
        -1,  0,  0, -1,  0,  0, -1,  0,  0, -1,  0,  0,
         1,  0,  0,  1,  0,  0,  1,  0,  0,  1,  0,  0]);
    const indices = new Uint16Array([
         0,  2,  1,  0,  3,  2,
         4,  5,  6,  4,  6,  7,
         8,  9, 10,  8, 10, 11,
        12, 15, 14, 12, 14, 13,
        16, 17, 18, 16, 18, 19,
        20, 23, 22, 20, 22, 21]);
    indexCount = indices.length;

    positionBuf = makeVertexBuffer(positions);
    normalBuf   = makeVertexBuffer(normals);
    indexBuf    = makeIndexBuffer(indices);

    // --- Instance buffers ---
    posArray  = new Float32Array(NUMBER * 3);
    quatArray = new Float32Array(NUMBER * 4);
    const colData = new Float32Array(NUMBER * 3);
    for (let i = 0; i < NUMBER; i++) {
        const c = colorMap[dataSet[i]];
        colData[i * 3 + 0] = c[0];
        colData[i * 3 + 1] = c[1];
        colData[i * 3 + 2] = c[2];
    }

    offsetBuf = device.createBuffer({
        size: NUMBER * 3 * 4,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
    });
    quatBuf = device.createBuffer({
        size: NUMBER * 4 * 4,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
    });
    colBuf = makeVertexBuffer(colData);

    // --- Uniform buffer (perspective matrix 64 bytes) ---
    uniformBuffer = device.createBuffer({
        size: 64,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    const pMatrix = makePerspective(45, canvas.width / canvas.height, 0.1, 200);
    device.queue.writeBuffer(uniformBuffer, 0, pMatrix);

    // --- Pipeline ---
    const vModule = device.createShaderModule({ code: document.getElementById('vs').textContent });
    const fModule = device.createShaderModule({ code: document.getElementById('fs').textContent });

    pipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: {
            module: vModule,
            entryPoint: 'main',
            buffers: [
                { arrayStride: 3*4, stepMode: 'vertex',   attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] },
                { arrayStride: 3*4, stepMode: 'vertex',   attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x3' }] },
                { arrayStride: 3*4, stepMode: 'instance', attributes: [{ shaderLocation: 2, offset: 0, format: 'float32x3' }] },
                { arrayStride: 4*4, stepMode: 'instance', attributes: [{ shaderLocation: 3, offset: 0, format: 'float32x4' }] },
                { arrayStride: 3*4, stepMode: 'instance', attributes: [{ shaderLocation: 4, offset: 0, format: 'float32x3' }] }
            ]
        },
        fragment: {
            module: fModule,
            entryPoint: 'main',
            targets: [{ format }]
        },
        primitive: { topology: 'triangle-list' },
        depthStencil: {
            depthWriteEnabled: true,
            depthCompare: 'less',
            format: 'depth24plus-stencil8'
        }
    });

    bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: uniformBuffer } }]
    });

    depthTexture = createDepthTexture();

    // --- Physics ---
    world = new OIMO.World({
        timestep: 1 / 60,
        iterations: 8,
        broadphase: 2,
        worldscale: 1,
        random: true,
        info: false,
        gravity: [0, -9.8, 0]
    });

    world.add({
        type: 'box',
        size: [100, 0.2, 100],
        pos: [0, -0.1, 0],
        rot: [0, 0, 0],
        move: false,
        density: 1
    });

    bodys = [];
    for (let i = 0; i < NUMBER; i++) {
        const x = (Math.floor(i / 16) - 8) * 3;
        const y = BH;
        const z = (8 - (i % 16)) * 3;
        bodys[i] = world.add({
            type: 'box',
            size: [BW * 2, BH * 2, BD * 2],
            pos: [x, y, z],
            rot: [0, 0, 0],
            move: true,
            density: 1
        });
    }
    // Tilt first column to trigger chain reaction
    for (let i = 0; i < 16; i++) {
        bodys[i * 16].resetRotation(-15, 0, 0);
    }

    uploadInstanceData();

    setInterval(function () {
        world.step();
        uploadInstanceData();
    }, 1000 / 60);

    requestAnimationFrame(render);
}

function uploadInstanceData() {
    let pIdx = 0, qIdx = 0;
    for (let i = 0; i < NUMBER; i++) {
        const p = bodys[i].getPosition();
        posArray[pIdx++] = p.x;
        posArray[pIdx++] = p.y;
        posArray[pIdx++] = p.z;
        const q = bodys[i].getQuaternion();
        quatArray[qIdx++] = q.x;
        quatArray[qIdx++] = q.y;
        quatArray[qIdx++] = q.z;
        quatArray[qIdx++] = q.w;
    }
    device.queue.writeBuffer(offsetBuf, 0, posArray);
    device.queue.writeBuffer(quatBuf,   0, quatArray);
}

function makePerspective(fovy, aspect, near, far) {
    const v = 1 / Math.tan(fovy * Math.PI / 360.0);
    const u = v / aspect;
    const w = near - far;
    return new Float32Array([
        u, 0, 0, 0,
        0, v, 0, 0,
        0, 0, (near + far) / w, -1,
        0, 0, near * far * 2 / w, 0
    ]);
}

function makeVertexBuffer(data) {
    const buf = device.createBuffer({
        size: data.byteLength,
        usage: GPUBufferUsage.VERTEX,
        mappedAtCreation: true
    });
    new Float32Array(buf.getMappedRange()).set(data);
    buf.unmap();
    return buf;
}

function makeIndexBuffer(data) {
    const buf = device.createBuffer({
        size: data.byteLength,
        usage: GPUBufferUsage.INDEX,
        mappedAtCreation: true
    });
    new Uint16Array(buf.getMappedRange()).set(data);
    buf.unmap();
    return buf;
}

function createDepthTexture() {
    return device.createTexture({
        size: { width: canvas.width, height: canvas.height, depthOrArrayLayers: 1 },
        format: 'depth24plus-stencil8',
        usage: GPUTextureUsage.RENDER_ATTACHMENT
    });
}

function render() {
    device.queue.writeBuffer(offsetBuf, 0, posArray);
    device.queue.writeBuffer(quatBuf,   0, quatArray);

    const textureView = ctx.getCurrentTexture().createView();
    const commandEncoder = device.createCommandEncoder();
    const passEncoder = commandEncoder.beginRenderPass({
        colorAttachments: [{
            view: textureView,
            loadOp: 'clear',
            clearValue: { r: 0.05, g: 0.05, b: 0.1, a: 1.0 },
            storeOp: 'store'
        }],
        depthStencilAttachment: {
            view: depthTexture.createView(),
            depthClearValue: 1.0,
            depthLoadOp: 'clear',
            depthStoreOp: 'store',
            stencilClearValue: 0,
            stencilLoadOp: 'clear',
            stencilStoreOp: 'store'
        }
    });

    passEncoder.setPipeline(pipeline);
    passEncoder.setVertexBuffer(0, positionBuf);
    passEncoder.setVertexBuffer(1, normalBuf);
    passEncoder.setVertexBuffer(2, offsetBuf);
    passEncoder.setVertexBuffer(3, quatBuf);
    passEncoder.setVertexBuffer(4, colBuf);
    passEncoder.setIndexBuffer(indexBuf, 'uint16');
    passEncoder.setBindGroup(0, bindGroup);
    passEncoder.drawIndexed(indexCount, NUMBER, 0, 0, 0);

    passEncoder.end();
    device.queue.submit([commandEncoder.finish()]);
    requestAnimationFrame(render);
}

init();
