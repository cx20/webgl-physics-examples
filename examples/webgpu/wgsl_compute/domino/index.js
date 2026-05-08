const computeShaderWGSL = document.getElementById('cs').textContent;
const vertexShaderWGSL = document.getElementById('vs').textContent;
const fragmentShaderWGSL = document.getElementById('fs').textContent;

const canvas = document.getElementById('c');

const GRID = 16;
const COUNT = GRID * GRID;
const INSTANCE_COUNT = COUNT + 1;
const STATE_FLOATS = 8;
const SUBSTEPS = 4;
const BW = 1.0;
const BH = 2.0;
const SPACING = 3.0;

let device, context, format, depthTexture;
let renderPipeline, computePipeline;
let vertexBuffer, normalBuffer, indexBuffer, indexCount;
let cameraBuffer, stateBuffer, colorBuffer, simParamsBuffer;
let renderBindGroup, computeBindGroup;
let lastTime = -1;

const projectionMatrix = new Float32Array(16);
const viewMatrix = new Float32Array(16);
const viewProjectionMatrix = new Float32Array(16);

const sprite = [
    0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,1,
    0,0,0,0,0,0,2,2,2,2,2,0,0,1,1,1,
    0,0,0,0,0,2,2,2,2,2,2,2,2,2,1,1,
    0,0,0,0,0,3,3,3,1,1,3,1,0,2,2,2,
    0,0,0,0,3,1,3,1,1,1,3,1,1,2,2,2,
    0,0,0,0,3,1,3,3,1,1,1,3,1,1,1,2,
    0,0,0,0,3,3,1,1,1,1,3,3,3,3,2,0,
    0,0,0,0,0,0,1,1,1,1,1,1,1,2,0,0,
    0,0,2,2,2,2,2,4,2,2,2,4,2,0,0,0,
    0,2,2,2,2,2,2,2,4,2,2,2,4,0,0,3,
    1,1,2,2,2,2,2,2,4,4,4,4,4,0,0,3,
    1,1,1,0,4,4,2,4,4,5,4,4,5,4,3,3,
    0,1,0,3,4,4,4,4,4,4,4,4,4,4,3,3,
    0,0,3,3,3,4,4,4,4,4,4,4,4,4,3,3,
    0,3,3,3,4,4,4,4,4,4,4,0,0,0,0,0,
    0,3,0,0,4,4,4,4,0,0,0,0,0,0,0,0,
];

const palette = [
    [0xdc / 255, 0xaa / 255, 0x6b / 255, 1],
    [1.0, 0xcc / 255, 0xcc / 255, 1],
    [1.0, 0.04, 0.02, 1],
    [0x80 / 255, 0.0, 0.0, 1],
    [0.04, 0.14, 1.0, 1],
    [1.0, 0.92, 0.04, 1],
];

