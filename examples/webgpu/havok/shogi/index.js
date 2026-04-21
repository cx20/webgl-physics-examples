const vertexShaderWGSL   = document.getElementById('vs').textContent;
const fragmentShaderWGSL = document.getElementById('fs').textContent;
const groundVertWGSL     = document.getElementById('gvs').textContent;
const groundFragWGSL     = document.getElementById('gfs').textContent;

let canvas, device, ctx, pipeline;
let positionBuffer, normalBuffer, texCoordBuffer, indexBuffer, indexNum;
let offsetBuffer, rotBuffer;
let uniformBuffer, bindGroup;
let groundPipeline, groundVBuffer, groundIBuffer, groundMVPBuffer, groundBindGroup, groundICount;
let depthTexture;
const IDENTITY_QUATERNION = [0, 0, 0, 1];
let HK, worldId, bodies;
let posArray, rotArray;

const MAX = 300;
const DOT_SIZE = 2;
const pw = DOT_SIZE * 0.8 * 1.0;
const ph = DOT_SIZE * 0.8 * 1.0;
const pd = DOT_SIZE * 0.8 * 0.2;
const SHOGI_PHYSICS_SIZE = [pw, ph * 1.2, pd * 1.4];

function enumToNumber(value) {
    if (typeof value === 'number') {
        return value;
    }
    if (typeof value === 'bigint') {
        return Number(value);
    }
    if (typeof value === 'string') {
        const parsed = Number(value.trim());
        return Number.isNaN(parsed) ? NaN : parsed;
    }
    if (!value || typeof value !== 'object') {
        return NaN;
    }
    if (typeof value.value === 'number' || typeof value.value === 'bigint') {
        return Number(value.value);
    }
    if (typeof value.m_value === 'number' || typeof value.m_value === 'bigint') {
        return Number(value.m_value);
    }
    if (typeof value.value === 'function') {
        const v = value.value();
        const n = enumToNumber(v);
        if (!Number.isNaN(n)) {
            return n;
        }
    }
    if (typeof value.valueOf === 'function') {
        const v = value.valueOf();
        if (v !== value) {
            const n = enumToNumber(v);
            if (!Number.isNaN(n)) {
                return n;
            }
        }
    }
    return NaN;
}

