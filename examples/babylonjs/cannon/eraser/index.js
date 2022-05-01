let engine;
let scene;
let canvas;
// to go quicker
const v3 = BABYLON.Vector3;
const PHYSICS_SCALE = 1/10;

async function init() {

    canvas = document.querySelector("#c");
    engine = new BABYLON.Engine(canvas, true);

    scene = createScene();

    engine.runRenderLoop(function () {
        scene.render();
    });
};

const createScene = function() {

    scene = new BABYLON.Scene(engine);
    scene.enablePhysics(new BABYLON.Vector3(0, -9.8, 0), new BABYLON.CannonJSPlugin());
    scene.getPhysicsEngine().setTimeStep(scene.getAnimationRatio());

    const camera = new BABYLON.ArcRotateCamera("Camera", 0, 0, 10, new BABYLON.Vector3(0, 0, 0), scene);
    camera.minZ /= 100; // TODO: If near is 1, the model is missing, so adjusted
    camera.setPosition(new BABYLON.Vector3(0, 20 * PHYSICS_SCALE, -200 * PHYSICS_SCALE));
    camera.attachControl(canvas);

    new BABYLON.HemisphericLight("hemi", new BABYLON.Vector3(0, 1, 0), scene);
    new BABYLON.DirectionalLight("dir01", new BABYLON.Vector3(0.0, -1.0, 0.5), scene);

    const mat = new BABYLON.StandardMaterial("ground", scene);
    const t = new BABYLON.Texture("../../../../assets/textures/grass.jpg", scene); // grass.jpg

    t.uScale = t.vScale = 2;
    mat.diffuseTexture = t;
    mat.specularColor = BABYLON.Color3.Black();
    const g = BABYLON.Mesh.CreateBox("ground", 400 * PHYSICS_SCALE, scene);
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
    const randomNumber = function(min, max) {
        if (min == max) {
            return (min);
        }
        const random = Math.random();
        return ((random * (max - min)) + min);
    };

    const objects = [];
    const getPosition = function(y) {
        return new BABYLON.Vector3(randomNumber(-25, 25) * PHYSICS_SCALE, (randomNumber(0, 100) + y) * PHYSICS_SCALE, randomNumber(-25, 25) * PHYSICS_SCALE);
    };
    const max = 300;

    for (let i = 0; i < 20; i++) {
        const stair = BABYLON.Mesh.CreateBox("stair", 100 * PHYSICS_SCALE, scene);
        stair.position.x = (i * -10) * PHYSICS_SCALE;
        stair.position.y = (i * 5 - 10) * PHYSICS_SCALE;
        stair.scaling.x = 0.1;
        stair.scaling.y = 0.1;
        //stair.setPhysicsState({ impostor: BABYLON.PhysicsEngine.BoxImpostor, move:false, mass: 0, friction: 1.0, restitution: 1.0 });
        stair.physicsImpostor = new BABYLON.PhysicsImpostor(stair, BABYLON.PhysicsImpostor.BoxImpostor, { mass: 0, friction: 1.0, restitution: 1.0 }, scene);
    }

    const matEraser = new BABYLON.StandardMaterial("material", scene);
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

        const scale = 1;
        const s = BABYLON.Mesh.CreateBox("s", 15 * PHYSICS_SCALE, scene);
        // 消しゴムのサイズとなるよう調整
        s.scaling.x = 1.0;
        s.scaling.y = 0.2;
        s.scaling.z = 0.5;
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
                obj.position = getPosition(200);
                obj.physicsImpostor.setLinearVelocity(new BABYLON.Vector3(0,0,0));
            }
        });
        scene.activeCamera.alpha += Math.PI * 1.0 / 180.0 * scene.getAnimationRatio();
    });

    return scene;
};

init();
