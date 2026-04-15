let engine;
let scene;
let canvas;

const CONE_COUNT = 120;
const SCALE = 1 / 50;

async function init() {
    canvas = document.querySelector("#c");
    globalThis.HK = await HavokPhysics();

    engine = new BABYLON.Engine(canvas, true);
    globalThis.engine = engine;

    scene = createScene();
    globalThis.scene = scene;

    engine.runRenderLoop(function() {
        scene.render();
    });

    window.addEventListener('resize', function() {
        engine.resize();
    });
}

function createScene() {
    const scene = new BABYLON.Scene(engine);
    scene.enablePhysics(new BABYLON.Vector3(0, -9.8, 0), new BABYLON.HavokPlugin());
    scene.clearColor = new BABYLON.Color4(0.24, 0.25, 0.28, 1.0);

    const camera = new BABYLON.ArcRotateCamera(
        "camera",
        -Math.PI / 6,
        Math.PI / 3,
        16,
        new BABYLON.Vector3(1.5, 1.0, 0),
        scene
    );
    camera.attachControl(canvas, true);
    camera.lowerRadiusLimit = 4;
    camera.upperRadiusLimit = 50;

    const hemiLight = new BABYLON.HemisphericLight("hemi", new BABYLON.Vector3(1, 1, 0), scene);
    hemiLight.intensity = 0.8;

    const dirLight = new BABYLON.DirectionalLight("dir", new BABYLON.Vector3(-0.4, -1.0, -0.3), scene);
    dirLight.position = new BABYLON.Vector3(5, 20, 10);
    dirLight.intensity = 1.2;

    const shadow = new BABYLON.ShadowGenerator(1024, dirLight);
    shadow.usePercentageCloserFiltering = true;
    shadow.bias = 0.0005;
    shadow.normalBias = 0.02;

    const coneTex = new BABYLON.Texture("../../../../assets/textures/carrot.jpg", scene);
    const coneMat = new BABYLON.StandardMaterial("coneMat", scene);
    coneMat.diffuseTexture = coneTex;
    coneMat.backFaceCulling = false;

    const groundMat = new BABYLON.StandardMaterial("groundMat", scene);
    groundMat.diffuseColor = new BABYLON.Color3(0.24, 0.25, 0.28);
    groundMat.specularColor = BABYLON.Color3.Black();

    const rampMat = new BABYLON.StandardMaterial("rampMat", scene);
    rampMat.diffuseColor = new BABYLON.Color3(0.3, 0.32, 0.37);
    rampMat.alpha = 0.6;

    // Ground: 400x40x400 at [0,-20,0] scaled by 1/50 = 8x0.8x8 at [0,-0.4,0]
    const ground = BABYLON.MeshBuilder.CreateBox("ground", {
        width: 400 * SCALE,
        height: 40 * SCALE,
        depth: 400 * SCALE
    }, scene);
    ground.position.y = -20 * SCALE;
    ground.material = groundMat;
    ground.receiveShadows = true;
    ground.aggregate = new BABYLON.PhysicsAggregate(
        ground,
        BABYLON.PhysicsShapeType.BOX,
        { mass: 0, friction: 0.5, restitution: 0.1 },
        scene
    );

    // Ramp: 200x30x390 at [130,40,0] rot z=32°, scaled by 1/50 = 4x0.6x7.8 at [2.6,0.8,0]
    const ramp = BABYLON.MeshBuilder.CreateBox("ramp", {
        width: 200 * SCALE,
        height: 30 * SCALE,
        depth: 390 * SCALE
    }, scene);
    ramp.position.set(130 * SCALE, 40 * SCALE, 0);
    ramp.rotation.z = 32 * Math.PI / 180;
    ramp.material = rampMat;
    ramp.receiveShadows = true;
    ramp.aggregate = new BABYLON.PhysicsAggregate(
        ramp,
        BABYLON.PhysicsShapeType.BOX,
        { mass: 0, friction: 0.5, restitution: 0.1 },
        scene
    );

    // Base cone mesh (invisible, used as clone template)
    // Scaled from three.js: radiusTop=2.5, radiusBottom=12.5, height=50
    // After 1/50 scale: diameterTop=0.1, diameterBottom=0.5, height=1.0
    const baseCone = BABYLON.MeshBuilder.CreateCylinder("baseCone", {
        diameterTop: 2 * 2.5 * SCALE,
        diameterBottom: 2 * 12.5 * SCALE,
        height: 50 * SCALE,
        tessellation: 30
    }, scene);
    baseCone.material = coneMat;
    baseCone.isVisible = false;

    const cones = [];

    for (let i = 0; i < CONE_COUNT; i++) {
        const mesh = baseCone.clone("cone" + i);
        const x = 150 * SCALE;
        const z = (-100 + Math.random() * 200) * SCALE;
        const y = (100 + Math.random() * 1000) * SCALE;

        mesh.position.set(x, y, z);
        mesh.rotationQuaternion = BABYLON.Quaternion.RotationYawPitchRoll(
            Math.random() * Math.PI * 2,
            Math.random() * Math.PI * 2,
            Math.random() * Math.PI * 2
        );
        mesh.isVisible = true;
        mesh.receiveShadows = true;
        shadow.addShadowCaster(mesh, true);

        const agg = new BABYLON.PhysicsAggregate(
            mesh,
            BABYLON.PhysicsShapeType.CONVEX_HULL,
            { mass: 1, friction: 0.4, restitution: 0.2 },
            scene
        );

        cones.push({ mesh, agg });
    }

    scene.onBeforeRenderObservable.add(() => {
        for (const cone of cones) {
            if (cone.mesh.position.y < -100 * SCALE) {
                const x = 150 * SCALE;
                const z = (-100 + Math.random() * 200) * SCALE;
                const y = (100 + Math.random() * 1000) * SCALE;

                const body = cone.agg.body;
                body.disablePreStep = false;
                body.transformNode.position.set(x, y, z);
                body.transformNode.rotationQuaternion = BABYLON.Quaternion.RotationYawPitchRoll(
                    Math.random() * Math.PI * 2,
                    Math.random() * Math.PI * 2,
                    Math.random() * Math.PI * 2
                );
                body.setLinearVelocity(BABYLON.Vector3.Zero());
                body.setAngularVelocity(BABYLON.Vector3.Zero());
            }
        }

        camera.alpha -= 0.003 * scene.getAnimationRatio();
    });

    return scene;
}

init();
