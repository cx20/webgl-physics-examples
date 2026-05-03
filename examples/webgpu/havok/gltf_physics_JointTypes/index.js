const HAVOK_WASM_URL = 'https://cx20.github.io/gltf-test/libs/babylonjs/dev/HavokPhysics.wasm';
const { mat4, vec3, quat } = glMatrix;

const MODEL_URL = 'https://raw.githubusercontent.com/eoineoineoin/glTF_Physics/master/samples/JointTypes/JointTypes.glb';
const SHOW_DEBUG_BBOX = false;
const IDENTITY_QUATERNION = [0, 0, 0, 1];
const RESET_Y_THRESHOLD = -20;

const PHYSICS_SUBSTEPS = 4;
const PHYSICS_DT = 1 / (60 * PHYSICS_SUBSTEPS);

let canvas;
let device;
let context;
let format;

let trianglePipeline;
let linePipeline;
let textureSampler;
let depthTexture;
let whiteTextureView;

let HK;
let worldId;

const viewProj = mat4.create();
const projection = mat4.create();
const view = mat4.create();
const cameraCenter = vec3.fromValues(0, 5, 0);
let cameraRadius = 18;
let cameraHeight = 7;

let duckModel = null;
const physicsNodes = [];
const dynamicNodes = [];

// KHR_physics_rigid_bodies axis indices map to Havok ConstraintAxis:
// linearAxes[i]  → i     (LINEAR_X=0, LINEAR_Y=1, LINEAR_Z=2)
// angularAxes[i] → 3 + i (ANGULAR_X=3, ANGULAR_Y=4, ANGULAR_Z=5)
const LINEAR_AXIS_BASE = 0;
const ANGULAR_AXIS_BASE = 3;
const nodeIndexToBodyId = new Map();
const parentOf = new Map();

let eyePos = vec3.create();

let debugBoxMesh;
let debugLineUniformBuffer;
let debugLineBindGroup;

function isPowerOf2(value) {
    return (value & (value - 1)) === 0;
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
        min: [
            Math.min(a.min[0], b.min[0]),
            Math.min(a.min[1], b.min[1]),
            Math.min(a.min[2], b.min[2])
        ],
        max: [
            Math.max(a.max[0], b.max[0]),
            Math.max(a.max[1], b.max[1]),
            Math.max(a.max[2], b.max[2])
        ]
    };
}

function computeFlatNormals(positions, indices) {
    const normals = new Float32Array(positions.length);

    if (indices) {
        for (let i = 0; i < indices.length; i += 3) {
            const i0 = indices[i] * 3;
            const i1 = indices[i + 1] * 3;
            const i2 = indices[i + 2] * 3;

            const p0 = vec3.fromValues(positions[i0], positions[i0 + 1], positions[i0 + 2]);
            const p1 = vec3.fromValues(positions[i1], positions[i1 + 1], positions[i1 + 2]);
            const p2 = vec3.fromValues(positions[i2], positions[i2 + 1], positions[i2 + 2]);

            const e1 = vec3.sub(vec3.create(), p1, p0);
            const e2 = vec3.sub(vec3.create(), p2, p0);
            const n = vec3.normalize(vec3.create(), vec3.cross(vec3.create(), e1, e2));

            normals[i0] += n[0];
            normals[i0 + 1] += n[1];
            normals[i0 + 2] += n[2];

            normals[i1] += n[0];
            normals[i1 + 1] += n[1];
            normals[i1 + 2] += n[2];

            normals[i2] += n[0];
            normals[i2 + 1] += n[1];
            normals[i2 + 2] += n[2];
        }
    } else {
        for (let i = 0; i < positions.length; i += 9) {
            const p0 = vec3.fromValues(positions[i], positions[i + 1], positions[i + 2]);
            const p1 = vec3.fromValues(positions[i + 3], positions[i + 4], positions[i + 5]);
            const p2 = vec3.fromValues(positions[i + 6], positions[i + 7], positions[i + 8]);

            const e1 = vec3.sub(vec3.create(), p1, p0);
            const e2 = vec3.sub(vec3.create(), p2, p0);
            const n = vec3.normalize(vec3.create(), vec3.cross(vec3.create(), e1, e2));

            for (let j = 0; j < 3; j++) {
                const dst = i + j * 3;
                normals[dst] = n[0];
                normals[dst + 1] = n[1];
                normals[dst + 2] = n[2];
            }
        }
        return normals;
    }

    for (let i = 0; i < normals.length; i += 3) {
        const n = vec3.fromValues(normals[i], normals[i + 1], normals[i + 2]);
        const len = vec3.length(n);
        if (len > 0) {
            vec3.scale(n, n, 1.0 / len);
            normals[i] = n[0];
            normals[i + 1] = n[1];
            normals[i + 2] = n[2];
        } else {
            normals[i] = 0;
            normals[i + 1] = 1;
            normals[i + 2] = 0;
        }
    }

    return normals;
}

function getAccessorData(gltf, buffers, accessorIndex) {
    const accessor = gltf.accessors[accessorIndex];
    const bufferView = gltf.bufferViews[accessor.bufferView];
    const buffer = buffers[bufferView.buffer || 0];

    const componentMap = {
        5120: Int8Array,
        5121: Uint8Array,
        5122: Int16Array,
        5123: Uint16Array,
        5125: Uint32Array,
        5126: Float32Array
    };
    const compsMap = {
        SCALAR: 1,
        VEC2: 2,
        VEC3: 3,
        VEC4: 4,
        MAT4: 16
    };

    const TypedArray = componentMap[accessor.componentType];
    const components = compsMap[accessor.type];
    const count = accessor.count;
    const byteOffset = (bufferView.byteOffset || 0) + (accessor.byteOffset || 0);
    const byteStride = bufferView.byteStride || 0;
    const packedStride = TypedArray.BYTES_PER_ELEMENT * components;

    if (byteStride && byteStride !== packedStride) {
        const out = new TypedArray(count * components);
        const dataView = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
        for (let i = 0; i < count; i++) {
            const src = byteOffset + i * byteStride;
            for (let c = 0; c < components; c++) {
                const at = src + c * TypedArray.BYTES_PER_ELEMENT;
                const dst = i * components + c;
                if (accessor.componentType === 5126) out[dst] = dataView.getFloat32(at, true);
                else if (accessor.componentType === 5125) out[dst] = dataView.getUint32(at, true);
                else if (accessor.componentType === 5123) out[dst] = dataView.getUint16(at, true);
                else if (accessor.componentType === 5122) out[dst] = dataView.getInt16(at, true);
                else if (accessor.componentType === 5121) out[dst] = dataView.getUint8(at);
                else out[dst] = dataView.getInt8(at);
            }
        }
        return out;
    }

    return new TypedArray(buffer.buffer, buffer.byteOffset + byteOffset, count * components);
}

async function loadGLTF(url) {
    const response = await fetch(url);
    const baseUrl = url.substring(0, url.lastIndexOf('/') + 1);
    const contentType = response.headers.get('content-type') || '';

    if (url.toLowerCase().endsWith('.glb') || contentType.includes('model/gltf-binary') || contentType.includes('application/octet-stream')) {
        const data = await response.arrayBuffer();
        const header = new Uint32Array(data, 0, 3);
        if (header[0] !== 0x46546C67) {
            throw new Error('Invalid GLB header.');
        }

        let offset = 12;
        let gltf = null;
        let binChunk = null;
        const decoder = new TextDecoder();

        while (offset < data.byteLength) {
            const chunkLength = new DataView(data, offset, 4).getUint32(0, true);
            const chunkType = new DataView(data, offset + 4, 4).getUint32(0, true);
            const chunkData = data.slice(offset + 8, offset + 8 + chunkLength);
            if (chunkType === 0x4E4F534A) {
                gltf = JSON.parse(decoder.decode(chunkData).replace(/\0+$/, ''));
            } else if (chunkType === 0x004E4942) {
                binChunk = chunkData;
            }
            offset += 8 + chunkLength;
        }

        if (!gltf) {
            throw new Error('GLB JSON chunk is missing.');
        }

        const buffers = [];
        for (const buf of gltf.buffers || []) {
            if (buf.uri) {
                const bufferUrl = new URL(buf.uri, baseUrl).href;
                const externalData = await fetch(bufferUrl).then((r) => r.arrayBuffer());
                buffers.push(new Uint8Array(externalData));
            } else {
                if (!binChunk) {
                    throw new Error('GLB BIN chunk is missing.');
                }
                buffers.push(new Uint8Array(binChunk, 0, buf.byteLength || binChunk.byteLength));
            }
        }

        return { gltf, buffers, baseUrl };
    }

    const gltf = await response.json();
    const buffers = [];
    for (const buf of gltf.buffers || []) {
        if (!buf.uri) {
            throw new Error('This sample supports external-buffer glTF or embedded GLB only.');
        }
        const bufferUrl = new URL(buf.uri, baseUrl).href;
        const data = await fetch(bufferUrl).then((r) => r.arrayBuffer());
        buffers.push(new Uint8Array(data));
    }

    return { gltf, buffers, baseUrl };
}

