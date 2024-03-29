import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

class Box {
    constructor(x, y, z, w, h, d, texture) {
        this.x = x;
        this.y = y;
        this.z = z;
        this.w = w;
        this.h = h;
        this.d = d;
        this.threeObj = null;
        this.physxObj = null;
        this.texture = texture;
        this.initThreeObj();
        this.initPhysxObj();
    }

    initThreeObj() {
        let w = this.w;
        let h = this.h;
        let d = this.d;
        let geometry = new THREE.BoxGeometry(w, h, d);
        let material = new THREE.MeshBasicMaterial({
            map: this.texture
        });
        let box = new THREE.Mesh(geometry, material);
        box.position.x = this.x;
        box.position.y = this.y;
        box.position.z = this.z;

        this.threeObj = box;
    }

    initPhysxObj() {
        // create a default material
        let material = physics.createMaterial(0.5, 0.5, 0.5);
        // create default simulation shape flags
        let shapeFlags = new PhysX.PxShapeFlags(
             PhysX._emscripten_enum_PxShapeFlagEnum_eSCENE_QUERY_SHAPE() 
           | PhysX._emscripten_enum_PxShapeFlagEnum_eSIMULATION_SHAPE());

        // create a few temporary objects used during setup
        let tmpPose = new PhysX.PxTransform(PhysX._emscripten_enum_PxIDENTITYEnum_PxIdentity());
        let tmpFilterData = new PhysX.PxFilterData(1, 1, 0, 0);

        // create a small dynamic box with size 5x5x5, which will fall on the ground
        let tmpVec = new PhysX.PxVec3(0, 0, 0);
        tmpVec.set_x(0);
        tmpVec.set_y(this.y);
        tmpVec.set_z(0);
        tmpPose.set_p(tmpVec);
        let boxGeometry = new PhysX.PxBoxGeometry(this.w / 2, this.h / 2, this.d / 2);   // PxBoxGeometry uses half-sizes
        let boxShape = physics.createShape(boxGeometry, material, true, shapeFlags);
        let box = physics.createRigidDynamic(tmpPose);
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

class Ground {
    constructor(x, y, z, w, h, d, texture) {
        this.x = x;
        this.y = y;
        this.z = z;
        this.w = w;
        this.h = h;
        this.d = d;
        this.threeObj = null;
        this.physxObj = null;
        this.texture = texture;
        this.materialThree = null;
        this.initThreeObj();
        this.initPhysxObj();
    }

    initThreeObj() {
        let geometry = new THREE.BoxGeometry(this.w, this.h, this.d);
        this.materialThree = new THREE.MeshBasicMaterial({
            map: this.texture
        });
        let ground = new THREE.Mesh(geometry, this.materialThree);
        ground.position.x = this.x;
        ground.position.y = this.y;
        ground.position.z = this.z;

        this.threeObj = ground;
    }

    initPhysxObj() {
        // create a default material
        let material = physics.createMaterial(0.5, 0.5, 0.5);
        // create default simulation shape flags
        let shapeFlags = new PhysX.PxShapeFlags(
             PhysX._emscripten_enum_PxShapeFlagEnum_eSCENE_QUERY_SHAPE() 
           | PhysX._emscripten_enum_PxShapeFlagEnum_eSIMULATION_SHAPE());

        // create a few temporary objects used during setup
        let tmpPose = new PhysX.PxTransform(PhysX._emscripten_enum_PxIDENTITYEnum_PxIdentity());
        let tmpFilterData = new PhysX.PxFilterData(1, 1, 0, 0);

        // create a large static box with size 20x1x20 as ground
        let groundGeometry = new PhysX.PxBoxGeometry(this.w / 2, this.h / 2, this.d / 2);   // PxBoxGeometry uses half-sizes
        let groundShape = physics.createShape(groundGeometry, this.materialThree, true, shapeFlags);
        let ground = physics.createRigidStatic(tmpPose);
        groundShape.setSimulationFilterData(tmpFilterData);
        ground.attachShape(groundShape);
        this.physxObj = ground;
    }
}


function init(PhysX) {
    window.PhysX = PhysX;
    console.log('PhysX loaded');

    let version = PhysX.PxTopLevelFunctions.prototype.PHYSICS_VERSION;
    let allocator = new PhysX.PxDefaultAllocator();
    let errorCb = new PhysX.PxDefaultErrorCallback();
    let foundation = PhysX.PxTopLevelFunctions.prototype.CreateFoundation(version, allocator, errorCb);
    console.log('Created PxFoundation');

    let tolerances = new PhysX.PxTolerancesScale();
    window.physics = PhysX.PxTopLevelFunctions.prototype.CreatePhysics(version, foundation, tolerances);
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
    camera.position.y = 5;
    camera.position.z = 20;

    const sceneThree = new THREE.Scene();

    const loader = new THREE.TextureLoader();
    const texture = loader.load('../../../../assets/textures/frog.jpg');
    
    let ground = new Ground(0, 0, 0, 20, 1, 20, texture);
    sceneThree.add(ground.threeObj);
    scenePhysx.addActor(ground.physxObj);
    
    let box = new Box(0, 10, 0, 5, 5, 5, texture);
    sceneThree.add(box.threeObj);
    scenePhysx.addActor(box.physxObj);
    box.move();

    const renderer = new THREE.WebGLRenderer( { antialias: true } );
    renderer.setSize( window.innerWidth, window.innerHeight );
    renderer.setAnimationLoop( animation );
    document.body.appendChild( renderer.domElement );
    const controls = new OrbitControls( camera, renderer.domElement );

    function animation( time ) {

        scenePhysx.simulate(1.0/60.0);
        scenePhysx.fetchResults(true);

        box.move();

        renderer.render( sceneThree, camera );
    }

}

window.addEventListener("load", function() {
    PhysX().then(function(PhysX) {
        init(PhysX);
    });
}, false);

