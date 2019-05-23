let DOT_SIZE = 16;
let X_START_POS = 0;
let Y_START_POS = 0;
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
        "無":0xDCAA6B,    // 段ボール色
        "白":0xffffff,
        "肌":0xffcccc,
        "茶":0x800000,
        "赤":0xff0000,
        "黄":0xffff00,
        "緑":0x00ff00,
        "水":0x00ffff,
        "青":0x0000ff,
        "紫":0x800080
    };
    return colorHash[ c ];
}


// three var
let camera, scene, light, renderer, container, center;
let meshs = [];
let geoBox, geoSphere;
let matBox, matSphere, matBoxSleep, matSphereSleep;

let camPos = { horizontal: 40, vertical: 60, distance: 400, automove: false };
let mouse = { ox:0, oy:0, h:0, v:0, mx:0, my:0, down:false, over:false, moving:true };

//oimo var
let world;
let wakeup = false;
let bodys = [];

let fps=0, time, time_prev=0, fpsint = 0;
let ToRad = Math.PI / 180;
let type=2;

init();
  
function init() {
    
    // three init
    renderer = new THREE.WebGLRenderer({precision: "mediump", antialias:false, clearColor: 0x585858, clearAlpha: 0});
    renderer.setClearColor( 0x000, 1 );
    renderer.setSize( window.innerWidth, window.innerHeight );
    
    container = document.getElementById("container");
    container.appendChild( renderer.domElement );

    camera = new THREE.PerspectiveCamera( 70, window.innerWidth / window.innerHeight, 1, 1000 );
    camera.position.set( 0, 150, 300 );
    center = new THREE.Vector3();
    camera.lookAt(center);
    
    scene = new THREE.Scene();

    //scene.add( new THREE.AmbientLight( 0x383838 ) );

    light = new THREE.DirectionalLight( 0xffffff , 1.3);
    light.position.set( 0.3, 1, 0.5 );
    scene.add( light );
        
    //add ground mesh
    let mat = new THREE.MeshLambertMaterial( { color: 0x151515 } );
    let geo0 = new THREE.CubeGeometry( 100, 40, 400 );
    let geo1 = new THREE.CubeGeometry( 400, 40, 400 );
        
    let mground1 = new THREE.Mesh( geo1, mat );
    mground1.position.y = -50;
    scene.add( mground1 );

    geoSphere = new THREE.SphereGeometry( 1 , 20, 10 );
    geoBox = new THREE.CubeGeometry( 1, 1, 1 );

    matSphere = new THREE.MeshLambertMaterial( { map: basicTexture(0), name:'sph' } );
    matBox = new THREE.MeshLambertMaterial( {    map: basicTexture(2), name:'box' } );
    matSphereSleep = new THREE.MeshLambertMaterial( { map: basicTexture(1), name:'ssph' } );
    matBoxSleep = new THREE.MeshLambertMaterial( {  map: basicTexture(3), name:'sbox' } );

    // oimo init
    world = new OIMO.World({ 
        timestep: 1/30, 
        iterations: 8, 
        broadphase: 2, // 1 brute force, 2 sweep and prune, 3 volume tree
        worldscale: 1, // scale full world 
        random: true,  // randomize sample
        info: false,   // calculate statistic or not
        gravity: [0,-9.8,0] 
    });
    populate(1);
        
    // loop
        
    setInterval(loop, 1000 / 60);

    // events

    window.addEventListener( 'resize', onWindowResize, false );
    container.addEventListener( 'mousemove', onMouseMove, false );
    container.addEventListener( 'mousedown', onMouseDown, false );
    container.addEventListener( 'mouseout', onMouseUp, false );
    container.addEventListener( 'mouseup', onMouseUp, false );
    container.addEventListener( 'mousewheel', onMouseWheel, false );
    container.addEventListener( 'DOMMouseScroll', onMouseWheel, false ); // firefox
        
}

