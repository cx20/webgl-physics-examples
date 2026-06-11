import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

let showWireframe = true;
let container;
let camera, scene, renderer;
let meshGround;
let meshCube;
let world;
let body;
let controls;
let debugGround, debugCube;

function initOimo() {
    world = new OIMO.World();
    world.gravity = new OIMO.Vec3(0, -9.80665, 0);
    
    let groundShapec = new OIMO.ShapeConfig();
    groundShapec.geometry = new OIMO.BoxGeometry(new OIMO.Vec3(2, 0.05, 2));
    let groundBodyc = new OIMO.RigidBodyConfig();
    groundBodyc.type = OIMO.RigidBodyType.STATIC;
    groundBodyc.position = new OIMO.Vec3(0, 0, 0);
    let groundBody = new OIMO.RigidBody(groundBodyc);
    groundBody.addShape(new OIMO.Shape(groundShapec));
    world.addRigidBody(groundBody);
    
    let shapec = new OIMO.ShapeConfig();
    shapec.geometry = new OIMO.BoxGeometry(new OIMO.Vec3(0.5, 0.5, 0.5));
    let bodyc = new OIMO.RigidBodyConfig();
    bodyc.type = OIMO.RigidBodyType.DYNAMIC;
    bodyc.position = new OIMO.Vec3(0, 2, 0);
    body = new OIMO.RigidBody(bodyc);
    body.setRotationXyz(new OIMO.Vec3(Math.PI*10/180, 0, Math.PI*10/180));
    body.addShape(new OIMO.Shape(shapec));
    world.addRigidBody(body);
}

function initThree() {
    container = document.getElementById('container');
    camera = new THREE.PerspectiveCamera(30, window.innerWidth / window.innerHeight, 0.1, 100);
    camera.position.y = 3;
    camera.position.z = 6;
    scene = new THREE.Scene();

    let loader = new THREE.TextureLoader();
    let texture = loader.load('../../../../assets/textures/frog.jpg');  // frog.jpg

    let material = new THREE.MeshBasicMaterial({map: texture});
    let geometryGround = new THREE.BoxGeometry(4, 0.1, 4);
    meshGround = new THREE.Mesh(geometryGround, material);
    meshGround.position.y = 0;
    scene.add(meshGround);
    debugGround = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(4, 0.1, 4)),
        new THREE.LineBasicMaterial({ color: 0x44ee88 })
    );
    scene.add(debugGround);

    let geometryCube = new THREE.BoxGeometry(1, 1, 1);
    meshCube = new THREE.Mesh(geometryCube, material);
    scene.add(meshCube);
    debugCube = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
        new THREE.LineBasicMaterial({ color: 0xff8844 })
    );
    debugCube.position.set(0, 2, 0);
    scene.add(debugCube);

    renderer = new THREE.WebGLRenderer();
    renderer.setClearColor(0xffffff);
    renderer.setSize(window.innerWidth, window.innerHeight);
    container.appendChild(renderer.domElement);

    controls = new OrbitControls( camera, renderer.domElement );
    controls.autoRotate = true;

    setInterval( () => {
        updatePhysics();
    }, 1000/60 );
}

function animate() {
    controls.update();
    requestAnimationFrame(animate);
    render();
}

function updatePhysics() {
    world.step(1/60);

    meshCube.position.x = body.getPosition().x;
    meshCube.position.y = body.getPosition().y;
    meshCube.position.z = body.getPosition().z;
    meshCube.quaternion.x = body.getOrientation().x;
    meshCube.quaternion.y = body.getOrientation().y;
    meshCube.quaternion.z = body.getOrientation().z;
    meshCube.quaternion.w = body.getOrientation().w;
    if (debugCube) {
        debugCube.position.set(body.getPosition().x, body.getPosition().y, body.getPosition().z);
        debugCube.quaternion.set(body.getOrientation().x, body.getOrientation().y, body.getOrientation().z, body.getOrientation().w);
    }
}

function render() {
    renderer.render(scene, camera);
}

function setWireframeVisible(visible) {
    showWireframe = visible;
    if (debugGround) debugGround.visible = visible;
    if (debugCube) debugCube.visible = visible;
    const hint = document.getElementById('hint');
    if (hint) hint.textContent = 'W: wireframe ' + (visible ? 'ON' : 'OFF');
}

window.addEventListener('keydown', (event) => {
    if (event.repeat) return;
    if (event.code === 'KeyW' || event.key === 'w' || event.key === 'W') {
        setWireframeVisible(!showWireframe);
    }
});

initOimo();
initThree();
setWireframeVisible(showWireframe);
animate();
