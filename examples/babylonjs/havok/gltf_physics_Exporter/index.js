// Babylon.js + Havok scene with glTF Physics exporter (KHR_physics_rigid_bodies + KHR_implicit_shapes).
// Schema follows eoineoineoin/glTF_Physics_Blender_Exporter so the output round-trips through the
// loader used by the gltf_physics_* samples in this repo.

const HAVOK_WASM_URL = 'https://cx20.github.io/gltf-test/libs/babylonjs/dev/HavokPhysics.wasm';
const PHYSICS_SCALE = 1 / 10;

const PHYSICS_SHAPES = []; // index parity for KHR_implicit_shapes
const PHYSICS_MATERIALS = []; // index parity for KHR_physics_rigid_bodies.physicsMaterials
const PHYSICS_BODIES = new Map(); // meshName -> { shape, material, motion? }

let engine;
let scene;
let canvas;

function registerShape(spec) {
    PHYSICS_SHAPES.push(spec);
    return PHYSICS_SHAPES.length - 1;
}

function registerMaterial(spec) {
    PHYSICS_MATERIALS.push(spec);
    return PHYSICS_MATERIALS.length - 1;
}

function tagBody(mesh, body) {
    PHYSICS_BODIES.set(mesh.name, body);
    mesh.metadata = mesh.metadata || {};
    mesh.metadata.initialPosition = mesh.position.clone();
    mesh.metadata.initialRotation = mesh.rotation.clone();
    mesh.metadata.initialRotationQuaternion = mesh.rotationQuaternion ? mesh.rotationQuaternion.clone() : null;
}

function withInitialPose(scene, fn) {
    // The Havok body updates the mesh transform each frame, so by the time the user
    // clicks Export the cube is mid-fall. Snap the mesh back to its initial transform
    // for the duration of the export, then restore.
    const restore = [];
    PHYSICS_BODIES.forEach(function (_body, name) {
        const mesh = scene.getMeshByName(name);
        if (!mesh || !mesh.metadata || !mesh.metadata.initialPosition) {
            return;
        }
        restore.push({
            mesh,
            position: mesh.position.clone(),
            rotation: mesh.rotation.clone(),
            rotationQuaternion: mesh.rotationQuaternion ? mesh.rotationQuaternion.clone() : null
        });
        mesh.position.copyFrom(mesh.metadata.initialPosition);
        if (mesh.metadata.initialRotationQuaternion) {
            mesh.rotationQuaternion = mesh.metadata.initialRotationQuaternion.clone();
        } else {
            mesh.rotationQuaternion = null;
            mesh.rotation.copyFrom(mesh.metadata.initialRotation);
        }
        mesh.computeWorldMatrix(true);
    });
    return Promise.resolve(fn()).finally(function () {
        restore.forEach(function (r) {
            r.mesh.position.copyFrom(r.position);
            if (r.rotationQuaternion) {
                r.mesh.rotationQuaternion = r.rotationQuaternion;
            } else {
                r.mesh.rotationQuaternion = null;
                r.mesh.rotation.copyFrom(r.rotation);
            }
            r.mesh.computeWorldMatrix(true);
        });
    });
}

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
    scene = createScene();

    engine.runRenderLoop(function () {
        scene.render();
    });

    const exportBtn = document.getElementById('exportBtn');
    const status = document.getElementById('status');
    exportBtn.addEventListener('click', async function () {
        exportBtn.disabled = true;
        status.textContent = 'Exporting...';
        try {
            await exportSceneAsGLB(scene, 'minimum_physics');
            status.textContent = 'Exported minimum_physics.glb';
        } catch (err) {
            console.error(err);
            status.textContent = 'Export failed: ' + err.message;
        } finally {
            exportBtn.disabled = false;
        }
    });
}

