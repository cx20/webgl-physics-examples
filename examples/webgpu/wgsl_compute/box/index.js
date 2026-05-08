const computeShaderWGSL = document.getElementById('cs').textContent;
const vertexShaderWGSL = document.getElementById('vs').textContent;
const fragmentShaderWGSL = document.getElementById('fs').textContent;

const canvas = document.getElementById('c');

const ROWS = [
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
    '.n..bbbb........',
];

const COUNT = 256;
const INSTANCE_COUNT = COUNT + 1;
const STATE_FLOATS = 8;
const SUBSTEPS = 5;
const BOX_HALF = 0.5;
const GROUND_Y = -2.0;

let device, context, format, depthTexture;
let renderPipeline, computePipeline;
let vertexBuffer, normalBuffer, indexBuffer, indexCount;
let cameraBuffer, colorBuffer, simParamsBuffer;
let stateBuffers = [];
let renderBindGroups = [];
let computeBindGroups = [];
let currentState = 0;
let lastTime = -1;

const projectionMatrix = new Float32Array(16);
const viewMatrix = new Float32Array(16);
const viewProjectionMatrix = new Float32Array(16);

const palette = {
    '.': [0xdc / 255, 0xaa / 255, 0x6b / 255, 1],
    p: [1.0, 0xcc / 255, 0xcc / 255, 1],
    n: [0x80 / 255, 0.0, 0.0, 1],
    r: [1.0, 0.0, 0.0, 1],
    y: [1.0, 1.0, 0.0, 1],
    b: [0.0, 0.0, 1.0, 1],
};

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
    let i = 0;

    for (let rowIndex = 0; rowIndex < ROWS.length; rowIndex++) {
        const row = ROWS[rowIndex];
        for (let col = 0; col < row.length; col++) {
            const base = i * STATE_FLOATS;
            const jitter = ((col * 13 + rowIndex * 7) % 10) * 0.006;
            states[base + 0] = -12 + col * 1.5 + jitter;
            states[base + 1] = (ROWS.length - 1 - rowIndex) * 1.2 + jitter;
            states[base + 2] = ((col * 5 + rowIndex * 3) % 9) * 0.012;
            states[base + 3] = ((col * 17 + rowIndex * 31) % 97) / 97;
            states[base + 4] = ((col % 3) - 1) * 0.03;
            states[base + 5] = -0.05;
            states[base + 6] = ((rowIndex % 3) - 1) * 0.02;
            i++;
        }
    }

    return states;
}

function createColors() {
    const colors = new Float32Array(INSTANCE_COUNT * 4);
    let i = 0;
    for (const row of ROWS) {
        for (const key of row) {
            colors.set(palette[key], i * 4);
            i++;
        }
    }
    colors.set([0.34, 0.52, 0.33, 1.0], COUNT * 4);
    return colors;
}

function writeCamera(timeMs) {
    const t = timeMs * 0.00018;
    const eye = [
        Math.sin(t) * 25,
        13,
        Math.cos(t) * 25,
    ];
    mat4Perspective(projectionMatrix, Math.PI / 4, canvas.width / canvas.height, 0.1, 160);
    mat4LookAt(viewMatrix, eye, [0, 6, 0], [0, 1, 0]);
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
    device.queue.writeBuffer(simParamsBuffer, 0, new Float32Array([
        dt / SUBSTEPS,
        9.8,
        GROUND_Y,
        0.18,
        0.996,
        0.86,
        BOX_HALF,
        timeMs * 0.001,
    ]));

    const encoder = device.createCommandEncoder();
    for (let s = 0; s < SUBSTEPS; s++) {
        const computePass = encoder.beginComputePass();
        computePass.setPipeline(computePipeline);
        computePass.setBindGroup(0, computeBindGroups[currentState]);
        computePass.dispatchWorkgroups(Math.ceil(COUNT / 64));
        computePass.end();
        currentState = 1 - currentState;
    }

    const renderPass = encoder.beginRenderPass({
        colorAttachments: [{
            view: context.getCurrentTexture().createView(),
            clearValue: { r: 0.97, g: 0.97, b: 0.98, a: 1.0 },
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
    renderPass.setBindGroup(0, renderBindGroups[currentState]);
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

    const initialStates = createInitialStates();
    for (let i = 0; i < 2; i++) {
        const buffer = device.createBuffer({
            size: INSTANCE_COUNT * STATE_FLOATS * 4,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            mappedAtCreation: true,
        });
        new Float32Array(buffer.getMappedRange()).set(initialStates);
        buffer.unmap();
        stateBuffers.push(buffer);
    }

    colorBuffer = device.createBuffer({
        size: INSTANCE_COUNT * 4 * 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        mappedAtCreation: true,
    });
    new Float32Array(colorBuffer.getMappedRange()).set(createColors());
    colorBuffer.unmap();

    cameraBuffer = device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    simParamsBuffer = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

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

    for (let i = 0; i < 2; i++) {
        renderBindGroups.push(device.createBindGroup({
            layout: renderPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: cameraBuffer } },
                { binding: 1, resource: { buffer: stateBuffers[i] } },
                { binding: 2, resource: { buffer: colorBuffer } },
            ],
        }));

        computeBindGroups.push(device.createBindGroup({
            layout: computePipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: stateBuffers[i] } },
                { binding: 1, resource: { buffer: stateBuffers[1 - i] } },
                { binding: 2, resource: { buffer: simParamsBuffer } },
            ],
        }));
    }

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