function gltfWrapToWebGPU(value) {
    if (value === 33071) return 'clamp-to-edge';
    if (value === 33648) return 'mirror-repeat';
    return 'repeat';
}

function gltfMagFilterToWebGPU(value) {
    if (value === 9728) return 'nearest';
    return 'linear';
}

function gltfMinFilterToWebGPU(value) {
    if (value === 9728) return { minFilter: 'nearest', mipmapFilter: 'nearest' };
    if (value === 9729) return { minFilter: 'linear', mipmapFilter: 'nearest' };
    if (value === 9984) return { minFilter: 'nearest', mipmapFilter: 'nearest' };
    if (value === 9985) return { minFilter: 'linear', mipmapFilter: 'nearest' };
    if (value === 9986) return { minFilter: 'nearest', mipmapFilter: 'linear' };
    if (value === 9987) return { minFilter: 'linear', mipmapFilter: 'linear' };
    return { minFilter: 'linear', mipmapFilter: 'linear' };
}

async function loadTextureAndView(url) {
    const response = await fetch(url);
    const blob = await response.blob();
    const bitmap = await createImageBitmap(blob, { imageOrientation: 'none' });

    const texture = device.createTexture({
        size: [bitmap.width, bitmap.height, 1],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
    });

    device.queue.copyExternalImageToTexture(
        { source: bitmap },
        { texture },
        [bitmap.width, bitmap.height]
    );

    return texture.createView();
}

async function loadTextureAndViewFromBytes(bytes, mimeType) {
    const blob = new Blob([bytes], { type: mimeType || 'image/png' });
    const bitmap = await createImageBitmap(blob, { imageOrientation: 'none' });

    const texture = device.createTexture({
        size: [bitmap.width, bitmap.height, 1],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
    });

    device.queue.copyExternalImageToTexture(
        { source: bitmap },
        { texture },
        [bitmap.width, bitmap.height]
    );

    return texture.createView();
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

function createMesh(positions, normals, uvs) {
    const positionBuffer = device.createBuffer({
        size: positions.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
    });
    device.queue.writeBuffer(positionBuffer, 0, positions);

    const normalBuffer = device.createBuffer({
        size: normals.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
    });
    device.queue.writeBuffer(normalBuffer, 0, normals);

    const uvBuffer = device.createBuffer({
        size: uvs.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
    });
    device.queue.writeBuffer(uvBuffer, 0, uvs);

    return {
        positionBuffer,
        normalBuffer,
        uvBuffer,
        vertexCount: positions.length / 3
    };
}

function createGroundMesh() {
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
        1, 0,
        1, 1,
        0, 0,
        1, 1,
        0, 1
    ]);

    return createMesh(positions, normals, uvs);
}

function createDebugLineMesh() {
    const positions = new Float32Array([
        -0.5, -0.5, -0.5,
         0.5, -0.5, -0.5,
         0.5,  0.5, -0.5,
        -0.5,  0.5, -0.5,
        -0.5, -0.5,  0.5,
         0.5, -0.5,  0.5,
         0.5,  0.5,  0.5,
        -0.5,  0.5,  0.5
    ]);

    const indices = new Uint16Array([
        0, 1, 1, 2, 2, 3, 3, 0,
        4, 5, 5, 6, 6, 7, 7, 4,
        0, 4, 1, 5, 2, 6, 3, 7
    ]);

    const positionBuffer = device.createBuffer({
        size: positions.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
    });
    device.queue.writeBuffer(positionBuffer, 0, positions);

    const indexBuffer = device.createBuffer({
        size: indices.byteLength,
        usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST
    });
    device.queue.writeBuffer(indexBuffer, 0, indices);

    return {
        positionBuffer,
        indexBuffer,
        indexCount: indices.length
    };
}

function getNodeLocalMatrix(node) {
    const m = mat4.create();
    if (node.matrix) {
        mat4.copy(m, node.matrix);
        return m;
    }
    const t = node.translation || [0, 0, 0];
    const r = node.rotation || [0, 0, 0, 1];
    const s = node.scale || [1, 1, 1];
    mat4.fromRotationTranslationScale(m, r, t, s);
    return m;
}

function expandToTriangles(positions, normals, uvs, indices) {
    if (!indices) {
        return { positions, normals, uvs };
    }

    const outPositions = new Float32Array(indices.length * 3);
    const outNormals = new Float32Array(indices.length * 3);
    const outUvs = new Float32Array(indices.length * 2);

    for (let i = 0; i < indices.length; i++) {
        const srcIndex = indices[i];
        outPositions[i * 3] = positions[srcIndex * 3];
        outPositions[i * 3 + 1] = positions[srcIndex * 3 + 1];
        outPositions[i * 3 + 2] = positions[srcIndex * 3 + 2];

        outNormals[i * 3] = normals[srcIndex * 3];
        outNormals[i * 3 + 1] = normals[srcIndex * 3 + 1];
        outNormals[i * 3 + 2] = normals[srcIndex * 3 + 2];

        outUvs[i * 2] = uvs[srcIndex * 2];
        outUvs[i * 2 + 1] = uvs[srcIndex * 2 + 1];
    }

    return { positions: outPositions, normals: outNormals, uvs: outUvs };
}

function createTriangleRenderItem(textureView) {
    const uniformBuffer = device.createBuffer({
        size: 176,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });

    const bindGroup = device.createBindGroup({
        layout: trianglePipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: uniformBuffer } },
            { binding: 1, resource: textureSampler },
            { binding: 2, resource: textureView }
        ]
    });

    return { uniformBuffer, bindGroup };
}

function writeTriangleUniforms(buffer, modelMatrix, baseColor, eyePos, metallic, roughness) {
    device.queue.writeBuffer(buffer, 0,   viewProj);
    device.queue.writeBuffer(buffer, 64,  modelMatrix);
    device.queue.writeBuffer(buffer, 128, new Float32Array(baseColor));
    // offset 144: eyePos(vec3) + metallic(f32)
    device.queue.writeBuffer(buffer, 144, new Float32Array([eyePos[0], eyePos[1], eyePos[2], metallic]));
    // offset 160: roughness(f32)
    device.queue.writeBuffer(buffer, 160, new Float32Array([roughness]));
}

function writeLineUniforms(buffer, modelMatrix, color) {
    device.queue.writeBuffer(buffer, 0, viewProj);
    device.queue.writeBuffer(buffer, 64, modelMatrix);
    device.queue.writeBuffer(buffer, 128, new Float32Array(color));
}

