import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const SCALE = 1 / 10;
const deltaT = 60;

let scene;
let controls;
let loader;
let texture_grass;

let world;
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

class Box {
    constructor(x, y, z, w, h, d, m, color) {
        this.x = x;
        this.y = y;
        this.z = z;
        this.w = w;
        this.h = h;
        this.d = d;
        this.color = color;
        this.bulletObj = null;
        this.threeObj = null;
        this._trans = new Ammo.btTransform();
        this.initThreeObj();
        this.initBulletObj(m);
    }

    initThreeObj() {
        let w = this.w;
        let h = this.h;
        let d = this.d;
        let geometry = new THREE.BoxGeometry(w, h, d);
        let material = new THREE.MeshLambertMaterial({
            color: Math.round(this.color)
        });
        let box = new THREE.Mesh(geometry, material);
        box.position.x = this.x;
        box.position.y = this.y;
        box.position.z = this.z;

        this.threeObj = box;
    }

    initBulletObj(m) {
        let startTransform = new Ammo.btTransform();
        startTransform.setIdentity();
        let origin = startTransform.getOrigin();
        origin.setX(this.x);
        origin.setY(this.y);
        origin.setZ(this.z);

        let w = this.w;
        let h = this.h;
        let d = this.d;
        let tmpVec = new Ammo.btVector3(w / 2, h / 2, d / 2);
        let shape = new Ammo.btBoxShape(tmpVec);
        let localInertia = new Ammo.btVector3(0, 0, 0);
        shape.calculateLocalInertia(m, localInertia);

        let motionState = new Ammo.btDefaultMotionState(startTransform);
        let rbInfo = new Ammo.btRigidBodyConstructionInfo(m, motionState, shape, localInertia);
        //rbInfo.set_m_restitution(1);
        rbInfo.set_m_restitution(0.2); // 反発係数（0～1）
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
        let material = new THREE.MeshLambertMaterial({
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
        rbInfo.set_m_restitution(0.2);
        let body = new Ammo.btRigidBody(rbInfo);

        Ammo.destroy(startTransform);
        Ammo.destroy(localInertia);
        Ammo.destroy(rbInfo);

        this.bulletObj = body;
    }
}

function initWorld() {
    let gravity = new Ammo.btVector3(0, -9.8, 0);

    let collisionConfiguration = new Ammo.btDefaultCollisionConfiguration();
    let dispatcher = new Ammo.btCollisionDispatcher(collisionConfiguration);
    let overlappingPairCache = new Ammo.btDbvtBroadphase();
    let solver = new Ammo.btSequentialImpulseConstraintSolver();
    let world = new Ammo.btDiscreteDynamicsWorld(
        dispatcher, overlappingPairCache, solver, collisionConfiguration);
    world.setGravity(gravity);

    return world;
}

function init() {
    let width = window.innerWidth;
    let height = window.innerHeight;

    let camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    camera.position.x = 0;
    camera.position.y = 100 * SCALE;
    camera.position.z = 150 * SCALE;
    camera.lookAt(new THREE.Vector3(0, 0, 0));

    scene = new THREE.Scene();

    let directionalLight = new THREE.DirectionalLight(0xffffff, 3);
    directionalLight.position.z = 3;
    scene.add(directionalLight);

    world = initWorld();
    let ground = new Plane(0, -10 * SCALE, 0, 200 * SCALE, 0, 0xdddddd);
    scene.add(ground.threeObj);
    world.addRigidBody(ground.bulletObj);

    createBoxes();

    let renderer = new THREE.WebGLRenderer();
    renderer.setSize(width, height);
    document.body.appendChild(renderer.domElement);

    controls = new OrbitControls( camera, renderer.domElement );
    controls.autoRotate = true;

    setInterval( () => {
        updatePhysics();
    }, 1000/60 );

    function rendering() {
        controls.update();
        renderer.render(scene, camera);
        requestAnimationFrame(rendering);
    }

    function updatePhysics() {
        
        world.stepSimulation(1/deltaT); // TODO:set actual FPS

        for (let i = numObjects; i--;) {
            let obj = objs[i];
            obj.move();
        }
    }

    rendering();

}

function createBoxes() {
    const BOX_SIZE = 5;
    for (let x = 0; x < 16; x++) {
        for (let y = 0; y < 16; y++) {
            let i = x + (15 - y) * 16;
            let z = 0;
            let x1 = (-7 + x) * BOX_SIZE * SCALE * 1.5 + Math.random() * 0.1;
            let y1 = (15 - y) * BOX_SIZE * SCALE * 1.2 + Math.random() * 0.1;
            let z1 = z * BOX_SIZE * SCALE * 1 + Math.random() * 0.1;
            let color = getRgbColor( dataSet[y * 16 + x] );
            let w = BOX_SIZE * SCALE;
            let h = BOX_SIZE * SCALE;
            let d = BOX_SIZE * SCALE;
            let box = new Box(x1, y1, z1, w, h, d, 10, color);
            scene.add(box.threeObj);
            world.addRigidBody(box.bulletObj);
            objs.push(box);
            numObjects++;
        }
    }
}

window.addEventListener("load", function () {
    loader = new THREE.TextureLoader();
    texture_grass = loader.load('../../../../assets/textures/grass.jpg');
    texture_grass.wrapS   = texture_grass.wrapT = THREE.RepeatWrapping;
    texture_grass.repeat.set( 5, 5 );  

    Ammo().then(function(Ammo) {
        init();
    });

}, false);