function checkResult(result, label) {
    if (result === HK.Result.RESULT_OK) {
        return;
    }

    const resultCode = enumToNumber(result);
    const okCode = enumToNumber(HK.Result.RESULT_OK);
    if (!Number.isNaN(resultCode) && !Number.isNaN(okCode) && resultCode === okCode) {
        return;
    }

    if (typeof result === 'object' && typeof HK.Result.RESULT_OK === 'object') {
        try {
            if (JSON.stringify(result) === JSON.stringify(HK.Result.RESULT_OK)) {
                return;
            }
        } catch (_e) {
        }
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

async function init() {
    canvas = document.getElementById('c');
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;

    window.addEventListener('resize', () => {
        canvas.width  = window.innerWidth;
        canvas.height = window.innerHeight;
        depthTexture.destroy();
        depthTexture = createDepthTexture();
        const pMatrix = makePerspective(45, canvas.width / canvas.height, 0.1, 1000.0);
        device.queue.writeBuffer(uniformBuffer, 0, pMatrix);
    });

    const gpu = navigator['gpu'];
    if (!gpu) { alert('WebGPU is not supported.'); return; }
    const adapter = await gpu.requestAdapter();
    if (!adapter) { alert('Failed to get GPU adapter.'); return; }
    device = await adapter.requestDevice();

    ctx = canvas.getContext('webgpu');
    const format = gpu.getPreferredCanvasFormat();
    ctx.configure({ device, format, alphaMode: 'opaque' });

    // ---- geometry ----
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
        // Front face (outward: +Z tilt)
         0,  0.0599,  0.9982,   0,  0.0599,  0.9982,   0,  0.0599,  0.9982,   0,  0.0599,  0.9982,
        // Back face (outward: -Z tilt)
         0, -0.0599, -0.9982,   0, -0.0599, -0.9982,   0, -0.0599, -0.9982,   0, -0.0599, -0.9982,
        // Top face (outward: +Y)
         0,  1,  0,   0,  1,  0,   0,  1,  0,   0,  1,  0,
        // Bottom face (outward: -Y)
         0, -1,  0,   0, -1,  0,   0, -1,  0,   0, -1,  0,
        // Right face (outward: +X tilt)
         0.9889,  0.1483,  0,   0.9889,  0.1483,  0,   0.9889,  0.1483,  0,   0.9889,  0.1483,  0,
        // Left face (outward: -X tilt)
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

    positionBuffer = makeVertexBuffer(positions);
    normalBuffer   = makeVertexBuffer(normals);
    texCoordBuffer = makeVertexBuffer(texCoords);
    indexBuffer    = makeIndexBuffer(indices);
    indexNum       = indices.length;

    // Instance buffers (updated each frame from posArray / rotArray)
    posArray = new Float32Array(MAX * 3);
    rotArray = new Float32Array(MAX * 4);
    offsetBuffer = device.createBuffer({
        size: MAX * 3 * 4,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
    });
    rotBuffer = device.createBuffer({
        size: MAX * 4 * 4,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
    });

    // Uniform buffer: perspective matrix (64 bytes, written once then on resize)
    uniformBuffer = device.createBuffer({
        size: 64,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    const pMatrix = makePerspective(45, canvas.width / canvas.height, 0.1, 1000.0);
    device.queue.writeBuffer(uniformBuffer, 0, pMatrix);

    // Texture
    const shogiTexture = await createTextureFromImage('../../../../assets/textures/shogi_001/shogi.png');
    const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });

    // Pipeline
    const vModule = device.createShaderModule({ code: vertexShaderWGSL });
    const fModule = device.createShaderModule({ code: fragmentShaderWGSL });

    pipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: {
            module: vModule,
            entryPoint: 'main',
            buffers: [
                { arrayStride: 3*4, stepMode: 'vertex',   attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] },
                { arrayStride: 3*4, stepMode: 'vertex',   attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x3' }] },
                { arrayStride: 2*4, stepMode: 'vertex',   attributes: [{ shaderLocation: 2, offset: 0, format: 'float32x2' }] },
                { arrayStride: 3*4, stepMode: 'instance', attributes: [{ shaderLocation: 3, offset: 0, format: 'float32x3' }] },
                { arrayStride: 4*4, stepMode: 'instance', attributes: [{ shaderLocation: 4, offset: 0, format: 'float32x4' }] }
            ]
        },
        fragment: {
            module: fModule,
            entryPoint: 'main',
            targets: [{ format }]
        },
        primitive: { topology: 'triangle-list' },
        depthStencil: {
            depthWriteEnabled: true,
            depthCompare: 'less',
            format: 'depth24plus-stencil8'
        }
    });

    bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: uniformBuffer } },
            { binding: 1, resource: sampler },
            { binding: 2, resource: shogiTexture.createView() }
        ]
    });

    // Ground pipeline
    const gvModule = device.createShaderModule({ code: groundVertWGSL });
    const gfModule = device.createShaderModule({ code: groundFragWGSL });
    groundPipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: {
            module: gvModule,
            entryPoint: 'main',
            buffers: [{ arrayStride: 3*4, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] }]
        },
        fragment: { module: gfModule, entryPoint: 'main', targets: [{ format }] },
        primitive: { topology: 'triangle-list' },
        depthStencil: { depthWriteEnabled: true, depthCompare: 'less', format: 'depth24plus-stencil8' }
    });

    const groundPositions = new Float32Array([
        // Top
        -6.5,  0.05, -6.5,  6.5,  0.05, -6.5,  6.5,  0.05,  6.5, -6.5,  0.05,  6.5,
        // Bottom
        -6.5, -0.05, -6.5,  6.5, -0.05, -6.5,  6.5, -0.05,  6.5, -6.5, -0.05,  6.5,
        // Front (+Z)
        -6.5, -0.05,  6.5,  6.5, -0.05,  6.5,  6.5,  0.05,  6.5, -6.5,  0.05,  6.5,
        // Back (-Z)
        -6.5, -0.05, -6.5,  6.5, -0.05, -6.5,  6.5,  0.05, -6.5, -6.5,  0.05, -6.5,
        // Right (+X)
         6.5, -0.05, -6.5,  6.5, -0.05,  6.5,  6.5,  0.05,  6.5,  6.5,  0.05, -6.5,
        // Left (-X)
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
    groundICount = groundIdx.length;
    groundVBuffer = makeVertexBuffer(groundPositions);
    groundIBuffer = makeIndexBuffer(groundIdx);

    groundMVPBuffer = device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    groundBindGroup = device.createBindGroup({
        layout: groundPipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: groundMVPBuffer } }]
    });

    // Precompute ground MVP (ground is static; camera is at [0,0,40] looking at origin)
    // View matrix = translate(0, 0, -40) in column-major
    const vMat = new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,-40,1]);
    // Model matrix = translate(0, -10, 0) in column-major
    const mMat = new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,-10,0,1]);
    const groundMVP = mat4mul(mat4mul(pMatrix, vMat), mMat);
    device.queue.writeBuffer(groundMVPBuffer, 0, groundMVP);

    depthTexture = createDepthTexture();

    // Physics
    HK = await HavokPhysics();
    const worldResult = HK.HP_World_Create();
    checkResult(worldResult[0], 'HP_World_Create');
    worldId = worldResult[1];
    checkResult(HK.HP_World_SetGravity(worldId, [0, -9.8, 0]), 'HP_World_SetGravity');
    checkResult(HK.HP_World_SetIdealStepTime(worldId, 1 / 200), 'HP_World_SetIdealStepTime');

    const groundShapeResult = HK.HP_Shape_CreateBox([0, 0, 0], IDENTITY_QUATERNION, [13, 0.1, 13]);
    checkResult(groundShapeResult[0], 'HP_Shape_CreateBox (ground)');
    createBody(groundShapeResult[1], HK.MotionType.STATIC, [0, -10, 0], IDENTITY_QUATERNION, false);

    const shogiShapeResult = HK.HP_Shape_CreateBox([0, 0, 0], IDENTITY_QUATERNION, SHOGI_PHYSICS_SIZE);
    checkResult(shogiShapeResult[0], 'HP_Shape_CreateBox (shogi)');
    const shogiShapeId = shogiShapeResult[1];
    checkResult(HK.HP_Shape_SetDensity(shogiShapeId, 1), 'HP_Shape_SetDensity');

    bodies = [];
    for (let i = 0; i < MAX; i++) {
        const p = genPosition();
        bodies[i] = createBody(shogiShapeId, HK.MotionType.DYNAMIC, [p.x, p.y, p.z], IDENTITY_QUATERNION, true);
    }

    updateInstanceArrays();

    setInterval(function () {
        checkResult(HK.HP_World_Step(worldId, 1 / 200), 'HP_World_Step');
        for (let i = 0; i < MAX; i++) {
            const posResult = HK.HP_Body_GetPosition(bodies[i]);
            checkResult(posResult[0], 'HP_Body_GetPosition');
            const pos = posResult[1];
            if (pos[1] < -15) {
                const p = genPosition();
                checkResult(HK.HP_Body_SetPosition(bodies[i], [p.x, p.y, p.z]), 'HP_Body_SetPosition reset');
                checkResult(HK.HP_Body_SetOrientation(bodies[i], IDENTITY_QUATERNION), 'HP_Body_SetOrientation reset');
                checkResult(HK.HP_Body_SetLinearVelocity(bodies[i], [0, 0, 0]), 'HP_Body_SetLinearVelocity reset');
                checkResult(HK.HP_Body_SetAngularVelocity(bodies[i], [0, 0, 0]), 'HP_Body_SetAngularVelocity reset');
            }
        }
        updateInstanceArrays();
    }, 1000 / 200);

    requestAnimationFrame(render);
}

