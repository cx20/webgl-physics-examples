const HAVOK_WASM_URL = 'https://cx20.github.io/gltf-test/libs/babylonjs/dev/HavokPhysics.wasm';
const { mat4, vec3, quat } = glMatrix;

const DUCK_GLTF_URL = 'https://cx20.github.io/gltf-test/sampleModels/Duck/glTF/Duck.gltf';
const ENV_HDR_URL = 'https://cx20.github.io/gltf-test/textures/hdr/papermill.hdr';
const GROUND_TEXTURE_FILE = '../../../../assets/textures/grass.jpg';
const COIN_NORMAL_TEXTURE_FILE = '../../../../assets/textures/rockn.png';

const PHYSICS_SCALE = 0.1;
const COIN_INTERVAL = 6;
const MAX_COINS = 6000;
const GROUND_Y = -10;
const IDENTITY_QUATERNION = [0, 0, 0, 1];

const COIN_TYPES = {
    GOLD:   { color: [1.000, 0.766, 0.336, 1], height: 0.10,  diameter: 1.0, metallic: 1.0, roughness: 0.20 },
    SILVER: { color: [0.972, 0.960, 0.915, 1], height: 0.075, diameter: 0.8, metallic: 1.0, roughness: 0.40 },
    COPPER: { color: [0.955, 0.637, 0.538, 1], height: 0.05,  diameter: 0.6, metallic: 1.0, roughness: 0.20 },
};
const COIN_TYPE_NAMES = ['GOLD', 'SILVER', 'COPPER'];

const LINE_ALIGN = 256;
const LINE_STRUCT_SIZE = 144;
const UNIFORM_BUFFER_SIZE = 240;

let canvas;
let device;
let context;
let format;
let depthTexture;

let pipeline;
let sampler;
let blackCubeTextureView;
let envCubeTextureView;
let skyboxPipeline;
let skyboxUniformBuffer;
let skyboxBindGroup;
let skyboxVertexBuffer;

let HK;
let worldId;
const coins = [];

let groundMesh;
let groundRenderItem;
let groundTextureView;

let cylinderMesh;
let sphereWireMesh;
let boxWireMesh;
let whiteTextureView;
let flatNormalTextureView;
let coinNormalTextureView;

let linePipeline;
let showWireframe = true;
let lineUniformBuffer;
let lineBindGroup;
let lineUniformData;
let numLineSlots = 0;

const projection = mat4.create();
const view = mat4.create();
const viewProj = mat4.create();
const viewNoTranslation = mat4.create();

const uniformScratch = new Float32Array(UNIFORM_BUFFER_SIZE / 4);

function rand(min, max) {
    return min + Math.random() * (max - min);
}

function getNextPosition(yOffset) {
    return [
        rand(-25, 25) * PHYSICS_SCALE,
        (rand(0, 10) + yOffset) * PHYSICS_SCALE,
        rand(-25, 25) * PHYSICS_SCALE,
    ];
}

function createVertexBuffer(data) {
    const buffer = device.createBuffer({
        size: data.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
    });
    device.queue.writeBuffer(buffer, 0, data);
    return buffer;
}

function createIndexBuffer(data) {
    const buffer = device.createBuffer({
        size: data.byteLength,
        usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST
    });
    device.queue.writeBuffer(buffer, 0, data);
    return buffer;
}

