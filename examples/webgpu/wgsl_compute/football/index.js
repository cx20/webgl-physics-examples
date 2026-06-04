const computeShaderWGSL = document.getElementById('cs').textContent;
const clearGridShaderWGSL = document.getElementById('cs-clear').textContent;
const buildGridShaderWGSL = document.getElementById('cs-build').textContent;
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
const STATE_FLOATS = 16;
// The grid broad-phase keeps contacts stable. Restitution is kept moderate so dense piles
// settle without exploding, while damping stays light (~0.995/frame after SUBSTEPS) so the
// balls keep a lively bounce instead of feeling viscous.
const SUBSTEPS = 5;
const RADIUS = 0.5;
const GROUND_Y = -2.0;
const GROUND_HALF = 15.0;
const SPAWN_Y_OFFSET = 4.0;
const RESTITUTION = 0.68;
// Moderate rolling resistance: low enough that balls keep horizontal velocity and visibly
// roll after landing, high enough that they come to rest within the containment walls
// instead of sloshing forever.
const FRICTION = 0.02;
const LINEAR_DAMPING = 0.999;

// Uniform spatial grid for broad-phase collision (mirrors the WGSL constants in index.html;
// CELL_SIZE is computed from the ball radius and injected into the shaders).
const GRID_X = 64, GRID_Y = 64, GRID_Z = 64;
const CELL_CAPACITY = 12;
const GRID_SLOTS = GRID_X * GRID_Y * GRID_Z * (CELL_CAPACITY + 1);

let device, context, format, depthTexture;
let renderPipeline, computePipeline, clearGridPipeline, buildGridPipeline;
let sphereMesh, groundMesh;
let cameraBuffer, colorBuffer, simParamsBuffer, gridBuffer;
let sampler, textureView;
let stateBuffers = [];
let renderBindGroups = [];
let computeBindGroups = [];
let buildGridBindGroups = [];
let clearGridBindGroup;
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

function createGroundGeometry() {
    const positions = new Float32Array([
        -0.5, 0.0, -0.5,
         0.5, 0.0, -0.5,
         0.5, 0.0,  0.5,
        -0.5, 0.0,  0.5,
    ]);
    const normals = new Float32Array([
        0, 1, 0,
        0, 1, 0,
        0, 1, 0,
        0, 1, 0,
    ]);
    const uvs = new Float32Array([
        0, 0,
        1, 0,
        1, 1,
        0, 1,
    ]);
    const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);
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

