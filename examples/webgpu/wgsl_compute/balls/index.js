const computeShaderWGSL = document.getElementById('cs').textContent;
const vertexShaderWGSL = document.getElementById('vs').textContent;
const fragmentShaderWGSL = document.getElementById('fs').textContent;
const lineVertexShaderWGSL = document.getElementById('vs-line').textContent;
const lineFragmentShaderWGSL = document.getElementById('fs-line').textContent;

const canvas = document.getElementById('c');

const BALL_COUNT = 180;
const STATIC_COUNT = 5;
const INSTANCE_COUNT = BALL_COUNT + STATIC_COUNT;
const STATE_FLOATS = 16;
const INFO_FLOATS = 4;
const STATIC_FLOATS = 12;
const SUBSTEPS = 4;
const BASKET_HALF = 2.5;
const BASKET_TOP = 4.0;
const GROUND_Y = -1.0;
const GROUND_HALF = 10.0;
const RESTITUTIONS = [0.72, 0.82, 0.76, 0.48, 0.72];
const FRICTIONS = [0.035, 0.02, 0.035, 0.08, 0.055];
const BALL_SIZE_SCALES = [1.0, 0.9, 1.0, 0.3, 0.3];
const TEXTURE_FILES = [
    '../../../../assets/textures/Basketball.jpg',
    '../../../../assets/textures/BeachBall.jpg',
    '../../../../assets/textures/Football.jpg',
    '../../../../assets/textures/Softball.jpg',
    '../../../../assets/textures/TennisBall.jpg',
];

let device, context, format, depthTexture;
let renderPipeline, computePipeline, linePipeline;
let sphereMesh, cubeMesh;
let debugSphereVertexBuffer, debugSphereIndexBuffer, debugBoxVertexBuffer, debugBoxIndexBuffer;
let cameraBuffer, ballInfoBuffer, staticBuffer, simParamsBuffer;
let sampler, textureView;
let stateBuffers = [];
let renderBindGroups = [];
let computeBindGroups = [];
let lineBindGroups = [];
let currentState = 0;
let lastTime = -1;
let showWireframe = true;
let debugSphereIndexCount = 0;
let debugBoxIndexCount = 0;

const projectionMatrix = new Float32Array(16);
const viewMatrix = new Float32Array(16);
const viewProjectionMatrix = new Float32Array(16);

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

function createSphereGeometry(segments = 32, rings = 16) {
    const positions = [];
    const normals = [];
    const uvs = [];
    const indices = [];

    for (let y = 0; y <= rings; y++) {
        const v = y / rings;
        const theta = v * Math.PI;
        const sinTheta = Math.sin(theta);
        const cosTheta = Math.cos(theta);
        for (let x = 0; x <= segments; x++) {
            const u = x / segments;
            const phi = u * Math.PI * 2;
            const nx = Math.cos(phi) * sinTheta;
            const ny = cosTheta;
            const nz = Math.sin(phi) * sinTheta;
            positions.push(nx, ny, nz);
            normals.push(nx, ny, nz);
            uvs.push(1 - u, v);
        }
    }

    for (let y = 0; y < rings; y++) {
        for (let x = 0; x < segments; x++) {
            const a = y * (segments + 1) + x;
            const b = a + segments + 1;
            indices.push(a, b, a + 1, b, b + 1, a + 1);
        }
    }
    return createMesh(new Float32Array(positions), new Float32Array(normals), new Float32Array(uvs), new Uint16Array(indices));
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
    const uvs = new Float32Array([
        0,0, 1,0, 1,1, 0,1,  0,0, 1,0, 1,1, 0,1,
        0,0, 1,0, 1,1, 0,1,  0,0, 1,0, 1,1, 0,1,
        0,0, 1,0, 1,1, 0,1,  0,0, 1,0, 1,1, 0,1,
    ]);
    const indices = new Uint16Array([
         0, 1, 2,  0, 2, 3,   4, 5, 6,  4, 6, 7,
         8, 9,10,  8,10,11,  12,13,14, 12,14,15,
        16,17,18, 16,18,19,  20,21,22, 20,22,23,
    ]);
    return createMesh(positions, normals, uvs, indices);
}

