import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import RAPIER from 'https://cdn.skypack.dev/@dimforge/rapier3d-compat@0.12.0';

let container;
let camera, scene, renderer;
let meshGround, meshCube;
let world, groundBody, boxBody;
let controls;

async function initRapier() {
    await RAPIER.init();
    const gravity = new RAPIER.Vector3(0, -9.81, 0);
    world = new RAPIER.World(gravity);

    const groundColliderDesc = RAPIER.ColliderDesc.cuboid(100, 1, 100).setRestitution(0.1).setFriction(0.5);
    const groundBodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(0, -45, 0);
    groundBody = world.createRigidBody(groundBodyDesc);
    world.createCollider(groundColliderDesc, groundBody);

    const boxColliderDesc = RAPIER.ColliderDesc.cuboid(50, 50, 50);
    const boxBodyDesc = RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 100, 0);
    boxBody = world.createRigidBody(boxBodyDesc);
    world.createCollider(boxColliderDesc, boxBody);

    const rotationAxis = new RAPIER.Vector3(1, 0, 1);
    const angle = Math.PI * 10 / 180;
    boxBody.setRotation(rotationAxis, angle);
}

function initThree() {
    container = document.getElementById('container');
    camera = new THREE.PerspectiveCamera(30, window.innerWidth / window.innerHeight, 1, 1000);
    camera.position.y = 50;
    camera.position.z = 200;
    scene = new THREE.Scene();

    const loader = new THREE.TextureLoader();
    const texture = loader.load('../../../../assets/textures/frog.jpg');
    const material = new THREE.MeshBasicMaterial({ map: texture });

    const geometryGround = new THREE.BoxGeometry(200, 2, 200);
    meshGround = new THREE.Mesh(geometryGround, material);
    meshGround.position.y = -20;
    scene.add(meshGround);

    const geometryCube = new THREE.BoxGeometry(50, 50, 50);
    meshCube = new THREE.Mesh(geometryCube, material);
    scene.add(meshCube);

    renderer = new THREE.WebGLRenderer();
    renderer.setClearColor(0xffffff);
    renderer.setSize(window.innerWidth, window.innerHeight);
    container.appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.autoRotate = true;

    setInterval(() => {
        updatePhysics();
    }, 1000 / 60);
}

function updatePhysics() {
    world.step();

    const boxPosition = boxBody.translation();
    const boxRotation = boxBody.rotation();

    meshCube.position.set(boxPosition.x, boxPosition.y, boxPosition.z);
    meshCube.quaternion.set(boxRotation.x, boxRotation.y, boxRotation.z, boxRotation.w);
}

function animate() {
    controls.update();
    requestAnimationFrame(animate);
    render();
}

function render() {
    renderer.render(scene, camera);
}

initRapier().then(() => {
    initThree();
    animate();
});
