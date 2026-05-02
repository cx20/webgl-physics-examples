import * as pc from 'playcanvas';
import { loadWasmModuleAsync } from 'https://rawcdn.githack.com/playcanvas/engine/f8e929634cf7b057f7c80ac206a4f3d2d11843dc/examples/src/wasm-loader.js';

const MODEL_URL = 'https://raw.githubusercontent.com/eoineoineoin/glTF_Physics/master/samples/ShapeTypes/ShapeTypes.glb';
const RESET_Y_THRESHOLD = -20;

loadWasmModuleAsync(
    'Ammo',
    'https://rawcdn.githack.com/playcanvas/engine/f8e929634cf7b057f7c80ac206a4f3d2d11843dc/examples/src/lib/ammo/ammo.wasm.js',
    'https://rawcdn.githack.com/playcanvas/engine/f8e929634cf7b057f7c80ac206a4f3d2d11843dc/examples/src/lib/ammo/ammo.wasm.wasm',
    init
);

// Map glTF node index -> PlayCanvas entity by walking node/entity trees in parallel.
function buildEntityMap(data, clonedRoot) {
    const map = new Array(data.gltf.nodes.length).fill(null);
    const sceneRoots = data.scenes.length === 1 ? [clonedRoot] : clonedRoot.children;
    for (let s = 0; s < data.scenes.length; s++) {
        zipChildren(data.scenes[s], sceneRoots[s], data.nodes, map);
    }
    return map;
}

function zipChildren(orig, clone, dataNodes, map) {
    if (!orig || !clone) return;
    let cursor = 0;
    for (const oc of orig.children) {
        let matched = null;
        for (let j = cursor; j < clone.children.length; j++) {
            if (clone.children[j].name === oc.name) {
                matched = clone.children[j];
                cursor = j + 1;
                break;
            }
        }
        if (!matched) continue;
        const idx = dataNodes.indexOf(oc);
        if (idx >= 0) map[idx] = matched;
        zipChildren(oc, matched, dataNodes, map);
    }
}

function getCollisionDataFromImplicit(shapeDef, worldScale) {
    const sx = Math.abs(worldScale.x);
    const sy = Math.abs(worldScale.y);
    const sz = Math.abs(worldScale.z);
    if (shapeDef.sphere) {
        const r = (shapeDef.sphere.radius ?? 0.5) * Math.max(sx, sy, sz);
        return { type: 'sphere', radius: r };
    }
    if (shapeDef.box) {
        const s = shapeDef.box.size ?? [1, 1, 1];
        return {
            type: 'box',
            halfExtents: new pc.Vec3(
                Math.abs(s[0] * sx) / 2,
                Math.abs(s[1] * sy) / 2,
                Math.abs(s[2] * sz) / 2
            )
        };
    }
    if (shapeDef.capsule) {
        const r = ((shapeDef.capsule.radiusTop ?? shapeDef.capsule.radius ?? 0.5) +
                   (shapeDef.capsule.radiusBottom ?? shapeDef.capsule.radius ?? 0.5)) / 2 *
                  Math.max(sx, sz);
        const h = (shapeDef.capsule.height ?? 1.0) * sy + 2 * r;
        return { type: 'capsule', radius: r, height: h, axis: 1 };
    }
    if (shapeDef.cylinder) {
        const r = Math.max(
            shapeDef.cylinder.radiusTop    ?? shapeDef.cylinder.radius ?? 0.5,
            shapeDef.cylinder.radiusBottom ?? shapeDef.cylinder.radius ?? 0.5
        ) * Math.max(sx, sz);
        const h = (shapeDef.cylinder.height ?? 1.0) * sy;
        return { type: 'cylinder', radius: r, height: h, axis: 1 };
    }
    console.warn('[Physics] Unsupported implicit shape:', shapeDef);
    return null;
}