function createCylinderMesh(segments) {
    const positions = [];
    const normals = [];
    const uvs = [];
    const indices = [];

    for (let i = 0; i <= segments; i++) {
        const u = i / segments;
        const a = u * Math.PI * 2;
        const x = Math.cos(a);
        const z = Math.sin(a);
        positions.push(x, -0.5, z, x, 0.5, z);
        normals.push(x, 0, z, x, 0, z);
        uvs.push(u, 0, u, 1);
    }
    for (let i = 0; i < segments; i++) {
        const base = i * 2;
        indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    }

    const topCenter = positions.length / 3;
    positions.push(0, 0.5, 0);
    normals.push(0, 1, 0);
    uvs.push(0.5, 0.5);
    const topStart = positions.length / 3;
    for (let i = 0; i < segments; i++) {
        const a = (i / segments) * Math.PI * 2;
        const x = Math.cos(a);
        const z = Math.sin(a);
        positions.push(x, 0.5, z);
        normals.push(0, 1, 0);
        uvs.push(x * 0.5 + 0.5, z * 0.5 + 0.5);
    }

    const bottomCenter = positions.length / 3;
    positions.push(0, -0.5, 0);
    normals.push(0, -1, 0);
    uvs.push(0.5, 0.5);
    const bottomStart = positions.length / 3;
    for (let i = 0; i < segments; i++) {
        const a = (i / segments) * Math.PI * 2;
        const x = Math.cos(a);
        const z = Math.sin(a);
        positions.push(x, -0.5, z);
        normals.push(0, -1, 0);
        uvs.push(x * 0.5 + 0.5, z * 0.5 + 0.5);
    }

    for (let i = 0; i < segments; i++) {
        const next = (i + 1) % segments;
        indices.push(topCenter, topStart + next, topStart + i);
        indices.push(bottomCenter, bottomStart + i, bottomStart + next);
    }

    return {
        positionBuffer: createVertexBuffer(new Float32Array(positions)),
        normalBuffer: createVertexBuffer(new Float32Array(normals)),
        uvBuffer: createVertexBuffer(new Float32Array(uvs)),
        indexBuffer: createIndexBuffer(new Uint16Array(indices)),
        indexCount: indices.length,
    };
}

function createSphereWireMesh(segments) {
    const positions = [];
    const indices = [];
    const rings = [[1, 0, 2], [0, 1, 2], [1, 2, 0]];
    for (let r = 0; r < 3; r++) {
        const base = r * segments;
        for (let i = 0; i < segments; i++) {
            const a = (i / segments) * Math.PI * 2;
            const v = [0, 0, 0];
            v[rings[r][0]] = Math.cos(a);
            v[rings[r][1]] = Math.sin(a);
            v[rings[r][2]] = 0;
            positions.push(v[0], v[1], v[2]);
            indices.push(base + i, base + (i + 1) % segments);
        }
    }
    return {
        positionBuffer: createVertexBuffer(new Float32Array(positions)),
        indexBuffer: createIndexBuffer(new Uint16Array(indices)),
        indexCount: indices.length,
    };
}

function createBoxWireMesh() {
    const positions = new Float32Array([
        -0.5, -0.5, -0.5,   0.5, -0.5, -0.5,   0.5,  0.5, -0.5,  -0.5,  0.5, -0.5,
        -0.5, -0.5,  0.5,   0.5, -0.5,  0.5,   0.5,  0.5,  0.5,  -0.5,  0.5,  0.5
    ]);
    const indices = new Uint16Array([
        0,1, 1,2, 2,3, 3,0,
        4,5, 5,6, 6,7, 7,4,
        0,4, 1,5, 2,6, 3,7
    ]);
    return {
        positionBuffer: createVertexBuffer(positions),
        indexBuffer: createIndexBuffer(indices),
        indexCount: indices.length,
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
        0, 1, 0,  0, 1, 0,  0, 1, 0,
        0, 1, 0,  0, 1, 0,  0, 1, 0,
    ]);
    const uvs = new Float32Array([
        0, 0,  3, 0,  3, 3,
        0, 0,  3, 3,  0, 3,
    ]);
    return {
        positionBuffer: createVertexBuffer(positions),
        normalBuffer: createVertexBuffer(normals),
        uvBuffer: createVertexBuffer(uvs),
        vertexCount: 6,
    };
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

function createSolidCubeTextureView(r, g, b, a) {
    const texture = device.createTexture({
        size: [1, 1, 6],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
    });
    const pixel = new Uint8Array([r, g, b, a]);
    for (let layer = 0; layer < 6; layer++) {
        device.queue.writeTexture(
            { texture, origin: { x: 0, y: 0, z: layer } },
            pixel,
            { bytesPerRow: 4, rowsPerImage: 1 },
            { width: 1, height: 1, depthOrArrayLayers: 1 }
        );
    }
    return texture.createView({ dimension: 'cube' });
}

async function loadTextureView(url) {
    const response = await fetch(url);
    const blob = await response.blob();
    const image = await createImageBitmap(blob, { imageOrientation: 'none' });
    const texture = device.createTexture({
        size: [image.width, image.height, 1],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
    });
    device.queue.copyExternalImageToTexture(
        { source: image },
        { texture },
        [image.width, image.height]
    );
    return texture.createView();
}

