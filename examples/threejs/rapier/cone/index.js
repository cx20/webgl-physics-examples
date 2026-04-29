import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import RAPIER from 'https://cdn.skypack.dev/@dimforge/rapier3d-compat@0.12.0';

let camera, scene, light, renderer, container;
let controls;
let world;

const meshes = [];
const bodies = [];

const CONE_COUNT = 200;
const CONE_HALF_HEIGHT = 2;
const CONE_RADIUS = 1;

let buffgeoCone, buffgeoBox;
let matCone, matGround, matGroundTrans;

function addStaticBox(size, position, transparent = false) {
    const mat = transparent ? matGroundTrans : matGround;
    const mesh = new THREE.Mesh(buffgeoBox, mat);
    mesh.scale.set(size[0], size[1], size[2]);
    mesh.position.set(position[0], position[1], position[2]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
}

async function init() {
    await RAPIER.init();

    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 1000);
    camera.position.set(18, 20, 30);

    scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0x3D4143));

    light = new THREE.DirectionalLight(0xffffff, 1);
    light.position.set(30, 100, 50);
    light.target.position.set(0, 0, 0);
    light.castShadow = true;
    light.shadow.camera = new THREE.OrthographicCamera(-30, 30, 30, -30, 0.1, 1000);
    scene.add(light);

    buffgeoCone = new THREE.CylinderGeometry(0.1, CONE_RADIUS, CONE_HALF_HEIGHT * 2, 20);
    buffgeoBox = new THREE.BoxGeometry(1, 1, 1);

    const loader = new THREE.TextureLoader();
    const texture = loader.load('../../../../assets/textures/carrot.jpg');

    matCone = new THREE.MeshLambertMaterial({ map: texture });
    matGround = new THREE.MeshLambertMaterial({ color: 0x3D4143 });
    matGroundTrans = new THREE.MeshLambertMaterial({ color: 0x3D4143, transparent: true, opacity: 0.6 });

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;

    container = document.getElementById('container');
    container.appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.autoRotate = true;

    // Rapier physics world
    const gravity = new RAPIER.Vector3(0, -9.8, 0);
    world = new RAPIER.World(gravity);

    // Ground
    const groundBodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(0, -2, 0);
    const groundBody = world.createRigidBody(groundBodyDesc);
    world.createCollider(
        RAPIER.ColliderDesc.cuboid(20, 2, 20).setFriction(0.6).setRestitution(0.2),
        groundBody
    );
    addStaticBox([40, 4, 40], [0, -2, 0]);

    // Walls
    const wallData = [
        { size: [10, 10,  1], pos: [ 0, 5, -5], half: [5, 5, 0.5] },
        { size: [10, 10,  1], pos: [ 0, 5,  5], half: [5, 5, 0.5] },
        { size: [ 1, 10, 10], pos: [-5, 5,  0], half: [0.5, 5, 5] },
        { size: [ 1, 10, 10], pos: [ 5, 5,  0], half: [0.5, 5, 5] },
    ];

    for (const wall of wallData) {
        addStaticBox(wall.size, wall.pos, true);
        const wallBodyDesc = RAPIER.RigidBodyDesc.fixed()
            .setTranslation(wall.pos[0], wall.pos[1], wall.pos[2]);
        const wallBody = world.createRigidBody(wallBodyDesc);
        world.createCollider(
            RAPIER.ColliderDesc.cuboid(wall.half[0], wall.half[1], wall.half[2]),
            wallBody
        );
    }

    // Cones
    for (let i = 0; i < CONE_COUNT; i++) {
        const x = -5 + Math.random() * 10;
        const y = 20 + Math.random() * 10;
        const z = -5 + Math.random() * 10;

        const bodyDesc = RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z);
        const body = world.createRigidBody(bodyDesc);
        world.createCollider(
            RAPIER.ColliderDesc.cone(CONE_HALF_HEIGHT, CONE_RADIUS)
                .setFriction(0.6)
                .setRestitution(0.2),
            body
        );

        const mesh = new THREE.Mesh(buffgeoCone, matCone);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        scene.add(mesh);

        bodies.push(body);
        meshes.push(mesh);
    }

    setInterval(updatePhysics, 1000 / 60);
    window.addEventListener('resize', onWindowResize, false);
    loop();
}

function updatePhysics() {
    world.step();

    for (let i = 0; i < bodies.length; i++) {
        const body = bodies[i];
        const mesh = meshes[i];

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

function loop() {
    renderer.render(scene, camera);
    controls.update();
    requestAnimationFrame(loop);
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

init();
