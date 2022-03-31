let engine;
let scene;
let canvas;
let FPS = 240;    // default is 60 FPS
let PHYSICS_SCALE = 1/10;

async function init() {
    canvas = document.querySelector("#c");
    engine = new BABYLON.Engine(canvas, true);

    createScene();

    engine.runRenderLoop(function () {
        scene.render();
        scene.activeCamera.alpha += (2 * Math.PI)/(FPS * 10);
    });

    setTimeout(adjustSceneFps, 1000);
    function adjustSceneFps() {
        FPS = engine.getFps();
        scene.getPhysicsEngine().setTimeStep(1 / FPS);
    }
};

let createScene = function() {
    scene = new BABYLON.Scene(engine);
    scene.enablePhysics(new BABYLON.Vector3(0,-9.8,0), new BABYLON.OimoJSPlugin());
    scene.getPhysicsEngine().setTimeStep(1 / FPS);

    let camera = new BABYLON.ArcRotateCamera("Camera", 0, 0, 10, new BABYLON.Vector3(0, 0, 0), scene);
    camera.setPosition(new BABYLON.Vector3(0, 20 * PHYSICS_SCALE, -200 * PHYSICS_SCALE));
    camera.attachControl(canvas, true);
    
    scene.clearColor = new BABYLON.Color3(1, 1, 1);
    

    let material = new BABYLON.StandardMaterial("material", scene);
    material.diffuseTexture = new BABYLON.Texture("../../../../assets/textures/frog.jpg", scene);
    material.emissiveColor = new BABYLON.Color3(1, 1, 1);
    let ground = new BABYLON.Mesh.CreateBox('ground', 200.0 * PHYSICS_SCALE, scene);
    ground.position.y = -20 * PHYSICS_SCALE;
    ground.scaling.y = 0.01;
    ground.material = material;
    ground.physicsImpostor = new BABYLON.PhysicsImpostor(ground, BABYLON.PhysicsImpostor.BoxImpostor, {mass: 0, friction: 0.1, restitution: 0.1}, scene);

    let cube = new BABYLON.Mesh.CreateBox('cube', 50 * PHYSICS_SCALE, scene);
    cube.material = material;
    cube.position.y = 100 * PHYSICS_SCALE;
    cube.rotation.x = Math.PI * 10/180;
    cube.rotation.z = Math.PI * 10/180;
    cube.physicsImpostor = new BABYLON.PhysicsImpostor(cube, BABYLON.PhysicsImpostor.BoxImpostor, {mass: 1, friction: 0.2, restitution: 0.5}, scene);

    engine.runRenderLoop(function () {
        scene.render();
        scene.activeCamera.alpha += (2 * Math.PI)/(FPS * 10);
    });

    setTimeout(adjustSceneFps, 1000);
    function adjustSceneFps() {
        FPS = engine.getFps();
        scene.getPhysicsEngine().setTimeStep(1 / FPS);
    }
    return scene;
}

init();
