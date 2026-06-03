'use strict';

// Babylon.js (WebGPUEngine) provides the camera, skybox, environment and ground, while the
// boxes are simulated and drawn entirely on the GPU through custom WGSL compute + render
// passes that share Babylon's WebGPU device. The boxes start arranged as a coloured picture
// and topple into a pile; the physics is axis-aligned box stacking with a "stack stress"
// model that makes tall, poorly-supported stacks sway and collapse.
//
// The boxes are rendered into a RenderTargetTexture and composited over the Babylon scene
// with a Layer. Press W to toggle the box collider wireframe.

const BASE_URL = 'https://cx20.github.io/gltf-test';

// 16x16 colour picture; each cell becomes one falling box.
const ROWS = [
    '.............ppp',
    '......rrrrr..ppp',
    '.....rrrrrrrrrpp',
    '.....nnnppnp.rrr',
    '....npnpppnpprrr',
    '....npnnpppnpppr',
    '....nnppppnnnnr.',
    '......pppppppr..',
    '..rrrrrbrrrbr...',
    '.rrrrrrrbrrrb..n',
    'pprrrrrrbbbbb..n',
    'ppp.bbrbbybbybnn',
    '.p.nbbbbbbbbbbnn',
    '..nnnbbbbbbbbbnn',
    '.nnnbbbbbbb.....',
    '.n..bbbb........',
];
const palette = {
    '.': [0xdc / 255, 0xaa / 255, 0x6b / 255, 1],
    p: [1.0, 0xcc / 255, 0xcc / 255, 1],
    n: [0x80 / 255, 0.0, 0.0, 1],
    r: [1.0, 0.0, 0.0, 1],
    y: [1.0, 1.0, 0.0, 1],
    b: [0.0, 0.0, 1.0, 1],
};

const COUNT = 256;
const STATE_FLOATS = 8;
const SUBSTEPS = 5;
const BOX_HALF = 0.5;
const GROUND_Y = -2.0;

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
    let i = 0;
    for (let rowIndex = 0; rowIndex < ROWS.length; rowIndex++) {
        const row = ROWS[rowIndex];
        for (let col = 0; col < row.length; col++) {
            const base = i * STATE_FLOATS;
            const jitter = ((col * 13 + rowIndex * 7) % 10) * 0.006;
            states[base + 0] = -12 + col * 1.5 + jitter;
            states[base + 1] = (ROWS.length - 1 - rowIndex) * 1.2 + jitter;
            states[base + 2] = ((col * 5 + rowIndex * 3) % 9) * 0.012;
            states[base + 3] = ((col * 17 + rowIndex * 31) % 97) / 97;
            states[base + 4] = ((col % 3) - 1) * 0.03;
            states[base + 5] = -0.05;
            states[base + 6] = ((rowIndex % 3) - 1) * 0.02;
            i++;
        }
    }
    return states;
}

function createColors() {
    const colors = new Float32Array(COUNT * 4);
    let i = 0;
    for (const row of ROWS) {
        for (const key of row) {
            colors.set(palette[key], i * 4);
            i++;
        }
    }
    return colors;
}

