import * as pc from 'playcanvas';
import { CameraControls } from 'playcanvas/scripts/esm/camera-controls.mjs';

const PC_ROOT = 'https://cx20.github.io/gltf-test/libs/playcanvas/v2.14.2';
const MODEL_URL = 'https://raw.githubusercontent.com/eoineoineoin/glTF_Physics/master/samples/Filtering/Filtering.glb';
const RESET_Y_THRESHOLD = -20;

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

function addAmmoStaticMeshBody(json, binary, meshIdx, entity, friction, restitution, dynamicsWorld, group, mask) {
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
    if (group !== undefined && mask !== undefined) {
        dynamicsWorld.addRigidBody(body, group, mask);
    } else {
        dynamicsWorld.addRigidBody(body);
    }
    Ammo.destroy(xform); Ammo.destroy(localInertia); Ammo.destroy(rbInfo);
    return body;
}

// --- Collision filtering helpers ---

function parseSystemList(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value.filter(Boolean);
    return String(value).split(/\s+/).filter(Boolean);
}

function buildSystemBitMap(filterDefs) {
    const map = new Map();
    let nextBit = 0;
    for (const f of filterDefs) {
        for (const sys of [...parseSystemList(f.collisionSystems), ...parseSystemList(f.collideWithSystems)]) {
            if (!map.has(sys)) map.set(sys, 1 << nextBit++);
        }
    }
    return map;
}

function getFilterGroupMask(filterDef, systemBitMap) {
    if (!filterDef) return null;
    const group = parseSystemList(filterDef.collisionSystems).reduce((m, s) => m | (systemBitMap.get(s) ?? 0), 0);
    const mask  = parseSystemList(filterDef.collideWithSystems).reduce((m, s) => m | (systemBitMap.get(s) ?? 0), 0);
    return { group: group || 0xFFFF, mask: mask || 0xFFFF };
}

// Re-add a PlayCanvas-managed rigid body with custom group/mask.
// PlayCanvas adds the body with default filter on addComponent; we remove and re-add.
function applyBodyFilter(entity, gm, dynamicsWorld) {
    if (!gm) return;
    const body = entity.rigidbody?.body;
    if (!body) return;
    dynamicsWorld.removeRigidBody(body);
    dynamicsWorld.addRigidBody(body, gm.group, gm.mask);
}

// ---

function buildEntityMap(gltfJson, clonedRoot) {
    const nodes = gltfJson.nodes ?? [];
    const map = new Array(nodes.length).fill(null);

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
    for (let s = 0; s < scenes.length; s++) {
        const sceneRoot = sceneRoots[s];
        if (!sceneRoot) continue;
        const rootIndices = scenes[s].nodes ?? [];
        if (rootIndices.length === 1 && sceneRoot.name === (nodes[rootIndices[0]]?.name ?? '')) {
            walk(rootIndices[0], sceneRoot);
            continue;
        }
        const byName = nameMap(sceneRoot.children);
        for (const ri of rootIndices) {
            const rName = nodes[ri]?.name ?? '';
            const candidates = byName.get(rName);
            if (candidates?.length) walk(ri, candidates.shift());
        }
    }
    return map;
}