function resize() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';

    context.configure({ device, format, alphaMode: 'opaque' });

    depthTexture = device.createTexture({
        size: { width: canvas.width, height: canvas.height },
        format: 'depth24plus',
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
}

function createBoxGeometry() {
    const positions = new Float32Array([
        -0.5,-0.5, 0.5,  0.5,-0.5, 0.5,  0.5, 0.5, 0.5, -0.5, 0.5, 0.5,
         0.5,-0.5,-0.5, -0.5,-0.5,-0.5, -0.5, 0.5,-0.5,  0.5, 0.5,-0.5,
        -0.5,-0.5,-0.5, -0.5,-0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5,-0.5,
         0.5,-0.5, 0.5,  0.5,-0.5,-0.5,  0.5, 0.5,-0.5,  0.5, 0.5, 0.5,
        -0.5, 0.5, 0.5,  0.5, 0.5, 0.5,  0.5, 0.5,-0.5, -0.5, 0.5,-0.5,
        -0.5,-0.5,-0.5,  0.5,-0.5,-0.5,  0.5,-0.5, 0.5, -0.5,-0.5, 0.5,
    ]);
    const normals = new Float32Array([
         0, 0, 1,  0, 0, 1,  0, 0, 1,  0, 0, 1,
         0, 0,-1,  0, 0,-1,  0, 0,-1,  0, 0,-1,
        -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0,
         1, 0, 0,  1, 0, 0,  1, 0, 0,  1, 0, 0,
         0, 1, 0,  0, 1, 0,  0, 1, 0,  0, 1, 0,
         0,-1, 0,  0,-1, 0,  0,-1, 0,  0,-1, 0,
    ]);
    const indices = new Uint16Array([
         0, 1, 2,  0, 2, 3,   4, 5, 6,  4, 6, 7,
         8, 9,10,  8,10,11,  12,13,14, 12,14,15,
        16,17,18, 16,18,19,  20,21,22, 20,22,23,
    ]);

    vertexBuffer = device.createBuffer({ size: positions.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    normalBuffer = device.createBuffer({ size: normals.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    indexBuffer = device.createBuffer({ size: indices.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(vertexBuffer, 0, positions);
    device.queue.writeBuffer(normalBuffer, 0, normals);
    device.queue.writeBuffer(indexBuffer, 0, indices);
    indexCount = indices.length;
}

function createInitialStates() {
    const states = new Float32Array(INSTANCE_COUNT * STATE_FLOATS);
    for (let i = 0; i < COUNT; i++) {
        const col = Math.floor(i / GRID);
        const row = i % GRID;
        const base = i * STATE_FLOATS;
        states[base + 0] = (col - (GRID - 1) * 0.5) * SPACING;
        states[base + 1] = BH;
        states[base + 2] = ((GRID - 1) * 0.5 - row) * SPACING;
        states[base + 4] = row === 0 ? -0.18 : 0.0;
        states[base + 5] = row === 0 ? -1.6 : 0.0;
        states[base + 6] = row === 0 ? 1.0 : 0.0;
    }
    return states;
}

function createColors() {
    const colors = new Float32Array(INSTANCE_COUNT * 4);
    for (let i = 0; i < COUNT; i++) {
        colors.set(palette[sprite[i]], i * 4);
    }
    colors.set([0.52, 0.58, 0.54, 1.0], COUNT * 4);
    return colors;
}

function writeCamera(timeMs) {
    const t = timeMs * 0.00016;
    const eye = [
        Math.sin(t) * 46,
        35,
        Math.cos(t) * 46,
    ];
    mat4Perspective(projectionMatrix, Math.PI / 4, canvas.width / canvas.height, 0.1, 200);
    mat4LookAt(viewMatrix, eye, [0, 5, 0], [0, 1, 0]);
    mat4Multiply(viewProjectionMatrix, projectionMatrix, viewMatrix);
    device.queue.writeBuffer(cameraBuffer, 0, viewProjectionMatrix);
}

function frame(timeMs) {
    if (lastTime < 0) {
        lastTime = timeMs;
    }
    const dt = Math.min((timeMs - lastTime) / 1000, 1 / 30);
    lastTime = timeMs;

    writeCamera(timeMs);
    device.queue.writeBuffer(simParamsBuffer, 0, new Float32Array([dt / SUBSTEPS, 9.81, 0.992, 0]));

    const encoder = device.createCommandEncoder();
    for (let s = 0; s < SUBSTEPS; s++) {
        const computePass = encoder.beginComputePass();
        computePass.setPipeline(computePipeline);
        computePass.setBindGroup(0, computeBindGroup);
        computePass.dispatchWorkgroups(Math.ceil(COUNT / 64));
        computePass.end();
    }

    const renderPass = encoder.beginRenderPass({
        colorAttachments: [{
            view: context.getCurrentTexture().createView(),
            clearValue: { r: 0.08, g: 0.09, b: 0.10, a: 1.0 },
            loadOp: 'clear',
            storeOp: 'store',
        }],
        depthStencilAttachment: {
            view: depthTexture.createView(),
            depthClearValue: 1.0,
            depthLoadOp: 'clear',
            depthStoreOp: 'store',
        },
    });

    renderPass.setPipeline(renderPipeline);
    renderPass.setVertexBuffer(0, vertexBuffer);
    renderPass.setVertexBuffer(1, normalBuffer);
    renderPass.setIndexBuffer(indexBuffer, 'uint16');
    renderPass.setBindGroup(0, renderBindGroup);
    renderPass.drawIndexed(indexCount, INSTANCE_COUNT);
    renderPass.end();

    device.queue.submit([encoder.finish()]);
    requestAnimationFrame(frame);
}

async function init() {
    if (!navigator.gpu) throw new Error('WebGPU not supported.');
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('No GPU adapter found.');
    device = await adapter.requestDevice();
    context = canvas.getContext('webgpu');
    format = navigator.gpu.getPreferredCanvasFormat();

    createBoxGeometry();

    stateBuffer = device.createBuffer({
        size: INSTANCE_COUNT * STATE_FLOATS * 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        mappedAtCreation: true,
    });
    new Float32Array(stateBuffer.getMappedRange()).set(createInitialStates());
    stateBuffer.unmap();

    colorBuffer = device.createBuffer({
        size: INSTANCE_COUNT * 4 * 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        mappedAtCreation: true,
    });
    new Float32Array(colorBuffer.getMappedRange()).set(createColors());
    colorBuffer.unmap();

    cameraBuffer = device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    simParamsBuffer = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    renderPipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: {
            module: device.createShaderModule({ code: vertexShaderWGSL }),
            entryPoint: 'main',
            buffers: [
                { arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] },
                { arrayStride: 12, attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x3' }] },
            ],
        },
        fragment: {
            module: device.createShaderModule({ code: fragmentShaderWGSL }),
            entryPoint: 'main',
            targets: [{ format }],
        },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
    });

    computePipeline = device.createComputePipeline({
        layout: 'auto',
        compute: {
            module: device.createShaderModule({ code: computeShaderWGSL }),
            entryPoint: 'main',
        },
    });

    renderBindGroup = device.createBindGroup({
        layout: renderPipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: cameraBuffer } },
            { binding: 1, resource: { buffer: stateBuffer } },
            { binding: 2, resource: { buffer: colorBuffer } },
        ],
    });

    computeBindGroup = device.createBindGroup({
        layout: computePipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: stateBuffer } },
            { binding: 1, resource: { buffer: simParamsBuffer } },
        ],
    });

    resize();
    window.addEventListener('resize', resize);

    requestAnimationFrame(frame);
}

