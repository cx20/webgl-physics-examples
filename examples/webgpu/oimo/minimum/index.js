const vertexShaderWGSL = document.getElementById('vs').textContent;
const fragmentShaderWGSL = document.getElementById('fs').textContent;

let canvas;
let device;
let ctx;
let pipeline;
let vertexBuffer;
let texCoordBuffer;
let indexBuffer;
let indexNum;
let groundUniformBuffer;
let groundBindGroup;
let boxUniformBuffer;
let boxBindGroup;
let depthTexture;
let projectionMatrix;
let world;
let groundBody;
let boxBody;
let angle = 0;

async function init() {
    canvas = document.getElementById('c');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const gpu = navigator['gpu'];
    if (!gpu) {
        throw new Error('WebGPU is not supported in this browser.');
    }

    const adapter = await gpu.requestAdapter();
    if (!adapter) {
        throw new Error('Failed to get GPU adapter.');
    }

    device = await adapter.requestDevice();

    // Setup context
    ctx = canvas.getContext('webgpu');
    const format = gpu.getPreferredCanvasFormat();
    ctx.configure({
        device: device,
        format: format,
        alphaMode: 'opaque'
    });

    // Setup matrices
    const aspect = canvas.width / canvas.height;
    projectionMatrix = mat4.create();
    mat4.perspective(projectionMatrix, 45, aspect, 0.1, 1000.0);

    // Create shaders
    const vShaderModule = device.createShaderModule({ code: vertexShaderWGSL });
    const fShaderModule = device.createShaderModule({ code: fragmentShaderWGSL });

    // Cube geometry
    const positions = [
        // Front face
        -0.5, -0.5,  0.5,
         0.5, -0.5,  0.5,
         0.5,  0.5,  0.5,
        -0.5,  0.5,  0.5,
        // Back face
        -0.5, -0.5, -0.5,
         0.5, -0.5, -0.5,
         0.5,  0.5, -0.5,
        -0.5,  0.5, -0.5,
        // Top face
         0.5,  0.5,  0.5,
        -0.5,  0.5,  0.5,
        -0.5,  0.5, -0.5,
         0.5,  0.5, -0.5,
        // Bottom face
        -0.5, -0.5,  0.5,
         0.5, -0.5,  0.5,
         0.5, -0.5, -0.5,
        -0.5, -0.5, -0.5,
        // Right face
         0.5, -0.5,  0.5,
         0.5,  0.5,  0.5,
         0.5,  0.5, -0.5,
         0.5, -0.5, -0.5,
        // Left face
        -0.5, -0.5,  0.5,
        -0.5,  0.5,  0.5,
        -0.5,  0.5, -0.5,
        -0.5, -0.5, -0.5
    ];

    const textureCoords = [
        // Front face
        0.0, 0.0,
        1.0, 0.0,
        1.0, 1.0,
        0.0, 1.0,
        // Back face
        1.0, 0.0,
        1.0, 1.0,
        0.0, 1.0,
        0.0, 0.0,
        // Top face
        0.0, 1.0,
        0.0, 0.0,
        1.0, 0.0,
        1.0, 1.0,
        // Bottom face
        1.0, 1.0,
        0.0, 1.0,
        0.0, 0.0,
        1.0, 0.0,
        // Right face
        1.0, 0.0,
        1.0, 1.0,
        0.0, 1.0,
        0.0, 0.0,
        // Left face
        0.0, 0.0,
        1.0, 0.0,
        1.0, 1.0,
        0.0, 1.0
    ];

    const indices = [
         0,  1,  2,  0,  2,  3,
         4,  5,  6,  4,  6,  7,
         8,  9, 10,  8, 10, 11,
        12, 13, 14, 12, 14, 15,
        16, 17, 18, 16, 18, 19,
        20, 21, 22, 20, 22, 23
    ];

    vertexBuffer = makeVertexBuffer(new Float32Array(positions));
    texCoordBuffer = makeVertexBuffer(new Float32Array(textureCoords));
    indexBuffer = makeIndexBuffer(new Uint32Array(indices));
    indexNum = indices.length;

    // Create pipeline
    pipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: {
            module: vShaderModule,
            entryPoint: 'main',
            buffers: [
                {
                    arrayStride: 3 * 4,
                    attributes: [
                        {
                            shaderLocation: 0,
                            offset: 0,
                            format: 'float32x3'
                        }
                    ]
                },
                {
                    arrayStride: 2 * 4,
                    attributes: [
                        {
                            shaderLocation: 1,
                            offset: 0,
                            format: 'float32x2'
                        }
                    ]
                }
            ]
        },
        fragment: {
            module: fShaderModule,
            entryPoint: 'main',
            targets: [
                {
                    format: format
                }
            ]
        },
        primitive: {
            topology: 'triangle-list'
        },
        depthStencil: {
            depthWriteEnabled: true,
            depthCompare: 'less',
            format: 'depth24plus-stencil8'
        }
    });

    // Create uniform buffers (one per object to avoid data races)
    const uniformBufferSize = 4 * 16;
    groundUniformBuffer = device.createBuffer({
        size: uniformBufferSize,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    boxUniformBuffer = device.createBuffer({
        size: uniformBufferSize,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Load texture
    const cubeTexture = await createTextureFromImage('../../../../assets/textures/frog.jpg');
    
    // Create sampler
    const sampler = device.createSampler({
        magFilter: 'linear',
        minFilter: 'linear',
    });

    groundBindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [{
            binding: 0,
            resource: { buffer: groundUniformBuffer },
        }, {
            binding: 1,
            resource: sampler,
        }, {
            binding: 2,
            resource: cubeTexture.createView(),
        }],
    });

    boxBindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [{
            binding: 0,
            resource: { buffer: boxUniformBuffer },
        }, {
            binding: 1,
            resource: sampler,
        }, {
            binding: 2,
            resource: cubeTexture.createView(),
        }],
    });

    // Create depth texture
    depthTexture = device.createTexture({
        size: {
            width: canvas.width,
            height: canvas.height,
            depthOrArrayLayers: 1
        },
        format: 'depth24plus-stencil8',
        usage: GPUTextureUsage.RENDER_ATTACHMENT
    });

    // Initialize physics
    initWorld();
    addGround();
    addBox();

    // Start render loop
    requestAnimationFrame(render);
}