const createScene = async function () {
    const scene = new BABYLON.Scene(engine);
    const camera = new BABYLON.ArcRotateCamera('camera',
        -Math.PI / 180 * 50, Math.PI / 180 * 66, 34,
        BABYLON.Vector3.Zero(), scene);
    camera.setTarget(new BABYLON.Vector3(0, 5, 0));
    camera.attachControl(canvas, true);
    camera.minZ = 0.1;
    camera.maxZ = 200;

    const cubeTexture = new BABYLON.CubeTexture(
        BASE_URL + '/textures/env/papermillSpecularHDR.env', scene);
    scene.createDefaultSkybox(cubeTexture, true);
    scene.environmentTexture = cubeTexture;
    new BABYLON.HemisphericLight('light0', new BABYLON.Vector3(0.4, 1, 0.3), scene);

    await waitForReady(cubeTexture);

    const ground = BABYLON.MeshBuilder.CreateGround('ground', { width: 32, height: 32 }, scene);
    ground.position.y = GROUND_Y;
    const groundMat = new BABYLON.PBRMaterial('groundMat', scene);
    groundMat.metallic = 0;
    groundMat.roughness = 0.9;
    groundMat.albedoColor = new BABYLON.Color3(0.34, 0.52, 0.33);
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

    // Unit cube (interleaved pos+normal would also work; keep two buffers like the geometry below).
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

    // Box edge wireframe (12 edges).
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

    const initStates = createInitialStates();
    const stateBuffers = [0, 1].map(() => {
        const buf = device.createBuffer({ size: COUNT * STATE_FLOATS * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, mappedAtCreation: true });
        new Float32Array(buf.getMappedRange()).set(initStates);
        buf.unmap();
        return buf;
    });
    const colorBuffer = (() => {
        const buf = device.createBuffer({ size: COUNT * 4 * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, mappedAtCreation: true });
        new Float32Array(buf.getMappedRange()).set(createColors());
        buf.unmap();
        return buf;
    })();

    const camUbo = device.createBuffer({ size: 16 * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const simUbo = device.createBuffer({ size: 8 * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    // Physics: axis-aligned boxes. O(N^2) overlap resolution plus a "stack stress" model
    // where tall, off-centre or heavily-loaded stacks accumulate unrest and sway apart.
    const computeWGSL = `
struct BoxState { position : vec4<f32>, velocity : vec4<f32>, }
struct SimParams {
    dt:f32, gravity:f32, groundY:f32, restitution:f32,
    damping:f32, friction:f32, halfSize:f32, elapsedTime:f32,
}
const COUNT : u32 = ${COUNT}u;
@group(0) @binding(0) var<storage, read>       srcStates : array<BoxState>;
@group(0) @binding(1) var<storage, read_write> dstStates : array<BoxState>;
@group(0) @binding(2) var<uniform>             params    : SimParams;

fn signOrOne(v : f32) -> f32 { return select(-1.0, 1.0, v >= 0.0); }

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id : vec3<u32>) {
    let i = id.x;
    if (i >= COUNT) { return; }

    var pos = srcStates[i].position.xyz;
    var vel = srcStates[i].velocity.xyz;
    let seed = srcStates[i].position.w;
    var unrest = srcStates[i].velocity.w;
    let h = params.halfSize;
    let size = h * 2.0;
    var supportCount = 0u;
    var loadCount = 0u;
    var supportCenter = vec2<f32>(0.0);

    vel.y -= params.gravity * params.dt;
    vel *= params.damping;
    pos += vel * params.dt;

    if (pos.y - h < params.groundY) {
        pos.y = params.groundY + h;
        if (vel.y < 0.0) { vel.y = -vel.y * params.restitution; }
        vel.x *= params.friction;
        vel.z *= params.friction;
        if (abs(vel.y) < 0.08) { vel.y = 0.0; }
    }

    for (var j = 0u; j < COUNT; j++) {
        if (j == i) { continue; }
        let other = srcStates[j];
        let delta = pos - other.position.xyz;
        let overlap = vec3<f32>(size) - abs(delta);
        let belowGap = (pos.y - other.position.y) - size;
        let aboveGap = (other.position.y - pos.y) - size;
        let nearColumn = abs(delta.x) < 0.72 && abs(delta.z) < 0.72;

        if (nearColumn && belowGap > -0.08 && belowGap < 0.28) {
            supportCount++;
            supportCenter += other.position.xz;
        }
        if (nearColumn && aboveGap > -0.08 && aboveGap < 0.38) {
            loadCount++;
        }

        if (overlap.x > 0.0 && overlap.y > 0.0 && overlap.z > 0.0) {
            if (overlap.y <= overlap.x && overlap.y <= overlap.z) {
                let s = signOrOne(delta.y);
                pos.y += s * overlap.y * 0.52;
                if ((s > 0.0 && vel.y < other.velocity.y) || (s < 0.0 && vel.y > other.velocity.y)) {
                    vel.y = other.velocity.y * params.restitution;
                    vel.x *= params.friction;
                    vel.z *= params.friction;
                }
            } else if (overlap.x <= overlap.z) {
                let s = signOrOne(delta.x);
                pos.x += s * overlap.x * 0.52;
                vel.x = max(abs(vel.x) * params.restitution, 0.02) * s;
            } else {
                let s = signOrOne(delta.z);
                pos.z += s * overlap.z * 0.52;
                vel.z = max(abs(vel.z) * params.restitution, 0.02) * s;
            }
        }
    }

    let heightFactor = smoothstep(2.5, 14.0, pos.y - params.groundY);
    var supportOffset = 0.42;
    if (supportCount > 0u) {
        let centered = supportCenter / f32(supportCount);
        supportOffset = length(pos.xz - centered);
    }
    let supportWeakness = clamp(supportOffset * 1.8 + select(0.55, 0.0, supportCount > 0u), 0.0, 1.0);
    let loadFactor = clamp(f32(loadCount) * 0.35, 0.0, 1.0);
    let sway = vec2<f32>(
        sin(params.elapsedTime * 1.6 + seed * 23.17),
        cos(params.elapsedTime * 1.3 + seed * 19.41),
    );
    let stackStress = heightFactor * (0.2 + supportWeakness * 0.9 + loadFactor * 0.35);
    unrest = clamp(unrest + stackStress * params.dt * 0.55 - params.dt * 0.04, 0.0, 1.0);

    if (unrest > 0.08) {
        let push = normalize(sway + vec2<f32>(0.18, -0.32)) * unrest * stackStress * params.dt * 2.6;
        vel.x += push.x;
        vel.z += push.y;
    }

    if (length(vel) < 0.015 && pos.y - h <= params.groundY + 0.02) {
        vel = vec3<f32>(0.0);
    }

    dstStates[i].position = vec4<f32>(pos, seed);
    dstStates[i].velocity = vec4<f32>(vel, unrest);
}
`;

    const renderWGSL = `
struct Camera { viewProjection : mat4x4<f32>, }
struct BoxState { position : vec4<f32>, velocity : vec4<f32>, }
struct VSOut {
    @builtin(position) position : vec4<f32>,
    @location(0) color : vec3<f32>,
}
@group(0) @binding(0) var<uniform>       camera : Camera;
@group(0) @binding(1) var<storage, read> states : array<BoxState>;
@group(0) @binding(2) var<storage, read> colors : array<vec4<f32>>;
@vertex
fn vs(@location(0) position : vec3<f32>, @location(1) normal : vec3<f32>, @builtin(instance_index) instance : u32) -> VSOut {
    var out : VSOut;
    let worldPos = position + states[instance].position.xyz;
    let light = normalize(vec3<f32>(0.5, 0.9, 0.35));
    let shade = max(dot(normalize(normal), light), 0.26);
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
struct BoxState { position : vec4<f32>, velocity : vec4<f32>, }
@group(0) @binding(0) var<uniform>       camera : Camera;
@group(0) @binding(1) var<storage, read> states : array<BoxState>;
@vertex
fn vs(@location(0) position : vec3<f32>, @builtin(instance_index) instance : u32) -> @builtin(position) vec4<f32> {
    let worldPos = position + states[instance].position.xyz;
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
    const boxRtt = new BABYLON.RenderTargetTexture('boxRTT', rttSize, scene, {
        generateMipMaps: false,
        type: BABYLON.Constants.TEXTURETYPE_UNSIGNED_BYTE,
        format: BABYLON.Constants.TEXTUREFORMAT_RGBA,
    });
    const boxLayer = new BABYLON.Layer('boxLayer', null, scene, false);
    boxLayer.texture = boxRtt;
    boxLayer.alphaBlendingMode = BABYLON.Engine.ALPHA_COMBINE;

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

    const computeBindGroups = [0, 1].map((s) => device.createBindGroup({
        layout: computePipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: stateBuffers[s] } },
            { binding: 1, resource: { buffer: stateBuffers[1 - s] } },
            { binding: 2, resource: { buffer: simUbo } },
        ],
    }));
    const renderBindGroups = [0, 1].map((s) => device.createBindGroup({
        layout: renderPipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: camUbo } },
            { binding: 1, resource: { buffer: stateBuffers[s] } },
            { binding: 2, resource: { buffer: colorBuffer } },
        ],
    }));
    const wireBindGroups = [0, 1].map((s) => device.createBindGroup({
        layout: wirePipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: camUbo } },
            { binding: 1, resource: { buffer: stateBuffers[s] } },
        ],
    }));

    const hint = document.getElementById('hint');
    let frameCount = 0, lastFpsT = performance.now(), fps = 0;
    let currentState = 0;
    const startTime = performance.now();

    scene.onBeforeRenderObservable.add(() => {
        const internalTex = boxRtt.getInternalTexture();
        if (!internalTex || !internalTex._hardwareTexture) return;
        const gpuTex = internalTex._hardwareTexture.underlyingResource;
        if (!gpuTex) return;

        const viewProj = camera.getViewMatrix().multiply(camera.getProjectionMatrix());
        device.queue.writeBuffer(camUbo, 0, new Float32Array(viewProj.toArray()));

        const dt = Math.min(engine.getDeltaTime() / 1000, 1 / 30);
        const time = (performance.now() - startTime) / 1000;
        device.queue.writeBuffer(simUbo, 0, new Float32Array([
            dt / SUBSTEPS, 9.8, GROUND_Y, 0.18, 0.996, 0.86, BOX_HALF, time,
        ]));

        const ce = device.createCommandEncoder();
        const wg = Math.ceil(COUNT / 64);
        for (let s = 0; s < SUBSTEPS; s++) {
            const cp = ce.beginComputePass();
            cp.setPipeline(computePipeline);
            cp.setBindGroup(0, computeBindGroups[currentState]);
            cp.dispatchWorkgroups(wg);
            cp.end();
            currentState = 1 - currentState;
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
            pass.setBindGroup(0, renderBindGroups[currentState]);
            pass.setVertexBuffer(0, positionBuffer);
            pass.setVertexBuffer(1, normalBuffer);
            pass.setIndexBuffer(indexBuffer, 'uint16');
            pass.drawIndexed(boxIndices.length, COUNT);
            if (showWireframe) {
                pass.setPipeline(wirePipeline);
                pass.setBindGroup(0, wireBindGroups[currentState]);
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
