const SCALE = 1 / 10;
const deltaT = 60;

let sceneThree;
let controls;
let loader;
let texture_grass;
let renderer;
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
    constructor(x, y, z, w, h, d, color, PhysX, physics) {
        this.x = x;
        this.y = y;
        this.z = z;
        this.w = w;
        this.h = h;
        this.d = d;
        this.color = color;
        this.physics = physics;
        this.threeObj = null;
        this.physxObj = null;
        this.initThreeObj();
        this.initPhysxObj(PhysX);
    }

    initThreeObj() {
        let w = this.w;
        let h = this.h;
        let d = this.d;
        let geometry = new THREE.BoxGeometry(w, h, d);
        this.materialThree = new THREE.MeshLambertMaterial({
            color: Math.round(this.color)
        });
        let box = new THREE.Mesh(geometry, this.materialThree);
        box.position.x = this.x;
        box.position.y = this.y;
        box.position.z = this.z;

        this.threeObj = box;
    }

    initPhysxObj(PhysX) {
        // create a default material
        let material = this.physics.createMaterial(0.5, 0.5, 0.5);
        // create default simulation shape flags
        let shapeFlags = new PhysX.PxShapeFlags(
             PhysX._emscripten_enum_PxShapeFlagEnum_eSCENE_QUERY_SHAPE() 
           | PhysX._emscripten_enum_PxShapeFlagEnum_eSIMULATION_SHAPE());

        // create a few temporary objects used during setup
        let tmpPose = new PhysX.PxTransform(PhysX._emscripten_enum_PxIDENTITYEnum_PxIdentity());
        let tmpFilterData = new PhysX.PxFilterData(1, 1, 0, 0);

        // create a small dynamic box with size 5x5x5, which will fall on the ground
        let tmpVec = new PhysX.PxVec3(0, 0, 0);
        tmpVec.set_x(this.x);
        tmpVec.set_y(this.y);
        tmpVec.set_z(this.z);
        tmpPose.set_p(tmpVec);
        let boxGeometry = new PhysX.PxBoxGeometry(this.w / 2, this.h / 2, this.d / 2);   // PxBoxGeometry uses half-sizes
        let boxShape = this.physics.createShape(boxGeometry, material, true, shapeFlags);
        let box = this.physics.createRigidDynamic(tmpPose);
        boxShape.setSimulationFilterData(tmpFilterData);
        box.attachShape(boxShape);
        this.physxObj = box;

    }

    move() {
        this.threeObj.position.x = this.physxObj.getGlobalPose().get_p().get_x();
        this.threeObj.position.y = this.physxObj.getGlobalPose().get_p().get_y();
        this.threeObj.position.z = this.physxObj.getGlobalPose().get_p().get_z();

        this.threeObj.quaternion.x = this.physxObj.getGlobalPose().get_q().get_x();
        this.threeObj.quaternion.y = this.physxObj.getGlobalPose().get_q().get_y();
        this.threeObj.quaternion.z = this.physxObj.getGlobalPose().get_q().get_z();
        this.threeObj.quaternion.w = this.physxObj.getGlobalPose().get_q().get_w();
    }

}

class Plane {
    constructor(x, y, z, w, h, d, color, PhysX, physics) {
        this.x = x;
        this.y = y;
        this.z = z;
        this.w = w;
        this.h = h;
        this.d = d;
        this.color = color;
        this.physics = physics;
        this.threeObj = null;
        this.physxObj = null;
        this.materialThree = null;
        this.initThreeObj();
        this.initPhysxObj(PhysX);
    }

    initThreeObj() {
        let geometry = new THREE.BoxGeometry(this.w, this.h, this.d);
        this.materialThree = new THREE.MeshLambertMaterial({
            color: this.color,
            map: texture_grass
        });
        let ground = new THREE.Mesh(geometry, this.materialThree);
        ground.position.x = this.x;
        ground.position.y = this.y;
        ground.position.z = this.z;

        this.threeObj = ground;
    }

    initPhysxObj(PhysX) {
        // create a default material
        let material = this.physics.createMaterial(0.5, 0.5, 0.5);
        // create default simulation shape flags
        let shapeFlags = new PhysX.PxShapeFlags(
             PhysX._emscripten_enum_PxShapeFlagEnum_eSCENE_QUERY_SHAPE() 
           | PhysX._emscripten_enum_PxShapeFlagEnum_eSIMULATION_SHAPE());

        // create a few temporary objects used during setup
        let tmpPose = new PhysX.PxTransform(PhysX._emscripten_enum_PxIDENTITYEnum_PxIdentity());
        let tmpFilterData = new PhysX.PxFilterData(1, 1, 0, 0);

        // create a small dynamic box with size 5x5x5, which will fall on the ground
        let tmpVec = new PhysX.PxVec3(0, 0, 0);
        tmpVec.set_x(this.x);
        tmpVec.set_y(this.y);
        tmpVec.set_z(this.z);
        tmpPose.set_p(tmpVec);

        // create a large static box with size 20x1x20 as ground
        let groundGeometry = new PhysX.PxBoxGeometry(this.w / 2, this.h / 2, this.d / 2);   // PxBoxGeometry uses half-sizes
        let groundShape = this.physics.createShape(groundGeometry, material, true, shapeFlags);
        let ground = this.physics.createRigidStatic(tmpPose);
        groundShape.setSimulationFilterData(tmpFilterData);
        ground.attachShape(groundShape);
        this.physxObj = ground;
    }
}

