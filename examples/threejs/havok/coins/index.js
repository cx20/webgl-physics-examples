import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HDRCubeTextureLoader } from 'three/addons/loaders/HDRCubeTextureLoader.js';

const DUCK_GLTF_URL = 'https://cx20.github.io/gltf-test/sampleModels/Duck/glTF/Duck.gltf';
const HDR_CUBE_BASE = 'https://cx20.github.io/gltf-test/textures/papermill_hdr/specular/';
const TEXTURE_FLOOR = '../../../../assets/textures/grass.jpg';
const TEXTURE_COIN_NORMAL = '../../../../assets/textures/rockn.png';

const PHYSICS_SCALE = 0.1;
const COIN_INTERVAL = 6;
const MAX_COINS = 6000;
const GROUND_Y = -10;
const FIXED_TIMESTEP = 1 / 60;
const IDENTITY_QUATERNION = [0, 0, 0, 1];

const COIN_TYPES = {
    GOLD:   { color: 0xffc356, height: 0.10,  diameter: 1.0, metalness: 1.0, roughness: 0.20 },
    SILVER: { color: 0xf8f5ea, height: 0.075, diameter: 0.8, metalness: 1.0, roughness: 0.40 },
    COPPER: { color: 0xf3a28a, height: 0.05,  diameter: 0.6, metalness: 1.0, roughness: 0.20 },
};
const COIN_TYPE_NAMES = ['GOLD', 'SILVER', 'COPPER'];

let HK, worldId;
let scene, camera, renderer, controls;
let coinNormalTexture;
let groundTexture;

const coinInstancedMeshes = {};
const coinDebugInstancedMeshes = {};
let groundDebugMesh;
const coins = [];
let showWireframe = true;

const tmpMatrix = new THREE.Matrix4();
const tmpPosition = new THREE.Vector3();
const tmpQuaternion = new THREE.Quaternion();
const tmpScale = new THREE.Vector3();

function rand(min, max) {
    return min + Math.random() * (max - min);
}

function enumToNumber(value) {
    if (typeof value === 'number' || typeof value === 'bigint') return Number(value);
    if (!value || typeof value !== 'object') return NaN;
    if (typeof value.value === 'number' || typeof value.value === 'bigint') return Number(value.value);
    if (typeof value.m_value === 'number' || typeof value.m_value === 'bigint') return Number(value.m_value);
    return NaN;
}

function checkResult(result, label) {
    if (result === HK.Result.RESULT_OK) return;
    const rc = enumToNumber(result);
    const ok = enumToNumber(HK.Result.RESULT_OK);
    if (!Number.isNaN(rc) && !Number.isNaN(ok) && rc === ok) return;
    console.warn('[Havok] ' + label + ' returned:', result);
}

function initThree() {
    const container = document.getElementById('container');
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    container.appendChild(renderer.domElement);

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1e1e22);

    new HDRCubeTextureLoader().load([
        'specular_posx_0.hdr', 'specular_negx_0.hdr',
        'specular_posy_0.hdr', 'specular_negy_0.hdr',
        'specular_posz_0.hdr', 'specular_negz_0.hdr',
    ].map(f => HDR_CUBE_BASE + f), (hdrCubeMap) => {
        hdrCubeMap.mapping = THREE.CubeReflectionMapping;
        const pmrem = new THREE.PMREMGenerator(renderer);
        pmrem.compileCubemapShader();
        scene.environment = pmrem.fromCubemap(hdrCubeMap).texture;
        scene.background = hdrCubeMap;
        pmrem.dispose();
    });

    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 1000);
    camera.position.set(0, -2, 20);
    camera.lookAt(0, -7, 0);

    scene.add(new THREE.AmbientLight(0xffffff, 0.4));
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
    dirLight.position.set(20, 40, 30);
    scene.add(dirLight);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, -7, 0);
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.6;
    controls.update();

    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });
}

function initTextures() {
    const loader = new THREE.TextureLoader();
    coinNormalTexture = loader.load(TEXTURE_COIN_NORMAL);
    coinNormalTexture.wrapS = coinNormalTexture.wrapT = THREE.RepeatWrapping;

    groundTexture = loader.load(TEXTURE_FLOOR);
    groundTexture.wrapS = groundTexture.wrapT = THREE.RepeatWrapping;
    groundTexture.repeat.set(3, 3);
    groundTexture.colorSpace = THREE.SRGBColorSpace;
}

function buildGround() {
    const groundGeom = new THREE.BoxGeometry(20, 1, 20);
    const groundMat = new THREE.MeshBasicMaterial({ map: groundTexture });
    const groundMesh = new THREE.Mesh(groundGeom, groundMat);
    groundMesh.position.set(0, GROUND_Y - 0.5, 0);
    scene.add(groundMesh);

    groundDebugMesh = new THREE.LineSegments(
        new THREE.EdgesGeometry(groundGeom),
        new THREE.LineBasicMaterial({ color: 0x00ff00 })
    );
    groundDebugMesh.position.copy(groundMesh.position);
    groundDebugMesh.visible = showWireframe;
    scene.add(groundDebugMesh);
}

