const HAVOK_WASM_URL = 'https://cx20.github.io/gltf-test/libs/babylonjs/dev/HavokPhysics.wasm';
let engine;
let scene;
let canvas;
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

    engine.runRenderLoop(function () {
        scene.render();
    });
}

const createScene = function() {
    scene = new BABYLON.Scene(engine);

    // Pull back and aim at the mid-fall height so the whole drop (and the duck's tumble) is in
    // frame, like the WebGL/WebGPU samples. With the old radius 10 / target (0,0,0) the duck fell
    // in from above the view and only appeared near the ground, already rotated, so it looked
    // like it dropped straight down at a fixed angle.
    const camera = new BABYLON.ArcRotateCamera("Camera", -Math.PI / 2, Math.PI/3, 18, new BABYLON.Vector3(0, 5, 0), scene);
    camera.attachControl(canvas);

    const importPromise = BABYLON.SceneLoader.ImportMeshAsync(null, "https://rawcdn.githack.com/cx20/gltf-test/1f6515ce/sampleModels/Duck/glTF/", "Duck.gltf", scene);
    importPromise.then(function (result) {
    scene.enablePhysics(new BABYLON.Vector3(0, -9.8, 0), new BABYLON.HavokPlugin());
    setupPhysicsDebugWireframe(scene);
        scene.getPhysicsEngine().setTimeStep(1 / 30);
        
        scene.forceShowBoundingBoxes = true;

        var light = new BABYLON.HemisphericLight("light", new BABYLON.Vector3(0, 1, 0), scene);
        light.intensity = 0.7;

        const material = new BABYLON.StandardMaterial("material", scene);
        const ground = BABYLON.MeshBuilder.CreateGround('ground', {width: 20, height: 20, depth: 1}, scene);
        ground.position.y = 0;
        //ground.material = material;
        ground.aggregate = new BABYLON.PhysicsAggregate(ground, BABYLON.PhysicsShapeType.BOX, {mass: 0, friction: 0.5, restitution: 0.0}, scene);
        
        const mesh = result.meshes[0];
        mesh.position.y = 10;

        const meshParent = BABYLON.MeshBuilder.CreateBox("center", {width: 1.5, height: 1.5, depth: 1.0}, scene);
        meshParent.isVisible = false;
        const boundingInfo = mesh.getHierarchyBoundingVectors();
        const center = BABYLON.Vector3.Center(boundingInfo.min, boundingInfo.max);
        meshParent.position = center;
        mesh.setParent(meshParent);

        // Start with a slight tilt like the WebGL/WebGPU samples (euler 8,0,10 deg) so the tumble
        // begins off-axis.
        meshParent.rotationQuaternion = BABYLON.Quaternion.FromEulerAngles(8 * Math.PI / 180, 0, 10 * Math.PI / 180);

        // Friction 0.5 (and restitution 0) so the duck tumbles, then settles upright on the ground
        // instead of sliding to a stop on its side, matching the WebGL/WebGPU Havok samples.
        meshParent.aggregate = new BABYLON.PhysicsAggregate(meshParent, BABYLON.PhysicsShapeType.BOX, {mass: 1, friction: 0.5, restitution: 0.0}, scene);

        // Spin the duck as it falls. angVel 4.5 lands it upright after the tumble from this drop
        // height (the WebGL samples use 3.5 but fall a longer distance); the value was tuned so the
        // duck settles sitting upright like those samples.
        meshParent.aggregate.body.setAngularVelocity(new BABYLON.Vector3(0, 0, 4.5));

        scene.registerBeforeRender(function() {
            scene.activeCamera.alpha += Math.PI * 1.0 / 180.0 * scene.getAnimationRatio();
        });
    
        window.addEventListener("click", function () {
            const pickResult = scene.pick(scene.pointerX, scene.pointerY);
            meshParent.aggregate.body.setLinearVelocity(new BABYLON.Vector3(0,10,0));
        })
    });
        
    return scene;
}

init();