async function createTextureFromImage(src) {
    const img = document.createElement('img');
    img.src = src;
    await img.decode();
    const bitmap = await createImageBitmap(img);
    const tex = device.createTexture({
        size: [bitmap.width, bitmap.height, 1],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    device.queue.copyExternalImageToTexture({ source: bitmap }, { texture: tex }, [bitmap.width, bitmap.height]);
    return tex;
}

function createInitialStates() {
    const states = new Float32Array(INSTANCE_COUNT * STATE_FLOATS);
    let i = 0;

    for (let rowIndex = 0; rowIndex < ROWS.length; rowIndex++) {
        const row = ROWS[rowIndex];
        for (let col = 0; col < row.length; col++) {
            const base = i * STATE_FLOATS;
            const seed = ((col * 17 + rowIndex * 31) % 97) / 97;
            states[base + 0] = -10 + col * 1.5 + seed * 0.08;
            states[base + 1] = SPAWN_Y_OFFSET + (ROWS.length - 1 - rowIndex) * 1.2 + seed * 0.08;
            states[base + 2] = seed * 0.12;
            states[base + 3] = seed;
            states[base + 4] = ((col % 3) - 1) * 0.035;
            states[base + 5] = -0.05;
            states[base + 6] = ((rowIndex % 3) - 1) * 0.03;
            states[base + 8] = 0;
            states[base + 9] = 0;
            states[base + 10] = 0;
            states[base + 11] = 1;
            states[base + 12] = seed * 0.6;
            states[base + 13] = seed * 0.3;
            states[base + 14] = -seed * 0.4;
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
    colors.set([0.36, 0.56, 0.34, 1.0], COUNT * 4);
    return colors;
}

function writeCamera(timeMs) {
    const t = timeMs * 0.0002;
    const eye = [
        Math.sin(t) * 20,
        10,
        Math.cos(t) * 20,
    ];
    mat4Perspective(projectionMatrix, Math.PI / 4, canvas.width / canvas.height, 0.1, 120);
    mat4LookAt(viewMatrix, eye, [0, 8, 0], [0, 1, 0]);
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
        RESTITUTION,
        LINEAR_DAMPING,
        FRICTION,
        RADIUS,
        timeMs * 0.001,
        GROUND_HALF,
        0,
        0,
        0,
    ]));

    const encoder = device.createCommandEncoder();
    const ballWorkgroups = Math.ceil(COUNT / 64);
    const gridWorkgroups = Math.ceil(GRID_SLOTS / 64);
    for (let s = 0; s < SUBSTEPS; s++) {
        // Rebuild the spatial grid from the current (src) state, then step the physics.
        const clearPass = encoder.beginComputePass();
        clearPass.setPipeline(clearGridPipeline);
        clearPass.setBindGroup(0, clearGridBindGroup);
        clearPass.dispatchWorkgroups(gridWorkgroups);
        clearPass.end();

        const buildPass = encoder.beginComputePass();
        buildPass.setPipeline(buildGridPipeline);
        buildPass.setBindGroup(0, buildGridBindGroups[currentState]);
        buildPass.dispatchWorkgroups(ballWorkgroups);
        buildPass.end();

        const computePass = encoder.beginComputePass();
        computePass.setPipeline(computePipeline);
        computePass.setBindGroup(0, computeBindGroups[currentState]);
        computePass.dispatchWorkgroups(ballWorkgroups);
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
    drawMesh(renderPass, sphereMesh, COUNT);
    drawMesh(renderPass, groundMesh, 1, COUNT);
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
    groundMesh = createGroundGeometry();

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
    simParamsBuffer = device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    gridBuffer = device.createBuffer({ size: GRID_SLOTS * 4, usage: GPUBufferUsage.STORAGE });

    // Grid cell size must cover the ball diameter so the 3x3x3 neighbour scan catches every
    // overlapping pair; inject it into the compute and grid-build shaders.
    const cellSize = Math.max(1.2, RADIUS * 2 * 1.15).toFixed(4);
    const computeCode = computeShaderWGSL.replaceAll('__CELL_SIZE__', cellSize);
    const buildGridCode = buildGridShaderWGSL.replaceAll('__CELL_SIZE__', cellSize);

    sampler = device.createSampler({
        addressModeU: 'repeat',
        addressModeV: 'repeat',
        magFilter: 'linear',
        minFilter: 'linear',
    });
    const texture = await createTextureFromImage('../../../../assets/textures/Football.jpg');
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

    computePipeline = device.createComputePipeline({
        layout: 'auto',
        compute: {
            module: device.createShaderModule({ code: computeCode }),
            entryPoint: 'main',
        },
    });
    clearGridPipeline = device.createComputePipeline({
        layout: 'auto',
        compute: { module: device.createShaderModule({ code: clearGridShaderWGSL }), entryPoint: 'main' },
    });
    buildGridPipeline = device.createComputePipeline({
        layout: 'auto',
        compute: { module: device.createShaderModule({ code: buildGridCode }), entryPoint: 'main' },
    });
    clearGridBindGroup = device.createBindGroup({
        layout: clearGridPipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: gridBuffer } }],
    });

    for (let i = 0; i < 2; i++) {
        renderBindGroups.push(device.createBindGroup({
            layout: renderPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: cameraBuffer } },
                { binding: 1, resource: { buffer: stateBuffers[i] } },
                { binding: 2, resource: { buffer: colorBuffer } },
                { binding: 3, resource: sampler },
                { binding: 4, resource: textureView },
            ],
        }));

        computeBindGroups.push(device.createBindGroup({
            layout: computePipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: stateBuffers[i] } },
                { binding: 1, resource: { buffer: stateBuffers[1 - i] } },
                { binding: 2, resource: { buffer: simParamsBuffer } },
                { binding: 3, resource: { buffer: gridBuffer } },
            ],
        }));

        buildGridBindGroups.push(device.createBindGroup({
            layout: buildGridPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: stateBuffers[i] } },
                { binding: 1, resource: { buffer: gridBuffer } },
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
