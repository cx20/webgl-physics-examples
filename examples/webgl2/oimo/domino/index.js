// forked from gaziya's "Domino (WebGL2 + Oimo.js)" http://jsdo.it/gaziya/46vq

// ‥‥‥‥‥‥‥‥‥‥‥‥‥□□□
// ‥‥‥‥‥‥〓〓〓〓〓‥‥□□□
// ‥‥‥‥‥〓〓〓〓〓〓〓〓〓□□
// ‥‥‥‥‥■■■□□■□‥■■■
// ‥‥‥‥■□■□□□■□□■■■
// ‥‥‥‥■□■■□□□■□□□■
// ‥‥‥‥■■□□□□■■■■■‥
// ‥‥‥‥‥‥□□□□□□□■‥‥
// ‥‥■■■■■〓■■■〓■‥‥‥
// ‥■■■■■■■〓■■■〓‥‥■
// □□■■■■■■〓〓〓〓〓‥‥■
// □□□‥〓〓■〓〓□〓〓□〓■■
// ‥□‥■〓〓〓〓〓〓〓〓〓〓■■
// ‥‥■■■〓〓〓〓〓〓〓〓〓■■
// ‥■■■〓〓〓〓〓〓〓‥‥‥‥‥
// ‥■‥‥〓〓〓〓‥‥‥‥‥‥‥‥
let dataSet = [
    "無","無","無","無","無","無","無","無","無","無","無","無","無","肌","肌","肌",
    "無","無","無","無","無","無","赤","赤","赤","赤","赤","無","無","肌","肌","肌",
    "無","無","無","無","無","赤","赤","赤","赤","赤","赤","赤","赤","赤","肌","肌",
    "無","無","無","無","無","茶","茶","茶","肌","肌","茶","肌","無","赤","赤","赤",
    "無","無","無","無","茶","肌","茶","肌","肌","肌","茶","肌","肌","赤","赤","赤",
    "無","無","無","無","茶","肌","茶","茶","肌","肌","肌","茶","肌","肌","肌","赤",
    "無","無","無","無","茶","茶","肌","肌","肌","肌","茶","茶","茶","茶","赤","無",
    "無","無","無","無","無","無","肌","肌","肌","肌","肌","肌","肌","赤","無","無",
    "無","無","赤","赤","赤","赤","赤","青","赤","赤","赤","青","赤","無","無","無",
    "無","赤","赤","赤","赤","赤","赤","赤","青","赤","赤","赤","青","無","無","茶",
    "肌","肌","赤","赤","赤","赤","赤","赤","青","青","青","青","青","無","無","茶",
    "肌","肌","肌","無","青","青","赤","青","青","黄","青","青","黄","青","茶","茶",
    "無","肌","無","茶","青","青","青","青","青","青","青","青","青","青","茶","茶",
    "無","無","茶","茶","茶","青","青","青","青","青","青","青","青","青","茶","茶",
    "無","茶","茶","茶","青","青","青","青","青","青","青","無","無","無","無","無",
    "無","茶","無","無","青","青","青","青","無","無","無","無","無","無","無","無"
];

function getRgbColor(c) {
    let colorHash = {
        "無": [0xDC/0xFF, 0xAA/0xFF, 0x6B/0xFF],
        "白": [0xFF/0xFF, 0xFF/0xFF, 0xFF/0xFF],
        "肌": [0xFF/0xFF, 0xCC/0xFF, 0xCC/0xFF],
        "茶": [0x80/0xFF, 0x00/0xFF, 0x00/0xFF],
        "赤": [0xFF/0xFF, 0x00/0xFF, 0x00/0xFF],
        "黄": [0xFF/0xFF, 0xFF/0xFF, 0x00/0xFF],
        "緑": [0x00/0xFF, 0xFF/0xFF, 0x00/0xFF],
        "水": [0x00/0xFF, 0xFF/0xFF, 0xFF/0xFF],
        "青": [0x00/0xFF, 0x00/0xFF, 0xFF/0xFF],
        "紫": [0x80/0xFF, 0x00/0xFF, 0x80/0xFF]
    };
    return colorHash[c];
}

let canvas = document.getElementById("c");
let gl = canvas.getContext("webgl2");
gl.clearColor(0.05, 0.05, 0.1, 1.0);
gl.enable(gl.DEPTH_TEST);
gl.depthFunc(gl.LEQUAL);

let lineProgram, linePosLoc, lineVPLoc, lineModelLoc, lineColorLoc;
let showWireframe = true;
let boxWireVB, boxWireIB;
let dominoPosVBO;
let lineVP = mat4.create();
const BOX_WIRE_VERTS = new Float32Array([
    -0.5,-0.5,-0.5,  0.5,-0.5,-0.5,  0.5, 0.5,-0.5, -0.5, 0.5,-0.5,
    -0.5,-0.5, 0.5,  0.5,-0.5, 0.5,  0.5, 0.5, 0.5, -0.5, 0.5, 0.5
]);
const BOX_WIRE_INDICES = new Uint16Array([
    0,1, 1,2, 2,3, 3,0,
    4,5, 5,6, 6,7, 7,4,
    0,4, 1,5, 2,6, 3,7
]);

