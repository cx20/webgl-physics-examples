const HAVOK_WASM_URL = 'https://cx20.github.io/gltf-test/libs/babylonjs/dev/HavokPhysics.wasm';
const { mat4, vec3, quat } = glMatrix;

const DUCK_GLTF_URL = 'https://cx20.github.io/gltf-test/sampleModels/Duck/glTF/Duck.gltf';
const ENV_HDR_URL = 'https://cx20.github.io/gltf-test/textures/hdr/papermill.hdr';
const TEXTURE_FLOOR = '../../../../assets/textures/grass.jpg';
const TEXTURE_COIN_NORMAL = '../../../../assets/textures/rockn.png';

const PHYSICS_SCALE = 0.1;
const COIN_INTERVAL = 6;
const MAX_COINS = 6000;
const GROUND_Y = -10;
const IDENTITY_QUATERNION = [0, 0, 0, 1];

const COIN_TYPES = {
    GOLD:   { color: [1.000, 0.766, 0.336], height: 0.10,  diameter: 1.0, metallic: 1.0, roughness: 0.20 },
    SILVER: { color: [0.972, 0.960, 0.915], height: 0.075, diameter: 0.8, metallic: 1.0, roughness: 0.40 },
    COPPER: { color: [0.955, 0.637, 0.538], height: 0.05,  diameter: 0.6, metallic: 1.0, roughness: 0.20 },
};
const COIN_TYPE_NAMES = ['GOLD', 'SILVER', 'COPPER'];

let canvas;
let gl;
let program;
let attribs;
let uniforms;

let lineProgram;
let lineAttribs;
let lineUniforms;
let showWireframe = true;

let skyboxProgram;
let skyboxAttribs;
let skyboxUniforms;
let skyboxBuffer;

let cylinderMesh;
let groundMesh;
let debugBoxMesh;
let debugSphereMesh;

let groundTexture;
let whiteTexture;
let flatNormalTexture;
let coinNormalTexture;
let envCubeTexture = null;
let blackCubeTexture;

let HK;
let worldId;
const coins = [];

const projection = mat4.create();
const view = mat4.create();
const viewProj = mat4.create();
const viewNoTranslation = mat4.create();
const tmpModel = mat4.create();
const tmpQuat = quat.create();

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

function resize() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';
    gl.viewport(0, 0, canvas.width, canvas.height);
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

function createBuffer(target, data) {
    const buf = gl.createBuffer();
    gl.bindBuffer(target, buf);
    gl.bufferData(target, data, gl.STATIC_DRAW);
    return buf;
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
        positionBuffer: createBuffer(gl.ARRAY_BUFFER, new Float32Array(positions)),
        normalBuffer: createBuffer(gl.ARRAY_BUFFER, new Float32Array(normals)),
        uvBuffer: createBuffer(gl.ARRAY_BUFFER, new Float32Array(uvs)),
        indexBuffer: createBuffer(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices)),
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
        positionBuffer: createBuffer(gl.ARRAY_BUFFER, positions),
        normalBuffer: createBuffer(gl.ARRAY_BUFFER, normals),
        uvBuffer: createBuffer(gl.ARRAY_BUFFER, uvs),
        vertexCount: 6,
    };
}

function createDebugSphereMesh(segments) {
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
        positionBuffer: createBuffer(gl.ARRAY_BUFFER, new Float32Array(positions)),
        indexBuffer: createBuffer(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices)),
        indexCount: indices.length,
    };
}

function createDebugBoxMesh() {
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
        positionBuffer: createBuffer(gl.ARRAY_BUFFER, positions),
        indexBuffer: createBuffer(gl.ELEMENT_ARRAY_BUFFER, indices),
        indexCount: indices.length,
    };
}

function isPowerOf2(value) {
    return (value & (value - 1)) === 0;
}

function loadTexture(url) {
    return new Promise((resolve) => {
        const texture = gl.createTexture();
        const image = new Image();
        image.crossOrigin = 'anonymous';
        image.onload = () => {
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
            if (isPowerOf2(image.width) && isPowerOf2(image.height)) {
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
                gl.generateMipmap(gl.TEXTURE_2D);
            } else {
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            }
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            resolve(texture);
        };
        image.src = url;
    });
}

