'use strict';

// Babylon.js (WebGPUEngine) provides the camera, skybox, environment and ground (a grass
// field), while the footballs are simulated and drawn entirely on the GPU through custom WGSL
// compute + render passes that share Babylon's WebGPU device. 256 textured footballs fall and
// bounce; the physics is O(N^2) sphere-sphere collision plus floor contact and rolling, and
// footballs that leave the field are recycled back to the top.
//
// The footballs are rendered into a RenderTargetTexture and composited over the Babylon scene
// with a Layer. Press W to toggle the spherical collider wireframe.

const BASE_URL = 'https://cx20.github.io/gltf-test';
const TEXTURE_FOOTBALL = '../../../../assets/textures/Football.jpg';

// 16x16 colour picture; each cell tints one football.
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
const STATE_FLOATS = 16;
const SUBSTEPS = 4;
const RADIUS = 0.5;
const GROUND_Y = -2.0;
const GROUND_HALF = 15.0;
const SPAWN_Y_OFFSET = 4.0;
const RESTITUTION = 0.82;
const FRICTION = 0.035;
const LINEAR_DAMPING = 0.999;

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

async function loadTexture(device, url) {
    const img = document.createElement('img');
    img.src = url;
    await img.decode();
    const bitmap = await createImageBitmap(img);
    const tex = device.createTexture({
        size: [bitmap.width, bitmap.height, 1],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    device.queue.copyExternalImageToTexture({ source: bitmap }, { texture: tex }, [bitmap.width, bitmap.height, 1]);
    bitmap.close();
    return tex;
}

function createSphereGeometry(segments = 32, rings = 16) {
    const positions = [], normals = [], uvs = [], indices = [];
    for (let y = 0; y <= rings; y++) {
        const v = y / rings;
        const theta = v * Math.PI;
        const sinTheta = Math.sin(theta), cosTheta = Math.cos(theta);
        for (let x = 0; x <= segments; x++) {
            const u = x / segments;
            const phi = u * Math.PI * 2;
            const nx = Math.cos(phi) * sinTheta, ny = cosTheta, nz = Math.sin(phi) * sinTheta;
            positions.push(nx, ny, nz);
            normals.push(nx, ny, nz);
            uvs.push(1 - u, v);
        }
    }
    for (let y = 0; y < rings; y++) {
        for (let x = 0; x < segments; x++) {
            const a = y * (segments + 1) + x;
            const b = a + segments + 1;
            indices.push(a, b, a + 1, b, b + 1, a + 1);
        }
    }
    return { positions: new Float32Array(positions), normals: new Float32Array(normals), uvs: new Float32Array(uvs), indices: new Uint16Array(indices) };
}

function createInitialStates() {
    const states = new Float32Array(COUNT * STATE_FLOATS);
    let i = 0;
    for (let rowIndex = 0; rowIndex < ROWS.length; rowIndex++) {
        for (let col = 0; col < ROWS[rowIndex].length; col++) {
            const base = i * STATE_FLOATS;
            const seed = ((col * 17 + rowIndex * 31) % 97) / 97;
            states[base + 0] = -10 + col * 1.5 + seed * 0.08;
            states[base + 1] = SPAWN_Y_OFFSET + (ROWS.length - 1 - rowIndex) * 1.2 + seed * 0.08;
            states[base + 2] = seed * 0.12;
            states[base + 3] = seed;
            states[base + 4] = ((col % 3) - 1) * 0.035;
            states[base + 5] = -0.05;
            states[base + 6] = ((rowIndex % 3) - 1) * 0.03;
            states[base + 11] = 1;
            states[base + 12] = seed * 0.6;
            states[base + 13] = seed * 0.3;
            states[base + 14] = -seed * 0.4;
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
        -Math.PI / 180 * 60, Math.PI / 180 * 64, 26,
        BABYLON.Vector3.Zero(), scene);
    camera.setTarget(new BABYLON.Vector3(0, 4, 0));
    camera.attachControl(canvas, true);
    camera.minZ = 0.1;
    camera.maxZ = 150;

    const cubeTexture = new BABYLON.CubeTexture(
        BASE_URL + '/textures/env/papermillSpecularHDR.env', scene);
    scene.createDefaultSkybox(cubeTexture, true);
    scene.environmentTexture = cubeTexture;
    new BABYLON.HemisphericLight('light0', new BABYLON.Vector3(0.4, 1, 0.3), scene);

    await waitForReady(cubeTexture);

    const ground = BABYLON.MeshBuilder.CreateGround('ground', { width: 30, height: 30 }, scene);
    ground.position.y = GROUND_Y;
    const groundMat = new BABYLON.PBRMaterial('groundMat', scene);
    groundMat.metallic = 0;
    groundMat.roughness = 0.95;
    groundMat.albedoColor = new BABYLON.Color3(0.36, 0.56, 0.34);
    ground.material = groundMat;

    // ============================================================
    // Custom WebGPU path (shares Babylon's device)
    // ============================================================
    const device = engine._device;

    const footballTex = await loadTexture(device, TEXTURE_FOOTBALL);
    const footballTexView = footballTex.createView();
    const texSampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });

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

    const sphere = createSphereGeometry();
    const positionBuffer = mkVB(sphere.positions);
    const normalBuffer = mkVB(sphere.normals);
    const uvBuffer = mkVB(sphere.uvs);
    const indexBuffer = mkIB(sphere.indices);

    // Sphere collider wireframe (three great circles).
    const wireData = [];
    {
        const seg = 32;
        const ring = (axis) => {
            for (let k = 0; k < seg; k++) {
                const a0 = (k / seg) * Math.PI * 2, a1 = ((k + 1) / seg) * Math.PI * 2;
                const p = (a) => {
                    const c = Math.cos(a), s = Math.sin(a);
                    if (axis === 0) return [0, c, s];
                    if (axis === 1) return [c, 0, s];
                    return [c, s, 0];
                };
                wireData.push(...p(a0), ...p(a1));
            }
        };
        ring(0); ring(1); ring(2);
    }
    const wireVertexBuffer = mkVB(new Float32Array(wireData));
    const wireVertCount = wireData.length / 3;

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
    const simUbo = device.createBuffer({ size: 12 * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    // Physics: spheres with gravity, floor contact + rolling, O(N^2) sphere-sphere collision,
    // and recycling of footballs that leave the play area.
    const computeWGSL = `
struct BallState { position:vec4<f32>, velocity:vec4<f32>, rotation:vec4<f32>, angularVel:vec4<f32>, }
struct SimParams {
    dt:f32, gravity:f32, groundY:f32, restitution:f32,
    damping:f32, friction:f32, radius:f32, elapsedTime:f32,
    groundHalf:f32, pad0:f32, pad1:f32, pad2:f32,
}
const COUNT : u32 = ${COUNT}u;
@group(0) @binding(0) var<storage, read>       srcStates : array<BallState>;
@group(0) @binding(1) var<storage, read_write> dstStates : array<BallState>;
@group(0) @binding(2) var<uniform>             params    : SimParams;

fn quatMul(a : vec4<f32>, b : vec4<f32>) -> vec4<f32> {
    return vec4<f32>(
        a.w*b.x + a.x*b.w + a.y*b.z - a.z*b.y,
        a.w*b.y - a.x*b.z + a.y*b.w + a.z*b.x,
        a.w*b.z + a.x*b.y - a.y*b.x + a.z*b.w,
        a.w*b.w - a.x*b.x - a.y*b.y - a.z*b.z,
    );
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id : vec3<u32>) {
    let i = id.x;
    if (i >= COUNT) { return; }

    var pos = srcStates[i].position.xyz;
    var vel = srcStates[i].velocity.xyz;
    var rot = srcStates[i].rotation;
    var angVel = srcStates[i].angularVel.xyz;
    let seed = srcStates[i].position.w;
    let r = params.radius;
    let minDist = r * 2.0;

    vel.y -= params.gravity * params.dt;
    vel *= params.damping;
    pos += vel * params.dt;
    angVel *= 0.995;

    let onGroundPlane = abs(pos.x) < params.groundHalf && abs(pos.z) < params.groundHalf;
    if (onGroundPlane && pos.y - r < params.groundY) {
        let impactSpeed = max(-vel.y, 0.0);
        pos.y = params.groundY + r;
        if (impactSpeed > 0.0) {
            let bounceSpeed = impactSpeed * params.restitution;
            vel.y = select(bounceSpeed, max(bounceSpeed, 0.22), impactSpeed > 0.55);
        }
        let tangentDecay = max(1.0 - params.friction, 0.0);
        vel.x *= tangentDecay;
        vel.z *= tangentDecay;
        let rolling = vec3<f32>(-vel.z / max(r, 0.001), angVel.y * 0.8, vel.x / max(r, 0.001));
        angVel = mix(angVel, rolling, 0.18);
        if (abs(vel.y) < 0.03) { vel.y = 0.0; }
    }

    for (var j = 0u; j < COUNT; j++) {
        if (j == i) { continue; }
        let other = srcStates[j];
        var delta = pos - other.position.xyz;
        var dist = length(delta);
        if (dist < 0.0001) {
            let a = params.elapsedTime + seed * 6.28318;
            delta = vec3<f32>(cos(a), 0.2, sin(a)) * 0.001;
            dist = length(delta);
        }
        if (dist < minDist) {
            let n = delta / dist;
            let penetration = minDist - dist;
            pos += n * penetration * 0.52;
            let relVel = vel - other.velocity.xyz;
            let vn = dot(relVel, n);
            if (vn < 0.0) {
                vel += n * (-(1.0 + params.restitution) * vn * 0.65);
            }
            let tangent = relVel - n * vn;
            let tangentLen = length(tangent);
            if (tangentLen > 0.0001) {
                let t = tangent / tangentLen;
                vel -= t * min(tangentLen * params.friction, 0.12);
                angVel += cross(n, t) * tangentLen * 0.11;
            }
        }
    }

    let speed = length(angVel);
    if (speed > 0.0001) {
        let axis = angVel / speed;
        let halfAngle = speed * params.dt * 0.5;
        let dq = vec4<f32>(axis * sin(halfAngle), cos(halfAngle));
        rot = normalize(quatMul(dq, rot));
    }

    if (pos.y < params.groundY - 12.0 || abs(pos.x) > params.groundHalf + 16.0 || abs(pos.z) > params.groundHalf + 16.0) {
        let col = f32(i % 16u);
        let row = f32(i / 16u);
        pos = vec3<f32>(-10.0 + col * 1.5, 16.0 + (15.0 - row) * 1.2, seed * 0.2);
        vel = vec3<f32>((seed - 0.5) * 0.08, -0.05, (0.5 - seed) * 0.08);
        rot = vec4<f32>(0.0, 0.0, 0.0, 1.0);
        angVel = vec3<f32>(seed * 0.6, seed * 0.3, -seed * 0.4);
    }

    dstStates[i].position = vec4<f32>(pos, seed);
    dstStates[i].velocity = vec4<f32>(vel, 0.0);
    dstStates[i].rotation = rot;
    dstStates[i].angularVel = vec4<f32>(angVel, 0.0);
}
`;

    const renderWGSL = `
struct Camera { viewProjection : mat4x4<f32>, }
struct BallState { position:vec4<f32>, velocity:vec4<f32>, rotation:vec4<f32>, angularVel:vec4<f32>, }
struct VSOut {
    @builtin(position) position : vec4<f32>,
    @location(0) normal : vec3<f32>,
    @location(1) uv : vec2<f32>,
    @location(2) tint : vec3<f32>,
}
const RADIUS : f32 = ${RADIUS};
@group(0) @binding(0) var<uniform>       camera : Camera;
@group(0) @binding(1) var<storage, read> states : array<BallState>;
@group(0) @binding(2) var<storage, read> colors : array<vec4<f32>>;
@group(0) @binding(3) var                texSampler : sampler;
@group(0) @binding(4) var                tex : texture_2d<f32>;
fn rotByQuat(v : vec3<f32>, q : vec4<f32>) -> vec3<f32> {
    let t = 2.0 * cross(q.xyz, v);
    return v + q.w * t + cross(q.xyz, t);
}
@vertex
fn vs(@location(0) position : vec3<f32>, @location(1) normal : vec3<f32>, @location(2) uv : vec2<f32>, @builtin(instance_index) instance : u32) -> VSOut {
    var out : VSOut;
    let state = states[instance];
    let worldPos = rotByQuat(position * RADIUS, state.rotation) + state.position.xyz;
    out.normal = normalize(rotByQuat(normal, state.rotation));
    out.uv = uv;
    out.tint = colors[instance].rgb;
    let clip = camera.viewProjection * vec4<f32>(worldPos, 1.0);
    out.position = vec4<f32>(clip.x, -clip.y, clip.z, clip.w);
    return out;
}
@fragment
fn fs(@location(0) normal : vec3<f32>, @location(1) uv : vec2<f32>, @location(2) tint : vec3<f32>) -> @location(0) vec4<f32> {
    let lightDir = normalize(vec3<f32>(0.55, 0.9, 0.35));
    let diffuse = max(dot(normalize(normal), lightDir), 0.25);
    let sampleColor = textureSample(tex, texSampler, uv).rgb;
    return vec4<f32>(pow(sampleColor * tint * diffuse, vec3<f32>(0.82)), 1.0);
}
`;

    const wireWGSL = `
struct Camera { viewProjection : mat4x4<f32>, }
struct BallState { position:vec4<f32>, velocity:vec4<f32>, rotation:vec4<f32>, angularVel:vec4<f32>, }
const RADIUS : f32 = ${RADIUS};
@group(0) @binding(0) var<uniform>       camera : Camera;
@group(0) @binding(1) var<storage, read> states : array<BallState>;
@vertex
fn vs(@location(0) position : vec3<f32>, @builtin(instance_index) instance : u32) -> @builtin(position) vec4<f32> {
    let worldPos = position * RADIUS + states[instance].position.xyz;
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
    const ballRtt = new BABYLON.RenderTargetTexture('ballRTT', rttSize, scene, {
        generateMipMaps: false,
        type: BABYLON.Constants.TEXTURETYPE_UNSIGNED_BYTE,
        format: BABYLON.Constants.TEXTUREFORMAT_RGBA,
    });
    const ballLayer = new BABYLON.Layer('ballLayer', null, scene, false);
    ballLayer.texture = ballRtt;
    ballLayer.alphaBlendingMode = BABYLON.Engine.ALPHA_COMBINE;

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
                { arrayStride: 8, attributes: [{ shaderLocation: 2, offset: 0, format: 'float32x2' }] },
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
            { binding: 3, resource: texSampler },
            { binding: 4, resource: footballTexView },
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
        const internalTex = ballRtt.getInternalTexture();
        if (!internalTex || !internalTex._hardwareTexture) return;
        const gpuTex = internalTex._hardwareTexture.underlyingResource;
        if (!gpuTex) return;

        const viewProj = camera.getViewMatrix().multiply(camera.getProjectionMatrix());
        device.queue.writeBuffer(camUbo, 0, new Float32Array(viewProj.toArray()));

        const dt = Math.min(engine.getDeltaTime() / 1000, 1 / 30);
        const time = (performance.now() - startTime) / 1000;
        device.queue.writeBuffer(simUbo, 0, new Float32Array([
            dt / SUBSTEPS, 9.8, GROUND_Y, RESTITUTION, LINEAR_DAMPING, FRICTION, RADIUS, time, GROUND_HALF, 0, 0, 0,
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
            pass.setVertexBuffer(2, uvBuffer);
            pass.setIndexBuffer(indexBuffer, 'uint16');
            pass.drawIndexed(sphere.indices.length, COUNT);
            if (showWireframe) {
                pass.setPipeline(wirePipeline);
                pass.setBindGroup(0, wireBindGroups[currentState]);
                pass.setVertexBuffer(0, wireVertexBuffer);
                pass.draw(wireVertCount, COUNT);
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
