import {
    addToScene, attachControl, createArcRotateCamera, createBox, createEngine,
    createDirectionalLight, createHavokWorld, createHemisphericLight,
    createMeshFromData, createPbrMaterial, createPcfDirectionalShadowGenerator,
    createPhysicsAggregate, createPhysicsViewer,
    createSceneContext, createSolidTexture2D, createStandardMaterial,
    hidePhysicsBody, loadEnvironment, loadTexture2D, onBeforeRender, PhysicsShapeType,
    registerSceneWithShadowSupport, setShadowTaskCasterMeshes,
    showPhysicsBody, startEngine,
    setPhysicsBodyAngularVelocity, setPhysicsBodyLinearVelocity, setPhysicsBodyPreStep,
} from 'https://cdn.jsdelivr.net/npm/@babylonjs/lite@1.0.1/index.js';
import HavokPhysics from 'https://cdn.jsdelivr.net/npm/@babylonjs/havok@1.3.12/lib/esm/HavokPhysics_es.js';

const PHYSICS_FPS = 60;
const PIECE_COUNT = 300;
// PBR materials need IBL textures + a BRDF LUT; loadEnvironment supplies both (and enables the
// tone mapping that gives the gamma-correct look). No skyboxUrl, so the background stays clearColor.
const ENV_URL = 'https://cx20.github.io/gltf-test/textures/env/papermillSpecularHDR.env';
const BRDF_URL = 'https://cdn.jsdelivr.net/gh/BabylonJS/Babylon-Lite@master/packages/babylon-lite/assets/brdf-lut.png';
// Full box-collider extents, identical to the other Havok shogi samples' shape sizes.
const SHOGI_PHYSICS_SIZE = [1.6, 1.92, 0.448];
const GROUND_PHYSICS_SIZE = [13, 0.1, 13];

// Pentagonal shogi-piece geometry. The original applies a texture uScale=-1, uOffset=1
// (i.e. u -> 1 - u); we bake that flip straight into the UVs so the texture can be sampled
// normally. Faces do not share vertices, so per-triangle normals give flat shading.
function createShogiVertexData(w, h, d) {
    const positions = [
        -0.5 * w, -0.5 * h, 0.7 * d,   0.5 * w, -0.5 * h, 0.7 * d,   0.35 * w, 0.5 * h, 0.4 * d,  -0.35 * w, 0.5 * h, 0.4 * d,
        -0.5 * w, -0.5 * h, -0.7 * d,  0.5 * w, -0.5 * h, -0.7 * d,  0.35 * w, 0.5 * h, -0.4 * d, -0.35 * w, 0.5 * h, -0.4 * d,
         0.35 * w, 0.5 * h, 0.4 * d,  -0.35 * w, 0.5 * h, 0.4 * d,  -0.35 * w, 0.5 * h, -0.4 * d,  0.35 * w, 0.5 * h, -0.4 * d,
        -0.5 * w, -0.5 * h, 0.7 * d,   0.5 * w, -0.5 * h, 0.7 * d,   0.5 * w, -0.5 * h, -0.7 * d, -0.5 * w, -0.5 * h, -0.7 * d,
         0.5 * w, -0.5 * h, 0.7 * d,   0.35 * w, 0.5 * h, 0.4 * d,   0.35 * w, 0.5 * h, -0.4 * d,  0.5 * w, -0.5 * h, -0.7 * d,
        -0.5 * w, -0.5 * h, 0.7 * d,  -0.35 * w, 0.5 * h, 0.4 * d,  -0.35 * w, 0.5 * h, -0.4 * d, -0.5 * w, -0.5 * h, -0.7 * d,
        -0.35 * w, 0.5 * h, 0.4 * d,   0.35 * w, 0.5 * h, 0.4 * d,   0.0 * w, 0.6 * h, 0.35 * d,
        -0.35 * w, 0.5 * h, -0.4 * d,  0.35 * w, 0.5 * h, -0.4 * d,  0.0 * w, 0.6 * h, -0.35 * d,
         0.35 * w, 0.5 * h, 0.4 * d,   0.35 * w, 0.5 * h, -0.4 * d,  0.0 * w, 0.6 * h, -0.35 * d,  0.0 * w, 0.6 * h, 0.35 * d,
        -0.35 * w, 0.5 * h, 0.4 * d,  -0.35 * w, 0.5 * h, -0.4 * d,  0.0 * w, 0.6 * h, -0.35 * d,  0.0 * w, 0.6 * h, 0.35 * d,
    ];

    const rawUvs = [
        0.5, 0.5,   0.75, 0.5,   0.75 - 0.25 / 8, 1.0,   0.5 + 0.25 / 8, 1.0,
        0.5, 0.5,   0.25, 0.5,   0.25 + 0.25 / 8, 1.0,   0.5 - 0.25 / 8, 1.0,
        0.75, 0.5,  0.5, 0.5,    0.5, 0.0,   0.75, 0.0,
        0.0, 0.5,   0.25, 0.5,   0.25, 1.0,   0.0, 1.0,
        0.0, 0.5,   0.0, 0.0,    0.25, 0.0,   0.25, 0.5,
        0.5, 0.5,   0.5, 0.0,    0.25, 0.0,   0.25, 0.5,
        0.75, 0.0,  1.0, 0.0,    1.0, 0.5,
        0.75, 0.0,  1.0, 0.0,    1.0, 0.5,
        0.75, 0.0,  1.0, 0.0,    1.0, 0.5,   0.75, 0.5,
        0.75, 0.0,  1.0, 0.0,    1.0, 0.5,   0.75, 0.5,
    ];
    // Bake the u -> 1 - u flip (original texture uScale=-1, uOffset=1).
    const uvs = new Float32Array(rawUvs.length);
    for (let i = 0; i < rawUvs.length; i += 2) {
        uvs[i] = 1 - rawUvs[i];
        uvs[i + 1] = rawUvs[i + 1];
    }

    const indices = new Uint32Array([
        0, 1, 2, 0, 2, 3,
        4, 5, 6, 4, 6, 7,
        8, 9, 10, 8, 10, 11,
        12, 13, 14, 12, 14, 15,
        16, 17, 18, 16, 18, 19,
        20, 21, 22, 20, 22, 23,
        24, 25, 26,
        27, 28, 29,
        30, 33, 31, 33, 32, 31,
        34, 35, 36, 34, 36, 37,
    ]);

    const pos = new Float32Array(positions);
    const normals = new Float32Array(pos.length);
    for (let t = 0; t < indices.length; t += 3) {
        const a = indices[t] * 3, b = indices[t + 1] * 3, c = indices[t + 2] * 3;
        const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
        const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        normals[a] += nx; normals[a + 1] += ny; normals[a + 2] += nz;
        normals[b] += nx; normals[b + 1] += ny; normals[b + 2] += nz;
        normals[c] += nx; normals[c + 1] += ny; normals[c + 2] += nz;
    }
    for (let i = 0; i < normals.length; i += 3) {
        const l = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1;
        normals[i] /= l; normals[i + 1] /= l; normals[i + 2] /= l;
    }

    return { positions: pos, normals, uvs, indices };
}

