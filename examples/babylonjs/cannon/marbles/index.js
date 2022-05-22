let engine;
let scene;
let canvas;

const BASE_URL = "https://cx20.github.io/gltf-test";
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
    const scene = new BABYLON.Scene(engine);
    scene.enablePhysics(new BABYLON.Vector3(0, -9.8, 0), new BABYLON.CannonJSPlugin());

    const camera = new BABYLON.ArcRotateCamera("camera", 0, Math.PI/180 * 60, 30, BABYLON.Vector3.Zero(), scene);
    camera.setTarget(BABYLON.Vector3.Zero());
    camera.attachControl(canvas, true);

    const cubeTexture = new BABYLON.CubeTexture(BASE_URL + "/textures/env/papermillSpecularHDR.env", scene);
    const currentSkybox = scene.createDefaultSkybox(cubeTexture, true);
    const light1 = new BABYLON.HemisphericLight("light1", new BABYLON.Vector3(1, 1, 0), scene); 

    const light2 = new BABYLON.DirectionalLight("light2", new BABYLON.Vector3(0, 1, 0), scene);
    light2.position = new BABYLON.Vector3(4, 4, 0);
    light2.setDirectionToTarget(BABYLON.Vector3.Zero());
    light2.intensity = 3;
    const shadow = new BABYLON.ShadowGenerator(1024, light2);

    const matGround = new BABYLON.PBRMetallicRoughnessMaterial("ground", scene);
    const texture = new BABYLON.Texture("../../../../assets/textures/grass.jpg", scene);
    texture.uScale = texture.vScale = 2;
    matGround.baseTexture = texture;

    const ground = BABYLON.Mesh.CreateBox("ground", 400 * PHYSICS_SCALE, scene);
    ground.position.y = -15 * PHYSICS_SCALE;
    ground.scaling.y = 0.01;
    ground.material = matGround;
    ground.physicsImpostor = new BABYLON.PhysicsImpostor(ground, BABYLON.PhysicsImpostor.BoxImpostor, { mass: 0, friction: 0.4, restitution: 0.2 }, scene);
    
    ground.receiveShadows = true;

    let labels = [];
    let meshes = [];

    Promise.all([
        BABYLON.SceneLoader.ImportMeshAsync(null, BASE_URL + "/tutorialModels/IridescenceMetallicSpheres/glTF/", "IridescenceMetallicSpheres.gltf", scene).then(function(result) {
            labels = result.meshes.filter(label => {
                if(label.name.lastIndexOf('Plane')!== -1) {
                    return label;
                }
            });

            meshes = result.meshes.filter(mesh => {
                if(mesh.name.indexOf('Sphere')!== -1) {
                    shadow.addShadowCaster(mesh, true);
                    return mesh;
                }
            });
        }),
    ]).then(() => {
        labels.forEach((label) => {
            label.isVisible = false;
        });

        const randomNumber = (min, max) => {
            if (min == max) {
                return (min);
            }
            const random = Math.random();
            return ((random * (max - min)) + min);
        };

        const getNextPosition = (y) => {
            return new BABYLON.Vector3((randomNumber(-100,100) * PHYSICS_SCALE), (randomNumber(0, 200) + y) * PHYSICS_SCALE, (randomNumber(-100, 100) * PHYSICS_SCALE));
        };

        meshes.forEach((mesh) => {
            mesh.parent = null;
            mesh.physicsImpostor = new BABYLON.PhysicsImpostor(mesh, BABYLON.PhysicsImpostor.SphereImpostor, { mass: 1, friction:0.4, restitution:0.8 }, scene);
        });

        scene.onBeforeRenderObservable.add(() => {
            meshes.forEach((mesh) => {
                if (mesh.position.y < -100 * PHYSICS_SCALE) {
                    mesh.position = getNextPosition(200);
                    mesh.physicsImpostor.setLinearVelocity(new BABYLON.Vector3(0,0,0));
                    mesh.physicsImpostor.setAngularVelocity(new BABYLON.Vector3(0,0,0));
                }
            });
            scene.activeCamera.alpha -= 0.005 * scene.getAnimationRatio();
        });
    });

    return scene;
};

init();
