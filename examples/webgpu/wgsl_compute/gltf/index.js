'use strict';

const computeShaderWGSL = document.getElementById('cs').textContent;
const vertexShaderWGSL = document.getElementById('vs').textContent;
const fragmentShaderWGSL = document.getElementById('fs').textContent;
const groundVertexWGSL = document.getElementById('gvs').textContent;
const groundFragmentWGSL = document.getElementById('gfs').textContent;
const wireVertexWGSL = document.getElementById('wvs').textContent;
const wireFragmentWGSL = document.getElementById('wfs').textContent;

const DUCK_GLTF_URL = 'https://rawcdn.githack.com/cx20/gltf-test/5465cc37/sampleModels/Duck/glTF/Duck.gltf';
const FALL_SCALE = 5.0;
const GROUND_Y = 0.0;
const SUBSTEPS = 6;
const STATE_FLOATS = 16;
const RENDER_UBO_SIZE = 160;
const GROUND_UBO_SIZE = 144;
const WIRE_UBO_SIZE = 160;
const SIM_PARAMS_SIZE = 48;

const canvas = document.getElementById('c');
let device, context, format, depthTexture;
let renderPipeline, groundPipeline, wirePipeline, computePipeline;
let sampler, whiteTextureView;
let duckModel, groundMesh, wireMesh;
let stateBuffer, simParamsBuffer, groundUniformBuffer, groundBindGroup, wireUniformBuffer, wireBindGroup;
let computeBindGroup;
let renderBindGroups = new Map();
let showWireframe = true;
let lastTime = -1;
let duckHalfExtents = [1, 1, 1];
let duckCenter = [0, 0, 0];

const projectionMatrix = new Float32Array(16);
const viewMatrix = new Float32Array(16);
const viewProjectionMatrix = new Float32Array(16);
const identityMatrix = mat4Identity();

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

function createMesh(positions, normals, uvs) {
    return {
        positionBuffer: createVertexBuffer(positions),
        normalBuffer: createVertexBuffer(normals),
        uvBuffer: createVertexBuffer(uvs),
        vertexCount: positions.length / 3,
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

function createGroundMesh() {
    const positions = new Float32Array([
        -0.5, 0.0, -0.5, 0.5, 0.0, -0.5, 0.5, 0.0, 0.5,
        -0.5, 0.0, -0.5, 0.5, 0.0, 0.5, -0.5, 0.0, 0.5,
    ]);
    const normals = new Float32Array([
        0, 1, 0, 0, 1, 0, 0, 1, 0,
        0, 1, 0, 0, 1, 0, 0, 1, 0,
    ]);
    const uvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1]);
    return createMesh(positions, normals, uvs);
}

function createWireMesh() {
    const positions = new Float32Array([
        -1,-1,-1,  1,-1,-1,  1,1,-1, -1,1,-1,
        -1,-1, 1,  1,-1, 1,  1,1, 1, -1,1, 1,
    ]);
    const indices = new Uint16Array([
        0,1, 1,2, 2,3, 3,0,
        4,5, 5,6, 6,7, 7,4,
        0,4, 1,5, 2,6, 3,7,
    ]);
    return {
        positionBuffer: createVertexBuffer(positions),
        indexBuffer: createIndexBuffer(indices),
        indexCount: indices.length,
    };
}

