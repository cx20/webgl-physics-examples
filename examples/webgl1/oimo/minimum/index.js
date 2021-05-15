// WebGL variable
let c, gl;
let aLoc = [];
let uLoc = [];

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
    vec3.set(eye, 0, 50, 200);
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
    let p = gl.createProgram();
    let vs = gl.createShader(gl.VERTEX_SHADER);
    let fs = gl.createShader(gl.FRAGMENT_SHADER);
    let v = document.getElementById("vs").textContent;
    let f = document.getElementById("fs").textContent;
    gl.shaderSource(vs, v);
    gl.shaderSource(fs, f);
    gl.compileShader(vs);
    gl.compileShader(fs);
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    gl.useProgram(p);
    aLoc[0] = gl.getAttribLocation(p, "position");
    aLoc[1] = gl.getAttribLocation(p, "textureCoord");
    uLoc[0] = gl.getUniformLocation(p, "pjMatrix");
    uLoc[1] = gl.getUniformLocation(p, "mvMatrix");
    uLoc[2]  = gl.getUniformLocation(p, "texture");
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
        size: [200, 4, 200],
        pos: [0, 0, 0],
        rot: [0, 0, 0],
        move: false,
        density: 1
    });
}

function addBox() {
    oimoBox = world.add({
        type: "box",
        size: [50, 50, 50],
        pos: [0, 100, 0],
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
    vec3.set(eye, 200 * Math.sin(rad), 50, 200 * Math.cos(rad));
    vec3.set(center, 0, 0, 0);
    vec3.set(up, 0, 1, 0);
    mat4.lookAt(view, eye, center, up);
    mat4.perspective(pMatrix, 45, c.width / c.height, 0.1, 1000.0);
    mat4.multiply(pMatrix, pMatrix, view);

    // Ground
    mat4.identity(mvMatrix);
    p = oimoGround.getPosition();
    r = oimoGround.getQuaternion();
    vec3.set(scale, 200, 4, 200);
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
    vec3.set(scale, 50.0, 50.0, 50.0);
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
animate();
