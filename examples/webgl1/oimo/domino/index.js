// forked from gaziya's "Domino  (WebGL2 + Oimo.js)" http://jsdo.it/gaziya/46vq

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

function getRgbColor( c )
{
    let colorHash = {
        "無":[0xDC/0xFF, 0xAA/0xFF, 0x6B/0xFF],
        "白":[0xff/0xFF, 0xff/0xFF, 0xff/0xFF],
        "肌":[0xff/0xFF, 0xcc/0xFF, 0xcc/0xFF],
        "茶":[0x80/0xFF, 0x00/0xFF, 0x00/0xFF],
        "赤":[0xff/0xFF, 0x00/0xFF, 0x00/0xFF],
        "黄":[0xff/0xFF, 0xff/0xFF, 0x00/0xFF],
        "緑":[0x00/0xFF, 0xff/0xFF, 0x00/0xFF],
        "水":[0x00/0xFF, 0xff/0xFF, 0xff/0xFF],
        "青":[0x00/0xFF, 0x00/0xFF, 0xff/0xFF],
        "紫":[0x80/0xFF, 0x00/0xFF, 0x80/0xFF]
    };
    return colorHash[ c ];
}

let c = document.getElementById("c");
let gl = c.getContext("experimental-webgl");
gl.clearColor(0.05, 0.05, 0.1, 1.0);
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
for (let i = 0; i < 2; i++) {
    let shader = gl.createShader([gl.VERTEX_SHADER, gl.FRAGMENT_SHADER][i]);
    gl.shaderSource(shader, [vs.text, fs.text][i]);
    gl.compileShader(shader);
    console.log(gl.getShaderInfoLog(shader));
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {alert(gl.getShaderInfoLog(shader));}
    gl.attachShader(p1, shader);
    gl.deleteShader(shader);
}
gl.linkProgram(p1);
gl.useProgram(p1);
let perspective = function (fovy, aspect, near, far) {
    let v =  1 / Math.tan(fovy * Math.PI / 360.0);
    let u = v / aspect;
    let w = near - far;
    return new Float32Array([
        u, 0, 0, 0,
        0, v, 0, 0,
        0, 0, (near + far) / w, -1,
        0, 0, near * far * 2 / w, 0
    ]);
};
gl.uniformMatrix4fv(gl.getUniformLocation(p1, "pMatrix"), false,
    perspective(45, c.width / c.height, 0.1, 200));

let w = 1;
let h = 2;
let d = 0.3;
let position = new Float32Array([
    -w, -h, -d, -w, -h,  d,  w, -h,  d,  w, -h, -d,
    -w,  h, -d, -w,  h,  d,  w,  h,  d,  w,  h, -d,
    -w, -h, -d, -w,  h, -d,  w,  h, -d,  w, -h, -d,
    -w, -h,  d, -w,  h,  d,  w,  h,  d,  w, -h,  d,
    -w, -h, -d, -w, -h,  d, -w,  h,  d, -w,  h, -d,
     w, -h, -d,  w, -h,  d,  w,  h,  d,  w,  h, -d ]);
let normal = new Float32Array([
    0, -1,  0,  0, -1,  0,  0, -1,  0,  0, -1,  0,
    0,  1,  0,  0,  1,  0,  0,  1,  0,  0,  1,  0,
    0,  0, -1,  0,  0, -1,  0,  0, -1,  0,  0, -1,
    0,  0,  1,  0,  0,  1,  0,  0,  1,  0,  0,  1,
    -1,  0,  0, -1,  0,  0, -1,  0,  0, -1,  0,  0,
    1,  0,  0,  1,  0,  0,  1,  0,  0,  1,  0,  0 ]);
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

let idx = 0;
for (let i = 0; i < 2; i++) {
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, [position, normal][i], gl.STATIC_DRAW);
    gl.enableVertexAttribArray(idx);
    gl.vertexAttribPointer(idx, [3, 3][i], gl.FLOAT, false, 0, 0);
    idx++;
}

