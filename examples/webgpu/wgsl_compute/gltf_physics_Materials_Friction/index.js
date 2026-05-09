'use strict';

// ── glTF source ──────────────────────────────────────────────────────────────
const GLB_URL  = 'https://raw.githubusercontent.com/eoineoineoin/glTF_Physics/master/samples/Materials_Friction/Materials_Friction.glb';
const GLTF_URL = 'https://raw.githubusercontent.com/eoineoineoin/glTF_Physics/master/samples/Materials_Friction/Materials_Friction.gltf';

// ── Physics scene definition (extracted from glTF) ───────────────────────────
// All data taken directly from Materials_Friction.gltf node/shape data.
//
// Coordinate note: glTF is right-handed Y-up.  We render in the same space.
//
// KHR_implicit_shapes (boxes, full-size → half-extents = size/2):
//   shape 0 (HoneyCombWalls OBB): size=[3.131,0.642,4.808] → h=[1.566,0.321,2.404]
//   shape 1 (Soap2 OBB):          size=[0.614,0.178,0.278] → h=[0.307,0.089,0.139] × scale 3.589
//   shape 2 (SlopedFloor OBB):    size=[10.377,0.340,10.377]→ h=[5.188,0.170,5.188]
//
// Nodes (translation, rotation[xyzw], scale):
//   HoneyCombWalls: t=[1.663,4.294,-3.762] r=[0.413,0,0,0.911] s=0.4672  friction≈0.547
//   Soap2.001:      t=[-1.348,4.191,-3.826] r=[0.294,-0.641,-0.296,0.643] s=3.589  friction≈0.024
//   SlopedFloor:    t=[0,1.281,-1.067] r=[0.253,0,0,0.967] static  friction=0

const SUBSTEPS = 8;

// Dynamic object descriptors
const OBJECTS = [
    {   // HoneyCombWalls
        name:      'HoneyCombWalls',
        color:     [0.8, 0.6449409, 0.15321295, 1.0],
        hx: (3.131088972091675 / 2) * 0.46723151206970215,
        hy: (0.6419965624809265 / 2) * 0.46723151206970215,
        hz: (4.807734966278076 / 2) * 0.46723151206970215,
        meshScale: [0.46723151206970215, 0.46723151206970215, 0.46723151206970215],
        initPos:   [1.6627352237701416, 4.293732643127441, -3.7623164653778076],
        initRot:   [0.2528818866435001, 0.0, 0.0, 0.96749715834602],
        initVel:   [0, 0, 0],
        initAngVel:[0, 0, 0],
        friction:  0.547,
        restitution: 0.0,
        mass: 1.0,
        meshIndex: 1,
    },
    {   // Soap2
        name:      'Soap2',
        color:     [0.80000007, 0.05420895, 0.36806992, 1.0],
        hx: (0.6135247349739075 / 2) * 3.5888543128967285,
        hy: (0.17837563157081604 / 2) * 3.5888540744781494,
        hz: (0.2775302827358246 / 2) * 3.5888543128967285,
        meshScale: [3.5888543128967285, 3.5888540744781494, 3.5888543128967285],
        initPos:   [-1.348071813583374, 4.19050189910889, -3.8256332874298096],
        initRot:   [0.17911746433400003, -0.6829627172830389, -0.17851101522335333, 0.685282918374487],
        initVel:   [0, 0, 0],
        initAngVel:[0, 0, 0],
        friction:  0.024,
        restitution: 0.0,
        mass: 1.0,
        meshIndex: 2,
    },
];

// Static floor
const FLOOR = {
    // SlopedFloor node: t=[0,1.281,-1.067] r=[0.253,0,0,0.967]
    pos:   [0, 1.281, -1.067],
    rot:   [0.253, 0, 0, 0.967],  // ~29° around X axis
    hx:    5.188,
    hy:    0.170,
    hz:    5.188,
    meshIndex: 3,
    color: [0.7, 0.7, 0.65, 1.0],
};

