const { mat4, vec3, quat } = glMatrix;

const CONE_COUNT = 140;
const BASKET_HALF = 3.0;
const WALL_RENDER_Y_OFFSET = 0.03;
const CONE_TEXTURE = '../../../../assets/textures/carrot.jpg';

let canvas;
let gl;
let program;
let attribs;
let uniforms;
let coneMesh;
let cubeMesh;
let coneTexture;
let whiteTexture;

let world;
let cones = [];
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

function generateCubeMesh() {
    const p = [
        -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5,
        -0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5,
        0.5, -0.5, -0.5, -0.5, -0.5, -0.5, -0.5, 0.5, -0.5,
        0.5, -0.5, -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5,
        -0.5, -0.5, -0.5, -0.5, -0.5, 0.5, -0.5, 0.5, 0.5,
        -0.5, -0.5, -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, -0.5,
        0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5,
        0.5, -0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5,
        -0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, -0.5,
        -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, -0.5, 0.5, -0.5,
        -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, -0.5, 0.5,
        -0.5, -0.5, -0.5, 0.5, -0.5, 0.5, -0.5, -0.5, 0.5
    ];
    const n = [
        0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1,
        0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1,
        -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0,
        1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0,
        0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0,
        0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0
    ];
    const u = [
        0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1,
        0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1,
        0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1,
        0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1,
        0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1,
        0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1
    ];
    return {
        positions: new Float32Array(p),
        normals: new Float32Array(n),
        uvs: new Float32Array(u),
        vertexCount: p.length / 3
    };
}

function generateConeMesh(segments) {
    const positions = [];
    const normals = [];
    const uvs = [];

    for (let i = 0; i < segments; i++) {
        const a0 = (i / segments) * Math.PI * 2;
        const a1 = ((i + 1) / segments) * Math.PI * 2;
        const x0 = Math.cos(a0);
        const z0 = Math.sin(a0);
        const x1 = Math.cos(a1);
        const z1 = Math.sin(a1);

        const p0 = [x0, -0.5, z0];
        const p1 = [x1, -0.5, z1];
        const apex = [0, 0.5, 0];

        const e1 = vec3.sub(vec3.create(), p1, p0);
        const e2 = vec3.sub(vec3.create(), apex, p0);
        const sideN = vec3.normalize(vec3.create(), vec3.cross(vec3.create(), e1, e2));

        positions.push(...p0, ...p1, ...apex);
        normals.push(...sideN, ...sideN, ...sideN);
        uvs.push(i / segments, 0, (i + 1) / segments, 0, (i + 0.5) / segments, 1);

        const center = [0, -0.5, 0];
        const baseN = [0, -1, 0];
        positions.push(...center, ...p1, ...p0);
        normals.push(...baseN, ...baseN, ...baseN);
        uvs.push(0.5, 0.5, 0.5 + x1 * 0.5, 0.5 + z1 * 0.5, 0.5 + x0 * 0.5, 0.5 + z0 * 0.5);
    }

    return {
        positions: new Float32Array(positions),
        normals: new Float32Array(normals),
        uvs: new Float32Array(uvs),
        vertexCount: positions.length / 3
    };
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

    ground = { size: [20, 2, 20], pos: [0, -2, 0] };
    basketWalls = [
        { size: [6.2, 5, 0.5], pos: [0, 1.5, -3.2] },
        { size: [6.2, 5, 0.5], pos: [0, 1.5, 3.2] },
        { size: [0.5, 5, 6.2], pos: [-3.2, 1.5, 0] },
        { size: [0.5, 5, 6.2], pos: [3.2, 1.5, 0] }
    ];

    world.add({ type: 'box', size: ground.size, pos: ground.pos, rot: [0, 0, 0], move: false, density: 1, friction: 0.6, restitution: 0.2 });

    for (const wall of basketWalls) {
        world.add({ type: 'box', size: wall.size, pos: wall.pos, rot: [0, 0, 0], move: false, density: 1, friction: 0.5, restitution: 0.2 });
    }

    cones = [];
    for (let i = 0; i < CONE_COUNT; i++) {
        const radius = 0.45 + Math.random() * 0.3;
        const height = 1.2 + Math.random() * 1.0;
        const body = world.add({
            type: 'cylinder',
            size: [radius, height, radius],
            pos: [
                (Math.random() - 0.5) * (BASKET_HALF * 1.5),
                6 + Math.random() * 14,
                (Math.random() - 0.5) * (BASKET_HALF * 1.5)
            ],
            rot: [Math.random() * 20, Math.random() * 360, Math.random() * 20],
            move: true,
            density: 1,
            friction: 0.55,
            restitution: 0.1
        });
        cones.push({ body, radius, height });
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

    for (const item of cones) {
        const p = item.body.getPosition();
        if (p.y < -20) {
            item.body.resetPosition(
                (Math.random() - 0.5) * (BASKET_HALF * 1.5),
                9 + Math.random() * 8,
                (Math.random() - 0.5) * (BASKET_HALF * 1.5)
            );
        }
    }

    const t = timeMs * 0.001;
    const eye = vec3.fromValues(Math.sin(t * 0.2) * 24, 12, Math.cos(t * 0.2) * 24);
    mat4.lookAt(view, eye, [0, 3, 0], [0, 1, 0]);
    mat4.perspective(projection, Math.PI / 4, canvas.width / canvas.height, 0.1, 150);
    mat4.multiply(viewProj, projection, view);

    gl.clearColor(0.97, 0.97, 0.98, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.useProgram(program);
    gl.uniformMatrix4fv(uniforms.viewProj, false, viewProj);
    gl.uniform3f(uniforms.lightDir, 0.6, 0.9, 0.4);
    gl.uniform1f(uniforms.alpha, 1.0);

    mat4.fromRotationTranslationScale(model, quat.create(), ground.pos, ground.size);
    drawMesh(cubeMesh, whiteTexture, [0.22, 0.22, 0.24], model);

    for (const item of cones) {
        const p = item.body.getPosition();
        const q = item.body.getQuaternion();
        const rotation = quat.fromValues(q.x, q.y, q.z, q.w);
        const s = vec3.fromValues(item.radius, item.height, item.radius);
        const tr = vec3.fromValues(p.x, p.y, p.z);
        mat4.fromRotationTranslationScale(model, rotation, tr, s);
        drawMesh(coneMesh, coneTexture, [1, 1, 1], model);
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

    coneMesh = createMeshBuffers(generateConeMesh(48));
    cubeMesh = createMeshBuffers(generateCubeMesh());

    coneTexture = await loadTexture(CONE_TEXTURE);
    whiteTexture = createSolidTexture(255, 255, 255, 255);

    initPhysics();
    requestAnimationFrame(render);
}

main().catch((err) => {
    console.error(err);
});
