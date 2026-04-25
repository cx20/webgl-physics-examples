const HAVOK_WASM_URL = 'https://cx20.github.io/gltf-test/libs/babylonjs/dev/HavokPhysics.wasm';
let engine;
let scene;
let canvas;
let rigidBodyLoaderPromise;
let physicsExtensionsRegistered = false;

const MODEL_ROOT = 'https://raw.githubusercontent.com/eoineoineoin/glTF_Physics/master/samples/Materials_Restitution/';
const MODEL_FILE = 'Materials_Restitution.glb';

function ensureRigidBodyLoader() {
    if (window.GLTFRigidBodyLoader) {
        return Promise.resolve();
    }

    if (!rigidBodyLoaderPromise) {
        rigidBodyLoaderPromise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cx20.github.io/gltf-test/libs/babylonjs/dev/babylon-gltf-rigid-body-loader.js';
            script.onload = resolve;
            script.onerror = () => reject(new Error('Failed to load babylon-gltf-rigid-body-loader.'));
            document.head.appendChild(script);
        });
    }

    return rigidBodyLoaderPromise;
}

function registerPhysicsExtensions() {
    if (physicsExtensionsRegistered) {
        return;
    }

    BABYLON.GLTF2.GLTFLoader.RegisterExtension('KHR_implicit_shapes', function (loader) {
        return new GLTFRigidBodyLoader.KHR_ImplicitShapes_Plugin(loader);
    });

    BABYLON.GLTF2.GLTFLoader.RegisterExtension('KHR_physics_rigid_bodies', function (loader) {
        return new GLTFRigidBodyLoader.KHR_PhysicsRigidBodies_Plugin(loader);
    });

    physicsExtensionsRegistered = true;
}

async function init() {
    canvas = document.querySelector('#c');
    globalThis.HK = await HavokPhysics({
        locateFile: function (path) {
            if (path && path.endsWith('.wasm')) {
                return HAVOK_WASM_URL;
            }
            return path;
        }
    });
    await ensureRigidBodyLoader();
    registerPhysicsExtensions();

    engine = new BABYLON.Engine(canvas, true);
    scene = await createScene();

    engine.runRenderLoop(function () {
        scene.render();
    });

    window.addEventListener('resize', function () {
        engine.resize();
    });
}

async function createScene() {
    const scene = new BABYLON.Scene(engine);
    scene.clearColor = new BABYLON.Color4(0.97, 0.97, 0.98, 1.0);

    const hk = new BABYLON.HavokPlugin();
    scene.enablePhysics(new BABYLON.Vector3(0, -9.8, 0), hk);

    const camera = new BABYLON.ArcRotateCamera('camera', Math.PI / 2, Math.PI / 3, 5.5, new BABYLON.Vector3(0, 0, 0), scene);
    camera.attachControl(canvas, true);
    camera.wheelDeltaPercentage = 0.005;
    camera.lowerRadiusLimit = 2;
    camera.upperRadiusLimit = 40;

    const hemiLight = new BABYLON.HemisphericLight('hemiLight', new BABYLON.Vector3(0, 1, 0), scene);
    hemiLight.intensity = 0.9;

    const dirLight = new BABYLON.DirectionalLight('dirLight', new BABYLON.Vector3(-0.4, -1.0, -0.3), scene);
    dirLight.position = new BABYLON.Vector3(8, 12, 8);
    dirLight.intensity = 0.8;

    await BABYLON.SceneLoader.AppendAsync(MODEL_ROOT, MODEL_FILE, scene);

    const allMeshes = scene.meshes.filter(function (mesh) {
        return mesh && mesh.name !== '__root__' && mesh.getTotalVertices && mesh.getTotalVertices() > 0;
    });

    if (allMeshes.length > 0) {
        const shadowGenerator = new BABYLON.ShadowGenerator(1024, dirLight);
        shadowGenerator.useBlurExponentialShadowMap = true;
        shadowGenerator.blurKernel = 16;

        allMeshes.forEach(function (mesh) {
            shadowGenerator.addShadowCaster(mesh, true);
            mesh.receiveShadows = true;
        });

        const bounds = allMeshes.reduce(function (acc, mesh) {
            const info = mesh.getHierarchyBoundingVectors(true);
            acc.min.minimizeInPlace(info.min);
            acc.max.maximizeInPlace(info.max);
            return acc;
        }, {
            min: new BABYLON.Vector3(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY),
            max: new BABYLON.Vector3(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY)
        });

        const center = BABYLON.Vector3.Center(bounds.min, bounds.max);
        const radius = BABYLON.Vector3.Distance(bounds.min, bounds.max) * 0.38;
        camera.setTarget(center);
        camera.radius = Math.max(radius, 4.8);
    }

    scene.registerBeforeRender(function () {
        camera.alpha += 0.0015 * scene.getAnimationRatio();
    });

    return scene;
}

init().catch(function (error) {
    console.error(error);
});
