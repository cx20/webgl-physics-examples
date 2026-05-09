const computeShaderWGSL = document.getElementById('cs').textContent;
const vertexShaderWGSL = document.getElementById('vs').textContent;
const fragmentShaderWGSL = document.getElementById('fs').textContent;
const skyboxVertexShaderWGSL = document.getElementById('skybox-vs').textContent;
const skyboxFragmentShaderWGSL = document.getElementById('skybox-fs').textContent;
const lineVertexShaderWGSL = document.getElementById('vs-line').textContent;
const lineFragmentShaderWGSL = document.getElementById('fs-line').textContent;

const canvas = document.getElementById('c');

const MARBLES_GLTF_URL = 'https://cx20.github.io/gltf-test/tutorialModels/IridescenceMetallicSpheres/glTF/IridescenceMetallicSpheres.gltf';
const GROUND_TEXTURE_FILE = '../../../../assets/textures/grass.jpg';
const ENV_HDR_URL = 'https://cx20.github.io/gltf-test/textures/hdr/papermill.hdr';
const MARBLE_COUNT = 120;
const STATIC_COUNT = 1;
const STATE_FLOATS = 16;
const INFO_FLOATS = 4;
const STATIC_FLOATS = 12;
const SUBSTEPS = 8;
const GROUND_Y = -3.0;
const GROUND_HALF = 40.0;
const SPAWN_RANGE = 8.5;
const SPAWN_HEIGHT = 7.0;
const MARBLE_SCALE = 1.0;

let device, context, format, depthTexture;
let renderPipeline, computePipeline, skyboxPipeline, linePipeline;
let cubeMesh;
let skyboxVertexBuffer, debugSphereVertexBuffer, debugSphereIndexBuffer, debugBoxVertexBuffer, debugBoxIndexBuffer;
let cameraBuffer, skyboxUniformBuffer, marbleInfoBuffer, staticBuffer, simParamsBuffer;
let sampler, whiteTextureView, blackCubeTextureView, envCubeTextureView, groundMaterial;
let skyboxBindGroup;
let marbleTemplates = [];
let stateBuffers = [];
let renderBindGroups = [];
let computeBindGroups = [];
let lineBindGroups = [];
let currentState = 0;
let lastTime = -1;
let showWireframe = true;
let debugSphereIndexCount = 0;
let debugBoxIndexCount = 0;

const projectionMatrix = new Float32Array(16);
const viewMatrix = new Float32Array(16);
const viewNoTranslationMatrix = new Float32Array(16);
const viewProjectionMatrix = new Float32Array(16);