async function buildDuckModel(url) {
    const { gltf, buffers, baseUrl } = await loadGLTF(url);
    const sceneIndex = gltf.scene || 0;
    const scene = gltf.scenes[sceneIndex];

    const textureViews = [];
    if (gltf.textures) {
        for (let i = 0; i < gltf.textures.length; i++) {
            const textureDef = gltf.textures[i];
            const imageDef = gltf.images[textureDef.source];
            if (imageDef.uri) {
                const imageUrl = new URL(imageDef.uri, baseUrl).href;
                textureViews.push(await loadTextureAndView(imageUrl));
            } else if (imageDef.bufferView !== undefined) {
                const view = gltf.bufferViews[imageDef.bufferView];
                const bin = buffers[view.buffer || 0];
                const offset = view.byteOffset || 0;
                const length = view.byteLength;
                const bytes = new Uint8Array(bin.buffer, bin.byteOffset + offset, length);
                textureViews.push(await loadTextureAndViewFromBytes(bytes, imageDef.mimeType));
            } else {
                textureViews.push(whiteTextureView);
            }
        }
    }

    if (gltf.samplers && gltf.samplers.length > 0) {
        const s = gltf.samplers[0];
        const min = gltfMinFilterToWebGPU(s.minFilter);
        textureSampler = device.createSampler({
            addressModeU: gltfWrapToWebGPU(s.wrapS),
            addressModeV: gltfWrapToWebGPU(s.wrapT),
            magFilter: gltfMagFilterToWebGPU(s.magFilter),
            minFilter: min.minFilter,
            mipmapFilter: min.mipmapFilter
        });
    }

    const nodes = (gltf.nodes || []).map((node) => ({
        mesh: node.mesh,
        children: node.children || [],
        localMatrix: getNodeLocalMatrix(node),
        restWorldMatrix: mat4.create(),
        worldMatrix: mat4.create(),
        worldScale: vec3.fromValues(1, 1, 1),
        physicsExt: node.extensions ? node.extensions.KHR_physics_rigid_bodies : null,
        bodyId: null,
        debugSize: [1, 1, 1],
        initialPosition: null,
        initialRotation: null
    }));

    const meshes = [];
    for (let m = 0; m < (gltf.meshes || []).length; m++) {
        const meshDef = gltf.meshes[m];
        const primitives = [];

        for (const primitive of meshDef.primitives) {
            const attrs = primitive.attributes;
            const positions = getAccessorData(gltf, buffers, attrs.POSITION);
            const indices = primitive.indices !== undefined ? getAccessorData(gltf, buffers, primitive.indices) : null;
            const normals = attrs.NORMAL !== undefined
                ? getAccessorData(gltf, buffers, attrs.NORMAL)
                : computeFlatNormals(positions, indices);
            const uv = attrs.TEXCOORD_0 !== undefined
                ? getAccessorData(gltf, buffers, attrs.TEXCOORD_0)
                : new Float32Array((positions.length / 3) * 2);

            const expanded = expandToTriangles(positions, normals, uv, indices);
            const mesh = createMesh(expanded.positions, expanded.normals, expanded.uvs);
            const bbox = calculateBoundingBox(positions);

            let textureView = whiteTextureView;
            let baseColor = [1, 1, 1, 1];
            let metallic  = 0.0;
            let roughness = 0.5;
            if (primitive.material !== undefined) {
                const material = gltf.materials[primitive.material];
                if (material && material.pbrMetallicRoughness) {
                    const pbr = material.pbrMetallicRoughness;
                    if (pbr.baseColorFactor) {
                        baseColor = pbr.baseColorFactor;
                    }
                    if (pbr.baseColorTexture) {
                        textureView = textureViews[pbr.baseColorTexture.index] || whiteTextureView;
                    }
                    if (pbr.metallicFactor  !== undefined) metallic  = pbr.metallicFactor;
                    if (pbr.roughnessFactor !== undefined) roughness = pbr.roughnessFactor;
                }
            }

            const renderItem = createTriangleRenderItem(textureView);
            primitives.push({ mesh, renderItem, baseColor, metallic, roughness, bbox });
        }

        let meshBbox = primitives[0].bbox;
        for (let i = 1; i < primitives.length; i++) {
            meshBbox = mergeBoundingBox(meshBbox, primitives[i].bbox);
        }

        meshes.push({ primitives, bbox: meshBbox });
    }

    function computeRestWorld(nodeIndex, parentMat) {
        const node = nodes[nodeIndex];
        mat4.multiply(node.restWorldMatrix, parentMat, node.localMatrix);
        mat4.copy(node.worldMatrix, node.restWorldMatrix);
        mat4.getScaling(node.worldScale, node.restWorldMatrix);

        for (const child of node.children) {
            computeRestWorld(child, node.restWorldMatrix);
        }
    }

    for (const root of scene.nodes) {
        computeRestWorld(root, mat4.create());
    }

    let modelBbox = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };

    function traverseBBox(nodeIndex) {
        const node = nodes[nodeIndex];
        const worldMat = node.restWorldMatrix;

        if (node.mesh !== undefined) {
            const meshBbox = meshes[node.mesh].bbox;
            const corners = [
                [meshBbox.min[0], meshBbox.min[1], meshBbox.min[2]],
                [meshBbox.max[0], meshBbox.min[1], meshBbox.min[2]],
                [meshBbox.min[0], meshBbox.max[1], meshBbox.min[2]],
                [meshBbox.max[0], meshBbox.max[1], meshBbox.min[2]],
                [meshBbox.min[0], meshBbox.min[1], meshBbox.max[2]],
                [meshBbox.max[0], meshBbox.min[1], meshBbox.max[2]],
                [meshBbox.min[0], meshBbox.max[1], meshBbox.max[2]],
                [meshBbox.max[0], meshBbox.max[1], meshBbox.max[2]]
            ];
            for (const c of corners) {
                const p = vec3.transformMat4(vec3.create(), c, worldMat);
                modelBbox.min[0] = Math.min(modelBbox.min[0], p[0]);
                modelBbox.min[1] = Math.min(modelBbox.min[1], p[1]);
                modelBbox.min[2] = Math.min(modelBbox.min[2], p[2]);
                modelBbox.max[0] = Math.max(modelBbox.max[0], p[0]);
                modelBbox.max[1] = Math.max(modelBbox.max[1], p[1]);
                modelBbox.max[2] = Math.max(modelBbox.max[2], p[2]);
            }
        }

        for (const child of node.children) {
            traverseBBox(child);
        }
    }

    for (const root of scene.nodes) {
        traverseBBox(root);
    }

    return {
        gltf,
        buffers,
        nodes,
        meshes,
        roots: scene.nodes,
        bbox: modelBbox
    };
}

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

function setMassPropertyVec3(target, keys, value) {
    for (const key of keys) {
        if (Array.isArray(target[key]) && target[key].length >= 3) {
            target[key][0] = value[0];
            target[key][1] = value[1];
            target[key][2] = value[2];
            return true;
        }
    }
    return false;
}

function setMassPropertyQuat(target, keys, value) {
    for (const key of keys) {
        if (Array.isArray(target[key]) && target[key].length >= 4) {
            target[key][0] = value[0];
            target[key][1] = value[1];
            target[key][2] = value[2];
            target[key][3] = value[3];
            return true;
        }
    }
    return false;
}

// KHR_physics_rigid_bodies spec: inertiaDiagonal component of 0 means "infinite inertia" (locked axis).
// Havok cannot accept 0 inertia (causes 1/0=Infinity in the solver and breaks simulation).
// Replace 0 components with a large value to represent "infinite" inertia.
// KHR_physics_rigid_bodies spec: mass=0 and inertiaDiagonal component=0 each mean infinity.
// Pass these 0 values directly to HP_Body_SetMassProperties — Havok handles them correctly.
function toHavokInertiaDiagonal(specValue) {
    if (!Array.isArray(specValue)) return specValue;
    return [specValue[0], specValue[1], specValue[2]];
}