function initPhysics(gltfJson, entityMap) {
    const matDefs   = gltfJson.extensions?.KHR_physics_rigid_bodies?.physicsMaterials ?? [];
    const shapeDefs = gltfJson.extensions?.KHR_implicit_shapes?.shapes ?? [];
    const nodes     = gltfJson.nodes ?? [];

    const parentOf = new Array(nodes.length).fill(-1);
    for (let i = 0; i < nodes.length; i++) {
        const ch = nodes[i].children;
        if (!ch) continue;
        for (const c of ch) parentOf[c] = i;
    }
    const hasMotion = (i) => !!nodes[i]?.extensions?.KHR_physics_rigid_bodies?.motion;
    function findBodyOwner(nodeIdx) {
        let cur = nodeIdx;
        while (cur >= 0) {
            if (hasMotion(cur)) return cur;
            cur = parentOf[cur];
        }
        return -1;
    }

    // Pass 1: compound collision components for body-owner nodes.
    const bodyOwnerNodes = [];
    for (let i = 0; i < nodes.length; i++) {
        if (!hasMotion(i)) continue;
        const entity = entityMap[i];
        if (!entity) continue;
        entity.addComponent('collision', { type: 'compound' });
        bodyOwnerNodes.push(i);
    }

    // Walk all collider nodes and place collision components.
    const standaloneStatics = [];
    for (let i = 0; i < nodes.length; i++) {
        const physExt = nodes[i].extensions?.KHR_physics_rigid_bodies;
        if (!physExt?.collider) continue;
        const collider = physExt.collider;
        const geomDef = collider.geometry;
        if (!geomDef || geomDef.shape === undefined) continue;
        const shapeDef = shapeDefs[geomDef.shape];
        if (!shapeDef) continue;

        const ownerIdx = findBodyOwner(i);

        if (ownerIdx === i) {
            // Body-owner with its own collider: attach shape to a synthetic child.
            const parentEntity = entityMap[i];
            if (!parentEntity) continue;
            const child = new pc.Entity('__khrCollider');
            parentEntity.addChild(child);
            const ws = parentEntity.getWorldTransform().getScale();
            const cd = getCollisionDataFromImplicit(shapeDef, ws);
            if (!cd) continue;
            child.addComponent('collision', cd);
        } else {
            const entity = entityMap[i];
            if (!entity) continue;
            const ws = entity.getWorldTransform().getScale();
            const cd = getCollisionDataFromImplicit(shapeDef, ws);
            if (!cd) continue;
            entity.addComponent('collision', cd);
            if (ownerIdx < 0) {
                standaloneStatics.push({ entity, collider });
            }
        }
    }

    // Pass 2: rigidbody components.
    const dynamicInfos = [];
    const staticInfos  = [];

    for (const i of bodyOwnerNodes) {
        const entity    = entityMap[i];
        const motionDef = nodes[i].extensions.KHR_physics_rigid_bodies.motion;
        const isKinematic = !!motionDef?.isKinematic;
        const rbConfig = { type: isKinematic ? 'kinematic' : 'dynamic' };
        if (!isKinematic) rbConfig.mass = motionDef?.mass ?? 1;
        entity.addComponent('rigidbody', rbConfig);

        const ownCollider = nodes[i].extensions.KHR_physics_rigid_bodies.collider;
        const mat = (ownCollider?.physicsMaterial !== undefined)
            ? (matDefs[ownCollider.physicsMaterial] ?? {})
            : {};
        if (!isKinematic) dynamicInfos.push({ entity, mat });
        else staticInfos.push({ entity, mat });
    }
    for (const { entity, collider } of standaloneStatics) {
        entity.addComponent('rigidbody', { type: 'static' });
        const mat = (collider.physicsMaterial !== undefined)
            ? (matDefs[collider.physicsMaterial] ?? {})
            : {};
        staticInfos.push({ entity, mat });
    }

    // Set friction/restitution (use Ammo default multiplicative combine).
    for (const info of dynamicInfos) {
        if (info.mat.dynamicFriction !== undefined) info.entity.rigidbody.friction    = info.mat.dynamicFriction;
        if (info.mat.restitution     !== undefined) info.entity.rigidbody.restitution = info.mat.restitution;
    }

    // Return dynamic bodies for the reset loop.
    return dynamicInfos.map(info => ({
        entity: info.entity,
        initialPosition: info.entity.getPosition().clone(),
        initialRotation: info.entity.getRotation().clone()
    }));
}

