// NOTES : three.js 127 -> 128
// ES6 modules in examples/jsm now import using the bare specifier three.
// This change breaks working with modules in cdns such as https://www.jsdelivr.com/ and https://unpkg.com/. Please use https://www.skypack.dev/ instead.
// See: https://github.com/mrdoob/three.js/wiki/Migration-Guide#127--128
import * as THREE from 'https://cdn.skypack.dev/three@0.131.3/build/three.module.js';
import { OrbitControls } from 'https://cdn.skypack.dev/three@0.131.3/examples/jsm/controls/OrbitControls.js';
import * as CANNON from 'https://cdn.skypack.dev/cannon-es@0.18.0/dist/cannon-es.js';

let container;
let camera, scene, renderer;
let meshGround;
let meshCube;
let world;
let shape;
let body;
let controls;

function initCannon() {
    // Setup our world
    world = new CANNON.World();
    world.gravity.set(0, -9.82, 0);
    world.broadphase = new CANNON.NaiveBroadphase();
    world.solver.iterations = 10;

    // Materials
    let groundMaterial = new CANNON.Material("groundMaterial");
    
    // Adjust constraint equation parameters for ground/ground contact
    let ground_ground_cm = new CANNON.ContactMaterial(groundMaterial, groundMaterial, {
        friction: 0.5,
        restitution: 0.1,
    });
    
    world.addContactMaterial(ground_ground_cm);
    
    // Create a plane
    let groundBody = new CANNON.Body({
        mass: 0, // mass == 0 makes the body static
        position: new CANNON.Vec3(0, -45, 0),
        //material: groundMaterial
    });
    let groundShape = new CANNON.Box(new CANNON.Vec3(100, 1, 100));
    groundBody.addShape(groundShape);
    world.addBody(groundBody);

    // Create a box
    shape = new CANNON.Box(new CANNON.Vec3(50, 50, 50));
    body = new CANNON.Body({
        mass: 100, // kg
        position: new CANNON.Vec3(0, 100, 0), // m
        shape: shape,
        material: groundMaterial
    });
    body.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 1), Math.PI * 10/180);
    world.addBody(body);
}

function initThree() {
    container = document.getElementById('container');
    camera = new THREE.PerspectiveCamera(30, window.innerWidth / window.innerHeight, 1, 1000);
    camera.position.y = 50;
    camera.position.z = 200;
    scene = new THREE.Scene();

    let loader = new THREE.TextureLoader();
    let texture = loader.load('../../../../assets/textures/frog.jpg');  // frog.jpg

    let material = new THREE.MeshBasicMaterial({map: texture});
    let geometryGround = new THREE.BoxGeometry(200, 2, 200);
    meshGround = new THREE.Mesh(geometryGround, material);
    meshGround.position.y = -20;
    scene.add(meshGround);

    let geometryCube = new THREE.BoxGeometry(50, 50, 50);
    meshCube = new THREE.Mesh(geometryCube, material);
    meshCube.rigidBody = body; // THREE.Object3D#rigidBody has a field of CANNON.RigidBody
    scene.add(meshCube);

    renderer = new THREE.WebGLRenderer();
    renderer.setClearColor(0xffffff);
    renderer.setSize(window.innerWidth, window.innerHeight);
    container.appendChild(renderer.domElement);

    controls = new OrbitControls( camera, renderer.domElement );
    controls.autoRotate = true;
}

function animate() {
    controls.update();
    requestAnimationFrame(animate);
    updatePhysics();
    render();
}

function updatePhysics() {
    world.step(1/60);

    meshCube.position.x = body.position.x;
    meshCube.position.y = body.position.y;
    meshCube.position.z = body.position.z;
    meshCube.quaternion.x = body.quaternion.x;
    meshCube.quaternion.y = body.quaternion.y;
    meshCube.quaternion.z = body.quaternion.z;
    meshCube.quaternion.w = body.quaternion.w;
}

function render() {
    renderer.render(scene, camera);
}

initCannon();
initThree();
animate();
