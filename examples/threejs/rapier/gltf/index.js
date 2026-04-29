import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import RAPIER from 'https://cdn.skypack.dev/@dimforge/rapier3d-compat@0.12.0';

let world, body;
let camera, scene, renderer, duck, plane;
let wireframeCube;
let controls;

const cubeSizeX = 16 / 16 * 5;
const cubeSizeY = 16 / 16 * 5;
const cubeSizeZ = 9 / 16 * 5;

function createWireframeCube(w, h, d) {
    const geometry = new THREE.BoxGeometry(w, h, d);
    const material = new THREE.MeshBasicMaterial({ color: 0x00ff00, wireframe: true });
    return new THREE.Mesh(geometry, material);
}

function createPlane(w, h) {
    const geometry = new THREE.PlaneGeometry(w, h);
    const material = new THREE.MeshPhongMaterial({
        color: 0xffffff,
        specular: 0xeeeeee,
        shininess: 50
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = -5;
    return mesh;
}

function loadDuck() {
    const loader = new GLTFLoader();
    const url = 'https://rawcdn.githack.com/cx20/gltf-test/5465cc37/sampleModels/Duck/glTF/Duck.gltf';
    loader.load(url, function(data) {
        const object = data.scene;
        object.traverse(function(child) {
            if (child instanceof THREE.Mesh) {
                child.translateY(child.position.y - 100);
            }
        });
        object.scale.set(5, 5, 5);
        duck = object;
        duck.castShadow = true;
        duck.receiveShadow = true;
        scene.add(duck);

        setInterval(() => {
            updatePhysics();
        }, 1000 / 60);

        animate();
    });
}

async function init() {
    await RAPIER.init();

    const w = window.innerWidth;
    const h = window.innerHeight;

    camera = new THREE.PerspectiveCamera(30, w / h, 1, 10000);
    camera.position.set(20, 3, 20);

    scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x000000, 1, 200);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(w, h);
    renderer.setClearColor(0x000000, 1);

    const light = new THREE.DirectionalLight(0xffffff, 2);
    light.position.set(10, 10, -10);
    const amb = new THREE.AmbientLight(0x404040);

    plane = createPlane(300, 300);
    plane.rotation.x = -Math.PI / 2;

    wireframeCube = createWireframeCube(cubeSizeX * 2, cubeSizeY * 2, cubeSizeZ * 2);

    scene.add(camera);
    scene.add(light);
    scene.add(amb);
    scene.add(plane);
    scene.add(wireframeCube);

    document.body.appendChild(renderer.domElement);
    renderer.render(scene, camera);

    controls = new OrbitControls(camera, renderer.domElement);

    // Rapier physics
    const gravity = new RAPIER.Vector3(0, -9.8, 0);
    world = new RAPIER.World(gravity);

    // Ground
    const groundBodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(0, -5, 0);
    const groundBody = world.createRigidBody(groundBodyDesc);
    world.createCollider(RAPIER.ColliderDesc.cuboid(400, 4, 400), groundBody);

    // Duck rigid body
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 20, 0);
    body = world.createRigidBody(bodyDesc);
    body.setAngvel({ x: 0, y: 0, z: 3.5 }, true);
    const colliderDesc = RAPIER.ColliderDesc.cuboid(cubeSizeX, cubeSizeY, cubeSizeZ)
        .setFriction(0.5)
        .setRestitution(0.2);
    world.createCollider(colliderDesc, body);

    loadDuck();
}

function animate() {
    controls.update();
    requestAnimationFrame(animate);
    renderer.render(scene, camera);
}

function updatePhysics() {
    world.step();

    const position = body.translation();
    const rotation = body.rotation();

    duck.position.set(position.x, position.y, position.z);
    duck.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);

    wireframeCube.position.set(position.x, position.y, position.z);
    wireframeCube.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
}

init();

document.addEventListener('click', function() {
    body.setLinvel({ x: 0, y: 5, z: 0 }, true);
}, false);
