'use strict';

const computeShaderWGSL = document.getElementById('cs').textContent;
const vertexShaderWGSL = document.getElementById('vs').textContent;
const fragmentShaderWGSL = document.getElementById('fs').textContent;
const wireVertexShaderWGSL = document.getElementById('wvs').textContent;
const wireFragmentShaderWGSL = document.getElementById('wfs').textContent;

const canvas = document.getElementById('c');

const ENV_HDR_URL = 'https://cx20.github.io/gltf-test/textures/hdr/papermill.hdr';
const MAX_COINS = 300;
const STATIC_COUNT = 1;
const STATE_FLOATS = 16;
const INFO_FLOATS = 12;
const STATIC_FLOATS = 12;
const SUBSTEPS = 4;
const GROUND_Y = -10.0;
const SPAWN_RANGE = 15.0;
const TEXTURE_FILES = [
    '../../../../assets/textures/floor_bump.png',
    '../../../../assets/textures/rockn.png',
];
const COIN_TYPES = [
    { color: [1.000, 0.766, 0.336, 1], texture: 0, radius: 0.8, halfHeight: 0.075, restitution: 0.28, friction: 0.84, metallic: 1.0, roughness: 0.2 },
    { color: [0.972, 0.960, 0.915, 1], texture: 1, radius: 0.76, halfHeight: 0.071, restitution: 0.24, friction: 0.82, metallic: 1.0, roughness: 0.4 },
    { color: [0.955, 0.637, 0.538, 1], texture: 1, radius: 0.72, halfHeight: 0.067, restitution: 0.26, friction: 0.83, metallic: 1.0, roughness: 0.2 },
];

let device, context, format, depthTexture;
let renderPipeline, computePipeline, skyboxPipeline, wirePipeline;
let cylinderMesh, cubeMesh, wireBoxMesh;
let cameraBuffer, coinInfoBuffer, staticBuffer, simParamsBuffer, skyboxUniformBuffer;
let sampler, textureView, environmentTextureView;
let skyboxBindGroup, skyboxVertexBuffer;
let stateBuffers = [];
let renderBindGroups = [];
let wireBindGroups = [];
let computeBindGroups = [];
let currentState = 0;
let coinCount = 0;
let lastTime = -1;
let showWireframe = false;

const projectionMatrix = new Float32Array(16);
const viewMatrix = new Float32Array(16);
const viewNoTranslationMatrix = new Float32Array(16);
const viewProjectionMatrix = new Float32Array(16);

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

function createCylinderGeometry(segments = 32) {
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
        const topA = topStart + i;
        const topB = topStart + next;
        const bottomA = bottomStart + i;
        const bottomB = bottomStart + next;
        indices.push(topCenter, topB, topA, bottomCenter, bottomA, bottomB);
    }
    return createMesh(new Float32Array(positions), new Float32Array(normals), new Float32Array(uvs), new Uint16Array(indices));
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
    const uvs = new Float32Array(48);
    const indices = new Uint16Array([
         0, 1, 2,  0, 2, 3,   4, 5, 6,  4, 6, 7,
         8, 9,10,  8,10,11,  12,13,14, 12,14,15,
        16,17,18, 16,18,19,  20,21,22, 20,22,23,
    ]);
    return createMesh(positions, normals, uvs, indices);
}

