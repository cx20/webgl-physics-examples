// Demo scene driving gltf-physics-exporter.js.
// Floor (static) + falling cube (dynamic). Click "Export .glb" to download a
// .glb with KHR_physics_rigid_bodies + KHR_implicit_shapes; the file
// round-trips through the loader used by the gltf_physics_* samples here.

const HAVOK_WASM_URL = 'https://cx20.github.io/gltf-test/libs/babylonjs/dev/HavokPhysics.wasm';
const PHYSICS_SCALE = 1 / 10;

let engine;
let scene;
let canvas;

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
    engine = new BABYLON.Engine(canvas, true);
    scene = createScene();

    // Capture initial pose before physics moves anything, so a later Export
    // ships the scene's initial setup instead of the cube's mid-fall state.
    BABYLON.GLTFPhysicsExport.snapshot(scene);

    engine.runRenderLoop(function () {
        scene.render();
    });

    const exportBtn = document.getElementById('exportBtn');
    const status = document.getElementById('status');
    exportBtn.addEventListener('click', async function () {
        exportBtn.disabled = true;
        status.textContent = 'Exporting...';
        try {
            await BABYLON.GLTFPhysicsExport.GLBAsync(scene, 'minimum_physics');
            status.textContent = 'Exported minimum_physics.glb';
        } catch (err) {
            console.error(err);
            status.textContent = 'Export failed: ' + err.message;
        } finally {
            exportBtn.disabled = false;
        }
    });
}

function createScene() {
    scene = new BABYLON.Scene(engine);
    scene.clearColor = new BABYLON.Color3(1, 1, 1);

    const hk = new BABYLON.HavokPlugin();
    scene.enablePhysics(new BABYLON.Vector3(0, -9.8, 0), hk);
    scene.getPhysicsEngine().setTimeStep(scene.getAnimationRatio());

    const camera = new BABYLON.ArcRotateCamera('Camera', 0, 0, 10, new BABYLON.Vector3(0, 0, 0), scene);
    camera.setPosition(new BABYLON.Vector3(0, 20 * PHYSICS_SCALE, -200 * PHYSICS_SCALE));
    camera.attachControl(canvas, true);

    // Lights are only added for the preview canvas — the loader side supplies its own
    // lighting, so gltf-physics-exporter.js excludes them from the .glb.
    const hemiLight = new BABYLON.HemisphericLight('hemiLight', new BABYLON.Vector3(0, 1, 0), scene);
    hemiLight.intensity = 0.9;
    const dirLight = new BABYLON.DirectionalLight('dirLight', new BABYLON.Vector3(-0.4, -1.0, -0.3), scene);
    dirLight.position = new BABYLON.Vector3(12, 16, 10);
    dirLight.intensity = 0.6;

    const material = new BABYLON.StandardMaterial('material', scene);
    material.diffuseTexture = new BABYLON.Texture('../../../../assets/textures/frog.jpg', scene);

    const ground = BABYLON.MeshBuilder.CreateBox('ground', {
        width: 200 * PHYSICS_SCALE, height: 0.1, depth: 200 * PHYSICS_SCALE
    }, scene);
    ground.material = material;
    ground.position.y = -20 * PHYSICS_SCALE;
    ground.aggregate = new BABYLON.PhysicsAggregate(
        ground, BABYLON.PhysicsShapeType.BOX,
        { mass: 0, friction: 0.1, restitution: 0.1 }, scene);

    const cube = BABYLON.MeshBuilder.CreateBox('cube', { size: 50 * PHYSICS_SCALE }, scene);
    cube.material = material;
    cube.position.y = 100 * PHYSICS_SCALE;
    cube.rotation.x = Math.PI * 10 / 180;
    cube.rotation.z = Math.PI * 10 / 180;
    cube.aggregate = new BABYLON.PhysicsAggregate(
        cube, BABYLON.PhysicsShapeType.BOX,
        { mass: 1, friction: 0.2, restitution: 0.5 }, scene);

    scene.registerBeforeRender(function () {
        scene.activeCamera.alpha += Math.PI * 1.0 / 180.0 * scene.getAnimationRatio();
    });

    return scene;
}

init();
