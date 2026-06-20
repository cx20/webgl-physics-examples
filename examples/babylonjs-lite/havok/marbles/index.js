import {
    addToScene, attachControl, createArcRotateCamera, createBox, createEngine,
    createHavokWorld, createHemisphericLight, createPbrMaterial, createPhysicsAggregate,
    createPhysicsViewer, createSceneContext, createSolidTexture2D, createTransformNode,
    hidePhysicsBody, loadEnvironment, loadGltf, loadTexture2D, onBeforeRender, PhysicsShapeType,
    registerScene, setMeshVisible, showPhysicsBody, startEngine,
    setPhysicsBodyAngularVelocity, setPhysicsBodyLinearVelocity, setPhysicsBodyPreStep,
} from '@babylonjs/lite';
import HavokPhysics from '@babylonjs/havok';

const BASE_URL = 'https://cx20.github.io/gltf-test';
const MODEL_URL = BASE_URL + '/tutorialModels/IridescenceMetallicSpheres/glTF/IridescenceMetallicSpheres.gltf';
const ENV_URL = BASE_URL + '/textures/env/papermillSpecularHDR.env';
const BRDF_URL = 'https://cdn.jsdelivr.net/gh/BabylonJS/Babylon-Lite@master/packages/babylon-lite/assets/brdf-lut.png';
const PHYSICS_SCALE = 1 / 10;
const PHYSICS_FPS = 60;

function randomNumber(min, max) {
    return min === max ? min : Math.random() * (max - min) + min;
}

function getNextPosition(y) {
    return {
        x: randomNumber(-50, 50) * PHYSICS_SCALE,
        y: (randomNumber(0, 200) + y) * PHYSICS_SCALE,
        z: randomNumber(-50, 50) * PHYSICS_SCALE,
    };
}

// Move a node under a new parent, updating both children arrays (not just the parent link).
function reparentNode(child, newParent) {
    const old = child.parent;
    if (old && Array.isArray(old.children)) {
        const i = old.children.indexOf(child);
        if (i >= 0) old.children.splice(i, 1);
    }
    child.parent = newParent;
    newParent.children.push(child);
}

// World-space AABB (centre + half-extents) of a mesh from its CPU positions.
function worldBounds(mesh) {
    const m = mesh.worldMatrix;
    const p = mesh._cpuPositions;
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < p.length; i += 3) {
        const x = p[i], y = p[i + 1], z = p[i + 2];
        const wx = m[0] * x + m[4] * y + m[8] * z + m[12];
        const wy = m[1] * x + m[5] * y + m[9] * z + m[13];
        const wz = m[2] * x + m[6] * y + m[10] * z + m[14];
        if (wx < min[0]) min[0] = wx; if (wx > max[0]) max[0] = wx;
        if (wy < min[1]) min[1] = wy; if (wy > max[1]) max[1] = wy;
        if (wz < min[2]) min[2] = wz; if (wz > max[2]) max[2] = wz;
    }
    return {
        center: { x: (min[0] + max[0]) / 2, y: (min[1] + max[1]) / 2, z: (min[2] + max[2]) / 2 },
        radius: Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2,
    };
}

