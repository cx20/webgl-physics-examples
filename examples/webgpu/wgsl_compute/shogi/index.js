'use strict';

const computeShaderWGSL  = document.getElementById('cs').textContent;
const vertexShaderWGSL   = document.getElementById('vs').textContent;
const fragmentShaderWGSL = document.getElementById('fs').textContent;
const groundVertWGSL     = document.getElementById('gvs').textContent;
const groundFragWGSL     = document.getElementById('gfs').textContent;
const wireVertWGSL       = document.getElementById('wvs').textContent;
const wireFragWGSL       = document.getElementById('wfs').textContent;

// ------------------------------------------------------------------ constants
const COUNT       = 300;
const STATE_FLOATS = 16;   // 4 × vec4<f32>
const SUBSTEPS    = 4;

// Piece geometry dimensions (identical to Havok version)
const DOT_SIZE = 2;
const pw = DOT_SIZE * 0.8 * 1.0;   // 1.6
const ph = DOT_SIZE * 0.8 * 1.0;   // 1.6
const pd = DOT_SIZE * 0.8 * 0.2;   // 0.32

// ------------------------------------------------------------------ geometry (identical to Havok version)
const positions = new Float32Array([
    // Front face
    -0.5*pw, -0.5*ph,  0.7*pd,
     0.5*pw, -0.5*ph,  0.7*pd,
     0.35*pw, 0.5*ph,  0.4*pd,
    -0.35*pw, 0.5*ph,  0.4*pd,
    // Back face
    -0.5*pw, -0.5*ph, -0.7*pd,
     0.5*pw, -0.5*ph, -0.7*pd,
     0.35*pw, 0.5*ph, -0.4*pd,
    -0.35*pw, 0.5*ph, -0.4*pd,
    // Top face
     0.35*pw, 0.5*ph,  0.4*pd,
    -0.35*pw, 0.5*ph,  0.4*pd,
    -0.35*pw, 0.5*ph, -0.4*pd,
     0.35*pw, 0.5*ph, -0.4*pd,
    // Bottom face
    -0.5*pw, -0.5*ph,  0.7*pd,
     0.5*pw, -0.5*ph,  0.7*pd,
     0.5*pw, -0.5*ph, -0.7*pd,
    -0.5*pw, -0.5*ph, -0.7*pd,
    // Right face
     0.5*pw, -0.5*ph,  0.7*pd,
     0.35*pw, 0.5*ph,  0.4*pd,
     0.35*pw, 0.5*ph, -0.4*pd,
     0.5*pw, -0.5*ph, -0.7*pd,
    // Left face
    -0.5*pw, -0.5*ph,  0.7*pd,
    -0.35*pw, 0.5*ph,  0.4*pd,
    -0.35*pw, 0.5*ph, -0.4*pd,
    -0.5*pw, -0.5*ph, -0.7*pd,
    // Front2 face
    -0.35*pw, 0.5*ph,  0.4*pd,
     0.35*pw, 0.5*ph,  0.4*pd,
     0.0*pw,  0.6*ph,  0.35*pd,
    // Back2 face
    -0.35*pw, 0.5*ph, -0.4*pd,
     0.35*pw, 0.5*ph, -0.4*pd,
     0.0*pw,  0.6*ph, -0.35*pd,
    // Right2 face
     0.35*pw, 0.5*ph,  0.4*pd,
     0.35*pw, 0.5*ph, -0.4*pd,
     0.0*pw,  0.6*ph, -0.35*pd,
     0.0*pw,  0.6*ph,  0.35*pd,
    // Left2 face
    -0.35*pw, 0.5*ph,  0.4*pd,
    -0.35*pw, 0.5*ph, -0.4*pd,
     0.0*pw,  0.6*ph, -0.35*pd,
     0.0*pw,  0.6*ph,  0.35*pd
]);