function createScene() {
    scene = new BABYLON.Scene(engine);
    scene.clearColor = new BABYLON.Color3(1, 1, 1);

    const hk = new BABYLON.HavokPlugin();
    scene.enablePhysics(new BABYLON.Vector3(0, -9.8, 0), hk);
    scene.getPhysicsEngine().setTimeStep(scene.getAnimationRatio());

    const camera = new BABYLON.ArcRotateCamera('Camera', 0, 0, 10, new BABYLON.Vector3(0, 0, 0), scene);
    camera.setPosition(new BABYLON.Vector3(0, 20 * PHYSICS_SCALE, -200 * PHYSICS_SCALE));
    camera.attachControl(canvas, true);

    // Lights are only added for the preview canvas — the loader side supplies its own
    // lighting, so we exclude them from the export via shouldExportNode below.
    const hemiLight = new BABYLON.HemisphericLight('hemiLight', new BABYLON.Vector3(0, 1, 0), scene);
    hemiLight.intensity = 0.9;
    const dirLight = new BABYLON.DirectionalLight('dirLight', new BABYLON.Vector3(-0.4, -1.0, -0.3), scene);
    dirLight.position = new BABYLON.Vector3(12, 16, 10);
    dirLight.intensity = 0.6;

    const material = new BABYLON.StandardMaterial('material', scene);
    material.diffuseTexture = new BABYLON.Texture('../../../../assets/textures/frog.jpg', scene);

    const groundSize = { width: 200 * PHYSICS_SCALE, height: 0.1, depth: 200 * PHYSICS_SCALE };
    const ground = BABYLON.MeshBuilder.CreateBox('ground', groundSize, scene);
    ground.material = material;
    ground.position.y = -20 * PHYSICS_SCALE;
    ground.aggregate = new BABYLON.PhysicsAggregate(
        ground, BABYLON.PhysicsShapeType.BOX,
        { mass: 0, friction: 0.1, restitution: 0.1 }, scene);

    const groundShape = registerShape({ type: 'box', box: { size: [groundSize.width, groundSize.height, groundSize.depth] } });
    const groundMat = registerMaterial({ staticFriction: 0.1, dynamicFriction: 0.1, restitution: 0.1 });
    tagBody(ground, {
        collider: { geometry: { shape: groundShape }, physicsMaterial: groundMat }
        // no motion → static
    });

    const cubeEdge = 50 * PHYSICS_SCALE;
    const cube = BABYLON.MeshBuilder.CreateBox('cube', { size: cubeEdge }, scene);
    cube.material = material;
    cube.position.y = 100 * PHYSICS_SCALE;
    cube.rotation.x = Math.PI * 10 / 180;
    cube.rotation.z = Math.PI * 10 / 180;
    cube.aggregate = new BABYLON.PhysicsAggregate(
        cube, BABYLON.PhysicsShapeType.BOX,
        { mass: 1, friction: 0.2, restitution: 0.5 }, scene);

    const cubeShape = registerShape({ type: 'box', box: { size: [cubeEdge, cubeEdge, cubeEdge] } });
    const cubeMat = registerMaterial({ staticFriction: 0.2, dynamicFriction: 0.2, restitution: 0.5 });
    tagBody(cube, {
        motion: { mass: 1 },
        collider: { geometry: { shape: cubeShape }, physicsMaterial: cubeMat }
    });

    scene.registerBeforeRender(function () {
        scene.activeCamera.alpha += Math.PI * 1.0 / 180.0 * scene.getAnimationRatio();
    });

    return scene;
}

// --- GLB exporter with physics extensions ---

const GLB_MAGIC = 0x46546C67;        // 'glTF'
const GLB_VERSION = 2;
const CHUNK_JSON = 0x4E4F534A;       // 'JSON'
const CHUNK_BIN  = 0x004E4942;       // 'BIN\0'

async function exportSceneAsGLB(scene, baseName) {
    await withInitialPose(scene, async function () {
        const gltfData = await BABYLON.GLTF2Export.GLBAsync(scene, baseName, {
            shouldExportNode: function (node) {
                // Strip lights — the consuming side supplies its own lighting.
                return !(node instanceof BABYLON.Light);
            }
        });
        const fileMap = gltfData.glTFFiles;
        const glbName = Object.keys(fileMap).find(function (k) { return k.endsWith('.glb'); });
        if (!glbName) {
            throw new Error('GLTF2Export did not produce a .glb');
        }

        const arrayBuffer = await fileMap[glbName].arrayBuffer();
        const { json, bin } = parseGLB(arrayBuffer);

        injectPhysicsExtensions(json);

        const outBuffer = buildGLB(json, bin);
        triggerDownload(outBuffer, baseName + '.glb');
    });
}

