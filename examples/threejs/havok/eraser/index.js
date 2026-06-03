import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// three.js (rendering) + Havok low-level API (physics). Textured box erasers rain into a
// walled basket on a grass floor; each collider is a box matching the eraser's extents.

const FIXED_TIMESTEP = 1 / 60;
const IDENTITY_QUATERNION = [0, 0, 0, 1];
const ERASER_COUNT = 200;
const SCALE = 2;
const MESH_W = 1.0, MESH_H = 0.2, MESH_D = 0.5;
const HALF = [MESH_W * SCALE, MESH_H * SCALE, MESH_D * SCALE]; // 2.0, 0.4, 1.0

let HK, worldId;
let scene, camera, renderer, controls;
const meshes = [];
const bodyIds = [];
const debugMeshes = [];
const staticDebugMeshes = [];
let showWireframe = true;

function createStaticBox(size, pos, mat) {
    const sRes = HK.HP_Shape_CreateBox([0, 0, 0], IDENTITY_QUATERNION, size);
    const bodyId = HK.HP_Body_Create()[1];
    HK.HP_Body_SetShape(bodyId, sRes[1]);
    HK.HP_Body_SetMotionType(bodyId, HK.MotionType.STATIC);
    HK.HP_Body_SetPosition(bodyId, pos);
    HK.HP_Body_SetOrientation(bodyId, IDENTITY_QUATERNION);
    HK.HP_World_AddBody(worldId, bodyId, false);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), mat);
    mesh.position.set(pos[0], pos[1], pos[2]);
    mesh.receiveShadow = true;
    scene.add(mesh);
    const dbg = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(size[0], size[1], size[2])),
        new THREE.LineBasicMaterial({ color: 0x44ee88 })
    );
    dbg.position.set(pos[0], pos[1], pos[2]);
    dbg.visible = showWireframe;
    scene.add(dbg);
    staticDebugMeshes.push(dbg);
}

function randomQuaternion() {
    const euler = new THREE.Euler(Math.random() * Math.PI * 2, Math.random() * Math.PI * 2, Math.random() * Math.PI * 2);
    return new THREE.Quaternion().setFromEuler(euler);
}

function spawnTransform() {
    return {
        pos: [(Math.random() - 0.5) * 10, 20 + Math.random() * 12, (Math.random() - 0.5) * 10],
        q: randomQuaternion(),
    };
}

function initThree() {
    const container = document.getElementById('container');
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x8088cc);
    scene.add(new THREE.HemisphereLight(0xbfd6ff, 0x444444, 1.0));
    scene.add(new THREE.AmbientLight(0x666666, 1.0));

    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 1000);
    camera.position.set(0, 14, 44);

    const light = new THREE.DirectionalLight(0xffffff, 2.0);
    light.position.set(30, 100, 50);
    light.castShadow = true;
    scene.add(light);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    container.appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 3, 0);
    controls.autoRotate = true;
    controls.autoRotateSpeed = 1.0;

    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });
}

