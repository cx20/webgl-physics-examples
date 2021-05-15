﻿const SCALE = 1 / 10;
const deltaT = 60;

let scene;
let controls;
let loader;
let texture_grass;
let texture_football;

let dynamicsWorld;
let objs = [];
let numObjects = 0;


// ‥‥‥‥‥‥‥‥‥‥‥‥‥□□□
// ‥‥‥‥‥‥〓〓〓〓〓‥‥□□□
// ‥‥‥‥‥〓〓〓〓〓〓〓〓〓□□
// ‥‥‥‥‥■■■□□■□‥■■■
// ‥‥‥‥■□■□□□■□□■■■
// ‥‥‥‥■□■■□□□■□□□■
// ‥‥‥‥■■□□□□■■■■■‥
// ‥‥‥‥‥‥□□□□□□□■‥‥
// ‥‥■■■■■〓■■■〓■‥‥‥
// ‥■■■■■■■〓■■■〓‥‥■
// □□■■■■■■〓〓〓〓〓‥‥■
// □□□‥〓〓■〓〓□〓〓□〓■■
// ‥□‥■〓〓〓〓〓〓〓〓〓〓■■
// ‥‥■■■〓〓〓〓〓〓〓〓〓■■
// ‥■■■〓〓〓〓〓〓〓‥‥‥‥‥
// ‥■‥‥〓〓〓〓‥‥‥‥‥‥‥‥
let dataSet = [
    "無","無","無","無","無","無","無","無","無","無","無","無","無","肌","肌","肌",
    "無","無","無","無","無","無","赤","赤","赤","赤","赤","無","無","肌","肌","肌",
    "無","無","無","無","無","赤","赤","赤","赤","赤","赤","赤","赤","赤","肌","肌",
    "無","無","無","無","無","茶","茶","茶","肌","肌","茶","肌","無","赤","赤","赤",
    "無","無","無","無","茶","肌","茶","肌","肌","肌","茶","肌","肌","赤","赤","赤",
    "無","無","無","無","茶","肌","茶","茶","肌","肌","肌","茶","肌","肌","肌","赤",
    "無","無","無","無","茶","茶","肌","肌","肌","肌","茶","茶","茶","茶","赤","無",
    "無","無","無","無","無","無","肌","肌","肌","肌","肌","肌","肌","赤","無","無",
    "無","無","赤","赤","赤","赤","赤","青","赤","赤","赤","青","赤","無","無","無",
    "無","赤","赤","赤","赤","赤","赤","赤","青","赤","赤","赤","青","無","無","茶",
    "肌","肌","赤","赤","赤","赤","赤","赤","青","青","青","青","青","無","無","茶",
    "肌","肌","肌","無","青","青","赤","青","青","黄","青","青","黄","青","茶","茶",
    "無","肌","無","茶","青","青","青","青","青","青","青","青","青","青","茶","茶",
    "無","無","茶","茶","茶","青","青","青","青","青","青","青","青","青","茶","茶",
    "無","茶","茶","茶","青","青","青","青","青","青","青","無","無","無","無","無",
    "無","茶","無","無","青","青","青","青","無","無","無","無","無","無","無","無"
];

function getRgbColor( c )
{
    let colorHash = {
        "無":0xDCAA6B,    // 段ボール色
        "白":0xffffff,
        "肌":0xffcccc,
        "茶":0x800000,
        "赤":0xff0000,
        "黄":0xffff00,
        "緑":0x00ff00,
        "水":0x00ffff,
        "青":0x0000ff,
        "紫":0x800080
    };
    return colorHash[ c ];
}

class Ball {
    constructor(x, y, z, r, m, color) {
        this.x = x;
        this.y = y;
        this.z = z;
        this.r = r;
        this.color = color;
        this.bulletObj = null;
        this.threeObj = null;
        this._trans = new Ammo.btTransform();
        this.initThreeObj();
        this.initBulletObj(m);
    }

    destructor() {
        Ammo.destroy(this.bulletObj);
        Ammo.destroy(this._trans);
    }

    initThreeObj() {
        let geometry = new THREE.SphereGeometry(this.r, 10, 10);
        let material = new THREE.MeshBasicMaterial({
            color: Math.round(this.color),
            map: texture_football
        });
        let ball = new THREE.Mesh(geometry, material);
        ball.position.x = this.x;
        ball.position.y = this.y;
        ball.position.z = this.z;

        this.threeObj = ball;
    };

    initBulletObj(m) {
        let startTransform = new Ammo.btTransform();
        startTransform.setIdentity();
        let origin = startTransform.getOrigin();
        origin.setX(this.x);
        origin.setY(this.y);
        origin.setZ(this.z);

        let shape = new Ammo.btSphereShape(this.r);
        let localInertia = new Ammo.btVector3(0, 0, 0);
        shape.calculateLocalInertia(m, localInertia);

        let motionState = new Ammo.btDefaultMotionState(startTransform);
        let rbInfo = new Ammo.btRigidBodyConstructionInfo(m, motionState, shape, localInertia);
        //rbInfo.set_m_restitution(1);
        rbInfo.set_m_restitution(0.6); // 反発係数（0～1）
        let body = new Ammo.btRigidBody(rbInfo);

        Ammo.destroy(startTransform);
        Ammo.destroy(localInertia);
        Ammo.destroy(rbInfo);

        this.bulletObj = body;
    }