function applyMotionMassProperties(bodyId, motionDef) {
    if (!motionDef || typeof HK.HP_Body_GetMassProperties !== 'function' || typeof HK.HP_Body_SetMassProperties !== 'function') {
        return;
    }

    const hasMass = motionDef.mass !== undefined;
    const hasInertiaDiagonal = Array.isArray(motionDef.inertiaDiagonal);
    const hasInertiaOrientation = Array.isArray(motionDef.inertiaOrientation);
    const hasCenterOfMass = Array.isArray(motionDef.centerOfMass);

    if (!hasMass && !hasInertiaDiagonal && !hasInertiaOrientation && !hasCenterOfMass) {
        return;
    }

    const massPropResult = HK.HP_Body_GetMassProperties(bodyId);
    checkResult(massPropResult[0], 'HP_Body_GetMassProperties');
    const massProperties = massPropResult[1];

    let changed = false;

    // Havok mass properties structure: [centerOfMass[3], mass, inertiaDiagonal[3], inertiaOrientation[4]]
    if (Array.isArray(massProperties)) {
        let vec3SlotCount = 0;
        for (let i = 0; i < massProperties.length; i++) {
            const slot = massProperties[i];
            if (!Array.isArray(slot)) {
                // scalar slot = mass
                if (hasMass) {
                    massProperties[i] = motionDef.mass;
                    changed = true;
                }
                continue;
            }

            if (slot.length === 4 && hasInertiaOrientation) {
                slot[0] = motionDef.inertiaOrientation[0];
                slot[1] = motionDef.inertiaOrientation[1];
                slot[2] = motionDef.inertiaOrientation[2];
                slot[3] = motionDef.inertiaOrientation[3];
                changed = true;
                continue;
            }

            if (slot.length === 3) {
                // vec3SlotCount=0 → centerOfMass, vec3SlotCount=1 → inertiaDiagonal
                if (vec3SlotCount === 0 && hasCenterOfMass) {
                    slot[0] = motionDef.centerOfMass[0];
                    slot[1] = motionDef.centerOfMass[1];
                    slot[2] = motionDef.centerOfMass[2];
                    changed = true;
                } else if (vec3SlotCount === 1 && hasInertiaDiagonal) {
                    const hkInertia = toHavokInertiaDiagonal(motionDef.inertiaDiagonal);
                    slot[0] = hkInertia[0];
                    slot[1] = hkInertia[1];
                    slot[2] = hkInertia[2];
                    changed = true;
                }
                vec3SlotCount++;
            }
        }
    } else if (massProperties && typeof massProperties === 'object') {
        if (hasInertiaDiagonal) {
            const hkInertia = toHavokInertiaDiagonal(motionDef.inertiaDiagonal);
            changed = setMassPropertyVec3(massProperties, ['inertiaDiagonal', 'm_inertiaDiagonal', 'inertia', 'm_inertia'], hkInertia) || changed;
        }
        if (hasInertiaOrientation) {
            changed = setMassPropertyQuat(massProperties, ['inertiaOrientation', 'm_inertiaOrientation'], motionDef.inertiaOrientation) || changed;
        }
        if (hasCenterOfMass) {
            changed = setMassPropertyVec3(massProperties, ['centerOfMass', 'm_centerOfMass', 'center', 'm_center'], motionDef.centerOfMass) || changed;
        }
    }

    if (changed) {
        checkResult(HK.HP_Body_SetMassProperties(bodyId, massProperties), 'HP_Body_SetMassProperties');
    }
}

function createBody(shapeId, motionType, position, rotation, setMass, motionDef, gravityFactor) {
    const created = HK.HP_Body_Create();
    checkResult(created[0], 'HP_Body_Create');
    const bodyId = created[1];

    checkResult(HK.HP_Body_SetShape(bodyId, shapeId), 'HP_Body_SetShape');
    checkResult(HK.HP_Body_SetMotionType(bodyId, motionType), 'HP_Body_SetMotionType');

    // Set body quality so Havok enables CCD for fast-moving dynamic bodies.
    if (typeof HK.HP_Body_SetQuality === 'function' && HK.QualityType) {
        const isDynamic = motionType !== HK.MotionType.STATIC;
        const quality = isDynamic ? HK.QualityType.MOVING : HK.QualityType.FIXED;
        if (quality !== undefined) {
            HK.HP_Body_SetQuality(bodyId, quality);
        }
    }

    if (setMass) {
        const massResult = HK.HP_Shape_BuildMassProperties(shapeId);
        checkResult(massResult[0], 'HP_Shape_BuildMassProperties');
        checkResult(HK.HP_Body_SetMassProperties(bodyId, massResult[1]), 'HP_Body_SetMassProperties');
        applyMotionMassProperties(bodyId, motionDef);
    }

    if (gravityFactor !== undefined && typeof HK.HP_Body_SetGravityFactor === 'function') {
        checkResult(HK.HP_Body_SetGravityFactor(bodyId, gravityFactor), 'HP_Body_SetGravityFactor');
    }

    if (motionDef && motionDef.linearVelocity && typeof HK.HP_Body_SetLinearVelocity === 'function') {
        checkResult(HK.HP_Body_SetLinearVelocity(bodyId, motionDef.linearVelocity), 'HP_Body_SetLinearVelocity');
    }
    if (motionDef && motionDef.angularVelocity && typeof HK.HP_Body_SetAngularVelocity === 'function') {
        checkResult(HK.HP_Body_SetAngularVelocity(bodyId, motionDef.angularVelocity), 'HP_Body_SetAngularVelocity');
    }

    checkResult(HK.HP_Body_SetPosition(bodyId, position), 'HP_Body_SetPosition');
    checkResult(HK.HP_Body_SetOrientation(bodyId, rotation), 'HP_Body_SetOrientation');
    checkResult(HK.HP_World_AddBody(worldId, bodyId, false), 'HP_World_AddBody');

    return bodyId;
}

function getHKAxisMode(mode) {
    const modes = HK.ConstraintAxisLimitMode;
    if (modes) {
        if (mode === 'FREE') return modes.FREE ?? 0;
        if (mode === 'LIMITED') return modes.LIMITED ?? 1;
        if (mode === 'LOCKED') return modes.LOCKED ?? 2;
    }
    if (mode === 'FREE') return 0;
    if (mode === 'LIMITED') return 1;
    return 2;
}

function getHKMotorType(type) {
    const types = HK.ConstraintMotorType;
    if (types) {
        if (type === 'VELOCITY') return types.VELOCITY ?? 1;
        if (type === 'POSITION') return types.POSITION ?? 2;
    }
    if (type === 'VELOCITY') return 1;
    if (type === 'POSITION') return 2;
    return 0;
}

