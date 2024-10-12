import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

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

let TIME_STEP = 1 / 30;
let N = 256;
let world, camera, scene, renderer, rendererElement;
let controls;

function init() {
    // Stats
    let parentElement = document.body;

    // initialize cannon.js's world
    world = new CANNON.World();
    world.gravity.set(0, -10, 0);
    world.broadphase = new CANNON.NaiveBroadphase();
    world.solver.iterations = 10;
    world.defaultContactMaterial.frictionEquationStiffness = 100; // See: https://github.com/pmndrs/cannon-es/issues/94#issuecomment-890584298

    // initialize three.js's scene, camera and renderer
    renderer = new THREE.WebGLRenderer();
    renderer.setSize(window.innerWidth, window.innerHeight);
    parentElement.appendChild(renderer.domElement);

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.x = 8;
    camera.position.y = 20;
    camera.position.z = 50;
    camera.lookAt(new THREE.Vector3(0, 10, 0));

    initLights();
    initGround();

    createDominos();
    createShapes();

    controls = new OrbitControls( camera, renderer.domElement );
    controls.autoRotate = true;

    setInterval( () => {
        updatePhysics();
    }, 1000/60 );
}

// initialize lights
function initLights() {
    let directionalLight, ambientLight;
    directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(0.4, 1, 0.3);
    scene.add(directionalLight);
    ambientLight = new THREE.AmbientLight(0x101020);
    scene.add(ambientLight);
}

// ground
function initGround() {
    let groundShape = new CANNON.Plane(new CANNON.Vec3(0, 1, 0));
    let groundBody = new CANNON.Body({mass: 0});
    groundBody.addShape(groundShape);
    groundBody.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
    world.add(groundBody);

    // initialize Object3D
    let plane = createPlane(100, 100);
    plane.rotation.x = -Math.PI / 2;
    plane.position.y = 0;
    scene.add(plane);
}

function createPlane(w, h) {
    let loader = new THREE.TextureLoader();
    let texture = loader.load('../../../../assets/textures/grass.jpg');
    texture.wrapS   = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set( 5, 5 );  
    let material = new THREE.MeshLambertMaterial( { color: 0x777777, map: texture } );
    let geometry = new THREE.PlaneGeometry( w, h );
    let mesh = new THREE.Mesh(geometry, material);

    return mesh;
}

// create a shape
function createShape(x, y, z, w, h, d, mass, color) {
    let geometry, material, mesh, shape, body;

    // initialize rigid body
    //shape = new CANNON.Box(new CANNON.Vec3(w, h, d));
    shape = new CANNON.Sphere(w);
    body = new CANNON.Body({mass: mass});
    body.addShape(shape);

    //body.angularVelocity.set(0, 10, 0);
    body.position.x = x + Math.random()/10;
    body.position.y = y + Math.random()/10;
    body.position.z = z + Math.random()/10;
    body.quaternion.set(Math.random()/50, Math.random()/50, Math.random()/50, 0.2);
    world.add(body);

    // initialize Object3D
    let loader = new THREE.TextureLoader();
    let texture = loader.load('../../../../assets/textures/football.png');
    geometry = new THREE.SphereGeometry(w, 10, 10);
    material = new THREE.MeshLambertMaterial({
        color: Math.round(color),
        map: texture
    });
    mesh = new THREE.Mesh(geometry, material);
    mesh.rigidBody = body;
    scene.add(mesh);
}

// create a shape
function createDomino(x, y, z, w, h, d, mass, color) {
    let geometry, material, mesh, shape, body;

    // initialize rigid body
    shape = new CANNON.Box(new CANNON.Vec3(w/2, h/2, d/2));
    //shape = new CANNON.Sphere(w);
    body = new CANNON.Body({mass: mass});
    body.addShape(shape);
    body.position.x = x;
    body.position.y = y;
    body.position.z = z;
    world.add(body);

    // initialize Object3D
    geometry = new THREE.BoxGeometry(w, h, d);
    material = new THREE.MeshLambertMaterial({
        color: Math.round(color)
    });
    mesh = new THREE.Mesh(geometry, material);
    mesh.rigidBody = body;
    scene.add(mesh);
}


// sphere
function createDominos() {
    let box_size = 2;
    let w = box_size * 0.15;
    let h = box_size * 1.5;
    let d = box_size * 1.0;
    let mass = 1;
    for ( let y = 0; y < 16; y++ ) {
        for ( let x = 0; x < 16; x++ ) {
            let x1 = -8 * box_size + x * box_size * 1.0;
            let y1 = box_size;
            let z1 = -8 * box_size + y * box_size * 1.2;
            let color = getRgbColor( dataSet[y * 16 + x] );
            createDomino(x1, y1, z1, w, h, d, mass, color);
        }
    }
}

function createShapes() {
    let box_size = 2;
    let w = box_size / 2;
    let h = box_size / 2;
    let d = box_size / 2;
    let mass = 1;
    for ( let y = 0; y < 16; y++ ) {
        let x1 = -8 * box_size - 0.5;
        let y1 = 8;
        let z1 = -8 * box_size + (15 - y) * box_size * 1.2;
        let color = getRgbColor("白");
        createShape(x1, y1, z1, w, h, d, mass, color);
    }
}

function animate() {
    controls.update();

	// render graphical object
    renderer.render(scene, camera);

    // request next frame
    requestAnimationFrame(animate);
}

function updatePhysics() {
    // step physical simulation
    world.step(TIME_STEP);

    // position graphical object on physical object recursively
    (function updateObject3D(mesh) {
        if (mesh.rigidBody) {
            mesh.position.x = mesh.rigidBody.position.x;
            mesh.position.y = mesh.rigidBody.position.y;
            mesh.position.z = mesh.rigidBody.position.z;
            mesh.quaternion.x = mesh.rigidBody.quaternion.x;
            mesh.quaternion.y = mesh.rigidBody.quaternion.y;
            mesh.quaternion.z = mesh.rigidBody.quaternion.z;
            mesh.quaternion.w = mesh.rigidBody.quaternion.w;
        }
        if (mesh.children) {
            mesh.children.map(updateObject3D);
        }
    })(scene);
}

init();
animate();
