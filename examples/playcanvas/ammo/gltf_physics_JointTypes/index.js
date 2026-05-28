import * as pc from 'playcanvas';
import { CameraControls } from 'camera-controls';

const PC_ROOT = 'https://cx20.github.io/gltf-test/libs/playcanvas/v2.14.2';
const MODEL_URL = 'https://raw.githubusercontent.com/eoineoineoin/glTF_Physics/master/samples/JointTypes/JointTypes.glb';
const RESET_Y_THRESHOLD = -30;

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
            const candidates = byName.get(nodes[ri]?.name ?? '');
            if (candidates?.length) walk(ri, candidates.shift());
        }
    }
    return map;
}

function getCollisionDataFromImplicit(shapeDef, worldScale) {
    const sx = Math.abs(worldScale.x), sy = Math.abs(worldScale.y), sz = Math.abs(worldScale.z);
    if (shapeDef.sphere) return { type: 'sphere', radius: (shapeDef.sphere.radius ?? 0.5) * Math.max(sx, sy, sz) };
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

// --- Constraint helpers ---

// Apply KHR joint limits and drives to a btGeneric6DofSpringConstraint.
// Convention: lower > upper = FREE, lower == upper = LOCKED, lower < upper = LIMITED.
function applyJointLimits(constraint, jointDef) {
    // Default: all axes FREE.
    const linLo = [1, 1, 1], linHi = [-1, -1, -1];
    const angLo = [1, 1, 1], angHi = [-1, -1, -1];

    for (const limit of (jointDef.limits ?? [])) {
        const axes     = limit.linearAxes ?? limit.angularAxes ?? [];
        const isLinear = !!limit.linearAxes;
        const lo = limit.min ?? 0;
        const hi = limit.max ?? 0;
        const lo_arr = isLinear ? linLo : angLo;
        const hi_arr = isLinear ? linHi : angHi;
        for (const axis of axes) {
            if (axis < 0 || axis > 2) continue;
            lo_arr[axis] = lo;
            hi_arr[axis] = hi;
        }
    }

    const llV = new Ammo.btVector3(linLo[0], linLo[1], linLo[2]);
    const luV = new Ammo.btVector3(linHi[0], linHi[1], linHi[2]);
    const alV = new Ammo.btVector3(angLo[0], angLo[1], angLo[2]);
    const auV = new Ammo.btVector3(angHi[0], angHi[1], angHi[2]);
    constraint.setLinearLowerLimit(llV);
    constraint.setLinearUpperLimit(luV);
    constraint.setAngularLowerLimit(alV);
    constraint.setAngularUpperLimit(auV);
    Ammo.destroy(llV); Ammo.destroy(luV); Ammo.destroy(alV); Ammo.destroy(auV);

    // Spring stiffness/damping from limits.
    for (const limit of (jointDef.limits ?? [])) {
        if (limit.stiffness === undefined && limit.damping === undefined) continue;
        const axes     = limit.linearAxes ?? limit.angularAxes ?? [];
        const isLinear = !!limit.linearAxes;
        for (const axis of axes) {
            const dofIdx = isLinear ? axis : 3 + axis;
            if (limit.stiffness !== undefined) {
                constraint.enableSpring(dofIdx, true);
                constraint.setStiffness(dofIdx, limit.stiffness);
            }
            if (limit.damping !== undefined) constraint.setDamping(dofIdx, limit.damping);
        }
    }

    // Drives (velocity motors / spring position motors).
    for (const drive of (jointDef.drives ?? [])) {
        const isAngular = drive.type === 'angular';
        const axisIdx   = drive.axis ?? 0;
        const dofIdx    = isAngular ? 3 + axisIdx : axisIdx;

        const hasVelTarget = drive.velocityTarget !== undefined && drive.velocityTarget !== 0;
        const hasSpring    = drive.stiffness !== undefined && drive.stiffness > 0;
        const hasDamping   = drive.damping   !== undefined && drive.damping   > 0;

        if (hasSpring || (drive.positionTarget !== undefined)) {
            // Spring / position motor via btGeneric6DofSpringConstraint spring DOF.
            constraint.enableSpring(dofIdx, true);
            if (drive.stiffness !== undefined) constraint.setStiffness(dofIdx, drive.stiffness);
            if (drive.damping   !== undefined) constraint.setDamping(dofIdx, drive.damping);
            if (typeof constraint.setEquilibriumPoint === 'function' && drive.positionTarget !== undefined) {
                constraint.setEquilibriumPoint(dofIdx, drive.positionTarget);
            }
        }

        if (hasVelTarget || hasDamping) {
            // Velocity motor via rotational/translational limit motor.
            // Wrapped in try/catch: ammo.js builds expose motor fields inconsistently
            // (some use set_m_X() setters, others expose direct properties).
            // Failure here must not prevent the constraint from being added to the world.
            try {
                if (isAngular) {
                    const motor = constraint.getRotationalLimitMotor(axisIdx);
                    if (motor) {
                        if (typeof motor.set_m_enableMotor === 'function') {
                            motor.set_m_enableMotor(true);
                            motor.set_m_targetVelocity(drive.velocityTarget ?? 0);
                            motor.set_m_maxMotorForce(Math.max(Math.abs(drive.damping ?? 1) * 500, 100));
                        } else {
                            motor.m_enableMotor  = true;
                            motor.m_targetVelocity = drive.velocityTarget ?? 0;
                            motor.m_maxMotorForce  = Math.max(Math.abs(drive.damping ?? 1) * 500, 100);
                        }
                    }
                } else {
                    const motor = constraint.getTranslationalLimitMotor();
                    if (motor) {
                        const vel = drive.velocityTarget ?? 0;
                        if (typeof motor.set_m_enableMotor === 'function') {
                            motor.set_m_enableMotor(axisIdx, true);
                            const tv = new Ammo.btVector3(
                                axisIdx === 0 ? vel : 0,
                                axisIdx === 1 ? vel : 0,
                                axisIdx === 2 ? vel : 0
                            );
                            motor.set_m_targetVelocity(tv); Ammo.destroy(tv);
                            const mf = new Ammo.btVector3(
                                axisIdx === 0 ? 500 : 0,
                                axisIdx === 1 ? 500 : 0,
                                axisIdx === 2 ? 500 : 0
                            );
                            motor.set_m_maxMotorForce(mf); Ammo.destroy(mf);
                        } else if (Array.isArray(motor.m_enableMotor)) {
                            motor.m_enableMotor[axisIdx] = true;
                        }
                    }
                }
            } catch (_e) {
                // Motor setup failed — constraint limits still apply
            }
        }
    }
}

// Create a btTransform representing the joint anchor in body-local space.
// jointWorldPos/Rot: world-space position and orientation of the joint node.
// bodyWorldPos/Rot: world-space position and orientation of the body.
function makeFrameInBody(jointWorldPos, jointWorldRot, bodyWorldPos, bodyWorldRot) {
    const bodyRotInv = new pc.Quat(-bodyWorldRot.x, -bodyWorldRot.y, -bodyWorldRot.z, bodyWorldRot.w);

    // Pivot in body-local space.
    const delta = new pc.Vec3(
        jointWorldPos.x - bodyWorldPos.x,
        jointWorldPos.y - bodyWorldPos.y,
        jointWorldPos.z - bodyWorldPos.z
    );
    const pivotLocal = new pc.Vec3();
    bodyRotInv.transformVector(delta, pivotLocal);

    // Joint orientation in body-local space.
    const rotLocal = new pc.Quat().mul2(bodyRotInv, jointWorldRot);

    const frame = new Ammo.btTransform();
    frame.setIdentity();
    frame.setOrigin(new Ammo.btVector3(pivotLocal.x, pivotLocal.y, pivotLocal.z));
    frame.setRotation(new Ammo.btQuaternion(rotLocal.x, rotLocal.y, rotLocal.z, rotLocal.w));
    return frame;
}

function createConstraint(jointEntity, bodyA, bodyB, jointDef, enableCollision, dynamicsWorld) {
    const btBodyA = bodyA.rigidbody?.body;
    const btBodyB = bodyB.rigidbody?.body;
    if (!btBodyA || !btBodyB) return;

    const jointPos = jointEntity.getPosition();
    const jointRot = jointEntity.getRotation();
    const posA     = bodyA.getPosition(), rotA = bodyA.getRotation();
    const posB     = bodyB.getPosition(), rotB = bodyB.getRotation();

    const frameA = makeFrameInBody(jointPos, jointRot, posA, rotA);
    const frameB = makeFrameInBody(jointPos, jointRot, posB, rotB);

    const constraint = new Ammo.btGeneric6DofSpringConstraint(btBodyA, btBodyB, frameA, frameB, true);
    Ammo.destroy(frameA);
    Ammo.destroy(frameB);

    // Apply limits BEFORE adding to world so Bullet reads the correct state.
    // applyJointLimits wraps motor code in try/catch internally; other errors bubble up
    // to the outer try/catch in initPhysics.
    applyJointLimits(constraint, jointDef);

    // disableCollisionsBetweenLinkedBodies = !enableCollision
    dynamicsWorld.addConstraint(constraint, !enableCollision);
}

// ---

function initPhysics(gltfJson, binary, entityMap, dynamicsWorld) {
    const matDefs      = gltfJson.extensions?.KHR_physics_rigid_bodies?.physicsMaterials ?? [];
    const shapeDefs    = gltfJson.extensions?.KHR_implicit_shapes?.shapes ?? [];
    const physicsJoints = gltfJson.extensions?.KHR_physics_rigid_bodies?.physicsJoints ?? [];
    const nodes        = gltfJson.nodes ?? [];

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
        const e = entityMap[i]; if (!e) continue;
        e.addComponent('collision', { type: 'compound' });
        bodyOwnerNodes.push(i);
    }

    const standaloneStatics = []; // { entity, collider, nodeIdx }

    for (let i = 0; i < nodes.length; i++) {
        const physExt = nodes[i].extensions?.KHR_physics_rigid_bodies;
        if (!physExt?.collider?.geometry) continue;
        const geom     = physExt.collider.geometry;
        const ownerIdx = findBodyOwner(i);

        if (ownerIdx === i) {
            if (geom.shape === undefined) continue;
            const parent   = entityMap[i]; if (!parent) continue;
            const shapeDef = shapeDefs[geom.shape]; if (!shapeDef) continue;
            const child = new pc.Entity('__khrCollider');
            parent.addChild(child);
            const cd = getCollisionDataFromImplicit(shapeDef, parent.getWorldTransform().getScale());
            if (cd) child.addComponent('collision', cd);
        } else if (geom.shape !== undefined) {
            const e = entityMap[i]; if (!e) continue;
            const shapeDef = shapeDefs[geom.shape]; if (!shapeDef) continue;
            const cd = getCollisionDataFromImplicit(shapeDef, e.getWorldTransform().getScale());
            if (!cd) continue;
            e.addComponent('collision', cd);
            if (ownerIdx < 0) standaloneStatics.push({ entity: e, collider: physExt.collider, nodeIdx: i });
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

    // Build bodyNodeSet: all nodes that have a physics body (motion-owners + standalone statics).
    // Used for joint body lookup — includes static bodies that may serve as joint anchors.
    const bodyNodeSet = new Set(bodyOwnerNodes);
    for (const { nodeIdx } of standaloneStatics) bodyNodeSet.add(nodeIdx);

    // Find nearest ancestor node that has a body (start from parent of idx).
    function findAncestorBodyNode(idx) {
        let cur = parentOf[idx];
        while (cur >= 0) { if (bodyNodeSet.has(cur)) return cur; cur = parentOf[cur]; }
        return -1;
    }
    // Resolve body node: check idx itself, then climb ancestors.
    function resolveBodyNode(idx) {
        let cur = idx;
        while (cur >= 0) { if (bodyNodeSet.has(cur)) return cur; cur = parentOf[cur]; }
        return -1;
    }

    // Pass 3: joints — connect bodies using btGeneric6DofSpringConstraint.
    let jointsFound = 0, jointsCreated = 0;
    for (let i = 0; i < nodes.length; i++) {
        const physExt = nodes[i].extensions?.KHR_physics_rigid_bodies;
        if (!physExt?.joint) continue;
        jointsFound++;

        const jointExt  = physExt.joint;
        const jointDef  = physicsJoints[jointExt.joint];
        if (!jointDef) { console.warn('[JointTypes] physicsJoints[' + jointExt.joint + '] missing'); continue; }

        // The joint node's ancestor owns body A.
        const ownerAIdx = findAncestorBodyNode(i);
        if (ownerAIdx < 0) { console.warn('[JointTypes] joint node', i, 'has no ancestor body'); continue; }
        const entityA   = entityMap[ownerAIdx];
        if (!entityA?.rigidbody) { console.warn('[JointTypes] body A entity missing rigidbody'); continue; }

        // The connectedNode (or its ancestor) owns body B.
        const connIdx   = jointExt.connectedNode;
        const ownerBIdx = resolveBodyNode(connIdx);
        if (ownerBIdx < 0) { console.warn('[JointTypes] connectedNode', connIdx, 'has no body'); continue; }
        const entityB   = entityMap[ownerBIdx];
        if (!entityB?.rigidbody) { console.warn('[JointTypes] body B entity missing rigidbody'); continue; }

        const jointEntity = entityMap[i];
        if (!jointEntity) { console.warn('[JointTypes] joint entity', i, 'not in entityMap'); continue; }

        try {
            createConstraint(jointEntity, entityA, entityB, jointDef,
                jointExt.enableCollision === true, dynamicsWorld);
            jointsCreated++;
        } catch (e) {
            console.warn('[JointTypes] createConstraint failed for node', i, ':', e.message);
        }
    }
    if (jointsFound > 0) console.log('[JointTypes] joints:', jointsCreated + '/' + jointsFound + ' created');

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
        debugEntities
    };
}

// --- Debug wireframe ---

const _DBG_COLOR_DYNAMIC = new pc.Color(0, 1, 0, 1);
const _DBG_COLOR_STATIC  = new pc.Color(1, 1, 0, 1);

function _ringPoints(axis, radius, segs, out, mat) {
    const tmp = new pc.Vec3(); let prev = null;
    for (let i = 0; i <= segs; i++) {
        const t=(i/segs)*Math.PI*2, c=Math.cos(t)*radius, s=Math.sin(t)*radius;
        if(axis===0)tmp.set(0,c,s);else if(axis===1)tmp.set(c,0,s);else tmp.set(c,s,0);
        const cur=new pc.Vec3(); mat.transformPoint(tmp,cur);
        if(prev){out.push(prev);out.push(cur);} prev=cur;
    }
}
function _getPosRotMat(e) { return new pc.Mat4().setTRS(e.getPosition(), e.getRotation(), pc.Vec3.ONE); }
function _drawWireSphereLocal(app, mat, r, color) {
    const pts=[]; _ringPoints(0,r,16,pts,mat); _ringPoints(1,r,16,pts,mat); _ringPoints(2,r,16,pts,mat);
    app.drawLines(pts,pts.map(()=>color),false);
}
function _drawWireBoxLocal(app, mat, hx, hy, hz, color) {
    app.drawWireAlignedBox(new pc.Vec3(-hx,-hy,-hz),new pc.Vec3(hx,hy,hz),color,false,undefined,mat);
}
function _drawWireCylinderLocal(app, mat, radius, halfH, axis, color) {
    const pts=[],segs=16,oA=new pc.Vec3(),oB=new pc.Vec3();
    if(axis===0){oA.set(-halfH,0,0);oB.set(halfH,0,0);}
    else if(axis===1){oA.set(0,-halfH,0);oB.set(0,halfH,0);}
    else{oA.set(0,0,-halfH);oB.set(0,0,halfH);}
    const tmp=new pc.Vec3(),rings=[];
    for(const off of [oA,oB]){
        const ring=[];
        for(let i=0;i<=segs;i++){
            const t=(i/segs)*Math.PI*2,c=Math.cos(t)*radius,s=Math.sin(t)*radius;
            if(axis===0)tmp.set(off.x,c,s);else if(axis===1)tmp.set(c,off.y,s);else tmp.set(c,s,off.z);
            const v=new pc.Vec3();mat.transformPoint(tmp,v);ring.push(v);
        }
        rings.push(ring);
        for(let i=0;i<segs;i++){pts.push(ring[i]);pts.push(ring[i+1]);}
    }
    const step=Math.floor(segs/4);
    for(let k=0;k<4;k++){pts.push(rings[0][k*step]);pts.push(rings[1][k*step]);}
    app.drawLines(pts,pts.map(()=>color),false);
}
function _drawWireCapsuleLocal(app, mat, r, cylHalf, axis, color) {
    _drawWireCylinderLocal(app, mat, r, cylHalf, axis, color);
    const off=new pc.Vec3();
    for(const sign of[-1,1]){
        if(axis===0)off.set(sign*cylHalf,0,0);else if(axis===1)off.set(0,sign*cylHalf,0);else off.set(0,0,sign*cylHalf);
        _drawWireSphereLocal(app, new pc.Mat4().mul2(mat, new pc.Mat4().setTranslate(off.x,off.y,off.z)), r, color);
    }
}

function drawPhysicsDebug(app, entities) {
    for (const entity of entities) {
        const col = entity.collision; if (!col?.type) continue;
        let rb = entity; while(rb && !rb.rigidbody) rb = rb.parent;
        const color = rb?.rigidbody?.type === pc.BODYTYPE_DYNAMIC ? _DBG_COLOR_DYNAMIC : _DBG_COLOR_STATIC;
        const mat = _getPosRotMat(entity);
        switch(col.type) {
            case 'box':      _drawWireBoxLocal(app,mat,col.halfExtents.x,col.halfExtents.y,col.halfExtents.z,color); break;
            case 'sphere':   _drawWireSphereLocal(app,mat,col.radius,color); break;
            case 'capsule':  _drawWireCapsuleLocal(app,mat,col.radius,Math.max(0,(col.height-2*col.radius)*0.5),col.axis??1,color); break;
            case 'cylinder': _drawWireCylinderLocal(app,mat,col.radius,col.height*0.5,col.axis??1,color); break;
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
    if (!dynamicBodies.length) return { center: new pc.Vec3(0, 2, 0), radius: 15 };
    let minX=Infinity,minY=Infinity,minZ=Infinity,maxX=-Infinity,maxY=-Infinity,maxZ=-Infinity;
    for (const b of dynamicBodies) {
        const p = b.initialPosition;
        minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);
        minY=Math.min(minY,p.y);maxY=Math.max(maxY,p.y);
        minZ=Math.min(minZ,p.z);maxZ=Math.max(maxZ,p.z);
    }
    const center = new pc.Vec3((minX+maxX)*0.5,(minY+maxY)*0.5,(minZ+maxZ)*0.5);
    const d = Math.sqrt((maxX-minX)**2+(maxY-minY)**2+(maxZ-minZ)**2);
    return { center, radius: Math.max(d+10, 15) };
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
    camera.setPosition(0, 2, 20);
    app.root.addChild(camera);
    const controls = camera.script.create(CameraControls, { properties: { enableFly: false } });

    let dynamicBodies = [];
    let debugEntities = [];

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
        dynamicBodies = result.dynamicBodies;
        debugEntities = result.debugEntities;

        const { center, radius } = computeBodyBounds(dynamicBodies);
        const startPos = new pc.Vec3(center.x, center.y + 2, center.z + radius);
        controls.reset(center, startPos);

        app.on('update', () => {
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