function genPosition() {
    return {
        x: (Math.random() - 0.5) * 15,
        y: (Math.random() + 1.0) * 15,
        z: (Math.random() - 0.5) * 15
    };
}

function updateInstanceArrays() {
    let pIdx = 0, qIdx = 0;
    for (let i = 0; i < MAX; i++) {
        const pResult = HK.HP_Body_GetPosition(bodies[i]);
        checkResult(pResult[0], 'HP_Body_GetPosition');
        const p = pResult[1];
        posArray[pIdx++] = p[0];
        posArray[pIdx++] = p[1];
        posArray[pIdx++] = p[2];

        const qResult = HK.HP_Body_GetOrientation(bodies[i]);
        checkResult(qResult[0], 'HP_Body_GetOrientation');
        const q = qResult[1];
        rotArray[qIdx++] = q[0];
        rotArray[qIdx++] = q[1];
        rotArray[qIdx++] = q[2];
        rotArray[qIdx++] = q[3];
    }
}

function makePerspective(fovy, aspect, near, far) {
    const top   = near * Math.tan(fovy * Math.PI / 360.0);
    const right = top * aspect;
    const u = right * 2;
    const v = top   * 2;
    const ww = far - near;
    return new Float32Array([
        near * 2 / u, 0, 0, 0,
        0, near * 2 / v, 0, 0,
        0, 0, -(far + near) / ww, -1,
        0, 0, -(far * near * 2) / ww, 0
    ]);
}