function createSolidTextureView(r, g, b, a) {
    const texture = device.createTexture({
        size: [1, 1, 1],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    device.queue.writeTexture({ texture }, new Uint8Array([r, g, b, a]), { bytesPerRow: 4 }, [1, 1, 1]);
    return texture.createView();
}

async function loadTextureView(url) {
    const response = await fetch(url);
    const blob = await response.blob();
    const bitmap = await createImageBitmap(blob, { imageOrientation: 'none' });
    const texture = device.createTexture({
        size: [bitmap.width, bitmap.height, 1],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    device.queue.copyExternalImageToTexture({ source: bitmap }, { texture }, [bitmap.width, bitmap.height]);
    bitmap.close();
    return texture.createView();
}

async function loadGLTF(url) {
    const response = await fetch(url);
    const gltf = await response.json();
    const baseUrl = url.substring(0, url.lastIndexOf('/') + 1);
    const buffers = [];
    for (const bufferDef of gltf.buffers || []) {
        const bufferUrl = new URL(bufferDef.uri, baseUrl).href;
        const data = await fetch(bufferUrl).then(r => r.arrayBuffer());
        buffers.push(new Uint8Array(data));
    }
    return { gltf, buffers, baseUrl };
}

function getAccessorData(gltf, buffers, accessorIndex) {
    const accessor = gltf.accessors[accessorIndex];
    const bufferView = gltf.bufferViews[accessor.bufferView];
    const buffer = buffers[bufferView.buffer || 0];
    const componentMap = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
    const compsMap = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
    const TypedArray = componentMap[accessor.componentType];
    const components = compsMap[accessor.type];
    const byteOffset = (bufferView.byteOffset || 0) + (accessor.byteOffset || 0);
    const byteStride = bufferView.byteStride || 0;
    const packedStride = TypedArray.BYTES_PER_ELEMENT * components;

    if (byteStride && byteStride !== packedStride) {
        const out = new TypedArray(accessor.count * components);
        const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
        for (let i = 0; i < accessor.count; i++) {
            const src = byteOffset + i * byteStride;
            for (let c = 0; c < components; c++) {
                const at = src + c * TypedArray.BYTES_PER_ELEMENT;
                const dst = i * components + c;
                if (accessor.componentType === 5126) out[dst] = view.getFloat32(at, true);
                else if (accessor.componentType === 5125) out[dst] = view.getUint32(at, true);
                else if (accessor.componentType === 5123) out[dst] = view.getUint16(at, true);
                else if (accessor.componentType === 5122) out[dst] = view.getInt16(at, true);
                else if (accessor.componentType === 5121) out[dst] = view.getUint8(at);
                else out[dst] = view.getInt8(at);
            }
        }
        return out;
    }

    return new TypedArray(buffer.buffer, buffer.byteOffset + byteOffset, accessor.count * components);
}

function calculateBoundingBox(positions) {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < positions.length; i += 3) {
        min[0] = Math.min(min[0], positions[i]);
        min[1] = Math.min(min[1], positions[i + 1]);
        min[2] = Math.min(min[2], positions[i + 2]);
        max[0] = Math.max(max[0], positions[i]);
        max[1] = Math.max(max[1], positions[i + 1]);
        max[2] = Math.max(max[2], positions[i + 2]);
    }
    return { min, max };
}

function mergeBoundingBox(a, b) {
    return {
        min: [Math.min(a.min[0], b.min[0]), Math.min(a.min[1], b.min[1]), Math.min(a.min[2], b.min[2])],
        max: [Math.max(a.max[0], b.max[0]), Math.max(a.max[1], b.max[1]), Math.max(a.max[2], b.max[2])],
    };
}

function computeFlatNormals(positions, indices) {
    const normals = new Float32Array(positions.length);
    const triangleCount = indices ? indices.length : positions.length / 3;
    for (let i = 0; i < triangleCount; i += 3) {
        const a = indices ? indices[i] : i;
        const b = indices ? indices[i + 1] : i + 1;
        const c = indices ? indices[i + 2] : i + 2;
        const ai = a * 3, bi = b * 3, ci = c * 3;
        const ab = [positions[bi] - positions[ai], positions[bi + 1] - positions[ai + 1], positions[bi + 2] - positions[ai + 2]];
        const ac = [positions[ci] - positions[ai], positions[ci + 1] - positions[ai + 1], positions[ci + 2] - positions[ai + 2]];
        const n = normalize3(cross3(ab, ac));
        for (const idx of [a, b, c]) {
            normals[idx * 3] += n[0];
            normals[idx * 3 + 1] += n[1];
            normals[idx * 3 + 2] += n[2];
        }
    }
    for (let i = 0; i < normals.length; i += 3) {
        const n = normalize3([normals[i], normals[i + 1], normals[i + 2]]);
        normals[i] = n[0];
        normals[i + 1] = n[1];
        normals[i + 2] = n[2];
    }
    return normals;
}

function expandToTriangles(positions, normals, uvs, indices) {
    if (!indices) return { positions, normals, uvs };
    const outPositions = new Float32Array(indices.length * 3);
    const outNormals = new Float32Array(indices.length * 3);
    const outUvs = new Float32Array(indices.length * 2);
    for (let i = 0; i < indices.length; i++) {
        const src = indices[i];
        outPositions[i * 3] = positions[src * 3];
        outPositions[i * 3 + 1] = positions[src * 3 + 1];
        outPositions[i * 3 + 2] = positions[src * 3 + 2];
        outNormals[i * 3] = normals[src * 3];
        outNormals[i * 3 + 1] = normals[src * 3 + 1];
        outNormals[i * 3 + 2] = normals[src * 3 + 2];
        outUvs[i * 2] = uvs[src * 2];
        outUvs[i * 2 + 1] = uvs[src * 2 + 1];
    }
    return { positions: outPositions, normals: outNormals, uvs: outUvs };
}

function getNodeLocalMatrix(node) {
    if (node.matrix) return new Float32Array(node.matrix);
    return mat4TRS(node.translation || [0, 0, 0], node.rotation || [0, 0, 0, 1], node.scale || [1, 1, 1]);
}

async function buildDuckModel(url) {
    const { gltf, buffers, baseUrl } = await loadGLTF(url);
    const textureViews = [];
    for (const textureDef of gltf.textures || []) {
        const imageDef = gltf.images[textureDef.source];
        textureViews.push(imageDef && imageDef.uri ? await loadTextureView(new URL(imageDef.uri, baseUrl).href) : whiteTextureView);
    }

    const nodes = (gltf.nodes || []).map(node => ({
        mesh: node.mesh,
        children: node.children || [],
        localMatrix: getNodeLocalMatrix(node),
        restWorldMatrix: mat4Identity(),
    }));

    const meshes = [];
    for (const meshDef of gltf.meshes || []) {
        const primitives = [];
        for (const primitive of meshDef.primitives) {
            const attrs = primitive.attributes;
            const positions = getAccessorData(gltf, buffers, attrs.POSITION);
            const indices = primitive.indices !== undefined ? getAccessorData(gltf, buffers, primitive.indices) : null;
            const normals = attrs.NORMAL !== undefined ? getAccessorData(gltf, buffers, attrs.NORMAL) : computeFlatNormals(positions, indices);
            const uvs = attrs.TEXCOORD_0 !== undefined ? getAccessorData(gltf, buffers, attrs.TEXCOORD_0) : new Float32Array((positions.length / 3) * 2);
            const expanded = expandToTriangles(positions, normals, uvs, indices);
            const mesh = createMesh(expanded.positions, expanded.normals, expanded.uvs);
            const bbox = calculateBoundingBox(positions);
            let textureView = whiteTextureView;
            let baseColor = [1, 1, 1, 1];
            if (primitive.material !== undefined) {
                const material = gltf.materials[primitive.material];
                const pbr = material && material.pbrMetallicRoughness;
                if (pbr && pbr.baseColorFactor) baseColor = pbr.baseColorFactor;
                if (pbr && pbr.baseColorTexture) textureView = textureViews[pbr.baseColorTexture.index] || whiteTextureView;
            }
            const uniformBuffer = device.createBuffer({ size: RENDER_UBO_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
            primitives.push({ mesh, bbox, baseColor, textureView, uniformBuffer });
        }
        let meshBbox = primitives[0].bbox;
        for (let i = 1; i < primitives.length; i++) meshBbox = mergeBoundingBox(meshBbox, primitives[i].bbox);
        meshes.push({ primitives, bbox: meshBbox });
    }

    const roots = gltf.scenes[gltf.scene || 0].nodes || [];
    function computeWorld(nodeIndex, parentMatrix) {
        const node = nodes[nodeIndex];
        node.restWorldMatrix = mat4Multiply(parentMatrix, node.localMatrix);
        for (const child of node.children) computeWorld(child, node.restWorldMatrix);
    }
    for (const root of roots) computeWorld(root, mat4Identity());

    let modelBbox = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    function traverseBbox(nodeIndex) {
        const node = nodes[nodeIndex];
        if (node.mesh !== undefined) {
            const bbox = meshes[node.mesh].bbox;
            for (const corner of bboxCorners(bbox)) {
                const p = transformPoint(node.restWorldMatrix, corner);
                modelBbox.min[0] = Math.min(modelBbox.min[0], p[0]);
                modelBbox.min[1] = Math.min(modelBbox.min[1], p[1]);
                modelBbox.min[2] = Math.min(modelBbox.min[2], p[2]);
                modelBbox.max[0] = Math.max(modelBbox.max[0], p[0]);
                modelBbox.max[1] = Math.max(modelBbox.max[1], p[1]);
                modelBbox.max[2] = Math.max(modelBbox.max[2], p[2]);
            }
        }
        for (const child of node.children) traverseBbox(child);
    }
    for (const root of roots) traverseBbox(root);

    duckCenter = [
        (modelBbox.min[0] + modelBbox.max[0]) * 0.5 * FALL_SCALE,
        (modelBbox.min[1] + modelBbox.max[1]) * 0.5 * FALL_SCALE,
        (modelBbox.min[2] + modelBbox.max[2]) * 0.5 * FALL_SCALE,
    ];
    duckHalfExtents = [
        (modelBbox.max[0] - modelBbox.min[0]) * 0.5 * FALL_SCALE,
        (modelBbox.max[1] - modelBbox.min[1]) * 0.5 * FALL_SCALE,
        (modelBbox.max[2] - modelBbox.min[2]) * 0.5 * FALL_SCALE,
    ];

    return { nodes, meshes, roots };
}

function bboxCorners(bbox) {
    return [
        [bbox.min[0], bbox.min[1], bbox.min[2]], [bbox.max[0], bbox.min[1], bbox.min[2]],
        [bbox.min[0], bbox.max[1], bbox.min[2]], [bbox.max[0], bbox.max[1], bbox.min[2]],
        [bbox.min[0], bbox.min[1], bbox.max[2]], [bbox.max[0], bbox.min[1], bbox.max[2]],
        [bbox.min[0], bbox.max[1], bbox.max[2]], [bbox.max[0], bbox.max[1], bbox.max[2]],
    ];
}

function getRenderBindGroup(primitive) {
    if (renderBindGroups.has(primitive)) return renderBindGroups.get(primitive);
    const bindGroup = device.createBindGroup({
        layout: renderPipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: primitive.uniformBuffer } },
            { binding: 1, resource: sampler },
            { binding: 2, resource: primitive.textureView },
            { binding: 3, resource: { buffer: stateBuffer } },
        ],
    });
    renderBindGroups.set(primitive, bindGroup);
    return bindGroup;
}

function writeRenderUniforms(buffer, vp, model, color) {
    const data = new Float32Array(RENDER_UBO_SIZE / 4);
    data.set(vp, 0);
    data.set(model, 16);
    data.set(color, 32);
    data[36] = 1;
    device.queue.writeBuffer(buffer, 0, data);
}

function writeGroundUniforms(buffer, vp, model, color) {
    const data = new Float32Array(GROUND_UBO_SIZE / 4);
    data.set(vp, 0);
    data.set(model, 16);
    data.set(color, 32);
    device.queue.writeBuffer(buffer, 0, data);
}

function drawDuckNode(pass, nodeIndex, parentMatrix) {
    const node = duckModel.nodes[nodeIndex];
    const worldMatrix = mat4Multiply(parentMatrix, node.localMatrix);
    if (node.mesh !== undefined) {
        const meshRecord = duckModel.meshes[node.mesh];
        const centeredScale = mat4Multiply(mat4Translation([-duckCenter[0], -duckCenter[1], -duckCenter[2]]), mat4Scale([FALL_SCALE, FALL_SCALE, FALL_SCALE]));
        const modelMatrix = mat4Multiply(centeredScale, worldMatrix);
        for (const primitive of meshRecord.primitives) {
            writeRenderUniforms(primitive.uniformBuffer, viewProjectionMatrix, modelMatrix, primitive.baseColor);
            pass.setBindGroup(0, getRenderBindGroup(primitive));
            pass.setVertexBuffer(0, primitive.mesh.positionBuffer);
            pass.setVertexBuffer(1, primitive.mesh.normalBuffer);
            pass.setVertexBuffer(2, primitive.mesh.uvBuffer);
            pass.draw(primitive.mesh.vertexCount);
        }
    }
    for (const child of node.children) drawDuckNode(pass, child, worldMatrix);
}

function frame(timeMs) {
    if (lastTime < 0) lastTime = timeMs;
    const dt = Math.min((timeMs - lastTime) / 1000, 1 / 30);
    lastTime = timeMs;

    writeCamera(timeMs);
    const simData = new Float32Array(SIM_PARAMS_SIZE / 4);
    simData[0] = dt / SUBSTEPS;
    simData[1] = 9.8;
    simData[2] = GROUND_Y;
    simData[3] = 0.22;
    simData.set([...duckHalfExtents, 0], 4);
    simData[8] = 0.55;
    simData[9] = 1.0;
    simData[10] = 1.0 / Math.max(duckHalfExtents[0] * duckHalfExtents[0] + duckHalfExtents[2] * duckHalfExtents[2], 0.001);
    device.queue.writeBuffer(simParamsBuffer, 0, simData);

    const encoder = device.createCommandEncoder();
    for (let i = 0; i < SUBSTEPS; i++) {
        const pass = encoder.beginComputePass();
        pass.setPipeline(computePipeline);
        pass.setBindGroup(0, computeBindGroup);
        pass.dispatchWorkgroups(1);
        pass.end();
    }

    const renderPass = encoder.beginRenderPass({
        colorAttachments: [{
            view: context.getCurrentTexture().createView(),
            clearValue: { r: 0.97, g: 0.97, b: 0.98, a: 1 },
            loadOp: 'clear',
            storeOp: 'store',
        }],
        depthStencilAttachment: {
            view: depthTexture.createView(),
            depthClearValue: 1,
            depthLoadOp: 'clear',
            depthStoreOp: 'store',
        },
    });

    renderPass.setPipeline(groundPipeline);
    const groundModel = mat4TRS([0, GROUND_Y, 0], [0, 0, 0, 1], [24, 1, 24]);
    writeGroundUniforms(groundUniformBuffer, viewProjectionMatrix, groundModel, [0.34, 0.52, 0.33, 1]);
    renderPass.setBindGroup(0, groundBindGroup);
    renderPass.setVertexBuffer(0, groundMesh.positionBuffer);
    renderPass.setVertexBuffer(1, groundMesh.normalBuffer);
    renderPass.draw(groundMesh.vertexCount);

    renderPass.setPipeline(renderPipeline);
    for (const root of duckModel.roots) drawDuckNode(renderPass, root, identityMatrix);

    if (showWireframe) {
        renderPass.setPipeline(wirePipeline);
        const wireModel = mat4Scale(duckHalfExtents);
        writeGroundUniforms(wireUniformBuffer, viewProjectionMatrix, wireModel, [0, 1, 0, 1]);
        renderPass.setBindGroup(0, wireBindGroup);
        renderPass.setVertexBuffer(0, wireMesh.positionBuffer);
        renderPass.setIndexBuffer(wireMesh.indexBuffer, 'uint16');
        renderPass.drawIndexed(wireMesh.indexCount);
    }

    renderPass.end();
    device.queue.submit([encoder.finish()]);
    requestAnimationFrame(frame);
}

function writeCamera(timeMs) {
    const t = timeMs * 0.00025;
    const eye = [Math.sin(t) * 20, 9, Math.cos(t) * 20];
    mat4Perspective(projectionMatrix, Math.PI / 4, canvas.width / canvas.height, 0.1, 150);
    mat4LookAt(viewMatrix, eye, [0, 4, 0], [0, 1, 0]);
    viewProjectionMatrix.set(mat4Multiply(projectionMatrix, viewMatrix));
}

async function init() {
    if (!navigator.gpu) throw new Error('WebGPU not supported.');
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('No GPU adapter found.');
    device = await adapter.requestDevice();
    context = canvas.getContext('webgpu');
    format = navigator.gpu.getPreferredCanvasFormat();

    sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear' });
    whiteTextureView = createSolidTextureView(255, 255, 255, 255);

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
        fragment: { module: device.createShaderModule({ code: fragmentShaderWGSL }), entryPoint: 'main', targets: [{ format }] },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
    });

    groundPipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: {
            module: device.createShaderModule({ code: groundVertexWGSL }),
            entryPoint: 'main',
            buffers: [
                { arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] },
                { arrayStride: 12, attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x3' }] },
            ],
        },
        fragment: { module: device.createShaderModule({ code: groundFragmentWGSL }), entryPoint: 'main', targets: [{ format }] },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
    });

    wirePipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: {
            module: device.createShaderModule({ code: wireVertexWGSL }),
            entryPoint: 'main',
            buffers: [{ arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] }],
        },
        fragment: { module: device.createShaderModule({ code: wireFragmentWGSL }), entryPoint: 'main', targets: [{ format }] },
        primitive: { topology: 'line-list', cullMode: 'none' },
        depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less-equal' },
    });

    computePipeline = device.createComputePipeline({
        layout: 'auto',
        compute: { module: device.createShaderModule({ code: computeShaderWGSL }), entryPoint: 'main' },
    });

    groundMesh = createGroundMesh();
    wireMesh = createWireMesh();
    duckModel = await buildDuckModel(DUCK_GLTF_URL);

    stateBuffer = device.createBuffer({ size: STATE_FLOATS * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, mappedAtCreation: true });
    new Float32Array(stateBuffer.getMappedRange()).set([
        0, 12, 0, 0,
        0, 0, 0, 0,
        0.15, 0.25, 0, 0.955,
        0.45, 0.7, 0.25, 0,
    ]);
    stateBuffer.unmap();
    simParamsBuffer = device.createBuffer({ size: SIM_PARAMS_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    groundUniformBuffer = device.createBuffer({ size: GROUND_UBO_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    wireUniformBuffer = device.createBuffer({ size: WIRE_UBO_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    computeBindGroup = device.createBindGroup({
        layout: computePipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: stateBuffer } },
            { binding: 1, resource: { buffer: simParamsBuffer } },
        ],
    });

    groundBindGroup = device.createBindGroup({
        layout: groundPipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: groundUniformBuffer } }],
    });
    wireBindGroup = device.createBindGroup({
        layout: wirePipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: wireUniformBuffer } },
            { binding: 1, resource: { buffer: stateBuffer } },
        ],
    });

    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('keydown', event => {
        if (event.key === 'w' || event.key === 'W') {
            showWireframe = !showWireframe;
            document.getElementById('hint').textContent = 'W: debug collider ' + (showWireframe ? 'ON' : 'OFF');
        }
    });

    requestAnimationFrame(frame);
}