function buildCoinInstancedMeshes(coinCountByType) {
    for (const typeName of COIN_TYPE_NAMES) {
        const params = COIN_TYPES[typeName];
        const radius = params.diameter * 0.5;
        const count = coinCountByType[typeName] || 0;
        if (count === 0) continue;

        const geom = new THREE.CylinderGeometry(radius, radius, params.height, 32);
        const mat = new THREE.MeshStandardMaterial({
            color: params.color,
            metalness: params.metalness,
            roughness: params.roughness,
            normalMap: coinNormalTexture,
            normalScale: new THREE.Vector2(0.6, 0.6),
        });

        const instanced = new THREE.InstancedMesh(geom, mat, count);
        instanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        instanced.frustumCulled = false;
        scene.add(instanced);
        coinInstancedMeshes[typeName] = { mesh: instanced, nextIndex: 0 };

        const debugInstanced = new THREE.InstancedMesh(
            new THREE.SphereGeometry(radius, 16, 12),
            new THREE.MeshBasicMaterial({ color: 0xffff00, wireframe: true }),
            count
        );
        debugInstanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        debugInstanced.frustumCulled = false;
        debugInstanced.visible = showWireframe;
        scene.add(debugInstanced);
        coinDebugInstancedMeshes[typeName] = { mesh: debugInstanced, nextIndex: 0 };
    }
}

function initPhysics() {
    const worldRes = HK.HP_World_Create();
    checkResult(worldRes[0], 'HP_World_Create');
    worldId = worldRes[1];
    checkResult(HK.HP_World_SetGravity(worldId, [0, -9.81, 0]), 'HP_World_SetGravity');
    checkResult(HK.HP_World_SetIdealStepTime(worldId, FIXED_TIMESTEP), 'HP_World_SetIdealStepTime');

    const groundShapeR = HK.HP_Shape_CreateBox([0, 0, 0], IDENTITY_QUATERNION, [20, 1, 20]);
    checkResult(groundShapeR[0], 'HP_Shape_CreateBox ground');
    const groundBodyR = HK.HP_Body_Create();
    checkResult(groundBodyR[0], 'HP_Body_Create ground');
    HK.HP_Body_SetShape(groundBodyR[1], groundShapeR[1]);
    HK.HP_Body_SetMotionType(groundBodyR[1], HK.MotionType.STATIC);
    HK.HP_Body_SetPosition(groundBodyR[1], [0, GROUND_Y - 0.5, 0]);
    HK.HP_Body_SetOrientation(groundBodyR[1], IDENTITY_QUATERNION);
    HK.HP_World_AddBody(worldId, groundBodyR[1], false);
}

async function loadDuckCoinPositions() {
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(DUCK_GLTF_URL);

    let positions = null;
    let indices = null;
    gltf.scene.traverse((child) => {
        if (positions || !child.isMesh) return;
        const geom = child.geometry;
        if (!geom || !geom.attributes.position) return;
        positions = geom.attributes.position.array;
        indices = geom.index ? geom.index.array : null;
    });
    if (!positions) throw new Error('Duck.gltf has no positions');

    const coinPositions = [];
    if (indices) {
        for (let i = 0; i < indices.length && coinPositions.length < MAX_COINS; i += COIN_INTERVAL) {
            const v = indices[i];
            coinPositions.push([
                positions[v * 3 + 0] * PHYSICS_SCALE,
                positions[v * 3 + 1] * PHYSICS_SCALE + GROUND_Y,
                positions[v * 3 + 2] * PHYSICS_SCALE,
            ]);
        }
    } else {
        for (let i = 0; i < positions.length / 3 && coinPositions.length < MAX_COINS; i += COIN_INTERVAL) {
            coinPositions.push([
                positions[i * 3 + 0] * PHYSICS_SCALE,
                positions[i * 3 + 1] * PHYSICS_SCALE + GROUND_Y,
                positions[i * 3 + 2] * PHYSICS_SCALE,
            ]);
        }
    }
    return coinPositions;
}

