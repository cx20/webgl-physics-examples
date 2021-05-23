let engine;
let scene;
let canvas;
// to go quicker
let v3 = BABYLON.Vector3;
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
    scene.enablePhysics(new BABYLON.Vector3(0, -9.8, 0), new BABYLON.AmmoJSPlugin());
    scene.getPhysicsEngine().setTimeStep(1 / FPS);

    let camera = new BABYLON.ArcRotateCamera("Camera", 0, 0, 10, new BABYLON.Vector3(0, 0, 0), scene);
    camera.setPosition(new BABYLON.Vector3(0, 20 * PHYSICS_SCALE, -200 * PHYSICS_SCALE));
    camera.attachControl(canvas);

    new BABYLON.HemisphericLight("hemi", new BABYLON.Vector3(0, 1, 0), scene);
    new BABYLON.DirectionalLight("dir01", new BABYLON.Vector3(0.0, -1.0, 0.5), scene);

    let mat = new BABYLON.StandardMaterial("ground", scene);
    let t = new BABYLON.Texture("../../../../assets/textures/grass.jpg", scene); // grass.jpg

    t.uScale = t.vScale = 2;
    mat.diffuseTexture = t;
    mat.specularColor = BABYLON.Color3.Black();
    let g = BABYLON.Mesh.CreateBox("ground", 400 * PHYSICS_SCALE, scene);
    g.position.y = -20 * PHYSICS_SCALE;
    g.scaling.y = 0.01;
    g.material = mat;
    g.physicsImpostor = new BABYLON.PhysicsImpostor(g, BABYLON.PhysicsImpostor.BoxImpostor, {
        move: false,
        mass: 0,
        friction: 1.0,
        restitution: 1.0
    }, scene);

    // Get a random number between two limits
    let randomNumber = function(min, max) {
        if (min == max) {
            return (min);
        }
        let random = Math.random();
        return ((random * (max - min)) + min);
    };

    let objects = [];
    let getPosition = function(y) {
        return new BABYLON.Vector3(randomNumber(-25, 25), randomNumber(0, 100) + y, randomNumber(-25, 25));
    };
    let max = 300;

    for ( let i = 0; i < 20; i++ ) {
        let stair = BABYLON.Mesh.CreateBox("stair", 100 * PHYSICS_SCALE, scene);
        stair.position.x = i * -10 * PHYSICS_SCALE;
        stair.position.y = i * 5 * PHYSICS_SCALE - 10 * PHYSICS_SCALE;
        stair.scaling.x = 0.1;
        stair.scaling.y = 0.1;
        //stair.setPhysicsState({ impostor: BABYLON.PhysicsEngine.BoxImpostor, move:false, mass: 0, friction: 1.0, restitution: 1.0 });
        stair.physicsImpostor = new BABYLON.PhysicsImpostor(stair, BABYLON.PhysicsImpostor.BoxImpostor, { mass: 0, friction: 1.0, restitution: 1.0 }, scene);
    }

    let matEraser = new BABYLON.StandardMaterial("material", scene);
    matEraser.reflectionTexture = new BABYLON.CubeTexture(
        "../../../../assets/textures/eraser_002/",
        scene,
        [
        "eraser_px.png",
        "eraser_py.png",
        "eraser_pz.png",
        "eraser_nx.png",
        "eraser_ny.png",
        "eraser_nz.png",
        ]
    );
    matEraser.reflectionTexture.coordinatesMode = BABYLON.Texture.SKYBOX_MODE;
    matEraser.diffuseColor = BABYLON.Color3.Black();
    
    // Creates
    for (let i = 0; i < max; i++) {

        let scale = 1;
        let s = BABYLON.Mesh.CreateBox("s", 15, scene);
        // 消しゴムのサイズとなるよう調整
        s.scaling.x = 1.0 * PHYSICS_SCALE;
        s.scaling.y = 0.2 * PHYSICS_SCALE;
        s.scaling.z = 0.5 * PHYSICS_SCALE;
        s.position = new v3((randomNumber(-25,25) - 120) * PHYSICS_SCALE, (randomNumber(0, 100) + 200) * PHYSICS_SCALE, (randomNumber(-50, 50)) * PHYSICS_SCALE);
        s.material = matEraser;
        //s.setPhysicsState({impostor:BABYLON.PhysicsEngine.BoxImpostor, mass:1, friction:0.4, restitution:0.2});
        s.physicsImpostor = new BABYLON.PhysicsImpostor(s, BABYLON.PhysicsImpostor.BoxImpostor, { mass: 1, friction: 0.4, restitution: 0.2 }, scene);

        // SAVE OBJECT
        objects.push(s);

        // INCREMENT HEIGHT
        //y+=10;
    }

    scene.registerBeforeRender(function() {
        objects.forEach(function(obj) {
            if (obj.position.y < -100 * PHYSICS_SCALE) {
                obj.position = getPosition(200 * PHYSICS_SCALE);
                obj.physicsImpostor.setLinearVelocity(new BABYLON.Vector3(0,0,0));
            }
        });
    });
};