function init(PhysX) {
    console.log('PhysX loaded');

    let version = PhysX.PxTopLevelFunctions.prototype.PHYSICS_VERSION;
    let allocator = new PhysX.PxDefaultAllocator();
    let errorCb = new PhysX.PxDefaultErrorCallback();
    let foundation = PhysX.PxTopLevelFunctions.prototype.CreateFoundation(version, allocator, errorCb);
    console.log('Created PxFoundation');

    let tolerances = new PhysX.PxTolerancesScale();
    let physics = PhysX.PxTopLevelFunctions.prototype.CreatePhysics(version, foundation, tolerances);
    console.log('Created PxPhysics');
    
    // create scene
    let tmpVec = new PhysX.PxVec3(0, -9.81, 0);
    let sceneDesc = new PhysX.PxSceneDesc(tolerances);
    sceneDesc.set_gravity(tmpVec);
    sceneDesc.set_cpuDispatcher(PhysX.PxTopLevelFunctions.prototype.DefaultCpuDispatcherCreate(0));
    sceneDesc.set_filterShader(PhysX.PxTopLevelFunctions.prototype.DefaultFilterShader());
    let scenePhysx = physics.createScene(sceneDesc);
    console.log('Created scene');
    
    // create three.js scene
    const camera = new THREE.PerspectiveCamera( 45, window.innerWidth / window.innerHeight, 0.01, 1000 );
    camera.position.x = 0;
    camera.position.y = 100 * SCALE;
    camera.position.z = 150 * SCALE;

    const sceneThree = new THREE.Scene();
    
    let directionalLight = new THREE.DirectionalLight(0xffffff, 3);
    directionalLight.position.z = 3;
    sceneThree.add(directionalLight);

    let ground = new Plane(0, -10 * SCALE, 0, 200 * SCALE, 1, 200 * SCALE, 0xdddddd, PhysX, physics);
    sceneThree.add(ground.threeObj);
    scenePhysx.addActor(ground.physxObj);
    
    createBoxes(PhysX, physics);

    renderer = new THREE.WebGLRenderer( { antialias: true } );
    renderer.setSize( window.innerWidth, window.innerHeight );
    renderer.setAnimationLoop( animation );
    document.body.appendChild( renderer.domElement );
    controls = new THREE.OrbitControls( camera, renderer.domElement );

    function createBoxes(PhysX, physics) {
        const BOX_SIZE = 5;
        for (let x = 0; x < 16; x++) {
            for (let y = 0; y < 16; y++) {
                i = x + (15 - y) * 16;
                let z = 0;
                let x1 = (-7 + x) * BOX_SIZE * SCALE * 1.5 + Math.random() * 0.1;
                let y1 = (15 - y) * BOX_SIZE * SCALE * 1.2 + Math.random() * 0.1;
                let z1 = z * BOX_SIZE * SCALE * 1 + Math.random() * 0.1;
                let color = getRgbColor( dataSet[y * 16 + x] );
                let w = BOX_SIZE * SCALE;
                let h = BOX_SIZE * SCALE;
                let d = BOX_SIZE * SCALE;
                let box = new Box(x1, y1, z1, w, h, d, color, PhysX, physics);
                sceneThree.add(box.threeObj);
                scenePhysx.addActor(box.physxObj);
                objs.push(box);
                numObjects++;
            }
        }
    }

    function animation( time ) {

        scenePhysx.simulate(1.0/60.0);
        scenePhysx.fetchResults(true);

        for (let i = numObjects; i--;) {
            let obj = objs[i];
            obj.move();
        }
        
        renderer.render( sceneThree, camera );
    }

}


window.addEventListener("load", function() {
    loader = new THREE.TextureLoader();
    loader = new THREE.TextureLoader();
    texture_grass = loader.load('../../../../assets/textures/grass.jpg');
    texture_grass.wrapS   = texture_grass.wrapT = THREE.RepeatWrapping;
    texture_grass.repeat.set( 5, 5 );  

    PhysX().then(function(PhysX) {
        init(PhysX);
    });
}, false);