function randomRange(min, max) {
    return Math.random() * (max - min) + min;
}

function randomSpawn() {
    return {
        x: (Math.random() - 0.5) * 15,
        y: (Math.random() + 1.0) * 15,
        z: (Math.random() - 0.5) * 15,
    };
}

// Random yaw/pitch/roll within [0, PI] -> quaternion (YXZ order, matching Babylon).
function randomQuaternion() {
    const yaw = randomRange(0, Math.PI), pitch = randomRange(0, Math.PI), roll = randomRange(0, Math.PI);
    const hy = yaw * 0.5, hp = pitch * 0.5, hr = roll * 0.5;
    const cy = Math.cos(hy), sy = Math.sin(hy);
    const cp = Math.cos(hp), sp = Math.sin(hp);
    const cr = Math.cos(hr), sr = Math.sin(hr);
    return {
        x: cy * sp * cr + sy * cp * sr,
        y: sy * cp * cr - cy * sp * sr,
        z: cy * cp * sr - sy * sp * cr,
        w: cy * cp * cr + sy * sp * sr,
    };
}

async function main() {
    const canvas = document.getElementById('c');
    const engine = await createEngine(canvas);
    const scene = createSceneContext(engine);
    scene.fixedDeltaMs = 1000 / PHYSICS_FPS;
    scene.clearColor = { r: 0.17, g: 0.18, b: 0.22, a: 1.0 };

    const camera = createArcRotateCamera(-Math.PI / 2, Math.PI / 2, 40, { x: 0, y: 0, z: 0 });
    camera.fov = 45 * Math.PI / 180;
    camera.nearPlane = 0.1;
    camera.farPlane = 1000;
    scene.camera = camera;
    attachControl(camera, canvas, scene);

    const hemi = createHemisphericLight([1, 1, 0]);
    hemi.intensity = 0.9;
    addToScene(scene, hemi);

    const dir = createDirectionalLight([-0.4, -1.0, -0.3]);
    dir.intensity = 1.4;
    dir.position.set(30, 100, 50);
    addToScene(scene, dir);

    const shadowGenerator = createPcfDirectionalShadowGenerator(engine, dir, { mapSize: 1024, bias: 5e-4 });
    dir.shadowGenerator = shadowGenerator;

    // IBL + BRDF LUT required by PBR materials (also enables tone mapping). No skybox.
    await loadEnvironment(scene, ENV_URL, { brdfUrl: BRDF_URL });

    const groundMat = createStandardMaterial();
    groundMat.diffuseColor = [0.24, 0.25, 0.28];
    groundMat.specularColor = [0, 0, 0];

    // Lite applies gamma + tone mapping to PBR materials but not to StandardMaterial (which is
    // written linear), so the pieces use PBR to match the bright, gamma-correct Babylon.js look.
    // PBR treats baseColor as sRGB, so the texture is loaded with srgb: true.
    const pieceTex = await loadTexture2D(engine, '../../../../assets/textures/shogi_001/shogi.png', {
        addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge', invertY: false, srgb: true,
    });
    // PBR always binds a baseColor and an ORM (occlusion/roughness/metallic) texture, so supply a
    // 1x1 white ORM; the metallic/roughness factors then set the actual values (matte, non-metal).
    const ormTex = createSolidTexture2D(engine, 1, 1, 1, 1);
    const pieceMat = createPbrMaterial({
        baseColorTexture: pieceTex,
        ormTexture: ormTex,
        baseColorFactor: [1, 1, 1, 1],
        metallicFactor: 0,
        roughnessFactor: 0.9,
        doubleSided: true,
    });

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

    // Floor: 13 x 0.1 x 13 slab at y = -10. Built from a unit cube; collider sized via extents.
    const ground = createBox(engine, 1);
    ground.scaling.set(GROUND_PHYSICS_SIZE[0], GROUND_PHYSICS_SIZE[1], GROUND_PHYSICS_SIZE[2]);
    ground.position.set(0, -10, 0);
    ground.material = groundMat;
    ground.receiveShadows = true;
    addToScene(scene, ground);
    const groundAgg = createPhysicsAggregate(world, ground, PhysicsShapeType.BOX, {
        mass: 0, friction: 0.5, restitution: 0.0,
        extents: { x: GROUND_PHYSICS_SIZE[0], y: GROUND_PHYSICS_SIZE[1], z: GROUND_PHYSICS_SIZE[2] },
    });
    allBodies.push(groundAgg.body);

    const data = createShogiVertexData(1.6, 1.6, 0.32);
    const pieces = [];
    const casterMeshes = [];
    for (let i = 0; i < PIECE_COUNT; i++) {
        const mesh = createMeshFromData(engine, 'shogiPiece', data.positions, data.normals, data.indices, data.uvs);
        const spawn = randomSpawn();
        mesh.position.set(spawn.x, spawn.y, spawn.z);
        const q = randomQuaternion();
        mesh.rotationQuaternion.set(q.x, q.y, q.z, q.w);
        mesh.material = pieceMat;
        mesh.receiveShadows = true;
        addToScene(scene, mesh);
        const agg = createPhysicsAggregate(world, mesh, PhysicsShapeType.BOX, {
            mass: 1, friction: 0.5, restitution: 0.0,
            extents: { x: SHOGI_PHYSICS_SIZE[0], y: SHOGI_PHYSICS_SIZE[1], z: SHOGI_PHYSICS_SIZE[2] },
        });
        pieces.push({ mesh, body: agg.body });
        casterMeshes.push(mesh);
        allBodies.push(agg.body);
    }

    setShadowTaskCasterMeshes(shadowGenerator, casterMeshes);

    // Recycle pieces that fall below the floor.
    onBeforeRender(scene, () => {
        for (const piece of pieces) {
            if (piece.mesh.position.y < -15) {
                const spawn = randomSpawn();
                const q = randomQuaternion();
                setPhysicsBodyPreStep(piece.body, true);
                piece.mesh.position.set(spawn.x, spawn.y, spawn.z);
                piece.mesh.rotationQuaternion.set(q.x, q.y, q.z, q.w);
                setPhysicsBodyLinearVelocity(world, piece.body, { x: 0, y: 0, z: 0 });
                setPhysicsBodyAngularVelocity(world, piece.body, { x: 0, y: 0, z: 0 });
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

    await registerSceneWithShadowSupport(scene);
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
