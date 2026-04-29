import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import RAPIER from 'https://cdn.skypack.dev/@dimforge/rapier3d-compat@0.17.3';

let container;
let camera, scene, renderer;
let meshGround, meshCube;
let world, groundBody, boxBody;
let controls;

async function initRapier() {
    await RAPIER.init();
    world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });

    const groundColliderDesc = RAPIER.ColliderDesc.cuboid(2, 0.05, 2).setRestitution(0.1).setFriction(0.5);
    const groundBodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0, 0);
    groundBody = world.createRigidBody(groundBodyDesc);
    world.createCollider(groundColliderDesc, groundBody);

    const boxColliderDesc = RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5);
    const boxBodyDesc = RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 2, 0);
    boxBody = world.createRigidBody(boxBodyDesc);
    world.createCollider(boxColliderDesc, boxBody);

    const rotQuat = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(1, 0, 1).normalize(),
        Math.PI * 10 / 180
    );
    boxBody.setRotation({ x: rotQuat.x, y: rotQuat.y, z: rotQuat.z, w: rotQuat.w }, true);
}

function initThree() {
    container = document.getElementById('container');
    camera = new THREE.PerspectiveCamera(30, window.innerWidth / window.innerHeight, 0.1, 100);
    camera.position.y = 3;
    camera.position.z = 6;
    scene = new THREE.Scene();

    const loader = new THREE.TextureLoader();
    const texture = loader.load('../../../../assets/textures/frog.jpg');
    const material = new THREE.MeshBasicMaterial({ map: texture });

    const geometryGround = new THREE.BoxGeometry(4, 0.1, 4);
    meshGround = new THREE.Mesh(geometryGround, material);
    meshGround.position.y = 0;
    scene.add(meshGround);

    const geometryCube = new THREE.BoxGeometry(1, 1, 1);
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
