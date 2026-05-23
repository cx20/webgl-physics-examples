let engine;
let scene;
let canvas;

const BASE_URL = "https://cx20.github.io/gltf-test";
const PHYSICS_SCALE = 1/10;
let showWireframe = true;
let physicsViewer = null;
const trackedBodies = [];
const trackedImpostors = [];

function setupPhysicsDebugWireframe(scene) {
    if (!BABYLON.Debug || !BABYLON.Debug.PhysicsViewer) {
        return;
    }

    physicsViewer = new BABYLON.Debug.PhysicsViewer(scene);
    const seenImpostors = new WeakSet();
    const seenBodies = new WeakSet();

    scene.registerBeforeRender(function () {
        scene.meshes.forEach(function (mesh) {
            if (!mesh) {
                return;
            }

            if (mesh.physicsImpostor && !seenImpostors.has(mesh.physicsImpostor) && physicsViewer.showImpostor) {
                seenImpostors.add(mesh.physicsImpostor);
                trackedImpostors.push({ impostor: mesh.physicsImpostor, mesh: mesh });
                if (showWireframe) {
                    physicsViewer.showImpostor(mesh.physicsImpostor, mesh);
                }
            }

            if (mesh.physicsBody && !seenBodies.has(mesh.physicsBody) && physicsViewer.showBody) {
                seenBodies.add(mesh.physicsBody);
                trackedBodies.push(mesh.physicsBody);
                if (showWireframe) {
                    physicsViewer.showBody(mesh.physicsBody);
                }
            }
        });
    });
}

function setWireframeVisible(visible) {
    if (showWireframe === visible) {
        return;
    }
    showWireframe = visible;
    if (physicsViewer) {
        if (visible) {
            for (const body of trackedBodies) {
                physicsViewer.showBody(body);
            }
            for (const entry of trackedImpostors) {
                physicsViewer.showImpostor(entry.impostor, entry.mesh);
            }
        } else {
            for (const body of trackedBodies) {
                physicsViewer.hideBody(body);
            }
            for (const entry of trackedImpostors) {
                physicsViewer.hideImpostor(entry.impostor);
            }
        }
    }
    const hint = document.getElementById('hint');
    if (hint) {
        hint.textContent = 'W: wireframe ' + (visible ? 'ON' : 'OFF');
    }
}

window.addEventListener('keydown', function (e) {
    if (e.repeat) {
        return;
    }
    if (e.code === 'KeyW' || e.key === 'w' || e.key === 'W') {
        setWireframeVisible(!showWireframe);
    }
});
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
    scene.enablePhysics(new BABYLON.Vector3(0, -9.8, 0), new BABYLON.OimoJSPlugin());
    setupPhysicsDebugWireframe(scene);
    const camera = new BABYLON.ArcRotateCamera("camera", 0, Math.PI/180 * 60, 30, BABYLON.Vector3.Zero(), scene);
    camera.setTarget(BABYLON.Vector3.Zero());
    camera.attachControl(canvas, true);

    const camera1 = camera;
    const camera2 = new BABYLON.ArcRotateCamera("camera", 0, 1, 10, BABYLON.Vector3.Zero(), scene);
    const camera3 = new BABYLON.ArcRotateCamera("camera", 0, 1, 10, BABYLON.Vector3.Zero(), scene);
    camera1.viewport = new BABYLON.Viewport(0.4, 0.0, 0.6, 1.0);
    camera2.viewport = new BABYLON.Viewport(0.0, 0.0, 0.4, 0.5);
    camera3.viewport = new BABYLON.Viewport(0.0, 0.5, 0.4, 0.5);
    scene.activeCameras.push(camera1);
    scene.activeCameras.push(camera2);
    scene.activeCameras.push(camera3);

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
    ground.physicsImpostor = new BABYLON.PhysicsImpostor(ground, BABYLON.PhysicsImpostor.BoxImpostor, { mass: 0, friction: 0.2, restitution: 0.3 }, scene);
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
                    mesh.position.x += Math.random();
                    mesh.position.z += Math.random();
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
            return new BABYLON.Vector3((randomNumber(-50, 50) * PHYSICS_SCALE), (randomNumber(0, 200) + y) * PHYSICS_SCALE, (randomNumber(-50, 50) * PHYSICS_SCALE));
        };

        meshes.forEach((mesh) => {
            mesh.parent = null;
            mesh.physicsImpostor = new BABYLON.PhysicsImpostor(mesh, BABYLON.PhysicsImpostor.SphereImpostor, { mass: 1, friction:0.1, restitution:0.3 }, scene);
        });

        const cameraTarget = meshes[0];
        cameraTarget.showBoundingBox = true;
        camera2.parent = cameraTarget;

        scene.onBeforeRenderObservable.add(() => {
            meshes.forEach((mesh) => {
                if (mesh.position.y < -100 * PHYSICS_SCALE) {
                    mesh.position = getNextPosition(200);
                    mesh.physicsImpostor.setLinearVelocity(new BABYLON.Vector3(0,0,0));
                    mesh.physicsImpostor.setAngularVelocity(new BABYLON.Vector3(0,0,0));
                }
            });
            camera1.alpha -= 0.005 * scene.getAnimationRatio();
            camera3.setPosition(cameraTarget.position);
         });
    });

    return scene;
};

init();
