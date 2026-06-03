const HAVOK_WASM_URL = 'https://cx20.github.io/gltf-test/libs/babylonjs/dev/HavokPhysics.wasm';
let engine;
let scene;
let canvas;

const ERASER_COUNT = 200;
const SCALE = 2;
// Eraser box half-extents (base mesh half-extents x SCALE): 2.0 x 0.4 x 1.0.
const MESH_W = 1.0, MESH_H = 0.2, MESH_D = 0.5;
const EHALF = [MESH_W * SCALE, MESH_H * SCALE, MESH_D * SCALE];
const GRASS_TEXTURE = '../../../../assets/textures/grass.jpg';
// Six eraser faces in atlas-column order: +x, -x, +y, -y, +z, -z (right, left, top, bottom, front, back).
const ERASER_FACE_TEXTURES = [
    '../../../../assets/textures/eraser_003/eraser_right.png',
    '../../../../assets/textures/eraser_003/eraser_left.png',
    '../../../../assets/textures/eraser_003/eraser_top.png',
    '../../../../assets/textures/eraser_003/eraser_bottom.png',
    '../../../../assets/textures/eraser_003/eraser_front.png',
    '../../../../assets/textures/eraser_003/eraser_back.png',
];

let showWireframe = true;
let physicsViewer = null;
const trackedBodies = [];

