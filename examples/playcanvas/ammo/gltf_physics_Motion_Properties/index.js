import * as pc from 'playcanvas';
import { CameraControls } from 'camera-controls';
import { loadWasmModuleAsync } from 'https://rawcdn.githack.com/playcanvas/engine/f8e929634cf7b057f7c80ac206a4f3d2d11843dc/examples/src/wasm-loader.js';

const MODEL_URL = 'https://raw.githubusercontent.com/eoineoineoin/glTF_Physics/master/samples/MotionProperties/MotionProperties.glb';
const RESET_Y_THRESHOLD     = -20;
const RESET_Y_THRESHOLD_TOP = 50;

loadWasmModuleAsync(
    'Ammo',
    'https://rawcdn.githack.com/playcanvas/engine/f8e929634cf7b057f7c80ac206a4f3d2d11843dc/examples/src/lib/ammo/ammo.wasm.js',
    'https://rawcdn.githack.com/playcanvas/engine/f8e929634cf7b057f7c80ac206a4f3d2d11843dc/examples/src/lib/ammo/ammo.wasm.wasm',
    init
);

async function fetchGltfJsonFromGlb(url) {
    const data = await fetch(url).then(r => r.arrayBuffer());
    if (new Uint32Array(data, 0, 1)[0] !== 0x46546c67) throw new Error('Invalid GLB header.');
    let offset = 12;
    while (offset < data.byteLength) {
        const view = new DataView(data, offset, 8);
        const len = view.getUint32(0, true);
        if (view.getUint32(4, true) === 0x4e4f534a) {
            return JSON.parse(new TextDecoder().decode(data.slice(offset + 8, offset + 8 + len)).replace(/\0+$/, ''));
        }
        offset += 8 + len;
    }
    throw new Error('GLB JSON chunk missing.');
}

function buildEntityMap(gltfJson, clonedRoot) {
    const nodes = gltfJson.nodes ?? [];
    const map = new Array(nodes.length).fill(null);
    const scenes = gltfJson.scenes ?? [];
    const sceneRoots = scenes.length === 1 ? [clonedRoot] : clonedRoot.children;

    function walk(nodeIndex, entity) {
        if (!entity || nodeIndex < 0) return;
        map[nodeIndex] = entity;
        const childIndices = nodes[nodeIndex].children ?? [];
        let cursor = 0;
        for (const ci of childIndices) {
            const cName = nodes[ci]?.name ?? '';
            for (let j = cursor; j < entity.children.length; j++) {
                if (entity.children[j].name === cName) {
                    walk(ci, entity.children[j]);
                    cursor = j + 1;
                    break;
                }
            }
        }
    }

    for (let s = 0; s < scenes.length; s++) {
        const sceneRoot = sceneRoots[s];
        if (!sceneRoot) continue;
        const rootIndices = scenes[s].nodes ?? [];
        let cursor = 0;
        for (const ri of rootIndices) {
            const rName = nodes[ri]?.name ?? '';
            for (let j = cursor; j < sceneRoot.children.length; j++) {
                if (sceneRoot.children[j].name === rName) {
                    walk(ri, sceneRoot.children[j]);
                    cursor = j + 1;
                    break;
                }
            }
        }
    }
    return map;
}

function getCollisionDataFromImplicit(shapeDef, worldScale) {
    const sx = Math.abs(worldScale.x);
    const sy = Math.abs(worldScale.y);
    const sz = Math.abs(worldScale.z);
    if (shapeDef.sphere) {
        return { type: 'sphere', radius: (shapeDef.sphere.radius ?? 0.5) * Math.max(sx, sy, sz) };
    }
    if (shapeDef.box) {
        const s = shapeDef.box.size ?? [1, 1, 1];
        return { type: 'box', halfExtents: new pc.Vec3(Math.abs(s[0]*sx)/2, Math.abs(s[1]*sy)/2, Math.abs(s[2]*sz)/2) };
    }
    if (shapeDef.capsule) {
        const r = ((shapeDef.capsule.radiusTop ?? shapeDef.capsule.radius ?? 0.5) +
                   (shapeDef.capsule.radiusBottom ?? shapeDef.capsule.radius ?? 0.5)) / 2 * Math.max(sx, sz);
        return { type: 'capsule', radius: r, height: (shapeDef.capsule.height ?? 1.0) * sy + 2 * r, axis: 1 };
    }
    if (shapeDef.cylinder) {
        const r = Math.max(shapeDef.cylinder.radiusTop ?? shapeDef.cylinder.radius ?? 0.5,
                           shapeDef.cylinder.radiusBottom ?? shapeDef.cylinder.radius ?? 0.5) * Math.max(sx, sz);
        return { type: 'cylinder', radius: r, height: (shapeDef.cylinder.height ?? 1.0) * sy, axis: 1 };
    }
    return null;
}