function initPhysics() {
    worldId = HK.HP_World_Create()[1];
    HK.HP_World_SetGravity(worldId, [0, -9.81, 0]);
    HK.HP_World_SetIdealStepTime(worldId, FIXED_TIMESTEP);

    const loader = new THREE.TextureLoader();
    const grassTex = loader.load('../../../../assets/textures/grass.jpg');
    grassTex.wrapS = grassTex.wrapT = THREE.RepeatWrapping;
    grassTex.repeat.set(4, 4);
    const groundMat = new THREE.MeshLambertMaterial({ map: grassTex });
    const wallMat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.4 });

    createStaticBox([40, 4, 40], [0, -2, 0], groundMat);
    const wallData = [
        { size: [10, 10, 1], pos: [0, 5, -5] },
        { size: [10, 10, 1], pos: [0, 5, 5] },
        { size: [1, 10, 10], pos: [-5, 5, 0] },
        { size: [1, 10, 10], pos: [5, 5, 0] },
    ];
    for (const { size, pos } of wallData) createStaticBox(size, pos, wallMat);

    // Six separate face textures mapped onto a BoxGeometry (one material per face), the same
    // reliable layout as the three.js + Oimo eraser, so every "MOMO" face reads correctly.
    const faceNames = ['right', 'left', 'top', 'bottom', 'front', 'back']; // +x,-x,+y,-y,+z,-z
    const eraserMats = faceNames.map((name) => {
        const tex = loader.load(`../../../../assets/textures/eraser_003/eraser_${name}.png`);
        tex.colorSpace = THREE.SRGBColorSpace;
        return new THREE.MeshLambertMaterial({ map: tex });
    });

    const eraserShape = HK.HP_Shape_CreateBox([0, 0, 0], IDENTITY_QUATERNION, [HALF[0] * 2, HALF[1] * 2, HALF[2] * 2])[1];
    const eraserMass = HK.HP_Shape_BuildMassProperties(eraserShape)[1];
    const eraserGeo = new THREE.BoxGeometry(HALF[0] * 2, HALF[1] * 2, HALF[2] * 2);

    for (let i = 0; i < ERASER_COUNT; i++) {
        const t = spawnTransform();
        const bodyId = HK.HP_Body_Create()[1];
        HK.HP_Body_SetShape(bodyId, eraserShape);
        HK.HP_Body_SetMotionType(bodyId, HK.MotionType.DYNAMIC);
        HK.HP_Body_SetMassProperties(bodyId, eraserMass);
        HK.HP_Body_SetPosition(bodyId, t.pos);
        HK.HP_Body_SetOrientation(bodyId, [t.q.x, t.q.y, t.q.z, t.q.w]);
        HK.HP_World_AddBody(worldId, bodyId, false);
        bodyIds.push(bodyId);

        const mesh = new THREE.Mesh(eraserGeo, eraserMats);
        scene.add(mesh);
        meshes.push(mesh);

        const dbg = new THREE.LineSegments(
            new THREE.EdgesGeometry(new THREE.BoxGeometry(HALF[0] * 2, HALF[1] * 2, HALF[2] * 2)),
            new THREE.LineBasicMaterial({ color: 0xffcc22 })
        );
        dbg.visible = showWireframe;
        scene.add(dbg);
        debugMeshes.push(dbg);
    }
}

function updatePhysics() {
    HK.HP_World_Step(worldId, FIXED_TIMESTEP);
    for (let i = 0; i < bodyIds.length; i++) {
        const [, pos] = HK.HP_Body_GetPosition(bodyIds[i]);
        const [, ori] = HK.HP_Body_GetOrientation(bodyIds[i]);
        meshes[i].position.set(pos[0], pos[1], pos[2]);
        meshes[i].quaternion.set(ori[0], ori[1], ori[2], ori[3]);
        debugMeshes[i].position.set(pos[0], pos[1], pos[2]);
        debugMeshes[i].quaternion.set(ori[0], ori[1], ori[2], ori[3]);

        if (pos[1] < -10) {
            const t = spawnTransform();
            HK.HP_Body_SetPosition(bodyIds[i], t.pos);
            HK.HP_Body_SetOrientation(bodyIds[i], [t.q.x, t.q.y, t.q.z, t.q.w]);
            HK.HP_Body_SetLinearVelocity(bodyIds[i], [0, 0, 0]);
            HK.HP_Body_SetAngularVelocity(bodyIds[i], [0, 0, 0]);
        }
    }
}

function loop() {
    renderer.render(scene, camera);
    controls.update();
    requestAnimationFrame(loop);
}

function setWireframeVisible(visible) {
    showWireframe = visible;
    for (const dbg of staticDebugMeshes) dbg.visible = visible;
    for (const dbg of debugMeshes) dbg.visible = visible;
    const hint = document.getElementById('hint');
    if (hint) hint.textContent = 'W: wireframe ' + (visible ? 'ON' : 'OFF');
}

async function main() {
    HK = await HavokPhysics();
    initThree();
    initPhysics();
    window.addEventListener('keydown', (e) => {
        if (e.repeat) return;
        if (e.code === 'KeyW' || e.key === 'w' || e.key === 'W') setWireframeVisible(!showWireframe);
    });
    setInterval(updatePhysics, 1000 / 60);
    loop();
}

main().catch(console.error);
