let c = document.getElementById("c");
let gl = c.getContext("experimental-webgl");
gl.clearColor(0.7, 0.7, 0.7, 1.0);
gl.enable(gl.DEPTH_TEST);
gl.depthFunc(gl.LEQUAL);
let ext = gl.getExtension("ANGLE_instanced_arrays");

resizeCanvas();
window.addEventListener("resize", function(){
    resizeCanvas();
});

function resizeCanvas() {
    c.width = window.innerWidth;
    c.height = window.innerHeight;
    gl.viewport(0, 0, c.width, c.height);
}

let p1 = gl.createProgram();
let type = [gl.VERTEX_SHADER, gl.FRAGMENT_SHADER];
let src = [vs.text, fs.text];
for (let i = 0; i < 2; i++) {
    let shader = gl.createShader(type[i]);
    gl.shaderSource(shader, src[i]);
    gl.compileShader(shader);
    console.log(gl.getShaderInfoLog(shader));
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {alert(gl.getShaderInfoLog(shader));}
    gl.attachShader(p1, shader);
    gl.deleteShader(shader);
}
gl.linkProgram(p1);
gl.useProgram(p1);
let perspective = function (fovy, aspect, near, far) {
    let top = near * Math.tan(fovy * Math.PI / 360.0);
    let right = top * aspect;
    let u = right * 2;
    let v = top * 2;
    let w = far - near;
    return new Float32Array([
        near * 2 / u, 0, 0, 0,
        0, near * 2 / v, 0, 0,
        0, 0, -(far + near) / w, -1,
        0, 0, -(far * near * 2) / w, 0
    ]);
};
gl.uniformMatrix4fv(
    gl.getUniformLocation(p1, "pMatrix"),
    false,
    perspective(45, c.width / c.height, 0.1, 1000.0)
);

let w = 1.0;
let h = 0.2;
let d = 0.5;
let position = new Float32Array([
        // Front face
        -w, -h,  d, // v0
         w, -h,  d, // v1
         w,  h,  d, // v2
        -w,  h,  d, // v3
        // Back face
        -w, -h, -d, // v4
         w, -h, -d, // v5
         w,  h, -d, // v6
        -w,  h, -d, // v7
        // Top face
         w,  h,  d, // v2
        -w,  h,  d, // v3
        -w,  h, -d, // v7
         w,  h, -d, // v6
        // Bottom face
        -w, -h,  d, // v0
         w, -h,  d, // v1
         w, -h, -d, // v5
        -w, -h, -d, // v4
         // Right face
         w, -h,  d, // v1
         w,  h,  d, // v2
         w,  h, -d, // v6
         w, -h, -d, // v5
         // Left face
        -w, -h,  d, // v0
        -w,  h,  d, // v3
        -w,  h, -d, // v7
        -w, -h, -d  // v4
]);
let normal = new Float32Array([
    0, -1,  0,  0, -1,  0,  0, -1,  0,  0, -1,  0,
    0,  1,  0,  0,  1,  0,  0,  1,  0,  0,  1,  0,
    0,  0, -1,  0,  0, -1,  0,  0, -1,  0,  0, -1,
    0,  0,  1,  0,  0,  1,  0,  0,  1,  0,  0,  1,
    -1,  0,  0, -1,  0,  0, -1,  0,  0, -1,  0,  0,
    1,  0,  0,  1,  0,  0,  1,  0,  0,  1,  0,  0 ]);

let textureCoords = new Float32Array([
    // Front face
    0.5,  1.0, // v0
    0.75, 1.0, // v1
    0.75, 0.5, // v2
    0.5,  0.5, // v3

    // Back face
    0.25, 1.0, // v4
    0.5,  1.0, // v5
    0.5,  0.5, // v6
    0.25, 0.5, // v7

    // Top face
    0.75, 0.5, // v2
    0.5,  0.5, // v3
    0.5,  0.0, // v7
    0.75, 0.0, // v6

    // Bottom face
    0.0,  1.0, // v0
    0.25, 1.0, // v1
    0.25, 0.5, // v5
    0.0,  0.5, // v4

    // Right face
    0.0,  0.5, // v1
    0.0,  0.0, // v2
    0.25, 0.0, // v6
    0.25, 0.5, // v5

    // Left face
    0.5,  0.5, // v0
    0.5,  0.0, // v3
    0.25, 0.0, // v7
    0.25, 0.5  // v4
]);

