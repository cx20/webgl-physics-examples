const HAVOK_WASM_URL = 'https://cx20.github.io/gltf-test/libs/babylonjs/dev/HavokPhysics.wasm';
const BASE_URL = 'https://cx20.github.io/gltf-test';
const BASE_URL2 = 'https://cx20.github.io/webgl-physics-examples';
const PHYSICS_SCALE = 1 / 10;

const TEXTURE_FLOOR = '../../../../assets/textures/floor_bump.png';
const TEXTURE_ROCK = '../../../../assets/textures/rockn.png';

let engine;
let scene;
let canvas;

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

const randomNumber = (min, max) => {
    if (min == max) {
        return min;
    }
    const random = Math.random();
    return (random * (max - min)) + min;
};

const getNextPosition = (y) => {
    return new BABYLON.Vector3(
        randomNumber(-25, 25) * PHYSICS_SCALE,
        (randomNumber(0, 10) + y) * PHYSICS_SCALE,
        randomNumber(-25, 25) * PHYSICS_SCALE
    );
};

async function init() {
    canvas = document.querySelector('#c');
    engine = new BABYLON.Engine(canvas, true);
    scene = await createScene();

    engine.runRenderLoop(function () {
        scene.render();
    });
}

const createScene = async function() {
    const scene = new BABYLON.Scene(engine);

    const camera = new BABYLON.ArcRotateCamera('camera', -Math.PI / 180 * 30, Math.PI / 180 * 76, 24, BABYLON.Vector3.Zero(), scene);
    camera.setTarget(new BABYLON.Vector3(0, -8, 0));
    camera.attachControl(canvas, true);

    const cubeTexture = new BABYLON.CubeTexture(BASE_URL + '/textures/env/papermillSpecularHDR.env', scene);
    scene.environmentTexture = cubeTexture;
    scene.createDefaultSkybox(cubeTexture, true);
    new BABYLON.HemisphericLight('light0', new BABYLON.Vector3(1, 1, 0), scene);

    const meshes = [];

    const result = await BABYLON.SceneLoader.ImportMeshAsync(null, BASE_URL + '/sampleModels/Duck/glTF/', 'Duck.gltf', scene);

    const mesh = result.meshes[1];
    mesh.isVisible = false;
    const positions = mesh.getVerticesData(BABYLON.VertexBuffer.PositionKind);
    const indices = mesh.getIndices();

    const havokInstance = await HavokPhysics({
        locateFile: function (path) {
            if (path && path.endsWith('.wasm')) {
                return HAVOK_WASM_URL;
            }
            return path;
        }
    });
    const havokPlugin = new BABYLON.HavokPlugin(true, havokInstance);
    scene.enablePhysics(new BABYLON.Vector3(0, -9.81, 0), havokPlugin);
    setupPhysicsDebugWireframe(scene);

    const ground = BABYLON.MeshBuilder.CreateGround('ground', { width: 20, height: 20 }, scene);
    ground.position.y = -10;
    new BABYLON.PhysicsAggregate(ground, BABYLON.PhysicsShapeType.BOX, { mass: 0 }, scene);

    const makeCoinMesh = (coinType) => {
        const params = {
            GOLD: { metallic: 1.0, roughness: 0.2, color: [1.000, 0.766, 0.336], texture: TEXTURE_FLOOR, height: 0.1, diameter: 1.0 },
            SILVER: { metallic: 1.0, roughness: 0.4, color: [0.972, 0.960, 0.915], texture: TEXTURE_ROCK, height: 0.075, diameter: 0.8 },
            COPPER: { metallic: 1.0, roughness: 0.2, color: [0.955, 0.637, 0.538], texture: TEXTURE_ROCK, height: 0.05, diameter: 0.6 },
        };

        const param = params[coinType];
        const mat = new BABYLON.PBRMaterial('material_' + coinType, scene);
        mat.metallic = param.metallic;
        mat.roughness = param.roughness;
        mat.forceIrradianceInFragment = true;
        mat.albedoColor = new BABYLON.Color3(param.color[0], param.color[1], param.color[2]);
        mat.bumpTexture = new BABYLON.Texture(param.texture, scene);

        const faceUV = [];
        faceUV[0] = new BABYLON.Vector4(0, 0, 1.00, 1);
        faceUV[1] = new BABYLON.Vector4(1, 0, 0.32, 1);
        faceUV[2] = new BABYLON.Vector4(0, 0, 1.00, 1);

        const coinMesh = BABYLON.MeshBuilder.CreateCylinder('cylinder', {
            height: param.height,
            diameter: param.diameter,
            faceUV: faceUV,
        }, scene);
        coinMesh.material = mat;
        coinMesh.isVisible = false;
        return coinMesh;
    };

    const coinTypes = ['GOLD', 'SILVER', 'COPPER'];
    const coinMeshHash = {};
    coinTypes.forEach((type) => {
        coinMeshHash[type] = makeCoinMesh(type);
    });

    const numberOfIndices = indices.length;
    const coinInterval = 3;

    for (let i = 0; i < numberOfIndices; i += coinInterval) {
        const coinType = coinTypes[Math.floor(coinTypes.length * Math.random())];
        const newInstance = coinMeshHash[coinType].createInstance('coin_instance_' + i);
        newInstance.parent = null;
        newInstance.scaling = new BABYLON.Vector3(1, 1, 1);
        newInstance.position.x = positions[indices[i] * 3 + 0] * 0.1;
        newInstance.position.y = positions[indices[i] * 3 + 1] * 0.1 - 10;
        newInstance.position.z = positions[indices[i] * 3 + 2] * 0.1;

        new BABYLON.PhysicsAggregate(
            newInstance,
            BABYLON.PhysicsShapeType.SPHERE,
            { mass: 1, friction: 0.4, restitution: 0.8 },
            scene
        );

        meshes.push(newInstance);
    }
    console.log('Total coins:', meshes.length);

    scene.onBeforeRenderObservable.add(() => {
        meshes.forEach((mesh) => {
            if (mesh.position.y < -50) {
                const body = mesh.physicsBody || (mesh.aggregate && mesh.aggregate.body);
                const pos = getNextPosition(100);

                body.disablePreStep = false;
                body.transformNode.position.set(pos.x, pos.y, pos.z);
                body.setLinearVelocity(new BABYLON.Vector3(0, 0, 0));
                body.setAngularVelocity(new BABYLON.Vector3(0, 0, 0));
            }
        });
    });

    return scene;
};

init().catch(function (error) {
    console.error(error);
});
