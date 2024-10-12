import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as CANNON from 'cannon';

let loader;
let texture_grass;
let texture_football;

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
        "無":0xDCAA6B,
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
    loader = new THREE.TextureLoader();
    texture_grass = loader.load('../../../../assets/textures/grass.jpg');
    texture_football = loader.load('../../../../assets/textures/football.png');

    let parentElement = document.body;

    world = new CANNON.World();
    world.gravity.set(0, -10, 0);
    world.broadphase = new CANNON.NaiveBroadphase();
    world.solver.iterations = 10;

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

    createBalls();

    controls = new OrbitControls( camera, renderer.domElement );
    controls.autoRotate = true;

    setInterval( () => {
        updatePhysics();
    }, 1000/60 );
}

function initLights() {
    let directionalLight, ambientLight;
    directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(0.4, 1, 0.3);
    scene.add(directionalLight);
    ambientLight = new THREE.AmbientLight(0x101020);
    scene.add(ambientLight);
}

function initGround() {
    let groundShape = new CANNON.Box(new CANNON.Vec3(50/2, 1/2, 50/2));
    let groundBody = new CANNON.Body({mass: 0});
    groundBody.addShape(groundShape);
    world.addBody(groundBody);

    let box = createBox(50, 1, 50);
    scene.add(box);
}

function createBox(w, h, d) {
    let material = new THREE.MeshBasicMaterial( { map: texture_grass } );
    let geometry = new THREE.BoxGeometry( w, h, d );
    let mesh = new THREE.Mesh(geometry, material);
    return mesh;
}

function createBall(x, y, z, w, h, d, mass, color) {
    let geometry, material, mesh, shape, body;

    shape = new CANNON.Sphere(w/2);
    body = new CANNON.Body({mass: mass});
    body.addShape(shape);
    body.position.x = x;
    body.position.y = y;
    body.position.z = z;
    world.addBody(body);

    geometry = new THREE.SphereGeometry(w/2, 36, 36);
    material = new THREE.MeshLambertMaterial({
        color: Math.round(color),
        map: texture_football
    });
    mesh = new THREE.Mesh(geometry, material);
    mesh.rigidBody = body;
    scene.add(mesh);
}

function createBalls() {
    const BALL_SIZE = 1;
    for (let x = 0; x < 16; x++) {
        for (let y = 0; y < 16; y++) {
            let i = x + (15 - y) * 16;
            let z = 0;
            let x1 = -10 + x * BALL_SIZE * 1.5 + Math.random() * 0.1;
            let y1 = 0 + (15 - y) * BALL_SIZE * 1.2 + Math.random() * 0.1;
            let z1 = z * BALL_SIZE * 1 + Math.random() * 0.1;
            let color = getRgbColor(dataSet[y * 16 + x]);
            let w = BALL_SIZE * 1;
            let h = BALL_SIZE * 1;
            let d = BALL_SIZE * 1;
            let mass = 1;
            createBall(x1, y1, z1, w, h, d, mass, color);
        }
    }
}

function animate() {
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
}

function updatePhysics() {
    world.step(TIME_STEP);

    (function updateObject3D(mesh) {
        if (mesh.rigidBody) {
            mesh.position.x = mesh.rigidBody.position.x;
            mesh.position.y = mesh.rigidBody.position.y;
            mesh.position.z = mesh.rigidBody.position.z;
            mesh.quaternion.x = mesh.rigidBody.quaternion.x;
            mesh.quaternion.y = mesh.rigidBody.quaternion.y;
            mesh.quaternion.z = mesh.rigidBody.quaternion.z;
            mesh.quaternion.w = mesh.rigidBody.quaternion.w;

            if (mesh.position.y < -10) {
                let x = -5 + Math.random() * 10;
                let y = 20 + Math.random() * 10;
                let z = -5 + Math.random() * 10;
                mesh.rigidBody.position.set(x, y, z);
                mesh.rigidBody.velocity.set(0, 0, 0);
            }
        }
        if (mesh.children) {
            mesh.children.map(updateObject3D);
        }
    })(scene);
}

init();
animate();
