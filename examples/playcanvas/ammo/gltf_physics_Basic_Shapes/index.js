import * as pc from 'playcanvas';
import { loadWasmModuleAsync } from 'https://rawcdn.githack.com/playcanvas/engine/f8e929634cf7b057f7c80ac206a4f3d2d11843dc/examples/src/wasm-loader.js';

const MODEL_URL = 'https://raw.githubusercontent.com/eoineoineoin/glTF_Physics/master/samples/ShapeTypes/ShapeTypes.glb';
const RESET_Y_THRESHOLD = -20;

const _DBG_COLOR_DYNAMIC = new pc.Color(0, 1, 0, 1);
const _DBG_COLOR_STATIC  = new pc.Color(1, 1, 0, 1);

loadWasmModuleAsync(
    'Ammo',
    'https://rawcdn.githack.com/playcanvas/engine/f8e929634cf7b057f7c80ac206a4f3d2d11843dc/examples/src/lib/ammo/ammo.wasm.js',
    'https://rawcdn.githack.com/playcanvas/engine/f8e929634cf7b057f7c80ac206a4f3d2d11843dc/examples/src/lib/ammo/ammo.wasm.wasm',
    init
);

// Returns both the glTF JSON and the raw binary chunk from a GLB file.
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

// Read Float32 attribute data from a glTF accessor + binary chunk.
function readGlbFloat32(json, binary, accessorIdx) {
    const acc = json.accessors[accessorIdx];
    const bv  = json.bufferViews[acc.bufferView];
    const totalOffset = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
    const components  = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[acc.type] ?? 1;
    const stride      = bv.byteStride ?? 0;
    if (!stride || stride === components * 4) {
        return new Float32Array(binary.slice(totalOffset, totalOffset + acc.count * components * 4));
    }
    const result = new Float32Array(acc.count * components);
    const dv = new DataView(binary);
    for (let i = 0; i < acc.count; i++)
        for (let c = 0; c < components; c++)
            result[i * components + c] = dv.getFloat32(totalOffset + i * stride + c * 4, true);
    return result;
}

// Read index data from a glTF accessor + binary chunk.
function readGlbIndices(json, binary, accessorIdx) {
    const acc = json.accessors[accessorIdx];
    const bv  = json.bufferViews[acc.bufferView];
    const off = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
    if (acc.componentType === 5125) return new Uint32Array(binary.slice(off, off + acc.count * 4));
    if (acc.componentType === 5123) return new Uint16Array(binary.slice(off, off + acc.count * 2));
    return new Uint8Array(binary.slice(off, off + acc.count));
}

