const { mat4, vec3, quat } = glMatrix;

const MARBLES_GLTF_URL = 'https://cx20.github.io/gltf-test/tutorialModels/IridescenceMetallicSpheres/glTF/IridescenceMetallicSpheres.gltf';
const GROUND_TEXTURE_FILE = '../../../../assets/textures/grass.jpg';
const ENV_HDR_URL = 'https://cx20.github.io/gltf-test/textures/hdr/papermill.hdr';
const MARBLE_SCALE = 1.0;
const MAX_MARBLES = 120;
const IDENTITY_QUATERNION = [0, 0, 0, 1];

let canvas;
let gl;
let extUint;

let program;
let attribs;
let uniforms;
let skyboxProgram;
let skyboxAttribs;
let skyboxUniforms;
let skyboxVbo;

let HK;
let worldId;
const marbles = [];

const projection = mat4.create();
const view = mat4.create();
const viewProj = mat4.create();
const viewNoTranslation = mat4.create();

let groundMesh;
let groundTexture;
let envCubeTexture = null;

function rand(min, max) {
    return min + Math.random() * (max - min);
}

function isPowerOf2(value) {
    return (value & (value - 1)) === 0;
}

function createShader(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(shader));
    }
    return shader;
}

function createProgram(vsSource, fsSource) {
    const vs = createShader(gl.VERTEX_SHADER, vsSource);
    const fs = createShader(gl.FRAGMENT_SHADER, fsSource);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        throw new Error(gl.getProgramInfoLog(prog));
    }
    return prog;
}

function resize() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';
    gl.viewport(0, 0, canvas.width, canvas.height);
}

function requiresMipmap(minFilter) {
    return minFilter === gl.NEAREST_MIPMAP_NEAREST ||
        minFilter === gl.LINEAR_MIPMAP_NEAREST ||
        minFilter === gl.NEAREST_MIPMAP_LINEAR ||
        minFilter === gl.LINEAR_MIPMAP_LINEAR;
}

function loadTexture(url, options = {}) {
    const flipY = !!options.flipY;
    const sampler = options.sampler || null;

    return new Promise((resolve) => {
        const texture = gl.createTexture();
        const image = new Image();
        image.crossOrigin = 'anonymous';
        image.onload = () => {
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, flipY ? 1 : 0);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);

            const pot = isPowerOf2(image.width) && isPowerOf2(image.height);
            if (sampler) {
                const wrapS = sampler.wrapS !== undefined ? sampler.wrapS : gl.REPEAT;
                const wrapT = sampler.wrapT !== undefined ? sampler.wrapT : gl.REPEAT;
                const minFilter = sampler.minFilter !== undefined ? sampler.minFilter : gl.LINEAR_MIPMAP_LINEAR;
                const magFilter = sampler.magFilter !== undefined ? sampler.magFilter : gl.LINEAR;

                if (pot) {
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrapS);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrapT);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, minFilter);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, magFilter);
                    if (requiresMipmap(minFilter)) {
                        gl.generateMipmap(gl.TEXTURE_2D);
                    }
                } else {
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, magFilter);
                }
            } else {
                if (pot) {
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
                    gl.generateMipmap(gl.TEXTURE_2D);
                } else {
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
                }
            }
            resolve(texture);
        };
        image.src = url;
    });
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
                if (offset >= bytes.length) throw new Error('Unexpected HDR EOF in RLE.');
                const code = bytes[offset++];
                if (code > 128) {
                    const run = code - 128;
                    if (offset >= bytes.length) throw new Error('Unexpected HDR EOF in RLE run.');
                    const val = bytes[offset++];
                    for (let i = 0; i < run; i++) scanline[c * width + x++] = val;
                } else {
                    const run = code;
                    for (let i = 0; i < run; i++) {
                        if (offset >= bytes.length) throw new Error('Unexpected HDR EOF in RLE literal.');
                        scanline[c * width + x++] = bytes[offset++];
                    }
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
            } else {
                data[dst] = 0;
                data[dst + 1] = 0;
                data[dst + 2] = 0;
            }
        }
    }

    return { width, height, data };
}

