const { mat4, vec3, quat } = glMatrix;

const CONE_COUNT = 160;
const BASKET_HALF = 3.0;
const WALL_RENDER_Y_OFFSET = 0.03;
const CONE_TEXTURE = '../../../../assets/textures/carrot.jpg';

let canvas;
let device;
let context;
let format;
let pipeline;
let sampler;
let coneTextureView;
let whiteTextureView;
let staticRenderItems = [];
let coneRenderItems = [];
let depthTexture;

let coneMesh;
let cubeMesh;

let world;
let cones = [];
let ground;
let basketWalls = [];

const viewProj = mat4.create();
const projection = mat4.create();
const view = mat4.create();
const model = mat4.create();
const rotationIdentity = quat.create();

function generateCubeMesh() {
    const p = [
        -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5,
        -0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5,
        0.5, -0.5, -0.5, -0.5, -0.5, -0.5, -0.5, 0.5, -0.5,
        0.5, -0.5, -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5,
        -0.5, -0.5, -0.5, -0.5, -0.5, 0.5, -0.5, 0.5, 0.5,
        -0.5, -0.5, -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, -0.5,
        0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5,
        0.5, -0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5,
        -0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, -0.5,
        -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, -0.5, 0.5, -0.5,
        -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, -0.5, 0.5,
        -0.5, -0.5, -0.5, 0.5, -0.5, 0.5, -0.5, -0.5, 0.5
    ];
    const n = [
        0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1,
        0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1,
        -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0,
        1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0,
        0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0,
        0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0
    ];
    const u = [
        0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1,
        0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1,
        0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1,
        0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1,
        0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1,
        0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1
    ];
    return {
        positions: new Float32Array(p),
        normals: new Float32Array(n),
        uvs: new Float32Array(u),
        vertexCount: p.length / 3
    };
}