function populate(n) {
    
    let max = 256;
    
    if(n===1){ type = 1;}
    else if(n===2){ type = 2;}
    else if(n===3){ type = 3;}

    // reset old
    clearMesh();
    world.clear();

    //add ground
    let ground2 = world.add({
        type: "box",
        size: [400, 40, 400],
        pos: [0,-50,0],
        rot: [0, 0, 0],
        move: false,
        density: 1,
        friction: 0.5,
        restitution: 0.1,
    });

    //add object
    let w = DOT_SIZE*0.2;
    let h = DOT_SIZE*1.5;
    let d = DOT_SIZE;

    let color;
    let i;
    for ( let x = 0; x < 16; x++ ) {
        for ( let z = 0; z < 16; z ++ ) {
            i = x + (z) * 16;
            color = getRgbColor( dataSet[i] );
            y = 0;
            bodys[i] = world.add({
                type: "box",
                size: [w, h, d],
                pos: [-120+x*DOT_SIZE,y*DOT_SIZE,-120+z*DOT_SIZE*1.2],
                rot: [0, 0, 0],
                move: true,
                density: 1,
                friction: 0.5,
                restitution: 0.1,
            });
            let material = new THREE.MeshLambertMaterial( { color: color } );
            meshs[i] = new THREE.Mesh( geoBox, material );
            meshs[i].scale.set( w, h, d );
            scene.add( meshs[i] );
        }
    }
    let size = bodys.length;
    for ( i = 0; i < 16; i++ ) 
    {
        w = DOT_SIZE;
        h = DOT_SIZE;
        d = DOT_SIZE;
        x = 0;
        y = 2;
        z = i;
        bodys[size+i] = world.add({
            type: "box",
            size: [w, h, d],
            pos: [-125+x*DOT_SIZE,y*DOT_SIZE,-120+z*DOT_SIZE*1.2],
            rot: [0, 0, 0],
            move: true,
            density: 1,
            friction: 0.5,
            restitution: 0.1,
        });
        let material = new THREE.MeshLambertMaterial( { color: "#f00" } );
        meshs[size+i] = new THREE.Mesh( geoBox, material );
        meshs[size+i].scale.set( w, h, d );
        scene.add( meshs[size+i] );
    }
}

function clearMesh(){
    let i=meshs.length;
    while (i--){scene.remove(meshs[ i ]);}
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize( window.innerWidth, window.innerHeight );
}

// MAIN LOOP

function loop() {
    
    world.step();
    
    let p, r, m, x, y, z;
    let mtx = new THREE.Matrix4();
    let i = bodys.length;
    let mesh;
    wakeup = false;
    
    while (i--){
        let body = bodys[i];
        mesh = meshs[i];
        mesh.position.x = body.position.x;
        mesh.position.y = body.position.y;
        mesh.position.z = body.position.z;
        mesh.quaternion.x = body.quaternion.x;
        mesh.quaternion.y = body.quaternion.y;
        mesh.quaternion.z = body.quaternion.z;
        mesh.quaternion.w = body.quaternion.w;
    }

    renderer.render( scene, camera );
}

function moveCamera() {
    camera.position.copy(Orbit(center, camPos.horizontal, camPos.vertical, camPos.distance));
    camera.lookAt(center);
}

// TEXTURE

function basicTexture(n){
   let canvas = document.createElement( 'canvas' );
   canvas.width = canvas.height = 64;
   let ctx = canvas.getContext( '2d' );
   let colors = [];
   if(n===0){ // sphere
        colors[0] = "#58AA80";
        colors[1] = "#58FFAA";
    }
    if(n===1){ // sphere sleep
        colors[0] = "#383838";
        colors[1] = "#38AA80";
    }
    if(n===2){ // box
        colors[0] = "#AA8058";
        colors[1] = "#FFAA58";
    }
    if(n===3){ // box sleep
        colors[0] = "#383838";
        colors[1] = "#AA8038";
    }
    ctx.fillStyle = colors[0];
    ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = colors[1];
    ctx.fillRect(0, 0, 32, 32);
    ctx.fillRect(32, 32, 32, 32);

    let tx = new THREE.Texture(canvas);
    tx.needsUpdate = true;
    return tx;
}

// MATH

function Orbit(origine, horizontal, vertical, distance) {
    let p = new THREE.Vector3();
    let phi = vertical*ToRad;
    let theta = horizontal*ToRad;
    p.x = (distance * Math.sin(phi) * Math.cos(theta)) + origine.x;
    p.z = (distance * Math.sin(phi) * Math.sin(theta)) + origine.z;
    p.y = (distance * Math.cos(phi)) + origine.y;
    return p;
}

// MOUSE 

function onMouseDown(e) {
    e.preventDefault();
    mouse.ox = e.clientX;
    mouse.oy = e.clientY;
    mouse.h = camPos.horizontal;
    mouse.v = camPos.vertical;
    mouse.down = true;
}

function onMouseUp(e) {
    mouse.down = false;
    document.body.style.cursor = 'auto';
}

function onMouseMove(e) {
    e.preventDefault();
    if (mouse.down ) {
        document.body.style.cursor = 'move';
        camPos.horizontal = ((e.clientX - mouse.ox) * 0.3) + mouse.h;
        camPos.vertical = (-(e.clientY - mouse.oy) * 0.3) + mouse.v;
        moveCamera();
    }
}

function onMouseWheel(e) {
    let delta = 0;
    if(e.wheelDeltaY){delta=e.wheelDeltaY*0.01;}
    else if(e.wheelDelta){delta=e.wheelDelta*0.05;}
    else if(e.detail){delta=-e.detail*1.0;}
    camPos.distance-=(delta*10);
    moveCamera();
    
}