async function loadHDRTexture(url) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error('Failed to fetch HDR: ' + response.status);
    }
    const buffer = await response.arrayBuffer();
    return parseHDR(buffer);
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

function directionForCubeFace(face, u, v) {
    if (face === gl.TEXTURE_CUBE_MAP_POSITIVE_X) return vec3.normalize(vec3.create(), vec3.fromValues(1, -v, -u));
    if (face === gl.TEXTURE_CUBE_MAP_NEGATIVE_X) return vec3.normalize(vec3.create(), vec3.fromValues(-1, -v, u));
    if (face === gl.TEXTURE_CUBE_MAP_POSITIVE_Y) return vec3.normalize(vec3.create(), vec3.fromValues(u, 1, v));
    if (face === gl.TEXTURE_CUBE_MAP_NEGATIVE_Y) return vec3.normalize(vec3.create(), vec3.fromValues(u, -1, -v));
    if (face === gl.TEXTURE_CUBE_MAP_POSITIVE_Z) return vec3.normalize(vec3.create(), vec3.fromValues(u, -v, 1));
    return vec3.normalize(vec3.create(), vec3.fromValues(-u, -v, -1));
}

function createCubemapFromHDR(hdr, size = 192) {
    const faces = [
        gl.TEXTURE_CUBE_MAP_POSITIVE_X,
        gl.TEXTURE_CUBE_MAP_NEGATIVE_X,
        gl.TEXTURE_CUBE_MAP_POSITIVE_Y,
        gl.TEXTURE_CUBE_MAP_NEGATIVE_Y,
        gl.TEXTURE_CUBE_MAP_POSITIVE_Z,
        gl.TEXTURE_CUBE_MAP_NEGATIVE_Z
    ];

    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, tex);

    for (const face of faces) {
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

        gl.texImage2D(face, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, faceData);
    }

    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    return tex;
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

function createMeshBuffers(positions, normals, uvs, indices) {
    const posBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

    const normalBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, normals, gl.STATIC_DRAW);

    const uvBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, uvs, gl.STATIC_DRAW);

    let indexBuffer = null;
    let indexCount = positions.length / 3;
    let indexType = gl.UNSIGNED_SHORT;

    if (indices) {
        indexBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
        indexCount = indices.length;

        if (indices instanceof Uint32Array) indexType = gl.UNSIGNED_INT;
        else if (indices instanceof Uint16Array) indexType = gl.UNSIGNED_SHORT;
        else indexType = gl.UNSIGNED_BYTE;
    }

    return { posBuffer, normalBuffer, uvBuffer, indexBuffer, indexCount, indexType, hasIndices: !!indices };
}

function bindMesh(mesh) {
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.posBuffer);
    gl.enableVertexAttribArray(attribs.position);
    gl.vertexAttribPointer(attribs.position, 3, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.normalBuffer);
    gl.enableVertexAttribArray(attribs.normal);
    gl.vertexAttribPointer(attribs.normal, 3, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.uvBuffer);
    gl.enableVertexAttribArray(attribs.uv);
    gl.vertexAttribPointer(attribs.uv, 2, gl.FLOAT, false, 0, 0);

    if (mesh.hasIndices) {
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.indexBuffer);
    }
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
        8, 0,
        8, 8,
        0, 0,
        8, 8,
        0, 8
    ]);
    return createMeshBuffers(positions, normals, uvs, null);
}

async function loadGLTF(url) {
    const response = await fetch(url);
    const gltf = await response.json();
    const baseUrl = url.substring(0, url.lastIndexOf('/') + 1);

    const buffers = [];
    for (const buf of gltf.buffers || []) {
        const bufferUrl = new URL(buf.uri, baseUrl).href;
        const data = await fetch(bufferUrl).then((r) => r.arrayBuffer());
        buffers.push(new Uint8Array(data));
    }

    return { gltf, buffers, baseUrl };
}

