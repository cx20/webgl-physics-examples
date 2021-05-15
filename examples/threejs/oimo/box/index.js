﻿let container;
let camera, scene, renderer;
let meshGround;
let meshCube;
let world;
let body;
let controls;

let loader;
let texture_grass;

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

function initOimo() {
    world = new OIMO.World({ 
        timestep: 1/60, 
        iterations: 8, 
        broadphase: 2, // 1 brute force, 2 sweep and prune, 3 volume tree
        worldscale: 1, // scale full world 
        random: true,  // randomize sample
        info: false,   // calculate statistic or not
        gravity: [0, -9.8, 0] 
    });
    let groundBody = world.add({
        type: "box",
        size: [50, 1, 50],
        pos: [0, -5, 0],
        rot: [0, 0, 0],
        move: false,
        density: 1,
    });
}

function initThree() {
    container = document.getElementById('container');
    camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.x = 0;
    camera.position.y = 20;
    camera.position.z = 50;
    scene = new THREE.Scene();

    loader = new THREE.TextureLoader();
    texture_grass = loader.load('../../../../assets/textures/grass.jpg');

    let material = new THREE.MeshBasicMaterial({map: texture_grass});
    let geometryGround = new THREE.BoxGeometry(50, 1, 50);
    meshGround = new THREE.Mesh(geometryGround, material);
    meshGround.position.y = -5;
    scene.add(meshGround);

    renderer = new THREE.WebGLRenderer();
    renderer.setClearColor(0x000000);
    renderer.setSize(window.innerWidth, window.innerHeight);
    container.appendChild(renderer.domElement);

    controls = new THREE.OrbitControls( camera, renderer.domElement );
    controls.autoRotate = true;
}

function initLights() {
    let directionalLight, ambientLight;
    directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(0.2, 0.5, 0.3);
    scene.add(directionalLight);
    ambientLight = new THREE.AmbientLight(0x101020);
    scene.add(ambientLight);
}

function createBox(x, y, z, w, h, d, mass, color) {
    let body = world.add({
        type: "box",
        size: [w, h, d],
        pos: [x, y, z],
        rot: [0, 0, 0],
        move: true,
        density: 1,
    });

    geometry = new THREE.BoxGeometry(w, h, d);
    material = new THREE.MeshLambertMaterial({
        color: Math.round(color),
    });
    mesh = new THREE.Mesh(geometry, material);
    mesh.rigidBody = body;
    scene.add(mesh);
}

function createBoxes() {
    const BOX_SIZE = 1;
    for (let x = 0; x < 16; x++) {
        for (let y = 0; y < 16; y++) {
            i = x + (15 - y) * 16;
            let z = 0;
            let x1 = -10 + x * BOX_SIZE * 1.5 + Math.random() * 0.1;
            let y1 = -5  + (15 - y) * BOX_SIZE * 1.2 + Math.random() * 0.1;
            let z1 = z * BOX_SIZE * 1 + Math.random() * 0.1;
            let color = getRgbColor(dataSet[y * 16 + x]);
            let w = BOX_SIZE * 1;
            let h = BOX_SIZE * 1;
            let d = BOX_SIZE * 1;
            let mass = 1;
            createBox(x1, y1, z1, w, h, d, mass, color);
        }
    }
}

function animate() {
    controls.update();
    requestAnimationFrame(animate);
    updatePhysics();
    render();
}

function updatePhysics() {
    world.step();

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

function render() {
    renderer.render(scene, camera);
}

initOimo();
initThree();
initLights();
createBoxes();
animate();
