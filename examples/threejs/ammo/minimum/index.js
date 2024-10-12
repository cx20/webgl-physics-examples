import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const SCALE = 1 / 20;
const deltaT = 60;

let scene;
let controls;
let loader;
let texture;

let world;
let objs = [];
let numObjects = 0;

class Box {
    constructor(x, y, z, w, h, d, m) {
        this.x = x;
        this.y = y;
        this.z = z;
        this.w = w;
        this.h = h;
        this.d = d;
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
        let material = new THREE.MeshBasicMaterial({
            map: texture
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
        let quaternion = new Ammo.btQuaternion();
        quaternion.setEulerZYX(Math.PI * 10 / 180, 0, 0);
        startTransform.setRotation(quaternion);

        let w = this.w;
        let h = this.h;
        let d = this.d;
        let tmpVec = new Ammo.btVector3(w / 2, h / 2, d / 2);
        let shape = new Ammo.btBoxShape(tmpVec);
        let localInertia = new Ammo.btVector3(0, 0, 0);
        shape.calculateLocalInertia(m, localInertia);

        let motionState = new Ammo.btDefaultMotionState(startTransform);
        let rbInfo = new Ammo.btRigidBodyConstructionInfo(m, motionState, shape, localInertia);
        rbInfo.set_m_friction(1.0);
        rbInfo.set_m_restitution(0.2);
        let body = new Ammo.btRigidBody(rbInfo);

        Ammo.destroy(quaternion);
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
    constructor(x, y, z, s, m) {
        this.x = x;
        this.y = y;
        this.z = z;
        this.s = s; // size (length of one side of cube)
        this.bulletObj = null;
        this.threeObj = null;
        this.initThreeObj();
        this.initBulletObj(m);
    }

    initThreeObj() {
        let s = this.s;
        let geometry = new THREE.BoxGeometry(s, 1 * SCALE, s);
        let material = new THREE.MeshBasicMaterial({
            map: texture
        });
        let ground = new THREE.Mesh(geometry, material);
        ground.position.x = this.x;
        ground.position.y = this.y;
        ground.position.z = this.z;

        this.threeObj = ground;
    }

    initBulletObj(m) {
        let s = this.s;
        let tmpVec = new Ammo.btVector3(s / 2, 0 / 2, s / 2);
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
        rbInfo.set_m_friction(1.0);
        rbInfo.set_m_restitution(0.1);
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
    camera.position.y = 50 * SCALE;
    camera.position.z = 200 * SCALE;

    scene = new THREE.Scene();

    world = initWorld();
    let ground = new Plane(0, 0, 0, 200 * SCALE, 0, 0xdddddd);
    scene.add(ground.threeObj);
    world.addRigidBody(ground.bulletObj);

    createBox();

    let renderer = new THREE.WebGLRenderer();
    renderer.setClearColor(0xffffff);
    renderer.setSize(width, height);
    document.body.appendChild(renderer.domElement);

    controls = new OrbitControls( camera, renderer.domElement );
    controls.autoRotate = true;

	setInterval( () => {
		updatePhysics();
	}, 1000/60 );

    rendering();

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
 
}

function createBox() {
    let z = 0;
    let x1 = 0;
    let y1 = 50 * SCALE;
    let z1 = 0;
    let w = 50 * SCALE;
    let h = 50 * SCALE;
    let d = 50 * SCALE;
    let box = new Box(x1, y1, z1, w, h, d, 10);
    scene.add(box.threeObj);
    world.addRigidBody(box.bulletObj);
    objs.push(box);
    numObjects++;
}

window.addEventListener("load", function() {
    loader = new THREE.TextureLoader();
    texture = loader.load('../../../../assets/textures/frog.jpg');

    Ammo().then(function(Ammo) {
        init();
    });
}, false);