async function loadMarbleTemplates() {
    const { gltf, buffers, baseUrl } = await loadGLTF(MARBLES_GLTF_URL);

    const meshRecords = [];
    for (let m = 0; m < gltf.meshes.length; m++) {
        const meshDef = gltf.meshes[m];
        const primitives = [];
        let meshExtent = 0;

        for (const primitive of meshDef.primitives) {
            const attrs = primitive.attributes;
            const positions = getAccessorData(gltf, buffers, attrs.POSITION);
            let indices = null;
            if (primitive.indices !== undefined) {
                indices = getAccessorData(gltf, buffers, primitive.indices);
                if (indices instanceof Uint32Array && !extUint) {
                    throw new Error('OES_element_index_uint is required for uint32 index buffers.');
                }
            }

            const normals = attrs.NORMAL !== undefined
                ? getAccessorData(gltf, buffers, attrs.NORMAL)
                : computeFlatNormals(positions, indices);
            const uvs = attrs.TEXCOORD_0 !== undefined
                ? getAccessorData(gltf, buffers, attrs.TEXCOORD_0)
                : new Float32Array((positions.length / 3) * 2);

            const bbox = calculateBoundingBox(positions);
            meshExtent = Math.max(meshExtent, getMaxExtent(bbox));

            let texture = null;
            let baseColor = [1, 1, 1, 1];
            let ior = 1.5;
            let iridescenceFactor = 0.0;
            let iridescenceIor = 1.3;
            let iridescenceThicknessMin = 100.0;
            let iridescenceThicknessMax = 400.0;
            let iridescenceTexture = null;
            let iridescenceThicknessTexture = null;
            let metallic = 1.0;
            let roughness = 0.2;
            if (primitive.material !== undefined) {
                const material = gltf.materials[primitive.material];
                if (material && material.pbrMetallicRoughness) {
                    const pbr = material.pbrMetallicRoughness;
                    if (pbr.baseColorFactor) baseColor = pbr.baseColorFactor;
                    if (pbr.metallicFactor !== undefined) metallic = pbr.metallicFactor;
                    if (pbr.roughnessFactor !== undefined) roughness = pbr.roughnessFactor;
                    if (pbr.baseColorTexture) {
                        const textureDef = gltf.textures[pbr.baseColorTexture.index];
                        const imageDef = gltf.images[textureDef.source];
                        const samplerDef = textureDef.sampler !== undefined ? gltf.samplers[textureDef.sampler] : null;
                        texture = await loadTexture(new URL(imageDef.uri, baseUrl).href, {
                            flipY: false,
                            sampler: samplerDef
                        });
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
                        const irTexDef = gltf.textures[irExt.iridescenceTexture.index];
                        const irImgDef = gltf.images[irTexDef.source];
                        const irSamplerDef = irTexDef.sampler !== undefined ? gltf.samplers[irTexDef.sampler] : null;
                        iridescenceTexture = await loadTexture(new URL(irImgDef.uri, baseUrl).href, {
                            flipY: false,
                            sampler: irSamplerDef
                        });
                    }

                    if (irExt.iridescenceThicknessTexture !== undefined) {
                        const irThTexDef = gltf.textures[irExt.iridescenceThicknessTexture.index];
                        const irThImgDef = gltf.images[irThTexDef.source];
                        const irThSamplerDef = irThTexDef.sampler !== undefined ? gltf.samplers[irThTexDef.sampler] : null;
                        iridescenceThicknessTexture = await loadTexture(new URL(irThImgDef.uri, baseUrl).href, {
                            flipY: false,
                            sampler: irThSamplerDef
                        });
                    }
                }
            }

            const mesh = createMeshBuffers(positions, normals, uvs, indices);
            primitives.push({
                mesh,
                texture,
                baseColor,
                ior,
                iridescenceFactor,
                iridescenceIor,
                iridescenceThicknessMin,
                iridescenceThicknessMax,
                iridescenceTexture,
                iridescenceThicknessTexture,
                metallic,
                roughness
            });
        }

        meshRecords.push({ primitives, meshExtent });
    }

    const sphereNodes = gltf.nodes.filter((n) => n.mesh !== undefined && n.name && n.name.indexOf('Sphere') === 0);
    const selectedNodes = sphereNodes.slice(0, MAX_MARBLES);

    return selectedNodes.map((node) => {
        const meshRec = meshRecords[node.mesh];
        const nodeScale = node.scale || [1, 1, 1];
        const maxScale = Math.max(nodeScale[0], nodeScale[1], nodeScale[2]);
        const radius = Math.max(0.05, meshRec.meshExtent * 0.5 * maxScale * MARBLE_SCALE);

        return {
            primitives: meshRec.primitives,
            scale: nodeScale,
            radius
        };
    });
}

