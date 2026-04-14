let engine;
let scene;
let canvas;

const PHYSICS_SCALE = 1 / 10;
const PIECE_COUNT = 220;
const BOX_HALF_EXTENT = 5 * PHYSICS_SCALE;
const SPAWN_MARGIN = 0.6 * PHYSICS_SCALE;

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
    const minXZ = -BOX_HALF_EXTENT + SPAWN_MARGIN;
    const maxXZ = BOX_HALF_EXTENT - SPAWN_MARGIN;
    return new BABYLON.Vector3(
        randomRange(minXZ, maxXZ),
        randomRange(20, 90) * PHYSICS_SCALE,
        randomRange(minXZ, maxXZ)
    );
}

function createScene() {
    const scene = new BABYLON.Scene(engine);
    scene.enablePhysics(new BABYLON.Vector3(0, -9.8, 0), new BABYLON.HavokPlugin());
    scene.clearColor = new BABYLON.Color4(0.17, 0.18, 0.22, 1.0);

    const camera = new BABYLON.ArcRotateCamera(
        "camera",
        0,
        Math.PI / 180 * 60,
        42 * PHYSICS_SCALE,
        BABYLON.Vector3.Zero(),
        scene
    );
    camera.setPosition(new BABYLON.Vector3(18 * PHYSICS_SCALE, 24 * PHYSICS_SCALE, 34 * PHYSICS_SCALE));
    camera.attachControl(canvas, true);

    const hemiLight = new BABYLON.HemisphericLight("hemi", new BABYLON.Vector3(1, 1, 0), scene);
    hemiLight.intensity = 0.9;

    const dirLight = new BABYLON.DirectionalLight("dir", new BABYLON.Vector3(-0.4, -1.0, -0.3), scene);
    dirLight.position = new BABYLON.Vector3(30 * PHYSICS_SCALE, 100 * PHYSICS_SCALE, 50 * PHYSICS_SCALE);
    dirLight.intensity = 1.4;

    const shadow = new BABYLON.ShadowGenerator(1024, dirLight);
    shadow.usePercentageCloserFiltering = true;
    shadow.bias = 0.0005;
    shadow.normalBias = 0.02;

    const groundMat = new BABYLON.StandardMaterial("groundMat", scene);
    groundMat.diffuseColor = new BABYLON.Color3(0.24, 0.25, 0.28);
    groundMat.specularColor = BABYLON.Color3.Black();

    const wallMat = new BABYLON.StandardMaterial("wallMat", scene);
    wallMat.diffuseColor = new BABYLON.Color3(0.3, 0.32, 0.37);
    wallMat.alpha = 0.4;

    const pieceTexture = new BABYLON.Texture("../../../../assets/textures/shogi_001/shogi.png", scene, false, false);
    pieceTexture.wrapU = BABYLON.Texture.CLAMP_ADDRESSMODE;
    pieceTexture.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
    pieceTexture.uScale = -1;
    pieceTexture.uOffset = 1;

    const pieceMat = new BABYLON.StandardMaterial("pieceMat", scene);
    pieceMat.diffuseTexture = pieceTexture;
    pieceMat.backFaceCulling = false;
    pieceMat.twoSidedLighting = true;

    const ground = BABYLON.MeshBuilder.CreateBox("ground", {
        width: 40 * PHYSICS_SCALE,
        height: 4 * PHYSICS_SCALE,
        depth: 40 * PHYSICS_SCALE
    }, scene);
    ground.position.y = -2 * PHYSICS_SCALE;
    ground.material = groundMat;
    ground.receiveShadows = true;
    ground.aggregate = new BABYLON.PhysicsAggregate(
        ground,
        BABYLON.PhysicsShapeType.BOX,
        { mass: 0, friction: 0.6, restitution: 0.1 },
        scene
    );

    const wallData = [
        { w: 10, h: 10, d: 1, x: 0, y: 5, z: -5 },
        { w: 10, h: 10, d: 1, x: 0, y: 5, z: 5 },
        { w: 1, h: 10, d: 10, x: -5, y: 5, z: 0 },
        { w: 1, h: 10, d: 10, x: 5, y: 5, z: 0 }
    ];

    for (const wall of wallData) {
        const wallMesh = BABYLON.MeshBuilder.CreateBox("wall", {
            width: wall.w * PHYSICS_SCALE,
            height: wall.h * PHYSICS_SCALE,
            depth: wall.d * PHYSICS_SCALE
        }, scene);

        wallMesh.position.set(wall.x * PHYSICS_SCALE, wall.y * PHYSICS_SCALE, wall.z * PHYSICS_SCALE);
        wallMesh.material = wallMat;

        wallMesh.aggregate = new BABYLON.PhysicsAggregate(
            wallMesh,
            BABYLON.PhysicsShapeType.BOX,
            { mass: 0, friction: 0.4, restitution: 0.2 },
            scene
        );
    }

    const pieceW = 1.6 * PHYSICS_SCALE;
    const pieceH = 1.6 * PHYSICS_SCALE;
    const pieceD = 0.45 * PHYSICS_SCALE;

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
            { mass: 1, friction: 0.25, restitution: 0.1 },
            scene
        );

        shadow.addShadowCaster(mesh, true);
        pieces.push({ mesh: mesh, aggregate: aggregate });
    }

    scene.onBeforeRenderObservable.add(() => {
        for (const piece of pieces) {
            if (piece.mesh.position.y < -10 * PHYSICS_SCALE) {
                const spawn = randomSpawn();
                const body = piece.aggregate.body;

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

        camera.alpha -= 0.003 * scene.getAnimationRatio();
    });

    return scene;
}

init();
