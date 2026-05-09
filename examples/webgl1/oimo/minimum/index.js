// WebGL variable
let c, gl;
let aLoc = [];
let uLoc = [];
let mainProgram;
let lineProgram, linePosLoc, lineVPLoc, lineModelLoc, lineColorLoc;
let showWireframe = false;
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

let mvMatrix;
let pMatrix;
let qMatrix;
let translation;
let scale;
let view;

let vertexPositionBuffer;
let coordBuffer
let vertexIndexBuffer;
let rad = 0;

let eye;
let center;
let up;
let q;

// oimo variable
let world;
let oimoGround;
let oimoBox;

function initWebGL() {
    c = document.getElementById("c");
    gl = c.getContext("experimental-webgl");
    gl.enable(gl.DEPTH_TEST);

    mvMatrix = mat4.create();
    pMatrix = mat4.create();
    qMatrix = mat4.create();
    mat4.perspective(pMatrix, 45, 465 / 465, 0.1, 1000.0);
    translation = vec3.create();
    scale = vec3.create();
    
    eye = vec3.create();
    center = vec3.create();
    up = vec3.create();
    vec3.set(eye, 0, 3, 6);
    vec3.set(center, 0, 0, 0);
    vec3.set(up, 0, 1, 0);
    view = mat4.create();
    mat4.lookAt(view, eye, center, up);
    mat4.multiply(pMatrix, pMatrix, view);
    q = quat.create();
    quat.identity(q);

    resizeCanvas();
    window.addEventListener("resize", function(){
        resizeCanvas();
    });

window.addEventListener('keydown', event => {
    if (event.key.toLowerCase() !== 'w' || event.repeat) return;
    showWireframe = !showWireframe;
    const hint = document.getElementById('hint');
    if (hint) hint.textContent = 'W: wireframe ' + (showWireframe ? 'ON' : 'OFF');
});

}

function resizeCanvas() {
    c.width = window.innerWidth;
    c.height = window.innerHeight;
    gl.viewport(0, 0, c.width, c.height);
}


function initWorld() {
    world = new OIMO.World({ 
        timestep: 1/60, 
        iterations: 8, 
        broadphase: 2, // 1 brute force, 2 sweep and prune, 3 volume tree
        worldscale: 1, // scale full world 
        random: true,  // randomize sample
        info: false,   // calculate statistic or not
        gravity: [0,-9.8,0] 
    });
}

function initShaders() {
    mainProgram = gl.createProgram();
    let vs = gl.createShader(gl.VERTEX_SHADER);
    let fs = gl.createShader(gl.FRAGMENT_SHADER);
    let v = document.getElementById("vs").textContent;
    let f = document.getElementById("fs").textContent;
    gl.shaderSource(vs, v);
    gl.shaderSource(fs, f);
    gl.compileShader(vs);
    gl.compileShader(fs);
    gl.attachShader(mainProgram, vs);
    gl.attachShader(mainProgram, fs);
    gl.linkProgram(mainProgram);
    gl.useProgram(mainProgram);
    aLoc[0] = gl.getAttribLocation(mainProgram, "position");
    aLoc[1] = gl.getAttribLocation(mainProgram, "textureCoord");
    uLoc[0] = gl.getUniformLocation(mainProgram, "pjMatrix");
    uLoc[1] = gl.getUniformLocation(mainProgram, "mvMatrix");
    uLoc[2]  = gl.getUniformLocation(mainProgram, "texture");
    gl.enableVertexAttribArray(aLoc[0]);
    gl.enableVertexAttribArray(aLoc[1]);
}