function resetBodyVelocity(body) {
    checkResult(HK.HP_Body_SetLinearVelocity(body, [0, 0, 0]), 'HP_Body_SetLinearVelocity');
    checkResult(HK.HP_Body_SetAngularVelocity(body, [0, 0, 0]), 'HP_Body_SetAngularVelocity');
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

function initPhysics(templates) {
    const world = HK.HP_World_Create();
    checkResult(world[0], 'HP_World_Create');
    worldId = world[1];

    checkResult(HK.HP_World_SetGravity(worldId, [0, -9.8, 0]), 'HP_World_SetGravity');
    checkResult(HK.HP_World_SetIdealStepTime(worldId, 1 / 60), 'HP_World_SetIdealStepTime');

    const groundShapeResult = HK.HP_Shape_CreateBox([0, 0, 0], IDENTITY_QUATERNION, [80, 4, 80]);
    checkResult(groundShapeResult[0], 'HP_Shape_CreateBox (ground)');
    const groundShapeId = groundShapeResult[1];

    createBody(groundShapeId, HK.MotionType.STATIC, [0, -5, 0], IDENTITY_QUATERNION, false);

    marbles.length = 0;
    for (const template of templates) {
        const sphereShapeResult = HK.HP_Shape_CreateSphere([0, 0, 0], template.radius);
        checkResult(sphereShapeResult[0], 'HP_Shape_CreateSphere (marble)');
        const sphereShapeId = sphereShapeResult[1];
        checkResult(HK.HP_Shape_SetDensity(sphereShapeId, 1), 'HP_Shape_SetDensity');

        const body = createBody(
            sphereShapeId,
            HK.MotionType.DYNAMIC,
            [rand(-5, 5), rand(8, 35), rand(-5, 5)],
            IDENTITY_QUATERNION,
            true
        );

        marbles.push({
            body,
            primitives: template.primitives,
            radius: template.radius,
            scale: template.scale
        });
    }
}

function drawGround() {
    const model = mat4.create();
    mat4.translate(model, model, [0, -3, 0]);
    mat4.scale(model, model, [80, 1, 80]);

    bindMesh(groundMesh);
    gl.uniformMatrix4fv(uniforms.model, false, model);
    gl.uniform4fv(uniforms.baseColor, [0.74, 0.88, 0.74, 1.0]);
    gl.uniform1f(uniforms.metallic, 0.0);
    gl.uniform1f(uniforms.roughness, 1.0);
    gl.uniform1f(uniforms.ior, 1.5);
    gl.uniform1f(uniforms.iridescenceFactor, 0.0);
    gl.uniform1f(uniforms.iridescenceIor, 1.3);
    gl.uniform1f(uniforms.iridescenceThicknessMin, 100.0);
    gl.uniform1f(uniforms.iridescenceThicknessMax, 400.0);
    gl.uniform1f(uniforms.envIntensity, 0.55);
    gl.uniform1f(uniforms.envExposure, 0.92);
    gl.uniform1f(uniforms.envDiffuseStrength, 0.18);
    gl.uniform1i(uniforms.unlitTextureOnly, 1);
    gl.uniform1i(uniforms.hasTexture, 1);
    gl.uniform1i(uniforms.hasIridescenceMap, 0);
    gl.uniform1i(uniforms.hasIridescenceThicknessMap, 0);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, groundTexture);
    gl.uniform1i(uniforms.texture, 0);

    gl.disable(gl.CULL_FACE);
    gl.drawArrays(gl.TRIANGLES, 0, groundMesh.indexCount);
    gl.enable(gl.CULL_FACE);
}

