import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HDRCubeTextureLoader } from 'three/addons/loaders/HDRCubeTextureLoader.js';
import * as CANNON from 'cannon';

const GLTF_URL = 'https://cx20.github.io/gltf-test/tutorialModels/IridescenceMetallicSpheres/glTF/IridescenceMetallicSpheres.gltf';

let camera, scene, renderer, controls;
let world;
const meshes = [];
const bodies = [];
const TIME_STEP = 1 / 60;

function init() {
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
    // Environment map (HDR cube map) for PBR metallic / iridescent materials
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
        const wallMesh = new THREE.Mesh(
            new THREE.BoxGeometry(size[0], size[1], size[2]), wallMat
        );
        wallMesh.position.set(pos[0], pos[1], pos[2]);
        scene.add(wallMesh);
    }

    // Physics world (cannon-es)
    world = new CANNON.World();
    world.gravity.set(0, -10, 0);
    world.broadphase = new CANNON.NaiveBroadphase();
    world.solver.iterations = 10;

    // Ground physics body
    const groundBody = new CANNON.Body({ mass: 0 });
    groundBody.addShape(new CANNON.Box(new CANNON.Vec3(20, 2, 20)));
    groundBody.position.set(0, -2, 0);
    world.addBody(groundBody);

    // Wall physics bodies
    const wallBodyDefs = [
        { half: [5, 5, 0.5], pos: [ 0, 5, -5] },
        { half: [5, 5, 0.5], pos: [ 0, 5,  5] },
        { half: [0.5, 5, 5], pos: [-5, 5,  0] },
        { half: [0.5, 5, 5], pos: [ 5, 5,  0] },
    ];
    for (const { half, pos } of wallBodyDefs) {
        const body = new CANNON.Body({ mass: 0 });
        body.addShape(new CANNON.Box(new CANNON.Vec3(half[0], half[1], half[2])));
        body.position.set(pos[0], pos[1], pos[2]);
        world.addBody(body);
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
            // Capture world transform before detaching from glTF scene graph
            const worldPos   = new THREE.Vector3();
            const worldQuat  = new THREE.Quaternion();
            const worldScale = new THREE.Vector3();
            mesh.getWorldPosition(worldPos);
            mesh.getWorldQuaternion(worldQuat);
            mesh.getWorldScale(worldScale);

            // Compute physics radius from geometry bounding sphere × world scale
            mesh.geometry.computeBoundingSphere();
            const geomRadius = mesh.geometry.boundingSphere.radius;
            const physicsRadius = Math.max(geomRadius * worldScale.x, 0.1);

            // Detach from glTF hierarchy and add to main scene
            mesh.removeFromParent();
            scene.add(mesh);
            mesh.castShadow = true;
            mesh.receiveShadow = true;

            // Restore world scale as local scale (parent is now scene root)
            mesh.scale.copy(worldScale);

            // Random drop position inside the enclosure
            const dropX = (Math.random() - 0.5) * 8;
            const dropY = 15 + Math.random() * 20;
            const dropZ = (Math.random() - 0.5) * 8;
            mesh.position.set(dropX, dropY, dropZ);

            // Physics body
            const body = new CANNON.Body({ mass: 1 });
            body.addShape(new CANNON.Sphere(physicsRadius));
            body.linearDamping  = 0.1;
            body.angularDamping = 0.1;
            body.position.set(dropX, dropY, dropZ);
            world.addBody(body);

            meshes.push(mesh);
            bodies.push(body);
        });

        setInterval(updatePhysics, 1000 / 60);
        loop();
    });

    window.addEventListener('resize', onWindowResize);
}

function updatePhysics() {
    world.step(TIME_STEP);

    for (let i = 0; i < bodies.length; i++) {
        const body = bodies[i];
        const mesh = meshes[i];

        const p = body.position;
        const q = body.quaternion;
        mesh.position.set(p.x, p.y, p.z);
        mesh.quaternion.set(q.x, q.y, q.z, q.w);

        // Respawn if fallen below ground
        if (mesh.position.y < -10) {
            const x = (Math.random() - 0.5) * 8;
            const y = 15 + Math.random() * 20;
            const z = (Math.random() - 0.5) * 8;
            body.position.set(x, y, z);
            body.velocity.set(0, 0, 0);
            body.angularVelocity.set(0, 0, 0);
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
