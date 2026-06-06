const vertexShaderWGSL   = document.getElementById('vs').textContent;
let showWireframe = true;
const fragmentShaderWGSL = document.getElementById('fs').textContent;
const groundVertWGSL     = document.getElementById('gvs').textContent;
const groundFragWGSL     = document.getElementById('gfs').textContent;

let canvas, device, ctx, format, pipeline;
let positionBuffer, normalBuffer, texCoordBuffer, indexBuffer, indexNum;
let offsetBuffer, rotBuffer;
let uniformBuffer, bindGroup;
let groundPipeline, groundVBuffer, groundIBuffer, groundMVPBuffer, groundBindGroup, groundICount;
let depthTexture;
let world, bodies;
let posArray, rotArray;

let linePipeline, lineVtxBuf, lineIdxBuf, lineUniformBuf, lineBG;
const LINE_STRUCT_SIZE = 144, LINE_ALIGN = 256;
const BOX_WIRE_VERTS = new Float32Array([
    -0.5,-0.5,-0.5,  0.5,-0.5,-0.5,  0.5, 0.5,-0.5, -0.5, 0.5,-0.5,
    -0.5,-0.5, 0.5,  0.5,-0.5, 0.5,  0.5, 0.5, 0.5, -0.5, 0.5, 0.5
]);
const BOX_WIRE_INDICES = new Uint16Array([0,1, 1,2, 2,3, 3,0, 4,5, 5,6, 6,7, 7,4, 0,4, 1,5, 2,6, 3,7]);
const LINE_MAX = 301;
const lineUniformData = new Float32Array(LINE_ALIGN / 4 * LINE_MAX);
const lineModelTmp = new Float32Array(16);
let lineViewProj = new Float32Array(16);

function makeModelMatrix(out, px, py, pz, qx, qy, qz, qw, sx, sy, sz) {
    const x2=qx+qx, y2=qy+qy, z2=qz+qz;
    const xx=qx*x2, xy=qx*y2, xz=qx*z2, yy=qy*y2, yz=qy*z2, zz=qz*z2, wx=qw*x2, wy=qw*y2, wz=qw*z2;
    out[0]=(1-(yy+zz))*sx; out[1]=(xy+wz)*sx;    out[2]=(xz-wy)*sx;    out[3]=0;
    out[4]=(xy-wz)*sy;     out[5]=(1-(xx+zz))*sy; out[6]=(yz+wx)*sy;   out[7]=0;
    out[8]=(xz+wy)*sz;     out[9]=(yz-wx)*sz;    out[10]=(1-(xx+yy))*sz; out[11]=0;
    out[12]=px; out[13]=py; out[14]=pz; out[15]=1;
}

const MAX = 300;
const DOT_SIZE = 2;
const pw = DOT_SIZE * 0.8 * 1.0;
const ph = DOT_SIZE * 0.8 * 1.0;
const pd = DOT_SIZE * 0.8 * 0.2;

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
        lineViewProj = mat4mul(pMatrix, new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,-40,1]));
    });

    const gpu = navigator['gpu'];
    if (!gpu) { alert('WebGPU is not supported.'); return; }
    const adapter = await gpu.requestAdapter();
    if (!adapter) { alert('Failed to get GPU adapter.'); return; }
    device = await adapter.requestDevice();

    ctx = canvas.getContext('webgpu');
    format = gpu.getPreferredCanvasFormat();
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
    lineViewProj = mat4mul(pMatrix, vMat);

    depthTexture = createDepthTexture();

    // Physics
    world = new OIMO.World();
    world.gravity = new OIMO.Vec3(0, -0.98, 0);

    world.add({
        type: 'box',
        size: [13, 0.1, 13],
        pos: [0, -10, 0],
        rot: [0, 0, 0],
        move: false,
        density: 1
    });

    bodies = [];
    for (let i = 0; i < MAX; i++) {
        const p = genPosition();
        bodies[i] = world.add({
            type: 'box',
            // Match the rendered piece: the mesh spans +/-0.5pw, +/-0.5ph, +/-0.7pd -> [pw, ph, 1.4pd].
            size: [pw, ph, pd * 1.4],
            pos: [p.x, p.y, p.z],
            rot: [0, 0, 0],
            move: true,
            density: 1
        });
    }

    updateInstanceArrays();

    setInterval(function () {
        world.step();
        for (let i = 0; i < MAX; i++) {
            const pos = bodies[i].getPosition();
            if (pos.y < -15) {
                const p = genPosition();
                bodies[i].resetPosition(p.x, p.y, p.z);
            }
        }
        updateInstanceArrays();
    }, 1000 / 200);

    lineVtxBuf = device.createBuffer({ size: BOX_WIRE_VERTS.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(lineVtxBuf, 0, BOX_WIRE_VERTS);
    lineIdxBuf = device.createBuffer({ size: BOX_WIRE_INDICES.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(lineIdxBuf, 0, BOX_WIRE_INDICES);
    lineUniformBuf = device.createBuffer({ size: LINE_ALIGN * LINE_MAX, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const lineBGLayout = device.createBindGroupLayout({
        entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
            buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: LINE_STRUCT_SIZE } }]
    });
    linePipeline = device.createRenderPipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [lineBGLayout] }),
        vertex: { module: device.createShaderModule({ code: document.getElementById('vs-line').textContent }),
            entryPoint: 'main', buffers: [{ arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] }] },
        fragment: { module: device.createShaderModule({ code: document.getElementById('fs-line').textContent }),
            entryPoint: 'main', targets: [{ format }] },
        primitive: { topology: 'line-list' },
        depthStencil: { format: 'depth24plus-stencil8', depthWriteEnabled: true, depthCompare: 'less' }
    });
    lineBG = device.createBindGroup({
        layout: lineBGLayout,
        entries: [{ binding: 0, resource: { buffer: lineUniformBuf, size: LINE_STRUCT_SIZE } }]
    });

    requestAnimationFrame(render);
}

