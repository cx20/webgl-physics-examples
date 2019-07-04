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
        "無":{r:0xDC,g:0xAA,b:0x6B},
        "白":{r:0xff,g:0xff,b:0xff},
        "肌":{r:0xff,g:0xcc,b:0xcc},
        "茶":{r:0x80,g:0x00,b:0x00},
        "赤":{r:0xff,g:0x00,b:0x00},
        "黄":{r:0xff,g:0xff,b:0x00},
        "緑":{r:0x00,g:0xff,b:0x00},
        "水":{r:0x00,g:0xff,b:0xff},
        "青":{r:0x00,g:0x00,b:0xff},
        "紫":{r:0x80,g:0x00,b:0x80}
    };
    return colorHash[ c ];
}

Ammo().then(function(Ammo) {
let glBoostContext;
let scene;
let dynamicsWorld;
let objs = [];
let numObjects = 0;

function Ball(x, y, z, r, m, color) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.r = r;
    this.color = color;
    this.bulletObj = null;
    this.glboostObj = null;
    this._trans = new Ammo.btTransform();
    this.initGlboostObj();
    this.initBulletObj(m);
}

Ball.prototype.destructor = function () {
    Ammo.destroy(this.bulletObj);
    Ammo.destroy(this._trans);
};

Ball.prototype.initGlboostObj = function () {
    // initialize Object3D
    let material = glBoostContext.createClassicMaterial();
    let texture = glBoostContext.createTexture("../../../../assets/textures/football.png");  // Football.png
    material.setTexture(texture);
    let color = this.color;
    let color2 = new GLBoost.Vector4(color.r / 0xff, color.g / 0xff, color.b / 0xff, 1.0);
    let sphere = glBoostContext.createSphere(this.r, 10, 10, color2);
    let ball = glBoostContext.createMesh(sphere, material);
    let translate = new GLBoost.Vector3(this.x, this.y, this.z);
    ball.translate = translate;

    this.glboostObj = ball;
};

Ball.prototype.initBulletObj = function (m) {
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
    rbInfo.set_m_restitution(0.6); // 反発係数（0～1）
    let body = new Ammo.btRigidBody(rbInfo);

    Ammo.destroy(startTransform);
    Ammo.destroy(localInertia);
    Ammo.destroy(rbInfo);

    this.bulletObj = body;
};

Ball.prototype.move = function () {
    let pos = [0, 0, 0];

    this.bulletObj.getMotionState().getWorldTransform(this._trans);
    let origin = this._trans.getOrigin();
    pos[0] = origin.x();
    pos[1] = origin.y();
    pos[2] = origin.z();
    let rotation = this._trans.getRotation();
    let quat = new GLBoost.Quaternion(rotation.x(), rotation.y(), rotation.z(), rotation.w());
    let translate = new GLBoost.Vector3(pos[0], pos[1], pos[2]);
    
    this.glboostObj.translate = translate;
    // クォータニオン（ammo.js） → クォータニオン（GLBoost.js）
    this.glboostObj.quaternion = quat;
};

function Box(x, y, z, w, h, d, m, color) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.w = w;
    this.h = h;
    this.d = d;
    this.color = color;
    this.bulletObj = null;
    this.glboostObj = null;
    this._trans = new Ammo.btTransform();
    this.initGlboostObj();
    this.initBulletObj(m);
}

Box.prototype.destructor = function () {
    // TODO:
};

Box.prototype.initGlboostObj = function () {
    let w = this.w;
    let h = this.h;
    let d = this.d;
    let material = glBoostContext.createClassicMaterial();
    material.shaderClass = GLBoost.PhongShader;
    let color = this.color;
    let color2 = new GLBoost.Vector4(color.r / 0xff, color.g / 0xff, color.b / 0xff, 1.0);
    let box = glBoostContext.createCube(new GLBoost.Vector3(w, h, d), color2);
    let mesh = glBoostContext.createMesh(box, material);
    let translate = new GLBoost.Vector3(this.x, this.y, this.z);
    mesh.translate = translate;

    this.glboostObj = mesh;
};

Box.prototype.initBulletObj = function (m) {
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
    rbInfo.set_m_restitution(0.2); // 反発係数（0～1）
    let body = new Ammo.btRigidBody(rbInfo);

    Ammo.destroy(startTransform);
    Ammo.destroy(localInertia);
    Ammo.destroy(rbInfo);

    this.bulletObj = body;
};