function resize() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';

    context.configure({ device, format, alphaMode: 'opaque' });

    depthTexture = device.createTexture({
        size: { width: canvas.width, height: canvas.height },
        format: 'depth24plus',
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
}

function createBoxGeometry() {
    const positions = new Float32Array([
        -0.5,-0.5, 0.5,  0.5,-0.5, 0.5,  0.5, 0.5, 0.5, -0.5, 0.5, 0.5,
         0.5,-0.5,-0.5, -0.5,-0.5,-0.5, -0.5, 0.5,-0.5,  0.5, 0.5,-0.5,
        -0.5,-0.5,-0.5, -0.5,-0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5,-0.5,
         0.5,-0.5, 0.5,  0.5,-0.5,-0.5,  0.5, 0.5,-0.5,  0.5, 0.5, 0.5,
        -0.5, 0.5, 0.5,  0.5, 0.5, 0.5,  0.5, 0.5,-0.5, -0.5, 0.5,-0.5,
        -0.5,-0.5,-0.5,  0.5,-0.5,-0.5,  0.5,-0.5, 0.5, -0.5,-0.5, 0.5,
    ]);
    const normals = new Float32Array([
         0, 0, 1,  0, 0, 1,  0, 0, 1,  0, 0, 1,
         0, 0,-1,  0, 0,-1,  0, 0,-1,  0, 0,-1,
        -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0,
         1, 0, 0,  1, 0, 0,  1, 0, 0,  1, 0, 0,
         0, 1, 0,  0, 1, 0,  0, 1, 0,  0, 1, 0,
         0,-1, 0,  0,-1, 0,  0,-1, 0,  0,-1, 0,
    ]);
    const uvs = new Float32Array([
        0,0, 1,0, 1,1, 0,1,  0,0, 1,0, 1,1, 0,1,
        0,0, 1,0, 1,1, 0,1,  0,0, 1,0, 1,1, 0,1,
        0,0, 1,0, 1,1, 0,1,  0,0, 1,0, 1,1, 0,1,
    ]);
    const indices = new Uint16Array([
         0, 1, 2,  0, 2, 3,   4, 5, 6,  4, 6, 7,
         8, 9,10,  8,10,11,  12,13,14, 12,14,15,
        16,17,18, 16,18,19,  20,21,22, 20,22,23,
    ]);
    return createMesh(positions, normals, uvs, indices);
}

function createMesh(positions, normals, uvs, indices = null) {
    const finalIndices = indices || createSequentialIndices(positions.length / 3);
    return {
        positionBuffer: createVertexBuffer(positions),
        normalBuffer: createVertexBuffer(normals),
        uvBuffer: createVertexBuffer(uvs),
        indexBuffer: createIndexBuffer(finalIndices),
        indexCount: finalIndices.length,
        indexFormat: finalIndices instanceof Uint32Array ? 'uint32' : 'uint16',
    };
}

function createSequentialIndices(count) {
    if (count > 65535) {
        const indices = new Uint32Array(count);
        for (let i = 0; i < count; i++) indices[i] = i;
        return indices;
    }
    const indices = new Uint16Array(count);
    for (let i = 0; i < count; i++) indices[i] = i;
    return indices;
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

async function createTextureViewFromUrl(src) {
    const response = await fetch(src);
    const blob = await response.blob();
    const bitmap = await createImageBitmap(blob);
    const texture = device.createTexture({
        size: [bitmap.width, bitmap.height, 1],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    device.queue.copyExternalImageToTexture({ source: bitmap }, { texture }, [bitmap.width, bitmap.height]);
    bitmap.close();
    return texture.createView();
}

function createSolidTextureView(color = [255, 255, 255, 255]) {
    const texCanvas = document.createElement('canvas');
    texCanvas.width = 1;
    texCanvas.height = 1;
    const ctx = texCanvas.getContext('2d');
    ctx.fillStyle = `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${color[3] / 255})`;
    ctx.fillRect(0, 0, 1, 1);

    const texture = device.createTexture({
        size: [1, 1, 1],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    device.queue.copyExternalImageToTexture({ source: texCanvas }, { texture }, [1, 1]);
    return texture.createView();
}

function createSolidCubeTextureView(color = [0, 0, 0, 255]) {
    const texCanvas = document.createElement('canvas');
    texCanvas.width = 1;
    texCanvas.height = 1;
    const ctx = texCanvas.getContext('2d');
    ctx.fillStyle = `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${color[3] / 255})`;
    ctx.fillRect(0, 0, 1, 1);

    const texture = device.createTexture({
        size: [1, 1, 6],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    for (let face = 0; face < 6; face++) {
        device.queue.copyExternalImageToTexture(
            { source: texCanvas },
            { texture, origin: { x: 0, y: 0, z: face } },
            [1, 1]
        );
    }
    return texture.createView({ dimension: 'cube' });
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
    if (!match) {
        throw new Error('Unsupported HDR resolution format.');
    }

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

    const c00 = [hdr.data[i00], hdr.data[i00 + 1], hdr.data[i00 + 2]];
    const c10 = [hdr.data[i10], hdr.data[i10 + 1], hdr.data[i10 + 2]];
    const c01 = [hdr.data[i01], hdr.data[i01 + 1], hdr.data[i01 + 2]];
    const c11 = [hdr.data[i11], hdr.data[i11 + 1], hdr.data[i11 + 2]];

    const c0 = [
        c00[0] * (1 - tx) + c10[0] * tx,
        c00[1] * (1 - tx) + c10[1] * tx,
        c00[2] * (1 - tx) + c10[2] * tx,
    ];
    const c1 = [
        c01[0] * (1 - tx) + c11[0] * tx,
        c01[1] * (1 - tx) + c11[1] * tx,
        c01[2] * (1 - tx) + c11[2] * tx,
    ];

    return [
        c0[0] * (1 - ty) + c1[0] * ty,
        c0[1] * (1 - ty) + c1[1] * ty,
        c0[2] * (1 - ty) + c1[2] * ty,
    ];
}

function normalize3(v) {
    const len = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / len, v[1] / len, v[2] / len];
}

function directionForCubeFace(faceIndex, u, v) {
    if (faceIndex === 0) return normalize3([1, -v, -u]);
    if (faceIndex === 1) return normalize3([-1, -v, u]);
    if (faceIndex === 2) return normalize3([u, 1, v]);
    if (faceIndex === 3) return normalize3([u, -1, -v]);
    if (faceIndex === 4) return normalize3([u, -v, 1]);
    return normalize3([-u, -v, -1]);
}

async function loadHDRAsCubeTextureView(url, size = 192) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error('Failed to fetch HDR: ' + response.status);
    }

    const buffer = await response.arrayBuffer();
    const hdr = parseHDR(buffer);
    const texture = device.createTexture({
        size: [size, size, 6],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
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
        5126: Float32Array,
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

function getMaxExtent(bbox) {
    return Math.max(
        bbox.max[0] - bbox.min[0],
        bbox.max[1] - bbox.min[1],
        bbox.max[2] - bbox.min[2]
    );
}

function computeFlatNormals(positions, indices) {
    const normals = new Float32Array(positions.length);
    const triangleCount = indices ? indices.length : positions.length / 3;
    for (let i = 0; i < triangleCount; i += 3) {
        const idx0 = indices ? indices[i] : i;
        const idx1 = indices ? indices[i + 1] : i + 1;
        const idx2 = indices ? indices[i + 2] : i + 2;
        const i0 = idx0 * 3;
        const i1 = idx1 * 3;
        const i2 = idx2 * 3;
        const ax = positions[i1] - positions[i0];
        const ay = positions[i1 + 1] - positions[i0 + 1];
        const az = positions[i1 + 2] - positions[i0 + 2];
        const bx = positions[i2] - positions[i0];
        const by = positions[i2 + 1] - positions[i0 + 1];
        const bz = positions[i2 + 2] - positions[i0 + 2];
        let nx = ay * bz - az * by;
        let ny = az * bx - ax * bz;
        let nz = ax * by - ay * bx;
        const len = Math.hypot(nx, ny, nz) || 1;
        nx /= len; ny /= len; nz /= len;
        for (const idx of [idx0, idx1, idx2]) {
            normals[idx * 3] += nx;
            normals[idx * 3 + 1] += ny;
            normals[idx * 3 + 2] += nz;
        }
    }
    for (let i = 0; i < normals.length; i += 3) {
        const len = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1;
        normals[i] /= len;
        normals[i + 1] /= len;
        normals[i + 2] /= len;
    }
    return normals;
}

function expandToTriangles(positions, normals, uvs, indices) {
    if (!indices) {
        return { positions: new Float32Array(positions), normals: new Float32Array(normals), uvs: new Float32Array(uvs) };
    }

    const outPositions = new Float32Array(indices.length * 3);
    const outNormals = new Float32Array(indices.length * 3);
    const outUvs = new Float32Array(indices.length * 2);
    for (let i = 0; i < indices.length; i++) {
        const idx = indices[i];
        outPositions[i * 3] = positions[idx * 3];
        outPositions[i * 3 + 1] = positions[idx * 3 + 1];
        outPositions[i * 3 + 2] = positions[idx * 3 + 2];
        outNormals[i * 3] = normals[idx * 3];
        outNormals[i * 3 + 1] = normals[idx * 3 + 1];
        outNormals[i * 3 + 2] = normals[idx * 3 + 2];
        outUvs[i * 2] = uvs[idx * 2];
        outUvs[i * 2 + 1] = uvs[idx * 2 + 1];
    }
    return { positions: outPositions, normals: outNormals, uvs: outUvs };
}

async function loadMarbleTemplates() {
    const { gltf, buffers, baseUrl } = await loadGLTF(MARBLES_GLTF_URL);
    const textureViewCache = new Map();

    async function getTextureView(textureIndex) {
        if (textureIndex === undefined || !gltf.textures || !gltf.images) {
            return whiteTextureView;
        }
        if (textureViewCache.has(textureIndex)) {
            return textureViewCache.get(textureIndex);
        }

        const texDef = gltf.textures[textureIndex];
        const imgDef = gltf.images[texDef.source];
        if (!imgDef || !imgDef.uri) {
            return whiteTextureView;
        }
        const textureView = await createTextureViewFromUrl(new URL(imgDef.uri, baseUrl).href);
        textureViewCache.set(textureIndex, textureView);
        return textureView;
    }

    const meshRecords = [];
    for (const meshDef of gltf.meshes) {
        const primitives = [];
        let meshExtent = 0;

        for (const primitive of meshDef.primitives) {
            const attrs = primitive.attributes;
            const positions = getAccessorData(gltf, buffers, attrs.POSITION);
            const indices = primitive.indices !== undefined ? getAccessorData(gltf, buffers, primitive.indices) : null;
            const normals = attrs.NORMAL !== undefined
                ? getAccessorData(gltf, buffers, attrs.NORMAL)
                : computeFlatNormals(positions, indices);
            const uvs = attrs.TEXCOORD_0 !== undefined
                ? getAccessorData(gltf, buffers, attrs.TEXCOORD_0)
                : new Float32Array((positions.length / 3) * 2);

            const bbox = calculateBoundingBox(positions);
            meshExtent = Math.max(meshExtent, getMaxExtent(bbox));
            const expanded = expandToTriangles(positions, normals, uvs, indices);
            const mesh = createMesh(expanded.positions, expanded.normals, expanded.uvs);

            let textureView = whiteTextureView;
            let iridescenceTextureView = whiteTextureView;
            let iridescenceThicknessTextureView = whiteTextureView;
            let baseColor = [1, 1, 1, 1];
            let hasTexture = 0;
            let ior = 1.5;
            let iridescenceFactor = 0.0;
            let iridescenceIor = 1.3;
            let iridescenceThicknessMin = 100.0;
            let iridescenceThicknessMax = 400.0;
            let hasIridescenceMap = 0.0;
            let hasIridescenceThicknessMap = 0.0;
            let metallic = 1.0;
            let roughness = 0.2;

            if (primitive.material !== undefined && gltf.materials) {
                const material = gltf.materials[primitive.material];
                if (material && material.pbrMetallicRoughness) {
                    const pbr = material.pbrMetallicRoughness;
                    if (pbr.baseColorFactor) baseColor = pbr.baseColorFactor;
                    if (pbr.metallicFactor !== undefined) metallic = pbr.metallicFactor;
                    if (pbr.roughnessFactor !== undefined) roughness = pbr.roughnessFactor;
                    if (pbr.baseColorTexture) {
                        textureView = await getTextureView(pbr.baseColorTexture.index);
                        hasTexture = 1;
                    }
                }

                const iorExt = material && material.extensions ? material.extensions.KHR_materials_ior : null;
                if (iorExt && iorExt.ior !== undefined) {
                    ior = iorExt.ior;
                }

                const irExt = material && material.extensions ? material.extensions.KHR_materials_iridescence : null;
                if (irExt) {
                    if (irExt.iridescenceFactor !== undefined) iridescenceFactor = irExt.iridescenceFactor;
                    if (irExt.iridescenceIor !== undefined) iridescenceIor = irExt.iridescenceIor;
                    if (irExt.iridescenceThicknessMinimum !== undefined) iridescenceThicknessMin = irExt.iridescenceThicknessMinimum;
                    if (irExt.iridescenceThicknessMaximum !== undefined) iridescenceThicknessMax = irExt.iridescenceThicknessMaximum;

                    if (irExt.iridescenceTexture !== undefined) {
                        iridescenceTextureView = await getTextureView(irExt.iridescenceTexture.index);
                        hasIridescenceMap = 1.0;
                    }
                    if (irExt.iridescenceThicknessTexture !== undefined) {
                        iridescenceThicknessTextureView = await getTextureView(irExt.iridescenceThicknessTexture.index);
                        hasIridescenceThicknessMap = 1.0;
                    }
                }
            }

            primitives.push({
                mesh,
                material: {
                    textureView,
                    iridescenceTextureView,
                    iridescenceThicknessTextureView,
                    baseColor,
                    params0: [ior, iridescenceFactor, iridescenceIor, hasIridescenceMap],
                    params1: [iridescenceThicknessMin, iridescenceThicknessMax, hasIridescenceThicknessMap, 1.0],
                    params2: [1.0, 1.0, metallic, roughness],
                    flags: [hasTexture, 0.0, 0.0, 0.0],
                },
            });
        }
        meshRecords.push({ primitives, meshExtent });
    }

    const sphereNodes = (gltf.nodes || []).filter(node => node.mesh !== undefined && node.name && node.name.indexOf('Sphere') === 0);
    const selectedNodes = sphereNodes.length ? sphereNodes.slice(0, MARBLE_COUNT) : (gltf.nodes || []).filter(node => node.mesh !== undefined).slice(0, MARBLE_COUNT);
    const templates = selectedNodes.map((node) => {
        const meshRec = meshRecords[node.mesh];
        const scale = node.scale || [1, 1, 1];
        const maxScale = Math.max(scale[0], scale[1], scale[2]) * MARBLE_SCALE;
        const radius = Math.max(0.05, meshRec.meshExtent * 0.5 * maxScale);
        return {
            primitives: meshRec.primitives,
            radius,
            renderScale: maxScale,
        };
    });

    if (!templates.length) {
        throw new Error('No marble meshes were found in the glTF file.');
    }

    return templates;
}

function createInitialStates() {
    const states = new Float32Array(MARBLE_COUNT * STATE_FLOATS);
    for (let i = 0; i < MARBLE_COUNT; i++) {
        const seed = ((i * 37) % 101) / 101;
        const base = i * STATE_FLOATS;
        const col = i % 12;
        const row = Math.floor(i / 12);
        states[base + 0] = (col - 5.5) * 0.88 + (seed - 0.5) * 0.8;
        states[base + 1] = SPAWN_HEIGHT + row * 0.38 + seed * 3;
        states[base + 2] = Math.sin(seed * Math.PI * 10 + i * 0.19) * SPAWN_RANGE;
        states[base + 3] = seed;
        states[base + 4] = (seed - 0.5) * 0.45;
        states[base + 5] = -0.05;
        states[base + 6] = (0.5 - seed) * 0.45;
        states[base + 8] = 0;
        states[base + 9] = 0;
        states[base + 10] = 0;
        states[base + 11] = 1;
        states[base + 12] = seed * 0.5;
        states[base + 13] = seed * 0.25;
        states[base + 14] = -seed * 0.4;
    }
    return states;
}

function createMarbleInfos() {
    const infos = new Float32Array(MARBLE_COUNT * INFO_FLOATS);
    for (let i = 0; i < MARBLE_COUNT; i++) {
        const template = marbleTemplates[i % marbleTemplates.length];
        const seed = ((i * 37) % 101) / 101;
        const base = i * INFO_FLOATS;
        infos[base + 0] = template.radius;
        infos[base + 1] = template.renderScale;
        infos[base + 2] = 0.46 + seed * 0.14;
        infos[base + 3] = 0.006 + seed * 0.006;
    }
    return infos;
}

function createStaticItems() {
    const items = new Float32Array(STATIC_COUNT * STATIC_FLOATS);
    const data = [
        { pos: [0, GROUND_Y - 1, 0], scale: [80, 2, 80], color: [0.88, 0.88, 0.88, 1] },
    ];
    for (let i = 0; i < data.length; i++) {
        const base = i * STATIC_FLOATS;
        items.set([...data[i].pos, 0], base);
        items.set([...data[i].scale, 0], base + 4);
        items.set(data[i].color, base + 8);
    }
    return items;
}

function createMaterialBindGroup(material) {
    const buffer = device.createBuffer({
        size: 80,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const data = new Float32Array(20);
    data.set(material.baseColor, 0);
    data.set(material.params0, 4);
    data.set(material.params1, 8);
    data.set(material.params2, 12);
    data.set(material.flags, 16);
    device.queue.writeBuffer(buffer, 0, data);
    return {
        buffer,
        bindGroup: device.createBindGroup({
            layout: renderPipeline.getBindGroupLayout(1),
            entries: [
                { binding: 0, resource: { buffer } },
                { binding: 1, resource: sampler },
                { binding: 2, resource: material.textureView || whiteTextureView },
                { binding: 3, resource: material.iridescenceTextureView || whiteTextureView },
                { binding: 4, resource: material.iridescenceThicknessTextureView || whiteTextureView },
                { binding: 5, resource: envCubeTextureView || blackCubeTextureView },
            ],
        }),
    };
}

function assignMaterialBindGroups() {
    for (const template of marbleTemplates) {
        for (const primitive of template.primitives) {
            if (!primitive.material.bindGroup) {
                Object.assign(primitive.material, createMaterialBindGroup(primitive.material));
            }
        }
    }
    Object.assign(groundMaterial, createMaterialBindGroup(groundMaterial));
}

function writeCamera(timeMs) {
    const t = timeMs * 0.0002;
    const eye = [
        Math.sin(t) * 22,
        10,
        Math.cos(t) * 22,
    ];
    mat4Perspective(projectionMatrix, Math.PI / 4, canvas.width / canvas.height, 0.1, 150);
    mat4LookAt(viewMatrix, eye, [0, 2.5, 0], [0, 1, 0]);
    mat4Multiply(viewProjectionMatrix, projectionMatrix, viewMatrix);
    device.queue.writeBuffer(cameraBuffer, 0, viewProjectionMatrix);
    device.queue.writeBuffer(cameraBuffer, 64, new Float32Array([eye[0], eye[1], eye[2], 1]));
}

function drawMesh(pass, mesh, instanceCount, firstInstance = 0) {
    pass.setVertexBuffer(0, mesh.positionBuffer);
    pass.setVertexBuffer(1, mesh.normalBuffer);
    pass.setVertexBuffer(2, mesh.uvBuffer);
    pass.setIndexBuffer(mesh.indexBuffer, mesh.indexFormat);
    pass.drawIndexed(mesh.indexCount, instanceCount, 0, 0, firstInstance);
}

function drawSkybox(encoder, colorView) {
    if (!skyboxPipeline || !skyboxBindGroup) return;

    viewNoTranslationMatrix.set(viewMatrix);
    viewNoTranslationMatrix[12] = 0;
    viewNoTranslationMatrix[13] = 0;
    viewNoTranslationMatrix[14] = 0;

    const skyboxUniformData = new Float32Array(40);
    skyboxUniformData.set(projectionMatrix, 0);
    skyboxUniformData.set(viewNoTranslationMatrix, 16);
    skyboxUniformData[32] = 1.0;
    device.queue.writeBuffer(skyboxUniformBuffer, 0, skyboxUniformData);

    const pass = encoder.beginRenderPass({
        colorAttachments: [{
            view: colorView,
            clearValue: { r: 0.12, g: 0.12, b: 0.14, a: 1.0 },
            loadOp: 'clear',
            storeOp: 'store',
        }],
        depthStencilAttachment: {
            view: depthTexture.createView(),
            depthClearValue: 1.0,
            depthLoadOp: 'clear',
            depthStoreOp: 'store',
        },
    });

    pass.setPipeline(skyboxPipeline);
    pass.setBindGroup(0, skyboxBindGroup);
    pass.setVertexBuffer(0, skyboxVertexBuffer);
    pass.draw(36, 1, 0, 0);
    pass.end();
}

function createDebugLineMeshes() {
    const boxLineVerts = new Float32Array([
        -0.5, -0.5, -0.5,   0.5, -0.5, -0.5,   0.5,  0.5, -0.5,  -0.5,  0.5, -0.5,
        -0.5, -0.5,  0.5,   0.5, -0.5,  0.5,   0.5,  0.5,  0.5,  -0.5,  0.5,  0.5,
    ]);
    const boxLineIndices = new Uint16Array([
        0, 1, 1, 2, 2, 3, 3, 0,
        4, 5, 5, 6, 6, 7, 7, 4,
        0, 4, 1, 5, 2, 6, 3, 7,
    ]);
    debugBoxIndexCount = boxLineIndices.length;
    debugBoxVertexBuffer = createVertexBuffer(boxLineVerts);
    debugBoxIndexBuffer = createIndexBuffer(boxLineIndices);

    const sphereSegments = 32;
    const sphereLineVerts = [];
    const sphereLineIndices = [];
    const rings = [[1, 0, 2], [0, 1, 2], [1, 2, 0]];
    for (let ring = 0; ring < 3; ring++) {
        const base = ring * sphereSegments;
        for (let i = 0; i < sphereSegments; i++) {
            const a = (i / sphereSegments) * Math.PI * 2;
            const v = [0, 0, 0];
            v[rings[ring][0]] = Math.cos(a);
            v[rings[ring][1]] = Math.sin(a);
            sphereLineVerts.push(...v);
            sphereLineIndices.push(base + i, base + ((i + 1) % sphereSegments));
        }
    }
    const sphereLineVertsF32 = new Float32Array(sphereLineVerts);
    const sphereLineIndicesU16 = new Uint16Array(sphereLineIndices);
    debugSphereIndexCount = sphereLineIndicesU16.length;
    debugSphereVertexBuffer = createVertexBuffer(sphereLineVertsF32);
    debugSphereIndexBuffer = createIndexBuffer(sphereLineIndicesU16);
}

function frame(timeMs) {
    if (lastTime < 0) {
        lastTime = timeMs;
    }
    const dt = Math.min((timeMs - lastTime) / 1000, 1 / 30);
    lastTime = timeMs;

    writeCamera(timeMs);
    device.queue.writeBuffer(simParamsBuffer, 0, new Float32Array([
        dt / SUBSTEPS,
        9.8,
        GROUND_Y,
        0.998,
        timeMs * 0.001,
        GROUND_HALF,
        SPAWN_RANGE,
        SPAWN_HEIGHT,
    ]));

    const encoder = device.createCommandEncoder();
    for (let s = 0; s < SUBSTEPS; s++) {
        const computePass = encoder.beginComputePass();
        computePass.setPipeline(computePipeline);
        computePass.setBindGroup(0, computeBindGroups[currentState]);
        computePass.dispatchWorkgroups(Math.ceil(MARBLE_COUNT / 64));
        computePass.end();
        currentState = 1 - currentState;
    }

    const colorView = context.getCurrentTexture().createView();
    drawSkybox(encoder, colorView);

    const renderPass = encoder.beginRenderPass({
        colorAttachments: [{
            view: colorView,
            loadOp: 'load',
            storeOp: 'store',
        }],
        depthStencilAttachment: {
            view: depthTexture.createView(),
            depthLoadOp: 'load',
            depthStoreOp: 'store',
        },
    });

    renderPass.setPipeline(renderPipeline);
    renderPass.setBindGroup(0, renderBindGroups[currentState]);
    for (let i = 0; i < MARBLE_COUNT; i++) {
        const template = marbleTemplates[i % marbleTemplates.length];
        for (const primitive of template.primitives) {
            renderPass.setBindGroup(1, primitive.material.bindGroup);
            drawMesh(renderPass, primitive.mesh, 1, i);
        }
    }
    renderPass.setBindGroup(1, groundMaterial.bindGroup);
    drawMesh(renderPass, cubeMesh, STATIC_COUNT, MARBLE_COUNT);

    if (showWireframe) {
        renderPass.setPipeline(linePipeline);
        renderPass.setBindGroup(0, lineBindGroups[currentState]);

        renderPass.setVertexBuffer(0, debugBoxVertexBuffer);
        renderPass.setIndexBuffer(debugBoxIndexBuffer, 'uint16');
        renderPass.drawIndexed(debugBoxIndexCount, 1, 0, 0, 0);

        renderPass.setVertexBuffer(0, debugSphereVertexBuffer);
        renderPass.setIndexBuffer(debugSphereIndexBuffer, 'uint16');
        renderPass.drawIndexed(debugSphereIndexCount, MARBLE_COUNT, 0, 0, 1);
    }
    renderPass.end();

    device.queue.submit([encoder.finish()]);
    requestAnimationFrame(frame);
}

async function init() {
    if (!navigator.gpu) throw new Error('WebGPU not supported.');
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('No GPU adapter found.');
    device = await adapter.requestDevice();
    context = canvas.getContext('webgpu');
    format = navigator.gpu.getPreferredCanvasFormat();

    sampler = device.createSampler({
        addressModeU: 'repeat',
        addressModeV: 'repeat',
        magFilter: 'linear',
        minFilter: 'linear',
        mipmapFilter: 'linear',
    });
    whiteTextureView = createSolidTextureView();
    blackCubeTextureView = createSolidCubeTextureView();
    try {
        envCubeTextureView = await loadHDRAsCubeTextureView(ENV_HDR_URL, 192);
    } catch (err) {
        console.warn('HDR environment map could not be loaded. Falling back to black cube texture.', err);
        envCubeTextureView = null;
    }
    cubeMesh = createBoxGeometry();
    marbleTemplates = await loadMarbleTemplates();
    groundMaterial = {
        textureView: await createTextureViewFromUrl(GROUND_TEXTURE_FILE),
        iridescenceTextureView: whiteTextureView,
        iridescenceThicknessTextureView: whiteTextureView,
        baseColor: [1, 1, 1, 1],
        params0: [1.5, 0.0, 1.3, 0.0],
        params1: [100.0, 400.0, 0.0, 0.55],
        params2: [0.92, 0.18, 0.0, 1.0],
        flags: [1, 1, 0, 0],
    };

    const initialStates = createInitialStates();
    for (let i = 0; i < 2; i++) {
        const buffer = device.createBuffer({
            size: MARBLE_COUNT * STATE_FLOATS * 4,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            mappedAtCreation: true,
        });
        new Float32Array(buffer.getMappedRange()).set(initialStates);
        buffer.unmap();
        stateBuffers.push(buffer);
    }

    marbleInfoBuffer = device.createBuffer({
        size: MARBLE_COUNT * INFO_FLOATS * 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        mappedAtCreation: true,
    });
    new Float32Array(marbleInfoBuffer.getMappedRange()).set(createMarbleInfos());
    marbleInfoBuffer.unmap();

    staticBuffer = device.createBuffer({
        size: STATIC_COUNT * STATIC_FLOATS * 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        mappedAtCreation: true,
    });
    new Float32Array(staticBuffer.getMappedRange()).set(createStaticItems());
    staticBuffer.unmap();

    cameraBuffer = device.createBuffer({ size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    simParamsBuffer = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

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
        fragment: {
            module: device.createShaderModule({ code: fragmentShaderWGSL }),
            entryPoint: 'main',
            targets: [{ format }],
        },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
    });

    skyboxPipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: {
            module: device.createShaderModule({ code: skyboxVertexShaderWGSL }),
            entryPoint: 'main',
            buffers: [{ arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] }],
        },
        fragment: {
            module: device.createShaderModule({ code: skyboxFragmentShaderWGSL }),
            entryPoint: 'main',
            targets: [{ format }],
        },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less-equal' },
    });

    linePipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: {
            module: device.createShaderModule({ code: lineVertexShaderWGSL }),
            entryPoint: 'main',
            buffers: [{ arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] }],
        },
        fragment: {
            module: device.createShaderModule({ code: lineFragmentShaderWGSL }),
            entryPoint: 'main',
            targets: [{ format }],
        },
        primitive: { topology: 'line-list' },
        depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less-equal' },
    });

    computePipeline = device.createComputePipeline({
        layout: 'auto',
        compute: {
            module: device.createShaderModule({ code: computeShaderWGSL }),
            entryPoint: 'main',
        },
    });
    assignMaterialBindGroups();

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
        -1,  1, -1,  1,  1,  1,  1,  1, -1,
    ]);
    skyboxVertexBuffer = createVertexBuffer(skyboxVerts);
    skyboxUniformBuffer = device.createBuffer({
        size: 40 * 4,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    skyboxBindGroup = device.createBindGroup({
        layout: skyboxPipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: skyboxUniformBuffer } },
            { binding: 1, resource: sampler },
            { binding: 2, resource: envCubeTextureView || blackCubeTextureView },
        ],
    });

    createDebugLineMeshes();

    for (let i = 0; i < 2; i++) {
        renderBindGroups.push(device.createBindGroup({
            layout: renderPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: cameraBuffer } },
                { binding: 1, resource: { buffer: stateBuffers[i] } },
                { binding: 2, resource: { buffer: marbleInfoBuffer } },
                { binding: 3, resource: { buffer: staticBuffer } },
            ],
        }));

        computeBindGroups.push(device.createBindGroup({
            layout: computePipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: stateBuffers[i] } },
                { binding: 1, resource: { buffer: stateBuffers[1 - i] } },
                { binding: 2, resource: { buffer: marbleInfoBuffer } },
                { binding: 3, resource: { buffer: simParamsBuffer } },
            ],
        }));

        lineBindGroups.push(device.createBindGroup({
            layout: linePipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: cameraBuffer } },
                { binding: 1, resource: { buffer: stateBuffers[i] } },
                { binding: 2, resource: { buffer: marbleInfoBuffer } },
                { binding: 3, resource: { buffer: staticBuffer } },
            ],
        }));
    }

    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('keydown', event => {
        const isWKey = event.code === 'KeyW' || event.key === 'w' || event.key === 'W';
        if (!isWKey || event.repeat) return;
        showWireframe = !showWireframe;
        const hint = document.getElementById('hint');
        if (hint) hint.textContent = 'W: wireframe ' + (showWireframe ? 'ON' : 'OFF');
    });
    requestAnimationFrame(frame);
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
    let len = Math.hypot(zx, zy, zz);
    zx /= len; zy /= len; zz /= len;

    let xx = up[1] * zz - up[2] * zy;
    let xy = up[2] * zx - up[0] * zz;
    let xz = up[0] * zy - up[1] * zx;
    len = Math.hypot(xx, xy, xz);
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

function mat4Multiply(out, a, b) {
    for (let c = 0; c < 4; c++) {
        for (let r = 0; r < 4; r++) {
            out[c * 4 + r] =
                a[0 * 4 + r] * b[c * 4 + 0] +
                a[1 * 4 + r] * b[c * 4 + 1] +
                a[2 * 4 + r] * b[c * 4 + 2] +
                a[3 * 4 + r] * b[c * 4 + 3];
        }
    }
}

init().catch(err => console.error(err));
