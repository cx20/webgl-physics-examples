let engine;
let scene;
let canvas;
const PHYSICS_SCALE = 1/10;

async function init() {
    canvas = document.querySelector("#c");
    globalThis.HK = await HavokPhysics();
    engine = new BABYLON.Engine(canvas, true);

    scene = createScene();

    engine.runRenderLoop(function () {
        scene.render();
    });
};

const createScene = function() {
    scene = new BABYLON.Scene(engine);
    const hk = new BABYLON.HavokPlugin();
    scene.enablePhysics(new BABYLON.Vector3(0,-9.8,0), hk);
    scene.getPhysicsEngine().setTimeStep(scene.getAnimationRatio());

    const camera = new BABYLON.ArcRotateCamera("Camera", 0, 0, 10, new BABYLON.Vector3(0, 0, 0), scene);
    camera.setPosition(new BABYLON.Vector3(0, 20 * PHYSICS_SCALE, -200 * PHYSICS_SCALE));
    camera.attachControl(canvas, true);
    
    scene.clearColor = new BABYLON.Color3(1, 1, 1);
    

    const material = new BABYLON.StandardMaterial("material", scene);
    material.diffuseTexture = new BABYLON.Texture("../../../../assets/textures/frog.jpg", scene);
    material.emissiveColor = new BABYLON.Color3(1, 1, 1);
    const ground = new BABYLON.Mesh.CreateBox('ground', 200.0 * PHYSICS_SCALE, scene);
    ground.position.y = -20 * PHYSICS_SCALE;
    ground.scaling.y = 0.01;
    ground.material = material;
    const groundAggregate = new BABYLON.PhysicsAggregate(ground, BABYLON.PhysicsShapeType.BOX, {mass: 0, friction: 0.1, restitution: 0.1}, scene);

    const cube = new BABYLON.Mesh.CreateBox('cube', 50 * PHYSICS_SCALE, scene);
    cube.material = material;
    cube.position.y = 100 * PHYSICS_SCALE;
    cube.rotation.x = Math.PI * 10/180;
    cube.rotation.z = Math.PI * 10/180;
    const cubeAggregate = new BABYLON.PhysicsAggregate(cube, BABYLON.PhysicsShapeType.BOX, {mass: 1, friction: 0.2, restitution: 0.5}, scene);

    scene.registerBeforeRender(function() {
        scene.activeCamera.alpha += Math.PI * 1.0 / 180.0 * scene.getAnimationRatio();
    });

    return scene;
}

init();