function getCollisionDataFromImplicit(shapeDef, worldScale) {
    const sx = Math.abs(worldScale.x), sy = Math.abs(worldScale.y), sz = Math.abs(worldScale.z);
    if (shapeDef.sphere)   return { type: 'sphere', radius: (shapeDef.sphere.radius ?? 0.5) * Math.max(sx, sy, sz) };
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
    const matDefs    = gltfJson.extensions?.KHR_physics_rigid_bodies?.physicsMaterials ?? [];
    const filterDefs = gltfJson.extensions?.KHR_physics_rigid_bodies?.collisionFilters ?? [];
    const shapeDefs  = gltfJson.extensions?.KHR_implicit_shapes?.shapes ?? [];
    const nodes      = gltfJson.nodes ?? [];

    const systemBitMap = buildSystemBitMap(filterDefs);

    const parentOf = new Array(nodes.length).fill(-1);
    for (let i = 0; i < nodes.length; i++)
        for (const c of nodes[i].children ?? []) parentOf[c] = i;

    const hasMotion = i => !!nodes[i]?.extensions?.KHR_physics_rigid_bodies?.motion;
    function findBodyOwner(idx) {
        let cur = idx;
        while (cur >= 0) { if (hasMotion(cur)) return cur; cur = parentOf[cur]; }
        return -1;
    }

    // Pass 1: compound collision components for body-owners.
    const bodyOwnerNodes = [];
    for (let i = 0; i < nodes.length; i++) {
        if (!hasMotion(i)) continue;
        const e = entityMap[i];
        if (!e) continue;
        e.addComponent('collision', { type: 'compound' });
        bodyOwnerNodes.push(i);
    }

    const standaloneStatics  = [];
    const meshStaticEntities = [];

    for (let i = 0; i < nodes.length; i++) {
        const physExt  = nodes[i].extensions?.KHR_physics_rigid_bodies;
        if (!physExt?.collider?.geometry) continue;
        const geom     = physExt.collider.geometry;
        const ownerIdx = findBodyOwner(i);
        const mat      = physExt.collider.physicsMaterial !== undefined ? (matDefs[physExt.collider.physicsMaterial] ?? {}) : {};

        if (ownerIdx === i) {
            if (geom.shape === undefined) continue;
            const parent   = entityMap[i]; if (!parent) continue;
            const shapeDef = shapeDefs[geom.shape]; if (!shapeDef) continue;
            const child = new pc.Entity('__khrCollider');
            parent.addChild(child);
            const cd = getCollisionDataFromImplicit(shapeDef, parent.getWorldTransform().getScale());
            if (cd) child.addComponent('collision', cd);
        } else {
            const e = entityMap[i]; if (!e) continue;
            if (geom.shape !== undefined) {
                const shapeDef = shapeDefs[geom.shape]; if (!shapeDef) continue;
                const cd = getCollisionDataFromImplicit(shapeDef, e.getWorldTransform().getScale());
                if (!cd) continue;
                e.addComponent('collision', cd);
                if (ownerIdx < 0) standaloneStatics.push({ entity: e, collider: physExt.collider });
            } else if (geom.mesh !== undefined && ownerIdx < 0) {
                const filterIdx = physExt.collider.collisionFilter;
                const gm = getFilterGroupMask(filterIdx !== undefined ? filterDefs[filterIdx] : null, systemBitMap);
                const frict = mat.dynamicFriction ?? mat.staticFriction ?? 0.5;
                const rest  = mat.restitution ?? 0;
                const body  = addAmmoStaticMeshBody(gltfJson, binary, geom.mesh, e, frict, rest, dynamicsWorld,
                    gm?.group, gm?.mask);
                if (body) meshStaticEntities.push(e);
            }
        }
    }

    // Pass 2: rigidbody components + friction/restitution.
    const dynamicInfos = [];
    const staticInfos  = [];
    const filterTasks  = []; // { entity, filterDef } to apply after component creation

    for (const i of bodyOwnerNodes) {
        const e = entityMap[i];
        const m = nodes[i].extensions.KHR_physics_rigid_bodies.motion;
        const isK = !!m?.isKinematic;
        const cfg = { type: isK ? 'kinematic' : 'dynamic' };
        if (!isK) cfg.mass = m?.mass ?? 1;
        e.addComponent('rigidbody', cfg);
        const ownC = nodes[i].extensions.KHR_physics_rigid_bodies.collider;
        const mat  = ownC?.physicsMaterial !== undefined ? (matDefs[ownC.physicsMaterial] ?? {}) : {};
        const filterIdx = ownC?.collisionFilter;
        const filterDef = filterIdx !== undefined ? filterDefs[filterIdx] : null;
        if (!isK) {
            dynamicInfos.push({ entity: e, mat });
            if (filterDef) filterTasks.push({ entity: e, filterDef });
        } else {
            staticInfos.push({ entity: e, mat });
            if (filterDef) filterTasks.push({ entity: e, filterDef });
        }
    }
    for (const { entity, collider } of standaloneStatics) {
        entity.addComponent('rigidbody', { type: 'static' });
        const mat = collider.physicsMaterial !== undefined ? (matDefs[collider.physicsMaterial] ?? {}) : {};
        staticInfos.push({ entity, mat });
        const filterIdx = collider.collisionFilter;
        const filterDef = filterIdx !== undefined ? filterDefs[filterIdx] : null;
        if (filterDef) filterTasks.push({ entity, filterDef });
    }

    for (const info of dynamicInfos) {
        if (info.mat.dynamicFriction !== undefined) info.entity.rigidbody.friction    = info.mat.dynamicFriction;
        if (info.mat.restitution     !== undefined) info.entity.rigidbody.restitution = info.mat.restitution;
    }

    // Apply collision filters (remove + re-add with group/mask).
    for (const { entity, filterDef } of filterTasks) {
        applyBodyFilter(entity, getFilterGroupMask(filterDef, systemBitMap), dynamicsWorld);
    }

    // Collect leaf collision entities for debug wireframe.
    const debugEntities = [];
    const visitDebug = e => {
        if (e.collision?.type && e.collision.type !== 'compound') debugEntities.push(e);
        for (const c of e.children) visitDebug(c);
    };
    for (const info of dynamicInfos) visitDebug(info.entity);
    for (const info of staticInfos)  visitDebug(info.entity);

    return {
        dynamicBodies: dynamicInfos.map(info => ({
            entity: info.entity,
            initialPosition: info.entity.getPosition().clone(),
            initialRotation: info.entity.getRotation().clone()
        })),
        debugEntities,
        meshStaticEntities
    };
}

