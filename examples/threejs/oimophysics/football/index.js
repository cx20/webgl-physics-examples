let container;
let camera, scene, renderer;
let meshGround;
let meshCube;
let world;
let body;
let controls;

let loader;
let texture_grass;
let texture_football;

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
        "無":0xDCAA6B,
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

function initOimo() {
    world = new OIMO.World();
    world.gravity = new OIMO.Vec3(0, -9.80665, 0);
    
    let groundShapec = new OIMO.ShapeConfig();
    groundShapec.geometry = new OIMO.BoxGeometry(new OIMO.Vec3(25, 0, 25));
    groundShapec.friction  = 0.6;
    groundShapec.restitution  = 0.5;
    let groundBodyc = new OIMO.RigidBodyConfig();
    groundBodyc.type = OIMO.RigidBodyType.STATIC;
    groundBodyc.position = new OIMO.Vec3(0, -5, 0);
    let groundBody = new OIMO.RigidBody(groundBodyc);
    groundBody.addShape(new OIMO.Shape(groundShapec));
    world.addRigidBody(groundBody);
}

function initThree() {
    container = document.getElementById('container');
    camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.x = 0;
    camera.position.y = 20;
    camera.position.z = 50;
    scene = new THREE.Scene();

    loader = new THREE.TextureLoader();
    texture_grass = loader.load('../../../../assets/textures/grass.jpg');
    texture_football = loader.load('../../../../assets/textures/football.png');

    let material = new THREE.MeshBasicMaterial({map: texture_grass});
    let geometryGround = new THREE.PlaneGeometry(50, 50);
    meshGround = new THREE.Mesh(geometryGround, material);
    meshGround.rotation.x = -Math.PI * 90 / 180;
    meshGround.position.y = -5;
    scene.add(meshGround);

    renderer = new THREE.WebGLRenderer();
    renderer.setClearColor(0x000000);
    renderer.setSize(window.innerWidth, window.innerHeight);
    container.appendChild(renderer.domElement);

    controls = new THREE.OrbitControls( camera, renderer.domElement );
    controls.autoRotate = true;
}

// initialize lights
function initLights() {
    let directionalLight, ambientLight;
    directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(0.2, 0.5, 0.3);
    scene.add(directionalLight);
    ambientLight = new THREE.AmbientLight(0x101020);
    scene.add(ambientLight);
}

function createBall(x, y, z, w, h, d, mass, color) {
    let geometry, material, mesh, shape;
    let shapec = new OIMO.ShapeConfig();
    shapec.geometry = new OIMO.SphereGeometry(w/2);
    shapec.friction  = 0.4;
    shapec.restitution  = 0.6;
    let bodyc = new OIMO.RigidBodyConfig();
    bodyc.type = OIMO.RigidBodyType.DYNAMIC;
    bodyc.position.x = x;
    bodyc.position.y = y;
    bodyc.position.z = z;
    let body = new OIMO.RigidBody(bodyc);
    body.addShape(new OIMO.Shape(shapec));
    world.addRigidBody(body);

    geometry = new THREE.SphereGeometry(w/2, 36, 36);
    material = new THREE.MeshLambertMaterial({
        color: Math.round(color),
        map: texture_football
    });
    mesh = new THREE.Mesh(geometry, material);
    mesh.rigidBody = body;
    scene.add(mesh);
}

function createBalls() {
    const BOX_SIZE = 1;
    for (let x = 0; x < 16; x++) {
        for (let y = 0; y < 16; y++) {
            i = x + (15 - y) * 16;
            let z = 0;
            let x1 = -10 + x * BOX_SIZE * 1.5 + Math.random() * 0.1;
            let y1 = 0 + (15 - y) * BOX_SIZE * 1.2 + Math.random() * 0.1;
            let z1 = z * BOX_SIZE * 1 + Math.random() * 0.1;
            let color = getRgbColor(dataSet[y * 16 + x]);
            let w = BOX_SIZE * 1;
            let h = BOX_SIZE * 1;
            let d = BOX_SIZE * 1;
            let mass = 1;
            createBall(x1, y1, z1, w, h, d, mass, color);
        }
    }
}

function animate() {
    controls.update();
    requestAnimationFrame(animate);
    updatePhysics();
    render();
}

function updatePhysics() {
    world.step(1/60);

    (function updateObject3D(mesh) {
        if (mesh.rigidBody) {
            mesh.position.x = mesh.rigidBody.getPosition().x;
            mesh.position.y = mesh.rigidBody.getPosition().y;
            mesh.position.z = mesh.rigidBody.getPosition().z;
            mesh.quaternion.x = mesh.rigidBody.getOrientation().x;
            mesh.quaternion.y = mesh.rigidBody.getOrientation().y;
            mesh.quaternion.z = mesh.rigidBody.getOrientation().z;
            mesh.quaternion.w = mesh.rigidBody.getOrientation().w;
        }
        if (mesh.children) {
            mesh.children.map(updateObject3D);
        }
    })(scene);
}

function render() {
    renderer.render(scene, camera);
}

initOimo();
initThree();
initLights();
createBalls();
animate();
