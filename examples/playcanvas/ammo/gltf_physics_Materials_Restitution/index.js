import * as pc from 'playcanvas';
import { loadWasmModuleAsync } from 'https://rawcdn.githack.com/playcanvas/engine/f8e929634cf7b057f7c80ac206a4f3d2d11843dc/examples/src/wasm-loader.js';

const MODEL_URL = 'https://raw.githubusercontent.com/eoineoineoin/glTF_Physics/master/samples/Materials_Restitution/Materials_Restitution.glb';
const RESET_Y_THRESHOLD = -20;

loadWasmModuleAsync(
    'Ammo',
    'https://rawcdn.githack.com/playcanvas/engine/f8e929634cf7b057f7c80ac206a4f3d2d11843dc/examples/src/lib/ammo/ammo.wasm.js',
    'https://rawcdn.githack.com/playcanvas/engine/f8e929634cf7b057f7c80ac206a4f3d2d11843dc/examples/src/lib/ammo/ammo.wasm.wasm',
    init
);

async function fetchGltfJsonFromGlb(url) {
    const response = await fetch(url);
    const data = await response.arrayBuffer();
    const header = new Uint32Array(data, 0, 3);

    if (header[0] !== 0x46546c67) {
        throw new Error('Invalid GLB header.');
    }

    let offset = 12;
    const decoder = new TextDecoder();

    while (offset < data.byteLength) {
        const view = new DataView(data, offset, 8);
        const chunkLength = view.getUint32(0, true);
        const chunkType = view.getUint32(4, true);

        if (chunkType === 0x4e4f534a) {
            const chunkData = data.slice(offset + 8, offset + 8 + chunkLength);
            return JSON.parse(decoder.decode(chunkData).replace(/\0+$/, ''));
        }

        offset += 8 + chunkLength;
    }

    throw new Error('GLB JSON chunk is missing.');
}

function enableShadows(entity) {
    if (entity.render) {
        entity.render.castShadows = true;
        entity.render.receiveShadows = true;
    }
    if (entity.model) {
        entity.model.castShadows = true;
        entity.model.receiveShadows = true;
    }

    for (const child of entity.children) {
        enableShadows(child);
    }
}

function collectEntitiesByName(entity, map) {
    if (!map.has(entity.name)) {
        map.set(entity.name, []);
    }
    map.get(entity.name).push(entity);

    for (const child of entity.children) {
        collectEntitiesByName(child, map);
    }
}

function computeWorldBounds(root) {
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let minZ = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    let maxZ = Number.NEGATIVE_INFINITY;

    function visit(node) {
        const render = node.render;
        if (!render) {
            for (const child of node.children) {
                visit(child);
            }
            return;
        }

        for (const meshInstance of render.meshInstances) {
            const aabb = meshInstance.aabb;
            const c = aabb.center;
            const h = aabb.halfExtents;

            minX = Math.min(minX, c.x - h.x);
            minY = Math.min(minY, c.y - h.y);
            minZ = Math.min(minZ, c.z - h.z);
            maxX = Math.max(maxX, c.x + h.x);
            maxY = Math.max(maxY, c.y + h.y);
            maxZ = Math.max(maxZ, c.z + h.z);
        }

        for (const child of node.children) {
            visit(child);
        }
    }

    visit(root);

    if (!Number.isFinite(minX)) {
        return {
            center: new pc.Vec3(0, 0, 0),
            radius: 8
        };
    }

    const center = new pc.Vec3(
        (minX + maxX) * 0.5,
        (minY + maxY) * 0.5,
        (minZ + maxZ) * 0.5
    );

    const dx = maxX - minX;
    const dy = maxY - minY;
    const dz = maxZ - minZ;
    const radius = Math.max(Math.sqrt(dx * dx + dy * dy + dz * dz) * 0.5, 6);

    return { center, radius };
}

