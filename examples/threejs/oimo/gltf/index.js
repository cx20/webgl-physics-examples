'use strict';

var gltf = null;
var world, shape, body, ground, timeStep = 1 / 60;
var camera, scene, renderer, duck, plane,
    cubeSize = 1;

var wireframeCube;
var trackball;

var cubeSizeX = 16/16*5;
var cubeSizeY = 16/16*5;
var cubeSizeZ = 9/16*5;

function createCube(w, h, d) {
    var geometry = new THREE.CubeGeometry(w, h, d, 10, 10);
    var material = new THREE.MeshLambertMaterial({
        color: 0x666666
    });
    var mesh = new THREE.Mesh(geometry, material);

    return mesh;
}

function createWireframeCube(w, h, d) {
    var materialColor = 0x00ff00;
    var geometry = new THREE.CubeGeometry(w, h, d);
    var material = new THREE.MeshBasicMaterial({
        color: materialColor,
        wireframe:true
    });
    var mesh = new THREE.Mesh(geometry, material);

    return mesh;
}

function loadDuck() {
    var manager = new THREE.LoadingManager();
    manager.onProgress = function ( item, loaded, total ) {
        console.log( item, loaded, total );
    };

    var texture = new THREE.Texture();
    
    var objLoader = new THREE.GLTFLoader();
    objLoader.setCrossOrigin( 'anonymous' );
    var url =  'https://cdn.rawgit.com/cx20/gltf-test/5465cc37/sampleModels/Duck/glTF/Duck.gltf';
    objLoader.load(url, function ( data ) {
        gltf = data;
        var object = gltf.scene;
        object.traverse( function ( child ) {
            if ( child instanceof THREE.Mesh ) {
		        child.translateY(child.position.y - 100);
            }
        } );
        object.scale.set( 5, 5, 5 );
        duck = object;

        var axis = new THREE.AxesHelper(1000);   
        duck.add(axis);
        duck.castShadow = true;
        duck.receiveShadow = true;
        scene.add(duck);

        animate();
    });
}

function createPlane(w, h) {
    var geometry = new THREE.PlaneGeometry(w, h);
    var material = new THREE.MeshPhongMaterial({
        color: 0xffffff,
        specular: 0xeeeeee,
        shininess: 50
    });
    var mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = -5;

    return mesh;
}

function initOimo() {
    world = new OIMO.World({ 
        timestep: 1/60, 
        iterations: 8, 
        broadphase: 2, // 1 brute force, 2 sweep and prune, 3 volume tree
        worldscale: 1, // scale full world 
        random: true,  // randomize sample
        info: false,   // calculate statistic or not
        gravity: [0,-9.8,0] 
    });

    var groundBody = world.add({
        type: "box",
        size: [400*2, 4*2, 400*2],
        pos: [0, -5, 0],
        rot: [0, 0, 0],
        move: false,
        density: 1,
        friction: 0.5,
        restitution: 0.1,
    });
    body = world.add({
        type: "box",
        size: [cubeSizeX, cubeSizeY, cubeSizeZ],
        pos: [0, 20, 0],
        rot: [0, 0, 0],
        move: true,
        density: 1,
        friction: 0.5,
        restitution: 0.2
    });
    body.angularVelocity.set(0, 0, 3.5);
 }

function initThree() {
    var w = window.innerWidth;
    var h = window.innerHeight;
    camera = new THREE.PerspectiveCamera(30, w / h, 1, 10000);
    camera.position.set(20, 3, 20 );

    scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x000000, 1, 200);
    renderer = new THREE.WebGLRenderer({antialias: true});
    renderer.setSize(w, h);
    renderer.setClearColor(0x000000, 1);

    var light = new THREE.DirectionalLight(0xffffff, 2);
    var amb   = new THREE.AmbientLight(0x404040);
    var d = 10;

    light.position.set(d, d, -d);

    loadDuck();
    plane = createPlane(300, 300);
    plane.rotation.x = -Math.PI / 2;

    wireframeCube = createWireframeCube(cubeSizeX*2, cubeSizeY*2, cubeSizeZ*2);
    
    scene.add(camera);
    scene.add(light);
    scene.add(amb);

    scene.add(plane);
    scene.add(wireframeCube);

    document.body.appendChild(renderer.domElement);

    renderer.render(scene, camera);

    trackball = new THREE.TrackballControls(camera);
}

function animate() {
    trackball.update();
    requestAnimationFrame(animate);
    updatePhysics();
    render();
}

function updatePhysics() {
    world.step();

    duck.position.x = body.position.x;
    duck.position.y = body.position.y;
    duck.position.z = body.position.z;
    duck.quaternion.x = body.quaternion.x;
    duck.quaternion.y = body.quaternion.y;
    duck.quaternion.z = body.quaternion.z;
    duck.quaternion.w = body.quaternion.w;
    wireframeCube.position.x = body.position.x;
    wireframeCube.position.y = body.position.y;
    wireframeCube.position.z = body.position.z;
    wireframeCube.quaternion.x = body.quaternion.x;
    wireframeCube.quaternion.y = body.quaternion.y;
    wireframeCube.quaternion.z = body.quaternion.z;
    wireframeCube.quaternion.w = body.quaternion.w;
}

function render() {
    renderer.render(scene, camera);
}

initOimo();
initThree();

document.addEventListener('click', function () {
    //body.applyImpulse(body.position, new OIMO.Vec3(0, 5, 0));   // TODO:
    body.linearVelocity.set(0, 5, 0);
}, false);