function parseHDR(buffer) {
    const bytes = new Uint8Array(buffer);
    let offset = 0;

    function readLine() {
        let line = '';
        while (offset < bytes.length) {
            const c = bytes[offset++];
            if (c === 10) break;
            if (c !== 13) line += String.fromCharCode(c);
        }
        return line;
    }

    let line = readLine();
    if (!line.startsWith('#?RADIANCE') && !line.startsWith('#?RGBE')) {
        throw new Error('Invalid HDR header.');
    }
    while (offset < bytes.length) {
        line = readLine();
        if (line.trim() === '') break;
    }
    const resolution = readLine();
    const match = resolution.match(/-Y\s+(\d+)\s+\+X\s+(\d+)/);
    if (!match) throw new Error('Unsupported HDR resolution format.');

    const height = parseInt(match[1], 10);
    const width = parseInt(match[2], 10);
    const data = new Float32Array(width * height * 3);
    const scanline = new Uint8Array(width * 4);

    for (let y = 0; y < height; y++) {
        if (offset + 4 > bytes.length) throw new Error('Unexpected HDR EOF.');
        const b0 = bytes[offset++];
        const b1 = bytes[offset++];
        const b2 = bytes[offset++];
        const b3 = bytes[offset++];
        if (b0 !== 2 || b1 !== 2 || (b2 & 0x80) !== 0 || ((b2 << 8) | b3) !== width) {
            throw new Error('Unsupported non-RLE HDR scanline.');
        }
        for (let c = 0; c < 4; c++) {
            let x = 0;
            while (x < width) {
                const code = bytes[offset++];
                if (code > 128) {
                    const run = code - 128;
                    const val = bytes[offset++];
                    for (let i = 0; i < run; i++) scanline[c * width + x++] = val;
                } else {
                    const run = code;
                    for (let i = 0; i < run; i++) scanline[c * width + x++] = bytes[offset++];
                }
            }
        }
        for (let x = 0; x < width; x++) {
            const r = scanline[x];
            const g = scanline[width + x];
            const b = scanline[2 * width + x];
            const e = scanline[3 * width + x];
            const dst = (y * width + x) * 3;
            if (e) {
                const f = Math.pow(2.0, e - 136.0);
                data[dst] = r * f;
                data[dst + 1] = g * f;
                data[dst + 2] = b * f;
            }
        }
    }
    return { width, height, data };
}

function sampleEquirectHDR(hdr, u, v) {
    const w = hdr.width;
    const h = hdr.height;
    const uu = ((u % 1) + 1) % 1;
    const vv = Math.min(Math.max(v, 0), 1);
    const x = uu * (w - 1);
    const y = vv * (h - 1);
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = (x0 + 1) % w;
    const y1 = Math.min(y0 + 1, h - 1);
    const tx = x - x0;
    const ty = y - y0;
    const i00 = (y0 * w + x0) * 3;
    const i10 = (y0 * w + x1) * 3;
    const i01 = (y1 * w + x0) * 3;
    const i11 = (y1 * w + x1) * 3;
    const c0 = [
        hdr.data[i00] * (1 - tx) + hdr.data[i10] * tx,
        hdr.data[i00 + 1] * (1 - tx) + hdr.data[i10 + 1] * tx,
        hdr.data[i00 + 2] * (1 - tx) + hdr.data[i10 + 2] * tx,
    ];
    const c1 = [
        hdr.data[i01] * (1 - tx) + hdr.data[i11] * tx,
        hdr.data[i01 + 1] * (1 - tx) + hdr.data[i11 + 1] * tx,
        hdr.data[i01 + 2] * (1 - tx) + hdr.data[i11 + 2] * tx,
    ];
    return [
        c0[0] * (1 - ty) + c1[0] * ty,
        c0[1] * (1 - ty) + c1[1] * ty,
        c0[2] * (1 - ty) + c1[2] * ty,
    ];
}

function directionForCubeFace(faceIndex, u, v) {
    if (faceIndex === 0) return vec3.normalize(vec3.create(), vec3.fromValues(1, -v, -u));
    if (faceIndex === 1) return vec3.normalize(vec3.create(), vec3.fromValues(-1, -v, u));
    if (faceIndex === 2) return vec3.normalize(vec3.create(), vec3.fromValues(u, 1, v));
    if (faceIndex === 3) return vec3.normalize(vec3.create(), vec3.fromValues(u, -1, -v));
    if (faceIndex === 4) return vec3.normalize(vec3.create(), vec3.fromValues(u, -v, 1));
    return vec3.normalize(vec3.create(), vec3.fromValues(-u, -v, -1));
}

