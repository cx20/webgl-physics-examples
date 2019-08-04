// three var
let camera, scene, light, renderer, container, content;
let controls;

let meshs = [];
let grounds = [];
let matCylinder, matGround, matGroundTrans;
let matCylinders = [];
let buffgeoCylinder, buffgeoBox;
const ToRad = Math.PI / 180;
const ToDeg = 180 / Math.PI;
const dataSet = [
    {imageFile:"../../../../assets/textures/carrot.jpg", scale:1.0}, // carrot.jpg
];
let textures = [];
const SCALE = 1;

//oimo var
let world = new OIMO.World();
world.gravity = new OIMO.Vec3(0, -9.80665, 0);
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

    buffgeoCylinder = new THREE.BufferGeometry();
    buffgeoCylinder.fromGeometry(new THREE.CylinderGeometry(0.1,1,4,20));

    buffgeoBox = new THREE.BufferGeometry();
    buffgeoBox.fromGeometry(new THREE.BoxGeometry(1, 1, 1));

    let loader = new THREE.TextureLoader();

    for (let i = 0; i < dataSet.length; i++) {
        let imageFile = dataSet[i].imageFile;
        textures[i] = loader.load(imageFile);
        matCylinders[i] = new THREE.MeshLambertMaterial({
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

    controls = new THREE.OrbitControls(camera);
    controls.autoRotate = true;

    initOimoPhysics();
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

function initOimoPhysics() {
    let max = 200;

    // Is all the physics setting for rigidbody
    var groundShapec = new OIMO.ShapeConfig();
    groundShapec.geometry = new OIMO.BoxGeometry(new OIMO.Vec3(40/2, 4/2, 40/2));
    groundShapec.friction  = 0.6;
    groundShapec.restitution  = 0.2;
    var groundBodyc = new OIMO.RigidBodyConfig();
    groundBodyc.type = OIMO.RigidBodyType.STATIC;
    groundBodyc.position = new OIMO.Vec3(0, -2, 0);
    var groundBody = new OIMO.RigidBody(groundBodyc);
    groundBody.addShape(new OIMO.Shape(groundShapec));
    world.addRigidBody(groundBody);

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

        var surfaceShapec = new OIMO.ShapeConfig();
        surfaceShapec.geometry = new OIMO.BoxGeometry(new OIMO.Vec3(size[0]/2, size[1]/2, size[2]/2));
        var surfaceBodyc = new OIMO.RigidBodyConfig();
        surfaceBodyc.type = OIMO.RigidBodyType.STATIC;
        surfaceBodyc.position = new OIMO.Vec3(pos[0], pos[1], pos[2]);
        var surfaceBody = new OIMO.RigidBody(surfaceBodyc);
        surfaceBody.addShape(new OIMO.Shape(surfaceShapec));
        world.addRigidBody(surfaceBody);
        
        addStaticBox(size, pos, rot, true);
    }

    // now add object
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

        var carrotShapec = new OIMO.ShapeConfig();
        carrotShapec.geometry = new OIMO.ConeGeometry(1,2);
        carrotShapec.friction  = 0.6;
        carrotShapec.restitution  = 0.2;
        var carrotBodyc = new OIMO.RigidBodyConfig();
        carrotBodyc.type = OIMO.RigidBodyType.DYNAMIC;
        carrotBodyc.position = new OIMO.Vec3(x, y, z);
        var carrotBody = new OIMO.RigidBody(carrotBodyc);
        carrotBody.addShape(new OIMO.Shape(carrotShapec));
        world.addRigidBody(carrotBody);
        bodys[i] = carrotBody;

        meshs[i] = new THREE.Mesh(buffgeoCylinder, matCylinders[pos]);
        //meshs[i].scale.set(w * 0.5, w * 0.5, w * 0.5);

        meshs[i].castShadow = true;
        meshs[i].receiveShadow = true;

        scene.add(meshs[i]);
    }
}

function updateOimoPhysics() {

    world.step(1/30);
    let i = bodys.length;

    while (i--) {
        let body = bodys[i];
        let mesh = meshs[i];

        mesh.position.x = body.getPosition().x;
        mesh.position.y = body.getPosition().y;
        mesh.position.z = body.getPosition().z;
        mesh.quaternion.x = body.getOrientation().x;
        mesh.quaternion.y = body.getOrientation().y;
        mesh.quaternion.z = body.getOrientation().z;
        mesh.quaternion.w = body.getOrientation().w;
        
        // reset position
        if (mesh.position.y < -10) {
            let x = -5 + Math.random() * 10;
            let y = 20 + Math.random() * 10;
            let z = -5 + Math.random() * 10;

            body.setAngularVelocity(new OIMO.Vec3(0, 0, 0));
            body.setLinearVelocity(new OIMO.Vec3(0, -9.80665, 0));
            body.setPosition(new OIMO.Vec3(x, y, z));
        }
    }
}

function loop() {
    updateOimoPhysics();
    renderer.render(scene, camera);
    controls.update();
    requestAnimationFrame(loop);
}

init();
loop();