function configureConstraintAxes(constraintId, jointDef) {
    if (!jointDef || typeof HK.HP_Constraint_SetAxisMode !== 'function') return;

    const FREE = getHKAxisMode('FREE');
    const LIMITED = getHKAxisMode('LIMITED');
    const LOCKED = getHKAxisMode('LOCKED');

    for (let axis = 0; axis < 6; axis++) {
        HK.HP_Constraint_SetAxisMode(constraintId, axis, FREE);
    }

    for (const limit of (jointDef.limits || [])) {
        const axisIndices = limit.linearAxes
            ? limit.linearAxes.map(a => LINEAR_AXIS_BASE + a)
            : limit.angularAxes.map(a => ANGULAR_AXIS_BASE + a);

        const min = limit.min ?? 0;
        const max = limit.max ?? 0;

        for (const axis of axisIndices) {
            if (min === 0 && max === 0) {
                HK.HP_Constraint_SetAxisMode(constraintId, axis, LOCKED);
            } else {
                HK.HP_Constraint_SetAxisMode(constraintId, axis, LIMITED);
                if (typeof HK.HP_Constraint_SetAxisMinLimit === 'function') {
                    HK.HP_Constraint_SetAxisMinLimit(constraintId, axis, min);
                }
                if (typeof HK.HP_Constraint_SetAxisMaxLimit === 'function') {
                    HK.HP_Constraint_SetAxisMaxLimit(constraintId, axis, max);
                }
            }
            if (limit.stiffness !== undefined && typeof HK.HP_Constraint_SetAxisStiffness === 'function') {
                HK.HP_Constraint_SetAxisStiffness(constraintId, axis, limit.stiffness);
            }
            if (limit.damping !== undefined && typeof HK.HP_Constraint_SetAxisDamping === 'function') {
                HK.HP_Constraint_SetAxisDamping(constraintId, axis, limit.damping);
            }
        }
    }

    for (const drive of (jointDef.drives || [])) {
        const axis = drive.type === 'angular'
            ? ANGULAR_AXIS_BASE + drive.axis
            : LINEAR_AXIS_BASE + drive.axis;

        const hasSpring = drive.stiffness !== undefined && drive.stiffness > 0;
        const hasPosTarget = drive.positionTarget !== undefined && drive.positionTarget !== 0;
        const hasVelTarget = drive.velocityTarget !== undefined && drive.velocityTarget !== 0;

        if (typeof HK.HP_Constraint_SetAxisMotorType !== 'function') continue;

        let motorType;
        if (hasSpring && hasPosTarget) {
            motorType = getHKMotorType('POSITION');
        } else if (hasVelTarget || (drive.damping !== undefined && drive.damping > 0)) {
            motorType = getHKMotorType('VELOCITY');
        } else {
            continue;
        }

        HK.HP_Constraint_SetAxisMotorType(constraintId, axis, motorType);

        const target = motorType === getHKMotorType('POSITION')
            ? (drive.positionTarget ?? 0)
            : (drive.velocityTarget ?? 0);
        if (typeof HK.HP_Constraint_SetAxisMotorTarget === 'function') {
            HK.HP_Constraint_SetAxisMotorTarget(constraintId, axis, target);
        }
        if (hasSpring && typeof HK.HP_Constraint_SetAxisStiffness === 'function') {
            HK.HP_Constraint_SetAxisStiffness(constraintId, axis, drive.stiffness);
        }
        if (drive.damping !== undefined && typeof HK.HP_Constraint_SetAxisDamping === 'function') {
            HK.HP_Constraint_SetAxisDamping(constraintId, axis, drive.damping);
        }
        if (typeof HK.HP_Constraint_SetAxisMotorMaxForce === 'function') {
            HK.HP_Constraint_SetAxisMotorMaxForce(constraintId, axis, 1000);
        }
    }
}

function setupJoint(jointNodeIndex, parentBodyId, connectedBodyId, jointDef, enableCollision) {
    if (!parentBodyId || !connectedBodyId) return;
    if (typeof HK.HP_Constraint_Create !== 'function') return;

    const created = HK.HP_Constraint_Create();
    if (!created || created[0] !== HK.Result.RESULT_OK) return;
    const constraintId = created[1];

    HK.HP_Constraint_SetParentBody(constraintId, parentBodyId);
    HK.HP_Constraint_SetChildBody(constraintId, connectedBodyId);

    // Joint node's world position and rotation
    const jointNode = duckModel.nodes[jointNodeIndex];
    const jointWorldPos = vec3.create();
    const jointWorldQuat = quat.create();
    mat4.getTranslation(jointWorldPos, jointNode.restWorldMatrix);
    mat4.getRotation(jointWorldQuat, jointNode.restWorldMatrix);

    // Anchor in parent body's local space
    const parentPResult = HK.HP_Body_GetPosition(parentBodyId);
    const parentQResult = HK.HP_Body_GetOrientation(parentBodyId);
    const parentWorldPos = parentPResult[1];
    const parentWorldQuat = parentQResult[1];
    const parentQuatInv = quat.invert(quat.create(), parentWorldQuat);

    const pivotInParent = vec3.transformQuat(
        vec3.create(),
        vec3.sub(vec3.create(), jointWorldPos, parentWorldPos),
        parentQuatInv
    );
    const mainAxisWorld = vec3.transformQuat(vec3.create(), [1, 0, 0], jointWorldQuat);
    const perpAxisWorld = vec3.transformQuat(vec3.create(), [0, 1, 0], jointWorldQuat);
    const mainAxisInParent = vec3.transformQuat(vec3.create(), mainAxisWorld, parentQuatInv);
    const perpAxisInParent = vec3.transformQuat(vec3.create(), perpAxisWorld, parentQuatInv);

    HK.HP_Constraint_SetAnchorInParent(constraintId,
        [pivotInParent[0], pivotInParent[1], pivotInParent[2]],
        [mainAxisInParent[0], mainAxisInParent[1], mainAxisInParent[2]],
        [perpAxisInParent[0], perpAxisInParent[1], perpAxisInParent[2]]
    );

    // Anchor in child body's local space
    const childPResult = HK.HP_Body_GetPosition(connectedBodyId);
    const childQResult = HK.HP_Body_GetOrientation(connectedBodyId);
    const childWorldPos = childPResult[1];
    const childWorldQuat = childQResult[1];
    const childQuatInv = quat.invert(quat.create(), childWorldQuat);

    const pivotInChild = vec3.transformQuat(
        vec3.create(),
        vec3.sub(vec3.create(), jointWorldPos, childWorldPos),
        childQuatInv
    );
    const mainAxisInChild = vec3.transformQuat(vec3.create(), mainAxisWorld, childQuatInv);
    const perpAxisInChild = vec3.transformQuat(vec3.create(), perpAxisWorld, childQuatInv);

    HK.HP_Constraint_SetAnchorInChild(constraintId,
        [pivotInChild[0], pivotInChild[1], pivotInChild[2]],
        [mainAxisInChild[0], mainAxisInChild[1], mainAxisInChild[2]],
        [perpAxisInChild[0], perpAxisInChild[1], perpAxisInChild[2]]
    );

    configureConstraintAxes(constraintId, jointDef);

    if (typeof HK.HP_Constraint_SetCollisionsEnabled === 'function') {
        HK.HP_Constraint_SetCollisionsEnabled(constraintId, enableCollision === true);
    }
    if (typeof HK.HP_Constraint_SetEnabled === 'function') {
        HK.HP_Constraint_SetEnabled(constraintId, true);
    }
}

function applyPhysicsMaterial(shapeId, materialDef) {
    if (!materialDef || typeof HK.HP_Shape_SetMaterial !== 'function') {
        return;
    }

    const dynamicFriction = materialDef.dynamicFriction !== undefined ? materialDef.dynamicFriction : 0.5;
    const staticFriction = materialDef.staticFriction !== undefined ? materialDef.staticFriction : 0.5;
    const restitution = materialDef.restitution !== undefined ? materialDef.restitution : 0.0;
    HK.HP_Shape_SetMaterial(
        shapeId,
        [dynamicFriction, staticFriction, restitution, HK.MaterialCombine.MAXIMUM, HK.MaterialCombine.MAXIMUM]
    );
}

function buildCollisionLayerMask(layerNames, layerNameToBit) {
    if (!Array.isArray(layerNames)) {
        return 0;
    }

    let mask = 0;
    for (const name of layerNames) {
        if (layerNameToBit[name] === undefined) {
            layerNameToBit[name] = Object.keys(layerNameToBit).length;
        }
        const bit = layerNameToBit[name];
        if (bit < 32) {
            mask |= (1 << bit) >>> 0;
        }
    }
    return mask >>> 0;
}

function getCollisionFilterInfo(colliderDef, collisionFilterDefs, layerNameToBit) {
    if (!colliderDef || colliderDef.collisionFilter === undefined) {
        return null;
    }

    const filterDef = collisionFilterDefs[colliderDef.collisionFilter];
    if (!filterDef) {
        return null;
    }

    const membershipMask = buildCollisionLayerMask(filterDef.collisionSystems || [], layerNameToBit);

    let collideMask = 0xffffffff;
    if (Array.isArray(filterDef.collideWithSystems)) {
        collideMask = buildCollisionLayerMask(filterDef.collideWithSystems, layerNameToBit);
    } else if (Array.isArray(filterDef.notCollideWithSystems)) {
        collideMask = (~buildCollisionLayerMask(filterDef.notCollideWithSystems, layerNameToBit)) >>> 0;
    }

    return [membershipMask >>> 0, collideMask >>> 0];
}