async function loadHDRAsCubeTextureView(url, size = 192) {
    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to fetch HDR: ' + response.status);
    const buffer = await response.arrayBuffer();
    const hdr = parseHDR(buffer);
    const texture = device.createTexture({
        size: [size, size, 6],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
    });
    for (let face = 0; face < 6; face++) {
        const faceData = new Uint8Array(size * size * 4);
        let p = 0;
        for (let y = 0; y < size; y++) {
            const vv = 2 * ((y + 0.5) / size) - 1;
            for (let x = 0; x < size; x++) {
                const uu = 2 * ((x + 0.5) / size) - 1;
                const dir = directionForCubeFace(face, uu, vv);
                const phi = Math.atan2(dir[2], dir[0]);
                const theta = Math.acos(Math.min(Math.max(dir[1], -1), 1));
                const eu = phi / (2 * Math.PI) + 0.5;
                const ev = theta / Math.PI;
                const c = sampleEquirectHDR(hdr, eu, ev);
                faceData[p++] = Math.max(0, Math.min(255, Math.floor(Math.min(Math.max(c[0], 0), 1) * 255)));
                faceData[p++] = Math.max(0, Math.min(255, Math.floor(Math.min(Math.max(c[1], 0), 1) * 255)));
                faceData[p++] = Math.max(0, Math.min(255, Math.floor(Math.min(Math.max(c[2], 0), 1) * 255)));
                faceData[p++] = 255;
            }
        }
        device.queue.writeTexture(
            { texture, origin: { x: 0, y: 0, z: face } },
            faceData,
            { bytesPerRow: size * 4, rowsPerImage: size },
            { width: size, height: size, depthOrArrayLayers: 1 }
        );
    }
    return texture.createView({ dimension: 'cube' });
}

function createRenderItem(textureView, envCubeView, normalTextureView) {
    const uniformBuffer = device.createBuffer({
        size: UNIFORM_BUFFER_SIZE,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: uniformBuffer } },
            { binding: 1, resource: sampler },
            { binding: 2, resource: textureView },
            { binding: 3, resource: envCubeView },
            { binding: 4, resource: normalTextureView }
        ]
    });
    return { uniformBuffer, bindGroup };
}

function writeUniforms(renderItem, modelMatrix, baseColor, cameraPos, materialParams) {
    const buf = uniformScratch;
    buf.set(viewProj, 0);
    buf.set(modelMatrix, 16);
    buf[32] = baseColor[0]; buf[33] = baseColor[1]; buf[34] = baseColor[2]; buf[35] = baseColor[3];
    buf[36] = cameraPos[0]; buf[37] = cameraPos[1]; buf[38] = cameraPos[2]; buf[39] = 1.0;
    buf[40] = 0.6; buf[41] = 1.0; buf[42] = 0.5; buf[43] = 0.0;
    buf[44] = materialParams.ior;          buf[45] = 0.0; buf[46] = 0.0; buf[47] = 0.0;
    buf[48] = 0.0; buf[49] = 0.0; buf[50] = 0.0; buf[51] = materialParams.envIntensity;
    buf[52] = materialParams.envExposure;
    buf[53] = materialParams.envDiffuseStrength;
    buf[54] = materialParams.metallic;
    buf[55] = materialParams.roughness;
    buf[56] = materialParams.hasEnvCube;
    buf[57] = materialParams.unlitTextureOnly;
    buf[58] = materialParams.bumpStrength;
    buf[59] = materialParams.normalMapStrength;
    device.queue.writeBuffer(renderItem.uniformBuffer, 0, buf.buffer, buf.byteOffset, buf.byteLength);
}

function getAccessorData(gltf, buffers, accessorIndex) {
    const accessor = gltf.accessors[accessorIndex];
    const bufferView = gltf.bufferViews[accessor.bufferView];
    const buffer = buffers[bufferView.buffer || 0];
    const componentMap = {
        5120: Int8Array, 5121: Uint8Array, 5122: Int16Array,
        5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array
    };
    const compsMap = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
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
        const bufferUrl = new URL(buf.uri, baseUrl).href;
        const data = await fetch(bufferUrl).then(r => r.arrayBuffer());
        buffers.push(new Uint8Array(data));
    }
    return { gltf, buffers, baseUrl };
}

