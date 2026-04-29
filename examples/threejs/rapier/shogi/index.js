import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import RAPIER from 'https://cdn.skypack.dev/@dimforge/rapier3d-compat@0.12.0';

let camera, scene, light, renderer, container;
let controls;
let world;

const meshes = [];
const bodies = [];

const PIECE_COUNT = 220;

function createShogiGeometry(w, h, d) {
    const positions = [
        // Front face
        -0.5 * w, -0.5 * h,  0.7 * d,
         0.5 * w, -0.5 * h,  0.7 * d,
         0.35 * w, 0.5 * h,  0.4 * d,
        -0.35 * w, 0.5 * h,  0.4 * d,

        // Back face
        -0.5 * w, -0.5 * h, -0.7 * d,
         0.5 * w, -0.5 * h, -0.7 * d,
         0.35 * w, 0.5 * h, -0.4 * d,
        -0.35 * w, 0.5 * h, -0.4 * d,

        // Top face
         0.35 * w, 0.5 * h,  0.4 * d,
        -0.35 * w, 0.5 * h,  0.4 * d,
        -0.35 * w, 0.5 * h, -0.4 * d,
         0.35 * w, 0.5 * h, -0.4 * d,

        // Bottom face
        -0.5 * w, -0.5 * h,  0.7 * d,
         0.5 * w, -0.5 * h,  0.7 * d,
         0.5 * w, -0.5 * h, -0.7 * d,
        -0.5 * w, -0.5 * h, -0.7 * d,

        // Right face
         0.5 * w, -0.5 * h,  0.7 * d,
         0.35 * w, 0.5 * h,  0.4 * d,
         0.35 * w, 0.5 * h, -0.4 * d,
         0.5 * w, -0.5 * h, -0.7 * d,

        // Left face
        -0.5 * w, -0.5 * h,  0.7 * d,
        -0.35 * w, 0.5 * h,  0.4 * d,
        -0.35 * w, 0.5 * h, -0.4 * d,
        -0.5 * w, -0.5 * h, -0.7 * d,

        // Front2 face
        -0.35 * w, 0.5 * h,  0.4 * d,
         0.35 * w, 0.5 * h,  0.4 * d,
         0.0 * w,  0.6 * h,  0.35 * d,

        // Back2 face
        -0.35 * w, 0.5 * h, -0.4 * d,
         0.35 * w, 0.5 * h, -0.4 * d,
         0.0 * w,  0.6 * h, -0.35 * d,

        // Right2 Face
         0.35 * w, 0.5 * h,  0.4 * d,
         0.35 * w, 0.5 * h, -0.4 * d,
         0.0 * w,  0.6 * h, -0.35 * d,
         0.0 * w,  0.6 * h,  0.35 * d,

        // Left2 Face
        -0.35 * w, 0.5 * h,  0.4 * d,
        -0.35 * w, 0.5 * h, -0.4 * d,
         0.0 * w,  0.6 * h, -0.35 * d,
         0.0 * w,  0.6 * h,  0.35 * d,
    ];

    const texcoords = [
        // Front face
        0.5,          0.5,
        0.75,         0.5,
        0.75 - 0.25 / 8, 1.0,
        0.5  + 0.25 / 8, 1.0,

        // Back face
        0.5,          0.5,
        0.25,         0.5,
        0.25 + 0.25 / 8, 1.0,
        0.5  - 0.25 / 8, 1.0,

        // Top face
        0.75, 0.5,
        0.5,  0.5,
        0.5,  0.0,
        0.75, 0.0,

        // Bottom face
        0.0,  0.5,
        0.25, 0.5,
        0.25, 1.0,
        0.0,  1.0,

        // Right face
        0.0,  0.5,
        0.0,  0.0,
        0.25, 0.0,
        0.25, 0.5,

        // Left face
        0.5,  0.5,
        0.5,  0.0,
        0.25, 0.0,
        0.25, 0.5,

        // Front2 face
        0.75,  0.0,
        1.0,   0.0,
        1.0,   0.5,

        // Back2 face
        0.75,  0.0,
        1.0,   0.0,
        1.0,   0.5,

        // Right2 Face
        0.75,  0.0,
        1.0,   0.0,
        1.0,   0.5,
        0.75,  0.5,

        // Left2 Face
        0.75,  0.0,
        1.0,   0.0,
        1.0,   0.5,
        0.75,  0.5,
    ];

    const indices = [
         0,  1,  2,    0,  2,  3,
         4,  5,  6,    4,  6,  7,
         8,  9, 10,    8, 10, 11,
        12, 13, 14,   12, 14, 15,
        16, 17, 18,   16, 18, 19,
        20, 21, 22,   20, 22, 23,
        24, 25, 26,
        27, 28, 29,
        30, 33, 31,   33, 32, 31,
        34, 35, 36,   34, 36, 37,
    ];

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(texcoords, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
}

function addStaticBox(size, position, material) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), material);
    mesh.position.set(position[0], position[1], position[2]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
}