function generateConeMesh(segments) {
    const positions = [];
    const normals = [];
    const uvs = [];

    for (let i = 0; i < segments; i++) {
        const a0 = (i / segments) * Math.PI * 2;
        const a1 = ((i + 1) / segments) * Math.PI * 2;
        const x0 = Math.cos(a0);
        const z0 = Math.sin(a0);
        const x1 = Math.cos(a1);
        const z1 = Math.sin(a1);

        const p0 = [x0, -0.5, z0];
        const p1 = [x1, -0.5, z1];
        const apex = [0, 0.5, 0];

        const e1 = vec3.sub(vec3.create(), p1, p0);
        const e2 = vec3.sub(vec3.create(), apex, p0);
        const sideN = vec3.normalize(vec3.create(), vec3.cross(vec3.create(), e1, e2));

        positions.push(...p0, ...p1, ...apex);
        normals.push(...sideN, ...sideN, ...sideN);
        uvs.push(i / segments, 0, (i + 1) / segments, 0, (i + 0.5) / segments, 1);

        const center = [0, -0.5, 0];
        const baseN = [0, -1, 0];
        positions.push(...center, ...p1, ...p0);
        normals.push(...baseN, ...baseN, ...baseN);
        uvs.push(0.5, 0.5, 0.5 + x1 * 0.5, 0.5 + z1 * 0.5, 0.5 + x0 * 0.5, 0.5 + z0 * 0.5);
    }

    return {
        positions: new Float32Array(positions),
        normals: new Float32Array(normals),
        uvs: new Float32Array(uvs),
        vertexCount: positions.length / 3
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
        vertexCount: data.vertexCount
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

function initPhysics() {
    world = new OIMO.World({
        timestep: 1 / 60,
        iterations: 8,
        broadphase: 2,
        worldscale: 1,
        random: true,
        info: false,
        gravity: [0, -9.8, 0]
    });

    ground = { size: [20, 2, 20], pos: [0, -2, 0] };
    basketWalls = [
        { size: [6.2, 5, 0.5], pos: [0, 1.5, -3.2] },
        { size: [6.2, 5, 0.5], pos: [0, 1.5, 3.2] },
        { size: [0.5, 5, 6.2], pos: [-3.2, 1.5, 0] },
        { size: [0.5, 5, 6.2], pos: [3.2, 1.5, 0] }
    ];

    world.add({
        type: 'box',
        size: ground.size,
        pos: ground.pos,
        rot: [0, 0, 0],
        move: false,
        density: 1,
        friction: 0.6,
        restitution: 0.2
    });

    for (const wall of basketWalls) {
        world.add({
            type: 'box',
            size: wall.size,
            pos: wall.pos,
            rot: [0, 0, 0],
            move: false,
            density: 1,
            friction: 0.5,
            restitution: 0.2
        });
    }

    cones = [];
    for (let i = 0; i < CONE_COUNT; i++) {
        const radius = 0.45 + Math.random() * 0.3;
        const height = 1.2 + Math.random() * 1.0;
        const body = world.add({
            type: 'cylinder',
            size: [radius, height, radius],
            pos: [
                (Math.random() - 0.5) * (BASKET_HALF * 1.5),
                6 + Math.random() * 14,
                (Math.random() - 0.5) * (BASKET_HALF * 1.5)
            ],
            rot: [Math.random() * 20, Math.random() * 360, Math.random() * 20],
            move: true,
            density: 1,
            friction: 0.55,
            restitution: 0.1
        });
        cones.push({ body, radius, height });
    }
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

function initRenderItems() {
    staticRenderItems = [
        createRenderItem(whiteTextureView),
        ...basketWalls.map(() => createRenderItem(whiteTextureView))
    ];
    coneRenderItems = cones.map(() => createRenderItem(coneTextureView));
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

function render(timeMs) {
    world.step();

    for (const item of cones) {
        const p = item.body.getPosition();
        if (p.y < -20) {
            item.body.resetPosition(
                (Math.random() - 0.5) * (BASKET_HALF * 1.5),
                9 + Math.random() * 8,
                (Math.random() - 0.5) * (BASKET_HALF * 1.5)
            );
        }
    }

    const t = timeMs * 0.001;
    const eye = vec3.fromValues(Math.sin(t * 0.2) * 24, 12, Math.cos(t * 0.2) * 24);
    mat4.lookAt(view, eye, [0, 3, 0], [0, 1, 0]);
    mat4.perspective(projection, Math.PI / 4, canvas.width / canvas.height, 0.1, 150);
    mat4.multiply(viewProj, projection, view);

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

    mat4.fromRotationTranslationScale(model, rotationIdentity, ground.pos, ground.size);
    writeUniforms(staticRenderItems[0].uniformBuffer, [0.22, 0.22, 0.24, 1.0]);
    drawMesh(pass, cubeMesh, staticRenderItems[0].bindGroup);

    for (let i = 0; i < cones.length; i++) {
        const item = cones[i];
        const renderItem = coneRenderItems[i];
        const p = item.body.getPosition();
        const q = item.body.getQuaternion();
        const rotation = quat.fromValues(q.x, q.y, q.z, q.w);
        const s = vec3.fromValues(item.radius, item.height, item.radius);
        const tr = vec3.fromValues(p.x, p.y, p.z);
        mat4.fromRotationTranslationScale(model, rotation, tr, s);
        writeUniforms(renderItem.uniformBuffer, [1, 1, 1, 1.0]);
        drawMesh(pass, coneMesh, renderItem.bindGroup);
    }

    for (let i = 0; i < basketWalls.length; i++) {
        const wall = basketWalls[i];
        const renderItem = staticRenderItems[i + 1];
        const wallPos = [wall.pos[0], wall.pos[1] + WALL_RENDER_Y_OFFSET, wall.pos[2]];
        mat4.fromRotationTranslationScale(model, rotationIdentity, wallPos, wall.size);
        writeUniforms(renderItem.uniformBuffer, [0.25, 0.28, 0.3, 0.28]);
        drawMesh(pass, cubeMesh, renderItem.bindGroup);
    }

    pass.end();
    device.queue.submit([encoder.finish()]);

    requestAnimationFrame(render);
}

async function main() {
    canvas = document.getElementById('c');

    if (!navigator.gpu) {
        throw new Error('WebGPU is not supported in this browser.');
    }

    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
        throw new Error('Failed to get GPU adapter.');
    }

    device = await adapter.requestDevice();
    context = canvas.getContext('webgpu');
    format = navigator.gpu.getPreferredCanvasFormat();

    coneMesh = createMesh(generateConeMesh(56));
    cubeMesh = createMesh(generateCubeMesh());

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
            targets: [{
                format,
                blend: {
                    color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
                    alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }
                }
            }]
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
        magFilter: 'linear',
        minFilter: 'linear',
        mipmapFilter: 'linear'
    });

    const coneTexture = await loadTexture(CONE_TEXTURE);
    coneTextureView = coneTexture.createView();
    whiteTextureView = createSolidTextureView(255, 255, 255, 255);

    resize();
    window.addEventListener('resize', resize);

    initPhysics();
    initRenderItems();
    requestAnimationFrame(render);
}

main().catch((err) => {
    console.error(err);
});
