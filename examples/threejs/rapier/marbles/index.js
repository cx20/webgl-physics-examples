import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HDRCubeTextureLoader } from 'three/addons/loaders/HDRCubeTextureLoader.js';
import RAPIER from 'https://cdn.skypack.dev/@dimforge/rapier3d-compat@0.12.0';

const GLTF_URL = 'https://cx20.github.io/gltf-test/tutorialModels/IridescenceMetallicSpheres/glTF/IridescenceMetallicSpheres.gltf';

let camera, scene, renderer, controls;
let world;
const meshes = [];
const bodies = [];

async function init() {
    await RAPIER.init();

    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    document.getElementById('container').appendChild(renderer.domElement);

    // Scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x222222);

    // Environment map for PBR metallic / iridescent materials
    const BASE_HDR = 'https://cx20.github.io/gltf-test/textures/papermill_hdr/specular/';
    new HDRCubeTextureLoader().load([
        'specular_posx_0.hdr', 'specular_negx_0.hdr',
        'specular_posy_0.hdr', 'specular_negy_0.hdr',
        'specular_posz_0.hdr', 'specular_negz_0.hdr',
    ].map(f => BASE_HDR + f), (hdrCubeMap) => {
        hdrCubeMap.mapping = THREE.CubeReflectionMapping;
        const pmremGenerator = new THREE.PMREMGenerator(renderer);
        pmremGenerator.compileCubemapShader();
        scene.environment = pmremGenerator.fromCubemap(hdrCubeMap).texture;
        scene.background = hdrCubeMap;
        pmremGenerator.dispose();
    });

    // Camera
    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 1000);
    camera.position.set(18, 20, 30);

    // Lights
    scene.add(new THREE.AmbientLight(0x404040, 3));
    const dirLight = new THREE.DirectionalLight(0xffffff, 3);
    dirLight.position.set(30, 100, 50);
    dirLight.castShadow = true;
    dirLight.shadow.camera = new THREE.OrthographicCamera(-30, 30, 30, -30, 0.1, 500);
    dirLight.shadow.mapSize.set(1024, 1024);
    scene.add(dirLight);

    // OrbitControls
    controls = new OrbitControls(camera, renderer.domElement);
    controls.autoRotate = true;
    controls.autoRotateSpeed = 1.0;

    // Ground mesh
    const groundMat = new THREE.MeshLambertMaterial({ color: 0x3D4143 });
    const groundMesh = new THREE.Mesh(new THREE.BoxGeometry(40, 4, 40), groundMat);
    groundMesh.position.set(0, -2, 0);
    groundMesh.receiveShadow = true;
    scene.add(groundMesh);

    // Enclosure walls (semi-transparent)
    const wallMat = new THREE.MeshLambertMaterial({ color: 0x3D4143, transparent: true, opacity: 0.4 });
    const wallDefs = [
        { size: [10, 10,  1], pos: [ 0, 5, -5] },
        { size: [10, 10,  1], pos: [ 0, 5,  5] },
        { size: [ 1, 10, 10], pos: [-5, 5,  0] },
        { size: [ 1, 10, 10], pos: [ 5, 5,  0] },
    ];
    for (const { size, pos } of wallDefs) {
        const wallMesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), wallMat);
        wallMesh.position.set(pos[0], pos[1], pos[2]);
        scene.add(wallMesh);
    }

    // Rapier physics world
    const gravity = new RAPIER.Vector3(0, -10, 0);
    world = new RAPIER.World(gravity);

    // Ground physics body
    const groundBodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(0, -2, 0);
    const groundBody = world.createRigidBody(groundBodyDesc);
    world.createCollider(RAPIER.ColliderDesc.cuboid(20, 2, 20), groundBody);

    // Wall physics bodies
    const wallBodyDefs = [
        { half: [5, 5, 0.5], pos: [ 0, 5, -5] },
        { half: [5, 5, 0.5], pos: [ 0, 5,  5] },
        { half: [0.5, 5, 5], pos: [-5, 5,  0] },
        { half: [0.5, 5, 5], pos: [ 5, 5,  0] },
    ];
    for (const { half, pos } of wallBodyDefs) {
        const wallBodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(pos[0], pos[1], pos[2]);
        const wallBody = world.createRigidBody(wallBodyDesc);
        world.createCollider(RAPIER.ColliderDesc.cuboid(half[0], half[1], half[2]), wallBody);
    }

    // Load glTF (IridescenceMetallicSpheres)
    const loader = new GLTFLoader();
    loader.load(GLTF_URL, (gltf) => {
        const sphereNodes = [];
        gltf.scene.traverse((child) => {
            if (child.isMesh && child.name.includes('Sphere')) {
                sphereNodes.push(child);
            }
        });

        sphereNodes.forEach((mesh) => {
            const worldPos   = new THREE.Vector3();
            const worldQuat  = new THREE.Quaternion();
            const worldScale = new THREE.Vector3();
            mesh.getWorldPosition(worldPos);
            mesh.getWorldQuaternion(worldQuat);
            mesh.getWorldScale(worldScale);

            mesh.geometry.computeBoundingSphere();
            const geomRadius = mesh.geometry.boundingSphere.radius;
            const physicsRadius = Math.max(geomRadius * worldScale.x, 0.1);

            mesh.removeFromParent();
            scene.add(mesh);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            mesh.scale.copy(worldScale);

            const dropX = (Math.random() - 0.5) * 8;
            const dropY = 15 + Math.random() * 20;
            const dropZ = (Math.random() - 0.5) * 8;
            mesh.position.set(dropX, dropY, dropZ);

            const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
                .setTranslation(dropX, dropY, dropZ)
                .setLinearDamping(0.1)
                .setAngularDamping(0.1);
            const body = world.createRigidBody(bodyDesc);
            world.createCollider(RAPIER.ColliderDesc.ball(physicsRadius), body);

            meshes.push(mesh);
            bodies.push(body);
        });

        setInterval(updatePhysics, 1000 / 60);
        loop();
    });

    window.addEventListener('resize', onWindowResize);
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
            const y = 15 + Math.random() * 20;
            const z = (Math.random() - 0.5) * 8;
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
