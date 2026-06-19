import {
    addToScene, attachControl, createArcRotateCamera, createBox, createCylinder,
    createDirectionalLight, createEngine, createHavokWorld,
    createHemisphericLight, createPcfDirectionalShadowGenerator,
    createPhysicsAggregate, createPhysicsShape, createPhysicsViewer,
    createSceneContext, createStandardMaterial,
    hidePhysicsBody, loadTexture2D, onBeforeRender, PhysicsShapeType,
    registerSceneWithShadowSupport, setShadowTaskCasterMeshes,
    showPhysicsBody, startEngine,
    setPhysicsBodyAngularVelocity, setPhysicsBodyLinearVelocity, setPhysicsBodyPreStep,
} from 'https://cdn.jsdelivr.net/npm/@babylonjs/lite@1.2.0/index.js';
import HavokPhysics from 'https://cdn.jsdelivr.net/npm/@babylonjs/havok@1.3.12/lib/esm/HavokPhysics_es.js';

const PHYSICS_FPS = 60;
const CONE_COUNT = 120;
const SCALE = 1 / 50;

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

function spawnPosition() {
    return {
        x: 150 * SCALE,
        y: (100 + Math.random() * 1000) * SCALE,
        z: (-100 + Math.random() * 200) * SCALE,
    };
}

async function main() {
    const canvas = document.getElementById('c');
    const engine = await createEngine(canvas);
    const scene = createSceneContext(engine);
    scene.fixedDeltaMs = 1000 / PHYSICS_FPS;
    scene.clearColor = { r: 0.24, g: 0.25, b: 0.28, a: 1.0 };

    const camera = createArcRotateCamera(-Math.PI / 6, Math.PI / 3, 16, { x: 1.5, y: 1.0, z: 0 });
    scene.camera = camera;
    attachControl(camera, canvas, scene);

    const hemi = createHemisphericLight([1, 1, 0]);
    hemi.intensity = 0.8;
    addToScene(scene, hemi);

    const dir = createDirectionalLight([-0.4, -1.0, -0.3]);
    dir.intensity = 1.2;
    // Shadow camera sits at the light position with a fixed depth range, so keep it
    // well above the scene (opposite the light direction) to avoid near-plane clipping.
    dir.position.set(5, 20, 10);
    addToScene(scene, dir);

    const shadowGenerator = createPcfDirectionalShadowGenerator(engine, dir, { mapSize: 1024, bias: 5e-4 });
    dir.shadowGenerator = shadowGenerator;

    const carrotTex = await loadTexture2D(engine, '../../../../assets/textures/carrot.jpg');

    const coneMat = createStandardMaterial();
    coneMat.diffuseTexture = carrotTex;
    coneMat.backFaceCulling = false;

    const groundMat = createStandardMaterial();
    groundMat.diffuseColor = [0.24, 0.25, 0.28];
    groundMat.specularColor = [0, 0, 0];

    const rampMat = createStandardMaterial();
    rampMat.diffuseColor = [0.3, 0.32, 0.37];
    rampMat.alpha = 0.6;

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

    // Ground: 400 x 40 x 400 (scaled) at y = -20*SCALE. Built from a unit cube, so the
    // BOX collider size is passed explicitly via `extents` (node scaling is not synced).
    const GW = 400 * SCALE, GH = 40 * SCALE, GD = 400 * SCALE;
    const ground = createBox(engine, 1);
    ground.scaling.set(GW, GH, GD);
    ground.position.set(0, -20 * SCALE, 0);
    ground.material = groundMat;
    ground.receiveShadows = true;
    addToScene(scene, ground);
    const groundAgg = createPhysicsAggregate(world, ground, PhysicsShapeType.BOX, {
        mass: 0, friction: 0.5, restitution: 0.1, extents: { x: GW, y: GH, z: GD },
    });
    allBodies.push(groundAgg.body);

    // Ramp: 200 x 30 x 390 (scaled) at (130,40,0)*SCALE, rotated 32deg around Z.
    const RW = 200 * SCALE, RH = 30 * SCALE, RD = 390 * SCALE;
    const rampAngle = 32 * Math.PI / 180;
    const ramp = createBox(engine, 1);
    ramp.scaling.set(RW, RH, RD);
    ramp.position.set(130 * SCALE, 40 * SCALE, 0);
    ramp.rotationQuaternion.set(0, 0, Math.sin(rampAngle / 2), Math.cos(rampAngle / 2));
    ramp.material = rampMat;
    ramp.receiveShadows = true;
    addToScene(scene, ramp);
    const rampAgg = createPhysicsAggregate(world, ramp, PhysicsShapeType.BOX, {
        mass: 0, friction: 0.5, restitution: 0.1, extents: { x: RW, y: RH, z: RD },
    });
    allBodies.push(rampAgg.body);

    // Cone geometry (carrot): radiusTop 2.5, radiusBottom 12.5, height 50 (scaled by 1/50).
    const coneOpts = {
        diameterTop: 2 * 2.5 * SCALE,
        diameterBottom: 2 * 12.5 * SCALE,
        height: 50 * SCALE,
        tessellation: 30,
    };

    // One convex-hull shape built from a template cone is shared by every body.
    const templateCone = createCylinder(engine, coneOpts);
    const coneShape = createPhysicsShape(world, { type: PhysicsShapeType.CONVEX_HULL, mesh: templateCone });

    const cones = [];
    const casterMeshes = [];
    for (let i = 0; i < CONE_COUNT; i++) {
        const mesh = createCylinder(engine, coneOpts);
        const p = spawnPosition();
        mesh.position.set(p.x, p.y, p.z);
        const q = randomQuaternion();
        mesh.rotationQuaternion.set(q.x, q.y, q.z, q.w);
        mesh.material = coneMat;
        mesh.receiveShadows = true;
        addToScene(scene, mesh);
        const agg = createPhysicsAggregate(world, mesh, PhysicsShapeType.CONVEX_HULL, {
            mass: 1, friction: 0.4, restitution: 0.2, shape: coneShape,
        });
        cones.push({ mesh, body: agg.body });
        casterMeshes.push(mesh);
        allBodies.push(agg.body);
    }

    setShadowTaskCasterMeshes(shadowGenerator, casterMeshes);

    // Recycle cones that fall below the floor.
    onBeforeRender(scene, () => {
        for (const cone of cones) {
            if (cone.mesh.position.y < -100 * SCALE) {
                const p = spawnPosition();
                const q = randomQuaternion();
                setPhysicsBodyPreStep(cone.body, true);
                cone.mesh.position.set(p.x, p.y, p.z);
                cone.mesh.rotationQuaternion.set(q.x, q.y, q.z, q.w);
                setPhysicsBodyLinearVelocity(world, cone.body, { x: 0, y: 0, z: 0 });
                setPhysicsBodyAngularVelocity(world, cone.body, { x: 0, y: 0, z: 0 });
            }
        }
        camera.alpha -= 0.003;
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