function initWorld() {
    world = new OIMO.World({
        timestep: 1 / 60,
        iterations: 8,
        broadphase: 2,
        worldscale: 1,
        random: true,
        info: false,
        gravity: [0, -9.8, 0]
    });
}

function addGround() {
    groundBody = world.add({
        type: 'box',
        size: [200, 4, 200],
        pos: [0, 0, 0],
        rot: [0, 0, 0],
        move: false,
        density: 1
    });
}

function addBox() {
    boxBody = world.add({
        type: 'box',
        size: [50, 50, 50],
        pos: [0, 100, 0],
        rot: [10, 10, 10],
        move: true,
        density: 1
    });
}

function makeVertexBuffer(data) {
    const buffer = device.createBuffer({
        size: data.byteLength,
        usage: GPUBufferUsage.VERTEX,
        mappedAtCreation: true
    });
    new Float32Array(buffer.getMappedRange()).set(data);
    buffer.unmap();
    return buffer;
}

function makeIndexBuffer(data) {
    const buffer = device.createBuffer({
        size: data.byteLength,
        usage: GPUBufferUsage.INDEX,
        mappedAtCreation: true
    });
    new Uint32Array(buffer.getMappedRange()).set(data);
    buffer.unmap();
    return buffer;
}

async function createTextureFromImage(src) {
    const img = document.createElement('img');
    img.src = src;
    await img.decode();
    const imageBitmap = await createImageBitmap(img);

    const texture = device.createTexture({
        size: [imageBitmap.width, imageBitmap.height, 1],
        format: 'rgba8unorm',
        usage:
            GPUTextureUsage.TEXTURE_BINDING |
            GPUTextureUsage.COPY_DST |
            GPUTextureUsage.RENDER_ATTACHMENT
    });
    device.queue.copyExternalImageToTexture(
        { source: imageBitmap },
        { texture: texture },
        [imageBitmap.width, imageBitmap.height, 1]
    );
    return texture;
}