function initBuffers() {
    vertexPositionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexPositionBuffer);
    // Cube data
    //             1.0 y 
    //              ^  -1.0 
    //              | / z
    //              |/       x
    // -1.0 -----------------> +1.0
    //            / |
    //      +1.0 /  |
    //           -1.0
    // 
    //         [7]------[6]
    //        / |      / |
    //      [3]------[2] |
    //       |  |     |  |
    //       | [4]----|-[5]
    //       |/       |/
    //      [0]------[1]
    //
    let data = [ 
        // Front face
        -0.5, -0.5,  0.5, // v0
         0.5, -0.5,  0.5, // v1
         0.5,  0.5,  0.5, // v2
        -0.5,  0.5,  0.5, // v3
        // Back face
        -0.5, -0.5, -0.5, // v4
         0.5, -0.5, -0.5, // v5
         0.5,  0.5, -0.5, // v6
        -0.5,  0.5, -0.5, // v7
        // Top face
         0.5,  0.5,  0.5, // v2
        -0.5,  0.5,  0.5, // v3
        -0.5,  0.5, -0.5, // v7
         0.5,  0.5, -0.5, // v6
        // Bottom face
        -0.5, -0.5,  0.5, // v0
         0.5, -0.5,  0.5, // v1
         0.5, -0.5, -0.5, // v5
        -0.5, -0.5, -0.5, // v4
         // Right face
         0.5, -0.5,  0.5, // v1
         0.5,  0.5,  0.5, // v2
         0.5,  0.5, -0.5, // v6
         0.5, -0.5, -0.5, // v5
         // Left face
        -0.5, -0.5,  0.5, // v0
        -0.5,  0.5,  0.5, // v3
        -0.5,  0.5, -0.5, // v7
        -0.5, -0.5, -0.5  // v4
    ];
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
    gl.vertexAttribPointer(aLoc[0], 3, gl.FLOAT, false, 0, 0);

    coordBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, coordBuffer);
    let textureCoords = [
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
        0.0, 1.0,
    ];
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(textureCoords), gl.STATIC_DRAW);
    gl.vertexAttribPointer(aLoc[1], 2, gl.FLOAT, false, 0, 0);
    
    vertexIndexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, vertexIndexBuffer);
    let indices = [
         0,  1,  2,    0,  2 , 3,  // Front face
         4,  5,  6,    4,  6 , 7,  // Back face
         8,  9, 10,    8, 10, 11,  // Top face
        12, 13, 14,   12, 14, 15,  // Bottom face
        16, 17, 18,   16, 18, 19,  // Right face
        20, 21, 22,   20, 22, 23   // Left face
    ];
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);

    let img = new Image();
    let texture;
    img.onload = function(){
        texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        gl.generateMipmap(gl.TEXTURE_2D);
    };
    img.src = "../../../../assets/textures/frog.jpg";  // 256x256

    gl.bindBuffer(gl.ARRAY_BUFFER, vertexPositionBuffer);
    gl.vertexAttribPointer(aLoc[0], 3, gl.FLOAT, false, 0, 0);
    
    gl.bindBuffer(gl.ARRAY_BUFFER, coordBuffer);
    gl.vertexAttribPointer(aLoc[1], 2, gl.FLOAT, false, 0, 0);
}

function addGround() {
    oimoGround = world.add({
        type: "box",
        size: [4, 0.1, 4],
        pos: [0, 0, 0],
        rot: [0, 0, 0],
        move: false,
        density: 1
    });
}

function addBox() {
    oimoBox = world.add({
        type: "box",
        size: [1, 1, 1],
        pos: [0, 2, 0],
        rot: [10, 10, 10],
        move: true,
        density: 1
    });
}

