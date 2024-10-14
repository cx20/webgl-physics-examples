import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import RAPIER from 'https://cdn.skypack.dev/@dimforge/rapier3d-compat@0.12.0';

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
        "無": 0xDCAA6B,  // 段ボール色
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
let world, camera, scene, renderer, controls;

async function init() {
    await RAPIER.init();

    // Three.js シーンの初期化
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(8, 20, 50);
    camera.lookAt(new THREE.Vector3(0, 10, 0));

    renderer = new THREE.WebGLRenderer();
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.autoRotate = true;

    // Rapier の物理ワールド初期化
    const gravity = new RAPIER.Vector3(0, -10, 0);
    world = new RAPIER.World(gravity);

    initLights();
    initGround();
    createDominos();
    createShapes();

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
    // Rapier で床を設定
    const groundColliderDesc = RAPIER.ColliderDesc.cuboid(50, 0.1, 50);
    const groundBodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0, 0);
    const groundBody = world.createRigidBody(groundBodyDesc);
    world.createCollider(groundColliderDesc, groundBody);

    // Three.js で床を作成
    const plane = createPlane(100, 100);
    plane.rotation.x = -Math.PI / 2;
    plane.position.y = 0;
    scene.add(plane);
}

function createPlane(w, h) {
    const loader = new THREE.TextureLoader();
    const texture = loader.load('../../../../assets/textures/grass.jpg');
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(5, 5);
    const material = new THREE.MeshLambertMaterial({ color: 0x777777, map: texture });
    const geometry = new THREE.PlaneGeometry(w, h);
    return new THREE.Mesh(geometry, material);
}

function createShape(x, y, z, w, h, d, mass, color) {
    const geometry = new THREE.SphereGeometry(w, 10, 10);
    const material = new THREE.MeshLambertMaterial({
        color: Math.round(color),
        map: new THREE.TextureLoader().load('../../../../assets/textures/football.png')
    });
    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);

    const colliderDesc = RAPIER.ColliderDesc.ball(w);
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z);
    const body = world.createRigidBody(bodyDesc);
    world.createCollider(colliderDesc, body);

    mesh.userData.physicsBody = body;
}

function createDomino(x, y, z, w, h, d, mass, color) {
    const geometry = new THREE.BoxGeometry(w, h, d);
    const material = new THREE.MeshLambertMaterial({ color: Math.round(color) });
    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);

    const colliderDesc = RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2);
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z);
    const body = world.createRigidBody(bodyDesc);
    world.createCollider(colliderDesc, body);

    mesh.userData.physicsBody = body;
}

function createDominos() {
    const box_size = 2;
    const w = box_size * 0.15;
    const h = box_size * 1.5;
    const d = box_size * 1.0;
    const mass = 1;
    for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
            const x1 = -8 * box_size + x * box_size * 1.0;
            const y1 = box_size;
            const z1 = -8 * box_size + y * box_size * 1.2;
            const color = getRgbColor(dataSet[y * 16 + x]);
            createDomino(x1, y1, z1, w, h, d, mass, color);
        }
    }
}

function createShapes() {
    const box_size = 2;
    const w = box_size / 2;
    const h = box_size / 2;
    const d = box_size / 2;
    const mass = 1;
    for (let y = 0; y < 16; y++) {
        const x1 = -8 * box_size - 0.5;
        const y1 = 8;
        const z1 = -8 * box_size + (15 - y) * box_size * 1.2;
        const color = getRgbColor("白");
        createShape(x1, y1, z1, w, h, d, mass, color);
    }
}

function animate() {
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
}

function updatePhysics() {
    world.step();
    scene.traverse((mesh) => {
        if (mesh.userData.physicsBody) {
            const body = mesh.userData.physicsBody;
            const position = body.translation();
            const rotation = body.rotation();
            mesh.position.set(position.x, position.y, position.z);
            mesh.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
        }
    });
}

init();
