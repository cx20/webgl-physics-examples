// Babylon.js + Havok glTF Physics exporter module.
// Exposes BABYLON.GLTFPhysicsExport with:
//   - snapshot(scene)                       capture initial transforms (optional)
//   - GLBAsync(scene, fileName, options)    export the scene as a .glb with
//                                           KHR_physics_rigid_bodies + KHR_implicit_shapes
// Output schema follows eoineoineoin/glTF_Physics_Blender_Exporter so it round-trips
// through the loader used by the gltf_physics_* samples in this repo.

(function (BABYLON) {
    if (!BABYLON) {
        throw new Error('Babylon.js must be loaded before gltf-physics-exporter.js');
    }

    const SNAPSHOT_KEY = '__gltfPhysicsExportSnapshot';

    const GLB_MAGIC = 0x46546C67;  // 'glTF'
    const GLB_VERSION = 2;
    const CHUNK_JSON = 0x4E4F534A; // 'JSON'
    const CHUNK_BIN  = 0x004E4942; // 'BIN\0'

    function isPhysicsMesh(mesh) {
        return !!(mesh && (mesh.physicsBody || mesh.aggregate));
    }

    function snapshot(scene) {
        scene.meshes.forEach(function (mesh) {
            if (!isPhysicsMesh(mesh)) {
                return;
            }
            mesh.metadata = mesh.metadata || {};
            mesh.metadata[SNAPSHOT_KEY] = {
                position: mesh.position.clone(),
                rotation: mesh.rotation.clone(),
                rotationQuaternion: mesh.rotationQuaternion ? mesh.rotationQuaternion.clone() : null
            };
        });
    }

    async function GLBAsync(scene, baseName, options) {
        options = options || {};
        const data = collectPhysicsData(scene);
        const restore = applySnapshots(scene);
        try {
            const exportOptions = {
                shouldExportNode: function (node) {
                    if (options.shouldExportNode && !options.shouldExportNode(node)) {
                        return false;
                    }
                    return !(node instanceof BABYLON.Light);
                }
            };

            const gltfData = await BABYLON.GLTF2Export.GLBAsync(scene, baseName, exportOptions);
            const fileMap = gltfData.glTFFiles;
            const glbName = Object.keys(fileMap).find(function (k) { return k.endsWith('.glb'); });
            if (!glbName) {
                throw new Error('GLTF2Export did not produce a .glb');
            }

            const arrayBuffer = await fileMap[glbName].arrayBuffer();
            const { json, bin } = parseGLB(arrayBuffer);

            injectPhysicsExtensions(json, data);

            const outBuffer = buildGLB(json, bin);
            if (options.download !== false) {
                triggerDownload(outBuffer, baseName + '.glb');
            }
            return outBuffer;
        } finally {
            restore();
        }
    }

    // --- physics data collection ---

    function collectPhysicsData(scene) {
        const shapes = [];
        const materials = [];
        const bodies = new Map(); // mesh name -> node-level KHR_physics_rigid_bodies block

        scene.meshes.forEach(function (mesh) {
            if (!isPhysicsMesh(mesh)) {
                return;
            }
            const body = describeBody(mesh, shapes, materials);
            if (body) {
                bodies.set(mesh.name, body);
            }
        });

        return { shapes, materials, bodies };
    }

    function describeBody(mesh, shapes, materials) {
        const shapeSpec = describeShape(mesh);
        if (!shapeSpec) {
            console.warn('[GLTFPhysicsExport] Skipping mesh with unsupported physics shape:', mesh.name);
            return null;
        }
        const shapeIndex = pushUnique(shapes, shapeSpec);
        const matIndex = pushUnique(materials, describeMaterial(mesh));

        const body = {
            collider: { geometry: { shape: shapeIndex }, physicsMaterial: matIndex }
        };
        const mass = readMass(mesh);
        if (mass > 0) {
            body.motion = { mass: mass };
        }
        // mass === 0 → static, no motion block (matches the eoineoineoin convention)
        return body;
    }

    function describeShape(mesh) {
        const aggregate = mesh.aggregate;
        const shape = aggregate && aggregate.shape;
        if (!shape) {
            return null;
        }
        const bb = mesh.getBoundingInfo().boundingBox;
        const extents = bb.extendSize; // half-extents in local space

        switch (shape.type) {
            case BABYLON.PhysicsShapeType.BOX:
                return { type: 'box', box: { size: [extents.x * 2, extents.y * 2, extents.z * 2] } };

            case BABYLON.PhysicsShapeType.SPHERE: {
                const radius = Math.max(extents.x, extents.y, extents.z);
                return { type: 'sphere', sphere: { radius: radius } };
            }

            case BABYLON.PhysicsShapeType.CAPSULE: {
                const radius = Math.max(extents.x, extents.z);
                const height = Math.max(0, extents.y * 2 - radius * 2);
                return { type: 'capsule', capsule: { height: height, radiusBottom: radius, radiusTop: radius } };
            }

            case BABYLON.PhysicsShapeType.CYLINDER: {
                const radius = Math.max(extents.x, extents.z);
                const height = extents.y * 2;
                return { type: 'cylinder', cylinder: { height: height, radiusBottom: radius, radiusTop: radius } };
            }

            default:
                return null;
        }
    }

    function describeMaterial(mesh) {
        const aggregate = mesh.aggregate;
        let friction = 0.5;
        let restitution = 0.0;
        if (aggregate) {
            if (aggregate.material) {
                if (typeof aggregate.material.friction === 'number') friction = aggregate.material.friction;
                if (typeof aggregate.material.restitution === 'number') restitution = aggregate.material.restitution;
            }
            if (aggregate.shape && aggregate.shape.material) {
                const m = aggregate.shape.material;
                if (typeof m.friction === 'number') friction = m.friction;
                if (typeof m.restitution === 'number') restitution = m.restitution;
            }
        }
        return {
            staticFriction: friction,
            dynamicFriction: friction,
            restitution: restitution
        };
    }

    function readMass(mesh) {
        const body = mesh.physicsBody;
        if (body && typeof body.getMassProperties === 'function') {
            const mp = body.getMassProperties();
            if (mp && typeof mp.mass === 'number') {
                return mp.mass;
            }
        }
        const aggregate = mesh.aggregate;
        if (aggregate && aggregate._options && typeof aggregate._options.mass === 'number') {
            return aggregate._options.mass;
        }
        return 0;
    }

    function pushUnique(arr, item) {
        const key = JSON.stringify(item);
        for (let i = 0; i < arr.length; i++) {
            if (JSON.stringify(arr[i]) === key) {
                return i;
            }
        }
        arr.push(item);
        return arr.length - 1;
    }

    // --- snapshot apply / restore ---

    function applySnapshots(scene) {
        const restore = [];
        scene.meshes.forEach(function (mesh) {
            if (!mesh || !mesh.metadata || !mesh.metadata[SNAPSHOT_KEY]) {
                return;
            }
            const snap = mesh.metadata[SNAPSHOT_KEY];
            restore.push({
                mesh,
                position: mesh.position.clone(),
                rotation: mesh.rotation.clone(),
                rotationQuaternion: mesh.rotationQuaternion ? mesh.rotationQuaternion.clone() : null
            });
            mesh.position.copyFrom(snap.position);
            if (snap.rotationQuaternion) {
                mesh.rotationQuaternion = snap.rotationQuaternion.clone();
            } else {
                mesh.rotationQuaternion = null;
                mesh.rotation.copyFrom(snap.rotation);
            }
            mesh.computeWorldMatrix(true);
        });
        return function () {
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
        };
    }

    // --- glTF JSON injection ---

    function injectPhysicsExtensions(json, data) {
        const used = new Set(json.extensionsUsed || []);
        used.add('KHR_implicit_shapes');
        used.add('KHR_physics_rigid_bodies');
        json.extensionsUsed = Array.from(used);

        json.extensions = json.extensions || {};
        json.extensions.KHR_implicit_shapes = { shapes: data.shapes };
        json.extensions.KHR_physics_rigid_bodies = { physicsMaterials: data.materials };

        if (!Array.isArray(json.nodes)) {
            return;
        }
        json.nodes.forEach(function (node) {
            const body = data.bodies.get(node.name);
            if (!body) {
                return;
            }
            node.extensions = node.extensions || {};
            node.extensions.KHR_physics_rigid_bodies = body;
        });
    }

    // --- GLB pack / unpack ---

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

        dv.setUint32(0, GLB_MAGIC, true);
        dv.setUint32(4, GLB_VERSION, true);
        dv.setUint32(8, totalSize, true);

        dv.setUint32(12, jsonPadded.byteLength, true);
        dv.setUint32(16, CHUNK_JSON, true);
        u8.set(jsonPadded, 20);

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

    BABYLON.GLTFPhysicsExport = {
        snapshot: snapshot,
        GLBAsync: GLBAsync
    };
})(typeof window !== 'undefined' ? window.BABYLON : undefined);