function createSolidTexture(r, g, b, a) {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([r, g, b, a]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    return texture;
}

const CUBE_FACE_TARGETS = () => [
    gl.TEXTURE_CUBE_MAP_POSITIVE_X, gl.TEXTURE_CUBE_MAP_NEGATIVE_X,
    gl.TEXTURE_CUBE_MAP_POSITIVE_Y, gl.TEXTURE_CUBE_MAP_NEGATIVE_Y,
    gl.TEXTURE_CUBE_MAP_POSITIVE_Z, gl.TEXTURE_CUBE_MAP_NEGATIVE_Z,
];

function createSolidCubeTexture(r, g, b, a) {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, texture);
    const pixel = new Uint8Array([r, g, b, a]);
    for (const target of CUBE_FACE_TARGETS()) {
        gl.texImage2D(target, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    }
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
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
    const c0r = hdr.data[i00]     * (1 - tx) + hdr.data[i10]     * tx;
    const c0g = hdr.data[i00 + 1] * (1 - tx) + hdr.data[i10 + 1] * tx;
    const c0b = hdr.data[i00 + 2] * (1 - tx) + hdr.data[i10 + 2] * tx;
    const c1r = hdr.data[i01]     * (1 - tx) + hdr.data[i11]     * tx;
    const c1g = hdr.data[i01 + 1] * (1 - tx) + hdr.data[i11 + 1] * tx;
    const c1b = hdr.data[i01 + 2] * (1 - tx) + hdr.data[i11 + 2] * tx;
    return [
        c0r * (1 - ty) + c1r * ty,
        c0g * (1 - ty) + c1g * ty,
        c0b * (1 - ty) + c1b * ty,
    ];
}

function directionForCubeFace(faceIndex, u, v) {
    let x, y, z;
    if (faceIndex === 0) { x =  1; y = -v; z = -u; }
    else if (faceIndex === 1) { x = -1; y = -v; z =  u; }
    else if (faceIndex === 2) { x =  u; y =  1; z =  v; }
    else if (faceIndex === 3) { x =  u; y = -1; z = -v; }
    else if (faceIndex === 4) { x =  u; y = -v; z =  1; }
    else { x = -u; y = -v; z = -1; }
    const len = Math.hypot(x, y, z);
    return [x / len, y / len, z / len];
}

async function loadHDRAsCubeTexture(url, size = 192) {
    const response = await fetch(url);
    if (!response.ok) throw new Error('HDR fetch failed: ' + response.status);
    const buffer = await response.arrayBuffer();
    const hdr = parseHDR(buffer);

    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, texture);
    const targets = CUBE_FACE_TARGETS();
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
        gl.texImage2D(targets[face], 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, faceData);
    }
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
}

const SKYBOX_VERTS = new Float32Array([
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
    return { gltf, buffers };
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

function resetBodyVelocity(body) {
    checkResult(HK.HP_Body_SetLinearVelocity(body, [0, 0, 0]), 'HP_Body_SetLinearVelocity');
    checkResult(HK.HP_Body_SetAngularVelocity(body, [0, 0, 0]), 'HP_Body_SetAngularVelocity');
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

        coins.push({ body, typeName, params, radius });
    }
}

function bindMesh(mesh) {
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.positionBuffer);
    gl.vertexAttribPointer(attribs.position, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(attribs.position);

    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.normalBuffer);
    gl.vertexAttribPointer(attribs.normal, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(attribs.normal);

    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.uvBuffer);
    gl.vertexAttribPointer(attribs.uv, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(attribs.uv);
}

function drawCoin(coin) {
    bindMesh(cylinderMesh);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, cylinderMesh.indexBuffer);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, whiteTexture);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, coinNormalTexture);
    gl.uniformMatrix4fv(uniforms.model, false, tmpModel);
    gl.uniform3fv(uniforms.tint, coin.params.color);
    gl.uniform1f(uniforms.metallic, coin.params.metallic);
    gl.uniform1f(uniforms.roughness, coin.params.roughness);
    gl.uniform1f(uniforms.bumpStrength, 0.0);
    gl.uniform1f(uniforms.normalMapStrength, 1.0);
    gl.uniform1f(uniforms.unlit, 0.0);
    gl.uniform1f(uniforms.hasEnvCube, envCubeTexture ? 1.0 : 0.0);
    gl.uniform1f(uniforms.envIntensity, 1.0);
    gl.uniform1f(uniforms.envExposure, 1.0);
    gl.uniform1f(uniforms.envDiffuseStrength, 1.0);
    gl.drawElements(gl.TRIANGLES, cylinderMesh.indexCount, gl.UNSIGNED_SHORT, 0);
}

function drawGround() {
    bindMesh(groundMesh);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, groundTexture);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, flatNormalTexture);
    gl.uniformMatrix4fv(uniforms.model, false, tmpModel);
    gl.uniform3fv(uniforms.tint, [1.0, 1.0, 1.0]);
    gl.uniform1f(uniforms.metallic, 0.0);
    gl.uniform1f(uniforms.roughness, 1.0);
    gl.uniform1f(uniforms.bumpStrength, 1.0);
    gl.uniform1f(uniforms.normalMapStrength, 0.0);
    gl.uniform1f(uniforms.unlit, 1.0);
    gl.uniform1f(uniforms.hasEnvCube, 0.0);
    gl.uniform1f(uniforms.envIntensity, 0.0);
    gl.uniform1f(uniforms.envExposure, 1.0);
    gl.uniform1f(uniforms.envDiffuseStrength, 0.0);
    gl.drawArrays(gl.TRIANGLES, 0, groundMesh.vertexCount);
}

