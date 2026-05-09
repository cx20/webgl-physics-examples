'use strict';

const computeShaderWGSL = document.getElementById('cs').textContent;
const vertexShaderWGSL = document.getElementById('vs').textContent;
const fragmentShaderWGSL = document.getElementById('fs').textContent;
const groundVertexWGSL = document.getElementById('gvs').textContent;
const groundFragmentWGSL = document.getElementById('gfs').textContent;
const wireVertexWGSL = document.getElementById('wvs').textContent;
const wireFragmentWGSL = document.getElementById('wfs').textContent;

const MODEL_URL = 'https://raw.githubusercontent.com/eoineoineoin/glTF_Physics/master/samples/MotionProperties/MotionProperties.glb';
const GROUND_Y = 0.0;
const SUBSTEPS = 6;
const STATE_FLOATS = 16;
const BODY_PARAM_FLOATS = 28;
const RENDER_UBO_SIZE = 160;
const GROUND_UBO_SIZE = 144;
const WIRE_UBO_SIZE = 160;
const SIM_PARAMS_SIZE = 32;
const TRIANGLE_FLOATS = 16;
const SHOW_STATIC_MESHES = true;
const SHOW_HELPER_GROUND = false;
const START_HEIGHT_OFFSET = 0.0;

const canvas = document.getElementById('c');
let device, context, format, depthTexture;
let renderPipeline, groundPipeline, wirePipeline, computePipeline;
let sampler, whiteTextureView;
let modelAsset, groundMesh, wireMesh;
let stateBuffer, bodyParamsBuffer, simParamsBuffer, groundUniformBuffer, staticTriangleBuffer;
let computeBindGroup, groundBindGroup;
let renderBindGroups = new Map();
let wireUniformBuffers = [];
let wireBindGroups = [];
let meshWireItems = [];
let bodyRecords = [];
let staticTriangleCount = 0;
let staticCeilingY = 100000;
let showWireframe = false;
let lastTime = -1;

const projectionMatrix = new Float32Array(16);
const viewMatrix = new Float32Array(16);
const viewProjectionMatrix = new Float32Array(16);
const identityMatrix = mat4Identity();

function resize() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(window.innerWidth * dpr));
    canvas.height = Math.max(1, Math.floor(window.innerHeight * dpr));
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

function createMesh(positions, normals, uvs) {
    return {
        positionBuffer: createVertexBuffer(positions),
        normalBuffer: createVertexBuffer(normals),
        uvBuffer: createVertexBuffer(uvs),
        vertexCount: positions.length / 3,
    };
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
        -1,-1,-1, 1,-1,-1, 1,1,-1, -1,1,-1,
        -1,-1, 1, 1,-1, 1, 1,1, 1, -1,1, 1,
    ]);
    const indices = new Uint16Array([
        0,1, 1,2, 2,3, 3,0,
        4,5, 5,6, 6,7, 7,4,
        0,4, 1,5, 2,6, 3,7,
    ]);
    return { positionBuffer: createVertexBuffer(positions), indexBuffer: createIndexBuffer(indices), indexCount: indices.length };
}

