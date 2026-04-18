import Module from 'https://esm.run/manifold-3d';

const { mat4, vec3, quat } = glMatrix;

const BALL_COUNT = 160;
const BASKET_HALF = 5;
const WALL_RENDER_Y_OFFSET = 0.03;
const TEXTURE_FILES = [
    '../../../../assets/textures/Basketball.jpg',
    '../../../../assets/textures/BeachBall.jpg',
    '../../../../assets/textures/Football.jpg',
    '../../../../assets/textures/Softball.jpg',
    '../../../../assets/textures/TennisBall.jpg'
];

let canvas;
let gl;
let program;
let attribs;
let uniforms;
let sphereMesh;
let cubeMesh;
let textures = [];
let whiteTexture;

let world;
let balls = [];
let ground;
let basketWalls = [];

let viewProj = mat4.create();
let projection = mat4.create();
let view = mat4.create();
let model = mat4.create();

function resize() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';
    gl.viewport(0, 0, canvas.width, canvas.height);
}

function createShader(glCtx, type, source) {
    const shader = glCtx.createShader(type);
    glCtx.shaderSource(shader, source);
    glCtx.compileShader(shader);
    if (!glCtx.getShaderParameter(shader, glCtx.COMPILE_STATUS)) {
        throw new Error(glCtx.getShaderInfoLog(shader));
    }
    return shader;
}

function createProgram(glCtx, vsSource, fsSource) {
    const vs = createShader(glCtx, glCtx.VERTEX_SHADER, vsSource);
    const fs = createShader(glCtx, glCtx.FRAGMENT_SHADER, fsSource);
    const prog = glCtx.createProgram();
    glCtx.attachShader(prog, vs);
    glCtx.attachShader(prog, fs);
    glCtx.linkProgram(prog);
    if (!glCtx.getProgramParameter(prog, glCtx.LINK_STATUS)) {
        throw new Error(glCtx.getProgramInfoLog(prog));
    }
    return prog;
}

function sphericalUV(x, y, z) {
    const len = Math.hypot(x, y, z);
    if (len === 0) return [0.5, 0.5];
    const nx = x / len;
    const ny = y / len;
    const nz = z / len;
    const u = 0.5 - Math.atan2(nz, nx) / (2 * Math.PI);
    const v = 0.5 - Math.asin(Math.max(-1, Math.min(1, ny))) / Math.PI;
    return [u, v];
}

function boxUV(x, y, z) {
    const ax = Math.abs(x);
    const ay = Math.abs(y);
    const az = Math.abs(z);
    if (ax >= ay && ax >= az) return [(z / ax + 1) / 2, (y / ax + 1) / 2];
    if (ay >= ax && ay >= az) return [(x / ay + 1) / 2, (z / ay + 1) / 2];
    return [(x / az + 1) / 2, (y / az + 1) / 2];
}

function fixSeamUVs(uv0, uv1, uv2) {
    let u0 = uv0[0], u1 = uv1[0], u2 = uv2[0];
    if (Math.abs(u0 - u1) > 0.5) { if (u0 < u1) u0 += 1.0; else u1 += 1.0; }
    if (Math.abs(u1 - u2) > 0.5) { if (u1 < u2) u1 += 1.0; else u2 += 1.0; }
    if (Math.abs(u0 - u2) > 0.5) { if (u0 < u2) u0 += 1.0; else u2 += 1.0; }
    return [[u0, uv0[1]], [u1, uv1[1]], [u2, uv2[1]]];
}

