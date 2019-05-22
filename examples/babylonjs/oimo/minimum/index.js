var createScene = function(engine) {
    var scene = new BABYLON.Scene(engine);
    scene.enablePhysics(new BABYLON.Vector3(0,-9.8,0), new BABYLON.OimoJSPlugin());
    scene.getPhysicsEngine().setTimeStep(1 / 30);

    var camera = new BABYLON.ArcRotateCamera("Camera", 0, 0, 10, new BABYLON.Vector3(0, 0, 0), scene);
    camera.setPosition(new BABYLON.Vector3(0, 20, -200));
    camera.attachControl(canvas, true);
    
    scene.clearColor = new BABYLON.Color3(1, 1, 1);
    

    var material = new BABYLON.StandardMaterial("material", scene);
    material.diffuseTexture = new BABYLON.Texture("../../../../assets/textures/frog.jpg", scene);
    material.emissiveColor = new BABYLON.Color3(1, 1, 1);
    var ground = new BABYLON.Mesh.CreateBox('ground', 200.0, scene);
    ground.position.y = -20;
    ground.scaling.y = 0.01;
    ground.material = material;
    ground.physicsImpostor = new BABYLON.PhysicsImpostor(ground, BABYLON.PhysicsImpostor.BoxImpostor, {mass: 0, friction: 0.1, restitution: 0.1}, scene);

    var cube = new BABYLON.Mesh.CreateBox('cube', 50.0, scene);
    cube.material = material;
    cube.position.y = 100;
    cube.rotation.x = Math.PI * 10/180;
    cube.rotation.z = Math.PI * 10/180;
    cube.physicsImpostor = new BABYLON.PhysicsImpostor(cube, BABYLON.PhysicsImpostor.BoxImpostor, {mass: 1, friction: 0.2, restitution: 0.5}, scene);

    engine.runRenderLoop(function () {
        scene.render();
        scene.activeCamera.alpha -= 0.01;
    });
    return scene;
}

var canvas = document.querySelector("#c");
var engine = new BABYLON.Engine(canvas, true);
var scene = createScene(engine);

