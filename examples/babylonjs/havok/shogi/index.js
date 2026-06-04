const HAVOK_WASM_URL = 'https://cx20.github.io/gltf-test/libs/babylonjs/dev/HavokPhysics.wasm';
let engine;
let scene;
let canvas;

// Modelled in the same world units as the WebGL/WebGPU + Havok shogi samples (no scaling) and
// with the same parameters, so the scenes can be compared side by side.
const PIECE_COUNT = 300;
// Full box-collider extents, identical to the other Havok shogi samples' shape sizes.
const SHOGI_PHYSICS_SIZE = [1.6, 1.92, 0.448];
const GROUND_PHYSICS_SIZE = [13, 0.1, 13];

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
    globalThis.engine = engine;

    scene = createScene();
    globalThis.scene = scene;

    engine.runRenderLoop(function() {
        scene.render();
    });
}

function createShogiVertexData(w, h, d) {
    const positions = [
        // Front face
        -0.5 * w, -0.5 * h, 0.7 * d,
         0.5 * w, -0.5 * h, 0.7 * d,
         0.35 * w, 0.5 * h, 0.4 * d,
        -0.35 * w, 0.5 * h, 0.4 * d,

        // Back face
        -0.5 * w, -0.5 * h, -0.7 * d,
         0.5 * w, -0.5 * h, -0.7 * d,
         0.35 * w, 0.5 * h, -0.4 * d,
        -0.35 * w, 0.5 * h, -0.4 * d,

        // Top face
         0.35 * w, 0.5 * h, 0.4 * d,
        -0.35 * w, 0.5 * h, 0.4 * d,
        -0.35 * w, 0.5 * h, -0.4 * d,
         0.35 * w, 0.5 * h, -0.4 * d,

        // Bottom face
        -0.5 * w, -0.5 * h, 0.7 * d,
         0.5 * w, -0.5 * h, 0.7 * d,
         0.5 * w, -0.5 * h, -0.7 * d,
        -0.5 * w, -0.5 * h, -0.7 * d,

        // Right face
         0.5 * w, -0.5 * h, 0.7 * d,
         0.35 * w, 0.5 * h, 0.4 * d,
         0.35 * w, 0.5 * h, -0.4 * d,
         0.5 * w, -0.5 * h, -0.7 * d,

        // Left face
        -0.5 * w, -0.5 * h, 0.7 * d,
        -0.35 * w, 0.5 * h, 0.4 * d,
        -0.35 * w, 0.5 * h, -0.4 * d,
        -0.5 * w, -0.5 * h, -0.7 * d,

        // Front2 face
        -0.35 * w, 0.5 * h, 0.4 * d,
         0.35 * w, 0.5 * h, 0.4 * d,
         0.0 * w, 0.6 * h, 0.35 * d,

        // Back2 face
        -0.35 * w, 0.5 * h, -0.4 * d,
         0.35 * w, 0.5 * h, -0.4 * d,
         0.0 * w, 0.6 * h, -0.35 * d,

        // Right2 face
         0.35 * w, 0.5 * h, 0.4 * d,
         0.35 * w, 0.5 * h, -0.4 * d,
         0.0 * w, 0.6 * h, -0.35 * d,
         0.0 * w, 0.6 * h, 0.35 * d,

        // Left2 face
        -0.35 * w, 0.5 * h, 0.4 * d,
        -0.35 * w, 0.5 * h, -0.4 * d,
         0.0 * w, 0.6 * h, -0.35 * d,
         0.0 * w, 0.6 * h, 0.35 * d
    ];

    const uvs = [
        // Front face
        0.5, 0.5,
        0.75, 0.5,
        0.75 - 0.25 / 8, 1.0,
        0.5 + 0.25 / 8, 1.0,

        // Back face
        0.5, 0.5,
        0.25, 0.5,
        0.25 + 0.25 / 8, 1.0,
        0.5 - 0.25 / 8, 1.0,

        // Top face
        0.75, 0.5,
        0.5, 0.5,
        0.5, 0.0,
        0.75, 0.0,

        // Bottom face
        0.0, 0.5,
        0.25, 0.5,
        0.25, 1.0,
        0.0, 1.0,

        // Right face
        0.0, 0.5,
        0.0, 0.0,
        0.25, 0.0,
        0.25, 0.5,

        // Left face
        0.5, 0.5,
        0.5, 0.0,
        0.25, 0.0,
        0.25, 0.5,

        // Front2 face
        0.75, 0.0,
        1.0, 0.0,
        1.0, 0.5,

        // Back2 face
        0.75, 0.0,
        1.0, 0.0,
        1.0, 0.5,

        // Right2 face
        0.75, 0.0,
        1.0, 0.0,
        1.0, 0.5,
        0.75, 0.5,

        // Left2 face
        0.75, 0.0,
        1.0, 0.0,
        1.0, 0.5,
        0.75, 0.5
    ];

    const indices = [
         0, 1, 2,   0, 2, 3,
         4, 5, 6,   4, 6, 7,
         8, 9, 10,  8, 10, 11,
         12, 13, 14, 12, 14, 15,
         16, 17, 18, 16, 18, 19,
         20, 21, 22, 20, 22, 23,
         24, 25, 26,
         27, 28, 29,
         30, 33, 31, 33, 32, 31,
         34, 35, 36, 34, 36, 37
    ];

    const normals = [];
    BABYLON.VertexData.ComputeNormals(positions, indices, normals);

    const vertexData = new BABYLON.VertexData();
    vertexData.positions = positions;
    vertexData.indices = indices;
    vertexData.normals = normals;
    vertexData.uvs = uvs;
    return vertexData;
}

