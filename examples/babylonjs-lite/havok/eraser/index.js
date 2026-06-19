import {
    addToScene, attachControl, createArcRotateCamera, createBox, createEngine,
    createDirectionalLight, createHavokWorld, createHemisphericLight,
    createMeshFromData, createPhysicsAggregate, createPhysicsViewer,
    createSceneContext, createStandardMaterial,
    hidePhysicsBody, loadTexture2D, onBeforeRender, PhysicsShapeType,
    registerScene, showPhysicsBody, startEngine,
    setPhysicsBodyAngularVelocity, setPhysicsBodyLinearVelocity, setPhysicsBodyPreStep,
} from 'https://cdn.jsdelivr.net/npm/@babylonjs/lite@1.2.0/index.js';
import HavokPhysics from 'https://cdn.jsdelivr.net/npm/@babylonjs/havok@1.3.12/lib/esm/HavokPhysics_es.js';

const PHYSICS_FPS = 60;
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
    return {
        positions: new Float32Array(positions),
        normals: new Float32Array(normals),
        uvs: new Float32Array(uvs),
        indices: new Uint32Array(indices),
    };
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
    return { x: randomRange(-6, 6), y: randomRange(14, 28), z: randomRange(-6, 6) };
}

// Uniform random unit quaternion (Shoemake) for varied initial orientations.
function randomQuaternion() {
    const u1 = Math.random(), u2 = Math.random(), u3 = Math.random();
    const s1 = Math.sqrt(1 - u1), s2 = Math.sqrt(u1);
    return {
        x: s1 * Math.sin(2 * Math.PI * u2),
        y: s1 * Math.cos(2 * Math.PI * u2),
        z: s2 * Math.sin(2 * Math.PI * u3),
        w: s2 * Math.cos(2 * Math.PI * u3),
    };
}

async function main() {
    const canvas = document.getElementById('c');
    const engine = await createEngine(canvas);
    const scene = createSceneContext(engine);
    scene.fixedDeltaMs = 1000 / PHYSICS_FPS;
    scene.clearColor = { r: 0.5, g: 0.5, b: 0.8, a: 1.0 };

    // Fixed head-on camera matching the WebGL/WebGPU + Havok eraser samples (eye at (0,0,40)
    // looking at the origin, 45 deg FOV).
    const camera = createArcRotateCamera(-Math.PI / 2, Math.PI / 2, 40, { x: 0, y: 0, z: 0 });
    camera.fov = 45 * Math.PI / 180;
    camera.nearPlane = 0.1;
    camera.farPlane = 1000;
    scene.camera = camera;
    attachControl(camera, canvas, scene);

    const hemi = createHemisphericLight([0.3, 1, 0.2]);
    hemi.intensity = 0.9;
    addToScene(scene, hemi);
    const dir = createDirectionalLight([-0.4, -1, -0.3]);
    dir.intensity = 1.2;
    addToScene(scene, dir);

    // Floor (static, grass): a 20 x 0.1 x 20 slab at y = -10 that the heap overflows.
    const grass = await loadTexture2D(engine, GRASS_TEXTURE);
    const floorMat = createStandardMaterial();
    floorMat.diffuseTexture = grass;
    floorMat.uvScale = [4, 4];
    floorMat.specularColor = [0, 0, 0];
    const FW = 20, FH = 0.1, FD = 20;
    const floor = createBox(engine, 1);
    floor.scaling.set(FW, FH, FD);
    floor.position.set(0, -10, 0);
    floor.material = floorMat;
    addToScene(scene, floor);

    const fpsEl = document.getElementById('fps');
    let lastTime = performance.now();
    let frameCount = 0;
    onBeforeRender(scene, () => {
        frameCount++;
        const now = performance.now();
        if (now - lastTime >= 1000) {
            fpsEl.textContent = 'FPS: ' + Math.round(frameCount * 1000 / (now - lastTime));
            frameCount = 0;
            lastTime = now;
        }
    });

    const hknp = await HavokPhysics();
    const world = createHavokWorld(scene, hknp, { x: 0, y: -9.8, z: 0 });

    const allBodies = [];
    const floorAgg = createPhysicsAggregate(world, floor, PhysicsShapeType.BOX, {
        mass: 0, friction: 0.6, restitution: 0.1, extents: { x: FW, y: FH, z: FD },
    });
    allBodies.push(floorAgg.body);

    // Eraser atlas + material. invertY (default) keeps the atlas upright; per-face UVs into
    // the 6-cell atlas avoid left-right mirroring. Clamp so cells do not bleed into neighbours.
    const eraserAtlasUrl = await buildEraserAtlasDataUrl();
    const eraserTex = await loadTexture2D(engine, eraserAtlasUrl, {
        addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge',
    });
    const eraserMat = createStandardMaterial();
    eraserMat.diffuseTexture = eraserTex;
    eraserMat.specularColor = [0.1, 0.1, 0.1];
    eraserMat.backFaceCulling = false;

    // The geometry is built at its real size (half-extents EHALF), so the BOX collider picks
    // up the correct extents straight from the mesh bounds (no explicit extents needed).
    const data = createEraserVertexData();
    const erasers = [];
    for (let i = 0; i < ERASER_COUNT; i++) {
        const mesh = createMeshFromData(engine, 'eraser', data.positions, data.normals, data.indices, data.uvs);
        const s = randomSpawn();
        mesh.position.set(s.x, s.y, s.z);
        const q = randomQuaternion();
        mesh.rotationQuaternion.set(q.x, q.y, q.z, q.w);
        mesh.material = eraserMat;
        addToScene(scene, mesh);
        const agg = createPhysicsAggregate(world, mesh, PhysicsShapeType.BOX, {
            mass: 1, friction: 0.5, restitution: 0.1,
        });
        erasers.push({ mesh, body: agg.body });
        allBodies.push(agg.body);
    }

    // Recycle erasers that fall below the floor.
    onBeforeRender(scene, () => {
        for (const e of erasers) {
            if (e.mesh.position.y < -15) {
                const s = randomSpawn();
                const q = randomQuaternion();
                setPhysicsBodyPreStep(e.body, true);
                e.mesh.position.set(s.x, s.y, s.z);
                e.mesh.rotationQuaternion.set(q.x, q.y, q.z, q.w);
                setPhysicsBodyLinearVelocity(world, e.body, { x: 0, y: 0, z: 0 });
                setPhysicsBodyAngularVelocity(world, e.body, { x: 0, y: 0, z: 0 });
            }
        }
    });

    const viewer = createPhysicsViewer(scene, world);
    let showWireframe = true;
    for (const body of allBodies) showPhysicsBody(viewer, body);

    window.addEventListener('keydown', (e) => {
        if (e.repeat) return;
        if (e.code === 'KeyW' || e.key === 'w' || e.key === 'W') {
            showWireframe = !showWireframe;
            for (const body of allBodies) {
                if (showWireframe) showPhysicsBody(viewer, body);
                else hidePhysicsBody(viewer, body);
            }
            const hint = document.getElementById('hint');
            if (hint) hint.textContent = 'W: wireframe ' + (showWireframe ? 'ON' : 'OFF');
        }
    });

    await registerScene(scene);
    await startEngine(engine);
}

main().catch((err) => {
    console.error('Babylon.js Lite error:', err);
    document.body.style.color = '#f88';
    document.body.style.padding = '1rem';
    document.body.style.fontFamily = 'monospace';
    document.body.innerHTML = '<b>Error:</b> ' + err.message +
        '<br><br>This example requires a WebGPU-capable browser (Chrome 113+, Edge 113+).';
});
