let engine;
let scene;
let canvas;

async function init() {
    canvas = document.querySelector("#c");
    engine = new BABYLON.Engine(canvas, true);
    await Ammo();

    scene = createScene();

    engine.runRenderLoop(function () {
        scene.render();
    });
}

const createScene = function() {
    scene = new BABYLON.Scene(engine);

    const camera = new BABYLON.ArcRotateCamera("Camera", 0, 0, 10, new BABYLON.Vector3(0, 0, 0), scene);
    camera.setPosition(new BABYLON.Vector3(0, 20, -100));
    camera.attachControl(canvas);

    const importPromise = BABYLON.SceneLoader.ImportMeshAsync(null, "https://rawcdn.githack.com/cx20/gltf-test/1f6515ce/sampleModels/Duck/glTF/", "Duck.gltf", scene);
    importPromise.then(function (result) {

        scene.enablePhysics(new BABYLON.Vector3(0,-9.8,0), new BABYLON.AmmoJSPlugin());
        scene.getPhysicsEngine().setTimeStep(1 / 30);
        
        scene.forceShowBoundingBoxes = true;

        const material = new BABYLON.StandardMaterial("material", scene);
        material.emissiveColor = new BABYLON.Color3(0.5, 0.5, 0.5);
        const ground = new BABYLON.Mesh.CreateBox('ground', 200.0, scene);
        ground.position.y = -20;
        ground.scaling.y = 0.01;
        ground.material = material;
        ground.physicsImpostor = new BABYLON.PhysicsImpostor(ground, BABYLON.PhysicsImpostor.BoxImpostor, {mass: 0, friction: 0.1, restitution: 0.2}, scene);
        
        const mesh = result.meshes[0];
        mesh.scaling = new BABYLON.Vector3(20, 20, 20);
        mesh.position.y = 30;
        mesh.physicsImpostor = new BABYLON.PhysicsImpostor(mesh, BABYLON.PhysicsImpostor.BoxImpostor, {mass: 1, friction: 0.0, restitution: 1.0}, scene);

        const light1 = new BABYLON.DirectionalLight("dir01", new BABYLON.Vector3(0, 0, 1), scene);
        light1.groundColor = new BABYLON.Color3(1, 0, 0);
        light1.position = new BABYLON.Vector3(20, 40, 20);

        scene.registerBeforeRender(function() {
            scene.activeCamera.alpha += Math.PI * 1.0 / 180.0 * scene.getAnimationRatio();
        });
    
        //When click event is raised
        window.addEventListener("click", function () {
            const pickResult = scene.pick(scene.pointerX, scene.pointerY);
            mesh.physicsImpostor.setLinearVelocity(new BABYLON.Vector3(0,10,0));
        })
    });
        
    return scene;
}

init();