function drawMarbles() {
    gl.uniform1f(uniforms.envIntensity, 1.0);
    gl.uniform1f(uniforms.envExposure, 1.0);
    gl.uniform1f(uniforms.envDiffuseStrength, 1.0);
    gl.uniform1i(uniforms.unlitTextureOnly, 0);

    for (const marble of marbles) {
        const pResult = HK.HP_Body_GetPosition(marble.body);
        checkResult(pResult[0], 'HP_Body_GetPosition');
        const qResult = HK.HP_Body_GetOrientation(marble.body);
        checkResult(qResult[0], 'HP_Body_GetOrientation');

        const p = pResult[1];
        const q = qResult[1];
        const rotation = quat.fromValues(q[0], q[1], q[2], q[3]);

        const model = mat4.create();
        mat4.fromRotationTranslation(model, rotation, p);
        mat4.scale(model, model, [
            MARBLE_SCALE * marble.scale[0],
            MARBLE_SCALE * marble.scale[1],
            MARBLE_SCALE * marble.scale[2]
        ]);

        for (const prim of marble.primitives) {
            bindMesh(prim.mesh);
            gl.uniformMatrix4fv(uniforms.model, false, model);
            gl.uniform4fv(uniforms.baseColor, prim.baseColor);

            if (prim.texture) {
                gl.uniform1i(uniforms.hasTexture, 1);
                gl.activeTexture(gl.TEXTURE0);
                gl.bindTexture(gl.TEXTURE_2D, prim.texture);
                gl.uniform1i(uniforms.texture, 0);
            } else {
                gl.uniform1i(uniforms.hasTexture, 0);
            }

            gl.uniform1f(uniforms.ior, prim.ior);
            gl.uniform1f(uniforms.iridescenceFactor, prim.iridescenceFactor);
            gl.uniform1f(uniforms.iridescenceIor, prim.iridescenceIor);
            gl.uniform1f(uniforms.iridescenceThicknessMin, prim.iridescenceThicknessMin);
            gl.uniform1f(uniforms.iridescenceThicknessMax, prim.iridescenceThicknessMax);
            gl.uniform1f(uniforms.metallic, prim.metallic);
            gl.uniform1f(uniforms.roughness, prim.roughness);

            if (prim.iridescenceTexture) {
                gl.uniform1i(uniforms.hasIridescenceMap, 1);
                gl.activeTexture(gl.TEXTURE1);
                gl.bindTexture(gl.TEXTURE_2D, prim.iridescenceTexture);
                gl.uniform1i(uniforms.iridescenceMap, 1);
            } else {
                gl.uniform1i(uniforms.hasIridescenceMap, 0);
            }

            if (prim.iridescenceThicknessTexture) {
                gl.uniform1i(uniforms.hasIridescenceThicknessMap, 1);
                gl.activeTexture(gl.TEXTURE2);
                gl.bindTexture(gl.TEXTURE_2D, prim.iridescenceThicknessTexture);
                gl.uniform1i(uniforms.iridescenceThicknessMap, 2);
            } else {
                gl.uniform1i(uniforms.hasIridescenceThicknessMap, 0);
            }

            if (prim.mesh.hasIndices) {
                gl.drawElements(gl.TRIANGLES, prim.mesh.indexCount, prim.mesh.indexType, 0);
            } else {
                gl.drawArrays(gl.TRIANGLES, 0, prim.mesh.indexCount);
            }
        }

        if (p[1] < -20) {
            checkResult(HK.HP_Body_SetPosition(marble.body, [rand(-5, 5), rand(12, 30), rand(-5, 5)]), 'HP_Body_SetPosition reset');
            checkResult(HK.HP_Body_SetOrientation(marble.body, IDENTITY_QUATERNION), 'HP_Body_SetOrientation reset');
            resetBodyVelocity(marble.body);
        }
    }
}