function createMesh(positions, normals, uvs, indices) {
    return {
        positionBuffer: createVertexBuffer(positions),
        normalBuffer: createVertexBuffer(normals),
        uvBuffer: createVertexBuffer(uvs),
        indexBuffer: createIndexBuffer(indices),
        indexCount: indices.length,
    };
}

function createVertexBuffer(data) {
    const buffer = device.createBuffer({ size: data.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(buffer, 0, data);
    return buffer;
}

function createIndexBuffer(data) {
    const buffer = device.createBuffer({ size: data.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(buffer, 0, data);
    return buffer;
}

async function loadImage(src) {
    const img = document.createElement('img');
    img.src = src;
    await img.decode();
    return img;
}

async function createTextureAtlas() {
    const cell = 256;
    const images = await Promise.all(TEXTURE_FILES.map(loadImage));
    const atlas = document.createElement('canvas');
    atlas.width = cell * images.length;
    atlas.height = cell;
    const ctx = atlas.getContext('2d');
    for (let i = 0; i < images.length; i++) {
        ctx.drawImage(images[i], i * cell, 0, cell, cell);
    }

    const tex = device.createTexture({
        size: [atlas.width, atlas.height, 1],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    device.queue.copyExternalImageToTexture({ source: atlas }, { texture: tex }, [atlas.width, atlas.height]);
    return tex;
}

function createInitialStates() {
    const states = new Float32Array(BALL_COUNT * STATE_FLOATS);
    for (let i = 0; i < BALL_COUNT; i++) {
        const seed = ((i * 37) % 101) / 101;
        const base = i * STATE_FLOATS;
        const col = i % 15;
        const row = Math.floor(i / 15);
        states[base + 0] = (col - 7) * 0.24 + (seed - 0.5) * 0.35;
        states[base + 1] = 7 + row * 0.35 + seed * 5;
        states[base + 2] = (seed - 0.5) * BASKET_HALF * 1.2;
        states[base + 3] = seed;
        states[base + 4] = (seed - 0.5) * 0.12;
        states[base + 5] = -0.05;
        states[base + 6] = (0.5 - seed) * 0.12;
        states[base + 8] = 0;
        states[base + 9] = 0;
        states[base + 10] = 0;
        states[base + 11] = 1;
        states[base + 12] = seed * 0.6;
        states[base + 13] = seed * 0.3;
        states[base + 14] = -seed * 0.4;
    }
    return states;
}

function createBallInfos() {
    const infos = new Float32Array(BALL_COUNT * INFO_FLOATS);
    for (let i = 0; i < BALL_COUNT; i++) {
        const textureIndex = (i * 7) % BALL_SIZE_SCALES.length;
        const seed = ((i * 37) % 101) / 101;
        const radius = (0.5 + seed * 0.25) * BALL_SIZE_SCALES[textureIndex];
        const base = i * INFO_FLOATS;
        infos[base + 0] = radius;
        infos[base + 1] = textureIndex;
        infos[base + 2] = RESTITUTIONS[textureIndex];
        infos[base + 3] = FRICTIONS[textureIndex];
    }
    return infos;
}

function createStaticItems() {
    const items = new Float32Array(STATIC_COUNT * STATIC_FLOATS);
    const data = [
        { pos: [0, -2, 0], scale: [20, 2, 20], color: [0.22, 0.22, 0.24, 1] },
        { pos: [0, 1.5, -2.5], scale: [4.8, 5, 0.4], color: [0.25, 0.28, 0.3, 1] },
        { pos: [0, 1.5, 2.5], scale: [4.8, 5, 0.4], color: [0.25, 0.28, 0.3, 1] },
        { pos: [-2.5, 1.5, 0], scale: [0.4, 5, 4.8], color: [0.25, 0.28, 0.3, 1] },
        { pos: [2.5, 1.5, 0], scale: [0.4, 5, 4.8], color: [0.25, 0.28, 0.3, 1] },
    ];
    for (let i = 0; i < data.length; i++) {
        const base = i * STATIC_FLOATS;
        items.set([...data[i].pos, 0], base);
        items.set([...data[i].scale, 0], base + 4);
        items.set(data[i].color, base + 8);
    }
    return items;
}

function writeCamera(timeMs) {
    const t = timeMs * 0.0002;
    const eye = [
        Math.sin(t) * 24,
        12,
        Math.cos(t) * 24,
    ];
    mat4Perspective(projectionMatrix, Math.PI / 4, canvas.width / canvas.height, 0.1, 150);
    mat4LookAt(viewMatrix, eye, [0, 4, 0], [0, 1, 0]);
    mat4Multiply(viewProjectionMatrix, projectionMatrix, viewMatrix);
    device.queue.writeBuffer(cameraBuffer, 0, viewProjectionMatrix);
}

function drawMesh(pass, mesh, instanceCount, firstInstance = 0) {
    pass.setVertexBuffer(0, mesh.positionBuffer);
    pass.setVertexBuffer(1, mesh.normalBuffer);
    pass.setVertexBuffer(2, mesh.uvBuffer);
    pass.setIndexBuffer(mesh.indexBuffer, 'uint16');
    pass.drawIndexed(mesh.indexCount, instanceCount, 0, 0, firstInstance);
}

function createDebugLineMeshes() {
    const boxLineVerts = new Float32Array([
        -0.5, -0.5, -0.5,   0.5, -0.5, -0.5,   0.5,  0.5, -0.5,  -0.5,  0.5, -0.5,
        -0.5, -0.5,  0.5,   0.5, -0.5,  0.5,   0.5,  0.5,  0.5,  -0.5,  0.5,  0.5,
    ]);
    const boxLineIndices = new Uint16Array([
        0, 1, 1, 2, 2, 3, 3, 0,
        4, 5, 5, 6, 6, 7, 7, 4,
        0, 4, 1, 5, 2, 6, 3, 7,
    ]);
    debugBoxIndexCount = boxLineIndices.length;
    debugBoxVertexBuffer = createVertexBuffer(boxLineVerts);
    debugBoxIndexBuffer = createIndexBuffer(boxLineIndices);

    const sphereSegments = 32;
    const sphereLineVerts = [];
    const sphereLineIndices = [];
    const rings = [[1, 0, 2], [0, 1, 2], [1, 2, 0]];
    for (let ring = 0; ring < 3; ring++) {
        const base = ring * sphereSegments;
        for (let i = 0; i < sphereSegments; i++) {
            const a = (i / sphereSegments) * Math.PI * 2;
            const v = [0, 0, 0];
            v[rings[ring][0]] = Math.cos(a);
            v[rings[ring][1]] = Math.sin(a);
            sphereLineVerts.push(...v);
            sphereLineIndices.push(base + i, base + ((i + 1) % sphereSegments));
        }
    }
    const sphereLineVertsF32 = new Float32Array(sphereLineVerts);
    const sphereLineIndicesU16 = new Uint16Array(sphereLineIndices);
    debugSphereIndexCount = sphereLineIndicesU16.length;
    debugSphereVertexBuffer = createVertexBuffer(sphereLineVertsF32);
    debugSphereIndexBuffer = createIndexBuffer(sphereLineIndicesU16);
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
        BASKET_HALF,
        BASKET_TOP,
        0.998,
        timeMs * 0.001,
        GROUND_HALF,
    ]));

    const encoder = device.createCommandEncoder();
    for (let s = 0; s < SUBSTEPS; s++) {
        const computePass = encoder.beginComputePass();
        computePass.setPipeline(computePipeline);
        computePass.setBindGroup(0, computeBindGroups[currentState]);
        computePass.dispatchWorkgroups(Math.ceil(BALL_COUNT / 64));
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
    renderPass.setBindGroup(0, renderBindGroups[currentState]);
    drawMesh(renderPass, sphereMesh, BALL_COUNT);
    drawMesh(renderPass, cubeMesh, STATIC_COUNT, BALL_COUNT);

    if (showWireframe) {
        renderPass.setPipeline(linePipeline);
        renderPass.setBindGroup(0, lineBindGroups[currentState]);

        renderPass.setVertexBuffer(0, debugBoxVertexBuffer);
        renderPass.setIndexBuffer(debugBoxIndexBuffer, 'uint16');
        renderPass.drawIndexed(debugBoxIndexCount, STATIC_COUNT, 0, 0, 0);

        renderPass.setVertexBuffer(0, debugSphereVertexBuffer);
        renderPass.setIndexBuffer(debugSphereIndexBuffer, 'uint16');
        renderPass.drawIndexed(debugSphereIndexCount, BALL_COUNT, 0, 0, STATIC_COUNT);
    }
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

    sphereMesh = createSphereGeometry();
    cubeMesh = createBoxGeometry();

    const initialStates = createInitialStates();
    for (let i = 0; i < 2; i++) {
        const buffer = device.createBuffer({
            size: BALL_COUNT * STATE_FLOATS * 4,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            mappedAtCreation: true,
        });
        new Float32Array(buffer.getMappedRange()).set(initialStates);
        buffer.unmap();
        stateBuffers.push(buffer);
    }

    ballInfoBuffer = device.createBuffer({
        size: BALL_COUNT * INFO_FLOATS * 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        mappedAtCreation: true,
    });
    new Float32Array(ballInfoBuffer.getMappedRange()).set(createBallInfos());
    ballInfoBuffer.unmap();

    staticBuffer = device.createBuffer({
        size: STATIC_COUNT * STATIC_FLOATS * 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        mappedAtCreation: true,
    });
    new Float32Array(staticBuffer.getMappedRange()).set(createStaticItems());
    staticBuffer.unmap();

    cameraBuffer = device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    simParamsBuffer = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    sampler = device.createSampler({
        addressModeU: 'clamp-to-edge',
        addressModeV: 'clamp-to-edge',
        magFilter: 'linear',
        minFilter: 'linear',
    });
    const texture = await createTextureAtlas();
    textureView = texture.createView();

    renderPipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: {
            module: device.createShaderModule({ code: vertexShaderWGSL }),
            entryPoint: 'main',
            buffers: [
                { arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] },
                { arrayStride: 12, attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x3' }] },
                { arrayStride: 8, attributes: [{ shaderLocation: 2, offset: 0, format: 'float32x2' }] },
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

    linePipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: {
            module: device.createShaderModule({ code: lineVertexShaderWGSL }),
            entryPoint: 'main',
            buffers: [{ arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] }],
        },
        fragment: {
            module: device.createShaderModule({ code: lineFragmentShaderWGSL }),
            entryPoint: 'main',
            targets: [{ format }],
        },
        primitive: { topology: 'line-list' },
        depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less-equal' },
    });

    computePipeline = device.createComputePipeline({
        layout: 'auto',
        compute: {
            module: device.createShaderModule({ code: computeShaderWGSL }),
            entryPoint: 'main',
        },
    });

    createDebugLineMeshes();

    for (let i = 0; i < 2; i++) {
        renderBindGroups.push(device.createBindGroup({
            layout: renderPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: cameraBuffer } },
                { binding: 1, resource: { buffer: stateBuffers[i] } },
                { binding: 2, resource: { buffer: ballInfoBuffer } },
                { binding: 3, resource: { buffer: staticBuffer } },
                { binding: 4, resource: sampler },
                { binding: 5, resource: textureView },
            ],
        }));

        computeBindGroups.push(device.createBindGroup({
            layout: computePipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: stateBuffers[i] } },
                { binding: 1, resource: { buffer: stateBuffers[1 - i] } },
                { binding: 2, resource: { buffer: ballInfoBuffer } },
                { binding: 3, resource: { buffer: simParamsBuffer } },
            ],
        }));

        lineBindGroups.push(device.createBindGroup({
            layout: linePipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: cameraBuffer } },
                { binding: 1, resource: { buffer: stateBuffers[i] } },
                { binding: 2, resource: { buffer: ballInfoBuffer } },
                { binding: 3, resource: { buffer: staticBuffer } },
            ],
        }));
    }

    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('keydown', event => {
        const isWKey = event.code === 'KeyW' || event.key === 'w' || event.key === 'W';
        if (!isWKey || event.repeat) return;
        showWireframe = !showWireframe;
        const hint = document.getElementById('hint');
        if (hint) hint.textContent = 'W: wireframe ' + (showWireframe ? 'ON' : 'OFF');
    });

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
