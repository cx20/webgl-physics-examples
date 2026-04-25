const HAVOK_WASM_URL = 'https://cx20.github.io/gltf-test/libs/babylonjs/dev/HavokPhysics.wasm';
const { mat4, vec3, quat } = glMatrix;

const DUCK_GLTF_URL = 'https://rawcdn.githack.com/cx20/gltf-test/5465cc37/sampleModels/Duck/glTF/Duck.gltf';
const FALL_SCALE = 5.0;
const SHOW_DEBUG_BBOX = true;
const IDENTITY_QUATERNION = [0, 0, 0, 1];

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
let duckBody;

const viewProj = mat4.create();
const projection = mat4.create();
const view = mat4.create();
const cameraCenter = vec3.fromValues(0, 5, 0);

let duckModel = null;
const duckWorldMatrix = mat4.create();
const duckOffset = vec3.create();
let duckDebugSize = [1, 1, 1];

let groundMesh;
let groundRenderItem;
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
    const gltf = await response.json();
    const baseUrl = url.substring(0, url.lastIndexOf('/') + 1);

    const buffers = [];
    for (const buf of gltf.buffers || []) {
        if (!buf.uri) {
            throw new Error('This sample supports external-buffer glTF only.');
        }
        const bufferUrl = new URL(buf.uri, baseUrl).href;
        const data = await fetch(bufferUrl).then(r => r.arrayBuffer());
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
        size: 144,
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

function writeTriangleUniforms(buffer, modelMatrix, baseColor) {
    device.queue.writeBuffer(buffer, 0, viewProj);
    device.queue.writeBuffer(buffer, 64, modelMatrix);
    device.queue.writeBuffer(buffer, 128, new Float32Array(baseColor));
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
            const imageUrl = new URL(imageDef.uri, baseUrl).href;
            textureViews.push(await loadTextureAndView(imageUrl));
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

    const nodes = (gltf.nodes || []).map(node => ({
        mesh: node.mesh,
        children: node.children || [],
        localMatrix: getNodeLocalMatrix(node)
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
                }
            }

            const renderItem = createTriangleRenderItem(textureView);
            primitives.push({ mesh, renderItem, baseColor, bbox });
        }

        let meshBbox = primitives[0].bbox;
        for (let i = 1; i < primitives.length; i++) {
            meshBbox = mergeBoundingBox(meshBbox, primitives[i].bbox);
        }

        meshes.push({ primitives, bbox: meshBbox });
    }

    let modelBbox = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };

    function traverseBBox(nodeIndex, parentMat) {
        const node = nodes[nodeIndex];
        const worldMat = mat4.multiply(mat4.create(), parentMat, node.localMatrix);

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
            traverseBBox(child, worldMat);
        }
    }

    for (const root of scene.nodes) {
        traverseBBox(root, mat4.create());
    }

    return {
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

function eulerDegreesToQuaternion(x, y, z) {
    const q = quat.create();
    quat.fromEuler(q, x, y, z);
    return [q[0], q[1], q[2], q[3]];
}

function initPhysics(collisionSize) {
    const world = HK.HP_World_Create();
    checkResult(world[0], 'HP_World_Create');
    worldId = world[1];

    checkResult(HK.HP_World_SetGravity(worldId, [0, -9.8, 0]), 'HP_World_SetGravity');
    checkResult(HK.HP_World_SetIdealStepTime(worldId, 1 / 60), 'HP_World_SetIdealStepTime');

    const groundShapeResult = HK.HP_Shape_CreateBox([0, 0, 0], IDENTITY_QUATERNION, [800, 8, 800]);
    checkResult(groundShapeResult[0], 'HP_Shape_CreateBox (ground)');
    const groundShapeId = groundShapeResult[1];

    const duckShapeResult = HK.HP_Shape_CreateBox([0, 0, 0], IDENTITY_QUATERNION, collisionSize);
    checkResult(duckShapeResult[0], 'HP_Shape_CreateBox (duck)');
    const duckShapeId = duckShapeResult[1];
    checkResult(HK.HP_Shape_SetDensity(duckShapeId, 1), 'HP_Shape_SetDensity');

    createBody(groundShapeId, HK.MotionType.STATIC, [0, -5, 0], IDENTITY_QUATERNION, false);

    duckBody = createBody(
        duckShapeId,
        HK.MotionType.DYNAMIC,
        [0, 20, 0],
        eulerDegreesToQuaternion(8, 0, 10),
        true
    );

    checkResult(HK.HP_Body_SetAngularVelocity(duckBody, [0, 0, 3.5]), 'HP_Body_SetAngularVelocity');
}

function updateDuckWorldMatrix() {
    const pResult = HK.HP_Body_GetPosition(duckBody);
    checkResult(pResult[0], 'HP_Body_GetPosition');
    const qResult = HK.HP_Body_GetOrientation(duckBody);
    checkResult(qResult[0], 'HP_Body_GetOrientation');

    const p = pResult[1];
    const q = qResult[1];

    const bodyRot = quat.fromValues(q[0], q[1], q[2], q[3]);
    const bodyPos = vec3.fromValues(p[0], p[1], p[2]);

    mat4.fromRotationTranslation(duckWorldMatrix, bodyRot, bodyPos);
    mat4.scale(duckWorldMatrix, duckWorldMatrix, [FALL_SCALE, FALL_SCALE, FALL_SCALE]);
    mat4.translate(duckWorldMatrix, duckWorldMatrix, duckOffset);
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
        const worldMat = mat4.multiply(mat4.create(), parentMat, node.localMatrix);

        if (node.mesh !== undefined) {
            const mesh = duckModel.meshes[node.mesh];
            for (const prim of mesh.primitives) {
                writeTriangleUniforms(prim.renderItem.uniformBuffer, worldMat, prim.baseColor);
                drawTriangleMesh(pass, prim.mesh, prim.renderItem.bindGroup);
            }
        }

        for (const child of node.children) {
            drawNode(child, worldMat);
        }
    }

    for (const root of duckModel.roots) {
        drawNode(root, duckWorldMatrix);
    }
}