async function main() {
    const canvas = document.getElementById('c');
    const engine = await createEngine(canvas);
    const scene = createSceneContext(engine);
    scene.fixedDeltaMs = 1000 / PHYSICS_FPS;

    const camera = createArcRotateCamera(0, Math.PI / 180 * 60, 30, { x: 0, y: 0, z: 0 });
    camera.farPlane = Math.max(camera.farPlane, 20000);
    scene.camera = camera;
    attachControl(camera, canvas, scene);

    const hemi = createHemisphericLight([1, 1, 0]);
    addToScene(scene, hemi);

    // IBL + skybox + BRDF LUT for the model's PBR materials. loadEnvironment also enables ACES
    // tone mapping (exposure 0.8), which lifts the HDR reflections into a bright, vivid range —
    // the metallic spheres are lit purely by this IBL, so the tone mapping is kept on (matching
    // the Babylon.js Lite glTF reference at cx20/gltf-test).
    await loadEnvironment(scene, ENV_URL, { brdfUrl: BRDF_URL, skyboxUrl: ENV_URL, skyboxSize: 10000, skipGround: true });

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

    // Ground slab (40 x ~0.4 x 40) at y = -15*SCALE, grass-textured to match the Babylon.js sample.
    const grassTex = await loadTexture2D(engine, '../../../../assets/textures/grass.jpg', { srgb: true });
    const groundMat = createPbrMaterial({
        baseColorTexture: grassTex,
        ormTexture: createSolidTexture2D(engine, 1, 1, 1, 1),
        metallicFactor: 0,
        roughnessFactor: 1,
        uvScale: [4, 4],
        _hasUvTx: true,
    });
    const ground = createBox(engine, 1);
    ground.scaling.set(400 * PHYSICS_SCALE, 0.4, 400 * PHYSICS_SCALE);
    ground.position.set(0, -15 * PHYSICS_SCALE, 0);
    ground.material = groundMat;
    addToScene(scene, ground);
    const groundAgg = createPhysicsAggregate(world, ground, PhysicsShapeType.BOX, {
        mass: 0, friction: 0.2, restitution: 0.3, extents: { x: 400 * PHYSICS_SCALE, y: 0.4, z: 400 * PHYSICS_SCALE },
    });
    allBodies.push(groundAgg.body);

    // Load the metallic spheres model; its PBR materials render via the loaded environment. The
    // glTF root is left untouched, including its -1 X scale (right-handed -> left-handed flip):
    // that flip is needed for correct normals/winding, and removing it broke the iridescent IBL
    // reflection (the spheres went near-black). This matches the Babylon.js Lite glTF reference,
    // which never modifies the loaded transform.
    const asset = await loadGltf(engine, MODEL_URL);
    addToScene(scene, asset);

    // The model is a flat hierarchy: each node is named SphereN (with a child mesh "Mesh_N") or is
    // a label plane (ThicknessPlane / IorPlane / ThinFilmIorPlane). Lite names meshes after the
    // glTF mesh ("Mesh_N"), so filter on the parent node's name, not the mesh name.
    //
    // The SphereN nodes sit under the loaded `__root__` whose -1 X scale flips right-handed glTF to
    // Babylon's left-handed space. Binding a body to a SphereN node would seed it from the node's
    // LOCAL (un-flipped) transform, so the body — and its W-key collider wireframe — would sit at the
    // mirror-X of the rendered mesh. Instead each sphere is driven by a TOP-LEVEL anchor placed at the
    // mesh's left-handed world position, with the SphereN reparented under it carrying the -1 X scale
    // (kept for correct normals / iridescent IBL). The body then lines up with the mesh.
    const root = asset.entities[0];
    const spheres = [];
    // Iterate a copy: reparenting below splices nodes out of root.children mid-loop.
    for (const node of [...root.children]) {
        const name = node.name || '';
        const childMeshes = (node.children || []).filter((c) => c._gpu && c._cpuPositions);
        if (name.indexOf('Plane') !== -1) {
            for (const m of childMeshes) setMeshVisible(m, false);
            continue;
        }
        if (name.indexOf('Sphere') === -1 || childMeshes.length === 0) continue;

        const { radius } = worldBounds(childMeshes[0]);
        // Small random offset like the Babylon.js sample (in the node's local frame).
        const px = node.position.x + Math.random();
        const py = node.position.y;
        const pz = node.position.z + Math.random();

        // Top-level anchor at the left-handed world position (the __root__ applies scale.x = -1).
        const anchor = createTransformNode(name + '_body');
        anchor.position.set(-px, py, pz);
        addToScene(scene, anchor);
        // Reparent the sphere under the anchor, keeping the -1 X (its normals/IBL depend on it).
        node.position.set(0, 0, 0);
        node.scaling.set(-1, 1, 1);
        reparentNode(node, anchor);

        const agg = createPhysicsAggregate(world, anchor, PhysicsShapeType.SPHERE, {
            mass: 1, friction: 0.1, restitution: 0.3, radius,
        });
        spheres.push({ anchor, body: agg.body });
        allBodies.push(agg.body);
    }

    // Recycle spheres that fall away.
    let lastFrameTime = 0;
    onBeforeRender(scene, () => {
        for (const s of spheres) {
            if (s.anchor.position.y < -100 * PHYSICS_SCALE) {
                const pos = getNextPosition(200);
                setPhysicsBodyPreStep(s.body, true);
                s.anchor.position.set(pos.x, pos.y, pos.z);
                setPhysicsBodyLinearVelocity(world, s.body, { x: 0, y: 0, z: 0 });
                setPhysicsBodyAngularVelocity(world, s.body, { x: 0, y: 0, z: 0 });
            }
        }
        // Framerate-independent spin to match the Babylon.js sample's getAnimationRatio()
        // (= deltaMs / (1000/60), i.e. 1.0 at 60 FPS).
        const now = performance.now();
        const animationRatio = lastFrameTime ? (now - lastFrameTime) / (1000 / 60) : 1;
        lastFrameTime = now;
        camera.alpha -= 0.005 * animationRatio;
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