function mat4Perspective(out, fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2);
    out.fill(0);
    out[0] = f / aspect;
    out[5] = f;
    out[10] = (far + near) / (near - far);
    out[11] = -1;
    out[14] = (2 * far * near) / (near - far);
}

function mat4LookAt(out, eye, center, up) {
    let zx = eye[0] - center[0];
    let zy = eye[1] - center[1];
    let zz = eye[2] - center[2];
    let len = Math.hypot(zx, zy, zz);
    zx /= len; zy /= len; zz /= len;

    let xx = up[1] * zz - up[2] * zy;
    let xy = up[2] * zx - up[0] * zz;
    let xz = up[0] * zy - up[1] * zx;
    len = Math.hypot(xx, xy, xz);
    xx /= len; xy /= len; xz /= len;

    const yx = zy * xz - zz * xy;
    const yy = zz * xx - zx * xz;
    const yz = zx * xy - zy * xx;

    out[0] = xx; out[1] = yx; out[2] = zx; out[3] = 0;
    out[4] = xy; out[5] = yy; out[6] = zy; out[7] = 0;
    out[8] = xz; out[9] = yz; out[10] = zz; out[11] = 0;
    out[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
    out[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
    out[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
    out[15] = 1;
}

function mat4Multiply(out, a, b) {
    for (let c = 0; c < 4; c++) {
        for (let r = 0; r < 4; r++) {
            out[c * 4 + r] =
                a[0 * 4 + r] * b[c * 4 + 0] +
                a[1 * 4 + r] * b[c * 4 + 1] +
                a[2 * 4 + r] * b[c * 4 + 2] +
                a[3 * 4 + r] * b[c * 4 + 3];
        }
    }
}

init().catch(err => console.error(err));