function createTriangleWireMesh(primitives) {
    let lineVertexCount = 0;
    for (const primitive of primitives) {
        lineVertexCount += (primitive.positions.length / 9) * 6;
    }
    const linePositions = new Float32Array(lineVertexCount * 3);
    let offset = 0;
    for (const primitive of primitives) {
        const positions = primitive.positions;
        for (let i = 0; i + 8 < positions.length; i += 9) {
            const a = [positions[i], positions[i + 1], positions[i + 2]];
            const b = [positions[i + 3], positions[i + 4], positions[i + 5]];
            const c = [positions[i + 6], positions[i + 7], positions[i + 8]];
            for (const p of [a, b, b, c, c, a]) {
                linePositions[offset++] = p[0];
                linePositions[offset++] = p[1];
                linePositions[offset++] = p[2];
            }
        }
    }
    return { positionBuffer: createVertexBuffer(linePositions), vertexCount: lineVertexCount };
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

async function createTextureViewFromBlob(blob) {
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

async function loadTextureView(url) {
    const response = await fetch(url);
    return createTextureViewFromBlob(await response.blob());
}

async function loadTextureViewFromBytes(bytes, mimeType) {
    return createTextureViewFromBlob(new Blob([bytes], { type: mimeType || 'image/png' }));
}

async function loadGLTF(url) {
    const response = await fetch(url);
    const baseUrl = url.substring(0, url.lastIndexOf('/') + 1);
    const contentType = response.headers.get('content-type') || '';

    if (url.toLowerCase().endsWith('.glb') || contentType.includes('model/gltf-binary') || contentType.includes('application/octet-stream')) {
        const data = await response.arrayBuffer();
        const header = new Uint32Array(data, 0, 3);
        if (header[0] !== 0x46546C67) throw new Error('Invalid GLB header.');

        let offset = 12;
        let gltf = null;
        let binChunk = null;
        const decoder = new TextDecoder();
        while (offset < data.byteLength) {
            const view = new DataView(data, offset, 8);
            const chunkLength = view.getUint32(0, true);
            const chunkType = view.getUint32(4, true);
            const chunkData = data.slice(offset + 8, offset + 8 + chunkLength);
            if (chunkType === 0x4E4F534A) gltf = JSON.parse(decoder.decode(chunkData).replace(/\0+$/, ''));
            if (chunkType === 0x004E4942) binChunk = chunkData;
            offset += 8 + chunkLength;
        }
        if (!gltf) throw new Error('GLB JSON chunk is missing.');

        const buffers = [];
        for (const bufferDef of gltf.buffers || []) {
            if (bufferDef.uri) {
                const dataUrl = new URL(bufferDef.uri, baseUrl).href;
                buffers.push(new Uint8Array(await fetch(dataUrl).then(r => r.arrayBuffer())));
            } else {
                if (!binChunk) throw new Error('GLB BIN chunk is missing.');
                buffers.push(new Uint8Array(binChunk, 0, bufferDef.byteLength || binChunk.byteLength));
            }
        }
        return { gltf, buffers, baseUrl };
    }

    const gltf = await response.json();
    const buffers = [];
    for (const bufferDef of gltf.buffers || []) {
        const dataUrl = new URL(bufferDef.uri, baseUrl).href;
        buffers.push(new Uint8Array(await fetch(dataUrl).then(r => r.arrayBuffer())));
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
    if (!a) return b;
    if (!b) return a;
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
        normals[i] = n[0]; normals[i + 1] = n[1]; normals[i + 2] = n[2];
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

async function buildModel(url) {
    const { gltf, buffers, baseUrl } = await loadGLTF(url);
    const textureViews = [];
    for (const textureDef of gltf.textures || []) {
        const imageDef = gltf.images && gltf.images[textureDef.source];
        if (!imageDef) {
            textureViews.push(whiteTextureView);
        } else if (imageDef.uri) {
            textureViews.push(await loadTextureView(new URL(imageDef.uri, baseUrl).href));
        } else if (imageDef.bufferView !== undefined) {
            const view = gltf.bufferViews[imageDef.bufferView];
            const bin = buffers[view.buffer || 0];
            const offset = view.byteOffset || 0;
            const bytes = new Uint8Array(bin.buffer, bin.byteOffset + offset, view.byteLength);
            textureViews.push(await loadTextureViewFromBytes(bytes, imageDef.mimeType));
        } else {
            textureViews.push(whiteTextureView);
        }
    }

    const nodes = (gltf.nodes || []).map((node, index) => ({
        name: node.name || 'node_' + index,
        mesh: node.mesh,
        children: node.children || [],
        parent: null,
        localMatrix: getNodeLocalMatrix(node),
        restWorldMatrix: mat4Identity(),
        physicsExt: node.extensions ? node.extensions.KHR_physics_rigid_bodies : null,
        bodyIndex: -1,
        dynamicAncestor: -1,
    }));
    for (let i = 0; i < nodes.length; i++) {
        for (const child of nodes[i].children) nodes[child].parent = i;
    }

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
            let baseColor = [1, 1, 1, 1];
            let textureView = whiteTextureView;
            if (primitive.material !== undefined) {
                const material = gltf.materials && gltf.materials[primitive.material];
                const pbr = material && material.pbrMetallicRoughness;
                if (pbr && pbr.baseColorFactor) baseColor = pbr.baseColorFactor;
                if (pbr && pbr.baseColorTexture) textureView = textureViews[pbr.baseColorTexture.index] || whiteTextureView;
            }
            const uniformBuffer = device.createBuffer({ size: RENDER_UBO_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
            primitives.push({ mesh, bbox, baseColor, textureView, uniformBuffer, positions: expanded.positions });
        }
        let meshBbox = null;
        for (const primitive of primitives) meshBbox = mergeBoundingBox(meshBbox, primitive.bbox);
        meshes.push({ primitives, bbox: meshBbox });
    }

    const roots = (gltf.scenes && gltf.scenes[gltf.scene || 0] && gltf.scenes[gltf.scene || 0].nodes) || [];
    function computeWorld(nodeIndex, parentMatrix) {
        const node = nodes[nodeIndex];
        node.restWorldMatrix = mat4Multiply(parentMatrix, node.localMatrix);
        for (const child of node.children) computeWorld(child, node.restWorldMatrix);
    }
    for (const root of roots) computeWorld(root, mat4Identity());

    return { gltf, nodes, meshes, roots };
}

function setupBodies(asset) {
    bodyRecords = [];
    for (let i = 0; i < asset.nodes.length; i++) {
        const node = asset.nodes[i];
        if (node.physicsExt && node.physicsExt.motion) {
            node.bodyIndex = bodyRecords.length;
            bodyRecords.push({ nodeIndex: i, bbox: null, halfExtents: [0.5, 0.5, 0.5], initialPosition: [0, 0, 0], initialRotation: [0, 0, 0, 1], hasMeshWire: false });
        }
    }

    function assignDynamicAncestor(nodeIndex, activeBody) {
        const node = asset.nodes[nodeIndex];
        const nextBody = node.bodyIndex >= 0 ? node.bodyIndex : activeBody;
        node.dynamicAncestor = nextBody;
        for (const child of node.children) assignDynamicAncestor(child, nextBody);
    }
    for (const root of asset.roots) assignDynamicAncestor(root, -1);

    for (const body of bodyRecords) {
        const bodyNode = asset.nodes[body.nodeIndex];
        const inverseBody = getBodyPoseInverse(bodyNode);
        let localBbox = null;
        function collect(nodeIndex) {
            const node = asset.nodes[nodeIndex];
            if (nodeIndex !== body.nodeIndex && node.bodyIndex >= 0) return;
            if (node.mesh !== undefined) {
                const meshBbox = asset.meshes[node.mesh].bbox;
                const localMatrix = mat4Multiply(inverseBody, node.restWorldMatrix);
                for (const corner of bboxCorners(meshBbox)) {
                    const p = transformPoint(localMatrix, corner);
                    const pointBbox = { min: p.slice(), max: p.slice() };
                    localBbox = mergeBoundingBox(localBbox, pointBbox);
                }
            }
            for (const child of node.children) collect(child);
        }
        collect(body.nodeIndex);
        if (!localBbox) localBbox = { min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] };
        body.bbox = localBbox;
        body.halfExtents = [
            Math.max((localBbox.max[0] - localBbox.min[0]) * 0.5, 0.05),
            Math.max((localBbox.max[1] - localBbox.min[1]) * 0.5, 0.05),
            Math.max((localBbox.max[2] - localBbox.min[2]) * 0.5, 0.05),
        ];
        body.initialPosition = getTranslation(bodyNode.restWorldMatrix);
        body.initialPosition[1] += START_HEIGHT_OFFSET;
        body.initialRotation = getRotation(bodyNode.restWorldMatrix);
    }
}

function buildMeshWireItems(asset) {
    meshWireItems = [];
    for (const node of asset.nodes) {
        const collider = node.physicsExt && node.physicsExt.collider;
        const geometry = collider && collider.geometry;
        if (!geometry || (geometry.mesh === undefined && geometry.node === undefined)) {
            continue;
        }

        let meshIndex = geometry.mesh;
        let sourceNode = node;
        if (meshIndex === undefined && geometry.node !== undefined) {
            sourceNode = asset.nodes[geometry.node];
            meshIndex = sourceNode && sourceNode.mesh;
        }
        if (meshIndex === undefined || !asset.meshes[meshIndex]) {
            continue;
        }

        const bodyIndex = node.dynamicAncestor;
        let modelMatrix = sourceNode.restWorldMatrix;
        if (bodyIndex >= 0) {
            const bodyNode = asset.nodes[bodyRecords[bodyIndex].nodeIndex];
            const inverseBody = getBodyPoseInverse(bodyNode);
            modelMatrix = mat4Multiply(inverseBody, sourceNode.restWorldMatrix);
            bodyRecords[bodyIndex].hasMeshWire = true;
        }

        meshWireItems.push({
            bodyIndex,
            mesh: createTriangleWireMesh(asset.meshes[meshIndex].primitives),
            modelMatrix,
            uniformBuffer: device.createBuffer({ size: WIRE_UBO_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }),
            bindGroup: null,
            color: geometry.convexHull === false ? [0.0, 1.0, 0.2, 1.0] : [0.1, 0.85, 1.0, 1.0],
        });
    }
}

function buildStaticMeshTriangles(asset) {
    const triangles = [];
    for (const node of asset.nodes) {
        const collider = node.physicsExt && node.physicsExt.collider;
        const geometry = collider && collider.geometry;
        if (!geometry || node.physicsExt.motion || geometry.convexHull !== false) {
            continue;
        }

        let meshIndex = geometry.mesh;
        if (meshIndex === undefined && geometry.node !== undefined) {
            const meshNode = asset.nodes[geometry.node];
            meshIndex = meshNode && meshNode.mesh;
        }
        if (meshIndex === undefined || !asset.meshes[meshIndex]) {
            continue;
        }

        const transform = geometry.mesh !== undefined ? node.restWorldMatrix : asset.nodes[geometry.node].restWorldMatrix;
        for (const primitive of asset.meshes[meshIndex].primitives) {
            const positions = primitive.positions;
            for (let i = 0; i + 8 < positions.length; i += 9) {
                const a = transformPoint(transform, [positions[i], positions[i + 1], positions[i + 2]]);
                const b = transformPoint(transform, [positions[i + 3], positions[i + 4], positions[i + 5]]);
                const c = transformPoint(transform, [positions[i + 6], positions[i + 7], positions[i + 8]]);
                const normal = normalize3(cross3(sub3(b, a), sub3(c, a)));
                triangles.push(a, b, c, normal);
            }
        }
    }
    return triangles;
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

function writeRenderUniforms(buffer, model, color, dynamicBody) {
    const data = new Float32Array(RENDER_UBO_SIZE / 4);
    data.set(viewProjectionMatrix, 0);
    data.set(model, 16);
    data.set(color, 32);
    data[36] = dynamicBody >= 0 ? 1 : 0;
    data[37] = Math.max(dynamicBody, 0);
    device.queue.writeBuffer(buffer, 0, data);
}

function writeGroundUniforms(buffer, model, color, mode = [0, 0, 0, 0]) {
    const data = new Float32Array(WIRE_UBO_SIZE / 4);
    data.set(viewProjectionMatrix, 0);
    data.set(model, 16);
    data.set(color, 32);
    data.set(mode, 36);
    device.queue.writeBuffer(buffer, 0, data);
}

function drawNode(pass, nodeIndex) {
    const node = modelAsset.nodes[nodeIndex];
    if (node.mesh !== undefined && (SHOW_STATIC_MESHES || node.dynamicAncestor >= 0)) {
        const bodyIndex = node.dynamicAncestor;
        let modelMatrix = node.restWorldMatrix;
        if (bodyIndex >= 0) {
            const bodyNode = modelAsset.nodes[bodyRecords[bodyIndex].nodeIndex];
            const inverseBody = getBodyPoseInverse(bodyNode);
            modelMatrix = mat4Multiply(inverseBody, node.restWorldMatrix);
        }
        for (const primitive of modelAsset.meshes[node.mesh].primitives) {
            writeRenderUniforms(primitive.uniformBuffer, modelMatrix, primitive.baseColor, bodyIndex);
            pass.setBindGroup(0, getRenderBindGroup(primitive));
            pass.setVertexBuffer(0, primitive.mesh.positionBuffer);
            pass.setVertexBuffer(1, primitive.mesh.normalBuffer);
            pass.setVertexBuffer(2, primitive.mesh.uvBuffer);
            pass.draw(primitive.mesh.vertexCount);
        }
    }
    for (const child of node.children) drawNode(pass, child);
}

function frame(timeMs) {
    if (lastTime < 0) lastTime = timeMs;
    const dt = Math.min((timeMs - lastTime) / 1000, 1 / 30);
    lastTime = timeMs;

    writeCamera(timeMs);
    const simData = new ArrayBuffer(SIM_PARAMS_SIZE);
    const simFloats = new Float32Array(simData);
    const simUints = new Uint32Array(simData);
    simFloats[0] = dt / SUBSTEPS;
    simFloats[1] = 9.8;
    simFloats[2] = GROUND_Y;
    simUints[3] = bodyRecords.length;
    simUints[4] = staticTriangleCount;
    simFloats[5] = staticCeilingY;
    device.queue.writeBuffer(simParamsBuffer, 0, simData);

    const encoder = device.createCommandEncoder();
    if (bodyRecords.length > 0) {
        for (let i = 0; i < SUBSTEPS; i++) {
            const pass = encoder.beginComputePass();
            pass.setPipeline(computePipeline);
            pass.setBindGroup(0, computeBindGroup);
            pass.dispatchWorkgroups(Math.ceil(bodyRecords.length / 64));
            pass.end();
        }
    }

    const renderPass = encoder.beginRenderPass({
        colorAttachments: [{
            view: context.getCurrentTexture().createView(),
            clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1 },
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

    if (SHOW_HELPER_GROUND) {
        renderPass.setPipeline(groundPipeline);
        const groundModel = mat4TRS([0, GROUND_Y, 0], [0, 0, 0, 1], [28, 1, 28]);
        writeGroundUniforms(groundUniformBuffer, groundModel, [0.34, 0.52, 0.33, 1]);
        renderPass.setBindGroup(0, groundBindGroup);
        renderPass.setVertexBuffer(0, groundMesh.positionBuffer);
        renderPass.setVertexBuffer(1, groundMesh.normalBuffer);
        renderPass.draw(groundMesh.vertexCount);
    }

    renderPass.setPipeline(renderPipeline);
    for (const root of modelAsset.roots) drawNode(renderPass, root);

    if (showWireframe) {
        renderPass.setPipeline(wirePipeline);
        for (const item of meshWireItems) {
            writeGroundUniforms(item.uniformBuffer, item.modelMatrix, item.color, [item.bodyIndex >= 0 ? 1 : 0, Math.max(item.bodyIndex, 0), 0, 0]);
            renderPass.setBindGroup(0, item.bindGroup);
            renderPass.setVertexBuffer(0, item.mesh.positionBuffer);
            renderPass.draw(item.mesh.vertexCount);
        }
        for (let i = 0; i < bodyRecords.length; i++) {
            const body = bodyRecords[i];
            if (body.hasMeshWire) {
                continue;
            }
            const center = [
                (body.bbox.min[0] + body.bbox.max[0]) * 0.5,
                (body.bbox.min[1] + body.bbox.max[1]) * 0.5,
                (body.bbox.min[2] + body.bbox.max[2]) * 0.5,
            ];
            const model = mat4Multiply(mat4Translation(center), mat4Scale(body.halfExtents));
            writeGroundUniforms(wireUniformBuffers[i], model, [0, 1, 0, 1], [1, i, 0, 0]);
            renderPass.setBindGroup(0, wireBindGroups[i]);
            renderPass.setVertexBuffer(0, wireMesh.positionBuffer);
            renderPass.setIndexBuffer(wireMesh.indexBuffer, 'uint16');
            renderPass.drawIndexed(wireMesh.indexCount);
        }
    }

    renderPass.end();
    device.queue.submit([encoder.finish()]);
    requestAnimationFrame(frame);
}

function writeCamera(timeMs) {
    const t = timeMs * 0.00022;
    const eye = [Math.sin(t) * 18, 8, Math.cos(t) * 18];
    mat4Perspective(projectionMatrix, Math.PI / 4, canvas.width / canvas.height, 0.1, 160);
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
    modelAsset = await buildModel(MODEL_URL);
    setupBodies(modelAsset);
    buildMeshWireItems(modelAsset);
    const staticTriangles = buildStaticMeshTriangles(modelAsset);
    staticTriangleCount = staticTriangles.length / 4;
    staticCeilingY = 100000;
    for (let i = 0; i < staticTriangleCount; i++) {
        const a = staticTriangles[i * 4];
        const b = staticTriangles[i * 4 + 1];
        const c = staticTriangles[i * 4 + 2];
        const normal = staticTriangles[i * 4 + 3];
        if (normal[1] < -0.05) {
            staticCeilingY = Math.min(staticCeilingY, a[1], b[1], c[1]);
        }
    }

    const bodyCount = Math.max(bodyRecords.length, 1);
    stateBuffer = device.createBuffer({ size: bodyCount * STATE_FLOATS * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, mappedAtCreation: true });
    const stateData = new Float32Array(stateBuffer.getMappedRange());
    for (let i = 0; i < bodyRecords.length; i++) {
        const body = bodyRecords[i];
        const o = i * STATE_FLOATS;
        stateData.set([body.initialPosition[0], body.initialPosition[1], body.initialPosition[2], 0], o);
        stateData.set([0, 0, 0, 0], o + 4);
        stateData.set(body.initialRotation, o + 8);
        stateData.set([0.25 + i * 0.07, 0.45, 0.18, 0], o + 12);
    }
    stateBuffer.unmap();

    bodyParamsBuffer = device.createBuffer({ size: bodyCount * BODY_PARAM_FLOATS * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, mappedAtCreation: true });
    const bodyParamData = new Float32Array(bodyParamsBuffer.getMappedRange());
    for (let i = 0; i < bodyRecords.length; i++) {
        const body = bodyRecords[i];
        const node = modelAsset.nodes[body.nodeIndex];
        const motion = node.physicsExt && node.physicsExt.motion ? node.physicsExt.motion : {};
        const specMass = motion.mass !== undefined ? motion.mass : 1;
        const gravityFactor = motion.gravityFactor !== undefined ? motion.gravityFactor : 1;
        const mass = specMass === 0 && gravityFactor >= 0 ? 1 : specMass;
        const hasInfiniteMass = mass === 0;
        const inertiaMask = motion.inertiaDiagonal
            ? motion.inertiaDiagonal.map(value => value === 0 ? 0 : 1)
            : [1, 1, 1];
        const inertiaInv = hasInfiniteMass && inertiaMask.some(value => value > 0)
            ? 1.0
            : 1 / Math.max(body.halfExtents[0] * body.halfExtents[0] + body.halfExtents[2] * body.halfExtents[2], 0.001);
        const effectiveGravityFactor = gravityFactor < 0 ? gravityFactor : 1;
        const linearDamping = motion.linearDamping !== undefined ? motion.linearDamping : 0.08;
        const angularDamping = motion.angularDamping !== undefined ? motion.angularDamping : 0.15;
        const centerOfMass = motion.centerOfMass || [0, 0, 0];
        const o = i * BODY_PARAM_FLOATS;
        bodyParamData.set([body.halfExtents[0], body.halfExtents[1], body.halfExtents[2], 0], o);
        bodyParamData.set([0.2, 0.6, mass, inertiaInv], o + 4);
        bodyParamData.set([body.initialPosition[0], body.initialPosition[1], body.initialPosition[2], 0], o + 8);
        bodyParamData.set(body.initialRotation, o + 12);
        bodyParamData.set([effectiveGravityFactor, linearDamping, angularDamping, motion.isKinematic ? 1 : 0], o + 16);
        bodyParamData.set([centerOfMass[0], centerOfMass[1], centerOfMass[2], 0], o + 20);
        bodyParamData.set([inertiaMask[0], inertiaMask[1], inertiaMask[2], 0], o + 24);
    }
    bodyParamsBuffer.unmap();

    const triangleBufferSize = Math.max(staticTriangleCount, 1) * TRIANGLE_FLOATS * 4;
    staticTriangleBuffer = device.createBuffer({ size: triangleBufferSize, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, mappedAtCreation: true });
    const triangleData = new Float32Array(staticTriangleBuffer.getMappedRange());
    for (let i = 0; i < staticTriangleCount; i++) {
        const o = i * TRIANGLE_FLOATS;
        const a = staticTriangles[i * 4];
        const b = staticTriangles[i * 4 + 1];
        const c = staticTriangles[i * 4 + 2];
        const n = staticTriangles[i * 4 + 3];
        triangleData.set([a[0], a[1], a[2], 0], o);
        triangleData.set([b[0], b[1], b[2], 0], o + 4);
        triangleData.set([c[0], c[1], c[2], 0], o + 8);
        triangleData.set([n[0], n[1], n[2], 0], o + 12);
    }
    staticTriangleBuffer.unmap();

    simParamsBuffer = device.createBuffer({ size: SIM_PARAMS_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    groundUniformBuffer = device.createBuffer({ size: WIRE_UBO_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    computeBindGroup = device.createBindGroup({
        layout: computePipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: stateBuffer } },
            { binding: 1, resource: { buffer: bodyParamsBuffer } },
            { binding: 2, resource: { buffer: simParamsBuffer } },
            { binding: 3, resource: { buffer: staticTriangleBuffer } },
        ],
    });
    groundBindGroup = device.createBindGroup({
        layout: groundPipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: groundUniformBuffer } }],
    });
    wireUniformBuffers = bodyRecords.map(() => device.createBuffer({ size: WIRE_UBO_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }));
    wireBindGroups = wireUniformBuffers.map((uniformBuffer) => device.createBindGroup({
        layout: wirePipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: uniformBuffer } },
            { binding: 1, resource: { buffer: stateBuffer } },
        ],
    }));
    for (const item of meshWireItems) {
        item.bindGroup = device.createBindGroup({
            layout: wirePipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: item.uniformBuffer } },
                { binding: 1, resource: { buffer: stateBuffer } },
            ],
        });
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

function getNodeLocalMatrix(node) {
    if (node.matrix) return new Float32Array(node.matrix);
    return mat4TRS(node.translation || [0, 0, 0], node.rotation || [0, 0, 0, 1], node.scale || [1, 1, 1]);
}

function getBodyPoseInverse(node) {
    const position = getTranslation(node.restWorldMatrix);
    const rotation = getRotation(node.restWorldMatrix);
    return mat4Invert(mat4TRS(position, rotation, [1, 1, 1])) || mat4Identity();
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

function mat4Invert(m) {
    const out = new Float32Array(16);
    const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3];
    const a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
    const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11];
    const a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];
    const b00 = a00 * a11 - a01 * a10;
    const b01 = a00 * a12 - a02 * a10;
    const b02 = a00 * a13 - a03 * a10;
    const b03 = a01 * a12 - a02 * a11;
    const b04 = a01 * a13 - a03 * a11;
    const b05 = a02 * a13 - a03 * a12;
    const b06 = a20 * a31 - a21 * a30;
    const b07 = a20 * a32 - a22 * a30;
    const b08 = a20 * a33 - a23 * a30;
    const b09 = a21 * a32 - a22 * a31;
    const b10 = a21 * a33 - a23 * a31;
    const b11 = a22 * a33 - a23 * a32;
    let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (!det) return null;
    det = 1.0 / det;
    out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
    out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
    out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
    out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
    out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
    out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
    out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
    out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
    out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
    out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
    out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
    out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
    out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
    out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
    out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
    out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
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