function mat4Identity() {
    return new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
}

function mat4Scale(s) {
    return new Float32Array([s[0],0,0,0, 0,s[1],0,0, 0,0,s[2],0, 0,0,0,1]);
}

function mat4Translation(t) {
    return new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, t[0],t[1],t[2],1]);
}

function mat4TRS(t, q, s) {
    const [x,y,z,w] = q;
    const x2=x+x, y2=y+y, z2=z+z;
    const xx=x*x2, xy=x*y2, xz=x*z2;
    const yy=y*y2, yz=y*z2, zz=z*z2;
    const wx=w*x2, wy=w*y2, wz=w*z2;
    return new Float32Array([
        (1-(yy+zz))*s[0], (xy+wz)*s[0], (xz-wy)*s[0], 0,
        (xy-wz)*s[1], (1-(xx+zz))*s[1], (yz+wx)*s[1], 0,
        (xz+wy)*s[2], (yz-wx)*s[2], (1-(xx+yy))*s[2], 0,
        t[0], t[1], t[2], 1,
    ]);
}

function mat4Multiply(a, b) {
    const out = new Float32Array(16);
    for (let c = 0; c < 4; c++) {
        for (let r = 0; r < 4; r++) {
            out[c * 4 + r] =
                a[0 * 4 + r] * b[c * 4 + 0] +
                a[1 * 4 + r] * b[c * 4 + 1] +
                a[2 * 4 + r] * b[c * 4 + 2] +
                a[3 * 4 + r] * b[c * 4 + 3];
        }
    }
    return out;
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
    let len = Math.hypot(zx, zy, zz) || 1;
    zx /= len; zy /= len; zz /= len;
    let xx = up[1] * zz - up[2] * zy;
    let xy = up[2] * zx - up[0] * zz;
    let xz = up[0] * zy - up[1] * zx;
    len = Math.hypot(xx, xy, xz) || 1;
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

function transformPoint(m, p) {
    return [
        m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
        m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
        m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
    ];
}

function normalize3(v) {
    const len = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / len, v[1] / len, v[2] / len];
}

function cross3(a, b) {
    return [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ];
}

init().catch(err => console.error(err));
