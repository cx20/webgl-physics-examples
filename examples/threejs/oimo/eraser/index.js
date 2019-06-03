// three var
let camera, scene, light, renderer, container, content;
let meshs = [];
let grounds = [];
//let paddel;
let matGround, matGroundTrans;
let matPocky = [];
let matKoala;
let matMono;
let buffgeoBox;
let buffgeoMono;
let buffgeoCylinder;
let raycaster, projector;
let ToRad = Math.PI / 180;
let ToDeg = 180 / Math.PI;
let rotTest;
let controls;

//oimo var
let world = null;
let bodys = null;

let fps = [0,0,0,0];
let type=1;

init();
loop();

function init() {
    
    camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.x = 0;
    camera.position.y = 20;
    camera.position.z = 500;
    
    scene = new THREE.Scene();
    
    content = new THREE.Object3D();
    scene.add(content);
    
    scene.add( new THREE.AmbientLight( 0x3D4143 ) );
    
    light = new THREE.DirectionalLight( 0xffffff , 1);
    light.position.set( 300, 1000, 500 );
    light.target.position.set( 0, 0, 0 );
    light.castShadow = true;
    scene.add( light );
    
    // background
    let buffgeoBack = new THREE.BufferGeometry();
    buffgeoBack.fromGeometry( new THREE.IcosahedronGeometry(8000,1) );
    
    buffgeoSphere = new THREE.BufferGeometry();
    buffgeoSphere.fromGeometry( new THREE.SphereGeometry( 1, 20, 10 ) );
    
    buffgeoBox = new THREE.BufferGeometry();
    buffgeoBox.fromGeometry( new THREE.BoxGeometry( 1, 1, 1 ) );
    buffgeoMono = new THREE.BoxGeometry( 1, 1, 1 );

    buffgeoCylinder= new THREE.BufferGeometry();
    buffgeoCylinder.fromGeometry( new THREE.CylinderGeometry( 0.5, 0.5, 1, 6 ) );
    
    let materials = [
       new THREE.MeshLambertMaterial({map: THREE.ImageUtils.loadTexture('../../../../assets/textures/eraser_003/eraser_right.png')}),
       new THREE.MeshLambertMaterial({map: THREE.ImageUtils.loadTexture('../../../../assets/textures/eraser_003/eraser_left.png')}),
       new THREE.MeshLambertMaterial({map: THREE.ImageUtils.loadTexture('../../../../assets/textures/eraser_003/eraser_top.png')}),
       new THREE.MeshLambertMaterial({map: THREE.ImageUtils.loadTexture('../../../../assets/textures/eraser_003/eraser_bottom.png')}),
       new THREE.MeshLambertMaterial({map: THREE.ImageUtils.loadTexture('../../../../assets/textures/eraser_003/eraser_front.png')}),
       new THREE.MeshLambertMaterial({map: THREE.ImageUtils.loadTexture('../../../../assets/textures/eraser_003/eraser_back.png')})
    ];
    
    matBox = new THREE.MeshLambertMaterial( {  map: basicTexture(0), name:'box' } );
    matMono = new THREE.MeshFaceMaterial( materials );
    matGround = new THREE.MeshLambertMaterial( { color: 0x3D4143 } );
    matGroundTrans = new THREE.MeshLambertMaterial( { color: 0x3D4143, transparent:true, opacity:0.6 } );
    
    renderer = new THREE.WebGLRenderer({precision: "mediump", antialias:false });
    renderer.setSize( window.innerWidth, window.innerHeight );
    renderer.autoClear = false;
    
    controls = new THREE.OrbitControls( camera, renderer.domElement );
    controls.userPan = false;
    controls.userPanSpeed = 0.0;
    controls.maxDistance = 5000.0;
    controls.maxPolarAngle = Math.PI * 0.4;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 5.0;

    rotTest = new THREE.Vector3();
    
    container = document.getElementById("container");
    container.appendChild( renderer.domElement );
    
    //initEvents();
    initOimoPhysics();
}

function loop() {
    requestAnimationFrame( loop );
    controls.update();
    renderer.clear();
    renderer.render( scene, camera );
}

function addStaticBox(size, position, rotation, spec) {
    let mesh;
    if(spec) mesh = new THREE.Mesh( buffgeoBox, matGroundTrans );
    else mesh = new THREE.Mesh( buffgeoBox, matGround );
    mesh.scale.set( size[0], size[1], size[2] );
    mesh.position.set( position[0], position[1], position[2] );
    mesh.rotation.set( rotation[0]*ToRad, rotation[1]*ToRad, rotation[2]*ToRad );
    if(!grounds.length) content.add( mesh );
    else scene.add( mesh );
    grounds.push(mesh);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
}

function clearMesh(){
    let i=meshs.length;
    while (i--) scene.remove(meshs[ i ]);
    i = grounds.length;
    while (i--) scene.remove(grounds[ i ]);
    grounds = [];
    meshs = [];
}

//----------------------------------
//  OIMO PHYSICS
//----------------------------------

