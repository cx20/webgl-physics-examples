'use strict';

let gltf = null;
let world, shape, body, ground, timeStep = 1 / 60;
let camera, scene, renderer, duck, plane,
    cubeSize = 1;

let wireframeCube;
let trackball;

let cubeSizeX = 16/16*5;
let cubeSizeY = 16/16*5;
let cubeSizeZ = 9/16*5;

function createCube(w, h, d) {
    let geometry = new THREE.CubeGeometry(w, h, d, 10, 10);
    let material = new THREE.MeshLambertMaterial({
        color: 0x666666
    });
    let mesh = new THREE.Mesh(geometry, material);

    return mesh;
}

function createWireframeCube(w, h, d) {
    let materialColor = 0x00ff00;
    let geometry = new THREE.CubeGeometry(w, h, d);
    let material = new THREE.MeshBasicMaterial({
        color: materialColor,
        wireframe:true
    });
    let mesh = new THREE.Mesh(geometry, material);

    return mesh;
}

function loadDuck() {
    let manager = new THREE.LoadingManager();
    manager.onProgress = function ( item, loaded, total ) {
        console.log( item, loaded, total );
    };

    let texture = new THREE.Texture();
    
    let objLoader = new THREE.GLTFLoader();
    objLoader.setCrossOrigin( 'anonymous' );
    let url =  'https://cdn.rawgit.com/cx20/gltf-test/5465cc37/sampleModels/Duck/glTF/Duck.gltf';
    objLoader.load(url, function ( data ) {
        gltf = data;
        let object = gltf.scene;
        object.traverse( function ( child ) {
            if ( child instanceof THREE.Mesh ) {
                child.translateY(child.position.y - 100);
            }
        } );
        object.scale.set( 5, 5, 5 );
        duck = object;

        let axis = new THREE.AxesHelper(1000);   
        duck.add(axis);
        duck.castShadow = true;
        duck.receiveShadow = true;
        scene.add(duck);

        animate();
    });
}

function createPlane(w, h) {
    let geometry = new THREE.PlaneGeometry(w, h);
    let material = new THREE.MeshPhongMaterial({
        color: 0xffffff,
        specular: 0xeeeeee,
        shininess: 50
    });
    let mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = -5;

    return mesh;
}

function initOimo() {
    world = new OIMO.World();
    world.gravity = new OIMO.Vec3(0, -9.80665, 0);
    
    let groundShapec = new OIMO.ShapeConfig();
    groundShapec.geometry = new OIMO.BoxGeometry(new OIMO.Vec3(400, 4, 400));
    groundShapec.friction  = 0.5;
    groundShapec.restitution  = 0.1;
    let groundBodyc = new OIMO.RigidBodyConfig();
    groundBodyc.type = OIMO.RigidBodyType.STATIC;
    groundBodyc.position = new OIMO.Vec3(0, -5, 0);
    let groundBody = new OIMO.RigidBody(groundBodyc);
    groundBody.addShape(new OIMO.Shape(groundShapec));
    world.addRigidBody(groundBody);
    
    let shapec = new OIMO.ShapeConfig();
    shapec.geometry = new OIMO.BoxGeometry(new OIMO.Vec3(cubeSizeX, cubeSizeY, cubeSizeZ));
    shapec.friction  = 0.5;
    shapec.restitution  = 0.2;
    let bodyc = new OIMO.RigidBodyConfig();
    bodyc.type = OIMO.RigidBodyType.DYNAMIC;
    bodyc.position = new OIMO.Vec3(0, 10, 0);
    body = new OIMO.RigidBody(bodyc);
    body.setRotationXyz(new OIMO.Vec3(Math.PI*10/180, 0, Math.PI*10/180));
    body.addShape(new OIMO.Shape(shapec));
    world.addRigidBody(body);
}

function initThree() {
    let w = window.innerWidth;
    let h = window.innerHeight;
    camera = new THREE.PerspectiveCamera(30, w / h, 1, 10000);
    camera.position.set(20, 3, 20 );

    scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x000000, 1, 200);
    renderer = new THREE.WebGLRenderer({antialias: true});
    renderer.setSize(w, h);
    renderer.setClearColor(0x000000, 1);

    let light = new THREE.DirectionalLight(0xffffff, 2);
    let amb   = new THREE.AmbientLight(0x404040);
    let d = 10;

    light.position.set(d, d, -d);

    loadDuck();
    plane = createPlane(300, 300);
    plane.rotation.x = -Math.PI / 2;

    wireframeCube = createWireframeCube(cubeSizeX*2, cubeSizeY*2, cubeSizeZ*2);
    
    scene.add(camera);
    scene.add(light);
    scene.add(amb);

    scene.add(plane);
    scene.add(wireframeCube);

    document.body.appendChild(renderer.domElement);

    renderer.render(scene, camera);

    trackball = new THREE.TrackballControls(camera);
}

function animate() {
    trackball.update();
    requestAnimationFrame(animate);
    updatePhysics();
    render();
}

function updatePhysics() {
    world.step(1/60);
 
    duck.position.x = body.getPosition().x;
    duck.position.y = body.getPosition().y;
    duck.position.z = body.getPosition().z;
    duck.quaternion.x = body.getOrientation().x;
    duck.quaternion.y = body.getOrientation().y;
    duck.quaternion.z = body.getOrientation().z;
    duck.quaternion.w = body.getOrientation().w;
    wireframeCube.position.x = body.getPosition().x;
    wireframeCube.position.y = body.getPosition().y;
    wireframeCube.position.z = body.getPosition().z;
    wireframeCube.quaternion.x = body.getOrientation().x;
    wireframeCube.quaternion.y = body.getOrientation().y;
    wireframeCube.quaternion.z = body.getOrientation().z;
    wireframeCube.quaternion.w = body.getOrientation().w;
}

function render() {
    renderer.render(scene, camera);
}

initOimo();
initThree();

document.addEventListener('click', function() {
    body.setLinearVelocity(new OIMO.Vec3(0, 5, 0));
}, false);