function randomRange(min, max) {
    return Math.random() * (max - min) + min;
}

function randomSpawn() {
    // Matches the other Havok shogi samples' genPosition: x,z in +/-7.5, y in 15..30.
    return new BABYLON.Vector3(
        (Math.random() - 0.5) * 15,
        (Math.random() + 1.0) * 15,
        (Math.random() - 0.5) * 15
    );
}

function createScene() {
    const scene = new BABYLON.Scene(engine);
    scene.enablePhysics(new BABYLON.Vector3(0, -9.8, 0), new BABYLON.HavokPlugin());
    setupPhysicsDebugWireframe(scene);
    scene.clearColor = new BABYLON.Color4(0.17, 0.18, 0.22, 1.0);

    // Fixed, head-on camera matching the WebGL/WebGPU + Havok samples (eye at (0,0,40) looking
    // at the origin, 45 deg vertical FOV). No auto-rotation, for easy side-by-side comparison.
    const camera = new BABYLON.ArcRotateCamera("camera", -Math.PI / 2, Math.PI / 2, 40, BABYLON.Vector3.Zero(), scene);
    camera.setPosition(new BABYLON.Vector3(0, 0, 40));
    camera.setTarget(BABYLON.Vector3.Zero());
    camera.fov = 45 * Math.PI / 180;
    camera.minZ = 0.1;
    camera.maxZ = 1000;
    camera.attachControl(canvas, true);

    const hemiLight = new BABYLON.HemisphericLight("hemi", new BABYLON.Vector3(1, 1, 0), scene);
    hemiLight.intensity = 0.9;

    const dirLight = new BABYLON.DirectionalLight("dir", new BABYLON.Vector3(-0.4, -1.0, -0.3), scene);
    dirLight.position = new BABYLON.Vector3(30, 100, 50);
    dirLight.intensity = 1.4;

    const shadow = new BABYLON.ShadowGenerator(1024, dirLight);
    shadow.usePercentageCloserFiltering = true;
    shadow.bias = 0.0005;
    shadow.normalBias = 0.02;

    const groundMat = new BABYLON.StandardMaterial("groundMat", scene);
    groundMat.diffuseColor = new BABYLON.Color3(0.24, 0.25, 0.28);
    groundMat.specularColor = BABYLON.Color3.Black();

    const pieceTexture = new BABYLON.Texture("../../../../assets/textures/shogi_001/shogi.png", scene, false, false);
    pieceTexture.wrapU = BABYLON.Texture.CLAMP_ADDRESSMODE;
    pieceTexture.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
    pieceTexture.uScale = -1;
    pieceTexture.uOffset = 1;

    const pieceMat = new BABYLON.StandardMaterial("pieceMat", scene);
    pieceMat.diffuseTexture = pieceTexture;
    pieceMat.backFaceCulling = false;
    pieceMat.twoSidedLighting = true;

    // Floor matching the other Havok shogi samples: a 13 x 0.1 x 13 slab at y = -10, with the
    // collider the same size as the rendered slab.
    const ground = BABYLON.MeshBuilder.CreateBox("ground", { width: 13, height: 0.1, depth: 13 }, scene);
    ground.position.y = -10;
    ground.material = groundMat;
    ground.receiveShadows = true;
    ground.aggregate = new BABYLON.PhysicsAggregate(
        ground,
        BABYLON.PhysicsShapeType.BOX,
        {
            mass: 0, friction: 0.5, restitution: 0.0,
            extents: new BABYLON.Vector3(GROUND_PHYSICS_SIZE[0], GROUND_PHYSICS_SIZE[1], GROUND_PHYSICS_SIZE[2])
        },
        scene
    );

    const pieceW = 1.6;
    const pieceH = 1.6;
    const pieceD = 0.32;

    const baseMesh = new BABYLON.Mesh("shogiPieceBase", scene);
    const vertexData = createShogiVertexData(pieceW, pieceH, pieceD);
    vertexData.applyToMesh(baseMesh);
    baseMesh.convertToFlatShadedMesh();
    baseMesh.material = pieceMat;
    baseMesh.isVisible = false;

    const pieces = [];

    for (let i = 0; i < PIECE_COUNT; i++) {
        const mesh = baseMesh.clone("shogiPiece" + i);
        const spawn = randomSpawn();

        mesh.position.copyFrom(spawn);
        mesh.rotationQuaternion = BABYLON.Quaternion.RotationYawPitchRoll(
            randomRange(0, Math.PI),
            randomRange(0, Math.PI),
            randomRange(0, Math.PI)
        );
        mesh.isVisible = true;
        mesh.receiveShadows = true;

        const aggregate = new BABYLON.PhysicsAggregate(
            mesh,
            BABYLON.PhysicsShapeType.BOX,
            {
                mass: 1, friction: 0.5, restitution: 0.0,
                extents: new BABYLON.Vector3(SHOGI_PHYSICS_SIZE[0], SHOGI_PHYSICS_SIZE[1], SHOGI_PHYSICS_SIZE[2])
            },
            scene
        );

        shadow.addShadowCaster(mesh, true);
        pieces.push({ mesh: mesh, aggregate: aggregate });
    }

    scene.onBeforeRenderObservable.add(() => {
        for (const piece of pieces) {
            if (piece.mesh.position.y < -15) {
                const spawn = randomSpawn();
                const body = piece.aggregate.body;

                // Recycle pattern from the other Babylon + Havok samples (Babylon physics perf
                // tips): teleport the transform node and zero the velocities. Re-enabling the
                // prestep optimisation afterwards is what previously broke this (it left pieces
                // spinning in mid-air), so it is intentionally left disabled.
                body.disablePreStep = false;
                body.transformNode.position.copyFrom(spawn);
                body.transformNode.rotationQuaternion = BABYLON.Quaternion.RotationYawPitchRoll(
                    randomRange(0, Math.PI),
                    randomRange(0, Math.PI),
                    randomRange(0, Math.PI)
                );
                body.setLinearVelocity(BABYLON.Vector3.Zero());
                body.setAngularVelocity(BABYLON.Vector3.Zero());
            }
        }
    });

    return scene;
}

init();