function initSkybox() {
    const skyboxVs = document.getElementById('skybox-vs').textContent;
    const skyboxFs = document.getElementById('skybox-fs').textContent;
    skyboxProgram = createProgram(skyboxVs, skyboxFs);

    skyboxAttribs = {
        position: gl.getAttribLocation(skyboxProgram, 'aPosition')
    };

    skyboxUniforms = {
        projection: gl.getUniformLocation(skyboxProgram, 'uProjection'),
        viewNoTranslation: gl.getUniformLocation(skyboxProgram, 'uViewNoTranslation'),
        envCubeMap: gl.getUniformLocation(skyboxProgram, 'uEnvCubeMap'),
        envExposure: gl.getUniformLocation(skyboxProgram, 'uEnvExposure')
    };

    const cubeVerts = new Float32Array([
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

    skyboxVbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, skyboxVbo);
    gl.bufferData(gl.ARRAY_BUFFER, cubeVerts, gl.STATIC_DRAW);
}

function drawSkybox() {
    if (!envCubeTexture) return;

    mat4.copy(viewNoTranslation, view);
    viewNoTranslation[12] = 0;
    viewNoTranslation[13] = 0;
    viewNoTranslation[14] = 0;

    gl.depthMask(false);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.CULL_FACE);

    gl.useProgram(skyboxProgram);
    gl.uniformMatrix4fv(skyboxUniforms.projection, false, projection);
    gl.uniformMatrix4fv(skyboxUniforms.viewNoTranslation, false, viewNoTranslation);
    gl.uniform1f(skyboxUniforms.envExposure, 1.0);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, envCubeTexture);
    gl.uniform1i(skyboxUniforms.envCubeMap, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, skyboxVbo);
    gl.enableVertexAttribArray(skyboxAttribs.position);
    gl.vertexAttribPointer(skyboxAttribs.position, 3, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 36);

    gl.depthMask(true);
    gl.depthFunc(gl.LESS);
    gl.enable(gl.CULL_FACE);
}