function initPhysics(gltfJson, entityMap) {
    const matDefs   = gltfJson.extensions?.KHR_physics_rigid_bodies?.physicsMaterials ?? [];
    const shapeDefs = gltfJson.extensions?.KHR_implicit_shapes?.shapes ?? [];
    const nodes     = gltfJson.nodes ?? [];

    const parentOf = new Array(nodes.length).fill(-1);
    for (let i = 0; i < nodes.length; i++) {
        for (const c of nodes[i].children ?? []) parentOf[c] = i;
    }
    const hasMotion = i => !!nodes[i]?.extensions?.KHR_physics_rigid_bodies?.motion;
    function findBodyOwner(idx) {
        let cur = idx;
        while (cur >= 0) { if (hasMotion(cur)) return cur; cur = parentOf[cur]; }
        return -1;
    }

    // Pass 1: compound collision for body-owner nodes.
    const bodyOwnerNodes = [];
    for (let i = 0; i < nodes.length; i++) {
        if (!hasMotion(i)) continue;
        const e = entityMap[i];
        if (!e) continue;
        e.addComponent('collision', { type: 'compound' });
        bodyOwnerNodes.push(i);
    }

    const standaloneStatics = [];
    for (let i = 0; i < nodes.length; i++) {
        const physExt = nodes[i].extensions?.KHR_physics_rigid_bodies;
        if (!physExt?.collider?.geometry) continue;
        const shapeIdx = physExt.collider.geometry.shape;
        if (shapeIdx === undefined) continue;
        const shapeDef = shapeDefs[shapeIdx];
        if (!shapeDef) continue;

        const ownerIdx = findBodyOwner(i);
        if (ownerIdx === i) {
            const parent = entityMap[i];
            if (!parent) continue;
            const child = new pc.Entity('__khrCollider');
            parent.addChild(child);
            const cd = getCollisionDataFromImplicit(shapeDef, parent.getWorldTransform().getScale());
            if (cd) child.addComponent('collision', cd);
        } else {
            const e = entityMap[i];
            if (!e) continue;
            const cd = getCollisionDataFromImplicit(shapeDef, e.getWorldTransform().getScale());
            if (!cd) continue;
            e.addComponent('collision', cd);
            if (ownerIdx < 0) standaloneStatics.push({ entity: e, collider: physExt.collider });
        }
    }

    // Pass 2: rigidbody components + motion properties.
    const dynamicInfos = [];
    const staticInfos  = [];
    const gravityOverrides = [];

    for (const i of bodyOwnerNodes) {
        const e = entityMap[i];
        const m = nodes[i].extensions.KHR_physics_rigid_bodies.motion;
        const isK = !!m?.isKinematic;
        const cfg = { type: isK ? 'kinematic' : 'dynamic' };
        if (!isK) cfg.mass = m?.mass ?? 1;
        e.addComponent('rigidbody', cfg);

        if (!isK) {
            if (Array.isArray(m?.linearVelocity))  e.rigidbody.linearVelocity  = new pc.Vec3(...m.linearVelocity);
            if (Array.isArray(m?.angularVelocity)) e.rigidbody.angularVelocity = new pc.Vec3(...m.angularVelocity);
            const ownC = nodes[i].extensions.KHR_physics_rigid_bodies.collider;
            const mat = ownC?.physicsMaterial !== undefined ? (matDefs[ownC.physicsMaterial] ?? {}) : {};
            dynamicInfos.push({ entity: e, mat, motionDef: m });
            if (m?.gravityFactor !== undefined) gravityOverrides.push({ entity: e, factor: m.gravityFactor });
        } else {
            staticInfos.push({ entity: e, mat: {} });
        }
    }
    for (const { entity, collider } of standaloneStatics) {
        entity.addComponent('rigidbody', { type: 'static' });
        const mat = collider.physicsMaterial !== undefined ? (matDefs[collider.physicsMaterial] ?? {}) : {};
        staticInfos.push({ entity, mat });
    }

    // BT_DISABLE_WORLD_GRAVITY (flag=1): prevents PlayCanvas from overwriting
    // per-body gravity with world gravity each frame.
    if (gravityOverrides.length > 0 && typeof Ammo !== 'undefined') {
        const BT_DISABLE_WORLD_GRAVITY = 1;
        for (const { entity, factor } of gravityOverrides) {
            const body = entity.rigidbody?.body;
            if (!body) continue;
            body.setFlags(body.getFlags() | BT_DISABLE_WORLD_GRAVITY);
            const g = new Ammo.btVector3(0, -9.81 * factor, 0);
            body.setGravity(g);
            body.activate(true);
            Ammo.destroy(g);
        }
    }

    return dynamicInfos.map(info => ({
        entity: info.entity,
        motionDef: info.motionDef,
        initialPosition: info.entity.getPosition().clone(),
        initialRotation: info.entity.getRotation().clone()
    }));
}

