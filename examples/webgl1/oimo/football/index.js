import Module from 'https://esm.run/manifold-3d';

const { mat4, vec3, quat } = glMatrix;

const DOT_ROWS = [
    '.............ppp',
    '......rrrrr..ppp',
    '.....rrrrrrrrrpp',
    '.....nnnppnp.rrr',
    '....npnpppnpprrr',
    '....npnnpppnpppr',
    '....nnppppnnnnr.',
    '......pppppppr..',
    '..rrrrrbrrrbr...',
    '.rrrrrrrrbrrrb..n',
    'pprrrrrrbbbbb..n',
    'ppp.bbrbbybbybnn',
    '.p.nbbbbbbbbbbnn',
    '..nnnbbbbbbbbbnn',
    '.nnnbbbbbbb.....',
    '.n..bbbb........'
];
const BALL_COUNT = DOT_ROWS.length * DOT_ROWS[0].length;
const TEXTURE_FILES = [
    '../../../../assets/textures/Football.jpg'
];
const GROUND_TEXTURE_FILE = '../../../../assets/textures/grass.jpg';
const GROUND_UV_REPEAT = 6;

let canvas;
let gl;
let program;
let attribs;
let uniforms;
let sphereMesh;
let cubeMesh;
let groundMesh;
let textures = [];
let groundTexture;

let world;
let balls = [];
let ground;

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
    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, data.positions, gl.STATIC_DRAW);

    const normalBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, data.normals, gl.STATIC_DRAW);

    const uvBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, data.uvs, gl.STATIC_DRAW);

    return {
        positionBuffer,
        normalBuffer,
        uvBuffer,
        vertexCount: data.vertexCount
    };
}

function createGroundPlaneData(repeat) {
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
        repeat, 0,
        repeat, repeat,
        0, 0,
        repeat, repeat,
        0, repeat
    ]);

    return {
        positions,
        normals,
        uvs,
        vertexCount: 6
    };
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

function getTintColor(code) {
    const colorHash = {
        '.': [0xDC / 255, 0xAA / 255, 0x6B / 255],
        'p': [1.0, 0xCC / 255, 0xCC / 255],
        'n': [0x80 / 255, 0.0, 0.0],
        'r': [1.0, 0.0, 0.0],
        'y': [1.0, 1.0, 0.0],
        'b': [0.0, 0.0, 1.0]
    };
    return colorHash[code] || [1.0, 1.0, 1.0];
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

    ground = { size: [30, 0.4, 30], pos: [0, -2, 0] };

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

    balls = [];
    const boxSize = 1;
    for (let y = 0; y < DOT_ROWS.length; y++) {
        const row = DOT_ROWS[y];
        for (let x = 0; x < row.length; x++) {
            const radius = boxSize * 0.5;
            const body = world.add({
                type: 'sphere',
                size: [radius],
                pos: [
                    -10 + x * boxSize * 1.5 + Math.random() * 0.1,
                    (DOT_ROWS.length - 1 - y) * boxSize * 1.2 + Math.random() * 0.1,
                    Math.random() * 0.1
                ],
                rot: [0, 0, 0],
                move: true,
                density: 1,
                friction: 0.4,
                restitution: 0.6
            });

            balls.push({
                body,
                radius,
                textureIndex: 0,
                tint: getTintColor(row[x])
            });
        }
    }
}

function drawMesh(mesh, texture, tint, transform) {
    bindMesh(mesh);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniformMatrix4fv(uniforms.model, false, transform);
    gl.uniform3fv(uniforms.tint, tint);
    gl.drawArrays(gl.TRIANGLES, 0, mesh.vertexCount);
}

function render(timeMs) {
    world.step();

    const t = timeMs * 0.001;
    const eye = vec3.fromValues(Math.sin(t * 0.2) * 20, 10, Math.cos(t * 0.2) * 20);
    mat4.lookAt(view, eye, [0, 8, 0], [0, 1, 0]);
    mat4.perspective(projection, Math.PI / 4, canvas.width / canvas.height, 0.1, 120);
    mat4.multiply(viewProj, projection, view);

    gl.clearColor(0.97, 0.97, 0.98, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.useProgram(program);
    gl.uniformMatrix4fv(uniforms.viewProj, false, viewProj);
    gl.uniform3f(uniforms.lightDir, 0.6, 0.9, 0.4);
    gl.uniform1f(uniforms.alpha, 1.0);

    mat4.fromRotationTranslationScale(model, quat.create(), ground.pos, ground.size);
    drawMesh(groundMesh, groundTexture, [1, 1, 1], model);

    for (const item of balls) {
        const p = item.body.getPosition();
        const q = item.body.getQuaternion();
        const rotation = quat.fromValues(q.x, q.y, q.z, q.w);
        const s = vec3.fromValues(item.radius, item.radius, item.radius);
        const tr = vec3.fromValues(p.x, p.y, p.z);
        mat4.fromRotationTranslationScale(model, rotation, tr, s);
        drawMesh(sphereMesh, textures[item.textureIndex], item.tint, model);
    }

    requestAnimationFrame(render);
}

async function main() {
    canvas = document.getElementById('c');
    gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!gl) throw new Error('WebGL 1.0 is not supported.');

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

    const sphere = Manifold.sphere(1.0, 48);
    const sphereData = manifoldToArrays(sphere, sphericalUV, { smoothSphere: true, fixSeam: true });
    sphere.delete();

    const cube = Manifold.cube([1, 1, 1], true);
    const cubeData = manifoldToArrays(cube, boxUV, { smoothSphere: false, fixSeam: false });
    cube.delete();
    const groundData = createGroundPlaneData(GROUND_UV_REPEAT);

    sphereMesh = createMeshBuffers(sphereData);
    cubeMesh = createMeshBuffers(cubeData);
    groundMesh = createMeshBuffers(groundData);

    textures = await Promise.all(TEXTURE_FILES.map(loadTexture));
    groundTexture = await loadTexture(GROUND_TEXTURE_FILE);

    initPhysics();
    requestAnimationFrame(render);
}

main().catch((err) => {
    console.error(err);
});
