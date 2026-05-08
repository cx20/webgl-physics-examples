const computeShaderWGSL = document.getElementById('cs').textContent;
const vertexShaderWGSL  = document.getElementById('vs').textContent;
const fragmentShaderWGSL = document.getElementById('fs').textContent;

const canvas = document.getElementById('c');

const GROUND_Y   = -2.0;
const CUBE_HALF  = 2.5;
const CUBE_SIZE  = 5.0;
const GROUND_POS = [0, GROUND_Y - 0.5, 0];
const GROUND_SCL = [20, 1, 20];

const MASS      = 1.0;
// Moment of inertia for uniform cube: I = (1/6)*m*L²  →  I_inv = 6/(m*L²)
const CUBE_L    = CUBE_SIZE;
const I_INV     = 6.0 / (MASS * CUBE_L * CUBE_L);
const SUBSTEPS  = 4;

let device, context, format, depthTexture;
let pipeline;
let vertexBuffer, uvBuffer, indexBuffer;
let indexCount = 0;
let sampler, textureView;
let groundUniformBuffer, cubeUniformBuffer;
let groundBindGroup, cubeBindGroup;

let computePipeline, physicsBindGroup;
let physicsBuffer, readbackBuffer, simParamsBuffer;

let linePipeline;
let debugBoxVertexBuffer, debugBoxIndexBuffer;
let debugBoxIndexCount = 0;
let lineUniformBuffer, lineBindGroup;

const LINE_ALIGN       = 256;
const LINE_STRUCT_SIZE = 144;

const projMatrix  = mat4.create();
const viewMatrix  = mat4.create();
const vpMatrix    = mat4.create();
const modelMatrix = mat4.create();

let cubePos = [0, 12, 0];
let cubeRot = [0, 0, 0, 1];

let readbackBusy = false;
let lastTime     = -1;