function manifoldToArrays(manifold, uvFunc, options = {}) {
    const mesh = manifold.getMesh();
    const vertProps = mesh.vertProperties;
    const triVerts = mesh.triVerts;
    const smoothSphere = !!options.smoothSphere;
    const fixSeam = !!options.fixSeam;

    const positions = [];
    const normals = [];
    const uvs = [];

    for (let i = 0; i < triVerts.length; i += 3) {
        const i0 = triVerts[i];
        const i1 = triVerts[i + 1];
        const i2 = triVerts[i + 2];

        const p0 = [vertProps[i0 * 3], vertProps[i0 * 3 + 1], vertProps[i0 * 3 + 2]];
        const p1 = [vertProps[i1 * 3], vertProps[i1 * 3 + 1], vertProps[i1 * 3 + 2]];
        const p2 = [vertProps[i2 * 3], vertProps[i2 * 3 + 1], vertProps[i2 * 3 + 2]];

        positions.push(...p0, ...p1, ...p2);

        if (smoothSphere) {
            const n0 = vec3.normalize(vec3.create(), p0);
            const n1 = vec3.normalize(vec3.create(), p1);
            const n2 = vec3.normalize(vec3.create(), p2);
            normals.push(...n0, ...n1, ...n2);
        } else {
            const a = vec3.sub(vec3.create(), p1, p0);
            const b = vec3.sub(vec3.create(), p2, p0);
            const n = vec3.normalize(vec3.create(), vec3.cross(vec3.create(), a, b));
            normals.push(...n, ...n, ...n);
        }

        let uv0 = uvFunc(...p0);
        let uv1 = uvFunc(...p1);
        let uv2 = uvFunc(...p2);
        if (fixSeam) {
            [uv0, uv1, uv2] = fixSeamUVs(uv0, uv1, uv2);
        }
        uvs.push(...uv0, ...uv1, ...uv2);
    }

    return {
        positions: new Float32Array(positions),
        normals: new Float32Array(normals),
        uvs: new Float32Array(uvs),
        vertexCount: positions.length / 3
    };
}

function createMeshBuffers(data) {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);

    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, data.positions, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(attribs.position);
    gl.vertexAttribPointer(attribs.position, 3, gl.FLOAT, false, 0, 0);

    const normalBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, data.normals, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(attribs.normal);
    gl.vertexAttribPointer(attribs.normal, 3, gl.FLOAT, false, 0, 0);

    const uvBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, data.uvs, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(attribs.uv);
    gl.vertexAttribPointer(attribs.uv, 2, gl.FLOAT, false, 0, 0);

    gl.bindVertexArray(null);

    return {
        vao,
        vertexCount: data.vertexCount
    };
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
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.generateMipmap(gl.TEXTURE_2D);
            resolve(texture);
        };
        image.src = url;
    });
}

function createSolidTexture(r, g, b, a) {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        1,
        1,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        new Uint8Array([r, g, b, a])
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    return texture;
}

function initPhysics() {
    world = new OIMO.World({
        timestep: 1 / 60,
        iterations: 8,
        broadphase: 2,
        worldscale: 1,
        random: true,
        info: false,
        gravity: [0, -9.8, 0]
    });

    ground = { size: [40, 4, 40], pos: [0, -2, 0] };
    basketWalls = [
        { size: [9.6, 10, 0.8], pos: [0, 5, -5] },
        { size: [9.6, 10, 0.8], pos: [0, 5, 5] },
        { size: [0.8, 10, 9.6], pos: [-5, 5, 0] },
        { size: [0.8, 10, 9.6], pos: [5, 5, 0] }
    ];

    world.add({
        type: 'box',
        size: ground.size,
        pos: ground.pos,
        rot: [0, 0, 0],
        move: false,
        density: 1,
        friction: 0.6,
        restitution: 0.2
    });

    for (const wall of basketWalls) {
        world.add({
            type: 'box',
            size: wall.size,
            pos: wall.pos,
            rot: [0, 0, 0],
            move: false,
            density: 1,
            friction: 0.6,
            restitution: 0.2
        });
    }

    balls = [];
    for (let i = 0; i < BALL_COUNT; i++) {
        const radius = 0.5 + Math.random() * 0.45;
        const body = world.add({
            type: 'sphere',
            size: [radius],
            pos: [
                (Math.random() - 0.5) * (BASKET_HALF * 1.4),
                12 + Math.random() * 26,
                (Math.random() - 0.5) * (BASKET_HALF * 1.4)
            ],
            rot: [0, 0, 0],
            move: true,
            density: 1,
            friction: 0.4,
            restitution: 0.65
        });
        balls.push({
            body,
            radius,
            textureIndex: i % textures.length
        });
    }
}

