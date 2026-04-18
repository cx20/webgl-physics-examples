import Module from 'https://esm.run/manifold-3d';
const { mat4, vec3, quat } = glMatrix;

const DOT_ROWS = [
    '.............ppp',
    '......rrrrr..ppp',
    '.....rrrrrrrrrpp',
    '.....nnnppnp.rrr',
    '....npnpppnpprrr',
    '....npnnpppnpppr',
    '....nnppppnnnnr.',
    '......pppppppr..',
    '..rrrrrbrrrbr...',
    '.rrrrrrrrbrrrb..n',
    'pprrrrrrbbbbb..n',
    'ppp.bbrbbybbybnn',
    '.p.nbbbbbbbbbbnn',
    '..nnnbbbbbbbbbnn',
    '.nnnbbbbbbb.....',
    '.n..bbbb........'
];
const BOX_SIZE = 1;
const GROUND_TEXTURE_FILE = '../../../../assets/textures/grass.jpg';
const GROUND_UV_REPEAT = 6;

let canvas;
let device;
let context;
let format;
let pipeline;
let sampler;
let whiteTextureView;
let groundTextureView;
let groundRenderItem;
let boxRenderItems = [];
let depthTexture;

let cubeMesh;
let groundMesh;

let world;
let boxes = [];
let ground;

const viewProj = mat4.create();
const projection = mat4.create();
const view = mat4.create();
const model = mat4.create();
const rotationIdentity = quat.create();

function boxUV(x, y, z) {
    const ax = Math.abs(x);
    const ay = Math.abs(y);
    const az = Math.abs(z);
    if (ax >= ay && ax >= az) return [(z / ax + 1) / 2, (y / ax + 1) / 2];
    if (ay >= ax && ay >= az) return [(x / ay + 1) / 2, (z / ay + 1) / 2];
    return [(x / az + 1) / 2, (y / az + 1) / 2];
}

function fixSeamUVs(uv0, uv1, uv2) {
    let u0 = uv0[0], u1 = uv1[0], u2 = uv2[0];
    if (Math.abs(u0 - u1) > 0.5) { if (u0 < u1) u0 += 1.0; else u1 += 1.0; }
    if (Math.abs(u1 - u2) > 0.5) { if (u1 < u2) u1 += 1.0; else u2 += 1.0; }
    if (Math.abs(u0 - u2) > 0.5) { if (u0 < u2) u0 += 1.0; else u2 += 1.0; }
    return [[u0, uv0[1]], [u1, uv1[1]], [u2, uv2[1]]];
}

