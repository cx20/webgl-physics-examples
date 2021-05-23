let engine;
let scene;
let canvas;
let FPS = 60;    // default is 60 FPS
let PHYSICS_SCALE = 1/10;

document.addEventListener("DOMContentLoaded", function () {
    onload();
}, false);

window.addEventListener("resize", function () {
    if (engine) {
        engine.resize();
    }
},false);

let onload = function () {
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
    scene.enablePhysics(new BABYLON.Vector3(0, -9.8, 0), new BABYLON.CannonJSPlugin());
    scene.getPhysicsEngine().setTimeStep(1 / FPS);

    let camera = new BABYLON.ArcRotateCamera("Camera", 0.86, 1.37, 250, BABYLON.Vector3.Zero(), scene);
    camera.setPosition(new BABYLON.Vector3(0, 20 * PHYSICS_SCALE, -200 * PHYSICS_SCALE));
    camera.attachControl(canvas, true);

    let mat = new BABYLON.StandardMaterial("ground", scene);
    let t = new BABYLON.Texture("../../../../assets/textures/grass.jpg", scene); // grass.jpg
    
    t.uScale = t.vScale = 2;
    mat.diffuseTexture = t;
    mat.specularColor = BABYLON.Color3.Black();
    let g = BABYLON.Mesh.CreateBox("ground", 200 * PHYSICS_SCALE, scene);
    g.position.y = -15 * PHYSICS_SCALE;
    g.scaling.y = 0.01;
    g.material = mat;
    g.physicsImpostor = new BABYLON.PhysicsImpostor(g, BABYLON.PhysicsImpostor.BoxImpostor, { mass: 0, friction: 0.4, restitution: 0.6 }, scene);

    // light
    let light1 = new BABYLON.DirectionalLight("dir01", new BABYLON.Vector3(0.2, -1.0, 0.2), scene);
    let light2 = new BABYLON.DirectionalLight("dir02", new BABYLON.Vector3(-0.5, -0.5, -0.5), scene);    
    light1.intensity = 0.2;
    light2.intensity = 1.0;

    let matBoard = new BABYLON.StandardMaterial("board", scene);
    matBoard.emissiveColor = new BABYLON.Color3(0.5, 0.5, 0.5);
    matBoard.alpha = 0.5;
    for ( let i = 0; i < 4; i++ ) {
        let board = BABYLON.Mesh.CreateBox("ground", 50 * PHYSICS_SCALE, scene);
        switch ( i ) 
        {
            case 0:
                board.position.y = 10 * PHYSICS_SCALE;
                board.position.x = 25 * PHYSICS_SCALE;
                board.scaling.x = 0.1;
                break;
            case 1:
                board.position.y = 10 * PHYSICS_SCALE;
                board.position.x = -25 * PHYSICS_SCALE;
                board.scaling.x = 0.1;
                break;
            case 2:
                board.position.y = 10 * PHYSICS_SCALE;
                board.position.z = 25 * PHYSICS_SCALE;
                board.scaling.z = 0.1;
                break;
            case 3:
                board.position.y = 10 * PHYSICS_SCALE;
                board.position.z = -25 * PHYSICS_SCALE;
                board.scaling.z = 0.1;
                break;
        }
        board.material = matBoard;
        board.physicsImpostor = new BABYLON.PhysicsImpostor(board, BABYLON.PhysicsImpostor.BoxImpostor, { mass: 0, friction: 0.4, restitution: 0.6 }, scene);
    }

    // Get a random number between two limits
    let randomNumber = function (min, max) {
        if (min == max) {
            return (min);
        }
        let random = Math.random();
        return ((random * (max - min)) + min);
    };

    let y = 50;
    let objects = [];
    let max = 150;

    // Creates arandom position above the ground
    let getPosition = function(y) {
        return new BABYLON.Vector3((randomNumber(-25,25) * PHYSICS_SCALE), (randomNumber(0, 100) + y) * PHYSICS_SCALE, (randomNumber(-25, 25) * PHYSICS_SCALE));
    };
    let dataSet = [
        {imageFile:"../../../../assets/textures/Basketball.jpg", scale:1.0}, // Basketball.jpg
        {imageFile:"../../../../assets/textures/BeachBall.jpg",  scale:0.9}, // BeachBall.jpg
        {imageFile:"../../../../assets/textures/Football.jpg",   scale:1.0}, // Football.jpg
        {imageFile:"../../../../assets/textures/Softball.jpg",   scale:0.3}, // Softball.jpg
        {imageFile:"../../../../assets/textures/TennisBall.jpg", scale:0.3}, // TennisBall.jpg
    ];

    let matSphere = [];
    for ( let i = 0; i < dataSet.length; i++ ) {
        let imageFile = dataSet[i].imageFile;
        matSphere[i] = new BABYLON.StandardMaterial("boxmat", scene);
        matSphere[i].diffuseTexture = new BABYLON.Texture(imageFile, scene); // Football.png
        matSphere[i].specularColor = BABYLON.Color3.Black();
    }
    let shadowGenerator = new BABYLON.ShadowGenerator(1024, light1);
    
    // Creates
    for (let index = 0; index < max; index++) {

        let pos = Math.floor(Math.random() * dataSet.length);
        let scale = dataSet[pos].scale;
        let s = BABYLON.Mesh.CreateSphere("s", 30, 15 * scale * PHYSICS_SCALE, scene);
        s.position = getPosition(y);
        s.material = matSphere[pos];
        s.physicsImpostor = new BABYLON.PhysicsImpostor(s, BABYLON.PhysicsImpostor.SphereImpostor, { mass: 1, friction:0.4, restitution:0.8 }, scene);

        shadowGenerator.getShadowMap().renderList.push(s);
        shadowGenerator.useExponentialShadowMap  = true;
        g.receiveShadows = true;
        
        objects.push(s);

        y += 20 * PHYSICS_SCALE;
    }

    scene.registerBeforeRender(function() {
        objects.forEach(function(obj) {
            if (obj.position.y < -100 * PHYSICS_SCALE) {
                obj.position = getPosition(100);
                obj.physicsImpostor.setLinearVelocity(new BABYLON.Vector3(0,0,0));
                obj.physicsImpostor.setAngularVelocity(new BABYLON.Vector3(0,0,0));
            }
        });
        //scene.activeCamera.alpha += 0.005;
        scene.activeCamera.alpha += (2 * Math.PI)/(FPS * 10);
    });

};