function drawMesh(mesh, texture, tint, transform) {
    gl.bindVertexArray(mesh.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniformMatrix4fv(uniforms.model, false, transform);
    gl.uniform3fv(uniforms.tint, tint);
    gl.drawArrays(gl.TRIANGLES, 0, mesh.vertexCount);
}

function render(timeMs) {
    world.step();

    for (const item of balls) {
        const p = item.body.getPosition();
        if (p.y < -20) {
            item.body.resetPosition(
                (Math.random() - 0.5) * (BASKET_HALF * 1.4),
                20 + Math.random() * 16,
                (Math.random() - 0.5) * (BASKET_HALF * 1.4)
            );
        }
    }

    const t = timeMs * 0.001;
    const eye = vec3.fromValues(Math.sin(t * 0.2) * 28, 18, Math.cos(t * 0.2) * 28);
    mat4.lookAt(view, eye, [0, 5, 0], [0, 1, 0]);
    mat4.perspective(projection, Math.PI / 4, canvas.width / canvas.height, 0.1, 200);
    mat4.multiply(viewProj, projection, view);

    gl.clearColor(0.97, 0.97, 0.98, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.useProgram(program);
    gl.uniformMatrix4fv(uniforms.viewProj, false, viewProj);
    gl.uniform3f(uniforms.lightDir, 0.6, 0.9, 0.4);
    gl.uniform1f(uniforms.alpha, 1.0);

    mat4.fromRotationTranslationScale(model, quat.create(), ground.pos, ground.size);
    drawMesh(cubeMesh, whiteTexture, [0.22, 0.22, 0.24], model);

    for (const item of balls) {
        const p = item.body.getPosition();
        const q = item.body.getQuaternion();
        const rotation = quat.fromValues(q.x, q.y, q.z, q.w);
        const s = vec3.fromValues(item.radius, item.radius, item.radius);
        const tr = vec3.fromValues(p.x, p.y, p.z);
        mat4.fromRotationTranslationScale(model, rotation, tr, s);
        drawMesh(sphereMesh, textures[item.textureIndex], [1, 1, 1], model);
    }

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.uniform1f(uniforms.alpha, 0.28);

    for (const wall of basketWalls) {
        const wallPos = [wall.pos[0], wall.pos[1] + WALL_RENDER_Y_OFFSET, wall.pos[2]];
        mat4.fromRotationTranslationScale(model, quat.create(), wallPos, wall.size);
        drawMesh(cubeMesh, whiteTexture, [0.25, 0.28, 0.3], model);
    }

    gl.depthMask(true);
    gl.disable(gl.BLEND);

    requestAnimationFrame(render);
}

async function main() {
    canvas = document.getElementById('c');
    gl = canvas.getContext('webgl2');
    if (!gl) throw new Error('WebGL 2.0 is not supported.');

    resize();
    window.addEventListener('resize', resize);

    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);

    program = createProgram(
        gl,
        document.getElementById('vs').textContent,
        document.getElementById('fs').textContent
    );
    gl.useProgram(program);

    attribs = {
        position: gl.getAttribLocation(program, 'aPosition'),
        normal: gl.getAttribLocation(program, 'aNormal'),
        uv: gl.getAttribLocation(program, 'aTexCoord')
    };
    uniforms = {
        viewProj: gl.getUniformLocation(program, 'uViewProj'),
        model: gl.getUniformLocation(program, 'uModel'),
        texture: gl.getUniformLocation(program, 'uTexture'),
        tint: gl.getUniformLocation(program, 'uTint'),
        lightDir: gl.getUniformLocation(program, 'uLightDir'),
        alpha: gl.getUniformLocation(program, 'uAlpha')
    };
    gl.uniform1i(uniforms.texture, 0);

    const wasm = await Module();
    wasm.setup();
    const { Manifold } = wasm;

    const sphere = Manifold.sphere(1.0, 64);
    const sphereData = manifoldToArrays(sphere, sphericalUV, { smoothSphere: true, fixSeam: true });
    sphere.delete();

    const cube = Manifold.cube([1, 1, 1], true);
    const cubeData = manifoldToArrays(cube, boxUV, { smoothSphere: false, fixSeam: false });
    cube.delete();

    sphereMesh = createMeshBuffers(sphereData);
    cubeMesh = createMeshBuffers(cubeData);

    textures = await Promise.all(TEXTURE_FILES.map(loadTexture));
    whiteTexture = createSolidTexture(255, 255, 255, 255);

    initPhysics();
    requestAnimationFrame(render);
}

main().catch((err) => {
    console.error(err);
});
