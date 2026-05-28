import * as pc from 'playcanvas';
import { loadWasmModuleAsync } from 'https://rawcdn.githack.com/playcanvas/engine/f8e929634cf7b057f7c80ac206a4f3d2d11843dc/examples/src/wasm-loader.js';

const MODEL_URL = 'https://raw.githubusercontent.com/eoineoineoin/glTF_Physics/master/samples/Materials_Restitution/Materials_Restitution.glb';
const RESET_Y_THRESHOLD = -20;

const _DBG_COLOR_DYNAMIC = new pc.Color(0, 1, 0, 1);
const _DBG_COLOR_STATIC  = new pc.Color(1, 1, 0, 1);

function _ringPoints(axis, radius, segments, out, mat) {
    const tmp = new pc.Vec3();
    const transformed = new pc.Vec3();
    let prev = null;
    for (let i = 0; i <= segments; i++) {
        const t = (i / segments) * Math.PI * 2;
        const c = Math.cos(t) * radius, s = Math.sin(t) * radius;
        if      (axis === 0) tmp.set(0, c, s);
        else if (axis === 1) tmp.set(c, 0, s);
        else                 tmp.set(c, s, 0);
        mat.transformPoint(tmp, transformed);
        const cur = transformed.clone();
        if (prev) { out.push(prev); out.push(cur); }
        prev = cur;
    }
}

function _drawWireSphereLocal(app, mat, radius, color) {
    const pts = [];
    _ringPoints(0, radius, 16, pts, mat);
    _ringPoints(1, radius, 16, pts, mat);
    _ringPoints(2, radius, 16, pts, mat);
    app.drawLines(pts, pts.map(() => color), false);
}

function _drawWireBoxLocal(app, mat, hx, hy, hz, color) {
    app.drawWireAlignedBox(new pc.Vec3(-hx, -hy, -hz), new pc.Vec3(hx, hy, hz), color, false, undefined, mat);
}

function _drawWireCylinderLocal(app, mat, radius, halfHeight, axis, color) {
    const pts = [];
    const segs = 16;
    const oA = new pc.Vec3(), oB = new pc.Vec3();
    if      (axis === 0) { oA.set(-halfHeight, 0, 0); oB.set(halfHeight, 0, 0); }
    else if (axis === 1) { oA.set(0, -halfHeight, 0); oB.set(0, halfHeight, 0); }
    else                 { oA.set(0, 0, -halfHeight); oB.set(0, 0, halfHeight); }
    const tmp = new pc.Vec3(), tr = new pc.Vec3();
    const verts = [];
    for (const off of [oA, oB]) {
        const ring = [];
        for (let i = 0; i <= segs; i++) {
            const t = (i / segs) * Math.PI * 2;
            const c = Math.cos(t) * radius, s = Math.sin(t) * radius;
            if      (axis === 0) tmp.set(off.x, c, s);
            else if (axis === 1) tmp.set(c, off.y, s);
            else                 tmp.set(c, s, off.z);
            mat.transformPoint(tmp, tr);
            ring.push(tr.clone());
        }
        verts.push(ring);
        for (let i = 0; i < segs; i++) { pts.push(ring[i]); pts.push(ring[i + 1]); }
    }
    const step = Math.floor(segs / 4);
    for (let k = 0; k < 4; k++) { pts.push(verts[0][k * step]); pts.push(verts[1][k * step]); }
    app.drawLines(pts, pts.map(() => color), false);
}

function _drawWireCapsuleLocal(app, mat, radius, cylHalf, axis, color) {
    _drawWireCylinderLocal(app, mat, radius, cylHalf, axis, color);
    const off = new pc.Vec3();
    for (const sign of [-1, 1]) {
        if      (axis === 0) off.set(sign * cylHalf, 0, 0);
        else if (axis === 1) off.set(0, sign * cylHalf, 0);
        else                 off.set(0, 0, sign * cylHalf);
        const local = new pc.Mat4().setTranslate(off.x, off.y, off.z);
        _drawWireSphereLocal(app, new pc.Mat4().mul2(mat, local), radius, color);
    }
}

