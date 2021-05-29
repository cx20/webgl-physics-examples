// NOTES : three.js 127 -> 128
// ES6 modules in examples/jsm now import using the bare specifier three.
// This change breaks working with modules in cdns such as https://www.jsdelivr.com/ and https://unpkg.com/. Please use https://www.skypack.dev/ instead.
// See: https://github.com/mrdoob/three.js/wiki/Migration-Guide#127--128
import * as THREE from 'https://cdn.skypack.dev/three@0.129.0/build/three.module.js';
import { OrbitControls } from 'https://cdn.skypack.dev/three@0.129.0/examples/jsm/controls/OrbitControls.js';
import * as CANNON from 'https://cdn.skypack.dev/cannon-es@0.17.1/dist/cannon-es.js';

// three var
let camera, scene, light, renderer, container, content;
let controls;

let meshs = [];
let grounds = [];
let matSphere, matGround, matGroundTrans;
let matSpheres = [];
let buffgeoSphere, buffgeoBox;
const ToRad = Math.PI / 180;
const ToDeg = 180 / Math.PI;
const TIME_STEP = 1 / 30;

const dataSet = [
    {imageFile:"../../../../assets/textures/Basketball.jpg", scale:1.0}, // Basketball.jpg
    {imageFile:"../../../../assets/textures/BeachBall.jpg",  scale:0.9}, // BeachBall.jpg
    {imageFile:"../../../../assets/textures/Football.jpg",   scale:1.0}, // Football.jpg
    {imageFile:"../../../../assets/textures/Softball.jpg",   scale:0.3}, // Softball.jpg
    {imageFile:"../../../../assets/textures/TennisBall.jpg", scale:0.3}, // TennisBall.jpg
];
let textures = [];

let world = new CANNON.World();
    world.gravity.set(0, -10, 0);
    world.broadphase = new CANNON.NaiveBroadphase();
    world.solver.iterations = 10;
let bodys = [];

function init() {

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

    initCannonPhysics();
}

function addStaticBox(size, position, rotation, spec) {
    let mesh;
    if (spec) mesh = new THREE.Mesh(buffgeoBox, matGroundTrans);
    else mesh = new THREE.Mesh(buffgeoBox, matGround);
    mesh.scale.set(size[0], size[1], size[2]);
    mesh.position.set(position[0], position[1], position[2]);
    mesh.rotation.set(rotation[0] * ToRad, rotation[1] * ToRad, rotation[2] * ToRad);
    if (!grounds.length) content.add(mesh);
    else scene.add(mesh);
    grounds.push(mesh);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
}

function initCannonPhysics() {
    let max = 200;
    let groundMaterial = new CANNON.Material('ground')
    let groundShape = new CANNON.Box(new CANNON.Vec3(40/2, 4/2, 40/2));
    let groundBody = new CANNON.Body({mass: 0, material: groundMaterial});
    groundBody.position.set(0, -2, 0);
    groundBody.addShape(groundShape);
    world.addBody(groundBody);
    
    addStaticBox([40, 4, 40], [0, -2, 0], [0, 0, 0]);

    let boxDataSet = [
        { size:[10, 10,  1], pos:[ 0, 5,-5], rot:[0,0,0] },
        { size:[10, 10,  1], pos:[ 0, 5, 5], rot:[0,0,0] },
        { size:[ 1, 10, 10], pos:[-5, 5, 0], rot:[0,0,0] },
        { size:[ 1, 10, 10], pos:[ 5, 5, 0], rot:[0,0,0] } 
    ];

    let surfaces = [];
    for (let i = 0; i < boxDataSet.length; i++) {
        let size = boxDataSet[i].size
        let pos = boxDataSet[i].pos;
        let rot = boxDataSet[i].rot;
        let surfaceShape = new CANNON.Box(new CANNON.Vec3(size[0]/2, size[1]/2, size[2]/2));
        let surfaceBody = new CANNON.Body({mass: 0});
        surfaceBody.position.set(pos[0], pos[1], pos[2]);
        surfaceBody.addShape(surfaceShape);
        world.addBody(surfaceBody);

        addStaticBox(size, pos, rot, true);
    }

    let i = max;

    while (i--) {
        let x = -5 + Math.random() * 10;
        let y = 20 + Math.random() * 10;
        let z = -5 + Math.random() * 10;
        let w = 2 + Math.random() * 1;
        let h = 1 + Math.random() * 1;
        let d = 1 + Math.random() * 1;

        let pos = Math.floor(Math.random() * dataSet.length);
        let scale = dataSet[pos].scale;
        w *= scale;

        let shape = new CANNON.Sphere(w/2);
        let ballMaterial = new CANNON.Material('ball')
        let ballBody = new CANNON.Body({mass: 1, material:ballMaterial});
        ballBody.addShape(shape);
        ballBody.position.set(x, y, z);
        world.addBody(ballBody);
        bodys[i] = ballBody;

        let ballContactMaterial = new CANNON.ContactMaterial(groundMaterial, ballMaterial, {friction: 0.4, restitution: 0.6});
        world.addContactMaterial(ballContactMaterial)

        meshs[i] = new THREE.Mesh(buffgeoSphere, matSpheres[pos]);
        meshs[i].scale.set(w * 0.5, w * 0.5, w * 0.5);

        meshs[i].castShadow = true;
        meshs[i].receiveShadow = true;

        scene.add(meshs[i]);
    }
}

function updateCannonPhysics() {
    world.step(TIME_STEP);
    let i = bodys.length;

    while (i--) {
        let body = bodys[i];
        let mesh = meshs[i];

        mesh.position.x = body.position.x;
        mesh.position.y = body.position.y;
        mesh.position.z = body.position.z;
        mesh.quaternion.x = body.quaternion.x;
        mesh.quaternion.y = body.quaternion.y;
        mesh.quaternion.z = body.quaternion.z;
        mesh.quaternion.w = body.quaternion.w;
        
        if (mesh.position.y < -10) {
            let x = -5 + Math.random() * 10;
            let y = 20 + Math.random() * 10;
            let z = -5 + Math.random() * 10;
            body.angularVelocity.set(0, 0, 0);
            //body.velocity.set(0, 0, 0);
            body.position.set(x, y, z);
        }
    }
}

function loop() {
    updateCannonPhysics();
    renderer.render(scene, camera);
    controls.update();
    requestAnimationFrame(loop);
}

init();
loop();