function initOimoPhysics(){
    
    //world = new OIMO.World(1/60, 2);
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
    setInterval(updateOimoPhysics, 1000/60);
    
}

function populate(n) {
    
    // The Bit of a collision group
    let group1 = 1 << 0;  // 00000000 00000000 00000000 00000001
    let group2 = 1 << 1;  // 00000000 00000000 00000000 00000010
    let group3 = 1 << 2;  // 00000000 00000000 00000000 00000100
    let all = 0xffffffff; // 11111111 11111111 11111111 11111111
    
    let max = 120;
    
    type = 2;
    
    // reset old
    clearMesh();
    world.clear();
    bodys = [];
    
    // Is all the physics setting for rigidbody
    let config = [
        1, // The density of the shape.
        0.4, // The coefficient of friction of the shape.
        0.2, // The coefficient of restitution of the shape.
        1, // The bits of the collision groups to which the shape belongs.
        all // The bits of the collision groups with which the shape collides.
    ];
    
    
    
    //add ground
    //let ground = new OIMO.Body({size:[400, 40, 400], pos:[0,-20,0], world:world, config:config});
    let ground = world.add({
        type: "box",
        size: [400, 40, 400],
        pos: [0, -20, 0],
        rot: [0, 0, 0],
        move: false,
        density: 1,
        friction: 0.5,
        restitution: 0.1,
    });
    addStaticBox([400, 40, 400], [0,-20,0], [0,0,0]);
    
    let ground2 = world.add({
        type: "box",
        size: [200, 30, 390],
        pos: [130, 40, 0],
        rot: [0, 0, 32],
        move: false,
        density: 1,
        friction: 0.5,
        restitution: 0.1,
    });
    addStaticBox([200, 30, 390], [130,40,0], [0,0,32]);
    
    // now add object
    let x, y, z, w, h, d;
    let i = max;
    
    while (i--){
        t = type;
        x = 150;
        z = -100 + Math.random()*200;
        y = 100 + Math.random()*1000;
        w = 43;
        h = 11;
        d = 17;
        
        config[4] = all;
        
        if(t===2){
            config[3] = group3;
		    bodys[i] = world.add({
		        type: "box",
		        size: [w, h, d],
		        pos: [x, y, z],
		        move: true,
		        density: 1,
		        friction: 0.5,
		        restitution: 0.1,
		    });
            meshs[i] = new THREE.Mesh( buffgeoMono, matMono );
            meshs[i].scale.set( w, h, d );
        }
        meshs[i].castShadow = true;
        meshs[i].receiveShadow = true;
        
        scene.add( meshs[i] );
    }
    
    config[3] = 1;
    config[4] = all;
}



function updateOimoPhysics() {
    
    world.step();
    
    let p, r, m, x, y, z;
    let mtx = new THREE.Matrix4();
    let i = bodys.length;
    let mesh;
    let body;
    
    while (i--){
        body = bodys[i];
        mesh = meshs[i];
        
        if(!body.sleeping){
            
            mesh.position.copy(body.getPosition());
            mesh.quaternion.copy(body.getQuaternion());
            
            // change material
            if(mesh.material.name === 'box') mesh.material = matBox; 
            
            // reset position
            if(mesh.position.y<-100){
                x = 150;
                z = -100 + Math.random()*200;
                y = 100 + Math.random()*1000;
                body.resetPosition(x,y,z);
            }
        }
    }
}

function gravity(g){
    nG = document.getElementById("gravity").value
    world.gravity = new OIMO.Vec3(0, nG, 0);
}

let unwrapDegrees = function (r) {
    r = r % 360;
    if (r > 180) r -= 360;
    if (r < -180) r += 360;
    return r;
}

function basicTexture(n){
    let canvas = document.createElement( 'canvas' );
    canvas.width = canvas.height = 64;
    let ctx = canvas.getContext( '2d' );
    let colors = [];

    if(n===0){ // box
        colors[0] = "#AA8058";
        colors[1] = "#FFAA58";
    }
    if(n===1){ // pocky1(normal)
        colors[0] = "#FFC14D";
        colors[1] = "#684B48";
    }
    if(n===2){ // pocky2(strawberry)
        colors[0] = "#FFC14D";
        colors[1] = "#D36FC0";
    }
    if(n===3){ // pocky3(pretz)
        colors[0] = "#FFC14D";
        colors[1] = "#FFC14D";
    }
    
    if(n!==0){
        ctx.fillStyle = colors[0];
        ctx.fillRect(0, 0, 64, 64);
        ctx.fillStyle = colors[1];
        ctx.fillRect(0, 0, 64, 52);
    }else{
        ctx.fillStyle = colors[0];
        ctx.fillRect(0, 0, 64, 64);
        ctx.fillStyle = colors[1];
        ctx.fillRect(0, 0, 32, 32);
        ctx.fillRect(32, 32, 32, 32);
    }

    let tx = new THREE.Texture(canvas);
    tx.needsUpdate = true;
    return tx;
}
