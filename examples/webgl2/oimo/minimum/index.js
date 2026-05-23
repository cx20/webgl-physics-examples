let canvas;
let gl;
let attributeLocations = [];
let uniformLocations = [];
let mainProgram;
let lineProgram, linePosLoc, lineVPLoc, lineModelLoc, lineColorLoc;
let showWireframe = true;
let boxWireVB, boxWireIB;
const BOX_WIRE_VERTS = new Float32Array([
    -0.5,-0.5,-0.5,  0.5,-0.5,-0.5,  0.5, 0.5,-0.5, -0.5, 0.5,-0.5,
    -0.5,-0.5, 0.5,  0.5,-0.5, 0.5,  0.5, 0.5, 0.5, -0.5, 0.5, 0.5
]);
const BOX_WIRE_INDICES = new Uint16Array([
    0,1, 1,2, 2,3, 3,0,
    4,5, 5,6, 6,7, 7,4,
    0,4, 1,5, 2,6, 3,7
]);

let modelViewMatrix;
let projectionMatrix;
let quaternionMatrix;
let translation;
let scale;
let viewMatrix;

let vertexPositionBuffer;
let coordBuffer;
let vertexIndexBuffer;
let texture;
let angle = 0;

let eye;
let center;
let up;

let world;
let groundBody;
let boxBody;

function initWebGL() {
    canvas = document.getElementById('c');
    gl = canvas.getContext('webgl2');
    gl.enable(gl.DEPTH_TEST);

    modelViewMatrix = mat4.create();
    projectionMatrix = mat4.create();
    quaternionMatrix = mat4.create();
    translation = vec3.create();
    scale = vec3.create();

    eye = vec3.create();
    center = vec3.create();
    up = vec3.create();
    vec3.set(eye, 0, 3, 6);
    vec3.set(center, 0, 0, 0);
    vec3.set(up, 0, 1, 0);
    viewMatrix = mat4.create();

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
}

function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    gl.viewport(0, 0, canvas.width, canvas.height);
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

window.addEventListener('keydown', event => {
    const isWKey = event.code === 'KeyW' || event.key === 'w' || event.key === 'W';
    if (!isWKey || event.repeat) return;
    showWireframe = !showWireframe;
    const hint = document.getElementById('hint');
    if (hint) hint.textContent = 'W: wireframe ' + (showWireframe ? 'ON' : 'OFF');
});

}

function createShader(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    return shader;
}

function initShaders() {
    mainProgram = gl.createProgram();
    const vertexShader = createShader(gl.VERTEX_SHADER, document.getElementById('vs').textContent);
    const fragmentShader = createShader(gl.FRAGMENT_SHADER, document.getElementById('fs').textContent);

    gl.attachShader(mainProgram, vertexShader);
    gl.attachShader(mainProgram, fragmentShader);
    gl.linkProgram(mainProgram);
    gl.useProgram(mainProgram);

    attributeLocations[0] = gl.getAttribLocation(mainProgram, 'position');
    attributeLocations[1] = gl.getAttribLocation(mainProgram, 'textureCoord');
    uniformLocations[0] = gl.getUniformLocation(mainProgram, 'pjMatrix');
    uniformLocations[1] = gl.getUniformLocation(mainProgram, 'mvMatrix');
    uniformLocations[2] = gl.getUniformLocation(mainProgram, 'textureSampler');

    gl.enableVertexAttribArray(attributeLocations[0]);
    gl.enableVertexAttribArray(attributeLocations[1]);
}