// Build an Ammo.btBvhTriangleMeshShape directly from glTF mesh data and add a
// static rigid body to the dynamics world.  This bypasses PlayCanvas's collision
// component so that vertex data is always read from the GLB binary rather than
// from a potentially discarded GPU-side vertex buffer.
function addAmmoStaticMeshBody(json, binary, meshIdx, entity, friction, restitution, dynamicsWorld) {
    const gltfMesh = json.meshes[meshIdx];
    if (!gltfMesh) return null;

    const btTriMesh = new Ammo.btTriangleMesh(true, true);
    let triCount = 0;

    for (const prim of gltfMesh.primitives ?? []) {
        if ((prim.mode ?? 4) !== 4) continue; // TRIANGLES only
        const posIdx = prim.attributes?.POSITION;
        if (posIdx === undefined) continue;

        const pos  = readGlbFloat32(json, binary, posIdx);
        const idxs = prim.indices !== undefined ? readGlbIndices(json, binary, prim.indices) : null;
        const n    = idxs ? idxs.length / 3 : pos.length / 9;

        for (let t = 0; t < n; t++) {
            const i0 = (idxs ? idxs[t * 3]     : t * 3)     * 3;
            const i1 = (idxs ? idxs[t * 3 + 1] : t * 3 + 1) * 3;
            const i2 = (idxs ? idxs[t * 3 + 2] : t * 3 + 2) * 3;
            const v0 = new Ammo.btVector3(pos[i0], pos[i0 + 1], pos[i0 + 2]);
            const v1 = new Ammo.btVector3(pos[i1], pos[i1 + 1], pos[i1 + 2]);
            const v2 = new Ammo.btVector3(pos[i2], pos[i2 + 1], pos[i2 + 2]);
            btTriMesh.addTriangle(v0, v1, v2, false);
            Ammo.destroy(v0); Ammo.destroy(v1); Ammo.destroy(v2);
            triCount++;
        }
    }

    if (triCount === 0) { Ammo.destroy(btTriMesh); return null; }

    const shape = new Ammo.btBvhTriangleMeshShape(btTriMesh, true);

    // Apply world scale to the shape (Bullet body transform has no scale component).
    const ws = entity.getWorldTransform().getScale();
    const ls = new Ammo.btVector3(Math.abs(ws.x), Math.abs(ws.y), Math.abs(ws.z));
    shape.setLocalScaling(ls);
    Ammo.destroy(ls);

    // Place the body at the entity's world position + rotation.
    const p = entity.getPosition(), q = entity.getRotation();
    const xform = new Ammo.btTransform();
    xform.setIdentity();
    xform.setOrigin(new Ammo.btVector3(p.x, p.y, p.z));
    xform.setRotation(new Ammo.btQuaternion(q.x, q.y, q.z, q.w));

    const motionState  = new Ammo.btDefaultMotionState(xform);
    const localInertia = new Ammo.btVector3(0, 0, 0);
    const rbInfo       = new Ammo.btRigidBodyConstructionInfo(0, motionState, shape, localInertia);
    const body         = new Ammo.btRigidBody(rbInfo);
    body.setFriction(friction    ?? 0.5);
    body.setRestitution(restitution ?? 0);

    dynamicsWorld.addRigidBody(body);

    Ammo.destroy(xform);
    Ammo.destroy(localInertia);
    Ammo.destroy(rbInfo);
    // shape, motionState, btTriMesh are owned by the physics world — do NOT destroy.

    return body;
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

// gltfJson  – parsed glTF JSON
// binary    – raw GLB binary chunk (ArrayBuffer)
// entityMap – glTF node index → PlayCanvas entity
// dynamicsWorld – Ammo dynamics world (for manual static mesh bodies)
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

    // Pass 1: give every body-owner a compound collision component.
    const bodyOwnerNodes = [];
    for (let i = 0; i < nodes.length; i++) {
        if (!hasMotion(i)) continue;
        const e = entityMap[i];
        if (!e) continue;
        e.addComponent('collision', { type: 'compound' });
        bodyOwnerNodes.push(i);
    }

    // Attach collision shapes to the appropriate entities.
    const standaloneStatics  = [];
    const meshStaticEntities = []; // entities whose physics were added directly to Ammo

    for (let i = 0; i < nodes.length; i++) {
        const physExt = nodes[i].extensions?.KHR_physics_rigid_bodies;
        if (!physExt?.collider?.geometry) continue;
        const geo      = physExt.collider.geometry;
        const shapeIdx = geo.shape;
        const meshIdx  = geo.mesh;
        if (shapeIdx === undefined && meshIdx === undefined) continue;

        const ownerIdx = findBodyOwner(i);

        if (ownerIdx === i) {
            // Body-owner with self-collider: implicit shape → synthetic child.
            // Mesh colliders on compound owners are skipped (Bullet restriction).
            if (shapeIdx === undefined) continue;
            const parent   = entityMap[i];
            if (!parent) continue;
            const shapeDef = shapeDefs[shapeIdx];
            if (!shapeDef) continue;
            const child = new pc.Entity('__khrCollider');
            parent.addChild(child);
            const cd = getCollisionDataFromImplicit(shapeDef, parent.getWorldTransform().getScale());
            if (cd) child.addComponent('collision', cd);

        } else {
            const e = entityMap[i];
            if (!e) continue;

            if (shapeIdx !== undefined) {
                // Implicit shape: use PlayCanvas collision component.
                const shapeDef = shapeDefs[shapeIdx];
                if (!shapeDef) continue;
                const cd = getCollisionDataFromImplicit(shapeDef, e.getWorldTransform().getScale());
                if (!cd) continue;
                e.addComponent('collision', cd);
                if (ownerIdx < 0) standaloneStatics.push({ entity: e, collider: physExt.collider });

            } else if (meshIdx !== undefined && ownerIdx < 0) {
                // Static mesh body: build btBvhTriangleMeshShape manually from GLB binary.
                // This avoids relying on PlayCanvas reading back GPU-side vertex buffers.
                const mat = physExt.collider.physicsMaterial !== undefined
                    ? (matDefs[physExt.collider.physicsMaterial] ?? {}) : {};
                const frict = mat.dynamicFriction ?? mat.staticFriction ?? 0.5;
                const rest  = mat.restitution ?? 0;
                const body  = addAmmoStaticMeshBody(gltfJson, binary, meshIdx, e, frict, rest, dynamicsWorld);
                if (body) meshStaticEntities.push(e);
            }
        }
    }

    // Pass 2: rigidbody components for body-owner nodes and standalone statics.
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
        const mat  = ownC?.physicsMaterial !== undefined ? (matDefs[ownC.physicsMaterial] ?? {}) : {};
        (isK ? staticInfos : dynamicInfos).push({ entity: e, mat });
    }
    for (const { entity, collider } of standaloneStatics) {
        entity.addComponent('rigidbody', { type: 'static' });
        const mat = collider.physicsMaterial !== undefined ? (matDefs[collider.physicsMaterial] ?? {}) : {};
        staticInfos.push({ entity, mat });
    }

    for (const info of dynamicInfos) {
        if (info.mat.dynamicFriction !== undefined) info.entity.rigidbody.friction    = info.mat.dynamicFriction;
        if (info.mat.restitution     !== undefined) info.entity.rigidbody.restitution = info.mat.restitution;
    }

    // Collect leaf collision entities for debug wireframe drawing.
    const debugEntities = [];
    const visitForDebug = (e) => {
        if (e.collision && e.collision.type && e.collision.type !== 'compound') debugEntities.push(e);
        for (const c of e.children) visitForDebug(c);
    };
    for (const info of dynamicInfos) visitForDebug(info.entity);
    for (const info of staticInfos)  visitForDebug(info.entity);

    return {
        dynamicBodies: dynamicInfos.map(info => ({
            entity: info.entity,
            initialPosition: info.entity.getPosition().clone(),
            initialRotation: info.entity.getRotation().clone()
        })),
        debugEntities,
        meshStaticEntities // entities with manual Ammo bodies (no PC collision component)
    };
}