// ── glTF / GLB helpers ───────────────────────────────────────────────────────
async function fetchGLB(url) {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Fetch failed: ${url}`);
    return resp.arrayBuffer();
}

function getGLBChunks(buffer) {
    const view   = new DataView(buffer);
    const magic  = view.getUint32(0, true);
    if (magic !== 0x46546c67) throw new Error('Not a GLB file');
    let offset   = 12;
    let json     = null;
    let bin      = null;
    while (offset < buffer.byteLength) {
        const len  = view.getUint32(offset, true);
        const type = view.getUint32(offset + 4, true);
        const data = buffer.slice(offset + 8, offset + 8 + len);
        if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(data).replace(/\0+$/, ''));
        if (type === 0x004e4942) bin  = data;
        offset += 8 + len;
    }
    return { json, bin };
}

// Extract typed array from a glTF accessor
function getAccessorData(gltf, bin, accessorIndex) {
    const acc = gltf.accessors[accessorIndex];
    const bv  = gltf.bufferViews[acc.bufferView];
    const byteOffset = (bv.byteOffset || 0) + (acc.byteOffset || 0);
    const compType   = acc.componentType; // 5123=uint16, 5126=float32
    const count      = acc.count;
    const elemSize   = { SCALAR:1, VEC2:2, VEC3:3, VEC4:4 }[acc.type];
    const total      = count * elemSize;
    const Ctor       = compType === 5123 ? Uint16Array : Float32Array;
    return new Ctor(bin, byteOffset, total);
}

// ── Math helpers ─────────────────────────────────────────────────────────────
function mat4Identity() {
    return new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
}

function mat4Mul(a, b) {
    const r = new Float32Array(16);
    for (let c = 0; c < 4; c++)
        for (let row = 0; row < 4; row++) {
            let s = 0;
            for (let k = 0; k < 4; k++) s += a[k*4+row] * b[c*4+k];
            r[c*4+row] = s;
        }
    return r;
}

function mat4Perspective(fovY, aspect, near, far) {
    const f  = 1 / Math.tan(fovY / 2);
    const nf = 1 / (near - far);
    return new Float32Array([
        f/aspect, 0,  0,               0,
        0,        f,  0,               0,
        0,        0,  (far+near)*nf,  -1,
        0,        0,  2*far*near*nf,   0,
    ]);
}

function mat4LookAt(eye, center, up) {
    const f = normalize3(sub3(center, eye));
    const r = normalize3(cross3(f, up));
    const u = cross3(r, f);
    return new Float32Array([
        r[0], u[0], -f[0], 0,
        r[1], u[1], -f[1], 0,
        r[2], u[2], -f[2], 0,
        -dot3(r,eye), -dot3(u,eye), dot3(f,eye), 1,
    ]);
}

function mat4TRS(t, q, s) {
    // Build rotation matrix from quaternion
    const [x,y,z,w] = q;
    const x2=x+x, y2=y+y, z2=z+z;
    const xx=x*x2, xy=x*y2, xz=x*z2;
    const yy=y*y2, yz=y*z2, zz=z*z2;
    const wx=w*x2, wy=w*y2, wz=w*z2;
    const sx = Array.isArray(s) ? s[0] : s;
    const sy = Array.isArray(s) ? s[1] : s;
    const sz = Array.isArray(s) ? s[2] : s;
    return new Float32Array([
        (1-(yy+zz))*sx,  (xy+wz)*sx,     (xz-wy)*sx,     0,
        (xy-wz)*sy,      (1-(xx+zz))*sy,  (yz+wx)*sy,     0,
        (xz+wy)*sz,      (yz-wx)*sz,     (1-(xx+yy))*sz,  0,
        t[0], t[1], t[2], 1,
    ]);
}

// Compute rotation matrix columns from quaternion (world-space axes)
function quatToAxes(q) {
    const [x,y,z,w] = q;
    const ax = [1-2*(y*y+z*z), 2*(x*y+w*z),   2*(x*z-w*y)  ];
    const ay = [2*(x*y-w*z),   1-2*(x*x+z*z), 2*(y*z+w*x)  ];
    const az = [2*(x*z+w*y),   2*(y*z-w*x),   1-2*(x*x+y*y)];
    return [ax, ay, az];
}

// Vec3 helpers
function normalize3(v) { const l=Math.hypot(...v); return v.map(x=>x/l); }
function sub3(a,b)      { return [a[0]-b[0], a[1]-b[1], a[2]-b[2]]; }
function cross3(a,b)    { return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]; }
function dot3(a,b)      { return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]; }
function len3(v)        { return Math.hypot(...v); }

// ── Globals ──────────────────────────────────────────────────────────────────
const canvas = document.getElementById('c');
let device, ctx, format, depthTexture;
let renderPipeline, wirePipeline;

// Per-mesh GPU buffers: { vb, nb, uvb, ib, indexCount }
let meshBuffers = [];

let textureSampler;
let whiteTextureView;
let objTextureViews = [];
let floorTextureView;
let dummyStateBuffer;

// Per-dynamic-object GPU resources
let objPhysicsBuffers = [];   // GPUBuffer (storage)
let objParamsBuffers  = [];   // GPUBuffer (uniform SimParams)
let objComputeBGs     = [];   // GPUBindGroup for compute
let objRenderUBOs     = [];   // GPUBuffer for render uniforms
let objRenderBGs      = [];   // GPUBindGroup for render
let objWireUBOs       = [];   // GPUBuffer for wireframe uniforms
let objWireBGs        = [];   // GPUBindGroup for wireframe

// Floor render resources
let floorRenderUBO, floorRenderBG;
let floorWireUBO, floorWireBG;

let computePipeline;
let showWireframe = false;
let renderModel = null;

// Camera: match the WebGPU + Havok sample framing.
let camRadius = 18;
let cameraHeight = 7;
const CAM_TARGET = [0, 5, 0];

// SimParams struct size (bytes): 8 f32 + 4 vec4 + 4 f32 = (8+16+4)*4 = 112
const SIM_PARAMS_SIZE = (8 + 4*4 + 4) * 4; // = 112 bytes

// Render uniform struct: vpMatrix(64) + modelMatrix(64) + baseColor(16) + mode(16) = 160 bytes
const RENDER_UBO_SIZE = 160;

// OBB wireframe geometry: 8 verts, 12 lines = 24 indices
function makeOBBWireGeometry() {
    const v = new Float32Array([
        -1,-1,-1,  1,-1,-1,  1,1,-1, -1,1,-1,
        -1,-1, 1,  1,-1, 1,  1,1, 1, -1,1, 1,
    ]);
    const idx = new Uint16Array([
        0,1, 1,2, 2,3, 3,0,
        4,5, 5,6, 6,7, 7,4,
        0,4, 1,5, 2,6, 3,7,
    ]);
    return { v, idx };
}

// ── WebGPU buffer helpers ────────────────────────────────────────────────────
function makeBuffer(data, usage) {
    const size = (data.byteLength + 3) & ~3;
    const buf = device.createBuffer({ size, usage, mappedAtCreation: true });
    new Uint8Array(buf.getMappedRange()).set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    buf.unmap();
    return buf;
}

function makeEmptyBuffer(size, usage) {
    return device.createBuffer({ size, usage });
}

function getNodeLocalMatrix(node) {
    if (node.matrix) return new Float32Array(node.matrix);
    return mat4TRS(
        node.translation || [0, 0, 0],
        node.rotation || [0, 0, 0, 1],
        node.scale || [1, 1, 1],
    );
}

async function textureViewFromBytes(bytes, mimeType) {
    const blob = new Blob([bytes], { type: mimeType || 'image/png' });
    const bitmap = await createImageBitmap(blob, { imageOrientation: 'none' });
    const texture = device.createTexture({
        size: [bitmap.width, bitmap.height, 1],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    device.queue.copyExternalImageToTexture({ source: bitmap }, { texture }, [bitmap.width, bitmap.height]);
    return texture.createView();
}

async function buildRenderModel(gltf, bin) {
    const textureViews = [];
    for (const textureDef of gltf.textures || []) {
        const imageDef = gltf.images[textureDef.source];
        if (imageDef && imageDef.bufferView !== undefined) {
            const view = gltf.bufferViews[imageDef.bufferView];
            const bytes = new Uint8Array(bin, view.byteOffset || 0, view.byteLength);
            textureViews.push(await textureViewFromBytes(bytes, imageDef.mimeType));
        } else {
            textureViews.push(whiteTextureView);
        }
    }

    const meshes = (gltf.meshes || []).map((mesh) => ({
        primitives: mesh.primitives.map((prim) => {
            const attrs = prim.attributes;
            const posData = getAccessorData(gltf, bin, attrs.POSITION);
            const normData = attrs.NORMAL !== undefined
                ? getAccessorData(gltf, bin, attrs.NORMAL)
                : new Float32Array(posData.length);
            const uvData = attrs.TEXCOORD_0 !== undefined
                ? getAccessorData(gltf, bin, attrs.TEXCOORD_0)
                : new Float32Array((posData.length / 3) * 2);
            const idxData = prim.indices !== undefined
                ? getAccessorData(gltf, bin, prim.indices)
                : new Uint16Array(posData.length / 3).map((_, i) => i);
            const idx16 = idxData instanceof Uint16Array ? idxData : new Uint16Array(idxData);

            let baseColor = [1, 1, 1, 1];
            let textureView = whiteTextureView;
            if (prim.material !== undefined) {
                const material = gltf.materials[prim.material];
                const pbr = material && material.pbrMetallicRoughness;
                if (pbr && pbr.baseColorFactor) baseColor = pbr.baseColorFactor;
                if (pbr && pbr.baseColorTexture) {
                    textureView = textureViews[pbr.baseColorTexture.index] || whiteTextureView;
                }
            }

            const uniformBuffer = makeEmptyBuffer(RENDER_UBO_SIZE, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);

            return {
                vb: makeBuffer(posData, GPUBufferUsage.VERTEX),
                nb: makeBuffer(normData, GPUBufferUsage.VERTEX),
                uvb: makeBuffer(uvData, GPUBufferUsage.VERTEX),
                ib: makeBuffer(idx16, GPUBufferUsage.INDEX),
                indexCount: idx16.length,
                baseColor,
                textureView,
                uniformBuffer,
                bindGroups: new Map(),
            };
        }),
    }));

    const nodes = (gltf.nodes || []).map((node) => ({
        name: node.name || '',
        mesh: node.mesh,
        children: node.children || [],
        localMatrix: getNodeLocalMatrix(node),
        restWorldMatrix: mat4Identity(),
        worldMatrix: mat4Identity(),
        scale: node.scale || [1, 1, 1],
    }));

    const roots = gltf.scenes[gltf.scene || 0].nodes || [];
    function computeWorld(nodeIndex, parentMatrix) {
        const node = nodes[nodeIndex];
        node.restWorldMatrix = mat4Mul(parentMatrix, node.localMatrix);
        node.worldMatrix = node.restWorldMatrix;
        for (const child of node.children) computeWorld(child, node.restWorldMatrix);
    }
    for (const root of roots) computeWorld(root, mat4Identity());

    return { meshes, nodes, roots };
}

// ── Build SimParams uniform for a given object + floor ───────────────────────
function buildSimParams(obj, floorAxes) {
    const [fAx0, fAx1, fAx2] = floorAxes;
    const fp = FLOOR.pos;
    const data = new Float32Array(SIM_PARAMS_SIZE / 4);
    data[0] = 0; // dt — written each frame
    data[1] = 9.8;
    data[2] = obj.restitution;
    data[3] = obj.friction;
    data[4] = obj.hx;
    data[5] = obj.hy;
    data[6] = obj.hz;
    data[7] = 0;
    // floorPos (vec4)
    data[8]  = fp[0]; data[9]  = fp[1]; data[10] = fp[2]; data[11] = 0;
    // floorAx0 (vec4)
    data[12] = fAx0[0]; data[13] = fAx0[1]; data[14] = fAx0[2]; data[15] = 0;
    // floorAx1 (vec4)
    data[16] = fAx1[0]; data[17] = fAx1[1]; data[18] = fAx1[2]; data[19] = 0;
    // floorAx2 (vec4)
    data[20] = fAx2[0]; data[21] = fAx2[1]; data[22] = fAx2[2]; data[23] = 0;
    // floorHx/Hy/Hz
    data[24] = FLOOR.hx; data[25] = FLOOR.hy; data[26] = FLOOR.hz; data[27] = 0;
    return data;
}

// ── Resize ───────────────────────────────────────────────────────────────────
function resize() {
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
    if (depthTexture) depthTexture.destroy();
    depthTexture = device.createTexture({
        size:   { width: canvas.width, height: canvas.height },
        format: 'depth24plus',
        usage:  GPUTextureUsage.RENDER_ATTACHMENT,
    });
}

// ── Write render UBO ─────────────────────────────────────────────────────────
function writeRenderUBO(buf, vpMat, modelMat, color, dynamic = false) {
    const data = new Float32Array(RENDER_UBO_SIZE / 4);
    data.set(vpMat,    0);
    data.set(modelMat, 16);
    data.set(color,    32);
    data[36] = dynamic ? 1 : 0;
    device.queue.writeBuffer(buf, 0, data);
}

function getPrimitiveBindGroup(primitive, stateBuffer) {
    if (!primitive.bindGroups) primitive.bindGroups = new Map();
    const cached = primitive.bindGroups.get(stateBuffer);
    if (cached) return cached;
    const bindGroup = device.createBindGroup({
        layout: renderPipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: primitive.uniformBuffer } },
            { binding: 1, resource: textureSampler },
            { binding: 2, resource: primitive.textureView },
            { binding: 3, resource: { buffer: stateBuffer } },
        ],
    });
    primitive.bindGroups.set(stateBuffer, bindGroup);
    return bindGroup;
}

function drawRenderModel(pass, vp) {
    if (!renderModel) return;

    function drawNode(nodeIndex, parentMatrix, dynamicObjectIndex = -1, dynamicLocalMatrix = mat4Identity()) {
        const node = renderModel.nodes[nodeIndex];
        const rootDynamicIndex = OBJECTS.findIndex((obj) => node.name === obj.name || node.name.startsWith(obj.name));
        let currentDynamicIndex = dynamicObjectIndex;
        let modelMatrix;

        if (rootDynamicIndex >= 0) {
            currentDynamicIndex = rootDynamicIndex;
            modelMatrix = mat4TRS([0, 0, 0], [0, 0, 0, 1], OBJECTS[rootDynamicIndex].meshScale);
        } else if (currentDynamicIndex >= 0) {
            modelMatrix = mat4Mul(dynamicLocalMatrix, node.localMatrix);
        } else {
            modelMatrix = mat4Mul(parentMatrix, node.localMatrix);
        }

        if (node.mesh !== undefined) {
            const mesh = renderModel.meshes[node.mesh];
            for (const primitive of mesh.primitives) {
                const dynamic = currentDynamicIndex >= 0;
                const stateBuffer = dynamic ? objPhysicsBuffers[currentDynamicIndex] : dummyStateBuffer;
                writeRenderUBO(primitive.uniformBuffer, vp, modelMatrix, primitive.baseColor, dynamic);
                pass.setBindGroup(0, getPrimitiveBindGroup(primitive, stateBuffer));
                pass.setVertexBuffer(0, primitive.vb);
                pass.setVertexBuffer(1, primitive.nb);
                pass.setVertexBuffer(2, primitive.uvb);
                pass.setIndexBuffer(primitive.ib, 'uint16');
                pass.drawIndexed(primitive.indexCount);
            }
        }

        for (const child of node.children) {
            if (currentDynamicIndex >= 0) {
                drawNode(child, parentMatrix, currentDynamicIndex, modelMatrix);
            } else {
                drawNode(child, modelMatrix, -1, mat4Identity());
            }
        }
    }

    for (const root of renderModel.roots) drawNode(root, mat4Identity());
}

// ── Render loop ──────────────────────────────────────────────────────────────
let lastTime = -1;

function frame(timeMs) {
    if (lastTime < 0) lastTime = timeMs;
    const dt = Math.min((timeMs - lastTime) / 1000, 1 / 30);
    lastTime = timeMs;

    // ── Camera ────────────────────────────────────────────────────────────
    const t = timeMs * 0.001;
    const eye = [
        CAM_TARGET[0] + Math.sin(t * 0.2) * camRadius,
        CAM_TARGET[1] + cameraHeight,
        CAM_TARGET[2] + Math.cos(t * 0.2) * camRadius,
    ];
    const proj = mat4Perspective(Math.PI / 4, canvas.width / canvas.height, 0.1, 200);
    const view = mat4LookAt(eye, CAM_TARGET, [0, 1, 0]);
    const vp   = mat4Mul(proj, view);

    // ── Physics substeps ──────────────────────────────────────────────────
    const subDt = dt / SUBSTEPS;
    const encoder = device.createCommandEncoder();

    for (let s = 0; s < SUBSTEPS; s++) {
        for (let oi = 0; oi < OBJECTS.length; oi++) {
            // Write dt into params buffer (offset 0, 4 bytes)
            device.queue.writeBuffer(objParamsBuffers[oi], 0, new Float32Array([subDt]));
            const cp = encoder.beginComputePass();
            cp.setPipeline(computePipeline);
            cp.setBindGroup(0, objComputeBGs[oi]);
            cp.dispatchWorkgroups(1);
            cp.end();
        }
    }

    // ── Render pass ───────────────────────────────────────────────────────
    // Update wireframe UBOs. Dynamic OBBs read position/rotation from GPU state.
    {
        const wmodel = mat4TRS(FLOOR.pos, FLOOR.rot, [FLOOR.hx, FLOOR.hy, FLOOR.hz]);
        writeRenderUBO(floorWireUBO, vp, wmodel, [0, 1, 0, 1], false);
    }
    for (let oi = 0; oi < OBJECTS.length; oi++) {
        const obj = OBJECTS[oi];
        const wmodel = mat4TRS([0, 0, 0], [0, 0, 0, 1], [obj.hx, obj.hy, obj.hz]);
        writeRenderUBO(objWireUBOs[oi], vp, wmodel, [0, 1, 0, 1], true);
    }

    const pass = encoder.beginRenderPass({
        colorAttachments: [{
            view:       ctx.getCurrentTexture().createView(),
            clearValue: { r: 0.035, g: 0.035, b: 0.04, a: 1 },
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

    pass.setPipeline(renderPipeline);
    drawRenderModel(pass, vp);

    // Wireframe
    if (showWireframe) {
        const { wireVB, wireIB, wireIdxCount } = window._wireGeo;
        pass.setPipeline(wirePipeline);

        pass.setBindGroup(0, floorWireBG);
        pass.setVertexBuffer(0, wireVB);
        pass.setIndexBuffer(wireIB, 'uint16');
        pass.drawIndexed(wireIdxCount);

        for (let oi = 0; oi < OBJECTS.length; oi++) {
            pass.setBindGroup(0, objWireBGs[oi]);
            pass.setVertexBuffer(0, wireVB);
            pass.setIndexBuffer(wireIB, 'uint16');
            pass.drawIndexed(wireIdxCount);
        }
    }

    pass.end();
    device.queue.submit([encoder.finish()]);

    requestAnimationFrame(frame);
}

// ── Init ─────────────────────────────────────────────────────────────────────
async function init() {
    if (!navigator.gpu) throw new Error('WebGPU not supported.');
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('No GPU adapter found.');
    device = await adapter.requestDevice();

    ctx    = canvas.getContext('webgpu');
    format = navigator.gpu.getPreferredCanvasFormat();
    ctx.configure({ device, format, alphaMode: 'opaque' });

    resize();
    window.addEventListener('resize', resize);

    // ── Load GLB ──────────────────────────────────────────────────────────
    const glbBuf = await fetchGLB(GLB_URL);
    const { json: gltf, bin } = getGLBChunks(glbBuf);

    // ── Upload mesh buffers for each mesh ─────────────────────────────────
    meshBuffers = gltf.meshes.map((mesh, mi) => {
        const prim     = mesh.primitives[0];
        const posData  = getAccessorData(gltf, bin, prim.attributes['POSITION']);
        const normData = getAccessorData(gltf, bin, prim.attributes['NORMAL']);
        const idxData  = getAccessorData(gltf, bin, prim.indices);
        const idx16    = idxData instanceof Uint16Array ? idxData : new Uint16Array(idxData);
        // UV: use accessor if present, else generate zero UV
        let uvData;
        if (prim.attributes['TEXCOORD_0'] != null) {
            uvData = getAccessorData(gltf, bin, prim.attributes['TEXCOORD_0']);
        } else {
            uvData = new Float32Array(posData.length / 3 * 2);
        }
        return {
            vb:         makeBuffer(posData,  GPUBufferUsage.VERTEX),
            nb:         makeBuffer(normData, GPUBufferUsage.VERTEX),
            uvb:        makeBuffer(uvData,   GPUBufferUsage.VERTEX),
            ib:         makeBuffer(idx16,    GPUBufferUsage.INDEX),
            indexCount: idx16.length,
        };
    });

    // ── Render pipeline ───────────────────────────────────────────────────
    renderPipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: {
            module:     device.createShaderModule({ code: document.getElementById('vs').textContent }),
            entryPoint: 'main',
            buffers: [
                { arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] },
                { arrayStride: 12, attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x3' }] },
                { arrayStride:  8, attributes: [{ shaderLocation: 2, offset: 0, format: 'float32x2' }] },
            ],
        },
        fragment: {
            module:     device.createShaderModule({ code: document.getElementById('fs').textContent }),
            entryPoint: 'main',
            targets:    [{ format }],
        },
        primitive:    { topology: 'triangle-list', cullMode: 'none' },
        depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
    });

    // ── Wireframe pipeline ────────────────────────────────────────────────
    wirePipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: {
            module:     device.createShaderModule({ code: document.getElementById('wvs').textContent }),
            entryPoint: 'main',
            buffers: [{ arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] }],
        },
        fragment: {
            module:     device.createShaderModule({ code: document.getElementById('wfs').textContent }),
            entryPoint: 'main',
            targets:    [{ format }],
        },
        primitive:    { topology: 'line-list', cullMode: 'none' },
        depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less-equal' },
    });

    // ── Wireframe OBB geometry ────────────────────────────────────────────
    const { v: wv, idx: wi } = makeOBBWireGeometry();
    window._wireGeo = {
        wireVB:      makeBuffer(wv, GPUBufferUsage.VERTEX),
        wireIB:      makeBuffer(wi, GPUBufferUsage.INDEX),
        wireIdxCount: wi.length,
    };

    // ── Compute pipeline ──────────────────────────────────────────────────
    computePipeline = device.createComputePipeline({
        layout:  'auto',
        compute: {
            module:     device.createShaderModule({ code: document.getElementById('cs').textContent }),
            entryPoint: 'main',
        },
    });

    // ── Texture sampler + fallback white texture ─────────────────────────
    textureSampler = device.createSampler({
        magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear',
        addressModeU: 'repeat', addressModeV: 'repeat',
    });
    {
        const t = device.createTexture({
            size: [1, 1, 1], format: 'rgba8unorm',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        });
        device.queue.writeTexture({ texture: t }, new Uint8Array([255, 255, 255, 255]),
            { bytesPerRow: 4 }, [1, 1, 1]);
        whiteTextureView = t.createView();
    }
    dummyStateBuffer = makeBuffer(new Float32Array([
        0, 0, 0, 0,
        0, 0, 0, 0,
        0, 0, 0, 1,
        0, 0, 0, 0,
    ]), GPUBufferUsage.STORAGE);
    // Try to load floor texture (external PNG alongside GLB)
    floorTextureView = whiteTextureView;
    try {
        const baseUrl = GLB_URL.substring(0, GLB_URL.lastIndexOf('/') + 1);
        const imgRes  = await fetch(baseUrl + 'SlopedFloor_color.png');
        if (imgRes.ok) {
            const blob   = await imgRes.blob();
            const bitmap = await createImageBitmap(blob);
            const t = device.createTexture({
                size: [bitmap.width, bitmap.height, 1], format: 'rgba8unorm',
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST |
                       GPUTextureUsage.RENDER_ATTACHMENT,
            });
            device.queue.copyExternalImageToTexture({ source: bitmap }, { texture: t },
                [bitmap.width, bitmap.height]);
            floorTextureView = t.createView();
            FLOOR.color = [1, 1, 1, 1];
        }
    } catch (e) { /* fallback to white */ }

    renderModel = await buildRenderModel(gltf, bin);

    // ── Floor axes (for SimParams) ────────────────────────────────────────
    const [fAx0, fAx1, fAx2] = quatToAxes(FLOOR.rot);

    // ── Per-object GPU resources ──────────────────────────────────────────
    for (let oi = 0; oi < OBJECTS.length; oi++) {
        const obj = OBJECTS[oi];

        // Physics state buffer: 16 floats
        const initState = new Float32Array([
            ...obj.initPos, 0,
            ...obj.initVel, 0,
            ...obj.initRot,
            ...obj.initAngVel, 0,
        ]);
        const physBuf = makeBuffer(initState, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
        objPhysicsBuffers.push(physBuf);

        // SimParams buffer
        const paramsData = buildSimParams(obj, [fAx0, fAx1, fAx2]);
        const paramsBuf  = device.createBuffer({
            size:  SIM_PARAMS_SIZE,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        device.queue.writeBuffer(paramsBuf, 0, paramsData);
        objParamsBuffers.push(paramsBuf);

        // Compute bind group
        const computeBG = device.createBindGroup({
            layout: computePipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: physBuf } },
                { binding: 1, resource: { buffer: paramsBuf } },
            ],
        });
        objComputeBGs.push(computeBG);

        // Render UBO + bind group
        const rUBO = makeEmptyBuffer(RENDER_UBO_SIZE, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
        objRenderUBOs.push(rUBO);
        const objTexView = whiteTextureView;
        objTextureViews.push(objTexView);
        objRenderBGs.push(device.createBindGroup({
            layout: renderPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: rUBO } },
                { binding: 1, resource: textureSampler },
                { binding: 2, resource: objTexView },
                { binding: 3, resource: { buffer: physBuf } },
            ],
        }));

        // Wireframe UBO + bind group
        const wUBO = makeEmptyBuffer(RENDER_UBO_SIZE, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
        objWireUBOs.push(wUBO);
        objWireBGs.push(device.createBindGroup({
            layout: wirePipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: wUBO } },
                { binding: 1, resource: { buffer: physBuf } },
            ],
        }));
    }

    // ── Floor render resources ────────────────────────────────────────────
    floorRenderUBO = makeEmptyBuffer(RENDER_UBO_SIZE, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
    floorRenderBG  = device.createBindGroup({
        layout:  renderPipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: floorRenderUBO } },
            { binding: 1, resource: textureSampler },
            { binding: 2, resource: floorTextureView },
            { binding: 3, resource: { buffer: dummyStateBuffer } },
        ],
    });
    floorWireUBO = makeEmptyBuffer(RENDER_UBO_SIZE, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
    floorWireBG  = device.createBindGroup({
        layout:  wirePipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: floorWireUBO } },
            { binding: 1, resource: { buffer: dummyStateBuffer } },
        ],
    });

    // ── W key toggle ──────────────────────────────────────────────────────
    window.addEventListener('keydown', e => {
        if (e.key === 'w' || e.key === 'W') {
            showWireframe = !showWireframe;
            document.getElementById('hint').textContent =
                'W: debug OBB ' + (showWireframe ? 'ON' : 'OFF');
        }
    });

    requestAnimationFrame(frame);
}

init().catch(err => { console.error(err); alert(err.message); });