async function loadDuckCoinPositions() {
    const { gltf, buffers } = await loadGLTF(DUCK_GLTF_URL);
    let positions = null;
    let indices = null;
    for (const meshDef of gltf.meshes) {
        for (const primitive of meshDef.primitives) {
            if (primitive.attributes && primitive.attributes.POSITION !== undefined) {
                positions = getAccessorData(gltf, buffers, primitive.attributes.POSITION);
                indices = primitive.indices !== undefined
                    ? getAccessorData(gltf, buffers, primitive.indices)
                    : null;
                break;
            }
        }
        if (positions) break;
    }
    if (!positions) throw new Error('Duck.gltf has no positions');

    const coinPositions = [];
    if (indices) {
        for (let i = 0; i < indices.length && coinPositions.length < MAX_COINS; i += COIN_INTERVAL) {
            const v = indices[i];
            coinPositions.push([
                positions[v * 3 + 0] * PHYSICS_SCALE,
                positions[v * 3 + 1] * PHYSICS_SCALE + GROUND_Y,
                positions[v * 3 + 2] * PHYSICS_SCALE,
            ]);
        }
    } else {
        for (let i = 0; i < positions.length / 3 && coinPositions.length < MAX_COINS; i += COIN_INTERVAL) {
            coinPositions.push([
                positions[i * 3 + 0] * PHYSICS_SCALE,
                positions[i * 3 + 1] * PHYSICS_SCALE + GROUND_Y,
                positions[i * 3 + 2] * PHYSICS_SCALE,
            ]);
        }
    }
    return coinPositions;
}

