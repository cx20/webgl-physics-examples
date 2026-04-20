import Module from 'https://esm.run/manifold-3d';

const { mat4, vec3, quat } = glMatrix;

const BALL_COUNT = 160;
const BASKET_HALF = 2.5;
const WALL_RENDER_Y_OFFSET = 0.03;
const IDENTITY_QUATERNION = [0, 0, 0, 1];
const TEXTURE_FILES = [
    '../../../../assets/textures/Basketball.jpg',
    '../../../../assets/textures/BeachBall.jpg',
    '../../../../assets/textures/Football.jpg',
    '../../../../assets/textures/Softball.jpg',
    '../../../../assets/textures/TennisBall.jpg'
];
const BALL_SIZE_SCALES = [1.0, 0.9, 1.0, 0.3, 0.3];

let canvas;
let device;
let context;
let format;
let pipeline;
let sampler;
let textureViews = [];
let whiteTextureView;
let depthTexture;

let sphereMesh;
let cubeMesh;

let HK;
let worldId;
let balls = [];
let basketWalls = [];

let staticRenderItems = [];
let ballRenderItems = [];

const viewProj = mat4.create();
const projection = mat4.create();
const view = mat4.create();
const model = mat4.create();
const rotationIdentity = quat.create();

function sphericalUV(x, y, z) {
    const len = Math.hypot(x, y, z);
    if (len === 0) return [0.5, 0.5];
    const nx = x / len;
    const ny = y / len;
    const nz = z / len;
    const u = 0.5 - Math.atan2(nz, nx) / (2 * Math.PI);
    const v = 0.5 - Math.asin(Math.max(-1, Math.min(1, ny))) / Math.PI;
    return [u, v];
}

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
        normalBuffer:   createVertexBuffer(data.normals),
        uvBuffer:       createVertexBuffer(data.uvs),
        vertexCount:    data.vertexCount
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
    device.queue.writeTexture({ texture }, new Uint8Array([r, g, b, a]), { bytesPerRow: 4 }, [1, 1, 1]);
    return texture.createView();
}

function enumToNumber(value) {
    if (typeof value === 'number') return value;
    if (typeof value === 'bigint') return Number(value);
    if (typeof value === 'string') {
        const parsed = Number(value.trim());
        return Number.isNaN(parsed) ? NaN : parsed;
    }
    if (!value || typeof value !== 'object') return NaN;
    if (typeof value.value === 'number' || typeof value.value === 'bigint') return Number(value.value);
    if (typeof value.m_value === 'number' || typeof value.m_value === 'bigint') return Number(value.m_value);
    if (typeof value.value === 'function') {
        const v = value.value();
        const n = enumToNumber(v);
        if (!Number.isNaN(n)) return n;
    }
    if (typeof value.valueOf === 'function') {
        const v = value.valueOf();
        if (v !== value) {
            const n = enumToNumber(v);
            if (!Number.isNaN(n)) return n;
        }
    }
    return NaN;
}

function checkResult(result, label) {
    if (result === HK.Result.RESULT_OK) return;
    const resultCode = enumToNumber(result);
    const okCode = enumToNumber(HK.Result.RESULT_OK);
    if (!Number.isNaN(resultCode) && !Number.isNaN(okCode) && resultCode === okCode) return;
    if (typeof result === 'object' && typeof HK.Result.RESULT_OK === 'object') {
        try {
            if (JSON.stringify(result) === JSON.stringify(HK.Result.RESULT_OK)) return;
        } catch (_e) {}
    }
    throw new Error(label + ' failed with code: ' + String(result));
}

function createBody(shapeId, motionType, position, rotation, setMass) {
    const created = HK.HP_Body_Create();
    checkResult(created[0], 'HP_Body_Create');
    const bodyId = created[1];
    checkResult(HK.HP_Body_SetShape(bodyId, shapeId), 'HP_Body_SetShape');
    checkResult(HK.HP_Body_SetMotionType(bodyId, motionType), 'HP_Body_SetMotionType');
    if (setMass) {
        const massResult = HK.HP_Shape_BuildMassProperties(shapeId);
        checkResult(massResult[0], 'HP_Shape_BuildMassProperties');
        checkResult(HK.HP_Body_SetMassProperties(bodyId, massResult[1]), 'HP_Body_SetMassProperties');
    }
    checkResult(HK.HP_Body_SetPosition(bodyId, position), 'HP_Body_SetPosition');
    checkResult(HK.HP_Body_SetOrientation(bodyId, rotation), 'HP_Body_SetOrientation');
    checkResult(HK.HP_World_AddBody(worldId, bodyId, false), 'HP_World_AddBody');
    return bodyId;
}