function enableShadows(entity) {
    if (entity.render) { entity.render.castShadows = true; entity.render.receiveShadows = true; }
    if (entity.model)  { entity.model.castShadows  = true; entity.model.receiveShadows  = true; }
    for (const child of entity.children) enableShadows(child);
}

function computeWorldBounds(root) {
    let minX =  Infinity, minY =  Infinity, minZ =  Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

    function visit(node) {
        if (node.render) {
            for (const mi of node.render.meshInstances) {
                const c = mi.aabb.center, h = mi.aabb.halfExtents;
                minX = Math.min(minX, c.x - h.x); maxX = Math.max(maxX, c.x + h.x);
                minY = Math.min(minY, c.y - h.y); maxY = Math.max(maxY, c.y + h.y);
                minZ = Math.min(minZ, c.z - h.z); maxZ = Math.max(maxZ, c.z + h.z);
            }
        }
        for (const child of node.children) visit(child);
    }

    visit(root);

    if (!Number.isFinite(minX)) return { center: new pc.Vec3(0, 0, 0), radius: 8 };

    const center = new pc.Vec3((minX + maxX) * 0.5, (minY + maxY) * 0.5, (minZ + maxZ) * 0.5);
    const dx = maxX - minX, dy = maxY - minY, dz = maxZ - minZ;
    return { center, radius: Math.max(Math.sqrt(dx * dx + dy * dy + dz * dz) * 0.5, 6) };
}

function init() {
    const canvas = document.getElementById('c');
    const app = new pc.Application(canvas);
    app.start();

    app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
    app.setCanvasResolution(pc.RESOLUTION_AUTO);
    window.addEventListener('resize', () => app.resizeCanvas(canvas.width, canvas.height));

    app.scene.ambientLight = new pc.Color(0.68, 0.7, 0.76);

    const light = new pc.Entity('light');
    light.addComponent('light', {
        type: 'directional', color: new pc.Color(1, 1, 1),
        castShadows: true, shadowResolution: 2048, shadowBias: 0.3, normalOffsetBias: 0.02
    });
    light.setLocalEulerAngles(45, 45, 45);
    app.root.addChild(light);

    const camera = new pc.Entity('camera');
    camera.addComponent('camera', {
        clearColor: new pc.Color(0.96, 0.97, 0.99), nearClip: 0.05, farClip: 1000, fov: 45
    });
    app.root.addChild(camera);

    let dynamicBodies = [];

    new Promise((resolve, reject) => {
        const fileName = MODEL_URL.split('/').pop();
        app.assets.loadFromUrlAndFilename(MODEL_URL, fileName, 'container', (err, asset) => {
            if (err) { reject(err); return; }
            resolve(asset);
        });
    }).then((asset) => {
        const containerResource = asset.resource;
        const root = containerResource.instantiateRenderEntity
            ? containerResource.instantiateRenderEntity()
            : containerResource.instantiateModelEntity();
        app.root.addChild(root);
        enableShadows(root);

        const gltfJson = containerResource.data?.gltf;
        if (gltfJson && (gltfJson.extensions?.KHR_physics_rigid_bodies || gltfJson.extensions?.KHR_implicit_shapes)) {
            const entityMap = buildEntityMap(containerResource.data, root);
            dynamicBodies = initPhysics(gltfJson, entityMap);
        }

        const bounds = computeWorldBounds(root);
        const center = bounds.center;
        const radius = bounds.radius;
        let angle = 0;
        const expectedFps = 60;

        app.on('update', (dt) => {
            const speed = dt / (1 / expectedFps);
            angle += 0.25 * speed;

            const x = center.x + Math.sin(Math.PI * angle / 180) * radius;
            const z = center.z + Math.cos(Math.PI * angle / 180) * radius;
            camera.setLocalPosition(x, center.y + radius * 0.4, z);
            camera.lookAt(center);

            for (const body of dynamicBodies) {
                if (body.entity.getPosition().y >= RESET_Y_THRESHOLD) continue;
                body.entity.setPosition(body.initialPosition);
                body.entity.setRotation(body.initialRotation);
                body.entity.rigidbody.linearVelocity  = pc.Vec3.ZERO;
                body.entity.rigidbody.angularVelocity = pc.Vec3.ZERO;
                body.entity.rigidbody.syncEntityToBody();
            }
        });
    }).catch(console.error);
}