const normals = new Float32Array([
    // Front face
     0,  0.0599,  0.9982,   0,  0.0599,  0.9982,   0,  0.0599,  0.9982,   0,  0.0599,  0.9982,
    // Back face
     0, -0.0599, -0.9982,   0, -0.0599, -0.9982,   0, -0.0599, -0.9982,   0, -0.0599, -0.9982,
    // Top face
     0,  1,  0,   0,  1,  0,   0,  1,  0,   0,  1,  0,
    // Bottom face
     0, -1,  0,   0, -1,  0,   0, -1,  0,   0, -1,  0,
    // Right face
     0.9889,  0.1483,  0,   0.9889,  0.1483,  0,   0.9889,  0.1483,  0,   0.9889,  0.1483,  0,
    // Left face
    -0.9889,  0.1483,  0,  -0.9889,  0.1483,  0,  -0.9889,  0.1483,  0,  -0.9889,  0.1483,  0,
    // Front2 face
     0,  0.0995,  0.995,   0,  0.0995,  0.995,   0,  0.0995,  0.995,
    // Back2 face
     0, -0.0995, -0.995,   0, -0.0995, -0.995,   0, -0.0995, -0.995,
    // Right2 face
     0.2747,  0.9615,  0,   0.2747,  0.9615,  0,   0.2747,  0.9615,  0,   0.2747,  0.9615,  0,
    // Left2 face
    -0.2747,  0.9615,  0,  -0.2747,  0.9615,  0,  -0.2747,  0.9615,  0,  -0.2747,  0.9615,  0
]);

const texCoords = new Float32Array([
    // Front face
    0.5,         0.5,
    0.75,        0.5,
    0.75-0.25/8, 1.0,
    0.5+0.25/8,  1.0,
    // Back face
    0.5,         0.5,
    0.25,        0.5,
    0.25+0.25/8, 1.0,
    0.5-0.25/8,  1.0,
    // Top face
    0.75, 0.5,
    0.5,  0.5,
    0.5,  0.0,
    0.75, 0.0,
    // Bottom face
    0.0,  0.5,
    0.25, 0.5,
    0.25, 1.0,
    0.0,  1.0,
    // Right face
    0.0,  0.5,
    0.0,  0.0,
    0.25, 0.0,
    0.25, 0.5,
    // Left face
    0.5,  0.5,
    0.5,  0.0,
    0.25, 0.0,
    0.25, 0.5,
    // Front2 face
    0.75, 0.0,
    1.0,  0.0,
    1.0,  0.5,
    // Back2 face
    0.75, 0.0,
    1.0,  0.0,
    1.0,  0.5,
    // Right2 face
    0.75, 0.0,
    1.0,  0.0,
    1.0,  0.5,
    0.75, 0.5,
    // Left2 face
    0.75, 0.0,
    1.0,  0.0,
    1.0,  0.5,
    0.75, 0.5
]);

const indices = new Uint16Array([
     0,  1,  2,   0,  2,  3,
     4,  5,  6,   4,  6,  7,
     8,  9, 10,   8, 10, 11,
    12, 13, 14,  12, 14, 15,
    16, 17, 18,  16, 18, 19,
    20, 21, 22,  20, 22, 23,
    24, 25, 26,
    27, 28, 29,
    30, 33, 31,  33, 32, 31,
    34, 35, 36,  34, 36, 37
]);

// ------------------------------------------------------------------ state init
function hash32(n) {
    let x = ((n >>> 0) ^ (n >>> 17)) >>> 0;
    x = Math.imul(x, 0xbf324c81) >>> 0;
    x = (x ^ (x >>> 11)) >>> 0;
    x = Math.imul(x, 0x68b665e5) >>> 0;
    x = (x ^ (x >>> 16)) >>> 0;
    return x;
}
function hashF(n) { return (hash32(n) & 0xffffff) / 0xffffff; }

