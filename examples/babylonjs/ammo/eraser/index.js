let engine;
let scene;
let canvas;
// to go quicker
const v3 = BABYLON.Vector3;

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

function randomNumber(min, max) {
    if (min == max) {
        return (min);
    }
    return Math.random() * (max - min) + min;
}

function getPosition() {
    return new BABYLON.Vector3(randomNumber(-6, 6), randomNumber(14, 28), randomNumber(-6, 6));
}

async function init() {
    canvas = document.querySelector("#c");
    engine = new BABYLON.Engine(canvas, true);
    await Ammo();

    const eraserAtlasUrl = await buildEraserAtlasDataUrl();
    scene = createScene(eraserAtlasUrl);

    engine.runRenderLoop(function () {
        scene.render();
    });
    window.addEventListener('resize', function () {
        engine.resize();
    });
};

const createScene = function(eraserAtlasUrl) {

    scene = new BABYLON.Scene(engine);
    scene.enablePhysics(new BABYLON.Vector3(0, -9.8, 0), new BABYLON.AmmoJSPlugin());
    setupPhysicsDebugWireframe(scene);
    scene.getPhysicsEngine().setTimeStep(scene.getAnimationRatio());
    scene.clearColor = new BABYLON.Color4(0.5, 0.5, 0.8, 1.0);

    // Fixed head-on camera matching the WebGL/WebGPU + Havok eraser samples (eye at (0,0,40)
    // looking at the origin, 45 deg FOV).
    const camera = new BABYLON.ArcRotateCamera("Camera", -Math.PI / 2, Math.PI / 2, 40, new BABYLON.Vector3(0, 0, 0), scene);
    camera.setPosition(new BABYLON.Vector3(0, 0, 40));
    camera.setTarget(BABYLON.Vector3.Zero());
    camera.fov = 45 * Math.PI / 180;
    camera.minZ = 0.1;
    camera.maxZ = 1000;
    camera.attachControl(canvas, true);

    const hemi = new BABYLON.HemisphericLight("hemi", new BABYLON.Vector3(0.3, 1, 0.2), scene);
    hemi.intensity = 0.9;
    const dir = new BABYLON.DirectionalLight("dir01", new BABYLON.Vector3(-0.4, -1, -0.3), scene);
    dir.position = new BABYLON.Vector3(20, 40, 20);
    dir.intensity = 1.2;

    // Floor (static, grass). Small low floor (no walls), matching the reference Havok eraser
    // sample: a 20 x 0.1 x 20 slab at y = -10 that the heap overflows.
    const mat = new BABYLON.StandardMaterial("ground", scene);
    const t = new BABYLON.Texture(GRASS_TEXTURE, scene);
    t.uScale = t.vScale = 4;
    mat.diffuseTexture = t;
    mat.specularColor = BABYLON.Color3.Black();
    const g = BABYLON.MeshBuilder.CreateBox("ground", { width: 20, height: 0.1, depth: 20 }, scene);
    g.position.y = -10;
    g.material = mat;
    g.receiveShadows = true;
    g.physicsImpostor = new BABYLON.PhysicsImpostor(g, BABYLON.PhysicsImpostor.BoxImpostor, {
        move: false,
        mass: 0,
        friction: 0.6,
        restitution: 0.1
    }, scene);

    // Eraser base mesh: per-face UVs into the 6-cell eraser_003 atlas so every "MOMO" face reads
    // correctly, matching the reference Havok eraser sample.
    const eraserMat = new BABYLON.StandardMaterial("material", scene);
    const eraserTex = new BABYLON.Texture(eraserAtlasUrl, scene, false, true);
    eraserTex.wrapU = BABYLON.Texture.CLAMP_ADDRESSMODE;
    eraserTex.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
    eraserMat.diffuseTexture = eraserTex;
    eraserMat.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);
    eraserMat.backFaceCulling = false;
    eraserMat.twoSidedLighting = true;

    const baseMesh = new BABYLON.Mesh("eraserBase", scene);
    createEraserVertexData().applyToMesh(baseMesh);
    baseMesh.material = eraserMat;
    baseMesh.isVisible = false;

    const objects = [];

    // Creates
    for (let i = 0; i < ERASER_COUNT; i++) {

        const s = baseMesh.clone("eraser" + i);
        s.isVisible = true;
        s.position = getPosition();
        s.rotationQuaternion = BABYLON.Quaternion.RotationYawPitchRoll(
            randomNumber(0, Math.PI * 2), randomNumber(0, Math.PI * 2), randomNumber(0, Math.PI * 2));
        s.physicsImpostor = new BABYLON.PhysicsImpostor(s, BABYLON.PhysicsImpostor.BoxImpostor, { mass: 1, friction: 0.4, restitution: 0.2 }, scene);

        // SAVE OBJECT
        objects.push(s);
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
