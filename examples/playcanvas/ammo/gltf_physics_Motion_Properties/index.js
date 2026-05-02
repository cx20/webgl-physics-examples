import * as pc from 'playcanvas';
import { CameraControls } from 'camera-controls';

const PC_ROOT = 'https://cx20.github.io/gltf-test/libs/playcanvas/v2.14.2';
const MODEL_URL = 'https://raw.githubusercontent.com/eoineoineoin/glTF_Physics/master/samples/MotionProperties/MotionProperties.glb';
const RESET_Y_THRESHOLD     = -20;
const RESET_Y_THRESHOLD_TOP = 50;

pc.WasmModule.setConfig('Ammo', {
    glueUrl:     PC_ROOT + '/ammo/ammo.wasm.js',
    wasmUrl:     PC_ROOT + '/ammo/ammo.wasm.wasm',
    fallbackUrl: PC_ROOT + '/ammo/ammo.js'
});
pc.WasmModule.getInstance('Ammo', init);

async function fetchGlbData(url) {
    const data = await fetch(url).then(r => r.arrayBuffer());
    if (new Uint32Array(data, 0, 1)[0] !== 0x46546c67) throw new Error('Invalid GLB header.');
    let json = null, binary = null;
    let offset = 12;
    while (offset < data.byteLength) {
        const view = new DataView(data, offset, 8);
        const len  = view.getUint32(0, true);
        const type = view.getUint32(4, true);
        if      (type === 0x4e4f534a) json   = JSON.parse(new TextDecoder().decode(data.slice(offset + 8, offset + 8 + len)).replace(/\0+$/, ''));
        else if (type === 0x004e4942) binary = data.slice(offset + 8, offset + 8 + len);
        offset += 8 + len;
    }
    if (!json) throw new Error('GLB JSON chunk missing.');
    return { json, binary };
}

function readGlbFloat32(json, binary, accessorIdx) {
    const acc = json.accessors[accessorIdx];
    const bv  = json.bufferViews[acc.bufferView];
    const totalOffset = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
    const components  = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[acc.type] ?? 1;
    const stride      = bv.byteStride ?? 0;
    if (!stride || stride === components * 4)
        return new Float32Array(binary.slice(totalOffset, totalOffset + acc.count * components * 4));
    const result = new Float32Array(acc.count * components);
    const dv = new DataView(binary);
    for (let i = 0; i < acc.count; i++)
        for (let c = 0; c < components; c++)
            result[i * components + c] = dv.getFloat32(totalOffset + i * stride + c * 4, true);
    return result;
}

function readGlbIndices(json, binary, accessorIdx) {
    const acc = json.accessors[accessorIdx];
    const bv  = json.bufferViews[acc.bufferView];
    const off = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
    if (acc.componentType === 5125) return new Uint32Array(binary.slice(off, off + acc.count * 4));
    if (acc.componentType === 5123) return new Uint16Array(binary.slice(off, off + acc.count * 2));
    return new Uint8Array(binary.slice(off, off + acc.count));
}

function addAmmoStaticMeshBody(json, binary, meshIdx, entity, friction, restitution, dynamicsWorld) {
    const gltfMesh = json.meshes[meshIdx];
    if (!gltfMesh) return null;
    const btTriMesh = new Ammo.btTriangleMesh(true, true);
    let triCount = 0;
    for (const prim of gltfMesh.primitives ?? []) {
        if ((prim.mode ?? 4) !== 4) continue;
        const posIdx = prim.attributes?.POSITION;
        if (posIdx === undefined) continue;
        const pos  = readGlbFloat32(json, binary, posIdx);
        const idxs = prim.indices !== undefined ? readGlbIndices(json, binary, prim.indices) : null;
        const n    = idxs ? idxs.length / 3 : pos.length / 9;
        for (let t = 0; t < n; t++) {
            const i0 = (idxs ? idxs[t*3]   : t*3)   * 3;
            const i1 = (idxs ? idxs[t*3+1] : t*3+1) * 3;
            const i2 = (idxs ? idxs[t*3+2] : t*3+2) * 3;
            const v0 = new Ammo.btVector3(pos[i0], pos[i0+1], pos[i0+2]);
            const v1 = new Ammo.btVector3(pos[i1], pos[i1+1], pos[i1+2]);
            const v2 = new Ammo.btVector3(pos[i2], pos[i2+1], pos[i2+2]);
            btTriMesh.addTriangle(v0, v1, v2, false);
            Ammo.destroy(v0); Ammo.destroy(v1); Ammo.destroy(v2);
            triCount++;
        }
    }
    if (triCount === 0) { Ammo.destroy(btTriMesh); return null; }
    const shape = new Ammo.btBvhTriangleMeshShape(btTriMesh, true);
    const ws = entity.getWorldTransform().getScale();
    const ls = new Ammo.btVector3(Math.abs(ws.x), Math.abs(ws.y), Math.abs(ws.z));
    shape.setLocalScaling(ls); Ammo.destroy(ls);
    const p = entity.getPosition(), q = entity.getRotation();
    const xform = new Ammo.btTransform();
    xform.setIdentity();
    xform.setOrigin(new Ammo.btVector3(p.x, p.y, p.z));
    xform.setRotation(new Ammo.btQuaternion(q.x, q.y, q.z, q.w));
    const motionState  = new Ammo.btDefaultMotionState(xform);
    const localInertia = new Ammo.btVector3(0, 0, 0);
    const rbInfo       = new Ammo.btRigidBodyConstructionInfo(0, motionState, shape, localInertia);
    const body         = new Ammo.btRigidBody(rbInfo);
    body.setFriction(friction ?? 0.5); body.setRestitution(restitution ?? 0);
    dynamicsWorld.addRigidBody(body);
    Ammo.destroy(xform); Ammo.destroy(localInertia); Ammo.destroy(rbInfo);
    return body;
}