    move() {
        let quat = new THREE.Quaternion;
        let pos = [0, 0, 0];

        this.bulletObj.getMotionState().getWorldTransform(this._trans);
        let origin = this._trans.getOrigin();
        pos[0] = origin.x();
        pos[1] = origin.y();
        pos[2] = origin.z();
        let rotation = this._trans.getRotation();
        quat.x = rotation.x();
        quat.y = rotation.y();
        quat.z = rotation.z();
        quat.w = rotation.w();
        
        this.threeObj.position.x = pos[0];
        this.threeObj.position.y = pos[1];
        this.threeObj.position.z = pos[2];
        this.threeObj.quaternion.copy(quat);
    }
}

class Plane {
    constructor(x, y, z, s, m, color) {
        this.x = x;
        this.y = y;
        this.z = z;
        this.s = s; // size (length of one side of cube)
        this.color = color;
        this.bulletObj = null;
        this.threeObj = null;
        this.initThreeObj();
        this.initBulletObj(m);
    }

    initThreeObj() {
        let s = this.s;
        let geometry = new THREE.BoxGeometry(s, 1 * SCALE, s);
        let material = new THREE.MeshBasicMaterial({
            color: this.color,
            map: texture_grass
        });
        let ground = new THREE.Mesh(geometry, material);
        ground.position.x = this.x;
        ground.position.y = this.y;
        ground.position.z = this.z;

        this.threeObj = ground;
    }

    initBulletObj(m) {
        let s = this.s;
        let tmpVec = new Ammo.btVector3(s / 2, 1 / 2 * SCALE, s / 2);
        let shape = new Ammo.btBoxShape(tmpVec);
        Ammo.destroy(tmpVec);
        let startTransform = new Ammo.btTransform();
        startTransform.setIdentity();
        tmpVec = new Ammo.btVector3(this.x, this.y, this.z);
        startTransform.setOrigin(tmpVec);
        Ammo.destroy(tmpVec);

        let localInertia = new Ammo.btVector3(0, 0, 0);
        let motionState = new Ammo.btDefaultMotionState(startTransform);
        let rbInfo = new Ammo.btRigidBodyConstructionInfo(m, motionState, shape, localInertia);
        rbInfo.set_m_restitution(1);
        let body = new Ammo.btRigidBody(rbInfo);

        Ammo.destroy(startTransform);
        Ammo.destroy(localInertia);
        Ammo.destroy(rbInfo);

        this.bulletObj = body;
    }
}

function initPhysicsWorld() {
    let gravity = new Ammo.btVector3(0, -9.8, 0);

    let collisionConfiguration = new Ammo.btDefaultCollisionConfiguration();
    let dispatcher = new Ammo.btCollisionDispatcher(collisionConfiguration);
    let overlappingPairCache = new Ammo.btDbvtBroadphase();
    let solver = new Ammo.btSequentialImpulseConstraintSolver();
    let dynamicsWorld = new Ammo.btDiscreteDynamicsWorld(
        dispatcher, overlappingPairCache, solver, collisionConfiguration);
    dynamicsWorld.setGravity(gravity);

    return dynamicsWorld;
}

function init() {
    let width = window.innerWidth;
    let height = window.innerHeight;
    let deltaT = 60;

    let camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    camera.position.x = 0;
    camera.position.y = 200 * SCALE;
    camera.position.z = 300 * SCALE;
    camera.lookAt(new THREE.Vector3(0, 0, 0));

    scene = new THREE.Scene();

    let directionalLight = new THREE.DirectionalLight(0xffffff, 3);
    directionalLight.position.z = 3;
    scene.add(directionalLight);

    dynamicsWorld = initPhysicsWorld();
    let ground = new Plane(0, 0, 0, 300 * SCALE, 0, 0xdddddd);
    scene.add(ground.threeObj);
    dynamicsWorld.addRigidBody(ground.bulletObj);

    createBalls();

    let renderer = new THREE.WebGLRenderer();
    renderer.setSize(width, height);
    document.body.appendChild(renderer.domElement);

    controls = new THREE.OrbitControls( camera, renderer.domElement );
    controls.autoRotate = true;

    function rendering() {
        controls.update();
        
        dynamicsWorld.stepSimulation(1/deltaT); // TODO:set actual FPS

        for (let i = numObjects; i--;) {
            let obj = objs[i];
            obj.move();
        }

        renderer.render(scene, camera);
        requestAnimationFrame(rendering);
    }

    rendering();
}

function createBalls() {
    const BALL_SIZE = 10;
    for (let x = 0; x < 16; x++) {
        for (let y = 0; y < 16; y++) {
            i = x + (15 - y) * 16;
            let z = 0;
            let x1 = (-7 + x) * BALL_SIZE * SCALE * 1.5 + Math.random() * 0.1;
            let y1 = (15 - y) * BALL_SIZE * SCALE * 1.2 + Math.random() * 0.1;
            let z1 = z * BALL_SIZE * SCALE * 1 + Math.random() * 0.1;
            let color = getRgbColor(dataSet[y * 16 + x]);
            let ball = new Ball(x1, y1, z1, BALL_SIZE/2 * SCALE, 10, color);
            scene.add(ball.threeObj);
            dynamicsWorld.addRigidBody(ball.bulletObj);
            objs.push(ball);
            numObjects++;
        }
    }
}

window.addEventListener("load", function () {
    loader = new THREE.TextureLoader();
    texture_grass = loader.load('../../../../assets/textures/grass.jpg');
    texture_grass.wrapS = texture_grass.wrapT = THREE.RepeatWrapping;
    texture_grass.repeat.set( 5, 5 );
    texture_football = loader.load('../../../../assets/textures/football.png');

    Ammo().then(function(Ammo) {
        init();
    });
    
}, false);

