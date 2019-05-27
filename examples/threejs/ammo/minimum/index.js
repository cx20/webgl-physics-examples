let controls;

Ammo().then(function(Ammo) {
let scene;
let dynamicsWorld;
let objs = [];
let numObjects = 0;

function Box(x, y, z, w, h, d, m) {
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

Box.prototype.destructor = function () {
    // TODO:
};

Box.prototype.initThreeObj = function () {
    let w = this.w;
    let h = this.h;
    let d = this.d;
    let texture = THREE.ImageUtils.loadTexture("../../../../assets/textures/frog.jpg");
    let geometry = new THREE.CubeGeometry(w, h, d);
    let material = new THREE.MeshBasicMaterial({
        map: texture
    });
    let box = new THREE.Mesh(geometry, material);
    box.position.x = this.x;
    box.position.y = this.y;
    box.position.z = this.z;

    this.threeObj = box;
};

Box.prototype.initBulletObj = function (m) {
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
};

Box.prototype.move = function () {
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
};

function Plane(x, y, z, s, m) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.s = s; // size (length of one side of cube)
    this.bulletObj = null;
    this.threeObj = null;
    this.initThreeObj();
    this.initBulletObj(m);
}

Plane.prototype.destructor = function () {
    // TODO:
};

Plane.prototype.initThreeObj = function () {
    let s = this.s;
    let texture = THREE.ImageUtils.loadTexture("../../../../assets/textures/frog.jpg");
    let geometry = new THREE.CubeGeometry(s, 1, s);
    let material = new THREE.MeshBasicMaterial({
        map: texture
    });
    ground = new THREE.Mesh(geometry, material);
    ground.position.x = this.x;
    ground.position.y = this.y;
    ground.position.z = this.z;

    this.threeObj = ground;
};

Plane.prototype.initBulletObj = function (m) {
    let s = this.s;
    let tmpVec = new Ammo.btVector3(s / 2, 1 / 2, s / 2);
    let shape = new Ammo.btBoxShape(tmpVec);
    Ammo.destroy(tmpVec);
    let startTransform = new Ammo.btTransform();
    startTransform.setIdentity();
    tmpVec = new Ammo.btVector3(this.x, this.y + 1, this.z);
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
};

Plane.prototype.move = function () {
    // TODO:
};

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

window.addEventListener("load", function () {
    let width = window.innerWidth;
    let height = window.innerHeight;
    let deltaT = 30;

    let camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    camera.position.x = 0;
    camera.position.y = 50;
    camera.position.z = 200;

    scene = new THREE.Scene();

    dynamicsWorld = initPhysicsWorld();
    let ground = new Plane(0, 0, 0, 200, 0, 0xdddddd);
    scene.add(ground.threeObj);
    dynamicsWorld.addRigidBody(ground.bulletObj);

    createBox();

    let renderer = new THREE.WebGLRenderer();
    renderer.setClearColor(0xffffff);
    renderer.setSize(width, height);
    document.body.appendChild(renderer.domElement);

    controls = new THREE.OrbitControls(camera);
    controls.autoRotate = true;

    function rendering() {
        controls.update();
        
        dynamicsWorld.stepSimulation(deltaT / 1000);

        for (let i = numObjects; i--;) {
            let obj = objs[i];
            obj.move();
        }

        renderer.render(scene, camera);
        requestAnimationFrame(rendering);
    }

    rendering();

}, false);

function createBox() {
    const BOX_SIZE = 50;
    var z = 0;
    let x1 = 0;
    let y1 = 100;
    let z1 = 0;
    let w = BOX_SIZE * 1;
    let h = BOX_SIZE * 1;
    let d = BOX_SIZE * 1;
    let box = new Box(x1, y1, z1, w, h, d, 10);
    scene.add(box.threeObj);
    dynamicsWorld.addRigidBody(box.bulletObj);
    objs.push(box);
    numObjects++;
}

});