function createWireBoxGeometry() {
    const corners = [
        [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
        [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
    ];
    const edges = [
        0, 1, 1, 2, 2, 3, 3, 0,
        4, 5, 5, 6, 6, 7, 7, 4,
        0, 4, 1, 5, 2, 6, 3, 7,
    ];
    const positions = [];
    for (let i = 0; i < edges.length; i++) {
        positions.push(...corners[edges[i]]);
    }
    return {
        positionBuffer: createVertexBuffer(new Float32Array(positions)),
        vertexCount: positions.length / 3,
    };
}

function createMesh(positions, normals, uvs, indices) {
    return {
        positionBuffer: createVertexBuffer(positions),
        normalBuffer: createVertexBuffer(normals),
        uvBuffer: createVertexBuffer(uvs),
        indexBuffer: createIndexBuffer(indices),
        indexCount: indices.length,
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

async function loadImage(src) {
    const img = document.createElement('img');
    img.src = src;
    await img.decode();
    return img;
}

async function createTextureAtlas() {
    const cell = 256;
    const images = await Promise.all(TEXTURE_FILES.map(loadImage));
    const atlas = document.createElement('canvas');
    atlas.width = cell * images.length;
    atlas.height = cell;
    const ctx = atlas.getContext('2d');
    for (let i = 0; i < images.length; i++) {
        ctx.drawImage(images[i], i * cell, 0, cell, cell);
    }
    const tex = device.createTexture({
        size: [atlas.width, atlas.height, 1],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    device.queue.copyExternalImageToTexture({ source: atlas }, { texture: tex }, [atlas.width, atlas.height]);
    return tex;
}

function createEnvironmentCubeMap() {
    const size = 64;
    const texture = device.createTexture({
        size: [size, size, 6],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    const faceColors = [
        [[252, 230, 168], [76, 118, 172]],
        [[176, 206, 240], [56, 82, 128]],
        [[255, 238, 188], [118, 159, 205]],
        [[92, 94, 98], [26, 27, 30]],
        [[226, 210, 178], [86, 112, 156]],
        [[178, 199, 224], [44, 58, 88]],
    ];
    for (let face = 0; face < 6; face++) {
        const data = new Uint8Array(size * size * 4);
        const [bottom, top] = faceColors[face];
        for (let y = 0; y < size; y++) {
            const vertical = y / (size - 1);
            for (let x = 0; x < size; x++) {
                const horizontal = x / (size - 1);
                const highlight = Math.max(0, 1 - Math.hypot(horizontal - 0.32, vertical - 0.28) * 2.2);
                const offset = (y * size + x) * 4;
                data[offset + 0] = Math.min(255, bottom[0] * (1 - vertical) + top[0] * vertical + highlight * 42);
                data[offset + 1] = Math.min(255, bottom[1] * (1 - vertical) + top[1] * vertical + highlight * 34);
                data[offset + 2] = Math.min(255, bottom[2] * (1 - vertical) + top[2] * vertical + highlight * 22);
                data[offset + 3] = 255;
            }
        }
        device.queue.writeTexture(
            { texture, origin: [0, 0, face] },
            data,
            { bytesPerRow: size * 4, rowsPerImage: size },
            { width: size, height: size, depthOrArrayLayers: 1 },
        );
    }
    return texture;
}

function parseHDR(buffer) {
    const bytes = new Uint8Array(buffer);
    let offset = 0;
    function readLine() {
        let line = '';
        while (offset < bytes.length) {
            const code = bytes[offset++];
            if (code === 10) break;
            if (code !== 13) line += String.fromCharCode(code);
        }
        return line;
    }

    let line = readLine();
    if (!line.startsWith('#?RADIANCE') && !line.startsWith('#?RGBE')) throw new Error('Invalid HDR header.');
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
        if (b0 !== 2 || b1 !== 2 || (b2 & 0x80) !== 0 || ((b2 << 8) | b3) !== width) throw new Error('Unsupported non-RLE HDR scanline.');
        for (let channel = 0; channel < 4; channel++) {
            let x = 0;
            while (x < width) {
                const code = bytes[offset++];
                if (code > 128) {
                    const run = code - 128;
                    const value = bytes[offset++];
                    for (let i = 0; i < run; i++) scanline[channel * width + x++] = value;
                } else {
                    for (let i = 0; i < code; i++) scanline[channel * width + x++] = bytes[offset++];
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
                const factor = Math.pow(2.0, e - 136.0);
                data[dst] = r * factor;
                data[dst + 1] = g * factor;
                data[dst + 2] = b * factor;
            }
        }
    }
    return { width, height, data };
}

function sampleEquirectHDR(hdr, u, v) {
    const wrappedU = ((u % 1) + 1) % 1;
    const clampedV = Math.min(Math.max(v, 0), 1);
    const x = wrappedU * (hdr.width - 1);
    const y = clampedV * (hdr.height - 1);
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = (x0 + 1) % hdr.width;
    const y1 = Math.min(y0 + 1, hdr.height - 1);
    const tx = x - x0;
    const ty = y - y0;
    const sample = (sx, sy, c) => hdr.data[(sy * hdr.width + sx) * 3 + c];
    const out = [0, 0, 0];
    for (let c = 0; c < 3; c++) {
        const top = sample(x0, y0, c) * (1 - tx) + sample(x1, y0, c) * tx;
        const bottom = sample(x0, y1, c) * (1 - tx) + sample(x1, y1, c) * tx;
        out[c] = top * (1 - ty) + bottom * ty;
    }
    return out;
}

function normalize3(v) {
    const length = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / length, v[1] / length, v[2] / length];
}

function randomFromIndex(index) {
    const value = Math.sin((index + 1) * 12.9898) * 43758.5453;
    return value - Math.floor(value);
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
    if (!response.ok) throw new Error('Failed to fetch HDR: ' + response.status);
    const hdr = parseHDR(await response.arrayBuffer());
    const texture = device.createTexture({
        size: [size, size, 6],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    for (let face = 0; face < 6; face++) {
        const faceData = new Uint8Array(size * size * 4);
        let offset = 0;
        for (let y = 0; y < size; y++) {
            const v = 2 * ((y + 0.5) / size) - 1;
            for (let x = 0; x < size; x++) {
                const u = 2 * ((x + 0.5) / size) - 1;
                const dir = directionForCubeFace(face, u, v);
                const phi = Math.atan2(dir[2], dir[0]);
                const theta = Math.acos(Math.min(Math.max(dir[1], -1), 1));
                const color = sampleEquirectHDR(hdr, phi / (2 * Math.PI) + 0.5, theta / Math.PI);
                faceData[offset++] = Math.max(0, Math.min(255, Math.floor(Math.min(Math.max(color[0], 0), 1) * 255)));
                faceData[offset++] = Math.max(0, Math.min(255, Math.floor(Math.min(Math.max(color[1], 0), 1) * 255)));
                faceData[offset++] = Math.max(0, Math.min(255, Math.floor(Math.min(Math.max(color[2], 0), 1) * 255)));
                faceData[offset++] = 255;
            }
        }
        device.queue.writeTexture(
            { texture, origin: { x: 0, y: 0, z: face } },
            faceData,
            { bytesPerRow: size * 4, rowsPerImage: size },
            { width: size, height: size, depthOrArrayLayers: 1 },
        );
    }
    return texture.createView({ dimension: 'cube' });
}

async function createInitialData() {
    coinCount = MAX_COINS;
    const states = new Float32Array(coinCount * STATE_FLOATS);
    const infos = new Float32Array(coinCount * INFO_FLOATS);
    for (let coin = 0; coin < coinCount; coin++) {
        const seed = ((coin * 37) % 101) / 101;
        const type = COIN_TYPES[Math.min(COIN_TYPES.length - 1, Math.floor(randomFromIndex(coin) * COIN_TYPES.length))];
        const stateBase = coin * STATE_FLOATS;
        states[stateBase + 0] = (randomFromIndex(coin * 3 + 11) - 0.5) * SPAWN_RANGE;
        states[stateBase + 1] = (randomFromIndex(coin * 7 + 23) + 1.0) * 15.0;
        states[stateBase + 2] = (randomFromIndex(coin * 5 + 17) - 0.5) * SPAWN_RANGE;
        states[stateBase + 3] = seed;
        states[stateBase + 4] = 0;
        states[stateBase + 5] = 0;
        states[stateBase + 6] = 0;
        states[stateBase + 8] = 0;
        states[stateBase + 9] = 0;
        states[stateBase + 10] = 0;
        states[stateBase + 11] = 1;
        states[stateBase + 12] = (randomFromIndex(coin * 23 + 2) - 0.5) * 6.0;
        states[stateBase + 13] = (randomFromIndex(coin * 29 + 4) - 0.5) * 2.0;
        states[stateBase + 14] = (randomFromIndex(coin * 31 + 6) - 0.5) * 6.0;
        const infoBase = coin * INFO_FLOATS;
        infos[infoBase + 0] = type.radius;
        infos[infoBase + 1] = type.halfHeight;
        infos[infoBase + 2] = type.texture;
        infos[infoBase + 3] = seed;
        infos[infoBase + 4] = type.restitution;
        infos[infoBase + 5] = type.friction;
        infos[infoBase + 6] = type.metallic;
        infos[infoBase + 7] = type.roughness;
        infos.set(type.color, infoBase + 8);
    }
    return { states, infos };
}

function createStaticItems() {
    const items = new Float32Array(STATIC_COUNT * STATIC_FLOATS);
    const data = [
        { pos: [0, -10.5, 0], scale: [13, 1, 13], color: [0.46, 0.47, 0.49, 1] },
    ];
    for (let i = 0; i < data.length; i++) {
        const base = i * STATIC_FLOATS;
        items.set([...data[i].pos, 0], base);
        items.set([...data[i].scale, 0], base + 4);
        items.set(data[i].color, base + 8);
    }
    return items;
}

function writeCamera(timeMs) {
    const eye = [0, 0, 40];
    mat4Perspective(projectionMatrix, Math.PI / 4, canvas.width / canvas.height, 0.1, 150);
    mat4LookAt(viewMatrix, eye, [0, 0, 0], [0, 1, 0]);
    mat4Multiply(viewProjectionMatrix, projectionMatrix, viewMatrix);
    const cameraData = new Float32Array(20);
    cameraData.set(viewProjectionMatrix, 0);
    cameraData.set([eye[0], eye[1], eye[2], 1], 16);
    device.queue.writeBuffer(cameraBuffer, 0, cameraData);
}

function drawMesh(pass, mesh, instanceCount, firstInstance = 0) {
    pass.setVertexBuffer(0, mesh.positionBuffer);
    pass.setVertexBuffer(1, mesh.normalBuffer);
    pass.setVertexBuffer(2, mesh.uvBuffer);
    pass.setIndexBuffer(mesh.indexBuffer, 'uint16');
    pass.drawIndexed(mesh.indexCount, instanceCount, 0, 0, firstInstance);
}

function drawWireColliders(pass) {
    if (!showWireframe) return;
    pass.setPipeline(wirePipeline);
    pass.setBindGroup(0, wireBindGroups[currentState]);
    pass.setVertexBuffer(0, wireBoxMesh.positionBuffer);
    pass.draw(wireBoxMesh.vertexCount, coinCount);
}

function drawSkybox(encoder, targetView) {
    if (!skyboxPipeline || !skyboxBindGroup) return;
    viewNoTranslationMatrix.set(viewMatrix);
    viewNoTranslationMatrix[12] = 0;
    viewNoTranslationMatrix[13] = 0;
    viewNoTranslationMatrix[14] = 0;

    const skyboxUniformData = new Float32Array(40);
    skyboxUniformData.set(projectionMatrix, 0);
    skyboxUniformData.set(viewNoTranslationMatrix, 16);
    skyboxUniformData[32] = 1.2;
    device.queue.writeBuffer(skyboxUniformBuffer, 0, skyboxUniformData);

    const pass = encoder.beginRenderPass({
        colorAttachments: [{
            view: targetView,
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

function frame(timeMs) {
    if (lastTime < 0) lastTime = timeMs;
    const dt = Math.min((timeMs - lastTime) / 1000, 1 / 30);
    lastTime = timeMs;
    writeCamera(timeMs);
    const simData = new ArrayBuffer(32);
    const simFloats = new Float32Array(simData);
    const simUints = new Uint32Array(simData);
    simFloats[0] = dt / SUBSTEPS;
    simFloats[1] = 9.81;
    simFloats[2] = GROUND_Y;
    simFloats[3] = 0.9992;
    simFloats[4] = 0.992;
    simFloats[5] = 0.35;
    simFloats[6] = 0.82;
    simFloats[7] = SPAWN_RANGE;
    device.queue.writeBuffer(simParamsBuffer, 0, simData);

    const encoder = device.createCommandEncoder();
    for (let s = 0; s < SUBSTEPS; s++) {
        const computePass = encoder.beginComputePass();
        computePass.setPipeline(computePipeline);
        computePass.setBindGroup(0, computeBindGroups[currentState]);
        computePass.dispatchWorkgroups(Math.ceil(coinCount / 64));
        computePass.end();
        currentState = 1 - currentState;
    }
    const targetView = context.getCurrentTexture().createView();
    drawSkybox(encoder, targetView);
    const renderPass = encoder.beginRenderPass({
        colorAttachments: [{
            view: targetView,
            loadOp: 'load',
            storeOp: 'store',
        }],
        depthStencilAttachment: {
            view: depthTexture.createView(),
            depthClearValue: 1.0,
            depthLoadOp: 'clear',
            depthStoreOp: 'store',
        },
    });
    renderPass.setPipeline(renderPipeline);
    renderPass.setBindGroup(0, renderBindGroups[currentState]);
    drawMesh(renderPass, cylinderMesh, coinCount);
    drawMesh(renderPass, cubeMesh, STATIC_COUNT, MAX_COINS);
    drawWireColliders(renderPass);
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
    cylinderMesh = createCylinderGeometry();
    cubeMesh = createBoxGeometry();
    wireBoxMesh = createWireBoxGeometry();
    const initial = await createInitialData();
    for (let i = 0; i < 2; i++) {
        const buffer = device.createBuffer({ size: coinCount * STATE_FLOATS * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, mappedAtCreation: true });
        new Float32Array(buffer.getMappedRange()).set(initial.states);
        buffer.unmap();
        stateBuffers.push(buffer);
    }
    coinInfoBuffer = device.createBuffer({ size: coinCount * INFO_FLOATS * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, mappedAtCreation: true });
    new Float32Array(coinInfoBuffer.getMappedRange()).set(initial.infos);
    coinInfoBuffer.unmap();
    staticBuffer = device.createBuffer({ size: STATIC_COUNT * STATIC_FLOATS * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, mappedAtCreation: true });
    new Float32Array(staticBuffer.getMappedRange()).set(createStaticItems());
    staticBuffer.unmap();
    cameraBuffer = device.createBuffer({ size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    simParamsBuffer = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    sampler = device.createSampler({ addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge', magFilter: 'linear', minFilter: 'linear' });
    textureView = (await createTextureAtlas()).createView();
    try {
        environmentTextureView = await loadHDRAsCubeTextureView(ENV_HDR_URL, 192);
    } catch (error) {
        console.warn('HDR cube map load failed:', error);
        environmentTextureView = createEnvironmentCubeMap().createView({ dimension: 'cube' });
    }
    skyboxPipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: {
            module: device.createShaderModule({ code: document.getElementById('skybox-vs').textContent }),
            entryPoint: 'main',
            buffers: [{ arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] }],
        },
        fragment: {
            module: device.createShaderModule({ code: document.getElementById('skybox-fs').textContent }),
            entryPoint: 'main',
            targets: [{ format }],
        },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less-equal' },
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
        -1,  1, -1,  1,  1,  1,  1,  1, -1,
    ]);
    skyboxVertexBuffer = device.createBuffer({ size: skyboxVerts.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(skyboxVertexBuffer, 0, skyboxVerts);
    skyboxUniformBuffer = device.createBuffer({ size: 40 * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    skyboxBindGroup = device.createBindGroup({
        layout: skyboxPipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: skyboxUniformBuffer } },
            { binding: 1, resource: sampler },
            { binding: 2, resource: environmentTextureView },
        ],
    });
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
        primitive: { topology: 'triangle-list', cullMode: 'back' },
        depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
    });
    wirePipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: {
            module: device.createShaderModule({ code: wireVertexShaderWGSL }),
            entryPoint: 'main',
            buffers: [{ arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] }],
        },
        fragment: {
            module: device.createShaderModule({ code: wireFragmentShaderWGSL }),
            entryPoint: 'main',
            targets: [{
                format,
                blend: {
                    color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
                    alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
                },
            }],
        },
        primitive: { topology: 'line-list' },
        depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less-equal' },
    });
    computePipeline = device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code: computeShaderWGSL }), entryPoint: 'main' } });
    for (let i = 0; i < 2; i++) {
        renderBindGroups.push(device.createBindGroup({
            layout: renderPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: cameraBuffer } },
                { binding: 1, resource: { buffer: stateBuffers[i] } },
                { binding: 2, resource: { buffer: coinInfoBuffer } },
                { binding: 3, resource: { buffer: staticBuffer } },
                { binding: 4, resource: sampler },
                { binding: 5, resource: textureView },
                { binding: 6, resource: environmentTextureView },
            ],
        }));
        wireBindGroups.push(device.createBindGroup({
            layout: wirePipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: cameraBuffer } },
                { binding: 1, resource: { buffer: stateBuffers[i] } },
                { binding: 2, resource: { buffer: coinInfoBuffer } },
            ],
        }));
        computeBindGroups.push(device.createBindGroup({
            layout: computePipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: stateBuffers[i] } },
                { binding: 1, resource: { buffer: stateBuffers[1 - i] } },
                { binding: 2, resource: { buffer: coinInfoBuffer } },
                { binding: 3, resource: { buffer: simParamsBuffer } },
            ],
        }));
    }
    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('keydown', event => {
        if (event.key.toLowerCase() !== 'w' || event.repeat) return;
        showWireframe = !showWireframe;
        document.getElementById('wireHint').textContent = 'W: collider wireframe ' + (showWireframe ? 'ON' : 'OFF');
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

init().catch(error => console.error(error));