let indeces = new Int16Array([
    0,  2,  1,  0,  3,  2,
    4,  5,  6,  4,  6,  7,
    8,  9, 10,  8, 10, 11,
    12, 15, 14, 12, 14, 13,
    16, 17, 18, 16, 18, 19,
    20, 23, 22, 20, 22, 21 ]);
gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indeces, gl.STATIC_DRAW);
let indexCount = indeces.length;

let strides = [3, 3, 2];
let vertices = [position, normal, textureCoords];
for (let i = 0; i < strides.length; i++) {
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, vertices[i], gl.STATIC_DRAW);
    gl.vertexAttribPointer(i, strides[i], gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(i);
}

let max = 300;
let posStride = 3;
let rotStride = 4;
let posBuffer =  gl.createBuffer();
let rotBuffer =  gl.createBuffer();
let posArray = new Float32Array(max * posStride);
let rotArray = new Float32Array(max * rotStride);

let idx = strides.length;
gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
gl.bufferData(gl.ARRAY_BUFFER,  posArray, gl.STATIC_DRAW);
gl.enableVertexAttribArray(idx);
gl.vertexAttribPointer(idx, posStride, gl.FLOAT, false, 0, 0);
//gl.vertexAttribDivisor(idx, 1);
ext.vertexAttribDivisorANGLE(idx, 1)

idx++;
gl.bindBuffer(gl.ARRAY_BUFFER, rotBuffer);
gl.bufferData(gl.ARRAY_BUFFER,  rotArray, gl.STATIC_DRAW);
gl.enableVertexAttribArray(idx);
gl.vertexAttribPointer(idx, rotStride, gl.FLOAT, false, 0, 0);
//gl.vertexAttribDivisor(idx, 1);
ext.vertexAttribDivisorANGLE(idx, 1)

let img = new Image();
let texture;
img.onload = function(){
    texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.generateMipmap(gl.TEXTURE_2D);
};
img.src = "../../../../assets/textures/eraser.png";

// physics
let world = new OIMO.World();
world.gravity = new OIMO.Vec3(0, -0.98, 0);

let genPosition = function () {
    let p = new OIMO.Vec3(Math.random() - 0.5, Math.random() + 1 , Math.random() - 0.5);
    p = new OIMO.Vec3().scale(p, 15);
    return p;
};

//let ground = new OIMO.Body({size:[13, 0.1, 13], pos:[0, -10, 0], world:world});
let ground = world.add({
        type: "box",
        size: [13, 0.1, 13],
        pos:[0, -10, 0],
        rot: [0, 0, 0],
        move: false,
        density: 1
    });

let bodys = [];
for (let i = 0; i < max; i++) {
    let p = genPosition();
    //bodys[i] = new OIMO.Body({type:'box', size:[w*2, h*2, d*2], pos:[p.x, p.y, p.z], move:true, world:world});
    bodys[i] = world.add({
        type: "box",
        size: [w * 2, h * 2, d * 2],
        pos: [p.x, p.y, p.z],
        rot: [0, 0, 0],
        move: true,
        density: 1
    });
}

let data2buf = function () {
    let pIdx = 0;
    let qIdx = 0;
    for (let i = 0; i < max; i++) {
        let p = bodys[i].getPosition();
        posArray[pIdx++] = p.x; 
        posArray[pIdx++] = p.y; 
        posArray[pIdx++] = p.z; 
        let q = bodys[i].getQuaternion();
        rotArray[qIdx++] = q.x; 
        rotArray[qIdx++] = q.y; 
        rotArray[qIdx++] = q.z; 
        rotArray[qIdx++] = q.w; 
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, posArray, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, rotBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, rotArray, gl.STATIC_DRAW);
};
data2buf();

setInterval(function () {
    world.step();
    for (let i = 0; i < max; i++) {
        let pos  = bodys[i].getPosition();
        if (pos.y < -15) {
            let p = genPosition();
            bodys[i].resetPosition(p.x, p.y, p.z);
        }
    }
    data2buf();
}, 1000 / 60);

(function () {
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(p1);
    //gl.drawElementsInstanced(gl.TRIANGLES, indexCount, gl.UNSIGNED_SHORT, 0, max);
    ext.drawElementsInstancedANGLE(gl.TRIANGLES, indexCount, gl.UNSIGNED_SHORT, 0, max);

    requestAnimationFrame(arguments.callee);
})();
