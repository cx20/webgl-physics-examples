const computeShaderWGSL = document.getElementById('cs').textContent;
const vertexShaderWGSL = document.getElementById('vs').textContent;
const fragmentShaderWGSL = document.getElementById('fs').textContent;
const wireVertexShaderWGSL = document.getElementById('wvs').textContent;
const wireFragmentShaderWGSL = document.getElementById('wfs').textContent;

const canvas = document.getElementById('c');

const CONE_COUNT = 160;
const STATIC_COUNT = 5;
const INSTANCE_COUNT = CONE_COUNT + STATIC_COUNT;
const STATE_FLOATS = 16;
const INFO_FLOATS = 4;
const STATIC_FLOATS = 12;
const SUBSTEPS = 4;
const BASKET_HALF = 3.0;
const BASKET_TOP = 4.0;
const GROUND_Y = -1.0;
const GROUND_HALF = 10.0;
const CONE_TEXTURE = '../../../../assets/textures/carrot.jpg';

let device, context, format, depthTexture;
let renderPipeline, computePipeline, wirePipeline;
let coneMesh, cubeMesh, coneWireMesh, cubeWireMesh;
let cameraBuffer, coneInfoBuffer, staticBuffer, simParamsBuffer;
let sampler, textureView;
let stateBuffers = [];
let renderBindGroups = [];
let computeBindGroups = [];
let wireBindGroups = [];
let currentState = 0;
let lastTime = -1;
let showWireframe = false;

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

    if (depthTexture) depthTexture.destroy();
    depthTexture = device.createTexture({
        size: { width: canvas.width, height: canvas.height },
        format: 'depth24plus',
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
}

function createConeGeometry(segments = 56) {
    const positions = [];
    const normals = [];
    const uvs = [];
    const indices = [];

    for (let i = 0; i < segments; i++) {
        const a0 = (i / segments) * Math.PI * 2;
        const a1 = ((i + 1) / segments) * Math.PI * 2;
        const x0 = Math.cos(a0);
        const z0 = Math.sin(a0);
        const x1 = Math.cos(a1);
        const z1 = Math.sin(a1);

        const sideBase = positions.length / 3;
        const sideNormal = normalize3(cross3(sub3([x1, -0.5, z1], [x0, -0.5, z0]), sub3([0, 0.5, 0], [x0, -0.5, z0])));
        positions.push(x0, -0.5, z0, x1, -0.5, z1, 0, 0.5, 0);
        normals.push(...sideNormal, ...sideNormal, ...sideNormal);
        uvs.push(i / segments, 0, (i + 1) / segments, 0, (i + 0.5) / segments, 1);
        indices.push(sideBase, sideBase + 1, sideBase + 2);

        const base = positions.length / 3;
        positions.push(0, -0.5, 0, x1, -0.5, z1, x0, -0.5, z0);
        normals.push(0, -1, 0, 0, -1, 0, 0, -1, 0);
        uvs.push(0.5, 0.5, 0.5 + x1 * 0.5, 0.5 + z1 * 0.5, 0.5 + x0 * 0.5, 0.5 + z0 * 0.5);
        indices.push(base, base + 1, base + 2);
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

function createConeWireGeometry(segments = 16) {
    const positions = [];
    const indices = [];
    for (let i = 0; i < segments; i++) {
        const angle = (i / segments) * Math.PI * 2;
        positions.push(Math.cos(angle), -0.5, Math.sin(angle));
        indices.push(i, (i + 1) % segments);
    }
    const apex = positions.length / 3;
    positions.push(0, 0.5, 0);
    for (let i = 0; i < segments; i += 2) {
        indices.push(i, apex);
    }
    return createLineMesh(new Float32Array(positions), new Uint16Array(indices));
}

function createBoxWireGeometry() {
    const positions = new Float32Array([
        -0.5,-0.5,-0.5,  0.5,-0.5,-0.5,  0.5, 0.5,-0.5, -0.5, 0.5,-0.5,
        -0.5,-0.5, 0.5,  0.5,-0.5, 0.5,  0.5, 0.5, 0.5, -0.5, 0.5, 0.5,
    ]);
    const indices = new Uint16Array([
        0,1, 1,2, 2,3, 3,0,
        4,5, 5,6, 6,7, 7,4,
        0,4, 1,5, 2,6, 3,7,
    ]);
    return createLineMesh(positions, indices);
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

function createLineMesh(positions, indices) {
    return {
        positionBuffer: createVertexBuffer(positions),
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

async function loadTexture(src) {
    const image = document.createElement('img');
    image.src = src;
    await image.decode();
    const texture = device.createTexture({
        size: [image.naturalWidth, image.naturalHeight, 1],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    device.queue.copyExternalImageToTexture({ source: image }, { texture }, [image.naturalWidth, image.naturalHeight]);
    return texture;
}

function createInitialStates() {
    const states = new Float32Array(CONE_COUNT * STATE_FLOATS);
    for (let i = 0; i < CONE_COUNT; i++) {
        const seed = ((i * 37) % 101) / 101;
        const base = i * STATE_FLOATS;
        const col = i % 16;
        const row = Math.floor(i / 16);
        const angle = seed * Math.PI * 2 + i * 0.37;
        const rotation = quatFromEuler((seed - 0.5) * 0.45, angle, (0.5 - seed) * 0.35);
        states[base + 0] = (col - 7.5) * 0.28 + Math.cos(angle) * 0.2;
        states[base + 1] = 6 + row * 0.55 + seed * 8;
        states[base + 2] = Math.sin(angle * 1.7) * BASKET_HALF * 0.7;
        states[base + 3] = seed;
        states[base + 4] = (seed - 0.5) * 0.12;
        states[base + 5] = -0.05;
        states[base + 6] = (0.5 - seed) * 0.12;
        states.set(rotation, base + 8);
        states[base + 12] = seed * 0.7;
        states[base + 13] = seed * 0.3;
        states[base + 14] = -seed * 0.6;
    }
    return states;
}

function createConeInfos() {
    const infos = new Float32Array(CONE_COUNT * INFO_FLOATS);
    for (let i = 0; i < CONE_COUNT; i++) {
        const seed = ((i * 37) % 101) / 101;
        const base = i * INFO_FLOATS;
        infos[base + 0] = 0.45 + seed * 0.3;
        infos[base + 1] = 1.2 + (((i * 17) % 101) / 101) * 1.0;
        infos[base + 2] = 0.1;
        infos[base + 3] = 0.055;
    }
    return infos;
}

function createStaticItems() {
    const items = new Float32Array(STATIC_COUNT * STATIC_FLOATS);
    const data = [
        { pos: [0, -2, 0], scale: [20, 2, 20], color: [0.22, 0.22, 0.24, 1] },
        { pos: [0, 1.53, -3.25], scale: [6.2, 5, 0.5], color: [0.25, 0.28, 0.3, 1] },
        { pos: [0, 1.53, 3.25], scale: [6.2, 5, 0.5], color: [0.25, 0.28, 0.3, 1] },
        { pos: [-3.25, 1.53, 0], scale: [0.5, 5, 6.2], color: [0.25, 0.28, 0.3, 1] },
        { pos: [3.25, 1.53, 0], scale: [0.5, 5, 6.2], color: [0.25, 0.28, 0.3, 1] },
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
    mat4LookAt(viewMatrix, eye, [0, 3, 0], [0, 1, 0]);
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

function drawLineMesh(pass, mesh, instanceCount, firstInstance = 0) {
    pass.setVertexBuffer(0, mesh.positionBuffer);
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
        computePass.dispatchWorkgroups(Math.ceil(CONE_COUNT / 64));
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
    drawMesh(renderPass, coneMesh, CONE_COUNT);
    drawMesh(renderPass, cubeMesh, STATIC_COUNT, CONE_COUNT);
    if (showWireframe) {
        renderPass.setPipeline(wirePipeline);
        renderPass.setBindGroup(0, wireBindGroups[currentState]);
        drawLineMesh(renderPass, coneWireMesh, CONE_COUNT);
        drawLineMesh(renderPass, cubeWireMesh, STATIC_COUNT, CONE_COUNT);
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

    coneMesh = createConeGeometry();
    cubeMesh = createBoxGeometry();
    coneWireMesh = createConeWireGeometry();
    cubeWireMesh = createBoxWireGeometry();

    const initialStates = createInitialStates();
    for (let i = 0; i < 2; i++) {
        const buffer = device.createBuffer({
            size: CONE_COUNT * STATE_FLOATS * 4,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            mappedAtCreation: true,
        });
        new Float32Array(buffer.getMappedRange()).set(initialStates);
        buffer.unmap();
        stateBuffers.push(buffer);
    }

    coneInfoBuffer = device.createBuffer({
        size: CONE_COUNT * INFO_FLOATS * 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        mappedAtCreation: true,
    });
    new Float32Array(coneInfoBuffer.getMappedRange()).set(createConeInfos());
    coneInfoBuffer.unmap();

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
        addressModeU: 'repeat',
        addressModeV: 'repeat',
        magFilter: 'linear',
        minFilter: 'linear',
    });
    const texture = await loadTexture(CONE_TEXTURE);
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
            module: device.createShaderModule({ code: computeShaderWGSL }),
            entryPoint: 'main',
        },
    });

    wirePipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: {
            module: device.createShaderModule({ code: wireVertexShaderWGSL }),
            entryPoint: 'main',
            buffers: [
                { arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] },
            ],
        },
        fragment: {
            module: device.createShaderModule({ code: wireFragmentShaderWGSL }),
            entryPoint: 'main',
            targets: [{ format }],
        },
        primitive: { topology: 'line-list', cullMode: 'none' },
        depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less-equal' },
    });

    for (let i = 0; i < 2; i++) {
        renderBindGroups.push(device.createBindGroup({
            layout: renderPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: cameraBuffer } },
                { binding: 1, resource: { buffer: stateBuffers[i] } },
                { binding: 2, resource: { buffer: coneInfoBuffer } },
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
                { binding: 2, resource: { buffer: coneInfoBuffer } },
                { binding: 3, resource: { buffer: simParamsBuffer } },
            ],
        }));

        wireBindGroups.push(device.createBindGroup({
            layout: wirePipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: cameraBuffer } },
                { binding: 1, resource: { buffer: stateBuffers[i] } },
                { binding: 2, resource: { buffer: coneInfoBuffer } },
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
        document.getElementById('hint').textContent = 'W: wireframe ' + (showWireframe ? 'ON' : 'OFF');
    });

    requestAnimationFrame(frame);
}

function quatFromEuler(x, y, z) {
    const cx = Math.cos(x * 0.5);
    const sx = Math.sin(x * 0.5);
    const cy = Math.cos(y * 0.5);
    const sy = Math.sin(y * 0.5);
    const cz = Math.cos(z * 0.5);
    const sz = Math.sin(z * 0.5);
    return new Float32Array([
        sx * cy * cz + cx * sy * sz,
        cx * sy * cz - sx * cy * sz,
        cx * cy * sz + sx * sy * cz,
        cx * cy * cz - sx * sy * sz,
    ]);
}

function normalize3(v) {
    const len = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / len, v[1] / len, v[2] / len];
}

function sub3(a, b) {
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross3(a, b) {
    return [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ];
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