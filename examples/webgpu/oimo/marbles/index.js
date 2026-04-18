const { mat4, vec3, quat } = glMatrix;

const MARBLES_GLTF_URL = 'https://cx20.github.io/gltf-test/tutorialModels/IridescenceMetallicSpheres/glTF/IridescenceMetallicSpheres.gltf';
const GROUND_TEXTURE_FILE = '../../../../assets/textures/grass.jpg';
const ENV_HDR_URL = 'https://cx20.github.io/gltf-test/textures/hdr/papermill.hdr';
const MARBLE_SCALE = 1.0;
const MAX_MARBLES = 120;

let canvas;
let device;
let context;
let format;
let depthTexture;

let pipeline;
let sampler;
let whiteTextureView;
let blackCubeTextureView;
let envCubeTextureView;
let skyboxPipeline;
let skyboxUniformBuffer;
let skyboxBindGroup;
let skyboxVertexBuffer;

let world;
const marbles = [];

let groundMesh;
let groundRenderItem;
let groundTextureView;

const projection = mat4.create();
const view = mat4.create();
const viewProj = mat4.create();
const viewNoTranslation = mat4.create();

function rand(min, max) {
    return min + Math.random() * (max - min);
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
    }

    for (let i = 0; i < normals.length; i += 3) {
        const n = vec3.fromValues(normals[i], normals[i + 1], normals[i + 2]);
        const len = vec3.length(n);
        if (len > 0) {
            vec3.scale(n, n, 1 / len);
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

function expandToTriangles(positions, normals, uvs, indices) {
    if (!indices) {
        return { positions, normals, uvs };
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
        normalBuffer: createVertexBuffer(data.normals),
        uvBuffer: createVertexBuffer(data.uvs),
        vertexCount: data.positions.length / 3
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
        2, 0,
        2, 2,
        0, 0,
        2, 2,
        0, 2
    ]);
    return createMesh({ positions, normals, uvs });
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
        c00[2] * (1 - tx) + c10[2] * tx
    ];
    const c1 = [
        c01[0] * (1 - tx) + c11[0] * tx,
        c01[1] * (1 - tx) + c11[1] * tx,
        c01[2] * (1 - tx) + c11[2] * tx
    ];

    return [
        c0[0] * (1 - ty) + c1[0] * ty,
        c0[1] * (1 - ty) + c1[1] * ty,
        c0[2] * (1 - ty) + c1[2] * ty
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
    if (!response.ok) {
        throw new Error('Failed to fetch HDR: ' + response.status);
    }

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

function createRenderItem(textureView, iridescenceTextureView, iridescenceThicknessTextureView, envCubeView) {
    const uniformBuffer = device.createBuffer({
        size: 240,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });

    const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: uniformBuffer } },
            { binding: 1, resource: sampler },
            { binding: 2, resource: textureView },
            { binding: 3, resource: iridescenceTextureView },
            { binding: 4, resource: iridescenceThicknessTextureView },
            { binding: 5, resource: envCubeView }
        ]
    });

    return { uniformBuffer, bindGroup };
}

