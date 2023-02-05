let sceneThree;
let controls;
let loader;
let texture;
let renderer;

let scenePhysx;

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
    scenePhysx = physics.createScene(sceneDesc);
    console.log('Created scene');
    
    // create three.js scene
    const camera = new THREE.PerspectiveCamera( 45, window.innerWidth / window.innerHeight, 0.01, 1000 );
    camera.position.x = 0;
    camera.position.y = 5;
    camera.position.z = 20;

    const sceneThree = new THREE.Scene();
    
    // create a default material
    let material = physics.createMaterial(0.5, 0.5, 0.5);
    // create default simulation shape flags
    let shapeFlags = new PhysX.PxShapeFlags(PhysX._emscripten_enum_PxShapeFlagEnum_eSCENE_QUERY_SHAPE() | PhysX._emscripten_enum_PxShapeFlagEnum_eSIMULATION_SHAPE());

    // create three.js material
    let materialThree = new THREE.MeshBasicMaterial({map: texture});
    let geometryGround = new THREE.BoxGeometry(20, 1, 20);
    meshGround = new THREE.Mesh(geometryGround, materialThree);
    sceneThree.add(meshGround);

    // create three.js mesh
    let geometryCube = new THREE.BoxGeometry(5, 5, 5);
    meshCube = new THREE.Mesh(geometryCube, materialThree);
    sceneThree.add(meshCube);
    
    // create a few temporary objects used during setup
    let tmpPose = new PhysX.PxTransform(PhysX._emscripten_enum_PxIDENTITYEnum_PxIdentity());
    let tmpFilterData = new PhysX.PxFilterData(1, 1, 0, 0);

    // create a large static box with size 20x1x20 as ground
    let groundGeometry = new PhysX.PxBoxGeometry(10, 0.5, 10);   // PxBoxGeometry uses half-sizes
    let groundShape = physics.createShape(groundGeometry, materialThree, true, shapeFlags);
    let ground = physics.createRigidStatic(tmpPose);
    groundShape.setSimulationFilterData(tmpFilterData);
    ground.attachShape(groundShape);
    scenePhysx.addActor(ground);

    meshGround.position.x = ground.getGlobalPose().get_p().get_x();
    meshGround.position.y = ground.getGlobalPose().get_p().get_y();
    meshGround.position.z = ground.getGlobalPose().get_p().get_z();
    
    // create a small dynamic box with size 5x5x5, which will fall on the ground
    tmpVec.set_x(0);
    tmpVec.set_y(10);
    tmpVec.set_z(0);
    tmpPose.set_p(tmpVec);
    let boxGeometry = new PhysX.PxBoxGeometry(2.5, 2.5, 2.5);   // PxBoxGeometry uses half-sizes
    let boxShape = physics.createShape(boxGeometry, material, true, shapeFlags);
    let box = physics.createRigidDynamic(tmpPose);
    boxShape.setSimulationFilterData(tmpFilterData);
    box.attachShape(boxShape);
    scenePhysx.addActor(box);

    // clean up temp objects
    PhysX.destroy(groundGeometry);
    PhysX.destroy(boxGeometry);
    PhysX.destroy(tmpFilterData);
    PhysX.destroy(tmpPose);
    PhysX.destroy(tmpVec);
    PhysX.destroy(shapeFlags);
    PhysX.destroy(sceneDesc);
    PhysX.destroy(tolerances);
    console.log('Created scene objects');

    renderer = new THREE.WebGLRenderer( { antialias: true } );
    renderer.setSize( window.innerWidth, window.innerHeight );
    renderer.setAnimationLoop( animation );
    document.body.appendChild( renderer.domElement );
    controls = new THREE.OrbitControls( camera, renderer.domElement );

    function animation( time ) {

        scenePhysx.simulate(1.0/60.0);
        scenePhysx.fetchResults(true);
        //let boxHeight = box.getGlobalPose().get_p().get_y();
        meshCube.position.x = box.getGlobalPose().get_p().get_x();
        meshCube.position.y = box.getGlobalPose().get_p().get_y();
        meshCube.position.z = box.getGlobalPose().get_p().get_z();
        meshCube.quaternion.x = box.getGlobalPose().get_q().get_x();
        meshCube.quaternion.y = box.getGlobalPose().get_q().get_y();
        meshCube.quaternion.z = box.getGlobalPose().get_q().get_z();
        meshCube.quaternion.w = box.getGlobalPose().get_q().get_w();

        renderer.render( sceneThree, camera );
    }

/*
    // cleanup stuff
    scenePhysx.removeActor(ground);
    ground.release();
    groundShape.release();

    scenePhysx.removeActor(box);
    box.release();
    boxShape.release();

    scenePhysx.release();
    material.release();
    physics.release();
    foundation.release();
    PhysX.destroy(errorCb);
    PhysX.destroy(allocator);
    console.log('Cleaned up');
*/
}


window.addEventListener("load", function() {
    loader = new THREE.TextureLoader();
    texture = loader.load('../../../../assets/textures/frog.jpg');

    PhysX().then(function(PhysX) {
        init(PhysX);
    });
}, false);

