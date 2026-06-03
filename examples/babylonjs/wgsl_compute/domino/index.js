'use strict';

// Babylon.js (WebGPUEngine) provides the camera, skybox, environment and ground, while the
// dominoes are simulated and drawn entirely on the GPU through custom WGSL compute + render
// passes that share Babylon's WebGPU device. A 16x16 field of dominoes topples in a chain
// reaction: each domino starts falling once the one before it in its row has tipped far
// enough, then swings about its base edge under gravity until it lies flat.
//
// The dominoes are rendered into a RenderTargetTexture and composited over the Babylon scene
// with a Layer. Press W to toggle the domino collider wireframe.

const BASE_URL = 'https://cx20.github.io/gltf-test';

const GRID = 16;
const COUNT = GRID * GRID;
const STATE_FLOATS = 8;
const SUBSTEPS = 4;
const BW = 1.0;
const BH = 2.0;
const BD = 0.3;
const SPACING = 3.0;

// 16x16 colour picture mapped onto the domino tops.
const sprite = [
    0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,1,
    0,0,0,0,0,0,2,2,2,2,2,0,0,1,1,1,
    0,0,0,0,0,2,2,2,2,2,2,2,2,2,1,1,
    0,0,0,0,0,3,3,3,1,1,3,1,0,2,2,2,
    0,0,0,0,3,1,3,1,1,1,3,1,1,2,2,2,
    0,0,0,0,3,1,3,3,1,1,1,3,1,1,1,2,
    0,0,0,0,3,3,1,1,1,1,3,3,3,3,2,0,
    0,0,0,0,0,0,1,1,1,1,1,1,1,2,0,0,
    0,0,2,2,2,2,2,4,2,2,2,4,2,0,0,0,
    0,2,2,2,2,2,2,2,4,2,2,2,4,0,0,3,
    1,1,2,2,2,2,2,2,4,4,4,4,4,0,0,3,
    1,1,1,0,4,4,2,4,4,5,4,4,5,4,3,3,
    0,1,0,3,4,4,4,4,4,4,4,4,4,4,3,3,
    0,0,3,3,3,4,4,4,4,4,4,4,4,4,3,3,
    0,3,3,3,4,4,4,4,4,4,4,0,0,0,0,0,
    0,3,0,0,4,4,4,4,0,0,0,0,0,0,0,0,
];
const palette = [
    [0xdc / 255, 0xaa / 255, 0x6b / 255, 1],
    [1.0, 0xcc / 255, 0xcc / 255, 1],
    [1.0, 0.04, 0.02, 1],
    [0x80 / 255, 0.0, 0.0, 1],
    [0.04, 0.14, 1.0, 1],
    [1.0, 0.92, 0.04, 1],
];

let engine;
let scene;
let canvas;
let showWireframe = true;

window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (e.code === 'KeyW' || e.key === 'w' || e.key === 'W') {
        showWireframe = !showWireframe;
        const hint = document.getElementById('hint');
        if (hint) hint.textContent = 'W: wireframe ' + (showWireframe ? 'ON' : 'OFF');
    }
});

const waitForReady = (t) => new Promise((resolve) => {
    if (t.isReady()) resolve();
    else t.onLoadObservable.addOnce(() => resolve());
});

function createInitialStates() {
    const states = new Float32Array(COUNT * STATE_FLOATS);
    for (let i = 0; i < COUNT; i++) {
        const col = Math.floor(i / GRID);
        const row = i % GRID;
        const base = i * STATE_FLOATS;
        states[base + 0] = (col - (GRID - 1) * 0.5) * SPACING;
        states[base + 1] = BH;
        states[base + 2] = ((GRID - 1) * 0.5 - row) * SPACING;
        states[base + 4] = row === 0 ? -0.18 : 0.0;  // angle
        states[base + 5] = row === 0 ? -1.6 : 0.0;    // angular velocity
        states[base + 6] = row === 0 ? 1.0 : 0.0;     // phase (1 = falling)
    }
    return states;
}

function createColors() {
    const colors = new Float32Array(COUNT * 4);
    for (let i = 0; i < COUNT; i++) {
        colors.set(palette[sprite[i]], i * 4);
    }
    return colors;
}