resizeCanvas();
window.addEventListener("resize", resizeCanvas);

function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    gl.viewport(0, 0, canvas.width, canvas.height);
}

// --- Shader program ---
let program = gl.createProgram();

window.addEventListener('keydown', event => {
    const isWKey = event.code === 'KeyW' || event.key === 'w' || event.key === 'W';
    if (!isWKey || event.repeat) return;
    showWireframe = !showWireframe;
    const hint = document.getElementById('hint');
    if (hint) hint.textContent = 'W: wireframe ' + (showWireframe ? 'ON' : 'OFF');
});

for (let i = 0; i < 2; i++) {
    let shader = gl.createShader([gl.VERTEX_SHADER, gl.FRAGMENT_SHADER][i]);
    gl.shaderSource(shader, [
        document.getElementById('vs').textContent.trim(),
        document.getElementById('fs').textContent.trim()
    ][i]);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        alert(gl.getShaderInfoLog(shader));
    }
    gl.attachShader(program, shader);
    gl.deleteShader(shader);
}
gl.linkProgram(program);
gl.useProgram(program);

let perspective = function (fovy, aspect, near, far) {
    let v = 1 / Math.tan(fovy * Math.PI / 360.0);
    let u = v / aspect;
    let w = near - far;
    return new Float32Array([
        u, 0, 0, 0,
        0, v, 0, 0,
        0, 0, (near + far) / w, -1,
        0, 0, near * far * 2 / w, 0
    ]);
};
gl.uniformMatrix4fv(
    gl.getUniformLocation(program, "pMatrix"),
    false,
    perspective(45, canvas.width / canvas.height, 0.1, 200)
);
(function() {
    let viewMat = mat4.create();
    mat4.lookAt(viewMat, [60, 50, 0], [0, 0, 0], [0, 1, 0]);
    mat4.multiply(lineVP, perspective(45, canvas.width / canvas.height, 0.1, 200), viewMat);
})();

// --- Geometry (box) ---
let bw = 1, bh = 2, bd = 0.3;
let position = new Float32Array([
    -bw, -bh, -bd, -bw, -bh,  bd,  bw, -bh,  bd,  bw, -bh, -bd,
    -bw,  bh, -bd, -bw,  bh,  bd,  bw,  bh,  bd,  bw,  bh, -bd,
    -bw, -bh, -bd, -bw,  bh, -bd,  bw,  bh, -bd,  bw, -bh, -bd,
    -bw, -bh,  bd, -bw,  bh,  bd,  bw,  bh,  bd,  bw, -bh,  bd,
    -bw, -bh, -bd, -bw, -bh,  bd, -bw,  bh,  bd, -bw,  bh, -bd,
     bw, -bh, -bd,  bw, -bh,  bd,  bw,  bh,  bd,  bw,  bh, -bd]);
let normal = new Float32Array([
     0, -1,  0,  0, -1,  0,  0, -1,  0,  0, -1,  0,
     0,  1,  0,  0,  1,  0,  0,  1,  0,  0,  1,  0,
     0,  0, -1,  0,  0, -1,  0,  0, -1,  0,  0, -1,
     0,  0,  1,  0,  0,  1,  0,  0,  1,  0,  0,  1,
    -1,  0,  0, -1,  0,  0, -1,  0,  0, -1,  0,  0,
     1,  0,  0,  1,  0,  0,  1,  0,  0,  1,  0,  0]);
let indices = new Int16Array([
     0,  2,  1,  0,  3,  2,
     4,  5,  6,  4,  6,  7,
     8,  9, 10,  8, 10, 11,
    12, 15, 14, 12, 14, 13,
    16, 17, 18, 16, 18, 19,
    20, 23, 22, 20, 22, 21]);
let indexBuffer = gl.createBuffer();
gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
let indexCount = indices.length;

// --- Vertex attribute locations ---
let aPosition = gl.getAttribLocation(program, 'position');
let aNormal   = gl.getAttribLocation(program, 'normal');
let aOffset   = gl.getAttribLocation(program, 'offset');
let aQuat     = gl.getAttribLocation(program, 'quat');
let aCol      = gl.getAttribLocation(program, 'col');

// Per-vertex buffers
for (let i = 0; i < 2; i++) {
    let buf = gl.createBuffer();
    if (i === 0) dominoPosVBO = buf;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, [position, normal][i], gl.STATIC_DRAW);
    let loc = [aPosition, aNormal][i];
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
}

// Per-instance buffers
let number = 256;
let posArray  = new Float32Array(number * 3);
let quatArray = new Float32Array(number * 4);
let colArray  = new Float32Array(number * 3);