function initPhysics() {
    const world = HK.HP_World_Create();
    checkResult(world[0], 'HP_World_Create');
    worldId = world[1];
    checkResult(HK.HP_World_SetGravity(worldId, [0, -9.8, 0]), 'HP_World_SetGravity');
    checkResult(HK.HP_World_SetIdealStepTime(worldId, 1 / 60), 'HP_World_SetIdealStepTime');

    const groundShapeR = HK.HP_Shape_CreateBox([0, 0, 0], IDENTITY_QUATERNION, [20, 2, 20]);
    checkResult(groundShapeR[0], 'HP_Shape_CreateBox ground');
    HK.HP_Shape_SetMaterial(groundShapeR[1], [0.6, 0.6, 0.3, HK.MaterialCombine.MINIMUM, HK.MaterialCombine.MAXIMUM]);
    createBody(groundShapeR[1], HK.MotionType.STATIC, [0, -2, 0], IDENTITY_QUATERNION, false);

    basketWalls = [
        { size: [4.8, 5, 0.4], pos: [0, 1.5, -2.5] },
        { size: [4.8, 5, 0.4], pos: [0, 1.5,  2.5] },
        { size: [0.4, 5, 4.8], pos: [-2.5, 1.5, 0] },
        { size: [0.4, 5, 4.8], pos: [ 2.5, 1.5, 0] }
    ];
    for (const wall of basketWalls) {
        const shapeR = HK.HP_Shape_CreateBox([0, 0, 0], IDENTITY_QUATERNION, wall.size);
        checkResult(shapeR[0], 'HP_Shape_CreateBox wall');
        HK.HP_Shape_SetMaterial(shapeR[1], [0.4, 0.4, 0.3, HK.MaterialCombine.MINIMUM, HK.MaterialCombine.MAXIMUM]);
        createBody(shapeR[1], HK.MotionType.STATIC, wall.pos, IDENTITY_QUATERNION, false);
    }

    balls = [];
    for (let i = 0; i < BALL_COUNT; i++) {
        const textureIndex = Math.floor(Math.random() * BALL_SIZE_SCALES.length);
        const radius = (0.5 + Math.random() * 0.25) * BALL_SIZE_SCALES[textureIndex];
        const shapeR = HK.HP_Shape_CreateSphere([0, 0, 0], radius);
        checkResult(shapeR[0], 'HP_Shape_CreateSphere ball');
        const shapeId = shapeR[1];
        checkResult(HK.HP_Shape_SetDensity(shapeId, 1), 'HP_Shape_SetDensity');
            HK.HP_Shape_SetMaterial(shapeId, [0.4, 0.4, 0.75, HK.MaterialCombine.MINIMUM, HK.MaterialCombine.MAXIMUM]);
        const bodyId = createBody(
            shapeId,
            HK.MotionType.DYNAMIC,
            [
                (Math.random() - 0.5) * (BASKET_HALF * 1.4),
                6 + Math.random() * 13,
                (Math.random() - 0.5) * (BASKET_HALF * 1.4)
            ],
            IDENTITY_QUATERNION,
            true
        );
        balls.push({ bodyId, radius, textureIndex });
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
    ballRenderItems = balls.map((ball) => createRenderItem(textureViews[ball.textureIndex]));
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
    checkResult(HK.HP_World_Step(worldId, 1 / 60), 'HP_World_Step');

    for (const item of balls) {
        const posR = HK.HP_Body_GetPosition(item.bodyId);
        checkResult(posR[0], 'HP_Body_GetPosition');
        if (posR[1][1] < -20) {
            checkResult(HK.HP_Body_SetPosition(item.bodyId, [
                (Math.random() - 0.5) * (BASKET_HALF * 1.4),
                10 + Math.random() * 8,
                (Math.random() - 0.5) * (BASKET_HALF * 1.4)
            ]), 'HP_Body_SetPosition reset');
            checkResult(HK.HP_Body_SetLinearVelocity(item.bodyId, [0, 0, 0]), 'HP_Body_SetLinearVelocity reset');
            checkResult(HK.HP_Body_SetAngularVelocity(item.bodyId, [0, 0, 0]), 'HP_Body_SetAngularVelocity reset');
        }
    }

    const t = timeMs * 0.001;
    const eye = vec3.fromValues(Math.sin(t * 0.2) * 24, 12, Math.cos(t * 0.2) * 24);
    mat4.lookAt(view, eye, [0, 4, 0], [0, 1, 0]);
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

    mat4.fromRotationTranslationScale(model, rotationIdentity, [0, -2, 0], [20, 2, 20]);
    writeUniforms(staticRenderItems[0].uniformBuffer, [0.22, 0.22, 0.24, 1.0]);
    drawMesh(pass, cubeMesh, staticRenderItems[0].bindGroup);

    for (let i = 0; i < balls.length; i++) {
        const item = balls[i];
        const renderItem = ballRenderItems[i];
        const posR = HK.HP_Body_GetPosition(item.bodyId);
        checkResult(posR[0], 'HP_Body_GetPosition render');
        const rotR = HK.HP_Body_GetOrientation(item.bodyId);
        checkResult(rotR[0], 'HP_Body_GetOrientation render');
        const s = vec3.fromValues(item.radius, item.radius, item.radius);
        mat4.fromRotationTranslationScale(model, rotR[1], posR[1], s);
        writeUniforms(renderItem.uniformBuffer, [1, 1, 1, 1.0]);
        drawMesh(pass, sphereMesh, renderItem.bindGroup);
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

    const wasm = await Module();
    wasm.setup();
    const { Manifold } = wasm;

    const sphere = Manifold.sphere(1.0, 64);
    const sphereData = manifoldToArrays(sphere, sphericalUV, { smoothSphere: true, fixSeam: true });
    sphere.delete();

    const cube = Manifold.cube([1, 1, 1], true);
    const cubeData = manifoldToArrays(cube, boxUV, { smoothSphere: false, fixSeam: false });
    cube.delete();

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
                { arrayStride: 8,  attributes: [{ shaderLocation: 2, offset: 0, format: 'float32x2' }] }
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

    sphereMesh = createMesh(sphereData);
    cubeMesh = createMesh(cubeData);

    const textures = await Promise.all(TEXTURE_FILES.map(loadTexture));
    textureViews = textures.map((texture) => texture.createView());
    whiteTextureView = createSolidTextureView(255, 255, 255, 255);

    HK = await HavokPhysics();
    initPhysics();
    initRenderItems();

    resize();
    window.addEventListener('resize', resize);

    requestAnimationFrame(render);
}

main().catch((err) => {
    console.error(err);
});