function resize() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width  = Math.floor(window.innerWidth  * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    canvas.style.width  = window.innerWidth  + 'px';
    canvas.style.height = window.innerHeight + 'px';

    context.configure({ device, format, alphaMode: 'opaque' });

    depthTexture = device.createTexture({
        size:   { width: canvas.width, height: canvas.height },
        format: 'depth24plus',
        usage:  GPUTextureUsage.RENDER_ATTACHMENT,
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

    vertexBuffer = device.createBuffer({ size: positions.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(vertexBuffer, 0, positions);
    uvBuffer = device.createBuffer({ size: uvs.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(uvBuffer, 0, uvs);
    indexBuffer = device.createBuffer({ size: indices.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(indexBuffer, 0, indices);
    indexCount = indices.length;
}

async function createTextureFromImage(src) {
    const img = document.createElement('img');
    img.src = src;
    await img.decode();
    const bitmap = await createImageBitmap(img);
    const tex = device.createTexture({
        size:   [bitmap.width, bitmap.height, 1],
        format: 'rgba8unorm',
        usage:  GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    device.queue.copyExternalImageToTexture({ source: bitmap }, { texture: tex }, [bitmap.width, bitmap.height]);
    return tex;
}

function writeUniform(buffer, vpMat, modelMat) {
    const data = new Float32Array(32);
    data.set(vpMat, 0);
    data.set(modelMat, 16);
    device.queue.writeBuffer(buffer, 0, data);
}

function writeLineUniform(slotIndex, vpMat, modelMat, color) {
    const data = new Float32Array(LINE_ALIGN / 4);
    data.set(vpMat, 0);
    data.set(modelMat, 16);
    data[32] = color[0]; data[33] = color[1]; data[34] = color[2]; data[35] = color[3];
    device.queue.writeBuffer(lineUniformBuffer, slotIndex * LINE_ALIGN, data);
}

function frame(timeMs) {
    if (lastTime < 0) { lastTime = timeMs; }
    const dt = Math.min((timeMs - lastTime) / 1000, 1 / 30);
    lastTime = timeMs;

    // Sub-step dt so each compute pass sees a smaller time slice
    device.queue.writeBuffer(simParamsBuffer, 0, new Float32Array([
        dt / SUBSTEPS, 9.81, GROUND_Y, 0.5, CUBE_HALF, 0.5, MASS, I_INV,
    ]));

    const t   = timeMs * 0.001;
    const eye = [Math.sin(t * 0.3) * 35, 20, Math.cos(t * 0.3) * 35];
    mat4.perspective(projMatrix, Math.PI / 4, canvas.width / canvas.height, 0.1, 200);
    mat4.lookAt(viewMatrix, eye, [0, 3, 0], [0, 1, 0]);
    mat4.multiply(vpMatrix, projMatrix, viewMatrix);

    mat4.fromRotationTranslationScale(modelMatrix, [0,0,0,1], GROUND_POS, GROUND_SCL);
    writeUniform(groundUniformBuffer, vpMatrix, modelMatrix);

    mat4.fromRotationTranslationScale(modelMatrix, cubeRot, cubePos, [CUBE_SIZE, CUBE_SIZE, CUBE_SIZE]);
    writeUniform(cubeUniformBuffer, vpMatrix, modelMatrix);

    mat4.fromRotationTranslationScale(modelMatrix, [0,0,0,1], GROUND_POS, GROUND_SCL);
    writeLineUniform(0, vpMatrix, modelMatrix, [0, 1, 0, 1]);
    mat4.fromRotationTranslationScale(modelMatrix, cubeRot, cubePos, [CUBE_SIZE, CUBE_SIZE, CUBE_SIZE]);
    writeLineUniform(1, vpMatrix, modelMatrix, [1, 1, 0, 1]);

    const encoder = device.createCommandEncoder();

    // Run SUBSTEPS physics passes per render frame for stability
    for (let s = 0; s < SUBSTEPS; s++) {
        const cp = encoder.beginComputePass();
        cp.setPipeline(computePipeline);
        cp.setBindGroup(0, physicsBindGroup);
        cp.dispatchWorkgroups(1);
        cp.end();
    }

    if (!readbackBusy) {
        encoder.copyBufferToBuffer(physicsBuffer, 0, readbackBuffer, 0, 64);
    }

    {
        const pass = encoder.beginRenderPass({
            colorAttachments: [{
                view:       context.getCurrentTexture().createView(),
                clearValue: { r: 1, g: 1, b: 1, a: 1 },
                loadOp:     'clear',
                storeOp:    'store',
            }],
            depthStencilAttachment: {
                view:            depthTexture.createView(),
                depthClearValue: 1.0,
                depthLoadOp:     'clear',
                depthStoreOp:    'store',
            },
        });

        pass.setPipeline(pipeline);
        pass.setVertexBuffer(0, vertexBuffer);
        pass.setVertexBuffer(1, uvBuffer);
        pass.setIndexBuffer(indexBuffer, 'uint16');

        pass.setBindGroup(0, groundBindGroup);
        pass.drawIndexed(indexCount);

        pass.setBindGroup(0, cubeBindGroup);
        pass.drawIndexed(indexCount);

        pass.setPipeline(linePipeline);
        pass.setVertexBuffer(0, debugBoxVertexBuffer);
        pass.setIndexBuffer(debugBoxIndexBuffer, 'uint16');
        pass.setBindGroup(0, lineBindGroup, [0 * LINE_ALIGN]);
        pass.drawIndexed(debugBoxIndexCount);
        pass.setBindGroup(0, lineBindGroup, [1 * LINE_ALIGN]);
        pass.drawIndexed(debugBoxIndexCount);

        pass.end();
    }

    device.queue.submit([encoder.finish()]);

    if (!readbackBusy) {
        readbackBusy = true;
        readbackBuffer.mapAsync(GPUMapMode.READ).then(() => {
            const data = new Float32Array(readbackBuffer.getMappedRange().slice(0));
            readbackBuffer.unmap();
            cubePos[0] = data[0]; cubePos[1] = data[1]; cubePos[2] = data[2];
            cubeRot[0] = data[8]; cubeRot[1] = data[9]; cubeRot[2] = data[10]; cubeRot[3] = data[11];
            readbackBusy = false;
        }).catch(() => { readbackBusy = false; });
    }

    requestAnimationFrame(frame);
}

async function init() {
    if (!navigator.gpu) throw new Error('WebGPU not supported.');
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('No GPU adapter found.');
    device  = await adapter.requestDevice();
    context = canvas.getContext('webgpu');
    format  = navigator.gpu.getPreferredCanvasFormat();

    pipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: {
            module:     device.createShaderModule({ code: vertexShaderWGSL }),
            entryPoint: 'main',
            buffers: [
                { arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] },
                { arrayStride:  8, attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x2' }] },
            ],
        },
        fragment: {
            module:     device.createShaderModule({ code: fragmentShaderWGSL }),
            entryPoint: 'main',
            targets:    [{ format }],
        },
        primitive:    { topology: 'triangle-list', cullMode: 'none' },
        depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
    });

    const lineBindGroupLayout = device.createBindGroupLayout({
        entries: [{
            binding:    0,
            visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
            buffer:     { type: 'uniform', hasDynamicOffset: true, minBindingSize: LINE_STRUCT_SIZE },
        }],
    });
    linePipeline = device.createRenderPipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [lineBindGroupLayout] }),
        vertex: {
            module:     device.createShaderModule({ code: document.getElementById('vs-line').textContent }),
            entryPoint: 'main',
            buffers:    [{ arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] }],
        },
        fragment: {
            module:     device.createShaderModule({ code: document.getElementById('fs-line').textContent }),
            entryPoint: 'main',
            targets:    [{ format }],
        },
        primitive:    { topology: 'line-list', cullMode: 'none' },
        depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
    });

    const boxPositions  = new Float32Array([
        -0.5,-0.5,-0.5,  0.5,-0.5,-0.5,  0.5, 0.5,-0.5, -0.5, 0.5,-0.5,
        -0.5,-0.5, 0.5,  0.5,-0.5, 0.5,  0.5, 0.5, 0.5, -0.5, 0.5, 0.5,
    ]);
    const boxLineIndices = new Uint16Array([0,1,1,2,2,3,3,0, 4,5,5,6,6,7,7,4, 0,4,1,5,2,6,3,7]);
    debugBoxVertexBuffer = device.createBuffer({ size: boxPositions.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(debugBoxVertexBuffer, 0, boxPositions);
    debugBoxIndexBuffer = device.createBuffer({ size: boxLineIndices.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(debugBoxIndexBuffer, 0, boxLineIndices);
    debugBoxIndexCount = boxLineIndices.length;

    lineUniformBuffer = device.createBuffer({ size: 2 * LINE_ALIGN, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    lineBindGroup = device.createBindGroup({
        layout:  lineBindGroupLayout,
        entries: [{ binding: 0, resource: { buffer: lineUniformBuffer, size: LINE_STRUCT_SIZE } }],
    });

    computePipeline = device.createComputePipeline({
        layout:  'auto',
        compute: { module: device.createShaderModule({ code: computeShaderWGSL }), entryPoint: 'main' },
    });

    const initialPhysics = new Float32Array([
        0, 12, 0, 0,    // position xyz, pad
        0,  0, 0, 0,    // velocity xyz, pad
        0,  0, 0, 1,    // rotation quaternion xyzw (identity)
        0.3, 0.8, 0.2, 0, // angularVel xyz, pad
    ]);
    physicsBuffer = device.createBuffer({
        size:             initialPhysics.byteLength,
        usage:            GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
        mappedAtCreation: true,
    });
    new Float32Array(physicsBuffer.getMappedRange()).set(initialPhysics);
    physicsBuffer.unmap();

    readbackBuffer  = device.createBuffer({ size: 64, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    simParamsBuffer = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    physicsBindGroup = device.createBindGroup({
        layout:  computePipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: physicsBuffer } },
            { binding: 1, resource: { buffer: simParamsBuffer } },
        ],
    });

    createBoxGeometry();

    const tex = await createTextureFromImage('../../../../assets/textures/frog.jpg');
    textureView = tex.createView();
    sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });

    groundUniformBuffer = device.createBuffer({ size: 128, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    cubeUniformBuffer   = device.createBuffer({ size: 128, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    groundBindGroup = device.createBindGroup({
        layout:  pipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: groundUniformBuffer } },
            { binding: 1, resource: sampler },
            { binding: 2, resource: textureView },
        ],
    });
    cubeBindGroup = device.createBindGroup({
        layout:  pipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: cubeUniformBuffer } },
            { binding: 1, resource: sampler },
            { binding: 2, resource: textureView },
        ],
    });

    resize();
    window.addEventListener('resize', resize);

    requestAnimationFrame(frame);
}

init().catch(err => console.error(err));
