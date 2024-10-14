import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import RAPIER from 'https://cdn.skypack.dev/@dimforge/rapier3d-compat@0.12.0';

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

function getRgbColor(c) {
    let colorHash = {
        "無": 0xDCAA6B,
        "白": 0xffffff,
        "肌": 0xffcccc,
        "茶": 0x800000,
        "赤": 0xff0000,
        "黄": 0xffff00,
        "緑": 0x00ff00,
        "水": 0x00ffff,
        "青": 0x0000ff,
        "紫": 0x800080
    };
    return colorHash[c];
}

let TIME_STEP = 1 / 30;
let world, camera, scene, renderer;
let controls;
let balls = [];
let bodies = [];

async function init() {
    await RAPIER.init();

    loader = new THREE.TextureLoader();
    texture_grass = loader.load('../../../../assets/textures/grass.jpg');
    texture_football = loader.load('../../../../assets/textures/football.png');

    const parentElement = document.body;

    // Three.js の初期設定
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(8, 20, 50);
    camera.lookAt(new THREE.Vector3(0, 10, 0));

    renderer = new THREE.WebGLRenderer();
    renderer.setSize(window.innerWidth, window.innerHeight);
    parentElement.appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.autoRotate = true;

    initLights();

    // Rapier の物理ワールド初期化
    const gravity = new RAPIER.Vector3(0, -10, 0);
    world = new RAPIER.World(gravity);

    // ground を初期化
    initGround();

    createBalls();

    setInterval(() => {
        updatePhysics();
    }, 1000 / 60);

    animate();
}

function initLights() {
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(0.4, 1, 0.3);
    scene.add(directionalLight);

    const ambientLight = new THREE.AmbientLight(0x101020);
    scene.add(ambientLight);
}

function initGround() {
    // Rapier の床のコライダー
    const groundColliderDesc = RAPIER.ColliderDesc.cuboid(25, 0.5, 25);
    const groundBodyDesc = RAPIER.RigidBodyDesc.fixed();
    const groundBody = world.createRigidBody(groundBodyDesc);
    world.createCollider(groundColliderDesc, groundBody);

    // Three.js の床メッシュ
    const box = createBox(50, 1, 50);
    scene.add(box);
}

function createBox(w, h, d) {
    const material = new THREE.MeshBasicMaterial({ map: texture_grass });
    const geometry = new THREE.BoxGeometry(w, h, d);
    return new THREE.Mesh(geometry, material);
}

function createBall(x, y, z, radius, mass, color) {
    const geometry = new THREE.SphereGeometry(radius, 36, 36);
    const material = new THREE.MeshLambertMaterial({
        color: Math.round(color),
        map: texture_football
    });
    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);
    balls.push(mesh);

    const colliderDesc = RAPIER.ColliderDesc.ball(radius);
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z);
    const body = world.createRigidBody(bodyDesc);
    world.createCollider(colliderDesc, body);
    bodies.push(body);
}

function createBalls() {
    const BALL_SIZE = 1;
    for (let x = 0; x < 16; x++) {
        for (let y = 0; y < 16; y++) {
            let z = 0;
            const color = getRgbColor(dataSet[y * 16 + x]);
            const x1 = -10 + x * BALL_SIZE * 1.5 + Math.random() * 0.1;
            const y1 = 0 + (15 - y) * BALL_SIZE * 1.2 + Math.random() * 0.1;
            const z1 = z * BALL_SIZE * 1 + Math.random() * 0.1;
            const radius = BALL_SIZE / 2;
            const mass = 1;
            createBall(x1, y1, z1, radius, mass, color);
        }
    }
}

function animate() {
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
}

function updatePhysics() {
    world.step();

    for (let i = 0; i < bodies.length; i++) {
        const body = bodies[i];
        const mesh = balls[i];

        const position = body.translation();
        const rotation = body.rotation();

        mesh.position.set(position.x, position.y, position.z);
        mesh.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);

        if (mesh.position.y < -10) {
            const x = -5 + Math.random() * 10;
            const y = 20 + Math.random() * 10;
            const z = -5 + Math.random() * 10;

            body.setTranslation({ x, y, z }, true);
            body.setLinvel({ x: 0, y: 0, z: 0 }, true);
            body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        }
    }
}

init();