function createInitialStates() {
    const states = new Float32Array(COUNT * STATE_FLOATS);
    const statesU = new Uint32Array(states.buffer);
    for (let i = 0; i < COUNT; i++) {
        const base = i * STATE_FLOATS;
        const seed = hash32(i + 1);
        states[base + 0] = (hashF(seed)     - 0.5) * 15;  // x
        states[base + 1] = (hashF(seed + 1) + 1.0) * 15;  // y (15..30)
        states[base + 2] = (hashF(seed + 2) - 0.5) * 15;  // z
        statesU[base + 3] = seed;                          // seed as uint32 bits
        // rotation: identity (qw=1)
        states[base + 11] = 1.0;
        // Initial angular velocity: random tumble so pieces tip on landing
        states[base + 12] = (hashF(seed + 3) - 0.5) * 6;
        states[base + 13] = (hashF(seed + 4) - 0.5) * 2;
        states[base + 14] = (hashF(seed + 5) - 0.5) * 6;
    }
    return states;
}

// ------------------------------------------------------------------ mat4 helpers (matching Havok version)
function makePerspective(fovy, aspect, near, far) {
    const top   = near * Math.tan(fovy * Math.PI / 360.0);
    const right = top * aspect;
    const u = right * 2, v = top * 2, ww = far - near;
    return new Float32Array([
        near*2/u, 0,         0,                  0,
        0,        near*2/v,  0,                  0,
        0,        0,        -(far+near)/ww,      -1,
        0,        0,        -(far*near*2)/ww,     0
    ]);
}

function mat4mul(a, b) {
    const r = new Float32Array(16);
    for (let c = 0; c < 4; c++)
        for (let row = 0; row < 4; row++) {
            let s = 0;
            for (let k = 0; k < 4; k++) s += a[k*4+row] * b[c*4+k];
            r[c*4+row] = s;
        }
    return r;
}

// ------------------------------------------------------------------ WebGPU helpers
let device;

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

async function createTextureFromImage(src) {
    const img = document.createElement('img');
    img.src = src;
    await img.decode();
    const bitmap = await createImageBitmap(img);
    const tex = device.createTexture({
        size: [bitmap.width, bitmap.height, 1],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
    });
    device.queue.copyExternalImageToTexture({ source: bitmap }, { texture: tex }, [bitmap.width, bitmap.height, 1]);
    return tex;
}

function createDepthTexture() {
    return device.createTexture({
        size: { width: canvas.width, height: canvas.height, depthOrArrayLayers: 1 },
        format: 'depth24plus',
        usage: GPUTextureUsage.RENDER_ATTACHMENT
    });
}

// ------------------------------------------------------------------ globals
const canvas = document.getElementById('c');
let ctx, format, depthTexture;
let positionBuffer, normalBuffer, texCoordBuffer, indexBuffer, indexNum;
let uniformBuffer, renderBindGroupA, renderBindGroupB, pipeline;
let groundPipeline, groundVBuffer, groundIBuffer, groundMVPBuffer, groundBindGroup, groundICount;
let wirePipeline, wireVBuffer, wireIBuffer, wireICount;
let wireBindGroupA, wireBindGroupB;
let showWireframe = false;
let srcBuffer, dstBuffer;
let computePipeline, computeBindGroupA, computeBindGroupB;
let simParamsBuffer;
let currentPMatrix = null;
let ping = 0;

// ------------------------------------------------------------------ resize
function resize() {
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
    if (depthTexture) depthTexture.destroy();
    depthTexture = createDepthTexture();
    if (device && uniformBuffer) {
        currentPMatrix = makePerspective(45, canvas.width / canvas.height, 0.1, 1000.0);
        device.queue.writeBuffer(uniformBuffer, 0, currentPMatrix);
    }
}