function createMeshPhysicsShape(node, colliderGeom, motionDef, materialDef) {
    let meshIndex = colliderGeom.mesh;
    if (meshIndex === undefined && colliderGeom.node !== undefined) {
        const colliderNode = duckModel.nodes[colliderGeom.node];
        if (colliderNode && colliderNode.mesh !== undefined) {
            meshIndex = colliderNode.mesh;
        }
    }
    if (meshIndex === undefined) {
        throw new Error('Unsupported collider geometry. Expected geometry.mesh (new draft) or geometry.node (legacy).');
    }
    const isConvex = !!colliderGeom.convexHull;
    const meshDef = duckModel.gltf.meshes[meshIndex];

    const allPositions = [];
    const allIndices = [];
    let vertexOffset = 0;

    for (const primitive of meshDef.primitives) {
        const positions = getAccessorData(duckModel.gltf, duckModel.buffers, primitive.attributes.POSITION);
        for (let i = 0; i < positions.length; i += 3) {
            allPositions.push(
                positions[i]     * node.worldScale[0],
                positions[i + 1] * node.worldScale[1],
                positions[i + 2] * node.worldScale[2]
            );
        }
        if (!isConvex && primitive.indices !== undefined) {
            const indices = getAccessorData(duckModel.gltf, duckModel.buffers, primitive.indices);
            for (let i = 0; i < indices.length; i++) {
                allIndices.push(indices[i] + vertexOffset);
            }
        } else if (!isConvex) {
            const vertexCount = positions.length / 3;
            for (let i = 0; i + 2 < vertexCount; i += 3) {
                allIndices.push(vertexOffset + i, vertexOffset + i + 1, vertexOffset + i + 2);
            }
        }
        vertexOffset += positions.length / 3;
    }

    if (!isConvex && !motionDef) {
        const baseIndexCount = allIndices.length;
        for (let i = 0; i + 2 < baseIndexCount; i += 3) {
            const i0 = allIndices[i];
            const i1 = allIndices[i + 1];
            const i2 = allIndices[i + 2];
            allIndices.push(i0, i2, i1);
        }
    }

    const posFloat32 = new Float32Array(allPositions);
    const numVertices = allPositions.length / 3;
    let shapeId;

    // Havok WASM expects native heap memory offsets, not JavaScript TypedArrays.
    const posBytes = posFloat32.length * 4;
    const posOffset = HK._malloc(posBytes);
    new Float32Array(HK.HEAPU8.buffer, posOffset, posFloat32.length).set(posFloat32);
    try {
        if (isConvex) {
            const created = HK.HP_Shape_CreateConvexHull(posOffset, numVertices);
            checkResult(created[0], 'HP_Shape_CreateConvexHull');
            shapeId = created[1];
        } else {
            const numTriangles = allIndices.length / 3;
            const triBytes = allIndices.length * 4;
            const triOffset = HK._malloc(triBytes);
            const triView = new Int32Array(HK.HEAPU8.buffer, triOffset, allIndices.length);
            for (let i = 0; i < allIndices.length; i++) triView[i] = allIndices[i];
            try {
                const created = HK.HP_Shape_CreateMesh(posOffset, numVertices, triOffset, numTriangles);
                checkResult(created[0], 'HP_Shape_CreateMesh');
                shapeId = created[1];
            } finally {
                HK._free(triOffset);
            }
        }
    } finally {
        HK._free(posOffset);
    }

    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < allPositions.length; i += 3) {
        minX = Math.min(minX, allPositions[i]);     maxX = Math.max(maxX, allPositions[i]);
        minY = Math.min(minY, allPositions[i + 1]); maxY = Math.max(maxY, allPositions[i + 1]);
        minZ = Math.min(minZ, allPositions[i + 2]); maxZ = Math.max(maxZ, allPositions[i + 2]);
    }
    let size = [maxX - minX, maxY - minY, maxZ - minZ];
    let volume = Math.max((maxX - minX) * (maxY - minY) * (maxZ - minZ), 0.0001);

    if (shapeId == null) {
        console.warn(`  [WARN] Invalid shapeId=${shapeId}! Mesh shape creation FAILED.`);
        console.warn(`    This Havok WASM version may not support mesh shapes. Creating fallback approximation shape...`);

        const bboxSize = size;
        const bboxVolume = volume;

        // For ConvexHull, use Sphere approximation; for TriMesh, use Box approximation
        if (isConvex) {
            // Use sphere with radius = average of half-extents
            const avgRadius = Math.max((bboxSize[0] + bboxSize[1] + bboxSize[2]) / 6, 0.01);
            console.warn(`  [FALLBACK] Creating Sphere with radius=${avgRadius} instead of ConvexHull`);
            const created = HK.HP_Shape_CreateSphere([0, 0, 0], avgRadius);
            checkResult(created[0], 'HP_Shape_CreateSphere (fallback)');
            shapeId = created[1];
            size = [avgRadius * 2, avgRadius * 2, avgRadius * 2];
            volume = (4.0 / 3.0) * Math.PI * avgRadius * avgRadius * avgRadius;
        } else {
            // Use box with size = bounding box size
            console.warn(`  [FALLBACK] Creating Box with size=${JSON.stringify(bboxSize)} instead of TriMesh`);
            const created = HK.HP_Shape_CreateBox([0, 0, 0], IDENTITY_QUATERNION, bboxSize);
            checkResult(created[0], 'HP_Shape_CreateBox (fallback)');
            shapeId = created[1];
            size = bboxSize;
            volume = bboxVolume;
        }
        console.warn(`  [FALLBACK] Created fallback shape with shapeId=${shapeId}`);
    }

    if (motionDef) {
        // density is only used for HP_Shape_BuildMassProperties; mass=0 is overridden in applyMotionMassProperties
        const specMass = motionDef.mass !== undefined ? motionDef.mass : undefined;
        const density = (specMass !== undefined && specMass > 0) ? specMass / volume : 1;
        checkResult(HK.HP_Shape_SetDensity(shapeId, density), 'HP_Shape_SetDensity');
    }
    applyPhysicsMaterial(shapeId, materialDef);

    return { shapeId, size };
}

