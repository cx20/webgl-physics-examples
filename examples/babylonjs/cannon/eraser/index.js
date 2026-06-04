let engine;
let scene;
let canvas;
// to go quicker
const v3 = BABYLON.Vector3;
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

    scene = new BABYLON.Scene(engine);
    scene.enablePhysics(new BABYLON.Vector3(0, -9.8, 0), new BABYLON.CannonJSPlugin());
    setupPhysicsDebugWireframe(scene);
    scene.getPhysicsEngine().setTimeStep(scene.getAnimationRatio());

    // Fixed head-on camera matching the WebGL/WebGPU + Havok eraser samples (eye at (0,0,40)
    // looking at the origin, 45 deg FOV).
    const camera = new BABYLON.ArcRotateCamera("Camera", -Math.PI / 2, Math.PI / 2, 40, new BABYLON.Vector3(0, 0, 0), scene);
    camera.setPosition(new BABYLON.Vector3(0, 0, 40));
    camera.setTarget(BABYLON.Vector3.Zero());
    camera.fov = 45 * Math.PI / 180;
    camera.minZ = 0.1;
    camera.maxZ = 1000;
    camera.attachControl(canvas);

    new BABYLON.HemisphericLight("hemi", new BABYLON.Vector3(0, 1, 0), scene);
    new BABYLON.DirectionalLight("dir01", new BABYLON.Vector3(0.0, -1.0, 0.5), scene);

    const mat = new BABYLON.StandardMaterial("ground", scene);
    const t = new BABYLON.Texture("../../../../assets/textures/grass.jpg", scene); // grass.jpg

    t.uScale = t.vScale = 2;
    mat.diffuseTexture = t;
    mat.specularColor = BABYLON.Color3.Black();
    // Small low floor (no walls/stairs), matching the other eraser samples: a 20 x 0.1 x 20 slab
    // at y = -10 that the heap overflows.
    const g = BABYLON.MeshBuilder.CreateBox("ground", { width: 20, height: 0.1, depth: 20 }, scene);
    g.position.y = -10;
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
    const getPosition = function() {
        return new BABYLON.Vector3(randomNumber(-6, 6), randomNumber(14, 28), randomNumber(-6, 6));
    };
    const max = 200;

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

        const s = BABYLON.MeshBuilder.CreateBox("s", { width: 2.4, height: 0.6, depth: 1.2 }, scene);
        s.position = getPosition();
        s.rotationQuaternion = BABYLON.Quaternion.RotationYawPitchRoll(
            randomNumber(0, Math.PI * 2), randomNumber(0, Math.PI * 2), randomNumber(0, Math.PI * 2));
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
            if (obj.position.y < -15) {
                obj.position = getPosition();
                obj.physicsImpostor.setLinearVelocity(new BABYLON.Vector3(0,0,0));
            }
        });
    });

    return scene;
};

init();