// --- Debug wireframe ---

const _DBG_COLOR_DYNAMIC = new pc.Color(0, 1, 0, 1);
const _DBG_COLOR_STATIC  = new pc.Color(1, 1, 0, 1);

function _ringPoints(axis, radius, segs, out, mat) {
    const tmp = new pc.Vec3(); let prev = null;
    for (let i = 0; i <= segs; i++) {
        const t = (i / segs) * Math.PI * 2, c = Math.cos(t) * radius, s = Math.sin(t) * radius;
        if      (axis === 0) tmp.set(0, c, s);
        else if (axis === 1) tmp.set(c, 0, s);
        else                 tmp.set(c, s, 0);
        const cur = new pc.Vec3(); mat.transformPoint(tmp, cur);
        if (prev) { out.push(prev); out.push(cur); }
        prev = cur;
    }
}

function _getPosRotMat(e) { return new pc.Mat4().setTRS(e.getPosition(), e.getRotation(), pc.Vec3.ONE); }

function _drawWireSphereLocal(app, mat, r, color) {
    const pts = []; _ringPoints(0, r, 16, pts, mat); _ringPoints(1, r, 16, pts, mat); _ringPoints(2, r, 16, pts, mat);
    app.drawLines(pts, pts.map(() => color), false);
}
function _drawWireBoxLocal(app, mat, hx, hy, hz, color) {
    app.drawWireAlignedBox(new pc.Vec3(-hx, -hy, -hz), new pc.Vec3(hx, hy, hz), color, false, undefined, mat);
}
function _drawWireCylinderLocal(app, mat, radius, halfH, axis, color) {
    const pts = [], segs = 16;
    const oA = new pc.Vec3(), oB = new pc.Vec3();
    if      (axis === 0) { oA.set(-halfH,0,0); oB.set(halfH,0,0); }
    else if (axis === 1) { oA.set(0,-halfH,0); oB.set(0,halfH,0); }
    else                 { oA.set(0,0,-halfH); oB.set(0,0,halfH); }
    const tmp = new pc.Vec3(), rings = [];
    for (const off of [oA, oB]) {
        const ring = [];
        for (let i = 0; i <= segs; i++) {
            const t = (i/segs)*Math.PI*2, c = Math.cos(t)*radius, s = Math.sin(t)*radius;
            if      (axis === 0) tmp.set(off.x, c, s);
            else if (axis === 1) tmp.set(c, off.y, s);
            else                 tmp.set(c, s, off.z);
            const v = new pc.Vec3(); mat.transformPoint(tmp, v); ring.push(v);
        }
        rings.push(ring);
        for (let i = 0; i < segs; i++) { pts.push(ring[i]); pts.push(ring[i+1]); }
    }
    const step = Math.floor(segs/4);
    for (let k = 0; k < 4; k++) { pts.push(rings[0][k*step]); pts.push(rings[1][k*step]); }
    app.drawLines(pts, pts.map(() => color), false);
}
function _drawWireCapsuleLocal(app, mat, r, cylHalf, axis, color) {
    _drawWireCylinderLocal(app, mat, r, cylHalf, axis, color);
    const off = new pc.Vec3();
    for (const sign of [-1, 1]) {
        if      (axis === 0) off.set(sign*cylHalf,0,0);
        else if (axis === 1) off.set(0,sign*cylHalf,0);
        else                 off.set(0,0,sign*cylHalf);
        _drawWireSphereLocal(app, new pc.Mat4().mul2(mat, new pc.Mat4().setTranslate(off.x,off.y,off.z)), r, color);
    }
}