let posBuffer  = gl.createBuffer();
let quatBuffer = gl.createBuffer();
let colBuffer  = gl.createBuffer();

for (let i = 0; i < 3; i++) {
    let buf  = [posBuffer, quatBuffer, colBuffer][i];
    let data = [posArray, quatArray, colArray][i];
    let loc  = [aOffset, aQuat, aCol][i];
    let stride = [3, 4, 3][i];
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, stride, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(loc, 1);
}

// --- Physics ---
let world = new OIMO.World({
    timestep: 1 / 60,
    iterations: 8,
    broadphase: 2,
    worldscale: 1,
    random: true,
    info: false,
    gravity: [0, -9.8, 0]
});

world.add({
    type: "box",
    size: [100, 0.2, 100],
    pos: [0, -0.1, 0],
    rot: [0, 0, 0],
    move: false,
    density: 1
});

let bodys = [];
for (let i = 0; i < number; i++) {
    let x = (Math.floor(i / 16) - 8) * 3;
    let y = bh;
    let z = (8 - (i % 16)) * 3;
    bodys[i] = world.add({
        type: "box",
        size: [bw * 2, bh * 2, bd * 2],
        pos: [x, y, z],
        rot: [0, 0, 0],
        move: true,
        density: 1
    });
}
// Tilt first column to trigger chain reaction
for (let i = 0; i < 16; i++) {
    bodys[i * 16].resetRotation(-15, 0, 0);
}

// Assign colors from dataset
for (let i = 0; i < number; i++) {
    let color = getRgbColor(dataSet[i]);
    colArray[i * 3 + 0] = color[0];
    colArray[i * 3 + 1] = color[1];
    colArray[i * 3 + 2] = color[2];
}
gl.bindBuffer(gl.ARRAY_BUFFER, colBuffer);
gl.bufferData(gl.ARRAY_BUFFER, colArray, gl.STATIC_DRAW);

// Re-bind element array after color setup
gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);

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
gl.useProgram(program);
gl.bindBuffer(gl.ARRAY_BUFFER, dominoPosVBO);
gl.vertexAttribPointer(aPosition, 3, gl.FLOAT, false, 0, 0);
gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);

function uploadInstanceData() {
    let pIdx = 0, qIdx = 0;
    for (let i = 0; i < number; i++) {
        let p = bodys[i].getPosition();
        posArray[pIdx++] = p.x;
        posArray[pIdx++] = p.y;
        posArray[pIdx++] = p.z;
        let q = bodys[i].getQuaternion();
        quatArray[qIdx++] = q.x;
        quatArray[qIdx++] = q.y;
        quatArray[qIdx++] = q.z;
        quatArray[qIdx++] = q.w;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, posArray, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, quatBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, quatArray, gl.DYNAMIC_DRAW);
}
uploadInstanceData();

// --- Physics loop ---
setInterval(function () {
    world.step();
    uploadInstanceData();
}, 1000 / 60);

// --- Render loop ---
(function render() {
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(program);

    // Bind per-vertex buffers & instance buffers before draw
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
    gl.vertexAttribPointer(aOffset, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, quatBuffer);
    gl.vertexAttribPointer(aQuat, 4, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, colBuffer);
    gl.vertexAttribPointer(aCol, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);

    gl.drawElementsInstanced(gl.TRIANGLES, indexCount, gl.UNSIGNED_SHORT, 0, number);

    gl.useProgram(lineProgram);
    gl.uniformMatrix4fv(lineVPLoc, false, lineVP);
    gl.bindBuffer(gl.ARRAY_BUFFER, boxWireVB);
    gl.vertexAttribPointer(linePosLoc, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(linePosLoc);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, boxWireIB);
    const wm = mat4.create();
    mat4.fromRotationTranslationScale(wm, quat.create(), [0, -0.1, 0], [100, 0.2, 100]);
    gl.uniformMatrix4fv(lineModelLoc, false, wm);
    gl.uniform4fv(lineColorLoc, [0, 1, 0, 1]);
    if (showWireframe) gl.drawElements(gl.LINES, 24, gl.UNSIGNED_SHORT, 0);
    gl.uniform4fv(lineColorLoc, [1, 1, 0, 1]);
    for (let i = 0; i < number; i++) {
        const q = quat.fromValues(quatArray[i*4], quatArray[i*4+1], quatArray[i*4+2], quatArray[i*4+3]);
        mat4.fromRotationTranslationScale(wm, q, [posArray[i*3], posArray[i*3+1], posArray[i*3+2]], [bw*2, bh*2, bd*2]);
        gl.uniformMatrix4fv(lineModelLoc, false, wm);
        if (showWireframe) gl.drawElements(gl.LINES, 24, gl.UNSIGNED_SHORT, 0);
    }
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, dominoPosVBO);
    gl.vertexAttribPointer(aPosition, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);

    requestAnimationFrame(render);
})();