// ------------------------------------------------------------------ render loop
function render() {
    const encoder = device.createCommandEncoder();

    // --- Compute substeps (ping-pong) ---
    for (let s = 0; s < SUBSTEPS; s++) {
        const cp = encoder.beginComputePass();
        cp.setPipeline(computePipeline);
        cp.setBindGroup(0, ping === 0 ? computeBindGroupA : computeBindGroupB);
        cp.dispatchWorkgroups(Math.ceil(COUNT / 64));
        cp.end();
        ping ^= 1;
    }

    // After SUBSTEPS (even number) ping is back to 0: latest state is in srcBuffer
    // renderBindGroupA reads srcBuffer, renderBindGroupB reads dstBuffer
    const renderBG = (ping === 0) ? renderBindGroupA : renderBindGroupB;

    const pass = encoder.beginRenderPass({
        colorAttachments: [{
            view:       ctx.getCurrentTexture().createView(),
            loadOp:     'clear',
            clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
            storeOp:    'store',
        }],
        depthStencilAttachment: {
            view:            depthTexture.createView(),
            depthClearValue: 1.0,
            depthLoadOp:     'clear',
            depthStoreOp:    'store',
        }
    });

    // Draw ground
    pass.setPipeline(groundPipeline);
    pass.setVertexBuffer(0, groundVBuffer);
    pass.setIndexBuffer(groundIBuffer, 'uint16');
    pass.setBindGroup(0, groundBindGroup);
    pass.drawIndexed(groundICount, 1, 0, 0, 0);

    // Draw shogi pieces
    pass.setPipeline(pipeline);
    pass.setVertexBuffer(0, positionBuffer);
    pass.setVertexBuffer(1, normalBuffer);
    pass.setVertexBuffer(2, texCoordBuffer);
    pass.setBindGroup(0, renderBG);
    pass.setIndexBuffer(indexBuffer, 'uint16');
    pass.drawIndexed(indexNum, COUNT, 0, 0, 0);

    // Wireframe OBB debug
    if (showWireframe) {
        const wireBG = (ping === 0) ? wireBindGroupA : wireBindGroupB;
        pass.setPipeline(wirePipeline);
        pass.setVertexBuffer(0, wireVBuffer);
        pass.setIndexBuffer(wireIBuffer, 'uint16');
        pass.setBindGroup(0, wireBG);
        pass.drawIndexed(wireICount, COUNT, 0, 0, 0);
    }

    pass.end();
    device.queue.submit([encoder.finish()]);
    requestAnimationFrame(render);
}