function render(timeMs) {
    checkResult(HK.HP_World_Step(worldId, 1 / 60), 'HP_World_Step');
    updateDuckWorldMatrix();

    const t = timeMs * 0.001;
    const eye = vec3.fromValues(Math.sin(t * 0.2) * 80, 20, Math.cos(t * 0.2) * 80);
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

    const groundModel = mat4.create();
    mat4.translate(groundModel, groundModel, [0, -1, 0]);
    mat4.scale(groundModel, groundModel, [400, 1, 400]);
    writeTriangleUniforms(groundRenderItem.uniformBuffer, groundModel, [0.65, 0.72, 0.65, 1.0]);
    drawTriangleMesh(pass, groundMesh, groundRenderItem.bindGroup);

    drawDuckNodes(pass);

    if (SHOW_DEBUG_BBOX) {
        const pResult = HK.HP_Body_GetPosition(duckBody);
        checkResult(pResult[0], 'HP_Body_GetPosition');
        const qResult = HK.HP_Body_GetOrientation(duckBody);
        checkResult(qResult[0], 'HP_Body_GetOrientation');
        const p = pResult[1];
        const q = qResult[1];
        const rot = quat.fromValues(q[0], q[1], q[2], q[3]);
        const debugModel = mat4.create();
        mat4.fromRotationTranslation(debugModel, rot, p);
        mat4.scale(debugModel, debugModel, duckDebugSize);

        writeLineUniforms(debugLineUniformBuffer, debugModel, [0.0, 1.0, 0.0, 1.0]);

        pass.setPipeline(linePipeline);
        pass.setBindGroup(0, debugLineBindGroup);
        pass.setVertexBuffer(0, debugBoxMesh.positionBuffer);
        pass.setIndexBuffer(debugBoxMesh.indexBuffer, 'uint16');
        pass.drawIndexed(debugBoxMesh.indexCount, 1, 0, 0, 0);
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

    groundMesh = createGroundMesh();
    groundRenderItem = createTriangleRenderItem(whiteTextureView);

    debugBoxMesh = createDebugLineMesh();
    debugLineUniformBuffer = device.createBuffer({
        size: 144,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    debugLineBindGroup = device.createBindGroup({
        layout: linePipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: debugLineUniformBuffer } }]
    });

    duckModel = await buildDuckModel(DUCK_GLTF_URL);

    const bbox = duckModel.bbox;
    const sizeX = (bbox.max[0] - bbox.min[0]) * FALL_SCALE;
    const sizeY = (bbox.max[1] - bbox.min[1]) * FALL_SCALE;
    const sizeZ = (bbox.max[2] - bbox.min[2]) * FALL_SCALE;

    const safeSize = [
        Math.max(0.5, sizeX),
        Math.max(0.5, sizeY),
        Math.max(0.5, sizeZ)
    ];
    duckDebugSize = safeSize;

    const centerX = (bbox.min[0] + bbox.max[0]) * 0.5;
    const centerY = (bbox.min[1] + bbox.max[1]) * 0.5;
    const centerZ = (bbox.min[2] + bbox.max[2]) * 0.5;
    vec3.set(duckOffset, -centerX, -centerY, -centerZ);

    initPhysics(safeSize);
    requestAnimationFrame(render);

    document.addEventListener('click', () => {
        checkResult(HK.HP_Body_SetLinearVelocity(duckBody, [0, 5, 0]), 'HP_Body_SetLinearVelocity');
    });
}

main().catch((err) => {
    console.error(err);
});