function parseGLB(arrayBuffer) {
    const dv = new DataView(arrayBuffer);
    if (dv.getUint32(0, true) !== GLB_MAGIC) {
        throw new Error('Not a GLB');
    }
    const totalLength = dv.getUint32(8, true);

    let cursor = 12;
    let json = null;
    let bin = null;

    while (cursor < totalLength) {
        const chunkLength = dv.getUint32(cursor, true);
        const chunkType   = dv.getUint32(cursor + 4, true);
        const dataStart   = cursor + 8;

        if (chunkType === CHUNK_JSON) {
            const bytes = new Uint8Array(arrayBuffer, dataStart, chunkLength);
            json = JSON.parse(new TextDecoder().decode(bytes));
        } else if (chunkType === CHUNK_BIN) {
            // Copy so we don't depend on the source ArrayBuffer staying alive.
            bin = new Uint8Array(arrayBuffer, dataStart, chunkLength).slice();
        }
        cursor = dataStart + chunkLength;
    }

    if (!json) {
        throw new Error('GLB has no JSON chunk');
    }
    return { json, bin };
}

function injectPhysicsExtensions(json) {
    const extensionsUsed = new Set(json.extensionsUsed || []);
    extensionsUsed.add('KHR_implicit_shapes');
    extensionsUsed.add('KHR_physics_rigid_bodies');
    json.extensionsUsed = Array.from(extensionsUsed);

    json.extensions = json.extensions || {};
    json.extensions.KHR_implicit_shapes = { shapes: PHYSICS_SHAPES };
    json.extensions.KHR_physics_rigid_bodies = { physicsMaterials: PHYSICS_MATERIALS };

    // Map node name -> physics body description, then walk gltf nodes.
    if (!Array.isArray(json.nodes)) {
        return;
    }
    json.nodes.forEach(function (node) {
        const body = PHYSICS_BODIES.get(node.name);
        if (!body) {
            return;
        }
        node.extensions = node.extensions || {};
        node.extensions.KHR_physics_rigid_bodies = body;
    });
}

function buildGLB(json, bin) {
    const jsonText = JSON.stringify(json);
    const jsonBytes = new TextEncoder().encode(jsonText);
    const jsonPadded = padTo4(jsonBytes, 0x20); // ASCII space

    let binPadded = null;
    if (bin && bin.byteLength > 0) {
        binPadded = padTo4(bin, 0x00);
    }

    const headerSize = 12;
    const jsonChunkSize = 8 + jsonPadded.byteLength;
    const binChunkSize = binPadded ? 8 + binPadded.byteLength : 0;
    const totalSize = headerSize + jsonChunkSize + binChunkSize;

    const out = new ArrayBuffer(totalSize);
    const dv = new DataView(out);
    const u8 = new Uint8Array(out);

    // Header
    dv.setUint32(0, GLB_MAGIC, true);
    dv.setUint32(4, GLB_VERSION, true);
    dv.setUint32(8, totalSize, true);

    // JSON chunk
    dv.setUint32(12, jsonPadded.byteLength, true);
    dv.setUint32(16, CHUNK_JSON, true);
    u8.set(jsonPadded, 20);

    // BIN chunk
    if (binPadded) {
        const binStart = 20 + jsonPadded.byteLength;
        dv.setUint32(binStart, binPadded.byteLength, true);
        dv.setUint32(binStart + 4, CHUNK_BIN, true);
        u8.set(binPadded, binStart + 8);
    }

    return out;
}

function padTo4(bytes, fill) {
    const remainder = bytes.byteLength % 4;
    if (remainder === 0) {
        return bytes;
    }
    const pad = 4 - remainder;
    const padded = new Uint8Array(bytes.byteLength + pad);
    padded.set(bytes, 0);
    padded.fill(fill, bytes.byteLength);
    return padded;
}

function triggerDownload(arrayBuffer, filename) {
    const blob = new Blob([arrayBuffer], { type: 'model/gltf-binary' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
}

init();