function setupPhysicsDebugWireframe(scene) {
    if (!BABYLON.Debug || !BABYLON.Debug.PhysicsViewer) {
        return;
    }
    physicsViewer = new BABYLON.Debug.PhysicsViewer(scene);
    const seenBodies = new WeakSet();
    scene.registerBeforeRender(function () {
        scene.meshes.forEach(function (mesh) {
            if (mesh && mesh.physicsBody && !seenBodies.has(mesh.physicsBody)) {
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
        for (const body of trackedBodies) {
            if (visible) {
                physicsViewer.showBody(body);
            } else {
                physicsViewer.hideBody(body);
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
    const eraserAtlasUrl = await buildEraserAtlasDataUrl();
    scene = createScene(eraserAtlasUrl);
    engine.runRenderLoop(function () {
        scene.render();
    });
    window.addEventListener('resize', function () {
        engine.resize();
    });
}

// Eraser box: 24 vertices (6 faces) with per-face UVs into a 6-column atlas (+x,-x,+y,-y,+z,-z),
// the same reliable layout the other eraser examples use, so every face reads "MOMO".
function createEraserVertexData() {
    const faces = [
        { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },
        { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
        { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },
        { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
        { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
        { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
    ];
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    const localUV = [[0, 1], [1, 1], [1, 0], [0, 0]];
    const positions = [], normals = [], uvs = [], indices = [];
    const dotHalf = (a) => Math.abs(a[0]) * EHALF[0] + Math.abs(a[1]) * EHALF[1] + Math.abs(a[2]) * EHALF[2];
    faces.forEach((f, fi) => {
        const base = positions.length / 3;
        const halfU = dotHalf(f.u), halfV = dotHalf(f.v);
        for (let ci = 0; ci < 4; ci++) {
            const [su, sv] = corners[ci];
            positions.push(
                f.n[0] * EHALF[0] + f.u[0] * su * halfU + f.v[0] * sv * halfV,
                f.n[1] * EHALF[1] + f.u[1] * su * halfU + f.v[1] * sv * halfV,
                f.n[2] * EHALF[2] + f.u[2] * su * halfU + f.v[2] * sv * halfV,
            );
            normals.push(f.n[0], f.n[1], f.n[2]);
            uvs.push((localUV[ci][0] + fi) / 6, localUV[ci][1]);
        }
        indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
    });
    const vertexData = new BABYLON.VertexData();
    vertexData.positions = positions;
    vertexData.indices = indices;
    vertexData.normals = normals;
    vertexData.uvs = uvs;
    return vertexData;
}

// Build a 6-cell atlas (right,left,top,bottom,front,back) PNG data URL from the eraser_003 images.
async function buildEraserAtlasDataUrl() {
    const cell = 256;
    const images = await Promise.all(ERASER_FACE_TEXTURES.map(async (s) => {
        const im = new Image();
        im.src = s;
        await im.decode();
        return im;
    }));
    const atlas = document.createElement('canvas');
    atlas.width = cell * 6;
    atlas.height = cell;
    const ctx = atlas.getContext('2d');
    for (let i = 0; i < 6; i++) ctx.drawImage(images[i], i * cell, 0, cell, cell);
    return atlas.toDataURL('image/png');
}

function randomRange(min, max) {
    return Math.random() * (max - min) + min;
}

function randomSpawn() {
    return new BABYLON.Vector3(randomRange(-5, 5), randomRange(20, 30), randomRange(-5, 5));
}

function createScene(eraserAtlasUrl) {
    const scene = new BABYLON.Scene(engine);
    scene.enablePhysics(new BABYLON.Vector3(0, -9.81, 0), new BABYLON.HavokPlugin());
    setupPhysicsDebugWireframe(scene);
    scene.clearColor = new BABYLON.Color4(0.5, 0.5, 0.8, 1.0);

    const camera = new BABYLON.ArcRotateCamera('camera', -Math.PI / 2, Math.PI / 180 * 68, 48,
        new BABYLON.Vector3(0, 3, 0), scene);
    camera.attachControl(canvas, true);

    const hemi = new BABYLON.HemisphericLight('hemi', new BABYLON.Vector3(0.3, 1, 0.2), scene);
    hemi.intensity = 0.9;
    const dir = new BABYLON.DirectionalLight('dir', new BABYLON.Vector3(-0.4, -1, -0.3), scene);
    dir.position = new BABYLON.Vector3(20, 40, 20);
    dir.intensity = 1.2;

    // Floor (static, grass).
    const floorMat = new BABYLON.StandardMaterial('floorMat', scene);
    const grass = new BABYLON.Texture(GRASS_TEXTURE, scene);
    grass.uScale = grass.vScale = 4;
    floorMat.diffuseTexture = grass;
    floorMat.specularColor = BABYLON.Color3.Black();
    const floor = BABYLON.MeshBuilder.CreateBox('floor', { width: 40, height: 4, depth: 40 }, scene);
    floor.position.y = -2;
    floor.material = floorMat;
    floor.receiveShadows = true;
    new BABYLON.PhysicsAggregate(floor, BABYLON.PhysicsShapeType.BOX, { mass: 0, friction: 0.6, restitution: 0.1 }, scene);

    // Walls (static, translucent) forming a basket.
    const wallMat = new BABYLON.StandardMaterial('wallMat', scene);
    wallMat.diffuseColor = new BABYLON.Color3(1, 1, 1);
    wallMat.alpha = 0.45;
    const wallData = [
        { size: [10, 10, 1], pos: [0, 5, -5] },
        { size: [10, 10, 1], pos: [0, 5, 5] },
        { size: [1, 10, 10], pos: [-5, 5, 0] },
        { size: [1, 10, 10], pos: [5, 5, 0] },
    ];
    for (const w of wallData) {
        const wall = BABYLON.MeshBuilder.CreateBox('wall', { width: w.size[0], height: w.size[1], depth: w.size[2] }, scene);
        wall.position.set(w.pos[0], w.pos[1], w.pos[2]);
        wall.material = wallMat;
        new BABYLON.PhysicsAggregate(wall, BABYLON.PhysicsShapeType.BOX, { mass: 0, friction: 0.4, restitution: 0.2 }, scene);
    }

    // Eraser base mesh. Babylon's default invertY keeps the runtime atlas upright (top/bottom
    // faces read "MOMO"); per-face UVs into the 6-cell atlas fix the previous left-right mirroring.
    const eraserMat = new BABYLON.StandardMaterial('eraserMat', scene);
    const eraserTex = new BABYLON.Texture(eraserAtlasUrl, scene, false, true);
    eraserTex.wrapU = BABYLON.Texture.CLAMP_ADDRESSMODE;
    eraserTex.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
    eraserMat.diffuseTexture = eraserTex;
    eraserMat.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);
    eraserMat.backFaceCulling = false;
    eraserMat.twoSidedLighting = true;

    const baseMesh = new BABYLON.Mesh('eraserBase', scene);
    createEraserVertexData().applyToMesh(baseMesh);
    baseMesh.material = eraserMat;
    baseMesh.isVisible = false;

    const erasers = [];
    for (let i = 0; i < ERASER_COUNT; i++) {
        const mesh = baseMesh.clone('eraser' + i);
        mesh.position.copyFrom(randomSpawn());
        mesh.rotationQuaternion = BABYLON.Quaternion.RotationYawPitchRoll(
            randomRange(0, Math.PI * 2), randomRange(0, Math.PI * 2), randomRange(0, Math.PI * 2));
        mesh.isVisible = true;
        const aggregate = new BABYLON.PhysicsAggregate(mesh, BABYLON.PhysicsShapeType.BOX,
            { mass: 1, friction: 0.5, restitution: 0.1 }, scene);
        erasers.push({ mesh, aggregate });
    }

    scene.onBeforeRenderObservable.add(() => {
        for (const e of erasers) {
            if (e.mesh.position.y < -10) {
                const body = e.aggregate.body;
                const spawn = randomSpawn();
                body.disablePreStep = false;
                body.transformNode.position.copyFrom(spawn);
                body.transformNode.rotationQuaternion = BABYLON.Quaternion.RotationYawPitchRoll(
                    randomRange(0, Math.PI * 2), randomRange(0, Math.PI * 2), randomRange(0, Math.PI * 2));
                body.setLinearVelocity(BABYLON.Vector3.Zero());
                body.setAngularVelocity(BABYLON.Vector3.Zero());
            }
        }
    });

    return scene;
}

init();