function initBuffers() {
    vertexPositionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexPositionBuffer);
    const positions = [
        -0.5, -0.5,  0.5,
         0.5, -0.5,  0.5,
         0.5,  0.5,  0.5,
        -0.5,  0.5,  0.5,
        -0.5, -0.5, -0.5,
         0.5, -0.5, -0.5,
         0.5,  0.5, -0.5,
        -0.5,  0.5, -0.5,
         0.5,  0.5,  0.5,
        -0.5,  0.5,  0.5,
        -0.5,  0.5, -0.5,
         0.5,  0.5, -0.5,
        -0.5, -0.5,  0.5,
         0.5, -0.5,  0.5,
         0.5, -0.5, -0.5,
        -0.5, -0.5, -0.5,
         0.5, -0.5,  0.5,
         0.5,  0.5,  0.5,
         0.5,  0.5, -0.5,
         0.5, -0.5, -0.5,
        -0.5, -0.5,  0.5,
        -0.5,  0.5,  0.5,
        -0.5,  0.5, -0.5,
        -0.5, -0.5, -0.5
    ];
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);
    gl.vertexAttribPointer(attributeLocations[0], 3, gl.FLOAT, false, 0, 0);

    coordBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, coordBuffer);
    const textureCoords = [
        0.0, 0.0,
        1.0, 0.0,
        1.0, 1.0,
        0.0, 1.0,
        1.0, 0.0,
        1.0, 1.0,
        0.0, 1.0,
        0.0, 0.0,
        0.0, 1.0,
        0.0, 0.0,
        1.0, 0.0,
        1.0, 1.0,
        1.0, 1.0,
        0.0, 1.0,
        0.0, 0.0,
        1.0, 0.0,
        1.0, 0.0,
        1.0, 1.0,
        0.0, 1.0,
        0.0, 0.0,
        0.0, 0.0,
        1.0, 0.0,
        1.0, 1.0,
        0.0, 1.0
    ];
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(textureCoords), gl.STATIC_DRAW);
    gl.vertexAttribPointer(attributeLocations[1], 2, gl.FLOAT, false, 0, 0);

    vertexIndexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, vertexIndexBuffer);
    const indices = [
         0,  1,  2,  0,  2,  3,
         4,  5,  6,  4,  6,  7,
         8,  9, 10,  8, 10, 11,
        12, 13, 14, 12, 14, 15,
        16, 17, 18, 16, 18, 19,
        20, 21, 22, 20, 22, 23
    ];
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);

    texture = gl.createTexture();
    const image = new Image();
    image.onload = function () {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.uniform1i(uniformLocations[2], 0);
    };
    image.src = '../../../../assets/textures/frog.jpg';

    gl.bindBuffer(gl.ARRAY_BUFFER, vertexPositionBuffer);
    gl.vertexAttribPointer(attributeLocations[0], 3, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, coordBuffer);
    gl.vertexAttribPointer(attributeLocations[1], 2, gl.FLOAT, false, 0, 0);
}

function addGround() {
    groundBody = world.add({
        type: 'box',
        size: [4, 0.1, 4],
        pos: [0, 0, 0],
        rot: [0, 0, 0],
        move: false,
        density: 1
    });
}

function addBox() {
    boxBody = world.add({
        type: 'box',
        size: [1, 1, 1],
        pos: [0, 2, 0],
        rot: [10, 10, 10],
        move: true,
        density: 1
    });
}

function drawBody(body, bodyScale) {
    const position = body.getPosition();
    const rotation = body.getQuaternion();
    const quaternion = quat.fromValues(rotation.x, rotation.y, rotation.z, rotation.w);

    mat4.identity(modelViewMatrix);
    vec3.set(translation, position.x, position.y, position.z);
    mat4.translate(modelViewMatrix, modelViewMatrix, translation);
    mat4.fromQuat(quaternionMatrix, quaternion);
    mat4.multiply(modelViewMatrix, modelViewMatrix, quaternionMatrix);
    vec3.set(scale, bodyScale[0], bodyScale[1], bodyScale[2]);
    mat4.scale(modelViewMatrix, modelViewMatrix, scale);

    gl.uniformMatrix4fv(uniformLocations[0], false, projectionMatrix);
    gl.uniformMatrix4fv(uniformLocations[1], false, modelViewMatrix);
    gl.drawElements(gl.TRIANGLES, 36, gl.UNSIGNED_SHORT, 0);
}