function genPosition() {
    const p = new OIMO.Vec3(Math.random() - 0.5, Math.random() + 1, Math.random() - 0.5);
    return new OIMO.Vec3().scale(p, 15);
}

function updateInstanceArrays() {
    let pIdx = 0, qIdx = 0;
    for (let i = 0; i < MAX; i++) {
        const p = bodies[i].getPosition();
        posArray[pIdx++] = p.x;
        posArray[pIdx++] = p.y;
        posArray[pIdx++] = p.z;
        const q = bodies[i].getQuaternion();
        rotArray[qIdx++] = q.x;
        rotArray[qIdx++] = q.y;
        rotArray[qIdx++] = q.z;
        rotArray[qIdx++] = q.w;
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

    makeModelMatrix(lineModelTmp, 0, -10, 0, 0, 0, 0, 1, 13, 0.1, 13);
    lineUniformData.set(lineViewProj, 0); lineUniformData.set(lineModelTmp, 16);
    lineUniformData[32]=0; lineUniformData[33]=1; lineUniformData[34]=0; lineUniformData[35]=1;
    for (let i = 0; i < MAX; i++) {
        const px=posArray[i*3], py=posArray[i*3+1], pz=posArray[i*3+2];
        const qx=rotArray[i*4], qy=rotArray[i*4+1], qz=rotArray[i*4+2], qw=rotArray[i*4+3];
        makeModelMatrix(lineModelTmp, px, py, pz, qx, qy, qz, qw, pw, ph, pd * 1.4);
        const base = (i + 1) * (LINE_ALIGN / 4);
        lineUniformData.set(lineViewProj, base); lineUniformData.set(lineModelTmp, base + 16);
        lineUniformData[base+32]=1; lineUniformData[base+33]=1; lineUniformData[base+34]=0; lineUniformData[base+35]=1;
    }
    device.queue.writeBuffer(lineUniformBuf, 0, lineUniformData);
    if (showWireframe) {
    passEncoder.setPipeline(linePipeline);
    passEncoder.setVertexBuffer(0, lineVtxBuf);
    passEncoder.setIndexBuffer(lineIdxBuf, 'uint16');
    for (let i = 0; i < LINE_MAX; i++) {
        passEncoder.setBindGroup(0, lineBG, [i * LINE_ALIGN]);
        passEncoder.drawIndexed(24);
    }

    }
    passEncoder.end();
    device.queue.submit([commandEncoder.finish()]);
    requestAnimationFrame(render);
}

init();


window.addEventListener('keydown', event => {
    const isWKey = event.code === 'KeyW' || event.key === 'w' || event.key === 'W';
    if (!isWKey || event.repeat) return;
    showWireframe = !showWireframe;
    const hint = document.getElementById('hint');
    if (hint) hint.textContent = 'W: wireframe ' + (showWireframe ? 'ON' : 'OFF');
});