function buildEntityMap(gltfJson, clonedRoot) {
    const nodes = gltfJson.nodes ?? [];
    const map = new Array(nodes.length).fill(null);

    // Build a name → [entity, ...] lookup from a list of entities.
    // Multiple children may share a name; each match is consumed in order.
    function nameMap(children) {
        const m = new Map();
        for (const child of children) {
            const n = child.name ?? '';
            if (!m.has(n)) m.set(n, []);
            m.get(n).push(child);
        }
        return m;
    }

    function walk(nodeIndex, entity) {
        if (!entity || nodeIndex < 0) return;
        map[nodeIndex] = entity;
        const childIndices = nodes[nodeIndex].children ?? [];
        if (!childIndices.length) return;
        const byName = nameMap(entity.children);
        for (const ci of childIndices) {
            const cName = nodes[ci]?.name ?? '';
            const candidates = byName.get(cName);
            if (candidates?.length) walk(ci, candidates.shift());
        }
    }

    const scenes = gltfJson.scenes ?? [];
    const sceneRoots = scenes.length === 1 ? [clonedRoot] : clonedRoot.children;
    console.log('[buildEntityMap] scenes:', scenes.length,
        '| nodes:', nodes.length,
        '| clonedRoot:', clonedRoot.name,
        '| clonedRoot.children:', clonedRoot.children.map(c => c.name));
    for (let s = 0; s < scenes.length; s++) {
        const sceneRoot = sceneRoots[s];
        if (!sceneRoot) continue;
        const rootIndices = scenes[s].nodes ?? [];
        console.log('[buildEntityMap] scene', s,
            '| rootIndices:', rootIndices,
            '| rootNames:', rootIndices.map(ri => nodes[ri]?.name ?? ''),
            '| sceneRoot.name:', sceneRoot.name,
            '| sceneRoot.children:', sceneRoot.children.map(c => c.name));
        // If sceneRoot's own name matches the single root node, it IS that node.
        if (rootIndices.length === 1 && sceneRoot.name === (nodes[rootIndices[0]]?.name ?? '')) {
            console.log('[buildEntityMap] sceneRoot IS root node', rootIndices[0]);
            walk(rootIndices[0], sceneRoot);
            continue;
        }
        const byName = nameMap(sceneRoot.children);
        for (const ri of rootIndices) {
            const rName = nodes[ri]?.name ?? '';
            const candidates = byName.get(rName);
            if (candidates?.length) walk(ri, candidates.shift());
            else console.warn('[buildEntityMap] root node not matched: idx=' + ri + ' name="' + rName + '"');
        }
    }
    console.log('[buildEntityMap] mapped', map.filter(Boolean).length, '/', nodes.length, 'nodes');
    map.forEach((e, i) => {
        if (!e) console.warn('[buildEntityMap] unmapped node', i, nodes[i]?.name ?? '(no name)');
    });
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

function initPhysics(gltfJson, binary, entityMap, dynamicsWorld) {
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
        const m = nodes[i].extensions.KHR_physics_rigid_bodies.motion;
        console.log('[initPhysics] motion node', i, nodes[i]?.name ?? '',
            '| entityMap:', e ? e.name : 'NULL',
            '| gravityFactor:', m?.gravityFactor,
            '| isKinematic:', m?.isKinematic,
            '| mass:', m?.mass);
        if (!e) continue;
        e.addComponent('collision', { type: 'compound' });
        bodyOwnerNodes.push(i);
    }

    const standaloneStatics  = [];
    const meshStaticEntities = [];
    for (let i = 0; i < nodes.length; i++) {
        const physExt = nodes[i].extensions?.KHR_physics_rigid_bodies;
        if (!physExt?.collider?.geometry) continue;
        const geom     = physExt.collider.geometry;
        const ownerIdx = findBodyOwner(i);
        const e        = entityMap[i];
        console.log('[initPhysics] collider node', i, nodes[i]?.name ?? '',
            '| ownerIdx:', ownerIdx,
            '| entityMap:', e ? e.name : 'NULL',
            '| geom.shape:', geom.shape,
            '| geom.mesh:', geom.mesh);

        if (ownerIdx === i) {
            if (geom.shape === undefined) { console.warn('[initPhysics] mesh on compound owner skipped:', i); continue; }
            const parent   = entityMap[i];
            if (!parent) continue;
            const shapeDef = shapeDefs[geom.shape];
            if (!shapeDef) continue;
            const child = new pc.Entity('__khrCollider');
            parent.addChild(child);
            const cd = getCollisionDataFromImplicit(shapeDef, parent.getWorldTransform().getScale());
            if (cd) { child.addComponent('collision', cd); console.log('[initPhysics] __khrCollider added:', cd.type, 'to', parent.name); }
        } else {
            if (!e) continue;
            if (geom.shape !== undefined) {
                const shapeDef = shapeDefs[geom.shape];
                if (!shapeDef) continue;
                const cd = getCollisionDataFromImplicit(shapeDef, e.getWorldTransform().getScale());
                if (!cd) continue;
                e.addComponent('collision', cd);
                console.log('[initPhysics] collision added:', cd.type, 'to', e.name, '(ownerIdx=' + ownerIdx + ')');
                if (ownerIdx < 0) standaloneStatics.push({ entity: e, collider: physExt.collider });
            } else if (geom.mesh !== undefined && ownerIdx < 0) {
                const mat   = physExt.collider.physicsMaterial !== undefined ? (matDefs[physExt.collider.physicsMaterial] ?? {}) : {};
                const frict = mat.dynamicFriction ?? mat.staticFriction ?? 0.5;
                const rest  = mat.restitution ?? 0;
                const body  = addAmmoStaticMeshBody(gltfJson, binary, geom.mesh, e, frict, rest, dynamicsWorld);
                if (body) { meshStaticEntities.push(e); console.log('[initPhysics] mesh static body added for', e.name); }
            }
        }
    }

    // Pass 2: rigidbody components + motion properties.
    const dynamicInfos     = [];
    const staticInfos      = [];
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
            const mat  = ownC?.physicsMaterial !== undefined ? (matDefs[ownC.physicsMaterial] ?? {}) : {};
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

    const debugEntities = [];
    const visitDebug = (e) => {
        if (e.collision?.type && e.collision.type !== 'compound') debugEntities.push(e);
        for (const c of e.children) visitDebug(c);
    };
    for (const info of dynamicInfos) visitDebug(info.entity);
    for (const info of staticInfos)  visitDebug(info.entity);

    return {
        dynamicBodies: dynamicInfos.map(info => ({
            entity: info.entity,
            motionDef: info.motionDef,
            initialPosition: info.entity.getPosition().clone(),
            initialRotation: info.entity.getRotation().clone()
        })),
        gravityOverrides,
        debugEntities,
        meshStaticEntities
    };
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

const _DBG_COLOR_DYNAMIC = new pc.Color(0, 1, 0, 1);
const _DBG_COLOR_STATIC  = new pc.Color(1, 1, 0, 1);

function _ringPoints(axis, radius, segments, out, mat) {
    const tmp = new pc.Vec3();
    let prev = null;
    for (let i = 0; i <= segments; i++) {
        const t = (i / segments) * Math.PI * 2;
        const c = Math.cos(t) * radius, s = Math.sin(t) * radius;
        if      (axis === 0) tmp.set(0, c, s);
        else if (axis === 1) tmp.set(c, 0, s);
        else                 tmp.set(c, s, 0);
        const cur = new pc.Vec3();
        mat.transformPoint(tmp, cur);
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
    app.drawWireAlignedBox(
        new pc.Vec3(-hx, -hy, -hz), new pc.Vec3(hx, hy, hz),
        color, false, undefined, mat
    );
}

function _drawWireCylinderLocal(app, mat, radius, halfHeight, axis, color) {
    const pts = [];
    const segs = 16;
    const oA = new pc.Vec3(), oB = new pc.Vec3();
    if      (axis === 0) { oA.set(-halfHeight, 0, 0); oB.set(halfHeight, 0, 0); }
    else if (axis === 1) { oA.set(0, -halfHeight, 0); oB.set(0, halfHeight, 0); }
    else                 { oA.set(0, 0, -halfHeight); oB.set(0, 0, halfHeight); }
    const tmp = new pc.Vec3();
    const rings = [];
    for (const off of [oA, oB]) {
        const ring = [];
        for (let i = 0; i <= segs; i++) {
            const t = (i / segs) * Math.PI * 2;
            const c = Math.cos(t) * radius, s = Math.sin(t) * radius;
            if      (axis === 0) tmp.set(off.x, c, s);
            else if (axis === 1) tmp.set(c, off.y, s);
            else                 tmp.set(c, s, off.z);
            const v = new pc.Vec3(); mat.transformPoint(tmp, v);
            ring.push(v);
        }
        rings.push(ring);
        for (let i = 0; i < segs; i++) { pts.push(ring[i]); pts.push(ring[i + 1]); }
    }
    const step = Math.floor(segs / 4);
    for (let k = 0; k < 4; k++) { pts.push(rings[0][k * step]); pts.push(rings[1][k * step]); }
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

function _getPosRotMat(entity) {
    return new pc.Mat4().setTRS(entity.getPosition(), entity.getRotation(), pc.Vec3.ONE);
}

function drawMeshStaticDebug(app, entities) {
    for (const e of entities) {
        if (!e.render) continue;
        for (const mi of e.render.meshInstances) {
            const c = mi.aabb.center, h = mi.aabb.halfExtents;
            const mat = new pc.Mat4().setTranslate(c.x, c.y, c.z);
            _drawWireBoxLocal(app, mat, h.x, h.y, h.z, _DBG_COLOR_STATIC);
        }
    }
}

function drawPhysicsDebug(app, entities) {
    for (const entity of entities) {
        const col = entity.collision;
        if (!col?.type) continue;
        let rbOwner = entity;
        while (rbOwner && !rbOwner.rigidbody) rbOwner = rbOwner.parent;
        const color = rbOwner?.rigidbody?.type === pc.BODYTYPE_DYNAMIC ? _DBG_COLOR_DYNAMIC : _DBG_COLOR_STATIC;
        const mat = _getPosRotMat(entity);
        switch (col.type) {
            case 'box':     _drawWireBoxLocal(app, mat, col.halfExtents.x, col.halfExtents.y, col.halfExtents.z, color); break;
            case 'sphere':  _drawWireSphereLocal(app, mat, col.radius, color); break;
            case 'capsule': _drawWireCapsuleLocal(app, mat, col.radius, Math.max(0, (col.height - 2 * col.radius) * 0.5), col.axis ?? 1, color); break;
            case 'cylinder':_drawWireCylinderLocal(app, mat, col.radius, col.height * 0.5, col.axis ?? 1, color); break;
        }
    }
}

function init() {
    const canvas = document.getElementById('c');
    const app = new pc.Application(canvas, {
        mouse: new pc.Mouse(canvas),
        touch: new pc.TouchDevice(canvas)
    });
    if (typeof Ammo !== 'undefined' && app.systems.rigidbody) {
        app.systems.rigidbody.gravity.set(0, -9.81, 0);
        app.systems.rigidbody.onLibraryLoaded();
    }
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
        fetchGlbData(MODEL_URL),
        new Promise((resolve, reject) => {
            app.assets.loadFromUrlAndFilename(MODEL_URL, MODEL_URL.split('/').pop(), 'container',
                (err, asset) => err ? reject(err) : resolve(asset));
        })
    ]).then(([glbData, asset]) => {
        const { json: gltfJson, binary } = glbData;
        const res = asset.resource;
        const root = res.instantiateRenderEntity ? res.instantiateRenderEntity() : res.instantiateModelEntity();
        app.root.addChild(root);
        enableShadows(root);

        const entityMap = buildEntityMap(gltfJson, root);
        const { dynamicBodies: bodies, gravityOverrides, debugEntities, meshStaticEntities } =
            initPhysics(gltfJson, binary, entityMap, app.systems.rigidbody.dynamicsWorld);
        dynamicBodies = bodies;

        const { center, radius } = computeBodyBounds(dynamicBodies);
        const startPos = new pc.Vec3(center.x, center.y + 1.5, center.z + radius);
        controls.reset(center, startPos);

        let gravityApplied = false;
        app.on('update', dt => {
            drawPhysicsDebug(app, debugEntities);
            drawMeshStaticDebug(app, meshStaticEntities);
            if (!gravityApplied) {
                gravityApplied = true;
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