function draw() {
    world.step();
    angle -= Math.PI / 180 * 0.1;

    gl.clearColor(1, 1, 1, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    vec3.set(eye, 6 * Math.sin(angle), 3, 6 * Math.cos(angle));
    mat4.lookAt(viewMatrix, eye, center, up);
    mat4.perspective(projectionMatrix, 45, canvas.width / canvas.height, 0.1, 100.0);
    mat4.multiply(projectionMatrix, projectionMatrix, viewMatrix);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, vertexIndexBuffer);
    drawBody(groundBody, [4, 0.1, 4]);
    drawBody(boxBody, [1, 1, 1]);

    const wm = mat4.create();
    gl.useProgram(lineProgram);
    gl.uniformMatrix4fv(lineVPLoc, false, projectionMatrix);
    gl.bindBuffer(gl.ARRAY_BUFFER, boxWireVB);
    gl.vertexAttribPointer(linePosLoc, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(linePosLoc);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, boxWireIB);
    const gp = groundBody.getPosition();
    const gr = groundBody.getQuaternion();
    mat4.fromRotationTranslationScale(wm, quat.fromValues(gr.x, gr.y, gr.z, gr.w), [gp.x, gp.y, gp.z], [4, 0.1, 4]);
    gl.uniformMatrix4fv(lineModelLoc, false, wm);
    gl.uniform4fv(lineColorLoc, [0, 1, 0, 1]);
    if (showWireframe) gl.drawElements(gl.LINES, 24, gl.UNSIGNED_SHORT, 0);
    const bp = boxBody.getPosition();
    const br = boxBody.getQuaternion();
    mat4.fromRotationTranslationScale(wm, quat.fromValues(br.x, br.y, br.z, br.w), [bp.x, bp.y, bp.z], [1, 1, 1]);
    gl.uniformMatrix4fv(lineModelLoc, false, wm);
    gl.uniform4fv(lineColorLoc, [1, 1, 0, 1]);
    if (showWireframe) gl.drawElements(gl.LINES, 24, gl.UNSIGNED_SHORT, 0);
    gl.useProgram(mainProgram);
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexPositionBuffer);
    gl.vertexAttribPointer(attributeLocations[0], 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, coordBuffer);
    gl.vertexAttribPointer(attributeLocations[1], 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, vertexIndexBuffer);

    gl.flush();
}

function animate() {
    draw();
    requestAnimationFrame(animate);
}

initWebGL();
initWorld();
initShaders();
initBuffers();
addGround();
addBox();

lineProgram = gl.createProgram();
(function() {
    const vs = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vs, document.getElementById('vs-line').textContent);
    gl.compileShader(vs);
    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fs, document.getElementById('fs-line').textContent);
    gl.compileShader(fs);
    gl.attachShader(lineProgram, vs);
    gl.attachShader(lineProgram, fs);
    gl.linkProgram(lineProgram);
})();
linePosLoc = gl.getAttribLocation(lineProgram, 'aPosition');
lineVPLoc = gl.getUniformLocation(lineProgram, 'uViewProj');
lineModelLoc = gl.getUniformLocation(lineProgram, 'uModel');
lineColorLoc = gl.getUniformLocation(lineProgram, 'uColor');
boxWireVB = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, boxWireVB);
gl.bufferData(gl.ARRAY_BUFFER, BOX_WIRE_VERTS, gl.STATIC_DRAW);
boxWireIB = gl.createBuffer();
gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, boxWireIB);
gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, BOX_WIRE_INDICES, gl.STATIC_DRAW);
gl.useProgram(mainProgram);
gl.bindBuffer(gl.ARRAY_BUFFER, vertexPositionBuffer);
gl.vertexAttribPointer(attributeLocations[0], 3, gl.FLOAT, false, 0, 0);
gl.bindBuffer(gl.ARRAY_BUFFER, coordBuffer);
gl.vertexAttribPointer(attributeLocations[1], 2, gl.FLOAT, false, 0, 0);
gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, vertexIndexBuffer);

animate();