//let number = 450;
let number = 256;
let posStride = 3;
let quatStride = 4;
let colStride = 3;
let posBuffer =  gl.createBuffer();
let quatBuffer =  gl.createBuffer();
let colBuffer =  gl.createBuffer();
let posArray = new Float32Array(number * posStride);
let quatArray = new Float32Array(number * quatStride);
let colArray = new Float32Array(number * colStride);

for (let i = 0; i < 3; i++) {
    gl.bindBuffer(gl.ARRAY_BUFFER, [posBuffer, quatBuffer, colBuffer][i]);
    gl.bufferData(gl.ARRAY_BUFFER, [posArray, quatBuffer, colBuffer][i], gl.STATIC_DRAW);
    gl.enableVertexAttribArray(idx);
    gl.vertexAttribPointer(idx, [posStride, quatStride, colStride][i], gl.FLOAT, false, 0, 0);
    //gl.vertexAttribDivisor(idx, 1);
    ext.vertexAttribDivisorANGLE(idx, 1)
    idx++;
}

// physics
let world = new OIMO.World({ 
        timestep: 1/30, 
        iterations: 8, 
        broadphase: 2, // 1 brute force, 2 sweep and prune, 3 volume tree
        worldscale: 1, // scale full world 
        random: true,  // randomize sample
        info: false,   // calculate statistic or not
        gravity: [0,-9.8,0] 
    });

//let ground = new OIMO.Body({size:[100, 0.2, 100], pos:[0, -0.1, 0], world:world});
let ground = world.add({
        type: "box",
        size: [100, 0.2, 100],
        pos:[0, -0.1, 0],
        rot: [0, 1, 1],
        move: false,
        density: 1
    });

let bodys = [];
for (let i = 0; i < number; i++) {
    //let theta = i / number * 2 * Math.PI * 5;
    let theta = 0;
    let radius = i * 0.035 + 25;
    let x = (Math.floor(i / 16) - 8 )* 3;
    let y = h;
    let z = (8 - (i % 16)) * 3;
    bodys[i] = world.add({
        type: "box",
        size: [w * 2, h * 2, d * 2],
        pos: [x, y, z],
        rot: [0, -theta * 180 / Math.PI, 0],
        move: true,
        density: 1
    });
}
for ( let i = 0; i < 16; i++ ) {
    bodys[i * 16].resetRotation(-15, 0, 0); //trigger
}
for ( let i = 0; i < number; i++ ) {
    let c = dataSet[i];
    let color = getRgbColor(c);
    colArray[i * colStride + 0] = color[0];
    colArray[i * colStride + 1] = color[1];
    colArray[i * colStride + 2] = color[2];
}
gl.bindBuffer(gl.ARRAY_BUFFER, colBuffer);
gl.bufferData(gl.ARRAY_BUFFER, colArray, gl.STATIC_DRAW);

let data2buf = function () {
    let pIdx = 0;
    let qIdx = 0;
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
    gl.bufferData(gl.ARRAY_BUFFER, posArray, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, quatBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, quatArray, gl.STATIC_DRAW);
};
data2buf();

let time1;
let prevTime1 = Date.now();
let fps1 = 0;
setInterval(function () {
    time1 = Date.now();
    if (time1 - 1000 > prevTime1) {
        prevTime1 = time1;
        //div1.innerHTML = "Physics / Second : " + fps1; 
        fps1 = -1;
    }
    fps1++;   

    world.step();
    data2buf();
}, 1000 / 60);

let time0;
let prevTime0 = Date.now();
let fps0 = 0;
(function () {
    time0 = Date.now();
    if (time0 - 1000 > prevTime0) {
        prevTime0 = time0;
        fps0 = -1;
    }
    fps0++;
    
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(p1);
    ext.drawElementsInstancedANGLE(gl.TRIANGLES, indexCount, gl.UNSIGNED_SHORT, 0, number);
    
    requestAnimationFrame(arguments.callee);
})();
 