function draw() {
    let p;
    let r;
    world.step();
    rad -= Math.PI * 1.0 / 180.0 * 0.1;

    // Camera
    vec3.set(eye, 6 * Math.sin(rad), 3, 6 * Math.cos(rad));
    vec3.set(center, 0, 0, 0);
    vec3.set(up, 0, 1, 0);
    mat4.lookAt(view, eye, center, up);
    mat4.perspective(pMatrix, 45, c.width / c.height, 0.1, 100.0);
    mat4.multiply(pMatrix, pMatrix, view);

    // Ground
    mat4.identity(mvMatrix);
    p = oimoGround.getPosition();
    r = oimoGround.getQuaternion();
    vec3.set(scale, 4, 0.1, 4);
    vec3.set(translation, p.x, p.y, p.z);
    mat4.translate(mvMatrix, mvMatrix, translation);
    q = quat.fromValues(r.x, r.y, r.z, r.w);
    mat4.fromQuat(mvMatrix, q);
    mat4.scale(mvMatrix, mvMatrix, scale);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, vertexIndexBuffer);
    gl.uniformMatrix4fv(uLoc[0], false, pMatrix);
    gl.uniformMatrix4fv(uLoc[1], false, mvMatrix);

    gl.drawElements(gl.TRIANGLES, 36, gl.UNSIGNED_SHORT, 0);

    // Box
    mat4.identity(mvMatrix);
    vec3.set(scale, 1.0, 1.0, 1.0);
    p = oimoBox.getPosition();
    r = oimoBox.getQuaternion();
    vec3.set(translation, p.x, p.y, p.z);
    mat4.translate(mvMatrix, mvMatrix, translation);
    q = quat.fromValues(r.x, r.y, r.z, r.w);
    mat4.fromQuat(qMatrix, q);
    mat4.multiply(mvMatrix, mvMatrix, qMatrix);
    mat4.scale(mvMatrix, mvMatrix, scale);
    
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, vertexIndexBuffer);
    gl.uniformMatrix4fv(uLoc[0], false, pMatrix);
    gl.uniformMatrix4fv(uLoc[1], false, mvMatrix);

    gl.drawElements(gl.TRIANGLES, 36, gl.UNSIGNED_SHORT, 0);

    let wm = mat4.create();
    gl.useProgram(lineProgram);
    gl.uniformMatrix4fv(lineVPLoc, false, pMatrix);
    gl.bindBuffer(gl.ARRAY_BUFFER, boxWireVB);
    gl.vertexAttribPointer(linePosLoc, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(linePosLoc);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, boxWireIB);
    let gp = oimoGround.getPosition();
    let gr = oimoGround.getQuaternion();
    mat4.fromRotationTranslationScale(wm, quat.fromValues(gr.x, gr.y, gr.z, gr.w), [gp.x, gp.y, gp.z], [4, 0.1, 4]);
    gl.uniformMatrix4fv(lineModelLoc, false, wm);
    gl.uniform4fv(lineColorLoc, [0, 1, 0, 1]);
    if (showWireframe) gl.drawElements(gl.LINES, 24, gl.UNSIGNED_SHORT, 0);
    let bp = oimoBox.getPosition();
    let br = oimoBox.getQuaternion();
    mat4.fromRotationTranslationScale(wm, quat.fromValues(br.x, br.y, br.z, br.w), [bp.x, bp.y, bp.z], [1, 1, 1]);
    gl.uniformMatrix4fv(lineModelLoc, false, wm);
    gl.uniform4fv(lineColorLoc, [1, 1, 0, 1]);
    if (showWireframe) gl.drawElements(gl.LINES, 24, gl.UNSIGNED_SHORT, 0);
    gl.useProgram(mainProgram);
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexPositionBuffer);
    gl.vertexAttribPointer(aLoc[0], 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, coordBuffer);
    gl.vertexAttribPointer(aLoc[1], 2, gl.FLOAT, false, 0, 0);
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
    let vs = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vs, document.getElementById('vs-line').textContent);
    gl.compileShader(vs);
    let fs = gl.createShader(gl.FRAGMENT_SHADER);
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
gl.vertexAttribPointer(aLoc[0], 3, gl.FLOAT, false, 0, 0);
gl.bindBuffer(gl.ARRAY_BUFFER, coordBuffer);
gl.vertexAttribPointer(aLoc[1], 2, gl.FLOAT, false, 0, 0);
gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, vertexIndexBuffer);

animate();