function spawnCoins(coinPositions) {
    const countByType = { GOLD: 0, SILVER: 0, COPPER: 0 };
    const typeAssignments = new Array(coinPositions.length);
    for (let i = 0; i < coinPositions.length; i++) {
        const typeName = COIN_TYPE_NAMES[Math.floor(Math.random() * COIN_TYPE_NAMES.length)];
        typeAssignments[i] = typeName;
        countByType[typeName]++;
    }
    buildCoinInstancedMeshes(countByType);

    for (let i = 0; i < coinPositions.length; i++) {
        const typeName = typeAssignments[i];
        const params = COIN_TYPES[typeName];
        const radius = params.diameter * 0.5;

        const ssRes = HK.HP_Shape_CreateSphere([0, 0, 0], radius);
        checkResult(ssRes[0], 'HP_Shape_CreateSphere coin');
        const shapeId = ssRes[1];
        HK.HP_Shape_SetDensity(shapeId, 1);
        const massR = HK.HP_Shape_BuildMassProperties(shapeId);
        checkResult(massR[0], 'HP_Shape_BuildMassProperties coin');

        const bodyR = HK.HP_Body_Create();
        checkResult(bodyR[0], 'HP_Body_Create coin');
        const bodyId = bodyR[1];
        HK.HP_Body_SetShape(bodyId, shapeId);
        HK.HP_Body_SetMotionType(bodyId, HK.MotionType.DYNAMIC);
        HK.HP_Body_SetMassProperties(bodyId, massR[1]);
        HK.HP_Body_SetPosition(bodyId, coinPositions[i]);
        HK.HP_Body_SetOrientation(bodyId, IDENTITY_QUATERNION);
        HK.HP_World_AddBody(worldId, bodyId, false);

        const instancedSlot = coinInstancedMeshes[typeName];
        const debugSlot = coinDebugInstancedMeshes[typeName];
        const instanceIndex = instancedSlot.nextIndex++;
        debugSlot.nextIndex++;

        coins.push({
            body: bodyId,
            typeName,
            params,
            radius,
            instanceIndex,
        });
    }
}

function getNextPosition() {
    return [
        rand(-25, 25) * PHYSICS_SCALE,
        rand(10, 20) * PHYSICS_SCALE + 10,
        rand(-25, 25) * PHYSICS_SCALE,
    ];
}

function updatePhysicsAndMeshes() {
    HK.HP_World_Step(worldId, FIXED_TIMESTEP);

    for (let i = 0; i < coins.length; i++) {
        const coin = coins[i];
        const [, pos] = HK.HP_Body_GetPosition(coin.body);
        const [, ori] = HK.HP_Body_GetOrientation(coin.body);

        if (pos[1] < -50) {
            const newPos = getNextPosition();
            HK.HP_Body_SetPosition(coin.body, newPos);
            HK.HP_Body_SetOrientation(coin.body, IDENTITY_QUATERNION);
            HK.HP_Body_SetLinearVelocity(coin.body, [0, 0, 0]);
            HK.HP_Body_SetAngularVelocity(coin.body, [0, 0, 0]);
            continue;
        }

        tmpPosition.set(pos[0], pos[1], pos[2]);
        tmpQuaternion.set(ori[0], ori[1], ori[2], ori[3]);
        tmpScale.set(1, 1, 1);
        tmpMatrix.compose(tmpPosition, tmpQuaternion, tmpScale);

        coinInstancedMeshes[coin.typeName].mesh.setMatrixAt(coin.instanceIndex, tmpMatrix);
        coinDebugInstancedMeshes[coin.typeName].mesh.setMatrixAt(coin.instanceIndex, tmpMatrix);
    }

    for (const typeName of COIN_TYPE_NAMES) {
        const slot = coinInstancedMeshes[typeName];
        if (slot) slot.mesh.instanceMatrix.needsUpdate = true;
        const dbg = coinDebugInstancedMeshes[typeName];
        if (dbg) dbg.mesh.instanceMatrix.needsUpdate = true;
    }
}

function setWireframeVisible(visible) {
    showWireframe = visible;
    if (groundDebugMesh) groundDebugMesh.visible = visible;
    for (const typeName of COIN_TYPE_NAMES) {
        const dbg = coinDebugInstancedMeshes[typeName];
        if (dbg) dbg.mesh.visible = visible;
    }
    const hint = document.getElementById('hint');
    if (hint) hint.textContent = 'W: wireframe ' + (visible ? 'ON' : 'OFF');
}

function loop() {
    updatePhysicsAndMeshes();
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(loop);
}

async function main() {
    HK = await HavokPhysics();
    initThree();
    initTextures();
    buildGround();
    initPhysics();

    const coinPositions = await loadDuckCoinPositions();
    spawnCoins(coinPositions);
    console.log('Total coins:', coins.length);

    window.addEventListener('keydown', (e) => {
        if (e.repeat) return;
        if (e.code === 'KeyW' || e.key === 'w' || e.key === 'W') {
            setWireframeVisible(!showWireframe);
        }
    });

    renderer.domElement.addEventListener('click', () => {
        for (const coin of coins) {
            HK.HP_Body_SetLinearVelocity(coin.body, [rand(-1, 1), rand(3, 6), rand(-1, 1)]);
        }
    });

    loop();
}

main().catch(console.error);