// ------------------------------------------------------------------ init
async function init() {
    const gpu = navigator.gpu;
    if (!gpu) { alert('WebGPU is not supported.'); return; }
    const adapter = await gpu.requestAdapter();
    if (!adapter) { alert('Failed to get GPU adapter.'); return; }
    device = await adapter.requestDevice();

    ctx    = canvas.getContext('webgpu');
    format = gpu.getPreferredCanvasFormat();
    ctx.configure({ device, format, alphaMode: 'opaque' });

    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
    window.addEventListener('resize', resize);

    // --- Geometry ---
    positionBuffer = makeVertexBuffer(positions);
    normalBuffer   = makeVertexBuffer(normals);
    texCoordBuffer = makeVertexBuffer(texCoords);
    indexBuffer    = makeIndexBuffer(indices);
    indexNum       = indices.length;

    // --- Uniform: perspective matrix ---
    uniformBuffer  = device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    currentPMatrix = makePerspective(45, canvas.width / canvas.height, 0.1, 1000.0);
    device.queue.writeBuffer(uniformBuffer, 0, currentPMatrix);

    // --- Texture ---
    const shogiTexture = await createTextureFromImage('../../../../assets/textures/shogi_001/shogi.png');
    const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });

    // --- Render pipeline ---
    pipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: {
            module: device.createShaderModule({ code: vertexShaderWGSL }),
            entryPoint: 'main',
            buffers: [
                { arrayStride: 3*4, stepMode: 'vertex',   attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] },
                { arrayStride: 3*4, stepMode: 'vertex',   attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x3' }] },
                { arrayStride: 2*4, stepMode: 'vertex',   attributes: [{ shaderLocation: 2, offset: 0, format: 'float32x2' }] },
            ]
        },
        fragment: {
            module: device.createShaderModule({ code: fragmentShaderWGSL }),
            entryPoint: 'main',
            targets: [{ format }]
        },
        primitive:    { topology: 'triangle-list' },
        depthStencil: { depthWriteEnabled: true, depthCompare: 'less', format: 'depth24plus' }
    });

    // State buffers (ping-pong)
    simParamsBuffer = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    const stateBufSize = COUNT * STATE_FLOATS * 4;
    srcBuffer = device.createBuffer({
        size: stateBufSize,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        mappedAtCreation: true,
    });
    new Float32Array(srcBuffer.getMappedRange()).set(createInitialStates());
    srcBuffer.unmap();

    dstBuffer = device.createBuffer({
        size: stateBufSize,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    // Render bind groups: A reads srcBuffer, B reads dstBuffer
    const textureView = shogiTexture.createView();
    function makeRenderBG(stateBuf) {
        return device.createBindGroup({
            layout: pipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: uniformBuffer } },
                { binding: 1, resource: sampler },
                { binding: 2, resource: textureView },
                { binding: 3, resource: { buffer: stateBuf } },
            ]
        });
    }
    renderBindGroupA = makeRenderBG(srcBuffer);
    renderBindGroupB = makeRenderBG(dstBuffer);

    computePipeline = device.createComputePipeline({
        layout: 'auto',
        compute: { module: device.createShaderModule({ code: computeShaderWGSL }), entryPoint: 'main' }
    });

    // Sim params: dt, gravity, groundY (top of floor = -10+0.1), damping, angDamping, restitution, friction, spawnRange
    device.queue.writeBuffer(simParamsBuffer, 0, new Float32Array([
        1 / (60 * SUBSTEPS),  // dt per substep (placeholder, fixed at 60fps)
        9.8,                  // gravity
        -9.9,                 // groundY  (floor top surface)
        0.9992,               // linear damping
        0.992,                // angular damping
        0.35,                 // restitution
        0.82,                 // friction
        15.0,                 // spawnRange (x/z)
    ]));

    computeBindGroupA = device.createBindGroup({
        layout: computePipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: srcBuffer } },
            { binding: 1, resource: { buffer: dstBuffer } },
            { binding: 2, resource: { buffer: simParamsBuffer } },
        ],
    });
    computeBindGroupB = device.createBindGroup({
        layout: computePipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: dstBuffer } },
            { binding: 1, resource: { buffer: srcBuffer } },
            { binding: 2, resource: { buffer: simParamsBuffer } },
        ],
    });

    // --- Ground geometry (same as Havok) ---
    const groundPositions = new Float32Array([
        -6.5,  0.05, -6.5,  6.5,  0.05, -6.5,  6.5,  0.05,  6.5, -6.5,  0.05,  6.5,
        -6.5, -0.05, -6.5,  6.5, -0.05, -6.5,  6.5, -0.05,  6.5, -6.5, -0.05,  6.5,
        -6.5, -0.05,  6.5,  6.5, -0.05,  6.5,  6.5,  0.05,  6.5, -6.5,  0.05,  6.5,
        -6.5, -0.05, -6.5,  6.5, -0.05, -6.5,  6.5,  0.05, -6.5, -6.5,  0.05, -6.5,
         6.5, -0.05, -6.5,  6.5, -0.05,  6.5,  6.5,  0.05,  6.5,  6.5,  0.05, -6.5,
        -6.5, -0.05, -6.5, -6.5, -0.05,  6.5, -6.5,  0.05,  6.5, -6.5,  0.05, -6.5
    ]);
    const groundIdx = new Uint16Array([
         0, 1, 2,  0, 2, 3,
         4, 7, 6,  4, 6, 5,
         8, 9,10,  8,10,11,
        12,15,14, 12,14,13,
        16,17,18, 16,18,19,
        20,23,22, 20,22,21
    ]);
    groundICount  = groundIdx.length;
    groundVBuffer = makeVertexBuffer(groundPositions);
    groundIBuffer = makeIndexBuffer(groundIdx);

    groundMVPBuffer = device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const gvPipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: {
            module: device.createShaderModule({ code: groundVertWGSL }),
            entryPoint: 'main',
            buffers: [{ arrayStride: 3*4, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] }]
        },
        fragment: { module: device.createShaderModule({ code: groundFragWGSL }), entryPoint: 'main', targets: [{ format }] },
        primitive:    { topology: 'triangle-list' },
        depthStencil: { depthWriteEnabled: true, depthCompare: 'less', format: 'depth24plus' }
    });
    groundPipeline = gvPipeline;
    groundBindGroup = device.createBindGroup({
        layout: groundPipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: groundMVPBuffer } }]
    });

    // Ground MVP (static: camera at [0,0,40], ground at y=-10)
    const vMat = new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,-40,1]);
    const mMat = new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,-10,0,1]);
    const groundMVP = mat4mul(mat4mul(currentPMatrix, vMat), mMat);
    device.queue.writeBuffer(groundMVPBuffer, 0, groundMVP);

    depthTexture = createDepthTexture();

    // --- Wireframe OBB geometry ---
    // HW=0.80, HH=0.96, HD=0.224 (matches compute shader constants)
    const WH = 0.80, WV = 0.96, WD = 0.224;
    const wirePos = new Float32Array([
        -WH, -WV, -WD,   // 0
         WH, -WV, -WD,   // 1
         WH,  WV, -WD,   // 2
        -WH,  WV, -WD,   // 3
        -WH, -WV,  WD,   // 4
         WH, -WV,  WD,   // 5
         WH,  WV,  WD,   // 6
        -WH,  WV,  WD,   // 7
    ]);
    const wireIdx = new Uint16Array([
        0,1, 1,2, 2,3, 3,0,  // back face
        4,5, 5,6, 6,7, 7,4,  // front face
        0,4, 1,5, 2,6, 3,7   // connecting edges
    ]);
    wireICount  = wireIdx.length;
    wireVBuffer = makeVertexBuffer(wirePos);
    wireIBuffer = makeIndexBuffer(wireIdx);

    wirePipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: {
            module:      device.createShaderModule({ code: wireVertWGSL }),
            entryPoint:  'main',
            buffers: [{ arrayStride: 3*4, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] }]
        },
        fragment: {
            module:     device.createShaderModule({ code: wireFragWGSL }),
            entryPoint: 'main',
            targets:    [{ format }]
        },
        primitive:    { topology: 'line-list' },
        depthStencil: { depthWriteEnabled: false, depthCompare: 'less-equal', format: 'depth24plus' }
    });
    const wireBGL = wirePipeline.getBindGroupLayout(0);
    wireBindGroupA = device.createBindGroup({
        layout: wireBGL,
        entries: [
            { binding: 0, resource: { buffer: uniformBuffer } },
            { binding: 1, resource: { buffer: srcBuffer } }
        ]
    });
    wireBindGroupB = device.createBindGroup({
        layout: wireBGL,
        entries: [
            { binding: 0, resource: { buffer: uniformBuffer } },
            { binding: 1, resource: { buffer: dstBuffer } }
        ]
    });

    // Toggle wireframe with W key
    window.addEventListener('keydown', e => {
        if (e.key.toLowerCase() !== 'w' || e.repeat) return;
        showWireframe = !showWireframe;
        document.getElementById('hint').textContent = 'W: wireframe ' + (showWireframe ? 'ON' : 'OFF');
    });

    requestAnimationFrame(render);
}

init().catch(err => { console.error(err); alert(err.message); });