function writeUniforms(renderItem, modelMatrix, baseColor, cameraPos, materialParams) {
    device.queue.writeBuffer(renderItem.uniformBuffer, 0, viewProj);
    device.queue.writeBuffer(renderItem.uniformBuffer, 64, modelMatrix);
    device.queue.writeBuffer(renderItem.uniformBuffer, 128, new Float32Array(baseColor));
    device.queue.writeBuffer(renderItem.uniformBuffer, 144, new Float32Array([cameraPos[0], cameraPos[1], cameraPos[2], 1.0]));
    device.queue.writeBuffer(renderItem.uniformBuffer, 160, new Float32Array([0.6, 1.0, 0.5, 0.0]));
    device.queue.writeBuffer(renderItem.uniformBuffer, 176, new Float32Array([
        materialParams.ior,
        materialParams.iridescenceFactor,
        materialParams.iridescenceIor,
        materialParams.hasIridescenceMap
    ]));
    device.queue.writeBuffer(renderItem.uniformBuffer, 192, new Float32Array([
        materialParams.iridescenceThicknessMin,
        materialParams.iridescenceThicknessMax,
        materialParams.hasIridescenceThicknessMap,
        materialParams.envIntensity
    ]));
    device.queue.writeBuffer(renderItem.uniformBuffer, 208, new Float32Array([
        materialParams.envExposure,
        materialParams.envDiffuseStrength,
        materialParams.metallic,
        materialParams.roughness
    ]));
    device.queue.writeBuffer(renderItem.uniformBuffer, 224, new Float32Array([
        materialParams.hasEnvCube,
        materialParams.unlitTextureOnly,
        0.0,
        0.0
    ]));
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

async function loadMarblesFromGLTF() {
    const { gltf, buffers, baseUrl } = await loadGLTF(MARBLES_GLTF_URL);
    const textureViewCache = new Map();

    async function getTextureView(textureIndex) {
        if (textureViewCache.has(textureIndex)) {
            return textureViewCache.get(textureIndex);
        }

        const texDef = gltf.textures[textureIndex];
        const imgDef = gltf.images[texDef.source];
        const textureView = await loadTextureView(new URL(imgDef.uri, baseUrl).href);
        textureViewCache.set(textureIndex, textureView);
        return textureView;
    }

    const meshRecords = [];
    for (let m = 0; m < gltf.meshes.length; m++) {
        const meshDef = gltf.meshes[m];
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
            const mesh = createMesh(expanded);

            let textureView = whiteTextureView;
            let iridescenceTextureView = whiteTextureView;
            let iridescenceThicknessTextureView = whiteTextureView;
            let baseColor = [1, 1, 1, 1];
            let ior = 1.5;
            let iridescenceFactor = 0.0;
            let iridescenceIor = 1.3;
            let iridescenceThicknessMin = 100.0;
            let iridescenceThicknessMax = 400.0;
            let hasIridescenceMap = 0.0;
            let hasIridescenceThicknessMap = 0.0;
            let metallic = 1.0;
            let roughness = 0.2;
            if (primitive.material !== undefined) {
                const material = gltf.materials[primitive.material];
                if (material && material.pbrMetallicRoughness) {
                    const pbr = material.pbrMetallicRoughness;
                    if (pbr.baseColorFactor) {
                        baseColor = pbr.baseColorFactor;
                    }
                    if (pbr.metallicFactor !== undefined) metallic = pbr.metallicFactor;
                    if (pbr.roughnessFactor !== undefined) roughness = pbr.roughnessFactor;
                    if (pbr.baseColorTexture) {
                        textureView = await getTextureView(pbr.baseColorTexture.index);
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

            const renderItem = createRenderItem(
                textureView,
                iridescenceTextureView,
                iridescenceThicknessTextureView,
                envCubeTextureView || blackCubeTextureView
            );
            primitives.push({
                mesh,
                renderItem,
                baseColor,
                ior,
                iridescenceFactor,
                iridescenceIor,
                iridescenceThicknessMin,
                iridescenceThicknessMax,
                hasIridescenceMap,
                hasIridescenceThicknessMap,
                metallic,
                roughness
            });
        }

        meshRecords.push({ primitives, meshExtent });
    }

    const sphereNodes = gltf.nodes.filter(n => n.mesh !== undefined && n.name && n.name.indexOf('Sphere') === 0);
    const selectedNodes = sphereNodes.slice(0, MAX_MARBLES);

    const templates = selectedNodes.map((node) => {
        const meshRec = meshRecords[node.mesh];
        const scale = node.scale || [1, 1, 1];
        const maxScale = Math.max(scale[0], scale[1], scale[2]);
        const radius = Math.max(0.05, meshRec.meshExtent * 0.5 * maxScale * MARBLE_SCALE);

        return {
            primitives: meshRec.primitives,
            scale,
            radius
        };
    });

    return templates;
}

function resetBodyVelocity(body) {
    if (body.linearVelocity && body.linearVelocity.set) {
        body.linearVelocity.set(0, 0, 0);
    }
    if (body.angularVelocity && body.angularVelocity.set) {
        body.angularVelocity.set(0, 0, 0);
    }
}

function initPhysics(templates) {
    world = new OIMO.World({
        timestep: 1 / 60,
        iterations: 8,
        broadphase: 2,
        worldscale: 1,
        random: true,
        info: false,
        gravity: [0, -9.8, 0]
    });

    world.add({
        type: 'box',
        size: [80, 4, 80],
        pos: [0, -5, 0],
        rot: [0, 0, 0],
        move: false,
        density: 1,
        friction: 0.5,
        restitution: 0.2
    });

    marbles.length = 0;
    for (const template of templates) {
        const body = world.add({
            type: 'sphere',
            size: [template.radius * 2, template.radius * 2, template.radius * 2],
            pos: [rand(-5, 5), rand(8, 35), rand(-5, 5)],
            rot: [0, 0, 0],
            move: true,
            density: 1,
            friction: 0.1,
            restitution: 0.3
        });

        marbles.push({ body, primitives: template.primitives, scale: template.scale });
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

function drawMesh(pass, mesh, bindGroup) {
    pass.setVertexBuffer(0, mesh.positionBuffer);
    pass.setVertexBuffer(1, mesh.normalBuffer);
    pass.setVertexBuffer(2, mesh.uvBuffer);
    pass.setBindGroup(0, bindGroup);
    pass.draw(mesh.vertexCount, 1, 0, 0);
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

function render(timeMs) {
    world.step();

    const t = timeMs * 0.001;
    const eye = vec3.fromValues(Math.sin(t * 0.2) * 24, 10, Math.cos(t * 0.2) * 24);
    mat4.lookAt(view, eye, [0, 2, 0], [0, 1, 0]);
    mat4.perspective(projection, Math.PI / 4, canvas.width / canvas.height, 0.1, 200);
    mat4.multiply(viewProj, projection, view);

    const encoder = device.createCommandEncoder();
    drawSkybox(encoder);
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

    const groundModel = mat4.create();
    mat4.translate(groundModel, groundModel, [0, -3, 0]);
    mat4.scale(groundModel, groundModel, [80, 1, 80]);
    writeUniforms(groundRenderItem, groundModel, [0.9, 0.9, 0.9, 1.0], eye, {
        ior: 1.5,
        iridescenceFactor: 0.0,
        iridescenceIor: 1.3,
        hasIridescenceMap: 0.0,
        iridescenceThicknessMin: 100.0,
        iridescenceThicknessMax: 400.0,
        hasIridescenceThicknessMap: 0.0,
        envIntensity: 0.55,
        envExposure: 0.92,
        envDiffuseStrength: 0.18,
        metallic: 0.0,
        roughness: 1.0,
                hasEnvCube: 0.0,
        unlitTextureOnly: 1.0
    });
    drawMesh(pass, groundMesh, groundRenderItem.bindGroup);

    for (const marble of marbles) {
        const p = marble.body.getPosition();
        const q = marble.body.getQuaternion();
        const rotation = quat.fromValues(q.x, q.y, q.z, q.w);

        const model = mat4.create();
        mat4.fromRotationTranslation(model, rotation, [p.x, p.y, p.z]);
        mat4.scale(model, model, [
            MARBLE_SCALE * marble.scale[0],
            MARBLE_SCALE * marble.scale[1],
            MARBLE_SCALE * marble.scale[2]
        ]);

        for (const prim of marble.primitives) {
            writeUniforms(prim.renderItem, model, prim.baseColor, eye, {
                ior: prim.ior,
                iridescenceFactor: prim.iridescenceFactor,
                iridescenceIor: prim.iridescenceIor,
                hasIridescenceMap: prim.hasIridescenceMap,
                iridescenceThicknessMin: prim.iridescenceThicknessMin,
                iridescenceThicknessMax: prim.iridescenceThicknessMax,
                hasIridescenceThicknessMap: prim.hasIridescenceThicknessMap,
                envIntensity: 1.0,
                envExposure: 1.0,
                envDiffuseStrength: 1.0,
                metallic: prim.metallic,
                roughness: prim.roughness,
                hasEnvCube: envCubeTextureView ? 1.0 : 0.0,
                unlitTextureOnly: 0.0
            });
            drawMesh(pass, prim.mesh, prim.renderItem.bindGroup);
        }

        if (p.y < -20) {
            marble.body.resetPosition(rand(-5, 5), rand(12, 30), rand(-5, 5));
            resetBodyVelocity(marble.body);
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

    sampler = device.createSampler({
        addressModeU: 'repeat',
        addressModeV: 'repeat',
        magFilter: 'linear',
        minFilter: 'linear',
        mipmapFilter: 'linear'
    });

    whiteTextureView = createSolidTextureView(255, 255, 255, 255);
    blackCubeTextureView = createSolidCubeTextureView(0, 0, 0, 255);
    try {
        envCubeTextureView = await loadHDRAsCubeTextureView(ENV_HDR_URL, 192);
    } catch (e) {
        console.warn('HDR cube map load failed:', e);
        envCubeTextureView = null;
    }
    groundTextureView = await loadTextureView(GROUND_TEXTURE_FILE);

    const skyboxVs = device.createShaderModule({ code: document.getElementById('skybox-vs').textContent });
    const skyboxFs = device.createShaderModule({ code: document.getElementById('skybox-fs').textContent });
    skyboxPipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: {
            module: skyboxVs,
            entryPoint: 'main',
            buffers: [{ arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] }]
        },
        fragment: {
            module: skyboxFs,
            entryPoint: 'main',
            targets: [{ format }]
        },
        primitive: {
            topology: 'triangle-list',
            cullMode: 'none'
        },
        depthStencil: {
            format: 'depth24plus',
            depthWriteEnabled: false,
            depthCompare: 'less-equal'
        }
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

    groundMesh = createGroundMesh();
    groundRenderItem = createRenderItem(
        groundTextureView,
        whiteTextureView,
        whiteTextureView,
        envCubeTextureView || blackCubeTextureView
    );

    const templates = await loadMarblesFromGLTF();
    initPhysics(templates);

    requestAnimationFrame(render);

    document.addEventListener('click', () => {
        for (const marble of marbles) {
            if (marble.body.linearVelocity && marble.body.linearVelocity.set) {
                marble.body.linearVelocity.set(rand(-1, 1), rand(3, 6), rand(-1, 1));
            }
        }
    });
}

main().catch((err) => {
    console.error(err);
});
