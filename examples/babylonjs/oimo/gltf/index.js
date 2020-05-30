var createScene = function(engine) {
    var scene = new BABYLON.Scene(engine);
    var mesh;

    var loader = BABYLON.SceneLoader.Load("https://rawcdn.githack.com/cx20/gltf-test/1f6515ce/sampleModels/Duck/glTF/", "Duck.gltf", engine, function (newScene) {
        var gl = engine._gl;

        scene = newScene;
        scene.enablePhysics(new BABYLON.Vector3(0,-9.8,0), new BABYLON.OimoJSPlugin());
        scene.getPhysicsEngine().setTimeStep(1 / 30);
        
        scene.forceShowBoundingBoxes = true;

        var material = new BABYLON.StandardMaterial("material", scene);
        material.emissiveColor = new BABYLON.Color3(0.5, 0.5, 0.5);
        var ground = new BABYLON.Mesh.CreateBox('ground', 200.0, scene);
        ground.position.y = -20;
        ground.scaling.y = 0.01;
        ground.material = material;
        ground.physicsImpostor = new BABYLON.PhysicsImpostor(ground, BABYLON.PhysicsImpostor.BoxImpostor, {mass: 0, friction: 0.1, restitution: 0.2}, scene);
        
        mesh = scene.meshes[0];
        mesh.scaling = new BABYLON.Vector3(20, 20, 20);
        mesh.position.y = 30;
        //mesh.rotation.x = Math.PI * 10/180;
        //mesh.rotation.z = Math.PI * 10/180;
        mesh.physicsImpostor = new BABYLON.PhysicsImpostor(mesh, BABYLON.PhysicsImpostor.BoxImpostor, {mass: 1, friction: 0.0, restitution: 1.0}, scene);

        var camera = new BABYLON.ArcRotateCamera("Camera", 0, 0, 10, new BABYLON.Vector3(0, 0, 0), scene);
        camera.setPosition(new BABYLON.Vector3(0, 20, -100));
        camera.attachControl(canvas, true);

        var light1 = new BABYLON.DirectionalLight("dir01", new BABYLON.Vector3(0, 0, 1), scene);
        light1.groundColor = new BABYLON.Color3(1, 0, 0);
        light1.position = new BABYLON.Vector3(20, 40, 20);

        engine.runRenderLoop(function () {
            scene.render();

            // TODO: I do not know how to set correctly in Babylon.js
            gl.disable(gl.CULL_FACE);

            scene.activeCamera.alpha += 0.005;
        });
        
        //When click event is raised
        window.addEventListener("click", function () {
            var pickResult = scene.pick(scene.pointerX, scene.pointerY);
            mesh.physicsImpostor.setLinearVelocity(new BABYLON.Vector3(0,10,0));
        })
    });
        
    return scene;
}

var canvas = document.querySelector("#c");
var engine = new BABYLON.Engine(canvas, true);
var scene = createScene(engine);