function drawPhysicsDebug(app, entities) {
    for (const entity of entities) {
        const col = entity.collision; if (!col?.type) continue;
        let rb = entity; while (rb && !rb.rigidbody) rb = rb.parent;
        const color = rb?.rigidbody?.type === pc.BODYTYPE_DYNAMIC ? _DBG_COLOR_DYNAMIC : _DBG_COLOR_STATIC;
        const mat = _getPosRotMat(entity);
        switch (col.type) {
            case 'box':      _drawWireBoxLocal(app, mat, col.halfExtents.x, col.halfExtents.y, col.halfExtents.z, color); break;
            case 'sphere':   _drawWireSphereLocal(app, mat, col.radius, color); break;
            case 'capsule':  _drawWireCapsuleLocal(app, mat, col.radius, Math.max(0,(col.height-2*col.radius)*0.5), col.axis??1, color); break;
            case 'cylinder': _drawWireCylinderLocal(app, mat, col.radius, col.height*0.5, col.axis??1, color); break;
        }
    }
}

function drawMeshStaticDebug(app, entities) {
    const pa = new pc.Vec3(), pb = new pc.Vec3(), wa = new pc.Vec3(), wb = new pc.Vec3();
    for (const e of entities) {
        if (!e.render) continue;
        const wm = e.getWorldTransform();
        for (const mi of e.render.meshInstances) {
            const pos = [], idx = [];
            mi.mesh.getPositions(pos); mi.mesh.getIndices(idx);
            if (pos.length > 0 && idx.length > 0) {
                const pts = [];
                for (let i = 0; i < idx.length; i += 3) {
                    const a = idx[i]*3, b = idx[i+1]*3, c = idx[i+2]*3;
                    for (const [s,t] of [[a,b],[b,c],[c,a]]) {
                        pa.set(pos[s],pos[s+1],pos[s+2]); pb.set(pos[t],pos[t+1],pos[t+2]);
                        wm.transformPoint(pa,wa); wm.transformPoint(pb,wb);
                        pts.push(wa.clone(), wb.clone());
                    }
                }
                if (pts.length) app.drawLines(pts, pts.map(() => _DBG_COLOR_STATIC), false);
            } else {
                const c = mi.aabb.center, h = mi.aabb.halfExtents;
                _drawWireBoxLocal(app, new pc.Mat4().setTranslate(c.x,c.y,c.z), h.x, h.y, h.z, _DBG_COLOR_STATIC);
            }
        }
    }
}

// ---

function enableShadows(e) {
    if (e.render) { e.render.castShadows = true; e.render.receiveShadows = true; }
    if (e.model)  { e.model.castShadows  = true; e.model.receiveShadows  = true; }
    for (const c of e.children) enableShadows(c);
}