// --- Physics debug wireframe helpers ---

function _ringPoints(axis, radius, segments, out, mat) {
    const tmp = new pc.Vec3();
    const transformed = new pc.Vec3();
    let prev = null;
    for (let i = 0; i <= segments; i++) {
        const t = (i / segments) * Math.PI * 2;
        const c = Math.cos(t) * radius;
        const s = Math.sin(t) * radius;
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
    const segs = 16;
    _ringPoints(0, radius, segs, pts, mat);
    _ringPoints(1, radius, segs, pts, mat);
    _ringPoints(2, radius, segs, pts, mat);
    const colors = pts.map(() => color);
    app.drawLines(pts, colors, false);
}

function _drawWireBoxLocal(app, mat, hx, hy, hz, color) {
    app.drawWireAlignedBox(
        new pc.Vec3(-hx, -hy, -hz),
        new pc.Vec3( hx,  hy,  hz),
        color, false, undefined, mat
    );
}

function _drawWireCylinderLocal(app, mat, radius, halfHeight, axis, color) {
    const pts = [];
    const segs = 16;
    const offsetA = new pc.Vec3();
    const offsetB = new pc.Vec3();
    if      (axis === 0) { offsetA.set(-halfHeight, 0, 0); offsetB.set(halfHeight, 0, 0); }
    else if (axis === 1) { offsetA.set(0, -halfHeight, 0); offsetB.set(0, halfHeight, 0); }
    else                 { offsetA.set(0, 0, -halfHeight); offsetB.set(0, 0, halfHeight); }

    const tmp = new pc.Vec3();
    const transformed = new pc.Vec3();
    const verts = [];
    for (const off of [offsetA, offsetB]) {
        const ring = [];
        for (let i = 0; i <= segs; i++) {
            const t = (i / segs) * Math.PI * 2;
            const c = Math.cos(t) * radius;
            const s = Math.sin(t) * radius;
            if      (axis === 0) tmp.set(off.x, c, s);
            else if (axis === 1) tmp.set(c, off.y, s);
            else                 tmp.set(c, s, off.z);
            mat.transformPoint(tmp, transformed);
            ring.push(transformed.clone());
        }
        verts.push(ring);
        for (let i = 0; i < segs; i++) { pts.push(ring[i]); pts.push(ring[i + 1]); }
    }
    const stepIdx = Math.floor(segs / 4);
    for (let k = 0; k < 4; k++) {
        const idx = k * stepIdx;
        pts.push(verts[0][idx]);
        pts.push(verts[1][idx]);
    }
    const colors = pts.map(() => color);
    app.drawLines(pts, colors, false);
}

function _drawWireCapsuleLocal(app, mat, radius, cylinderHalfHeight, axis, color) {
    _drawWireCylinderLocal(app, mat, radius, cylinderHalfHeight, axis, color);
    const off = new pc.Vec3();
    for (const sign of [-1, 1]) {
        if      (axis === 0) off.set(sign * cylinderHalfHeight, 0, 0);
        else if (axis === 1) off.set(0, sign * cylinderHalfHeight, 0);
        else                 off.set(0, 0, sign * cylinderHalfHeight);
        const local = new pc.Mat4().setTranslate(off.x, off.y, off.z);
        const world = new pc.Mat4().mul2(mat, local);
        _drawWireSphereLocal(app, world, radius, color);
    }
}

function _getPosRotMat(entity) {
    return new pc.Mat4().setTRS(entity.getPosition(), entity.getRotation(), pc.Vec3.ONE);
}

function drawPhysicsDebug(app, entities) {
    for (const entity of entities) {
        const col = entity.collision;
        if (!col || !col.type) continue;
        let rbOwner = entity;
        while (rbOwner && !rbOwner.rigidbody) rbOwner = rbOwner.parent;
        const isDynamic = rbOwner?.rigidbody?.type === pc.BODYTYPE_DYNAMIC;
        const color = isDynamic ? _DBG_COLOR_DYNAMIC : _DBG_COLOR_STATIC;
        switch (col.type) {
            case 'box': {
                const mat = _getPosRotMat(entity);
                const h = col.halfExtents;
                _drawWireBoxLocal(app, mat, h.x, h.y, h.z, color);
                break;
            }
            case 'sphere': {
                const mat = _getPosRotMat(entity);
                _drawWireSphereLocal(app, mat, col.radius, color);
                break;
            }
            case 'capsule': {
                const mat = _getPosRotMat(entity);
                const r = col.radius;
                const cylHalf = Math.max(0, (col.height - 2 * r) * 0.5);
                _drawWireCapsuleLocal(app, mat, r, cylHalf, col.axis ?? 1, color);
                break;
            }
            case 'cylinder': {
                const mat = _getPosRotMat(entity);
                _drawWireCylinderLocal(app, mat, col.radius, col.height * 0.5, col.axis ?? 1, color);
                break;
            }
        }
    }
}

// Draw AABB boxes for entities whose collision was registered directly in Ammo
// (no PlayCanvas collision component, so they can't appear in drawPhysicsDebug).
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

// ---

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

    app.scene.ambientLight = new pc.Color(0.68, 0.7, 0.76);
    const light = new pc.Entity('light');
    light.addComponent('light', { type: 'directional', color: new pc.Color(1,1,1),
        castShadows: true, shadowResolution: 2048, shadowBias: 0.3, normalOffsetBias: 0.02 });
    light.setLocalEulerAngles(45, 45, 45);
    app.root.addChild(light);

    const camera = new pc.Entity('camera');
    camera.addComponent('camera', { clearColor: new pc.Color(0.96,0.97,0.99), nearClip: 0.05, farClip: 1000, fov: 45 });
    app.root.addChild(camera);

    let dynamicBodies      = [];
    let debugEntities      = [];
    let meshStaticEntities = [];

    Promise.all([
        fetchGlbData(MODEL_URL),
        new Promise((resolve, reject) => {
            app.assets.loadFromUrlAndFilename(MODEL_URL, MODEL_URL.split('/').pop(), 'container',
                (err, asset) => err ? reject(err) : resolve(asset));
        })
    ]).then(([glbData, asset]) => {
        const { json, binary } = glbData;

        const res  = asset.resource;
        const root = res.instantiateRenderEntity ? res.instantiateRenderEntity() : res.instantiateModelEntity();
        app.root.addChild(root);
        enableShadows(root);

        const entityMap = buildEntityMap(json, root);
        const result    = initPhysics(json, binary, entityMap, app.systems.rigidbody.dynamicsWorld);
        dynamicBodies      = result.dynamicBodies;
        debugEntities      = result.debugEntities;
        meshStaticEntities = result.meshStaticEntities;

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

            drawPhysicsDebug(app, debugEntities);
            drawMeshStaticDebug(app, meshStaticEntities);

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