function enableShadows(e) {
    if (e.render) { e.render.castShadows = true; e.render.receiveShadows = true; }
    if (e.model)  { e.model.castShadows  = true; e.model.receiveShadows  = true; }
    for (const c of e.children) enableShadows(c);
}

// Compute orbit camera bounds from dynamic bodies only.
// For enclosed scenes (room with ceiling), this avoids the room geometry
// dominating the bounds and placing the camera above the ceiling.
function computeBodyBounds(dynamicBodies) {
    if (!dynamicBodies.length) return { center: new pc.Vec3(0, 2, 0), radius: 15 };
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const b of dynamicBodies) {
        const p = b.initialPosition;
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
        minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    const center = new pc.Vec3((minX+maxX)*0.5, (minY+maxY)*0.5, (minZ+maxZ)*0.5);
    const dx = maxX-minX, dy = maxY-minY, dz = maxZ-minZ;
    // Use full diagonal + generous margin for orbit radius so the whole scene
    // fits in view.  Minimum 15 units to keep the camera well outside the room.
    const diagonal = Math.sqrt(dx*dx+dy*dy+dz*dz);
    return { center, radius: Math.max(diagonal + 8, 15) };
}

function init() {
    const canvas = document.getElementById('c');
    const app = new pc.Application(canvas, {
        mouse: new pc.Mouse(canvas),
        touch: new pc.TouchDevice(canvas)
    });
    app.start();
    app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
    app.setCanvasResolution(pc.RESOLUTION_AUTO);
    window.addEventListener('resize', () => app.resizeCanvas(canvas.width, canvas.height));

    app.scene.ambientLight = new pc.Color(0.68, 0.7, 0.76);
    const light = new pc.Entity('light');
    light.addComponent('light', { type: 'directional', color: new pc.Color(1,1,1),
        castShadows: true, shadowResolution: 2048, shadowBias: 0.3, normalOffsetBias: 0.02 });
    light.setLocalEulerAngles(45, 45, 45);
    app.root.addChild(light);

    const camera = new pc.Entity('camera');
    camera.addComponent('camera', { clearColor: new pc.Color(0.96,0.97,0.99), nearClip: 0.05, farClip: 1000, fov: 45 });
    camera.addComponent('script');
    camera.setPosition(0, 2, 15);
    app.root.addChild(camera);
    const controls = camera.script.create(CameraControls, { properties: { enableFly: false } });

    let dynamicBodies = [];

    Promise.all([
        fetchGltfJsonFromGlb(MODEL_URL),
        new Promise((resolve, reject) => {
            app.assets.loadFromUrlAndFilename(MODEL_URL, MODEL_URL.split('/').pop(), 'container',
                (err, asset) => err ? reject(err) : resolve(asset));
        })
    ]).then(([gltfJson, asset]) => {
        const res = asset.resource;
        const root = res.instantiateRenderEntity ? res.instantiateRenderEntity() : res.instantiateModelEntity();
        app.root.addChild(root);
        enableShadows(root);

        const entityMap = buildEntityMap(gltfJson, root);
        dynamicBodies = initPhysics(gltfJson, entityMap);

        const { center, radius } = computeBodyBounds(dynamicBodies);
        const startPos = new pc.Vec3(center.x, center.y + 1.5, center.z + radius);
        controls.reset(center, startPos);

        app.on('update', dt => {
            for (const body of dynamicBodies) {
                const posY = body.entity.getPosition().y;
                if (posY >= RESET_Y_THRESHOLD && posY <= RESET_Y_THRESHOLD_TOP) continue;

                body.entity.setPosition(body.initialPosition);
                body.entity.setRotation(body.initialRotation);
                body.entity.rigidbody.linearVelocity  = pc.Vec3.ZERO;
                body.entity.rigidbody.angularVelocity = pc.Vec3.ZERO;
                body.entity.rigidbody.syncEntityToBody();

                // Re-apply initial velocities after reset.
                if (Array.isArray(body.motionDef?.linearVelocity)) {
                    body.entity.rigidbody.linearVelocity = new pc.Vec3(...body.motionDef.linearVelocity);
                }
                if (Array.isArray(body.motionDef?.angularVelocity)) {
                    body.entity.rigidbody.angularVelocity = new pc.Vec3(...body.motionDef.angularVelocity);
                }
            }
        });
    }).catch(console.error);
}