function drawSkybox() {
    if (!envCubeTexture) return;
    gl.useProgram(skyboxProgram);

    mat4.copy(viewNoTranslation, view);
    viewNoTranslation[12] = 0;
    viewNoTranslation[13] = 0;
    viewNoTranslation[14] = 0;

    gl.uniformMatrix4fv(skyboxUniforms.projection, false, projection);
    gl.uniformMatrix4fv(skyboxUniforms.viewNoTranslation, false, viewNoTranslation);
    gl.uniform1f(skyboxUniforms.exposure, 1.0);

    gl.bindBuffer(gl.ARRAY_BUFFER, skyboxBuffer);
    gl.vertexAttribPointer(skyboxAttribs.position, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(skyboxAttribs.position);

    gl.depthMask(false);
    gl.disable(gl.DEPTH_TEST);
    gl.drawArrays(gl.TRIANGLES, 0, 36);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
}

function drawWireframe() {
    gl.useProgram(lineProgram);
    gl.uniformMatrix4fv(lineUniforms.viewProj, false, viewProj);

    gl.bindBuffer(gl.ARRAY_BUFFER, debugBoxMesh.positionBuffer);
    gl.vertexAttribPointer(lineAttribs.position, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(lineAttribs.position);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, debugBoxMesh.indexBuffer);

    mat4.fromRotationTranslationScale(tmpModel, IDENTITY_QUATERNION, [0, GROUND_Y - 0.5, 0], [20, 1, 20]);
    gl.uniformMatrix4fv(lineUniforms.model, false, tmpModel);
    gl.uniform4fv(lineUniforms.color, [0.0, 1.0, 0.0, 1.0]);
    gl.drawElements(gl.LINES, debugBoxMesh.indexCount, gl.UNSIGNED_SHORT, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, debugSphereMesh.positionBuffer);
    gl.vertexAttribPointer(lineAttribs.position, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, debugSphereMesh.indexBuffer);
    gl.uniform4fv(lineUniforms.color, [1.0, 1.0, 0.0, 1.0]);

    for (const coin of coins) {
        const posR = HK.HP_Body_GetPosition(coin.body);
        checkResult(posR[0], 'HP_Body_GetPosition debug');
        const r = coin.radius;
        mat4.fromRotationTranslationScale(tmpModel, IDENTITY_QUATERNION, posR[1], [r, r, r]);
        gl.uniformMatrix4fv(lineUniforms.model, false, tmpModel);
        gl.drawElements(gl.LINES, debugSphereMesh.indexCount, gl.UNSIGNED_SHORT, 0);
    }
}

function render(timeMs) {
    checkResult(HK.HP_World_Step(worldId, 1 / 60), 'HP_World_Step');

    const t = timeMs * 0.001;
    const eye = vec3.fromValues(Math.sin(t * 0.15) * 21, -2.2, Math.cos(t * 0.15) * 21);
    mat4.lookAt(view, eye, [0, -7, 0], [0, 1, 0]);
    mat4.perspective(projection, Math.PI / 4, canvas.width / Math.max(1, canvas.height), 0.1, 200);
    mat4.multiply(viewProj, projection, view);

    gl.clearColor(0.12, 0.12, 0.14, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    drawSkybox();

    gl.useProgram(program);
    gl.uniformMatrix4fv(uniforms.viewProj, false, viewProj);
    gl.uniform3f(uniforms.lightDir, 0.6, 1.0, 0.5);
    gl.uniform3fv(uniforms.cameraPos, eye);

    mat4.identity(tmpModel);
    mat4.translate(tmpModel, tmpModel, [0, GROUND_Y, 0]);
    mat4.scale(tmpModel, tmpModel, [20, 1, 20]);
    drawGround();

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
        drawCoin(coin);
    }

    if (showWireframe) drawWireframe();

    requestAnimationFrame(render);
}

async function main() {
    canvas = document.getElementById('c');
    gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!gl) throw new Error('WebGL 1.0 is not supported.');
    if (!gl.getExtension('OES_standard_derivatives')) {
        throw new Error('OES_standard_derivatives extension is required.');
    }

    resize();
    window.addEventListener('resize', resize);

    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);

    program = createProgram(
        document.getElementById('vs').textContent,
        document.getElementById('fs').textContent
    );
    gl.useProgram(program);

    attribs = {
        position: gl.getAttribLocation(program, 'aPosition'),
        normal:   gl.getAttribLocation(program, 'aNormal'),
        uv:       gl.getAttribLocation(program, 'aTexCoord')
    };
    uniforms = {
        viewProj:           gl.getUniformLocation(program, 'uViewProj'),
        model:              gl.getUniformLocation(program, 'uModel'),
        texture:            gl.getUniformLocation(program, 'uTexture'),
        normalMap:          gl.getUniformLocation(program, 'uNormalMap'),
        envCube:            gl.getUniformLocation(program, 'uEnvCube'),
        tint:               gl.getUniformLocation(program, 'uTint'),
        lightDir:           gl.getUniformLocation(program, 'uLightDir'),
        cameraPos:          gl.getUniformLocation(program, 'uCameraPos'),
        metallic:           gl.getUniformLocation(program, 'uMetallic'),
        roughness:          gl.getUniformLocation(program, 'uRoughness'),
        bumpStrength:       gl.getUniformLocation(program, 'uBumpStrength'),
        normalMapStrength:  gl.getUniformLocation(program, 'uNormalMapStrength'),
        unlit:              gl.getUniformLocation(program, 'uUnlit'),
        hasEnvCube:         gl.getUniformLocation(program, 'uHasEnvCube'),
        envIntensity:       gl.getUniformLocation(program, 'uEnvIntensity'),
        envExposure:        gl.getUniformLocation(program, 'uEnvExposure'),
        envDiffuseStrength: gl.getUniformLocation(program, 'uEnvDiffuseStrength'),
    };
    gl.uniform1i(uniforms.texture, 0);
    gl.uniform1i(uniforms.normalMap, 1);
    gl.uniform1i(uniforms.envCube, 2);

    skyboxProgram = createProgram(
        document.getElementById('vs-sky').textContent,
        document.getElementById('fs-sky').textContent
    );
    skyboxAttribs = { position: gl.getAttribLocation(skyboxProgram, 'aPosition') };
    skyboxUniforms = {
        projection:        gl.getUniformLocation(skyboxProgram, 'uProjection'),
        viewNoTranslation: gl.getUniformLocation(skyboxProgram, 'uViewNoTranslation'),
        envCube:           gl.getUniformLocation(skyboxProgram, 'uEnvCube'),
        exposure:          gl.getUniformLocation(skyboxProgram, 'uExposure'),
    };
    gl.useProgram(skyboxProgram);
    gl.uniform1i(skyboxUniforms.envCube, 2);
    skyboxBuffer = createBuffer(gl.ARRAY_BUFFER, SKYBOX_VERTS);
    gl.useProgram(program);

    lineProgram = createProgram(
        document.getElementById('vs-line').textContent,
        document.getElementById('fs-line').textContent
    );
    lineAttribs = { position: gl.getAttribLocation(lineProgram, 'aPosition') };
    lineUniforms = {
        viewProj: gl.getUniformLocation(lineProgram, 'uViewProj'),
        model:    gl.getUniformLocation(lineProgram, 'uModel'),
        color:    gl.getUniformLocation(lineProgram, 'uColor'),
    };

    window.addEventListener('keydown', event => {
        const isWKey = event.code === 'KeyW' || event.key === 'w' || event.key === 'W';
        if (!isWKey || event.repeat) return;
        showWireframe = !showWireframe;
        const hint = document.getElementById('hint');
        if (hint) hint.textContent = 'W: wireframe ' + (showWireframe ? 'ON' : 'OFF');
    });

    cylinderMesh = createCylinderMesh(32);
    groundMesh = createGroundMesh();
    debugBoxMesh = createDebugBoxMesh();
    debugSphereMesh = createDebugSphereMesh(32);

    whiteTexture = createSolidTexture(255, 255, 255, 255);
    flatNormalTexture = createSolidTexture(128, 128, 255, 255);
    blackCubeTexture = createSolidCubeTexture(0, 0, 0, 255);
    groundTexture = await loadTexture(TEXTURE_FLOOR);
    coinNormalTexture = await loadTexture(TEXTURE_COIN_NORMAL);

    try {
        envCubeTexture = await loadHDRAsCubeTexture(ENV_HDR_URL, 192);
    } catch (e) {
        console.warn('HDR cube map load failed:', e);
        envCubeTexture = null;
    }
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, envCubeTexture || blackCubeTexture);

    HK = await HavokPhysics({
        locateFile: function (path) {
            if (path && path.endsWith('.wasm')) return HAVOK_WASM_URL;
            return path;
        }
    });

    const coinPositions = await loadDuckCoinPositions();
    initPhysics(coinPositions);
    console.log('Total coins:', coins.length);

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