function createPhysicsShape(node, shapeDef, motionDef, materialDef) {
    if (!shapeDef) {
        throw new Error('Invalid KHR_implicit_shapes definition.');
    }

    let shapeId;
    let size;
    let volume = 0.0001;

    if (shapeDef.type === 'box' && shapeDef.box) {
        const boxSize = shapeDef.box.size || [1, 1, 1];
        size = [
            Math.abs(boxSize[0] * node.worldScale[0]),
            Math.abs(boxSize[1] * node.worldScale[1]),
            Math.abs(boxSize[2] * node.worldScale[2])
        ];

        const created = HK.HP_Shape_CreateBox([0, 0, 0], IDENTITY_QUATERNION, size);
        checkResult(created[0], 'HP_Shape_CreateBox');
        shapeId = created[1];
        volume = Math.max(size[0] * size[1] * size[2], 0.0001);
    } else if (shapeDef.type === 'sphere' && shapeDef.sphere) {
        const baseRadius = shapeDef.sphere.radius !== undefined ? shapeDef.sphere.radius : 0.5;
        const maxScale = Math.max(
            Math.abs(node.worldScale[0]),
            Math.abs(node.worldScale[1]),
            Math.abs(node.worldScale[2])
        );
        const radius = Math.max(Math.abs(baseRadius * maxScale), 0.0001);
        const created = HK.HP_Shape_CreateSphere([0, 0, 0], radius);
        checkResult(created[0], 'HP_Shape_CreateSphere');
        shapeId = created[1];
        size = [radius * 2, radius * 2, radius * 2];
        volume = Math.max((4.0 / 3.0) * Math.PI * radius * radius * radius, 0.0001);
    } else if (shapeDef.type === 'capsule' && shapeDef.capsule) {
        const capsuleDef = shapeDef.capsule;
        const radiusTop = capsuleDef.radiusTop !== undefined ? capsuleDef.radiusTop : 0.5;
        const radiusBottom = capsuleDef.radiusBottom !== undefined ? capsuleDef.radiusBottom : 0.5;
        const height = capsuleDef.height !== undefined ? capsuleDef.height : 1.0;
        const avgRadius = (radiusTop + radiusBottom) * 0.5;
        const scaleXZ = Math.max(Math.abs(node.worldScale[0]), Math.abs(node.worldScale[2]));
        const scaledRadius = Math.max(avgRadius * scaleXZ, 0.0001);
        const scaledHalfShaft = Math.max(height * Math.abs(node.worldScale[1]) * 0.5, 0);
        const created = HK.HP_Shape_CreateCapsule([0, -scaledHalfShaft, 0], [0, scaledHalfShaft, 0], scaledRadius);
        checkResult(created[0], 'HP_Shape_CreateCapsule');
        shapeId = created[1];
        size = [scaledRadius * 2, scaledHalfShaft * 2 + scaledRadius * 2, scaledRadius * 2];
        volume = Math.max(Math.PI * scaledRadius * scaledRadius * (scaledHalfShaft * 2) + (4.0 / 3.0) * Math.PI * scaledRadius * scaledRadius * scaledRadius, 0.0001);
    } else if (shapeDef.type === 'cylinder' && shapeDef.cylinder) {
        const cylDef = shapeDef.cylinder;
        const cRadiusTop = cylDef.radiusTop !== undefined ? cylDef.radiusTop : 0.5;
        const cRadiusBottom = cylDef.radiusBottom !== undefined ? cylDef.radiusBottom : 0.5;
        const cHeight = cylDef.height !== undefined ? cylDef.height : 1.0;
        const maxCylRadius = Math.max(Math.max(cRadiusTop, cRadiusBottom), 0.0001);
        const scaleXZ = Math.max(Math.abs(node.worldScale[0]), Math.abs(node.worldScale[2]));
        const scaledCylRadius = Math.max(maxCylRadius * scaleXZ, 0.0001);
        const scaledCylHalfHeight = Math.max(cHeight * Math.abs(node.worldScale[1]) * 0.5, 0.0001);
        if (typeof HK.HP_Shape_CreateCylinder === 'function') {
            const created = HK.HP_Shape_CreateCylinder([0, -scaledCylHalfHeight, 0], [0, scaledCylHalfHeight, 0], scaledCylRadius);
            checkResult(created[0], 'HP_Shape_CreateCylinder');
            shapeId = created[1];
        } else {
            const s = [scaledCylRadius * 2, scaledCylHalfHeight * 2, scaledCylRadius * 2];
            const created = HK.HP_Shape_CreateBox([0, 0, 0], IDENTITY_QUATERNION, s);
            checkResult(created[0], 'HP_Shape_CreateBox');
            shapeId = created[1];
        }
        size = [scaledCylRadius * 2, scaledCylHalfHeight * 2, scaledCylRadius * 2];
        volume = Math.max(Math.PI * scaledCylRadius * scaledCylRadius * scaledCylHalfHeight * 2, 0.0001);
    } else {
        throw new Error('Unsupported KHR_implicit_shapes collider type: ' + String(shapeDef.type));
    }

    if (motionDef) {
        // density is only used for HP_Shape_BuildMassProperties; mass=0 is overridden in applyMotionMassProperties
        const specMass = motionDef.mass !== undefined ? motionDef.mass : undefined;
        const density = (specMass !== undefined && specMass > 0) ? specMass / volume : 1;
        checkResult(HK.HP_Shape_SetDensity(shapeId, density), 'HP_Shape_SetDensity');
    }

    applyPhysicsMaterial(shapeId, materialDef);

    return { shapeId, size };
}

function getParentRigidBody(node) {
    let current = node.parent;
    while (current) {
        if (current.bodyId !== undefined && current.bodyId !== null) {
            return current;
        }
        current = current.parent;
    }
    return null;
}
function initPhysics() {
    const world = HK.HP_World_Create();
    checkResult(world[0], 'HP_World_Create');
    worldId = world[1];

    checkResult(HK.HP_World_SetGravity(worldId, [0, -9.8, 0]), 'HP_World_SetGravity');
    checkResult(HK.HP_World_SetIdealStepTime(worldId, PHYSICS_DT), 'HP_World_SetIdealStepTime');

    for (let i = 0; i < duckModel.nodes.length; i++) {
        for (const childIdx of (duckModel.gltf.nodes[i].children || [])) {
            parentOf.set(childIdx, i);
        }
    }

    const shapeDefs = (duckModel.gltf.extensions && duckModel.gltf.extensions.KHR_implicit_shapes && duckModel.gltf.extensions.KHR_implicit_shapes.shapes) || [];
    const scenePhysics = (duckModel.gltf.extensions && duckModel.gltf.extensions.KHR_physics_rigid_bodies) || {};
    const materialDefs = scenePhysics.physicsMaterials || [];

    let staticBodyCount = 0;
    for (let nodeIndex = 0; nodeIndex < duckModel.nodes.length; nodeIndex++) {
        const node = duckModel.nodes[nodeIndex];
        if (!node.physicsExt || !node.physicsExt.collider || !node.physicsExt.collider.geometry) {
            continue;
        }

        const shapeIndex = node.physicsExt.collider.geometry.shape;
        const motionDef = node.physicsExt.motion || null;
        const materialDef = node.physicsExt.collider.physicsMaterial !== undefined
            ? materialDefs[node.physicsExt.collider.physicsMaterial]
            : null;

        let shapeResult;
        if (shapeIndex === undefined) {
            shapeResult = createMeshPhysicsShape(node, node.physicsExt.collider.geometry, motionDef, materialDef);
        } else {
            const shapeDef = shapeDefs[shapeIndex];
            shapeResult = createPhysicsShape(node, shapeDef, motionDef, materialDef);
        }

        // If mesh shape creation failed, skip this body
        if (!shapeResult) {
            continue;
        }

        const { shapeId, size } = shapeResult;

        const p = vec3.create();
        const q = quat.create();
        mat4.getTranslation(p, node.restWorldMatrix);
        mat4.getRotation(q, node.restWorldMatrix);

        node.initialPosition = [p[0], p[1], p[2]];
        node.initialRotation = [q[0], q[1], q[2], q[3]];
        node.debugSize = size;

        const motionType = !motionDef
            ? HK.MotionType.STATIC
            : (motionDef.isKinematic ? HK.MotionType.KINEMATIC : HK.MotionType.DYNAMIC);
        const gravityFactor = motionDef && motionDef.gravityFactor !== undefined ? motionDef.gravityFactor : undefined;
        node.bodyId = createBody(shapeId, motionType, node.initialPosition, node.initialRotation, !!motionDef, motionDef, gravityFactor);
        nodeIndexToBodyId.set(nodeIndex, node.bodyId);
        physicsNodes.push(node);

        if (motionDef) {
            dynamicNodes.push(node);
        } else {
            staticBodyCount++;
        }
    }

    const scenePhysicsJoints = scenePhysics.physicsJoints || [];
    for (let nodeIndex = 0; nodeIndex < duckModel.nodes.length; nodeIndex++) {
        const node = duckModel.nodes[nodeIndex];
        if (!node.physicsExt || !node.physicsExt.joint) {
            continue;
        }

        const jointDef = node.physicsExt.joint.joint !== undefined
            ? scenePhysicsJoints[node.physicsExt.joint.joint]
            : node.physicsExt.joint;

        const connectedNodeIndex = node.physicsExt.joint.connectedNode;

        // Find parent body: walk up the ancestor chain
        let parentIdx = parentOf.get(nodeIndex);
        let parentBodyId = null;
        while (parentIdx !== undefined) {
            if (nodeIndexToBodyId.has(parentIdx)) {
                parentBodyId = nodeIndexToBodyId.get(parentIdx);
                break;
            }
            parentIdx = parentOf.get(parentIdx);
        }

        const connectedBodyId = connectedNodeIndex !== undefined
            ? nodeIndexToBodyId.get(connectedNodeIndex)
            : null;

        if (parentBodyId && connectedBodyId) {
            const enableCollision = node.physicsExt.joint.enableCollision === true;
            setupJoint(nodeIndex, parentBodyId, connectedBodyId, jointDef, enableCollision);
        }
    }
}