function manifoldToArrays(manifold, uvFunc, options = {}) {
    const mesh = manifold.getMesh();
    const vertProps = mesh.vertProperties;
    const triVerts = mesh.triVerts;
    const smoothSphere = !!options.smoothSphere;
    const fixSeam = !!options.fixSeam;

    const positions = [];
    const normals = [];
    const uvs = [];

    for (let i = 0; i < triVerts.length; i += 3) {
        const i0 = triVerts[i];
        const i1 = triVerts[i + 1];
        const i2 = triVerts[i + 2];

        const p0 = [vertProps[i0 * 3], vertProps[i0 * 3 + 1], vertProps[i0 * 3 + 2]];
        const p1 = [vertProps[i1 * 3], vertProps[i1 * 3 + 1], vertProps[i1 * 3 + 2]];
        const p2 = [vertProps[i2 * 3], vertProps[i2 * 3 + 1], vertProps[i2 * 3 + 2]];

        positions.push(...p0, ...p1, ...p2);

        if (smoothSphere) {
            const n0 = vec3.normalize(vec3.create(), p0);
            const n1 = vec3.normalize(vec3.create(), p1);
            const n2 = vec3.normalize(vec3.create(), p2);
            normals.push(...n0, ...n1, ...n2);
        } else {
            const a = vec3.sub(vec3.create(), p1, p0);
            const b = vec3.sub(vec3.create(), p2, p0);
            const n = vec3.normalize(vec3.create(), vec3.cross(vec3.create(), a, b));
            normals.push(...n, ...n, ...n);
        }

        let uv0 = uvFunc(...p0);
        let uv1 = uvFunc(...p1);
        let uv2 = uvFunc(...p2);
        if (fixSeam) {
            [uv0, uv1, uv2] = fixSeamUVs(uv0, uv1, uv2);
        }
        uvs.push(...uv0, ...uv1, ...uv2);
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

function createGroundPlaneData(repeat) {
    const positions = new Float32Array([
        -0.5, 0.0, -0.5,
         0.5, 0.0, -0.5,
         0.5, 0.0,  0.5,
        -0.5, 0.0, -0.5,
         0.5, 0.0,  0.5,
        -0.5, 0.0,  0.5
    ]);
    const normals = new Float32Array([
        0, 1, 0,
        0, 1, 0,
        0, 1, 0,
        0, 1, 0,
        0, 1, 0,
        0, 1, 0
    ]);
    const uvs = new Float32Array([
        0, 0,
        repeat, 0,
        repeat, repeat,
        0, 0,
        repeat, repeat,
        0, repeat
    ]);

    return {
        positions,
        normals,
        uvs,
        vertexCount: 6
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

function getTintColor(code) {
    const colorHash = {
        '.': [0xDC / 255, 0xAA / 255, 0x6B / 255],
        'p': [1.0, 0xCC / 255, 0xCC / 255],
        'n': [0x80 / 255, 0.0, 0.0],
        'r': [1.0, 0.0, 0.0],
        'y': [1.0, 1.0, 0.0],
        'b': [0.0, 0.0, 1.0]
    };
    return colorHash[code] || [1.0, 1.0, 1.0];
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

    ground = { size: [30, 0.4, 30], pos: [0, -2, 0] };

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

    boxes = [];
    const boxSize = 1;
    for (let y = 0; y < DOT_ROWS.length; y++) {
        const row = DOT_ROWS[y];
        for (let x = 0; x < row.length; x++) {
            const body = world.add({
                type: 'box',
                size: [boxSize, boxSize, boxSize],
                pos: [
                    -12 + x * boxSize * 1.5 + Math.random() * 0.1,
                    0 + (DOT_ROWS.length - 1 - y) * boxSize * 1.2 + Math.random() * 0.1,
                    Math.random() * 0.1
                ],
                rot: [0, 0, 0],
                move: true,
                density: 1,
                friction: 0.4,
                restitution: 0.2
            });

            boxes.push({
                body,
                tint: getTintColor(row[x])
            });
        }
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
    groundRenderItem = createRenderItem(groundTextureView);
    boxRenderItems = boxes.map(() => createRenderItem(whiteTextureView));
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

    const t = timeMs * 0.001;
    const eye = vec3.fromValues(Math.sin(t * 0.2) * 24, 12, Math.cos(t * 0.2) * 24);
    mat4.lookAt(view, eye, [0, 8, 0], [0, 1, 0]);
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
    writeUniforms(groundRenderItem.uniformBuffer, [1.0, 1.0, 1.0, 1.0]);
    drawMesh(pass, groundMesh, groundRenderItem.bindGroup);

    for (let i = 0; i < boxes.length; i++) {
        const item = boxes[i];
        const renderItem = boxRenderItems[i];
        const p = item.body.getPosition();
        const q = item.body.getQuaternion();
        const rotation = quat.fromValues(q.x, q.y, q.z, q.w);
        const s = vec3.fromValues(BOX_SIZE, BOX_SIZE, BOX_SIZE);
        const tr = vec3.fromValues(p.x, p.y, p.z);
        mat4.fromRotationTranslationScale(model, rotation, tr, s);
        writeUniforms(renderItem.uniformBuffer, [item.tint[0], item.tint[1], item.tint[2], 1.0]);
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

    const wasm = await Module();
    wasm.setup();
    const { Manifold } = wasm;

    const cube = Manifold.cube([1, 1, 1], true);
    const cubeData = manifoldToArrays(cube, boxUV, { smoothSphere: false, fixSeam: false });
    cube.delete();
    const groundData = createGroundPlaneData(GROUND_UV_REPEAT);

    cubeMesh = createMesh(cubeData);
    groundMesh = createMesh(groundData);

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
        addressModeU: 'repeat',
        addressModeV: 'repeat',
        magFilter: 'linear',
        minFilter: 'linear',
        mipmapFilter: 'nearest'
    });

    whiteTextureView = createSolidTextureView(255, 255, 255, 255);
    const groundTexture = await loadTexture(GROUND_TEXTURE_FILE);
    groundTextureView = groundTexture.createView();

    resize();
    window.addEventListener('resize', resize);

    initPhysics();
    initRenderItems();
    requestAnimationFrame(render);
}

main().catch((err) => {
    console.error(err);
});