const createScene = async function () {
    const scene = new BABYLON.Scene(engine);
    const camera = new BABYLON.ArcRotateCamera('camera',
        -Math.PI / 180 * 55, Math.PI / 180 * 52, 58,
        BABYLON.Vector3.Zero(), scene);
    camera.setTarget(new BABYLON.Vector3(0, 2, 0));
    camera.attachControl(canvas, true);
    camera.minZ = 0.1;
    camera.maxZ = 300;

    const cubeTexture = new BABYLON.CubeTexture(
        BASE_URL + '/textures/env/papermillSpecularHDR.env', scene);
    scene.createDefaultSkybox(cubeTexture, true);
    scene.environmentTexture = cubeTexture;
    new BABYLON.HemisphericLight('light0', new BABYLON.Vector3(0.4, 1, 0.3), scene);

    await waitForReady(cubeTexture);

    const ground = BABYLON.MeshBuilder.CreateGround('ground', { width: 56, height: 56 }, scene);
    ground.position.y = 0;
    const groundMat = new BABYLON.PBRMaterial('groundMat', scene);
    groundMat.metallic = 0;
    groundMat.roughness = 0.9;
    groundMat.albedoColor = new BABYLON.Color3(0.36, 0.42, 0.38);
    ground.material = groundMat;

    // ============================================================
    // Custom WebGPU path (shares Babylon's device)
    // ============================================================
    const device = engine._device;

    const mkVB = (data) => {
        const buf = device.createBuffer({ size: data.byteLength, usage: GPUBufferUsage.VERTEX, mappedAtCreation: true });
        new Float32Array(buf.getMappedRange()).set(data);
        buf.unmap();
        return buf;
    };
    const mkIB = (data) => {
        const buf = device.createBuffer({ size: data.byteLength, usage: GPUBufferUsage.INDEX, mappedAtCreation: true });
        new Uint16Array(buf.getMappedRange()).set(data);
        buf.unmap();
        return buf;
    };

    const boxPositions = new Float32Array([
        -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5,
        0.5, -0.5, -0.5, -0.5, -0.5, -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5,
        -0.5, -0.5, -0.5, -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5, -0.5,
        0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5,
        -0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, -0.5, -0.5, 0.5, -0.5,
        -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, -0.5, 0.5, -0.5, -0.5, 0.5,
    ]);
    const boxNormals = new Float32Array([
        0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1,
        0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1,
        -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0,
        1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0,
        0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0,
        0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0,
    ]);
    const boxIndices = new Uint16Array([
        0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7,
        8, 9, 10, 8, 10, 11, 12, 13, 14, 12, 14, 15,
        16, 17, 18, 16, 18, 19, 20, 21, 22, 20, 22, 23,
    ]);
    const positionBuffer = mkVB(boxPositions);
    const normalBuffer = mkVB(boxNormals);
    const indexBuffer = mkIB(boxIndices);

    const wirePos = new Float32Array([
        -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, -0.5,
        -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5,
    ]);
    const wireIdx = new Uint16Array([
        0, 1, 1, 2, 2, 3, 3, 0, 4, 5, 5, 6, 6, 7, 7, 4, 0, 4, 1, 5, 2, 6, 3, 7,
    ]);
    const wireVertexBuffer = mkVB(wirePos);
    const wireIndexBuffer = mkIB(wireIdx);
    const wireIndexCount = wireIdx.length;

    // Scripted topple runs in place on a single state buffer.
    const stateBuffer = (() => {
        const buf = device.createBuffer({ size: COUNT * STATE_FLOATS * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, mappedAtCreation: true });
        new Float32Array(buf.getMappedRange()).set(createInitialStates());
        buf.unmap();
        return buf;
    })();
    const colorBuffer = (() => {
        const buf = device.createBuffer({ size: COUNT * 4 * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, mappedAtCreation: true });
        new Float32Array(buf.getMappedRange()).set(createColors());
        buf.unmap();
        return buf;
    })();

    const camUbo = device.createBuffer({ size: 16 * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const simUbo = device.createBuffer({ size: 4 * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    // Physics: a kinematic chain reaction. Each domino watches the previous one in its row
    // and, once tipped, swings about its base edge under a gravity-driven torque.
    const computeWGSL = `
struct DominoState { base : vec4<f32>, motion : vec4<f32>, }
struct SimParams { dt:f32, gravity:f32, damping:f32, pad:f32, }
const GRID  : u32 = ${GRID}u;
const COUNT : u32 = ${COUNT}u;
@group(0) @binding(0) var<storage, read_write> states : array<DominoState>;
@group(0) @binding(1) var<uniform>             params : SimParams;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id : vec3<u32>) {
    let i = id.x;
    if (i >= COUNT) { return; }

    var angle  = states[i].motion.x;
    var angVel = states[i].motion.y;
    var phase  = states[i].motion.z;
    let row    = i % GRID;

    if (phase < 0.5 && row > 0u) {
        let prev = states[i - 1u].motion;
        if (prev.x < -0.78) {
            phase = 1.0;
            angle = min(angle, -0.04);
            angVel = -2.1;
        }
    }

    if (phase > 0.5 && phase < 1.5) {
        let torque = -params.gravity * 0.42 * max(cos(angle), 0.24);
        angVel = (angVel + torque * params.dt) * params.damping;
        angle += angVel * params.dt;
        if (angle < -1.47) {
            angle = -1.47;
            angVel = 0.0;
            phase = 2.0;
        }
    }

    states[i].motion = vec4<f32>(angle, angVel, phase, 0.0);
}
`;

    const renderWGSL = `
struct Camera { viewProjection : mat4x4<f32>, }
struct DominoState { base : vec4<f32>, motion : vec4<f32>, }
struct VSOut {
    @builtin(position) position : vec4<f32>,
    @location(0) color : vec3<f32>,
}
const BW : f32 = ${BW};
const BH : f32 = ${BH};
const BD : f32 = ${BD};
@group(0) @binding(0) var<uniform>       camera : Camera;
@group(0) @binding(1) var<storage, read> states : array<DominoState>;
@group(0) @binding(2) var<storage, read> colors : array<vec4<f32>>;
fn rotateX(p : vec3<f32>, angle : f32) -> vec3<f32> {
    let c = cos(angle);
    let s = sin(angle);
    return vec3<f32>(p.x, p.y * c - p.z * s, p.y * s + p.z * c);
}
@vertex
fn vs(@location(0) position : vec3<f32>, @location(1) normal : vec3<f32>, @builtin(instance_index) instance : u32) -> VSOut {
    var out : VSOut;
    let state = states[instance];
    let angle = state.motion.x;
    let local = position * vec3<f32>(BW * 2.0, BH * 2.0, BD * 2.0);
    let pivotLocal = vec3<f32>(0.0, -BH, -BD);
    let pivotWorld = vec3<f32>(state.base.x, 0.0, state.base.z - BD);
    let worldPos = pivotWorld + rotateX(local - pivotLocal, angle);
    let worldNormal = normalize(rotateX(normal, angle));
    let light = normalize(vec3<f32>(0.45, 0.9, 0.35));
    let shade = max(dot(worldNormal, light), 0.28);
    out.color = colors[instance].rgb * shade;
    let clip = camera.viewProjection * vec4<f32>(worldPos, 1.0);
    out.position = vec4<f32>(clip.x, -clip.y, clip.z, clip.w);
    return out;
}
@fragment
fn fs(@location(0) color : vec3<f32>) -> @location(0) vec4<f32> {
    return vec4<f32>(pow(color, vec3<f32>(0.82)), 1.0);
}
`;

    const wireWGSL = `
struct Camera { viewProjection : mat4x4<f32>, }
struct DominoState { base : vec4<f32>, motion : vec4<f32>, }
const BW : f32 = ${BW};
const BH : f32 = ${BH};
const BD : f32 = ${BD};
@group(0) @binding(0) var<uniform>       camera : Camera;
@group(0) @binding(1) var<storage, read> states : array<DominoState>;
fn rotateX(p : vec3<f32>, angle : f32) -> vec3<f32> {
    let c = cos(angle);
    let s = sin(angle);
    return vec3<f32>(p.x, p.y * c - p.z * s, p.y * s + p.z * c);
}
@vertex
fn vs(@location(0) position : vec3<f32>, @builtin(instance_index) instance : u32) -> @builtin(position) vec4<f32> {
    let state = states[instance];
    let angle = state.motion.x;
    let local = position * vec3<f32>(BW * 2.0, BH * 2.0, BD * 2.0);
    let pivotLocal = vec3<f32>(0.0, -BH, -BD);
    let pivotWorld = vec3<f32>(state.base.x, 0.0, state.base.z - BD);
    let worldPos = pivotWorld + rotateX(local - pivotLocal, angle);
    let clip = camera.viewProjection * vec4<f32>(worldPos, 1.0);
    return vec4<f32>(clip.x, -clip.y, clip.z, clip.w);
}
@fragment
fn fs() -> @location(0) vec4<f32> { return vec4<f32>(0.1, 1.0, 0.35, 1.0); }
`;

    const computeModule = device.createShaderModule({ code: computeWGSL });
    const renderModule = device.createShaderModule({ code: renderWGSL });
    const wireModule = device.createShaderModule({ code: wireWGSL });

    const computePipeline = device.createComputePipeline({ layout: 'auto', compute: { module: computeModule, entryPoint: 'main' } });

    const rttSize = { width: engine.getRenderWidth(), height: engine.getRenderHeight() };
    const dominoRtt = new BABYLON.RenderTargetTexture('dominoRTT', rttSize, scene, {
        generateMipMaps: false,
        type: BABYLON.Constants.TEXTURETYPE_UNSIGNED_BYTE,
        format: BABYLON.Constants.TEXTUREFORMAT_RGBA,
    });
    const dominoLayer = new BABYLON.Layer('dominoLayer', null, scene, false);
    dominoLayer.texture = dominoRtt;
    dominoLayer.alphaBlendingMode = BABYLON.Engine.ALPHA_COMBINE;

    const depthTex = device.createTexture({
        size: [rttSize.width, rttSize.height],
        format: 'depth24plus',
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });

    const renderPipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: {
            module: renderModule, entryPoint: 'vs',
            buffers: [
                { arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] },
                { arrayStride: 12, attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x3' }] },
            ],
        },
        fragment: { module: renderModule, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        depthStencil: { depthWriteEnabled: true, depthCompare: 'less', format: 'depth24plus' },
    });

    const wirePipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: {
            module: wireModule, entryPoint: 'vs',
            buffers: [{ arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] }],
        },
        fragment: { module: wireModule, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] },
        primitive: { topology: 'line-list' },
        depthStencil: { depthWriteEnabled: false, depthCompare: 'less-equal', format: 'depth24plus' },
    });

    const computeBindGroup = device.createBindGroup({
        layout: computePipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: stateBuffer } },
            { binding: 1, resource: { buffer: simUbo } },
        ],
    });
    const renderBindGroup = device.createBindGroup({
        layout: renderPipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: camUbo } },
            { binding: 1, resource: { buffer: stateBuffer } },
            { binding: 2, resource: { buffer: colorBuffer } },
        ],
    });
    const wireBindGroup = device.createBindGroup({
        layout: wirePipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: camUbo } },
            { binding: 1, resource: { buffer: stateBuffer } },
        ],
    });

    const hint = document.getElementById('hint');
    let frameCount = 0, lastFpsT = performance.now(), fps = 0;

    scene.onBeforeRenderObservable.add(() => {
        const internalTex = dominoRtt.getInternalTexture();
        if (!internalTex || !internalTex._hardwareTexture) return;
        const gpuTex = internalTex._hardwareTexture.underlyingResource;
        if (!gpuTex) return;

        const viewProj = camera.getViewMatrix().multiply(camera.getProjectionMatrix());
        device.queue.writeBuffer(camUbo, 0, new Float32Array(viewProj.toArray()));

        const dt = Math.min(engine.getDeltaTime() / 1000, 1 / 30);
        device.queue.writeBuffer(simUbo, 0, new Float32Array([dt / SUBSTEPS, 9.81, 0.992, 0]));

        const ce = device.createCommandEncoder();
        const wg = Math.ceil(COUNT / 64);
        for (let s = 0; s < SUBSTEPS; s++) {
            const cp = ce.beginComputePass();
            cp.setPipeline(computePipeline);
            cp.setBindGroup(0, computeBindGroup);
            cp.dispatchWorkgroups(wg);
            cp.end();
        }

        {
            const pass = ce.beginRenderPass({
                colorAttachments: [{
                    view: gpuTex.createView(),
                    clearValue: { r: 0, g: 0, b: 0, a: 0 },
                    loadOp: 'clear',
                    storeOp: 'store',
                }],
                depthStencilAttachment: {
                    view: depthTex.createView(),
                    depthClearValue: 1.0,
                    depthLoadOp: 'clear',
                    depthStoreOp: 'store',
                },
            });
            pass.setPipeline(renderPipeline);
            pass.setBindGroup(0, renderBindGroup);
            pass.setVertexBuffer(0, positionBuffer);
            pass.setVertexBuffer(1, normalBuffer);
            pass.setIndexBuffer(indexBuffer, 'uint16');
            pass.drawIndexed(boxIndices.length, COUNT);
            if (showWireframe) {
                pass.setPipeline(wirePipeline);
                pass.setBindGroup(0, wireBindGroup);
                pass.setVertexBuffer(0, wireVertexBuffer);
                pass.setIndexBuffer(wireIndexBuffer, 'uint16');
                pass.drawIndexed(wireIndexCount, COUNT);
            }
            pass.end();
        }

        device.queue.submit([ce.finish()]);

        frameCount++;
        const now = performance.now();
        if (now - lastFpsT > 500) {
            fps = (frameCount * 1000 / (now - lastFpsT)) | 0;
            frameCount = 0; lastFpsT = now;
            if (hint) hint.textContent = 'W: wireframe ' + (showWireframe ? 'ON' : 'OFF') + ' · ' + fps + ' FPS';
        }
    });

    scene.onDisposeObservable.add(() => { depthTex.destroy(); });

    return scene;
};

async function init() {
    canvas = document.getElementById('c');
    if (!navigator.gpu) {
        document.getElementById('hint').textContent = 'WebGPU is not available in this browser.';
        return;
    }
    engine = new BABYLON.WebGPUEngine(canvas);
    await engine.initAsync();
    scene = await createScene();
    engine.runRenderLoop(() => scene.render());
    window.addEventListener('resize', () => engine.resize());
}

init().catch((error) => console.error(error));