function resetBodyVelocity(body) {
    checkResult(HK.HP_Body_SetLinearVelocity(body, [0, 0, 0]), 'HP_Body_SetLinearVelocity');
    checkResult(HK.HP_Body_SetAngularVelocity(body, [0, 0, 0]), 'HP_Body_SetAngularVelocity');
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

function initPhysics(coinPositions) {
    const world = HK.HP_World_Create();
    checkResult(world[0], 'HP_World_Create');
    worldId = world[1];

    checkResult(HK.HP_World_SetGravity(worldId, [0, -9.81, 0]), 'HP_World_SetGravity');
    checkResult(HK.HP_World_SetIdealStepTime(worldId, 1 / 60), 'HP_World_SetIdealStepTime');

    const groundShapeResult = HK.HP_Shape_CreateBox([0, 0, 0], IDENTITY_QUATERNION, [20, 1, 20]);
    checkResult(groundShapeResult[0], 'HP_Shape_CreateBox (ground)');
    createBody(groundShapeResult[1], HK.MotionType.STATIC, [0, GROUND_Y - 0.5, 0], IDENTITY_QUATERNION, false);

    coins.length = 0;
    for (let i = 0; i < coinPositions.length; i++) {
        const typeName = COIN_TYPE_NAMES[Math.floor(Math.random() * COIN_TYPE_NAMES.length)];
        const params = COIN_TYPES[typeName];
        const radius = params.diameter * 0.5;

        const sphereResult = HK.HP_Shape_CreateSphere([0, 0, 0], radius);
        checkResult(sphereResult[0], 'HP_Shape_CreateSphere (coin)');
        const sphereShapeId = sphereResult[1];
        checkResult(HK.HP_Shape_SetDensity(sphereShapeId, 1), 'HP_Shape_SetDensity');

        const body = createBody(
            sphereShapeId,
            HK.MotionType.DYNAMIC,
            coinPositions[i],
            IDENTITY_QUATERNION,
            true
        );

        const renderItem = createRenderItem(
            whiteTextureView,
            envCubeTextureView || blackCubeTextureView,
            coinNormalTextureView
        );

        coins.push({
            body,
            typeName,
            params,
            radius,
            renderItem,
        });
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
    context.configure({ device, format, alphaMode: 'opaque' });
    createDepthTexture();
}

function drawCylinder(pass, bindGroup) {
    pass.setVertexBuffer(0, cylinderMesh.positionBuffer);
    pass.setVertexBuffer(1, cylinderMesh.normalBuffer);
    pass.setVertexBuffer(2, cylinderMesh.uvBuffer);
    pass.setIndexBuffer(cylinderMesh.indexBuffer, 'uint16');
    pass.setBindGroup(0, bindGroup);
    pass.drawIndexed(cylinderMesh.indexCount);
}

function drawGround(pass, bindGroup) {
    pass.setVertexBuffer(0, groundMesh.positionBuffer);
    pass.setVertexBuffer(1, groundMesh.normalBuffer);
    pass.setVertexBuffer(2, groundMesh.uvBuffer);
    pass.setBindGroup(0, bindGroup);
    pass.draw(groundMesh.vertexCount, 1, 0, 0);
}

function setLineSlot(slotIndex, vpMatrix, modelMat, r, g, b, a) {
    const base = slotIndex * (LINE_ALIGN / 4);
    lineUniformData.set(vpMatrix, base);
    lineUniformData.set(modelMat, base + 16);
    lineUniformData[base + 32] = r;
    lineUniformData[base + 33] = g;
    lineUniformData[base + 34] = b;
    lineUniformData[base + 35] = a;
}

function drawSkybox(encoder) {
    if (!envCubeTextureView || !skyboxPipeline) return;
    mat4.copy(viewNoTranslation, view);
    viewNoTranslation[12] = 0;
    viewNoTranslation[13] = 0;
    viewNoTranslation[14] = 0;

    const skyboxUniformData = new Float32Array(40);
    skyboxUniformData.set(projection, 0);
    skyboxUniformData.set(viewNoTranslation, 16);
    skyboxUniformData[32] = 1.0;
    device.queue.writeBuffer(skyboxUniformBuffer, 0, skyboxUniformData);

    const pass = encoder.beginRenderPass({
        colorAttachments: [{
            view: context.getCurrentTexture().createView(),
            clearValue: { r: 0.12, g: 0.12, b: 0.14, a: 1.0 },
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
    pass.setPipeline(skyboxPipeline);
    pass.setBindGroup(0, skyboxBindGroup);
    pass.setVertexBuffer(0, skyboxVertexBuffer);
    pass.draw(36, 1, 0, 0);
    pass.end();
}

function clearWithoutSkybox(encoder) {
    const pass = encoder.beginRenderPass({
        colorAttachments: [{
            view: context.getCurrentTexture().createView(),
            clearValue: { r: 0.12, g: 0.12, b: 0.14, a: 1.0 },
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
    pass.end();
}

const tmpModel = mat4.create();
const tmpRotMat = mat4.create();
const tmpQuat = quat.create();

function render(timeMs) {
    checkResult(HK.HP_World_Step(worldId, 1 / 60), 'HP_World_Step');

    const t = timeMs * 0.001;
    const eye = vec3.fromValues(Math.sin(t * 0.15) * 21, -2.2, Math.cos(t * 0.15) * 21);
    mat4.lookAt(view, eye, [0, -7, 0], [0, 1, 0]);
    mat4.perspective(projection, Math.PI / 4, canvas.width / Math.max(1, canvas.height), 0.1, 200);
    mat4.multiply(viewProj, projection, view);

    if (showWireframe) {
        mat4.fromRotationTranslationScale(tmpModel, IDENTITY_QUATERNION, [0, GROUND_Y - 0.5, 0], [20, 1, 20]);
        setLineSlot(0, viewProj, tmpModel, 0, 1, 0, 1);
    }

    const encoder = device.createCommandEncoder();
    if (envCubeTextureView && skyboxPipeline) {
        drawSkybox(encoder);
    } else {
        clearWithoutSkybox(encoder);
    }

    const pass = encoder.beginRenderPass({
        colorAttachments: [{
            view: context.getCurrentTexture().createView(),
            loadOp: 'load',
            storeOp: 'store'
        }],
        depthStencilAttachment: {
            view: depthTexture.createView(),
            depthLoadOp: 'load',
            depthStoreOp: 'store'
        }
    });

    pass.setPipeline(pipeline);

    mat4.identity(tmpModel);
    mat4.translate(tmpModel, tmpModel, [0, GROUND_Y, 0]);
    mat4.scale(tmpModel, tmpModel, [20, 1, 20]);
    writeUniforms(groundRenderItem, tmpModel, [0.9, 0.9, 0.9, 1.0], eye, {
        ior: 1.5,
        envIntensity: 0.55,
        envExposure: 0.95,
        envDiffuseStrength: 0.18,
        metallic: 0.0,
        roughness: 1.0,
        hasEnvCube: 0.0,
        unlitTextureOnly: 1.0,
        bumpStrength: 1.0,
        normalMapStrength: 0.0,
    });
    drawGround(pass, groundRenderItem.bindGroup);

    for (let i = 0; i < coins.length; i++) {
        const coin = coins[i];
        const pResult = HK.HP_Body_GetPosition(coin.body);
        checkResult(pResult[0], 'HP_Body_GetPosition');
        const qResult = HK.HP_Body_GetOrientation(coin.body);
        checkResult(qResult[0], 'HP_Body_GetOrientation');
        const p = pResult[1];
        const q = qResult[1];

        if (p[1] < -50) {
            const newPos = getNextPosition(100);
            checkResult(HK.HP_Body_SetPosition(coin.body, newPos), 'HP_Body_SetPosition reset');
            checkResult(HK.HP_Body_SetOrientation(coin.body, IDENTITY_QUATERNION), 'HP_Body_SetOrientation reset');
            resetBodyVelocity(coin.body);
            continue;
        }

        quat.set(tmpQuat, q[0], q[1], q[2], q[3]);
        mat4.fromRotationTranslation(tmpModel, tmpQuat, p);
        mat4.scale(tmpModel, tmpModel, [coin.radius, coin.params.height, coin.radius]);

        writeUniforms(coin.renderItem, tmpModel, coin.params.color, eye, {
            ior: 1.5,
            envIntensity: 1.0,
            envExposure: 1.0,
            envDiffuseStrength: 1.0,
            metallic: coin.params.metallic,
            roughness: coin.params.roughness,
            hasEnvCube: envCubeTextureView ? 1.0 : 0.0,
            unlitTextureOnly: 0.0,
            bumpStrength: 0.0,
            normalMapStrength: 1.0,
        });
        drawCylinder(pass, coin.renderItem.bindGroup);

        if (showWireframe) {
            const r = coin.radius;
            mat4.fromRotationTranslationScale(tmpModel, tmpQuat, p, [r, r, r]);
            setLineSlot(i + 1, viewProj, tmpModel, 1, 1, 0, 1);
        }
    }

    if (showWireframe && linePipeline) {
        device.queue.writeBuffer(lineUniformBuffer, 0, lineUniformData);

        pass.setPipeline(linePipeline);
        pass.setVertexBuffer(0, boxWireMesh.positionBuffer);
        pass.setIndexBuffer(boxWireMesh.indexBuffer, 'uint16');
        pass.setBindGroup(0, lineBindGroup, [0]);
        pass.drawIndexed(boxWireMesh.indexCount);

        pass.setVertexBuffer(0, sphereWireMesh.positionBuffer);
        pass.setIndexBuffer(sphereWireMesh.indexBuffer, 'uint16');
        for (let i = 1; i < numLineSlots; i++) {
            pass.setBindGroup(0, lineBindGroup, [i * LINE_ALIGN]);
            pass.drawIndexed(sphereWireMesh.indexCount);
        }
    }

    pass.end();
    device.queue.submit([encoder.finish()]);

    requestAnimationFrame(render);
}

async function main() {
    canvas = document.getElementById('c');

    if (!navigator.gpu) throw new Error('WebGPU is not supported in this browser.');
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('Failed to get GPU adapter.');
    device = await adapter.requestDevice();
    HK = await HavokPhysics({
        locateFile: function (path) {
            if (path && path.endsWith('.wasm')) return HAVOK_WASM_URL;
            return path;
        }
    });
    context = canvas.getContext('webgpu');
    format = navigator.gpu.getPreferredCanvasFormat();

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
        fragment: { module: fs, entryPoint: 'main', targets: [{ format }] },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' }
    });

    sampler = device.createSampler({
        addressModeU: 'repeat',
        addressModeV: 'repeat',
        magFilter: 'linear',
        minFilter: 'linear',
        mipmapFilter: 'linear'
    });

    blackCubeTextureView = createSolidCubeTextureView(0, 0, 0, 255);
    whiteTextureView = createSolidTextureView(255, 255, 255, 255);
    flatNormalTextureView = createSolidTextureView(128, 128, 255, 255);
    try {
        envCubeTextureView = await loadHDRAsCubeTextureView(ENV_HDR_URL, 192);
    } catch (e) {
        console.warn('HDR cube map load failed:', e);
        envCubeTextureView = null;
    }
    groundTextureView = await loadTextureView(GROUND_TEXTURE_FILE);
    coinNormalTextureView = await loadTextureView(COIN_NORMAL_TEXTURE_FILE);

    const skyboxVs = device.createShaderModule({ code: document.getElementById('skybox-vs').textContent });
    const skyboxFs = device.createShaderModule({ code: document.getElementById('skybox-fs').textContent });
    skyboxPipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: {
            module: skyboxVs,
            entryPoint: 'main',
            buffers: [{ arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] }]
        },
        fragment: { module: skyboxFs, entryPoint: 'main', targets: [{ format }] },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less-equal' }
    });

    const skyboxVerts = new Float32Array([
        -1, -1, -1,  1, -1, -1,  1,  1, -1,
        -1, -1, -1,  1,  1, -1, -1,  1, -1,
        -1, -1,  1,  1, -1,  1,  1,  1,  1,
        -1, -1,  1,  1,  1,  1, -1,  1,  1,
        -1, -1, -1, -1,  1, -1, -1,  1,  1,
        -1, -1, -1, -1,  1,  1, -1, -1,  1,
         1, -1, -1,  1,  1, -1,  1,  1,  1,
         1, -1, -1,  1,  1,  1,  1, -1,  1,
        -1, -1, -1, -1, -1,  1,  1, -1,  1,
        -1, -1, -1,  1, -1,  1,  1, -1, -1,
        -1,  1, -1, -1,  1,  1,  1,  1,  1,
        -1,  1, -1,  1,  1,  1,  1,  1, -1
    ]);
    skyboxVertexBuffer = device.createBuffer({
        size: skyboxVerts.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
    });
    device.queue.writeBuffer(skyboxVertexBuffer, 0, skyboxVerts);

    skyboxUniformBuffer = device.createBuffer({
        size: 40 * 4,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    skyboxBindGroup = device.createBindGroup({
        layout: skyboxPipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: skyboxUniformBuffer } },
            { binding: 1, resource: sampler },
            { binding: 2, resource: envCubeTextureView || blackCubeTextureView }
        ]
    });

    resize();
    window.addEventListener('resize', resize);

    window.addEventListener('keydown', event => {
        const isWKey = event.code === 'KeyW' || event.key === 'w' || event.key === 'W';
        if (!isWKey || event.repeat) return;
        showWireframe = !showWireframe;
        const hint = document.getElementById('hint');
        if (hint) hint.textContent = 'W: wireframe ' + (showWireframe ? 'ON' : 'OFF');
    });

    cylinderMesh = createCylinderMesh(32);
    sphereWireMesh = createSphereWireMesh(32);
    boxWireMesh = createBoxWireMesh();

    groundMesh = createGroundMesh();
    groundRenderItem = createRenderItem(
        groundTextureView,
        envCubeTextureView || blackCubeTextureView,
        flatNormalTextureView
    );

    const coinPositions = await loadDuckCoinPositions();
    initPhysics(coinPositions);
    console.log('Total coins:', coins.length);

    const vsLine = device.createShaderModule({ code: document.getElementById('vs-line').textContent });
    const fsLine = device.createShaderModule({ code: document.getElementById('fs-line').textContent });

    const lineBGL = device.createBindGroupLayout({
        entries: [{
            binding: 0,
            visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
            buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: LINE_STRUCT_SIZE }
        }]
    });

    linePipeline = device.createRenderPipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [lineBGL] }),
        vertex: {
            module: vsLine,
            entryPoint: 'main',
            buffers: [{ arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] }]
        },
        fragment: { module: fsLine, entryPoint: 'main', targets: [{ format }] },
        primitive: { topology: 'line-list' },
        depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less-equal' }
    });

    numLineSlots = coins.length + 1;
    lineUniformBuffer = device.createBuffer({
        size: numLineSlots * LINE_ALIGN,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    lineUniformData = new Float32Array(numLineSlots * LINE_ALIGN / 4);
    lineBindGroup = device.createBindGroup({
        layout: lineBGL,
        entries: [{ binding: 0, resource: { buffer: lineUniformBuffer, size: LINE_STRUCT_SIZE } }]
    });

    requestAnimationFrame(render);

    document.addEventListener('click', () => {
        for (const coin of coins) {
            checkResult(
                HK.HP_Body_SetLinearVelocity(coin.body, [rand(-1, 1), rand(3, 6), rand(-1, 1)]),
                'HP_Body_SetLinearVelocity'
            );
        }
    });
}

main().catch((err) => {
    console.error(err);
});