function drawPhysicsDebug(app, entities) {
    for (const entity of entities) {
        const col = entity.collision;
        if (!col || !col.type) continue;
        let rbOwner = entity;
        while (rbOwner && !rbOwner.rigidbody) rbOwner = rbOwner.parent;
        const isDynamic = rbOwner?.rigidbody?.type === pc.BODYTYPE_DYNAMIC;
        const color = isDynamic ? _DBG_COLOR_DYNAMIC : _DBG_COLOR_STATIC;
        const mat = new pc.Mat4().setTRS(entity.getPosition(), entity.getRotation(), pc.Vec3.ONE);
        switch (col.type) {
            case 'box': {
                const h = col.halfExtents;
                _drawWireBoxLocal(app, mat, h.x, h.y, h.z, color);
                break;
            }
            case 'sphere':
                _drawWireSphereLocal(app, mat, col.radius, color);
                break;
            case 'capsule': {
                const r = col.radius;
                _drawWireCapsuleLocal(app, mat, r, Math.max(0, (col.height - 2 * r) * 0.5), col.axis ?? 1, color);
                break;
            }
            case 'cylinder':
                _drawWireCylinderLocal(app, mat, col.radius, col.height * 0.5, col.axis ?? 1, color);
                break;
        }
    }
}

let showWireframe = true;

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

// KHR combine rules. Ammo only supports multiplicative combine, so we pre-combine
// each dynamic body's value against the ground material using the KHR rule, then
// set all static bodies to friction=1 / restitution=1 (multiplicative identities).
const COMBINE_PRIORITY = { average: 1, minimum: 2, maximum: 3, multiply: 4 };
function pickCombineRule(r0, r1) {
    return (COMBINE_PRIORITY[r1 || 'average'] > COMBINE_PRIORITY[r0 || 'average']) ? r1 : r0;
}
function applyCombine(rule, a, b) {
    if (rule === 'minimum')  return Math.min(a, b);
    if (rule === 'maximum')  return Math.max(a, b);
    if (rule === 'multiply') return a * b;
    return (a + b) * 0.5;
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

    // Pass 2: rigidbody components.
    const dynamicInfos = [];
    const staticInfos  = [];
    for (const i of bodyOwnerNodes) {
        const e = entityMap[i];
        const m = nodes[i].extensions.KHR_physics_rigid_bodies.motion;
        const isK = !!m?.isKinematic;
        const cfg = { type: isK ? 'kinematic' : 'dynamic' };
        if (!isK) cfg.mass = m?.mass ?? 1;
        e.addComponent('rigidbody', cfg);
        const ownC = nodes[i].extensions.KHR_physics_rigid_bodies.collider;
        const mat = ownC?.physicsMaterial !== undefined ? (matDefs[ownC.physicsMaterial] ?? {}) : {};
        (isK ? staticInfos : dynamicInfos).push({ entity: e, mat });
    }
    for (const { entity, collider } of standaloneStatics) {
        entity.addComponent('rigidbody', { type: 'static' });
        const mat = collider.physicsMaterial !== undefined ? (matDefs[collider.physicsMaterial] ?? {}) : {};
        staticInfos.push({ entity, mat });
    }

    // Pre-combine material values using KHR rules; set static bodies to identity (1).
    const ground = staticInfos[0]?.mat ?? {};
    const getFr = m => m.dynamicFriction ?? m.staticFriction;
    for (const info of dynamicInfos) {
        const dynFr = getFr(info.mat), grdFr = getFr(ground);
        if (dynFr !== undefined || grdFr !== undefined) {
            info.entity.rigidbody.friction = applyCombine(
                pickCombineRule(info.mat.frictionCombine, ground.frictionCombine),
                dynFr ?? 0.5, grdFr ?? 0.5
            );
        }
        const dynRe = info.mat.restitution, grdRe = ground.restitution;
        if (dynRe !== undefined || grdRe !== undefined) {
            info.entity.rigidbody.restitution = applyCombine(
                pickCombineRule(info.mat.restitutionCombine, ground.restitutionCombine),
                dynRe ?? 0, grdRe ?? 0
            );
        }
    }
    for (const info of staticInfos) {
        info.entity.rigidbody.friction    = 1;
        info.entity.rigidbody.restitution = 1;
    }

    return dynamicInfos.map(info => ({
        entity: info.entity,
        initialPosition: info.entity.getPosition().clone(),
        initialRotation: info.entity.getRotation().clone()
    }));
}

