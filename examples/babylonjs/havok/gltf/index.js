let engine;
let scene;
let canvas;

async function init() {
    canvas = document.querySelector("#c");
    globalThis.HK = await HavokPhysics();
    engine = new BABYLON.Engine(canvas, true);

    scene = createScene();

    engine.runRenderLoop(function () {
        scene.render();
    });
}

const createScene = function() {
    scene = new BABYLON.Scene(engine);

    const camera = new BABYLON.ArcRotateCamera("Camera", -Math.PI / 2, Math.PI/3, 10, new BABYLON.Vector3(0, 0, 0), scene);
    camera.attachControl(canvas);

    const importPromise = BABYLON.SceneLoader.ImportMeshAsync(null, "https://rawcdn.githack.com/cx20/gltf-test/1f6515ce/sampleModels/Duck/glTF/", "Duck.gltf", scene);
    importPromise.then(function (result) {

        scene.enablePhysics(new BABYLON.Vector3(0,-9.8,0), new BABYLON.HavokPlugin());
        scene.getPhysicsEngine().setTimeStep(1 / 30);
        
        scene.forceShowBoundingBoxes = true;

        var light = new BABYLON.HemisphericLight("light", new BABYLON.Vector3(0, 1, 0), scene);
        light.intensity = 0.7;

        const material = new BABYLON.StandardMaterial("material", scene);
        const ground = BABYLON.MeshBuilder.CreateGround('ground', {width: 20, height: 20, depth: 1}, scene);
        ground.position.y = 0;
        //ground.material = material;
        ground.aggregate = new BABYLON.PhysicsAggregate(ground, BABYLON.PhysicsShapeType.BOX, {mass: 0, friction: 0.1, restitution: 0.2}, scene);
        
        const mesh = result.meshes[0];
        mesh.position.y = 10;

        const meshParent = BABYLON.MeshBuilder.CreateBox("center", {width: 1.5, height: 1.5, depth: 1.0}, scene);
        meshParent.isVisible = false;
        const boundingInfo = mesh.getHierarchyBoundingVectors();
        const center = BABYLON.Vector3.Center(boundingInfo.min, boundingInfo.max);
        meshParent.position = center;
        mesh.setParent(meshParent);

        meshParent.aggregate = new BABYLON.PhysicsAggregate(meshParent, BABYLON.PhysicsShapeType.BOX, {mass: 1, friction: 0.0, restitution: 1.0}, scene);
        
        scene.registerBeforeRender(function() {
            scene.activeCamera.alpha += Math.PI * 1.0 / 180.0 * scene.getAnimationRatio();
        });
    
        window.addEventListener("click", function () {
            const pickResult = scene.pick(scene.pointerX, scene.pointerY);
            meshParent.aggregate.body.setLinearVelocity(new BABYLON.Vector3(0,10,0));
        })
    });
        
    return scene;
}

init();
