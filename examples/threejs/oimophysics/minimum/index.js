let container;
let camera, scene, renderer;
let meshGround;
let meshCube;
let world;
let body;
let controls;

function initOimo() {
    world = new OIMO.World();
    world.gravity = new OIMO.Vec3(0, -9.80665, 0);
    
    let groundShapec = new OIMO.ShapeConfig();
    groundShapec.geometry = new OIMO.BoxGeometry(new OIMO.Vec3(100, 1, 100));
    let groundBodyc = new OIMO.RigidBodyConfig();
    groundBodyc.type = OIMO.RigidBodyType.STATIC;
    groundBodyc.position = new OIMO.Vec3(0, -20, 0);
    let groundBody = new OIMO.RigidBody(groundBodyc);
    groundBody.addShape(new OIMO.Shape(groundShapec));
    world.addRigidBody(groundBody);
    
    let shapec = new OIMO.ShapeConfig();
    shapec.geometry = new OIMO.BoxGeometry(new OIMO.Vec3(25, 25, 25));
    let bodyc = new OIMO.RigidBodyConfig();
    bodyc.type = OIMO.RigidBodyType.DYNAMIC;
    bodyc.position = new OIMO.Vec3(0, 100, 0);
    body = new OIMO.RigidBody(bodyc);
    body.setRotationXyz(new OIMO.Vec3(Math.PI*10/180, 0, Math.PI*10/180));
    body.addShape(new OIMO.Shape(shapec));
    world.addRigidBody(body);
}

function initThree() {
    container = document.getElementById('container');
    camera = new THREE.PerspectiveCamera(30, window.innerWidth / window.innerHeight, 1, 1000);
    camera.position.y = 50;
    camera.position.z = 200;
    scene = new THREE.Scene();

    let loader = new THREE.TextureLoader();
    let texture = loader.load('../../../../assets/textures/frog.jpg');  // frog.jpg

    let material = new THREE.MeshBasicMaterial({map: texture});
    let geometryGround = new THREE.BoxGeometry(200, 2, 200);
    meshGround = new THREE.Mesh(geometryGround, material);
    meshGround.position.y = -20;
    scene.add(meshGround);

    let geometryCube = new THREE.BoxGeometry(50, 50, 50);
    meshCube = new THREE.Mesh(geometryCube, material);
    scene.add(meshCube);

    renderer = new THREE.WebGLRenderer();
    renderer.setClearColor(0xffffff);
    renderer.setSize(window.innerWidth, window.innerHeight);
    container.appendChild(renderer.domElement);

    controls = new THREE.OrbitControls( camera, renderer.domElement );
    controls.autoRotate = true;
}

function animate() {
    controls.update();
    requestAnimationFrame(animate);
    updatePhysics();
    render();
}

function updatePhysics() {
    world.step(1/30);

    meshCube.position.x = body.getPosition().x;
    meshCube.position.y = body.getPosition().y;
    meshCube.position.z = body.getPosition().z;
    meshCube.quaternion.x = body.getOrientation().x;
    meshCube.quaternion.y = body.getOrientation().y;
    meshCube.quaternion.z = body.getOrientation().z;
    meshCube.quaternion.w = body.getOrientation().w;
}

function render() {
    renderer.render(scene, camera);
}

initOimo();
initThree();
animate();