async function render() {
    world.step();

    // Calculate view matrix
    angle -= Math.PI / 180 * 0.1;
    const eyePos = vec3.fromValues(
        200 * Math.sin(angle),
        50,
        200 * Math.cos(angle)
    );
    const centerPos = vec3.fromValues(0, 0, 0);
    const upVec = vec3.fromValues(0, 1, 0);

    const viewMatrix = mat4.create();
    mat4.lookAt(viewMatrix, eyePos, centerPos, upVec);

    const textureView = ctx.getCurrentTexture().createView();

    // Draw ground
    {
        const groundPosition = groundBody.getPosition();
        const groundRotation = groundBody.getQuaternion();
        const groundQuaternion = quat.fromValues(groundRotation.x, groundRotation.y, groundRotation.z, groundRotation.w);
        
        const groundWorldMatrix = mat4.create();
        const groundTranslation = vec3.fromValues(groundPosition.x, groundPosition.y, groundPosition.z);
        mat4.translate(groundWorldMatrix, groundWorldMatrix, groundTranslation);
        const groundRotationMatrix = mat4.create();
        mat4.fromQuat(groundRotationMatrix, groundQuaternion);
        mat4.multiply(groundWorldMatrix, groundWorldMatrix, groundRotationMatrix);
        mat4.scale(groundWorldMatrix, groundWorldMatrix, [200, 4, 200]);

        const groundMVPMatrix = mat4.create();
        mat4.multiply(groundMVPMatrix, projectionMatrix, viewMatrix);
        mat4.multiply(groundMVPMatrix, groundMVPMatrix, groundWorldMatrix);

        const groundMVP = new Float32Array(groundMVPMatrix);
        const commandEncoder = device.createCommandEncoder();
        device.queue.writeBuffer(groundUniformBuffer, 0, groundMVP);

        const renderPassDescriptor = {
            colorAttachments: [{
                view: textureView,
                loadOp: 'clear',
                clearValue: { r: 1, g: 1, b: 1, a: 1 },
                storeOp: 'store'
            }],
            depthStencilAttachment: {
                view: depthTexture.createView(),
                depthClearValue: 1.0,
                depthLoadOp: 'clear',
                depthStoreOp: 'store',
                stencilClearValue: 0,
                stencilLoadOp: 'clear',
                stencilStoreOp: 'store'
            }
        };

        const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);
        passEncoder.setPipeline(pipeline);
        passEncoder.setVertexBuffer(0, vertexBuffer);
        passEncoder.setVertexBuffer(1, texCoordBuffer);
        passEncoder.setIndexBuffer(indexBuffer, 'uint32');
        passEncoder.setBindGroup(0, groundBindGroup);
        passEncoder.drawIndexed(indexNum, 1, 0, 0, 0);

        // Draw cube in the same render pass
        const boxPosition = boxBody.getPosition();
        const boxRotation = boxBody.getQuaternion();
        const boxQuaternion = quat.fromValues(boxRotation.x, boxRotation.y, boxRotation.z, boxRotation.w);

        const boxWorldMatrix = mat4.create();
        const boxTranslation = vec3.fromValues(boxPosition.x, boxPosition.y, boxPosition.z);
        mat4.translate(boxWorldMatrix, boxWorldMatrix, boxTranslation);
        const boxRotationMatrix = mat4.create();
        mat4.fromQuat(boxRotationMatrix, boxQuaternion);
        mat4.multiply(boxWorldMatrix, boxWorldMatrix, boxRotationMatrix);
        mat4.scale(boxWorldMatrix, boxWorldMatrix, [50, 50, 50]);

        const boxMVPMatrix = mat4.create();
        mat4.multiply(boxMVPMatrix, projectionMatrix, viewMatrix);
        mat4.multiply(boxMVPMatrix, boxMVPMatrix, boxWorldMatrix);

        device.queue.writeBuffer(boxUniformBuffer, 0, new Float32Array(boxMVPMatrix));

        passEncoder.setBindGroup(0, boxBindGroup);
        passEncoder.drawIndexed(indexNum, 1, 0, 0, 0);

        passEncoder.end();
        device.queue.submit([commandEncoder.finish()]);
    }

    requestAnimationFrame(render);
}

init();