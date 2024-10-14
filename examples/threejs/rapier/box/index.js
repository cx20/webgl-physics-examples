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
let world, camera, scene, renderer, controls;

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

    // initGround を Rapier の初期化後に呼び出す
    initGround();

    createBoxes();

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
    // Rapier の地面のコライダー
    const groundColliderDesc = RAPIER.ColliderDesc.cuboid(25, 0.5, 25);
    const groundBodyDesc = RAPIER.RigidBodyDesc.fixed();
    const groundBody = world.createRigidBody(groundBodyDesc);
    world.createCollider(groundColliderDesc, groundBody);

    // Three.js の地面の作成
    const ground = createGround(50, 1, 50);
    scene.add(ground);
}

function createGround(w, h, d) {
    const material = new THREE.MeshBasicMaterial({ map: texture_grass });
    const geometry = new THREE.BoxGeometry(w, h, d);
    return new THREE.Mesh(geometry, material);
}

function createBox(x, y, z, w, h, d, mass, color) {
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

function createBoxes() {
    const BOX_SIZE = 1;
    for (let x = 0; x < 16; x++) {
        for (let y = 0; y < 16; y++) {
            let i = x + (15 - y) * 16;
            let z = 0;
            let x1 = -10 + x * BOX_SIZE * 1.5 + Math.random() * 0.1;
            let y1 = 0 + (15 - y) * BOX_SIZE * 1.2 + Math.random() * 0.1;
            let z1 = z * BOX_SIZE * 1 + Math.random() * 0.1;
            let color = getRgbColor(dataSet[y * 16 + x]);
            let w = BOX_SIZE;
            let h = BOX_SIZE;
            let d = BOX_SIZE;
            let mass = 1;
            createBox(x1, y1, z1, w, h, d, mass, color);
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

    scene.traverse((mesh) => {
        if (mesh.userData.physicsBody) {
            const body = mesh.userData.physicsBody;
            const position = body.translation();
            const rotation = body.rotation();

            mesh.position.set(position.x, position.y, position.z);
            mesh.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);

            // 床を超えて落ちたオブジェクトの位置をリセット
            if (mesh.position.y < -10) {
                const x = -5 + Math.random() * 10;
                const y = 20 + Math.random() * 10;
                const z = -5 + Math.random() * 10;
                body.setTranslation({ x, y, z }, true);
                body.setLinvel({ x: 0, y: 0, z: 0 }, true);
            }
        }
    });
}

init();