function getTranslation(m) {
    return [m[12], m[13], m[14]];
}

function getRotation(m) {
    const sx = Math.hypot(m[0], m[1], m[2]) || 1;
    const sy = Math.hypot(m[4], m[5], m[6]) || 1;
    const sz = Math.hypot(m[8], m[9], m[10]) || 1;
    const r00 = m[0] / sx, r01 = m[4] / sy, r02 = m[8] / sz;
    const r10 = m[1] / sx, r11 = m[5] / sy, r12 = m[9] / sz;
    const r20 = m[2] / sx, r21 = m[6] / sy, r22 = m[10] / sz;
    const trace = r00 + r11 + r22;
    let x, y, z, w;
    if (trace > 0) {
        const s = Math.sqrt(trace + 1) * 2;
        w = 0.25 * s;
        x = (r21 - r12) / s;
        y = (r02 - r20) / s;
        z = (r10 - r01) / s;
    } else if (r00 > r11 && r00 > r22) {
        const s = Math.sqrt(1 + r00 - r11 - r22) * 2;
        w = (r21 - r12) / s;
        x = 0.25 * s;
        y = (r01 + r10) / s;
        z = (r02 + r20) / s;
    } else if (r11 > r22) {
        const s = Math.sqrt(1 + r11 - r00 - r22) * 2;
        w = (r02 - r20) / s;
        x = (r01 + r10) / s;
        y = 0.25 * s;
        z = (r12 + r21) / s;
    } else {
        const s = Math.sqrt(1 + r22 - r00 - r11) * 2;
        w = (r10 - r01) / s;
        x = (r02 + r20) / s;
        y = (r12 + r21) / s;
        z = 0.25 * s;
    }
    return normalize4([x, y, z, w]);
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

function normalize4(v) {
    const len = Math.hypot(v[0], v[1], v[2], v[3]) || 1;
    return [v[0] / len, v[1] / len, v[2] / len, v[3] / len];
}

function sub3(a, b) {
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross3(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

init().catch(err => console.error(err));
