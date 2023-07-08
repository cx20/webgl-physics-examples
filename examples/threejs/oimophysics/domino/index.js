import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

let container;
let camera, scene, renderer;
let meshGround;
let meshCube;
let world;
let body;
let controls;

let SCALE = 1;

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

function initOimo() {
    world = new OIMO.World();
    world.gravity = new OIMO.Vec3(0, -9.80665, 0);
    
    let groundShapec = new OIMO.ShapeConfig();
    groundShapec.geometry = new OIMO.BoxGeometry(new OIMO.Vec3(25*SCALE, 0, 25*SCALE));
    let groundBodyc = new OIMO.RigidBodyConfig();
    groundBodyc.type = OIMO.RigidBodyType.STATIC;
    groundBodyc.position = new OIMO.Vec3(0, 0, 0);
    let groundBody = new OIMO.RigidBody(groundBodyc);
    groundBody.addShape(new OIMO.Shape(groundShapec));
    world.addRigidBody(groundBody);
}

function initThree() {
    container = document.getElementById('container');
    camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.x = 0;
    camera.position.y = 20*SCALE;
    camera.position.z = 30*SCALE;
    scene = new THREE.Scene();

    let loader = new THREE.TextureLoader();
    let texture = loader.load('../../../../assets/textures/grass.jpg');

    let material = new THREE.MeshBasicMaterial({map: texture});
    let geometryGround = new THREE.PlaneGeometry(50*SCALE, 50*SCALE);
    meshGround = new THREE.Mesh(geometryGround, material);
    meshGround.rotation.x = -Math.PI * 90 / 180;
    meshGround.position.y = 0; // -20;
    scene.add(meshGround);

    renderer = new THREE.WebGLRenderer();
    renderer.setClearColor(0xffffff);
    renderer.setSize(window.innerWidth, window.innerHeight);
    container.appendChild(renderer.domElement);

    controls = new OrbitControls( camera, renderer.domElement );
    controls.autoRotate = true;
}

// initialize lights
function initLights() {
    let directionalLight, ambientLight;
    directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(0.2, 0.5, 0.3);
    scene.add(directionalLight);
    ambientLight = new THREE.AmbientLight(0x101020);
    scene.add(ambientLight);
}

function createDomino(x, y, z, w, h, d, mass, color) {
    let geometry, material, mesh, shape;
    // initialize rigid body
    let shapec = new OIMO.ShapeConfig();
    shapec.geometry = new OIMO.BoxGeometry(new OIMO.Vec3(w/2, h/2, d/2));
    let bodyc = new OIMO.RigidBodyConfig();
    bodyc.type = OIMO.RigidBodyType.DYNAMIC;
    bodyc.position.x = x; // + Math.random()/10;
    bodyc.position.y = y; // + Math.random()/10;
    bodyc.position.z = z; // + Math.random()/10;
    let body = new OIMO.RigidBody(bodyc);
    body.addShape(new OIMO.Shape(shapec));
    world.addRigidBody(body);

    // initialize Object3D
    geometry = new THREE.BoxGeometry(w, h, d);
    material = new THREE.MeshLambertMaterial({
        color: Math.round(color)
    });
    mesh = new THREE.Mesh(geometry, material);
    mesh.rigidBody = body;
    scene.add(mesh);
}

function createDominos() {
    let box_size = 1*SCALE;
    for ( let y = 0; y < 16; y++ ) {
        for ( let x = 0; x < 16; x++ ) {
            let x1 = -5*SCALE + x * box_size * 0.95;
            let y1 = box_size * 0.5;
            let z1 = -5*SCALE + y * box_size * 1.2;
            let color = getRgbColor( dataSet[y * 16 + x] );
            createDomino(x1, y1, z1, box_size*0.2, box_size*1, box_size*1, 1, color);
        }
    }

    for ( let i = 0; i < 16; i++ ) {
        let x1 = -5*SCALE - 0.2*SCALE;
        let y1 = box_size * 3;
        let z1 = -5*SCALE + i * box_size * 1.2;
        let color = 0xff0000;
        createDomino(x1, y1, z1, box_size, box_size, box_size, 1, color);
    }
}

function animate() {
    controls.update();
    requestAnimationFrame(animate);
    updatePhysics();
    render();
}

function updatePhysics() {
    world.step(1/60);

    // position graphical object on physical object recursively
    (function updateObject3D(mesh) {
        if (mesh.rigidBody) {
            mesh.position.x = mesh.rigidBody.getPosition().x;
            mesh.position.y = mesh.rigidBody.getPosition().y;
            mesh.position.z = mesh.rigidBody.getPosition().z;
            mesh.quaternion.x = mesh.rigidBody.getOrientation().x;
            mesh.quaternion.y = mesh.rigidBody.getOrientation().y;
            mesh.quaternion.z = mesh.rigidBody.getOrientation().z;
            mesh.quaternion.w = mesh.rigidBody.getOrientation().w;
        }
        if (mesh.children) {
            mesh.children.map(updateObject3D);
        }
    })(scene);
}

function render() {
    renderer.render(scene, camera);
}

initOimo();
initThree();
initLights();
createDominos();
animate();