function createCollisionFromShape(entity, shapeDef, worldScale) {
    if (shapeDef.type === 'box' && shapeDef.box) {
        const s = shapeDef.box.size || [1, 1, 1];
        entity.addComponent('collision', {
            type: 'box',
            halfExtents: new pc.Vec3(
                Math.abs(s[0] * worldScale.x) * 0.5,
                Math.abs(s[1] * worldScale.y) * 0.5,
                Math.abs(s[2] * worldScale.z) * 0.5
            )
        });
    } else if (shapeDef.type === 'sphere' && shapeDef.sphere) {
        const r = shapeDef.sphere.radius !== undefined ? shapeDef.sphere.radius : 0.5;
        const maxS = Math.max(Math.abs(worldScale.x), Math.abs(worldScale.y), Math.abs(worldScale.z));
        entity.addComponent('collision', {
            type: 'sphere',
            radius: Math.max(r * maxS, 0.001)
        });
    } else if (shapeDef.type === 'capsule' && shapeDef.capsule) {
        const cd = shapeDef.capsule;
        const rTop = cd.radiusTop !== undefined ? cd.radiusTop : (cd.radius !== undefined ? cd.radius : 0.5);
        const rBot = cd.radiusBottom !== undefined ? cd.radiusBottom : (cd.radius !== undefined ? cd.radius : 0.5);
        const h = cd.height !== undefined ? cd.height : 1.0;
        const sXZ = Math.max(Math.abs(worldScale.x), Math.abs(worldScale.z));
        const avgR = Math.max((rTop + rBot) * 0.5 * sXZ, 0.001);
        const shaftH = h * Math.abs(worldScale.y);
        entity.addComponent('collision', {
            type: 'capsule',
            radius: avgR,
            height: shaftH + 2 * avgR
        });
    } else if (shapeDef.type === 'cylinder' && shapeDef.cylinder) {
        const cyd = shapeDef.cylinder;
        const rT = cyd.radiusTop !== undefined ? cyd.radiusTop : 0.5;
        const rB = cyd.radiusBottom !== undefined ? cyd.radiusBottom : 0.5;
        const cH = cyd.height !== undefined ? cyd.height : 1.0;
        const sXZ = Math.max(Math.abs(worldScale.x), Math.abs(worldScale.z));
        entity.addComponent('collision', {
            type: 'cylinder',
            radius: Math.max(Math.max(rT, rB) * sXZ, 0.001),
            height: Math.max(cH * Math.abs(worldScale.y), 0.001)
        });
    } else {
        console.warn('[PlayCanvas] Unsupported shape type:', shapeDef.type);
        return false;
    }
    return true;
}