function enableShadows(e) {
    if (e.render) { e.render.castShadows = true; e.render.receiveShadows = true; }
    if (e.model)  { e.model.castShadows  = true; e.model.receiveShadows  = true; }
    for (const c of e.children) enableShadows(c);
}

function computeWorldBounds(root) {
    let minX =  Infinity, minY =  Infinity, minZ =  Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    function visit(node) {
        if (node.render) {
            for (const mi of node.render.meshInstances) {
                const c = mi.aabb.center, h = mi.aabb.halfExtents;
                minX = Math.min(minX, c.x-h.x); maxX = Math.max(maxX, c.x+h.x);
                minY = Math.min(minY, c.y-h.y); maxY = Math.max(maxY, c.y+h.y);
                minZ = Math.min(minZ, c.z-h.z); maxZ = Math.max(maxZ, c.z+h.z);
            }
        }
        for (const child of node.children) visit(child);
    }
    visit(root);
    if (!Number.isFinite(minX)) return { center: new pc.Vec3(0,0,0), radius: 8 };
    const center = new pc.Vec3((minX+maxX)*0.5, (minY+maxY)*0.5, (minZ+maxZ)*0.5);
    const dx = maxX-minX, dy = maxY-minY, dz = maxZ-minZ;
    return { center, radius: Math.max(Math.sqrt(dx*dx+dy*dy+dz*dz)*0.5, 6) };
}

function init() {
    const canvas = document.getElementById('c');
    const app = new pc.Application(canvas);
    app.start();
    app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
    app.setCanvasResolution(pc.RESOLUTION_AUTO);
    window.addEventListener('resize', () => app.resizeCanvas(canvas.width, canvas.height));

    window.addEventListener('keydown', event => {
        const isWKey = event.code === 'KeyW' || event.key === 'w' || event.key === 'W';
        if (!isWKey || event.repeat) return;
        showWireframe = !showWireframe;
        const hint = document.getElementById('hint');
        if (hint) hint.textContent = 'W: wireframe ' + (showWireframe ? 'ON' : 'OFF');
    });

    app.scene.ambientLight = new pc.Color(0.68, 0.7, 0.76);
    const light = new pc.Entity('light');
    light.addComponent('light', { type: 'directional', color: new pc.Color(1,1,1),
        castShadows: true, shadowResolution: 2048, shadowBias: 0.3, normalOffsetBias: 0.02 });
    light.setLocalEulerAngles(45, 45, 45);
    app.root.addChild(light);

    const camera = new pc.Entity('camera');
    camera.addComponent('camera', { clearColor: new pc.Color(0.96,0.97,0.99), nearClip: 0.05, farClip: 1000, fov: 45 });
    app.root.addChild(camera);

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

        const debugEntities = [];
        const visitForDebug = (e) => {
            if (e.collision && e.collision.type && e.collision.type !== 'compound') debugEntities.push(e);
            for (const c of e.children) visitForDebug(c);
        };
        visitForDebug(root);

        const { center, radius } = computeWorldBounds(root);
        let angle = 0;
        const expectedFps = 60;

        app.on('update', dt => {
            angle += 0.25 * dt / (1 / expectedFps);
            camera.setLocalPosition(
                center.x + Math.sin(Math.PI * angle / 180) * radius,
                center.y + radius * 0.4,
                center.z + Math.cos(Math.PI * angle / 180) * radius
            );
            camera.lookAt(center);

            if (showWireframe) drawPhysicsDebug(app, debugEntities);

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