function randomQuaternion() {
    const euler = new THREE.Euler(
        Math.random() * Math.PI,
        Math.random() * Math.PI,
        Math.random() * Math.PI
    );
    return new THREE.Quaternion().setFromEuler(euler);
}

async function init() {
    await RAPIER.init();

    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 1000);
    camera.position.set(18, 24, 34);

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x2b2f38);
    scene.add(new THREE.HemisphereLight(0xbfd6ff, 0x2a2a2a, 0.9));
    scene.add(new THREE.AmbientLight(0x666666, 1.3));

    light = new THREE.DirectionalLight(0xffffff, 2.1);
    light.position.set(30, 100, 50);
    light.target.position.set(0, 0, 0);
    light.castShadow = true;
    light.shadow.camera = new THREE.OrthographicCamera(-30, 30, 30, -30, 0.1, 1000);
    scene.add(light);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.25;

    container = document.getElementById('container');
    container.appendChild(renderer.domElement);

    const loader = new THREE.TextureLoader();
    const shogiTexture = loader.load('../../../../assets/textures/shogi_001/shogi.png');
    shogiTexture.wrapS = THREE.ClampToEdgeWrapping;
    shogiTexture.wrapT = THREE.ClampToEdgeWrapping;
    shogiTexture.flipY = false;
    shogiTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();

    const shogiMaterial = new THREE.MeshLambertMaterial({
        map: shogiTexture,
        side: THREE.DoubleSide
    });

    controls = new OrbitControls(camera, renderer.domElement);
    controls.autoRotate = true;

    // Rapier physics world
    const gravity = new RAPIER.Vector3(0, -10, 0);
    world = new RAPIER.World(gravity);

    // Ground
    const groundBodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(0, -2, 0);
    const groundBody = world.createRigidBody(groundBodyDesc);
    world.createCollider(RAPIER.ColliderDesc.cuboid(20, 2, 20), groundBody);
    addStaticBox([40, 4, 40], [0, -2, 0], new THREE.MeshLambertMaterial({ color: 0x3D4143 }));

    // Walls
    const wallData = [
        { size: [10, 10,  1], pos: [ 0, 5, -5], half: [5, 5, 0.5] },
        { size: [10, 10,  1], pos: [ 0, 5,  5], half: [5, 5, 0.5] },
        { size: [ 1, 10, 10], pos: [-5, 5,  0], half: [0.5, 5, 5] },
        { size: [ 1, 10, 10], pos: [ 5, 5,  0], half: [0.5, 5, 5] },
    ];

    for (const wall of wallData) {
        addStaticBox(
            wall.size,
            wall.pos,
            new THREE.MeshLambertMaterial({ color: 0x3D4143, transparent: true, opacity: 0.4 })
        );
        const wallBodyDesc = RAPIER.RigidBodyDesc.fixed()
            .setTranslation(wall.pos[0], wall.pos[1], wall.pos[2]);
        const wallBody = world.createRigidBody(wallBodyDesc);
        world.createCollider(
            RAPIER.ColliderDesc.cuboid(wall.half[0], wall.half[1], wall.half[2]),
            wallBody
        );
    }

    const pieceW = 1.6;
    const pieceH = 1.6;
    const pieceD = 0.45;

    const pieceGeometry = createShogiGeometry(pieceW, pieceH, pieceD);

    for (let i = 0; i < PIECE_COUNT; i++) {
        const x = (Math.random() - 0.5) * 8;
        const y = 12 + Math.random() * 26;
        const z = (Math.random() - 0.5) * 8;
        const q = randomQuaternion();

        const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
            .setTranslation(x, y, z)
            .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
        const body = world.createRigidBody(bodyDesc);
        world.createCollider(
            RAPIER.ColliderDesc.cuboid(pieceW * 0.5, pieceH * 0.5, pieceD * 0.7),
            body
        );

        const mesh = new THREE.Mesh(pieceGeometry, shogiMaterial);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        scene.add(mesh);

        bodies.push(body);
        meshes.push(mesh);
    }

    setInterval(updatePhysics, 1000 / 60);
    window.addEventListener('resize', onWindowResize, false);
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
            const x = (Math.random() - 0.5) * 8;
            const y = 12 + Math.random() * 26;
            const z = (Math.random() - 0.5) * 8;
            const q = randomQuaternion();
            body.setTranslation({ x, y, z }, true);
            body.setLinvel({ x: 0, y: 0, z: 0 }, true);
            body.setAngvel({ x: 0, y: 0, z: 0 }, true);
            body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
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
loop();