function init() {
    const canvas = document.getElementById('c');
    const app = new pc.Application(canvas);
    app.start();

    app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
    app.setCanvasResolution(pc.RESOLUTION_AUTO);

    window.addEventListener('resize', function() {
        app.resizeCanvas(canvas.width, canvas.height);
    });

    app.scene.ambientLight = new pc.Color(0.68, 0.7, 0.76);

    const light = new pc.Entity('light');
    light.addComponent('light', {
        type: 'directional',
        color: new pc.Color(1, 1, 1),
        castShadows: true,
        shadowResolution: 2048,
        shadowBias: 0.3,
        normalOffsetBias: 0.02
    });
    light.setLocalEulerAngles(45, 45, 45);
    app.root.addChild(light);

    const camera = new pc.Entity('camera');
    camera.addComponent('camera', {
        clearColor: new pc.Color(0.96, 0.97, 0.99),
        nearClip: 0.05,
        farClip: 1000,
        fov: 45
    });
    app.root.addChild(camera);

    const dynamicBodies = [];

    Promise.all([
        fetchGltfJsonFromGlb(MODEL_URL),
        new Promise((resolve, reject) => {
            const fileName = MODEL_URL.split('/').pop();
            app.assets.loadFromUrlAndFilename(MODEL_URL, fileName, 'container', function(err, asset) {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(asset.resource);
            });
        })
    ]).then(([gltfJson, containerResource]) => {
        const root = containerResource.instantiateRenderEntity ?
            containerResource.instantiateRenderEntity() :
            containerResource.instantiateModelEntity();
        app.root.addChild(root);

        enableShadows(root);

        const nodeNameMap = new Map();
        collectEntitiesByName(root, nodeNameMap);

        const shapeDefs = gltfJson.extensions?.KHR_implicit_shapes?.shapes || [];
        const scenePhysics = gltfJson.extensions?.KHR_physics_rigid_bodies || {};
        const materialDefs = scenePhysics.physicsMaterials || [];

        const consumedEntityIds = new Set();

        for (const nodeDef of gltfJson.nodes || []) {
            const physicsExt = nodeDef.extensions?.KHR_physics_rigid_bodies;
            if (!physicsExt || !physicsExt.collider?.geometry) {
                continue;
            }

            const shapeIndex = physicsExt.collider.geometry.shape;
            if (shapeIndex === undefined) {
                continue;
            }

            const shapeDef = shapeDefs[shapeIndex];
            if (!shapeDef) {
                continue;
            }

            const candidates = nodeNameMap.get(nodeDef.name || '') || [];
            let targetEntity = null;
            for (const candidate of candidates) {
                if (!consumedEntityIds.has(candidate.getGuid())) {
                    targetEntity = candidate;
                    break;
                }
            }

            if (!targetEntity) {
                console.warn('No PlayCanvas entity found for glTF physics node:', nodeDef.name);
                continue;
            }

            consumedEntityIds.add(targetEntity.getGuid());

            const worldScale = targetEntity.getWorldTransform().getScale();

            if (!targetEntity.collision) {
                const ok = createCollisionFromShape(targetEntity, shapeDef, worldScale);
                if (!ok) continue;
            }

            const materialDef = physicsExt.collider.physicsMaterial !== undefined ?
                materialDefs[physicsExt.collider.physicsMaterial] :
                null;

            const friction = materialDef?.dynamicFriction !== undefined ? materialDef.dynamicFriction : 0.5;
            const restitution = materialDef?.restitution !== undefined ? materialDef.restitution : 0.0;
            const motion = physicsExt.motion || null;
            const effectiveFriction = !motion && friction === 0 ? 1 : friction;

            if (!targetEntity.rigidbody) {
                const rigidbodyOptions = {
                    type: motion ? 'dynamic' : 'static',
                    friction: effectiveFriction,
                    restitution
                };
                if (motion) {
                    rigidbodyOptions.mass = motion.mass !== undefined ? motion.mass : 1;
                }

                targetEntity.addComponent('rigidbody', rigidbodyOptions);
            }

            if (motion) {
                dynamicBodies.push({
                    entity: targetEntity,
                    initialPosition: targetEntity.getPosition().clone(),
                    initialRotation: targetEntity.getRotation().clone()
                });
            }
        }

        const bounds = computeWorldBounds(root);
        const center = bounds.center;
        const radius = bounds.radius;

        let angle = 0;
        const expectedFps = 60;

        app.on('update', function(dt) {
            const adjustSpeed = dt / (1 / expectedFps);
            angle += 0.25 * adjustSpeed;

            const x = center.x + Math.sin(Math.PI * angle / 180) * radius;
            const z = center.z + Math.cos(Math.PI * angle / 180) * radius;
            const y = center.y + radius * 0.4;

            camera.setLocalPosition(x, y, z);
            camera.lookAt(center);

            for (const body of dynamicBodies) {
                if (body.entity.getPosition().y >= RESET_Y_THRESHOLD) {
                    continue;
                }

                body.entity.setPosition(body.initialPosition);
                body.entity.setRotation(body.initialRotation);
                body.entity.rigidbody.linearVelocity = pc.Vec3.ZERO;
                body.entity.rigidbody.angularVelocity = pc.Vec3.ZERO;
                body.entity.rigidbody.syncEntityToBody();
            }
        });
    }).catch((error) => {
        console.error(error);
    });
}
