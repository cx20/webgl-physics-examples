import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import RAPIER from 'https://cdn.skypack.dev/@dimforge/rapier3d-compat@0.12.0';

// three.js 用変数
let camera, scene, light, renderer, container, content;
let controls;
let meshs = [];
let grounds = [];
let matSphere, matGround, matGroundTrans;
let matSpheres = [];
let buffgeoSphere, buffgeoBox;
const ToRad = Math.PI / 180;
const TIME_STEP = 1 / 30;

const dataSet = [
    {imageFile:"../../../../assets/textures/Basketball.jpg", scale:1.0}, // Basketball.jpg
    {imageFile:"../../../../assets/textures/BeachBall.jpg",  scale:0.9}, // BeachBall.jpg
    {imageFile:"../../../../assets/textures/Football.jpg",   scale:1.0}, // Football.jpg
    {imageFile:"../../../../assets/textures/Softball.jpg",   scale:0.3}, // Softball.jpg
    {imageFile:"../../../../assets/textures/TennisBall.jpg", scale:0.3}, // TennisBall.jpg
];
let textures = [];
let world;
let bodys = [];

async function init() {
    await RAPIER.init();
    
    // Three.js の初期設定
    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 1000);
    camera.position.set(18, 20, 30);

    scene = new THREE.Scene();

    content = new THREE.Object3D();
    scene.add(content);

    scene.add(new THREE.AmbientLight(0x3D4143));

    light = new THREE.DirectionalLight(0xffffff, 1);
    light.position.set(30, 100, 50);
    light.target.position.set(0, 0, 0);
    light.castShadow = true;
    light.shadow.camera = new THREE.OrthographicCamera(-30, 30, 30, -30, 0.1, 1000);
    scene.add(light);

    buffgeoSphere = new THREE.SphereGeometry(1, 20, 10);
    buffgeoBox = new THREE.BoxGeometry(1, 1, 1);

    let loader = new THREE.TextureLoader();

    for (let i = 0; i < dataSet.length; i++) {
        let imageFile = dataSet[i].imageFile;
        textures[i] = loader.load(imageFile);
        matSpheres[i] = new THREE.MeshLambertMaterial({
            map: textures[i],
            name: 'sph' + i
        });
    }
    matGround = new THREE.MeshLambertMaterial({
        color: 0x3D4143,
        transparent: false
    });
    matGroundTrans = new THREE.MeshLambertMaterial({
        color: 0x3D4143,
        transparent: true,
        opacity: 0.6
    });

    renderer = new THREE.WebGLRenderer();
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;

    container = document.getElementById("container");
    container.appendChild(renderer.domElement);

    controls = new OrbitControls( camera, renderer.domElement );
    controls.autoRotate = true;

    // Rapier の物理ワールド初期化
    const gravity = new RAPIER.Vector3(0, -10, 0);
    world = new RAPIER.World(gravity);

    initRapierPhysics();

    setInterval( () => {
        updatePhysics();
    }, 1000 / 60);

    loop();
}

function addStaticBox(size, position, rotation, spec) {
    const mesh = new THREE.Mesh(buffgeoBox, spec ? matGroundTrans : matGround);
    mesh.scale.set(size[0], size[1], size[2]);
    mesh.position.set(position[0], position[1], position[2]);
    mesh.rotation.set(rotation[0] * ToRad, rotation[1] * ToRad, rotation[2] * ToRad);
    grounds.push(mesh);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
}

function initRapierPhysics() {
    let groundColliderDesc = RAPIER.ColliderDesc.cuboid(20, 2, 20);
    let groundBodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(0, -2, 0);
    let groundBody = world.createRigidBody(groundBodyDesc);
    world.createCollider(groundColliderDesc, groundBody);

    addStaticBox([40, 4, 40], [0, -2, 0], [0, 0, 0]);

    let boxDataSet = [
        { size: [10, 10,  1], pos: [ 0, 5, -5], rot: [0, 0, 0] },
        { size: [10, 10,  1], pos: [ 0, 5,  5], rot: [0, 0, 0] },
        { size: [ 1, 10, 10], pos: [-5, 5,  0], rot: [0, 0, 0] },
        { size: [ 1, 10, 10], pos: [ 5, 5,  0], rot: [0, 0, 0] }
    ];

    for (let i = 0; i < boxDataSet.length; i++) {
        const { size, pos, rot } = boxDataSet[i];
        const colliderDesc = RAPIER.ColliderDesc.cuboid(size[0] / 2, size[1] / 2, size[2] / 2);
        const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(pos[0], pos[1], pos[2]);
        world.createRigidBody(bodyDesc);
        world.createCollider(colliderDesc, bodyDesc);

        addStaticBox(size, pos, rot, true);
    }

    // ボールの初期化
    for (let i = 0; i < 200; i++) {
        const x = -5 + Math.random() * 10;
        const y = 20 + Math.random() * 10;
        const z = -5 + Math.random() * 10;
        const w = 1;

        const pos = Math.floor(Math.random() * dataSet.length);
        const scale = dataSet[pos].scale;
        const radius = w * scale;

        const colliderDesc = RAPIER.ColliderDesc.ball(radius);
        const bodyDesc = RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z);
        const body = world.createRigidBody(bodyDesc);
        world.createCollider(colliderDesc, body);
        bodys[i] = body;

        const mesh = new THREE.Mesh(buffgeoSphere, matSpheres[pos]);
        mesh.scale.set(scale, scale, scale);
        mesh.castShadow = true;
        mesh.receiveShadow = true;

        scene.add(mesh);
        meshs[i] = mesh;
    }
}

function updatePhysics() {
    world.step();

    for (let i = 0; i < bodys.length; i++) {
        const body = bodys[i];
        const mesh = meshs[i];

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

            // 速度と回転速度をリセット
            body.setLinvel({ x: 0, y: 0, z: 0 }, true);
            body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        }
    }
}

function loop() {
    renderer.render(scene, camera);
    controls.update();
    requestAnimationFrame(loop);
}

init();