Box.prototype.move = function () {
    let pos = [0, 0, 0];

    this.bulletObj.getMotionState().getWorldTransform(this._trans);
    let origin = this._trans.getOrigin();
    pos[0] = origin.x();
    pos[1] = origin.y();
    pos[2] = origin.z();
    let rotation = this._trans.getRotation();
    let quat = new GLBoost.Quaternion(rotation.x(), rotation.y(), rotation.z(), rotation.w());
    let translate = new GLBoost.Vector3(pos[0], pos[1], pos[2]);
    
    this.glboostObj.translate = translate;
    // クォータニオン（ammo.js） → クォータニオン（GLBoost.js）
    this.glboostObj.quaternion = quat;
};

function Plane(x, y, z, s, m, color) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.s = s; // size (length of one side of cube)
    this.color = color;
    this.bulletObj = null;
    this.glboostObj = null;
    this.initGlboostObj();
    this.initBulletObj(m);
}

Plane.prototype.destructor = function () {
    // TODO:
};

Plane.prototype.initGlboostObj = function () {
    let s = this.s;
    let material = glBoostContext.createClassicMaterial();
    let texture = glBoostContext.createTexture("../../../../assets/textures/grass.jpg"); // grass.jpg
    material.setTexture(texture);
    let planeGeometry = glBoostContext.createPlane(s, s, 5, 5, null, true);
    let ground = glBoostContext.createMesh(planeGeometry, material);

    this.glboostObj = ground;
};

Plane.prototype.initBulletObj = function (m) {
    let s = this.s;
    let tmpVec = new Ammo.btVector3(s / 2, 1 / 2, s / 2);
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
};

Plane.prototype.move = function () {
    // TODO:
};

function initPhysicsWorld() {
    let gravity = new Ammo.btVector3(0, -100, 0);

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
    let deltaT = 10;

    canvas = document.getElementById("world");
    glBoostContext = new GLBoost.GLBoostMiddleContext(canvas);
    renderer = glBoostContext.createRenderer({canvas : canvas, clearColor: {red: 0, green: 0, blue: 0, alpha: 1}});
    renderer.resize(width, height);
    scene = glBoostContext.createScene();

    camera = glBoostContext.createPerspectiveCamera({
        eye: new GLBoost.Vector3(0.0, 10, 20),
        center: new GLBoost.Vector3(0.0, 0.0, 0.0),
        up: new GLBoost.Vector3(0.0, 1.0, 0.0)
    }, {
        fovy: 45.0,
        aspect: window.innerWidth/window.innerHeight,
        zNear: 0.01,
        zFar: 2000.0
    });
    camera.cameraController = glBoostContext.createCameraController();
    scene.addChild(camera);

    let directionalLight1 = glBoostContext.createDirectionalLight(new GLBoost.Vector3(1, 1, 1), new GLBoost.Vector3(30, 30, 30));
    scene.addChild( directionalLight1 );
    let directionalLight2 = glBoostContext.createDirectionalLight(new GLBoost.Vector3(1, 1, 1), new GLBoost.Vector3(-30, -30, -30));
    scene.addChild( directionalLight2 );

    dynamicsWorld = initPhysicsWorld();
    let ground = new Plane(0, 0, 0, 50, 0, 0xdddddd);
    scene.addChild(ground.glboostObj);
    dynamicsWorld.addRigidBody(ground.bulletObj);

    createBalls();

    expression = glBoostContext.createExpressionAndRenderPasses(1);
    expression.renderPasses[0].scene = scene;
    expression.prepareToRender();

    function rendering() {
        dynamicsWorld.stepSimulation(deltaT / 1000);

        for (let i = numObjects; i--;) {
            let obj = objs[i];
            obj.move();
        }

        renderer.clearCanvas();
        renderer.draw(expression);
        setTimeout(rendering, deltaT);
    }

    rendering();

}, false);

function createBalls() {
    let ball_size = 0.5;
    let box_size = 1;
    for (let i = 0; i < dataSet.length; i++) {
        let x = (-8 + (i % 16)) * ball_size * 2.5;
        let y = 10 + (15 - Math.floor(i / 16)) * ball_size * 2.5;
        let z = Math.random();

        let color = getRgbColor( dataSet[i] );
        let ball = new Ball(x, y, z, ball_size, 10, color);
        scene.addChild(ball.glboostObj);
        dynamicsWorld.addRigidBody(ball.bulletObj);
        objs.push(ball);
        numObjects++;
    }
}

});