function mat4mul(a, b) {
    const r = new Float32Array(16);
    for (let c = 0; c < 4; c++) {
        for (let row = 0; row < 4; row++) {
            let s = 0;
            for (let k = 0; k < 4; k++) s += a[k*4+row] * b[c*4+k];
            r[c*4+row] = s;
        }
    }
    return r;
}

function makeVertexBuffer(data) {
    const buf = device.createBuffer({
        size: data.byteLength,
        usage: GPUBufferUsage.VERTEX,
        mappedAtCreation: true
    });
    new Float32Array(buf.getMappedRange()).set(data);
    buf.unmap();
    return buf;
}

function makeIndexBuffer(data) {
    const buf = device.createBuffer({
        size: data.byteLength,
        usage: GPUBufferUsage.INDEX,
        mappedAtCreation: true
    });
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
        format: 'depth24plus-stencil8',
        usage: GPUTextureUsage.RENDER_ATTACHMENT
    });
}

function render() {
    // Upload latest physics state to GPU instance buffers
    device.queue.writeBuffer(offsetBuffer, 0, posArray);
    device.queue.writeBuffer(rotBuffer,    0, rotArray);

    const textureView = ctx.getCurrentTexture().createView();
    const commandEncoder = device.createCommandEncoder();
    const passEncoder = commandEncoder.beginRenderPass({
        colorAttachments: [{
            view: textureView,
            loadOp: 'clear',
            clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
            storeOp: 'store'
        }],
        depthStencilAttachment: {
            view: depthTexture.createView(),
            depthClearValue: 1.0,
            depthLoadOp: 'clear',
            depthStoreOp: 'store',
            stencilClearValue: 0,
            stencilLoadOp: 'clear',
            stencilStoreOp: 'store'
        }
    });

    // Draw ground
    passEncoder.setPipeline(groundPipeline);
    passEncoder.setVertexBuffer(0, groundVBuffer);
    passEncoder.setIndexBuffer(groundIBuffer, 'uint16');
    passEncoder.setBindGroup(0, groundBindGroup);
    passEncoder.drawIndexed(groundICount, 1, 0, 0, 0);

    // Draw shogi pieces
    passEncoder.setPipeline(pipeline);
    passEncoder.setVertexBuffer(0, positionBuffer);
    passEncoder.setVertexBuffer(1, normalBuffer);
    passEncoder.setVertexBuffer(2, texCoordBuffer);
    passEncoder.setVertexBuffer(3, offsetBuffer);
    passEncoder.setVertexBuffer(4, rotBuffer);
    passEncoder.setIndexBuffer(indexBuffer, 'uint16');
    passEncoder.setBindGroup(0, bindGroup);
    passEncoder.drawIndexed(indexNum, MAX, 0, 0, 0);

    passEncoder.end();
    device.queue.submit([commandEncoder.finish()]);
    requestAnimationFrame(render);
}

init();