function render(timeMs) {
    checkResult(HK.HP_World_Step(worldId, 1 / 60), 'HP_World_Step');

    const t = timeMs * 0.001;
    const eye = vec3.fromValues(Math.sin(t * 0.2) * 24, 10, Math.cos(t * 0.2) * 24);
    mat4.lookAt(view, eye, [0, 2, 0], [0, 1, 0]);
    mat4.perspective(projection, Math.PI / 4, canvas.width / canvas.height, 0.1, 200);
    mat4.multiply(viewProj, projection, view);

    gl.clearColor(0.12, 0.12, 0.14, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    drawSkybox();

    gl.useProgram(program);
    gl.uniformMatrix4fv(uniforms.viewProj, false, viewProj);
    gl.uniform3fv(uniforms.lightDir, [0.6, 1.0, 0.5]);
    gl.uniform3fv(uniforms.cameraPos, eye);

    if (envCubeTexture) {
        gl.uniform1i(uniforms.hasEnvCubeMap, 1);
        gl.activeTexture(gl.TEXTURE3);
        gl.bindTexture(gl.TEXTURE_CUBE_MAP, envCubeTexture);
        gl.uniform1i(uniforms.envCubeMap, 3);
        gl.uniform1f(uniforms.envIntensity, 1.0);
        gl.uniform1f(uniforms.envExposure, 1.0);
    } else {
        gl.uniform1i(uniforms.hasEnvCubeMap, 0);
        gl.uniform1f(uniforms.envIntensity, 0.0);
        gl.uniform1f(uniforms.envExposure, 1.0);
    }

    drawGround();
    drawMarbles();

    requestAnimationFrame(render);
}

async function main() {
    canvas = document.getElementById('c');
    gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!gl) {
        throw new Error('WebGL 1.0 is not supported in this browser.');
    }

    extUint = gl.getExtension('OES_element_index_uint');

    const vsSource = document.getElementById('vs').textContent;
    const fsSource = document.getElementById('fs').textContent;
    program = createProgram(vsSource, fsSource);

    attribs = {
        position: gl.getAttribLocation(program, 'aPosition'),
        normal: gl.getAttribLocation(program, 'aNormal'),
        uv: gl.getAttribLocation(program, 'aTexCoord')
    };

    uniforms = {
        viewProj: gl.getUniformLocation(program, 'uViewProj'),
        model: gl.getUniformLocation(program, 'uModel'),
        texture: gl.getUniformLocation(program, 'uTexture'),
        iridescenceMap: gl.getUniformLocation(program, 'uIridescenceMap'),
        iridescenceThicknessMap: gl.getUniformLocation(program, 'uIridescenceThicknessMap'),
        envCubeMap: gl.getUniformLocation(program, 'uEnvCubeMap'),
        hasTexture: gl.getUniformLocation(program, 'uHasTexture'),
        hasIridescenceMap: gl.getUniformLocation(program, 'uHasIridescenceMap'),
        hasIridescenceThicknessMap: gl.getUniformLocation(program, 'uHasIridescenceThicknessMap'),
        hasEnvCubeMap: gl.getUniformLocation(program, 'uHasEnvCubeMap'),
        unlitTextureOnly: gl.getUniformLocation(program, 'uUnlitTextureOnly'),
        baseColor: gl.getUniformLocation(program, 'uBaseColor'),
        lightDir: gl.getUniformLocation(program, 'uLightDir'),
        cameraPos: gl.getUniformLocation(program, 'uCameraPos'),
        ior: gl.getUniformLocation(program, 'uIor'),
        iridescenceFactor: gl.getUniformLocation(program, 'uIridescenceFactor'),
        iridescenceIor: gl.getUniformLocation(program, 'uIridescenceIor'),
        iridescenceThicknessMin: gl.getUniformLocation(program, 'uIridescenceThicknessMin'),
        iridescenceThicknessMax: gl.getUniformLocation(program, 'uIridescenceThicknessMax'),
        envIntensity: gl.getUniformLocation(program, 'uEnvIntensity'),
        envExposure: gl.getUniformLocation(program, 'uEnvExposure'),
        envDiffuseStrength: gl.getUniformLocation(program, 'uEnvDiffuseStrength'),
        metallic: gl.getUniformLocation(program, 'uMetallic'),
        roughness: gl.getUniformLocation(program, 'uRoughness')
    };

    resize();
    window.addEventListener('resize', resize);

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    HK = await HavokPhysics();
    initSkybox();

    groundMesh = createGroundMesh();
    groundTexture = await loadTexture(GROUND_TEXTURE_FILE, { flipY: true });
    try {
        const hdr = await loadHDRTexture(ENV_HDR_URL);
        envCubeTexture = createCubemapFromHDR(hdr, 192);
    } catch (e) {
        console.warn('HDR environment map load failed:', e);
        envCubeTexture = null;
    }

    const templates = await loadMarbleTemplates();
    initPhysics(templates);

    requestAnimationFrame(render);

    document.addEventListener('click', () => {
        for (const marble of marbles) {
            checkResult(
                HK.HP_Body_SetLinearVelocity(marble.body, [rand(-1, 1), rand(3, 6), rand(-1, 1)]),
                'HP_Body_SetLinearVelocity'
            );
        }
    });
}

main().catch((err) => {
    console.error(err);
});