function updatePhysicsTransforms() {
    for (const node of physicsNodes) {
        const pResult = HK.HP_Body_GetPosition(node.bodyId);
        checkResult(pResult[0], 'HP_Body_GetPosition');
        const qResult = HK.HP_Body_GetOrientation(node.bodyId);
        checkResult(qResult[0], 'HP_Body_GetOrientation');

        const p = pResult[1];
        const q = qResult[1];

        mat4.fromRotationTranslationScale(
            node.worldMatrix,
            quat.fromValues(q[0], q[1], q[2], q[3]),
            vec3.fromValues(p[0], p[1], p[2]),
            node.worldScale
        );
    }
}

function resetDynamicBodiesIfNeeded() {
    for (const node of dynamicNodes) {
        const pResult = HK.HP_Body_GetPosition(node.bodyId);
        checkResult(pResult[0], 'HP_Body_GetPosition reset');
        if (pResult[1][1] >= RESET_Y_THRESHOLD) {
            continue;
        }

        checkResult(HK.HP_Body_SetPosition(node.bodyId, node.initialPosition), 'HP_Body_SetPosition reset');
        checkResult(HK.HP_Body_SetOrientation(node.bodyId, node.initialRotation), 'HP_Body_SetOrientation reset');
        checkResult(HK.HP_Body_SetLinearVelocity(node.bodyId, [0, 0, 0]), 'HP_Body_SetLinearVelocity reset');
        checkResult(HK.HP_Body_SetAngularVelocity(node.bodyId, [0, 0, 0]), 'HP_Body_SetAngularVelocity reset');
    }
}

function createDepthTexture() {
    depthTexture = device.createTexture({
        size: [canvas.width, canvas.height, 1],
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

    context.configure({
        device,
        format,
        alphaMode: 'opaque'
    });

    createDepthTexture();
}

function drawTriangleMesh(pass, mesh, bindGroup) {
    pass.setVertexBuffer(0, mesh.positionBuffer);
    pass.setVertexBuffer(1, mesh.normalBuffer);
    pass.setVertexBuffer(2, mesh.uvBuffer);
    pass.setBindGroup(0, bindGroup);
    pass.draw(mesh.vertexCount, 1, 0, 0);
}

function drawDuckNodes(pass) {
    function drawNode(nodeIndex, parentMat) {
        const node = duckModel.nodes[nodeIndex];
        const worldMat = node.bodyId
            ? node.worldMatrix
            : mat4.multiply(mat4.create(), parentMat, node.localMatrix);

        if (node.mesh !== undefined) {
            const mesh = duckModel.meshes[node.mesh];
            for (const prim of mesh.primitives) {
                writeTriangleUniforms(prim.renderItem.uniformBuffer, worldMat, prim.baseColor, eyePos, prim.metallic ?? 0.0, prim.roughness ?? 0.5);
                drawTriangleMesh(pass, prim.mesh, prim.renderItem.bindGroup);
            }
        }

        for (const child of node.children) {
            drawNode(child, worldMat);
        }
    }

    for (const root of duckModel.roots) {
        drawNode(root, mat4.create());
    }
}

function render(timeMs) {
    for (let i = 0; i < PHYSICS_SUBSTEPS; i++) {
        checkResult(HK.HP_World_Step(worldId, PHYSICS_DT), 'HP_World_Step');
    }
    resetDynamicBodiesIfNeeded();
    updatePhysicsTransforms();

    const t = timeMs * 0.001;
    const eye = vec3.fromValues(
        cameraCenter[0],
        cameraCenter[1] + cameraHeight,
        cameraCenter[2] - cameraRadius
    );
    vec3.copy(eyePos, eye);
    mat4.lookAt(view, eye, cameraCenter, [0, 1, 0]);
    mat4.perspective(projection, Math.PI / 4, canvas.width / canvas.height, 0.1, 2000);
    mat4.multiply(viewProj, projection, view);

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
        colorAttachments: [{
            view: context.getCurrentTexture().createView(),
            clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
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

    pass.setPipeline(trianglePipeline);

    drawDuckNodes(pass);

    if (SHOW_DEBUG_BBOX) {
        pass.setPipeline(linePipeline);
        pass.setBindGroup(0, debugLineBindGroup);
        pass.setVertexBuffer(0, debugBoxMesh.positionBuffer);
        pass.setIndexBuffer(debugBoxMesh.indexBuffer, 'uint16');

        for (const node of physicsNodes) {
            const debugModel = mat4.clone(node.worldMatrix);
            mat4.scale(debugModel, debugModel, node.debugSize);
            writeLineUniforms(
                debugLineUniformBuffer,
                debugModel,
                node.physicsExt.motion ? [1.0, 0.35, 0.2, 1.0] : [0.0, 1.0, 0.0, 1.0]
            );
            pass.drawIndexed(debugBoxMesh.indexCount, 1, 0, 0, 0);
        }
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
    HK = await HavokPhysics({
        locateFile: function (path) {
            if (path && path.endsWith('.wasm')) {
                return HAVOK_WASM_URL;
            }
            return path;
        }
    });
    context = canvas.getContext('webgpu');
    format = navigator.gpu.getPreferredCanvasFormat();

    const vs = device.createShaderModule({ code: document.getElementById('vs').textContent });
    const fs = device.createShaderModule({ code: document.getElementById('fs').textContent });
    const vsLine = device.createShaderModule({ code: document.getElementById('vs-line').textContent });
    const fsLine = device.createShaderModule({ code: document.getElementById('fs-line').textContent });

    trianglePipeline = device.createRenderPipeline({
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
            targets: [{ format }]
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

    linePipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: {
            module: vsLine,
            entryPoint: 'main',
            buffers: [
                { arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] }
            ]
        },
        fragment: {
            module: fsLine,
            entryPoint: 'main',
            targets: [{ format }]
        },
        primitive: {
            topology: 'line-list',
            cullMode: 'none'
        },
        depthStencil: {
            format: 'depth24plus',
            depthWriteEnabled: false,
            depthCompare: 'less-equal'
        }
    });

    textureSampler = device.createSampler({
        addressModeU: 'repeat',
        addressModeV: 'repeat',
        magFilter: 'linear',
        minFilter: 'linear',
        mipmapFilter: 'linear'
    });

    whiteTextureView = createSolidTextureView(255, 255, 255, 255);

    resize();
    window.addEventListener('resize', resize);

    debugBoxMesh = createDebugLineMesh();
    debugLineUniformBuffer = device.createBuffer({
        size: 144,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    debugLineBindGroup = device.createBindGroup({
        layout: linePipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: debugLineUniformBuffer } }]
    });

    duckModel = await buildDuckModel(MODEL_URL);

    const bbox = duckModel.bbox;
    const sizeX = bbox.max[0] - bbox.min[0];
    const sizeY = bbox.max[1] - bbox.min[1];
    const sizeZ = bbox.max[2] - bbox.min[2];
    const centerX = (bbox.min[0] + bbox.max[0]) * 0.5;
    const centerY = (bbox.min[1] + bbox.max[1]) * 0.5;
    const centerZ = (bbox.min[2] + bbox.max[2]) * 0.5;

    vec3.set(cameraCenter, centerX, centerY, centerZ);
    const diagonal = Math.sqrt(sizeX * sizeX + sizeY * sizeY + sizeZ * sizeZ);
    cameraRadius = Math.max(diagonal * 0.72, 5.8);
    cameraHeight = Math.min(sizeY * 0.25, 2.0);

    initPhysics();
    updatePhysicsTransforms();
    requestAnimationFrame(render);
}

main().catch((err) => {
    console.error(err);
});