function computeBodyBounds(dynamicBodies) {
    if (!dynamicBodies.length) return { center: new pc.Vec3(0, 2, 0), radius: 12 };
    let minX=Infinity,minY=Infinity,minZ=Infinity,maxX=-Infinity,maxY=-Infinity,maxZ=-Infinity;
    for (const b of dynamicBodies) {
        const p = b.initialPosition;
        minX=Math.min(minX,p.x); maxX=Math.max(maxX,p.x);
        minY=Math.min(minY,p.y); maxY=Math.max(maxY,p.y);
        minZ=Math.min(minZ,p.z); maxZ=Math.max(maxZ,p.z);
    }
    const center = new pc.Vec3((minX+maxX)*0.5,(minY+maxY)*0.5,(minZ+maxZ)*0.5);
    const d = Math.sqrt((maxX-minX)**2+(maxY-minY)**2+(maxZ-minZ)**2);
    return { center, radius: Math.max(d+8, 12) };
}

let showWireframe = true;

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
    window.addEventListener('keydown', event => {
        if ((event.code === 'KeyW' || event.key === 'w' || event.key === 'W') && !event.repeat) {
            showWireframe = !showWireframe;
            const hint = document.getElementById('hint');
            if (hint) hint.textContent = 'W: wireframe ' + (showWireframe ? 'ON' : 'OFF');
        }
    });

    app.scene.ambientLight = new pc.Color(0.4, 0.45, 0.5);

    const light = new pc.Entity('light');
    light.addComponent('light', { type: 'directional', color: new pc.Color(1, 0.95, 0.85),
        intensity: 1.0, castShadows: true, shadowResolution: 2048, shadowBias: 0.3, normalOffsetBias: 0.02 });
    light.setLocalEulerAngles(45, 45, 0);
    app.root.addChild(light);

    const fillLight = new pc.Entity('fillLight');
    fillLight.addComponent('light', { type: 'directional', color: new pc.Color(0.45, 0.6, 1.0),
        intensity: 0.5, castShadows: false });
    fillLight.setLocalEulerAngles(-30, 180, 0);
    app.root.addChild(fillLight);

    const camera = new pc.Entity('camera');
    camera.addComponent('camera', { clearColor: new pc.Color(0.96,0.97,0.99), nearClip: 0.05, farClip: 1000, fov: 45 });
    camera.addComponent('script');
    camera.setPosition(0, 2, 15);
    app.root.addChild(camera);
    const controls = camera.script.create(CameraControls, { properties: { enableFly: false } });

    let dynamicBodies    = [];
    let debugEntities    = [];
    let meshStaticEntities = [];

    Promise.all([
        fetchGlbData(MODEL_URL),
        new Promise((resolve, reject) => {
            app.assets.loadFromUrlAndFilename(MODEL_URL, MODEL_URL.split('/').pop(), 'container',
                (err, asset) => err ? reject(err) : resolve(asset));
        })
    ]).then(([glbData, asset]) => {
        const { json: gltfJson, binary } = glbData;
        const res  = asset.resource;
        const root = res.instantiateRenderEntity ? res.instantiateRenderEntity() : res.instantiateModelEntity();
        app.root.addChild(root);
        enableShadows(root);

        const entityMap = buildEntityMap(gltfJson, root);
        const result    = initPhysics(gltfJson, binary, entityMap, app.systems.rigidbody.dynamicsWorld);
        dynamicBodies      = result.dynamicBodies;
        debugEntities      = result.debugEntities;
        meshStaticEntities = result.meshStaticEntities;

        const { center, radius } = computeBodyBounds(dynamicBodies);
        const startPos = new pc.Vec3(center.x, center.y + 1.5, center.z + radius);
        controls.reset(center, startPos);

        app.on('update', () => {
            if (showWireframe) {
                drawPhysicsDebug(app, debugEntities);
                drawMeshStaticDebug(app, meshStaticEntities);
            }
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
