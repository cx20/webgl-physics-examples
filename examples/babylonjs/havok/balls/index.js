let engine;
let scene;
let canvas;
const PHYSICS_SCALE = 1/100;

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
    scene.enablePhysics(new BABYLON.Vector3(0, -9.8, 0), new BABYLON.HavokPlugin());
    scene.getPhysicsEngine().setTimeStep(scene.getAnimationRatio());

    const camera = new BABYLON.ArcRotateCamera("Camera", 0.86, 1.37, 250, BABYLON.Vector3.Zero(), scene);
    camera.minZ /= 100; // TODO: If near is 1, the model is missing, so adjusted
    camera.setPosition(new BABYLON.Vector3(0, 20 * PHYSICS_SCALE, -200 * PHYSICS_SCALE));
    camera.attachControl(canvas, true);

    const mat = new BABYLON.StandardMaterial("ground", scene);
    const t = new BABYLON.Texture("../../../../assets/textures/grass.jpg", scene); // grass.jpg
    
    t.uScale = t.vScale = 2;
    mat.diffuseTexture = t;
    mat.specularColor = BABYLON.Color3.Black();
    const g = BABYLON.Mesh.CreateBox("ground", 200 * PHYSICS_SCALE, scene);
    g.position.y = -15 * PHYSICS_SCALE;
    g.scaling.y = 0.01;
    g.material = mat;
    g.aggregate = new BABYLON.PhysicsAggregate(g, BABYLON.PhysicsShapeType.BOX, { mass: 0, friction: 0.4, restitution: 0.6 }, scene);

    // light
    const light1 = new BABYLON.DirectionalLight("dir01", new BABYLON.Vector3(0.2, -1.0, 0.2), scene);
    const light2 = new BABYLON.DirectionalLight("dir02", new BABYLON.Vector3(-0.5, -0.5, -0.5), scene);    
    light1.intensity = 0.2;
    light2.intensity = 1.0;

    const matBoard = new BABYLON.StandardMaterial("board", scene);
    matBoard.emissiveColor = new BABYLON.Color3(0.5, 0.5, 0.5);
    matBoard.alpha = 0.5;
    for (let i = 0; i < 4; i++) {
        const board = BABYLON.Mesh.CreateBox("ground", 50 * PHYSICS_SCALE, scene);
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
        board.aggregate = new BABYLON.PhysicsAggregate(board, BABYLON.PhysicsShapeType.BOX, { mass: 0, friction: 0.4, restitution: 0.6 }, scene);
    }

    // Get a random number between two limits
    const randomNumber = function (min, max) {
        if (min == max) {
            return (min);
        }
        const random = Math.random();
        return ((random * (max - min)) + min);
    };

    let y = 50;
    const objects = [];
    const max = 150;

    // Creates arandom position above the ground
    const getPosition = function(y) {
        return new BABYLON.Vector3((randomNumber(-25,25) * PHYSICS_SCALE), (randomNumber(0, 100) + y) * PHYSICS_SCALE, (randomNumber(-25, 25) * PHYSICS_SCALE));
    };
    const dataSet = [
        {imageFile:"../../../../assets/textures/Basketball.jpg", scale:1.0}, // Basketball.jpg
        {imageFile:"../../../../assets/textures/BeachBall.jpg",  scale:0.9}, // BeachBall.jpg
        {imageFile:"../../../../assets/textures/Football.jpg",   scale:1.0}, // Football.jpg
        {imageFile:"../../../../assets/textures/Softball.jpg",   scale:0.3}, // Softball.jpg
        {imageFile:"../../../../assets/textures/TennisBall.jpg", scale:0.3}, // TennisBall.jpg
    ];

    const matSphere = [];
    for (let i = 0; i < dataSet.length; i++) {
        const imageFile = dataSet[i].imageFile;
        matSphere[i] = new BABYLON.StandardMaterial("boxmat", scene);
        matSphere[i].diffuseTexture = new BABYLON.Texture(imageFile, scene); // Football.png
        matSphere[i].specularColor = BABYLON.Color3.Black();
    }
    const shadowGenerator = new BABYLON.ShadowGenerator(1024, light1);
    
    // Creates
    for (let index = 0; index < max; index++) {

        const pos = Math.floor(Math.random() * dataSet.length);
        const scale = dataSet[pos].scale;
        const s = BABYLON.MeshBuilder.CreateSphere("s", {diameter:15 * scale * PHYSICS_SCALE, segments:30}, scene);
        s.position = getPosition(y);
        s.material = matSphere[pos];
        s.aggregate = new BABYLON.PhysicsAggregate(s, BABYLON.PhysicsShapeType.SPHERE, { mass: 1, friction:0.4, restitution:0.8 }, scene);

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
                //obj.aggregate.body.setLinearVelocity(new BABYLON.Vector3(0,0,0));
                //obj.aggregate.body.setAngularVelocity(new BABYLON.Vector3(0,0,0));
                obj.aggregate = new BABYLON.PhysicsAggregate(obj, BABYLON.PhysicsShapeType.SPHERE, { mass: 1, friction:0.4, restitution:0.8 }, scene);
            }
        });
        scene.activeCamera.alpha += Math.PI * 1.0 / 180.0 * scene.getAnimationRatio();
    });

    return scene;
};

init();
