import Rn from 'rhodonite';

// Rhodonite (rendering) + Rapier (physics, raw world/rigid-body API). Loads a glTF that uses the
// KHR_physics_rigid_bodies / KHR_implicit_shapes extensions and applies its motion properties
// (initial velocities, gravity factor, locked inertia axes). Mirrors the Rhodonite + Havok
// Motion Properties sample, with the physics engine swapped to Rapier.

const MODEL_URL = 'https://raw.githubusercontent.com/eoineoineoin/glTF_Physics/master/samples/MotionProperties/MotionProperties.glb';
const FIXED_TIMESTEP = 1 / 60;
const RESET_Y_THRESHOLD = -20;
const RESET_Y_THRESHOLD_TOP = 50;

let RAPIER, world, engine;
let showWireframe = true;

const physicsNodes = [];   // { entity, body, isDynamic, initialPosition, initialRotation, ... }
const dynamicNodes = [];
const debugEntities = [];  // wireframe collider indicators

// Fetch the GLB and return both the JSON (for the physics extensions) and the BIN chunk
// (so we can read mesh vertex data for convex / mesh / compound colliders).
async function fetchGlb(url) {
  const response = await fetch(url);
  const data = await response.arrayBuffer();
  const header = new Uint32Array(data, 0, 3);
  if (header[0] !== 0x46546c67) {
    throw new Error('Invalid GLB header.');
  }
  let offset = 12;
  const decoder = new TextDecoder();
  let json = null;
  let bin = null;
  while (offset < data.byteLength) {
    const view = new DataView(data, offset, 8);
    const chunkLength = view.getUint32(0, true);
    const chunkType = view.getUint32(4, true);
    if (chunkType === 0x4e4f534a) {
      json = JSON.parse(decoder.decode(data.slice(offset + 8, offset + 8 + chunkLength)).replace(/\0+$/, ''));
    } else if (chunkType === 0x004e4942) {
      bin = new Uint8Array(data.slice(offset + 8, offset + 8 + chunkLength));
    }
    offset += 8 + chunkLength;
  }
  if (!json) throw new Error('GLB JSON chunk is missing.');
  return { json, bin };
}

const GLTF_COMPONENT_TYPE = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const GLTF_COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

// Read a glTF accessor (POSITION / indices) from the BIN chunk as a flat array.
function getAccessorData(json, bin, accessorIndex) {
  const accessor = json.accessors[accessorIndex];
  const bufferView = json.bufferViews[accessor.bufferView];
  const TypedArray = GLTF_COMPONENT_TYPE[accessor.componentType];
  const components = GLTF_COMPONENTS[accessor.type];
  const count = accessor.count;
  const byteOffset = (bufferView.byteOffset || 0) + (accessor.byteOffset || 0);
  const byteStride = bufferView.byteStride || 0;
  const packedStride = TypedArray.BYTES_PER_ELEMENT * components;
  if (byteStride && byteStride !== packedStride) {
    const out = new TypedArray(count * components);
    const dataView = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
    for (let i = 0; i < count; i++) {
      const src = byteOffset + i * byteStride;
      for (let c = 0; c < components; c++) {
        const at = src + c * TypedArray.BYTES_PER_ELEMENT;
        const dst = i * components + c;
        if (accessor.componentType === 5126) out[dst] = dataView.getFloat32(at, true);
        else if (accessor.componentType === 5125) out[dst] = dataView.getUint32(at, true);
        else if (accessor.componentType === 5123) out[dst] = dataView.getUint16(at, true);
        else if (accessor.componentType === 5122) out[dst] = dataView.getInt16(at, true);
        else if (accessor.componentType === 5121) out[dst] = dataView.getUint8(at);
        else out[dst] = dataView.getInt8(at);
      }
    }
    return out;
  }
  return new TypedArray(bin.buffer, bin.byteOffset + byteOffset, count * components);
}

// Merge a mesh's primitives into flat positions[] and indices[] (object space).
function getMeshGeometry(json, bin, meshIndex) {
  const meshDef = json.meshes[meshIndex];
  if (!meshDef) return null;
  const positions = [];
  const indices = [];
  let vertexOffset = 0;
  for (const primitive of meshDef.primitives) {
    if (primitive.attributes.POSITION === undefined) continue;
    const pos = getAccessorData(json, bin, primitive.attributes.POSITION);
    for (let i = 0; i < pos.length; i++) positions.push(pos[i]);
    if (primitive.indices !== undefined) {
      const idx = getAccessorData(json, bin, primitive.indices);
      for (let i = 0; i < idx.length; i++) indices.push(idx[i] + vertexOffset);
    } else {
      const vCount = pos.length / 3;
      for (let i = 0; i + 2 < vCount; i += 3) indices.push(vertexOffset + i, vertexOffset + i + 1, vertexOffset + i + 2);
    }
    vertexOffset += pos.length / 3;
  }
  return { positions, indices };
}

// --- Minimal 4x4 matrix helpers (column-major) for compound child world transforms ---
function mat4FromTRS(t, r, s) {
  const [x, y, z, w] = r;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  const sx = s[0], sy = s[1], sz = s[2];
  return [
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    t[0], t[1], t[2], 1,
  ];
}
function mat4Multiply(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      o[c * 4 + r] = a[0 * 4 + r] * b[c * 4 + 0] + a[1 * 4 + r] * b[c * 4 + 1] + a[2 * 4 + r] * b[c * 4 + 2] + a[3 * 4 + r] * b[c * 4 + 3];
    }
  }
  return o;
}
function mat4Invert(m) {
  const inv = new Array(16);
  inv[0] = m[5]*m[10]*m[15]-m[5]*m[11]*m[14]-m[9]*m[6]*m[15]+m[9]*m[7]*m[14]+m[13]*m[6]*m[11]-m[13]*m[7]*m[10];
  inv[4] = -m[4]*m[10]*m[15]+m[4]*m[11]*m[14]+m[8]*m[6]*m[15]-m[8]*m[7]*m[14]-m[12]*m[6]*m[11]+m[12]*m[7]*m[10];
  inv[8] = m[4]*m[9]*m[15]-m[4]*m[11]*m[13]-m[8]*m[5]*m[15]+m[8]*m[7]*m[13]+m[12]*m[5]*m[11]-m[12]*m[7]*m[9];
  inv[12] = -m[4]*m[9]*m[14]+m[4]*m[10]*m[13]+m[8]*m[5]*m[14]-m[8]*m[6]*m[13]-m[12]*m[5]*m[10]+m[12]*m[6]*m[9];
  inv[1] = -m[1]*m[10]*m[15]+m[1]*m[11]*m[14]+m[9]*m[2]*m[15]-m[9]*m[3]*m[14]-m[13]*m[2]*m[11]+m[13]*m[3]*m[10];
  inv[5] = m[0]*m[10]*m[15]-m[0]*m[11]*m[14]-m[8]*m[2]*m[15]+m[8]*m[3]*m[14]+m[12]*m[2]*m[11]-m[12]*m[3]*m[10];
  inv[9] = -m[0]*m[9]*m[15]+m[0]*m[11]*m[13]+m[8]*m[1]*m[15]-m[8]*m[3]*m[13]-m[12]*m[1]*m[11]+m[12]*m[3]*m[9];
  inv[13] = m[0]*m[9]*m[14]-m[0]*m[10]*m[13]-m[8]*m[1]*m[14]+m[8]*m[2]*m[13]+m[12]*m[1]*m[10]-m[12]*m[2]*m[9];
  inv[2] = m[1]*m[6]*m[15]-m[1]*m[7]*m[14]-m[5]*m[2]*m[15]+m[5]*m[3]*m[14]+m[13]*m[2]*m[7]-m[13]*m[3]*m[6];
  inv[6] = -m[0]*m[6]*m[15]+m[0]*m[7]*m[14]+m[4]*m[2]*m[15]-m[4]*m[3]*m[14]-m[12]*m[2]*m[7]+m[12]*m[3]*m[6];
  inv[10] = m[0]*m[5]*m[15]-m[0]*m[7]*m[13]-m[4]*m[1]*m[15]+m[4]*m[3]*m[13]+m[12]*m[1]*m[7]-m[12]*m[3]*m[5];
  inv[14] = -m[0]*m[5]*m[14]+m[0]*m[6]*m[13]+m[4]*m[1]*m[14]-m[4]*m[2]*m[13]-m[12]*m[1]*m[6]+m[12]*m[2]*m[5];
  inv[3] = -m[1]*m[6]*m[11]+m[1]*m[7]*m[10]+m[5]*m[2]*m[11]-m[5]*m[3]*m[10]-m[9]*m[2]*m[7]+m[9]*m[3]*m[6];
  inv[7] = m[0]*m[6]*m[11]-m[0]*m[7]*m[10]-m[4]*m[2]*m[11]+m[4]*m[3]*m[10]+m[8]*m[2]*m[7]-m[8]*m[3]*m[6];
  inv[11] = -m[0]*m[5]*m[11]+m[0]*m[7]*m[9]+m[4]*m[1]*m[11]-m[4]*m[3]*m[9]-m[8]*m[1]*m[7]+m[8]*m[3]*m[5];
  inv[15] = m[0]*m[5]*m[10]-m[0]*m[6]*m[9]-m[4]*m[1]*m[10]+m[4]*m[2]*m[9]+m[8]*m[1]*m[6]-m[8]*m[2]*m[5];
  let det = m[0]*inv[0]+m[1]*inv[4]+m[2]*inv[8]+m[3]*inv[12];
  if (det === 0) return null;
  det = 1.0 / det;
  for (let i = 0; i < 16; i++) inv[i] *= det;
  return inv;
}
// Decompose a matrix into translation, rotation quaternion, scale.
function mat4Decompose(m) {
  const t = [m[12], m[13], m[14]];
  let sx = Math.hypot(m[0], m[1], m[2]);
  const sy = Math.hypot(m[4], m[5], m[6]);
  const sz = Math.hypot(m[8], m[9], m[10]);
  const det = m[0]*(m[5]*m[10]-m[6]*m[9]) - m[4]*(m[1]*m[10]-m[2]*m[9]) + m[8]*(m[1]*m[6]-m[2]*m[5]);
  if (det < 0) sx = -sx;
  const r00 = m[0]/sx, r01 = m[4]/sy, r02 = m[8]/sz;
  const r10 = m[1]/sx, r11 = m[5]/sy, r12 = m[9]/sz;
  const r20 = m[2]/sx, r21 = m[6]/sy, r22 = m[10]/sz;
  const tr = r00 + r11 + r22;
  let qx, qy, qz, qw;
  if (tr > 0) { const S = Math.sqrt(tr + 1) * 2; qw = 0.25*S; qx = (r21-r12)/S; qy = (r02-r20)/S; qz = (r10-r01)/S; }
  else if (r00 > r11 && r00 > r22) { const S = Math.sqrt(1+r00-r11-r22)*2; qw = (r21-r12)/S; qx = 0.25*S; qy = (r01+r10)/S; qz = (r02+r20)/S; }
  else if (r11 > r22) { const S = Math.sqrt(1+r11-r00-r22)*2; qw = (r02-r20)/S; qx = (r01+r10)/S; qy = 0.25*S; qz = (r12+r21)/S; }
  else { const S = Math.sqrt(1+r22-r00-r11)*2; qw = (r10-r01)/S; qx = (r02+r20)/S; qy = (r12+r21)/S; qz = 0.25*S; }
  return { t, r: [qx, qy, qz, qw], s: [sx, sy, sz] };
}
// World matrix per node (compose parent * local over the scene hierarchy).
function computeWorldMatrices(json) {
  const world = new Map();
  const localOf = (nd) => mat4FromTRS(nd.translation || [0, 0, 0], nd.rotation || [0, 0, 0, 1], nd.scale || [1, 1, 1]);
  const visit = (nodeIndex, parentMatrix) => {
    const nd = json.nodes[nodeIndex];
    const m = mat4Multiply(parentMatrix, localOf(nd));
    world.set(nodeIndex, m);
    for (const c of (nd.children || [])) visit(c, m);
  };
  const scene = json.scenes[json.scene || 0];
  for (const ni of (scene.nodes || [])) visit(ni, mat4FromTRS([0, 0, 0], [0, 0, 0, 1], [1, 1, 1]));
  return world;
}

// Quaternion multiply (a then b, both [x,y,z,w]) and rotate a vec3 by a quaternion.
function quatMul(a, b) {
  return [
    a[3]*b[0] + a[0]*b[3] + a[1]*b[2] - a[2]*b[1],
    a[3]*b[1] - a[0]*b[2] + a[1]*b[3] + a[2]*b[0],
    a[3]*b[2] + a[0]*b[1] - a[1]*b[0] + a[2]*b[3],
    a[3]*b[3] - a[0]*b[0] - a[1]*b[1] - a[2]*b[2],
  ];
}
function applyQuat(v, q) {
  const [x, y, z, w] = q;
  const [vx, vy, vz] = v;
  const tx = 2 * (y * vz - z * vy);
  const ty = 2 * (z * vx - x * vz);
  const tz = 2 * (x * vy - y * vx);
  return [vx + w * tx + y * tz - z * ty, vy + w * ty + z * tx - x * tz, vz + w * tz + x * ty - y * tx];
}

function normalize(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
// Quaternion [x,y,z,w] orienting a camera at `eye` to look at `target` (camera looks down -Z, up = +Y).
function lookAtQuaternion(eye, target, up) {
  const fz = normalize([eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]]);
  let fx = normalize(cross(up, fz));
  if (!isFinite(fx[0])) fx = [1, 0, 0];
  const fy = cross(fz, fx);
  const m00 = fx[0], m10 = fx[1], m20 = fx[2];
  const m01 = fy[0], m11 = fy[1], m21 = fy[2];
  const m02 = fz[0], m12 = fz[1], m22 = fz[2];
  const tr = m00 + m11 + m22;
  let x, y, z, w;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1.0) * 2; w = 0.25 * s; x = (m21 - m12) / s; y = (m02 - m20) / s; z = (m10 - m01) / s;
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1.0 + m00 - m11 - m22) * 2; w = (m21 - m12) / s; x = 0.25 * s; y = (m01 + m10) / s; z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = Math.sqrt(1.0 + m11 - m00 - m22) * 2; w = (m02 - m20) / s; x = (m01 + m10) / s; y = 0.25 * s; z = (m12 + m21) / s;
  } else {
    const s = Math.sqrt(1.0 + m22 - m00 - m11) * 2; w = (m10 - m01) / s; x = (m02 + m20) / s; y = (m12 + m21) / s; z = 0.25 * s;
  }
  return [x, y, z, w];
}

function initPhysics() {
  world = new RAPIER.World({ x: 0, y: -9.8, z: 0 });
  world.timestep = FIXED_TIMESTEP;
}

// Build a Rapier collider descriptor for a KHR_implicit_shapes definition, plus { size, shapeType }.
function createImplicitShape(shapeDef, scale) {
  const sx = Math.abs(scale[0]);
  const sy = Math.abs(scale[1]);
  const sz = Math.abs(scale[2]);

  if (shapeDef.type === 'box' && shapeDef.box) {
    const s = shapeDef.box.size || [1, 1, 1];
    const size = [Math.abs(s[0] * sx), Math.abs(s[1] * sy), Math.abs(s[2] * sz)];
    const colliderDesc = RAPIER.ColliderDesc.cuboid(
      Math.max(size[0] * 0.5, 0.0001), Math.max(size[1] * 0.5, 0.0001), Math.max(size[2] * 0.5, 0.0001)
    );
    return { colliderDesc, size, shapeType: 'box' };
  }

  if (shapeDef.type === 'sphere' && shapeDef.sphere) {
    const baseR = shapeDef.sphere.radius !== undefined ? shapeDef.sphere.radius : 0.5;
    const r = Math.max(Math.abs(baseR * Math.max(sx, sy, sz)), 0.0001);
    return { colliderDesc: RAPIER.ColliderDesc.ball(r), size: [r * 2, r * 2, r * 2], shapeType: 'sphere' };
  }

  if (shapeDef.type === 'capsule' && shapeDef.capsule) {
    const cd = shapeDef.capsule;
    const rTop = cd.radiusTop !== undefined ? cd.radiusTop : 0.5;
    const rBot = cd.radiusBottom !== undefined ? cd.radiusBottom : 0.5;
    const h = cd.height !== undefined ? cd.height : 1.0;
    const r = Math.max(((rTop + rBot) * 0.5) * Math.max(sx, sz), 0.0001);
    const shaftH = Math.max(h * sy * 0.5, 0);
    return { colliderDesc: RAPIER.ColliderDesc.capsule(shaftH, r), size: [r * 2, shaftH * 2 + r * 2, r * 2], shapeType: 'capsule' };
  }

  if (shapeDef.type === 'cylinder' && shapeDef.cylinder) {
    const cd = shapeDef.cylinder;
    const rTop = cd.radiusTop !== undefined ? cd.radiusTop : 0.5;
    const rBot = cd.radiusBottom !== undefined ? cd.radiusBottom : 0.5;
    const h = cd.height !== undefined ? cd.height : 1.0;
    const r = Math.max(Math.max(rTop, rBot) * Math.max(sx, sz), 0.0001);
    const hh = Math.max(h * sy * 0.5, 0.0001);
    return { colliderDesc: RAPIER.ColliderDesc.cylinder(hh, r), size: [r * 2, hh * 2, r * 2], shapeType: 'cylinder' };
  }

  return null;
}

function createBoxShape(size) {
  const safe = [Math.max(size[0], 0.05), Math.max(size[1], 0.05), Math.max(size[2], 0.05)];
  const colliderDesc = RAPIER.ColliderDesc.cuboid(safe[0] * 0.5, safe[1] * 0.5, safe[2] * 0.5);
  return { colliderDesc, size: safe, shapeType: 'box' };
}

// Convex hull / triangle mesh collider from glTF mesh geometry (dynamic -> convex, static -> mesh).
function createMeshShape(geometry, scale, isConvex, isDynamic) {
  if (!geometry || geometry.positions.length === 0) return null;
  const sx = scale[0], sy = scale[1], sz = scale[2];
  const positions = new Float32Array(geometry.positions.length);
  for (let i = 0; i < geometry.positions.length; i += 3) {
    positions[i] = geometry.positions[i] * sx;
    positions[i + 1] = geometry.positions[i + 1] * sy;
    positions[i + 2] = geometry.positions[i + 2] * sz;
  }

  let colliderDesc = null;
  if (isConvex || isDynamic) {
    colliderDesc = RAPIER.ColliderDesc.convexHull(positions);
  } else {
    colliderDesc = RAPIER.ColliderDesc.trimesh(positions, new Uint32Array(geometry.indices));
  }
  if (!colliderDesc) return null;

  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    minX = Math.min(minX, positions[i]); maxX = Math.max(maxX, positions[i]);
    minY = Math.min(minY, positions[i + 1]); maxY = Math.max(maxY, positions[i + 1]);
    minZ = Math.min(minZ, positions[i + 2]); maxZ = Math.max(maxZ, positions[i + 2]);
  }
  const size = [maxX - minX, maxY - minY, maxZ - minZ];
  return { colliderDesc, size, shapeType: 'mesh', positions, scaledIndices: geometry.indices };
}

// Configure a RigidBodyDesc from a KHR_physics_rigid_bodies motion: initial velocities, gravity
// factor, and inertia-diagonal zeros -> locked rotation axes (mirrors the three.js + Rapier sample).
function applyMotionToBodyDesc(bodyDesc, motion, worldRotation) {
  if (motion.gravityFactor !== undefined) bodyDesc.setGravityScale(motion.gravityFactor);
  if (Array.isArray(motion.linearVelocity)) {
    const lv = motion.linearVelocity;
    bodyDesc.setLinvel(lv[0], lv[1], lv[2]);
  }
  if (Array.isArray(motion.angularVelocity)) {
    const av = motion.angularVelocity;
    bodyDesc.setAngvel({ x: av[0], y: av[1], z: av[2] });
  }
  if (motion.mass === 0) {
    bodyDesc.lockTranslations();
  }
  if (Array.isArray(motion.inertiaDiagonal)) {
    const [ix, iy, iz] = motion.inertiaDiagonal;
    if (ix === 0 || iy === 0 || iz === 0) {
      let bodyQuat = worldRotation.slice();
      if (Array.isArray(motion.inertiaOrientation)) {
        bodyQuat = quatMul(bodyQuat, motion.inertiaOrientation);
      }
      const diag = [ix, iy, iz];
      const localAxes = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
      let allowX = false, allowY = false, allowZ = false;
      for (let j = 0; j < 3; j++) {
        if (diag[j] !== 0) {
          const v = applyQuat(localAxes[j], bodyQuat);
          const ax = Math.abs(v[0]), ay = Math.abs(v[1]), az = Math.abs(v[2]);
          if (ax >= ay && ax >= az) allowX = true;
          else if (ay >= ax && ay >= az) allowY = true;
          else allowZ = true;
        }
      }
      bodyDesc.enabledRotations(allowX, allowY, allowZ);
    }
  }
}

// motion present => dynamic/kinematic body with the glTF motion applied; motion null => static.
function createBody(colliderDesc, position, rotation, motion) {
  let bodyDesc;
  if (!motion) bodyDesc = RAPIER.RigidBodyDesc.fixed();
  else if (motion.isKinematic) bodyDesc = RAPIER.RigidBodyDesc.kinematicVelocityBased();
  else bodyDesc = RAPIER.RigidBodyDesc.dynamic();
  bodyDesc.setTranslation(position[0], position[1], position[2]);
  bodyDesc.setRotation({ x: rotation[0], y: rotation[1], z: rotation[2], w: rotation[3] });
  if (motion) applyMotionToBodyDesc(bodyDesc, motion, rotation);
  const body = world.createRigidBody(bodyDesc);
  world.createCollider(colliderDesc, body);
  return body;
}

// Read the world-space AABB { size, center } of an entity (including its descendants).
function getEntityAABB(entity) {
  try {
    const sg = entity.getSceneGraph();
    let aabb = sg.worldMergedAABB;
    if (!aabb && typeof sg.getWorldAABB === 'function') aabb = sg.getWorldAABB();
    if (!aabb) return null;
    const minP = typeof aabb.minPoint === 'function' ? aabb.minPoint() : aabb.minPoint;
    const maxP = typeof aabb.maxPoint === 'function' ? aabb.maxPoint() : aabb.maxPoint;
    if (!minP || !maxP) return null;
    const size = [maxP.x - minP.x, maxP.y - minP.y, maxP.z - minP.z];
    const center = [(minP.x + maxP.x) * 0.5, (minP.y + maxP.y) * 0.5, (minP.z + maxP.z) * 0.5];
    if (!isFinite(size[0]) || !isFinite(size[1]) || !isFinite(size[2])) return null;
    return { size, center };
  } catch (e) {
    return null;
  }
}

// Merge the world-space AABBs of all model entities to frame the camera on the whole scene.
function getSceneAABB(entities) {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const entity of entities) {
    const aabb = getEntityAABB(entity);
    if (!aabb) continue;
    const [sx, sy, sz] = aabb.size;
    const [cx, cy, cz] = aabb.center;
    minX = Math.min(minX, cx - sx / 2); maxX = Math.max(maxX, cx + sx / 2);
    minY = Math.min(minY, cy - sy / 2); maxY = Math.max(maxY, cy + sy / 2);
    minZ = Math.min(minZ, cz - sz / 2); maxZ = Math.max(maxZ, cz + sz / 2);
  }
  if (!isFinite(minX)) return null;
  return {
    center: [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2],
    size: [maxX - minX, maxY - minY, maxZ - minZ],
  };
}

// Draw the collider wireframe slightly larger than the visual mesh so it encloses it.
const DEBUG_SCALE = 1.0;
const DEBUG_COLOR_DYNAMIC = [1.0, 0.5, 0.2, 1.0];
const DEBUG_COLOR_STATIC = [0.2, 1.0, 0.4, 1.0];

// Mirror Rhodonite's VRM spring-bone collider gizmo: PbrUber + RN_USE_WIREFRAME, and
// calcBaryCentricCoord() on the mesh so the wireframe shader can draw the edges.
function makeDebugMaterial(color) {
  const mat = Rn.MaterialHelper.createPbrUberMaterial(engine, { isLighting: false, isSkinning: false, isMorphing: false });
  try { mat.addShaderDefine('RN_USE_WIREFRAME'); } catch (e) {}
  try { mat.setParameter('wireframe', Rn.Vector3.fromCopy3(1, 0, 1)); } catch (e) {}
  try { mat.setParameter('baseColorFactor', Rn.Vector4.fromCopyArray4(color)); } catch (e) {}
  return mat;
}

function makeDebugBox(size, mat) {
  const entity = Rn.MeshHelper.createCube(engine, { material: mat });
  entity.getTransform().localScale = Rn.Vector3.fromCopyArray([
    Math.max(size[0], 0.02) * DEBUG_SCALE,
    Math.max(size[1], 0.02) * DEBUG_SCALE,
    Math.max(size[2], 0.02) * DEBUG_SCALE
  ]);
  return entity;
}

// Build a wireframe entity from raw triangle geometry (convex / mesh / compound-child colliders).
function makeWireframeMesh(positions, indices, mat) {
  const primitive = Rn.Primitive.createPrimitive(engine, {
    attributes: [positions instanceof Float32Array ? positions : new Float32Array(positions)],
    attributeSemantics: [Rn.VertexAttribute.Position.XYZ],
    indices: indices instanceof Uint32Array ? indices : new Uint32Array(indices),
    primitiveMode: Rn.PrimitiveMode.Triangles,
    material: mat,
  });
  const entity = Rn.MeshHelper.createShape(engine, primitive);
  entity.getTransform().localScale = Rn.Vector3.fromCopyArray([DEBUG_SCALE, DEBUG_SCALE, DEBUG_SCALE]);
  return entity;
}

function createDebugEntity(shapeResult, color) {
  const mat = makeDebugMaterial(color);
  const type = shapeResult.shapeType;
  let entity;
  if (type === 'mesh' && shapeResult.positions && shapeResult.scaledIndices) {
    try {
      entity = makeWireframeMesh(shapeResult.positions, shapeResult.scaledIndices, mat);
    } catch (e) {
      console.warn('[MotionProperties] mesh wireframe failed, using box:', e);
      entity = makeDebugBox(shapeResult.size, mat);
    }
  } else if (type === 'sphere') {
    const r = Math.max(shapeResult.size[0] * 0.5, 0.01) * DEBUG_SCALE;
    entity = Rn.MeshHelper.createSphere(engine, { radius: r, widthSegments: 16, heightSegments: 12, material: mat });
  } else if (type === 'capsule' || type === 'cylinder') {
    const r = Math.max(shapeResult.size[0] * 0.5, 0.01);
    const h = Math.max(shapeResult.size[1] - shapeResult.size[0], 0.01);
    try {
      entity = Rn.MeshHelper.createCapsule(engine, { radius: r, height: h, widthSegments: 16, heightSegments: 8, material: mat });
      entity.getTransform().localScale = Rn.Vector3.fromCopyArray([DEBUG_SCALE, DEBUG_SCALE, DEBUG_SCALE]);
    } catch (e) {
      entity = makeDebugBox(shapeResult.size, mat);
    }
  } else {
    entity = makeDebugBox(shapeResult.size, mat);
  }
  try { entity.getMesh().calcBaryCentricCoord(); } catch (e) { console.warn('[MotionProperties] calcBaryCentricCoord failed:', e); }
  debugEntities.push(entity);
  return entity;
}

const load = async function () {
  // Rhodonite v0.19.9 added a Rapier physics backend. This sample drives Rapier directly
  // (raw world / rigid-body API), mirroring how the Havok version used the Havok low-level API.
  RAPIER = (await import('https://cdn.skypack.dev/@dimforge/rapier3d-compat@0.17.3')).default;
  await RAPIER.init();

  const canvas = document.getElementById('world');
  engine = await Rn.Engine.init({ approach: Rn.ProcessApproach.DataTexture, canvas });

  function resizeCanvas() {
    engine.resizeCanvas(window.innerWidth, window.innerHeight);
  }
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  initPhysics();

  // Camera: a slow orbit (no roll) framed on the scene; the bounds are filled in once the
  // model has loaded and rendered one frame.
  const cameraEntity = Rn.createCameraEntity(engine);
  const cameraComponent = cameraEntity.getCamera();
  cameraComponent.zNear = 0.1;
  cameraComponent.zFar = 1000;
  cameraComponent.setFovyAndChangeFocalLength(45);
  cameraComponent.aspect = window.innerWidth / window.innerHeight;

  let orbitCenter = [0, 2, 0];
  let orbitRadiusH = 16;
  let orbitHeight = 8;
  let orbitAngle = 0;
  function applyCamera() {
    const eye = [
      orbitCenter[0] + Math.sin(orbitAngle) * orbitRadiusH,
      orbitHeight,
      orbitCenter[2] + Math.cos(orbitAngle) * orbitRadiusH,
    ];
    cameraEntity.localPosition = Rn.Vector3.fromCopyArray(eye);
    cameraEntity.localRotation = Rn.Quaternion.fromCopyArray(lookAtQuaternion(eye, orbitCenter, [0, 1, 0]));
  }
  applyCamera();

  // Light
  const lightEntity = Rn.createLightEntity(engine);
  const lightComponent = lightEntity.getLight();
  lightComponent.type = Rn.LightType.Directional;
  lightComponent.intensity = 2;
  lightEntity.localEulerAngles = Rn.Vector3.fromCopyArray([-Math.PI / 4, -Math.PI / 4, 0]);

  // Load the glTF model (rendered as-is by Rhodonite).
  const [glb, gltfExpression] = await Promise.all([
    fetchGlb(MODEL_URL),
    Rn.GltfImporter.importFromUrl(engine, MODEL_URL, {
      defaultMaterialHelperArgumentArray: [{ makeOutputSrgb: false }],
    }),
  ]);
  const gltfJson = glb.json;
  const glbBin = glb.bin;

  // Model first (clears color + depth).
  const modelRenderPass = gltfExpression.renderPasses[0];
  modelRenderPass.cameraComponent = cameraComponent;
  modelRenderPass.toClearColorBuffer = true;
  modelRenderPass.clearColor = Rn.Vector4.fromCopyArray4([0.96, 0.97, 0.99, 1]);

  // Debug collider wireframes are drawn in a second pass on top of the model
  // (no depth test) so the whole collider shape is visible, not just its silhouette.
  const debugRenderPass = new Rn.RenderPass(engine);
  debugRenderPass.cameraComponent = cameraComponent;
  debugRenderPass.toClearColorBuffer = false;
  try { debugRenderPass.isDepthTest = false; } catch (e) {}

  const expression = new Rn.Expression();
  expression.addRenderPasses([modelRenderPass, debugRenderPass]);

  // Map glTF nodes -> Rhodonite entities both by node index and by unique name
  // (climbing parents so group nodes are covered too; also register the suffix-stripped name).
  const nodeIndexToEntity = new Map();
  const nameToEntity = new Map();
  for (const entity of modelRenderPass.entities) {
    let cur = entity;
    while (cur) {
      const idx = cur.gltfNodeIndex;
      if (idx !== undefined && idx !== null && !nodeIndexToEntity.has(idx)) {
        nodeIndexToEntity.set(idx, cur);
      }
      const nm = cur.uniqueName;
      if (nm && !nameToEntity.has(nm)) {
        nameToEntity.set(nm, cur);
        const stripped = nm.replace(/_\(\d+\)$/, '');
        if (stripped && !nameToEntity.has(stripped)) nameToEntity.set(stripped, cur);
      }
      let parentSg = null;
      try {
        const sg = cur.getSceneGraph && cur.getSceneGraph();
        parentSg = sg ? sg.parent : null;
      } catch (e) { parentSg = null; }
      cur = parentSg && parentSg.entity ? parentSg.entity : null;
    }
  }

  const shapeDefs = gltfJson.extensions?.KHR_implicit_shapes?.shapes || [];
  const sceneNodeIndices = (gltfJson.scenes?.[gltfJson.scene || 0]?.nodes) || [];
  const worldMatrices = computeWorldMatrices(gltfJson);
  const processed = new Set();

  // Render one frame first so world matrices (for the AABB fallback + camera framing) are ready.
  try { engine.process([expression]); } catch (e) {}

  // Frame the orbit camera to the loaded model's bounds.
  const sceneAABB = getSceneAABB(modelRenderPass.entities);
  if (sceneAABB) {
    orbitCenter = sceneAABB.center;
    const diag = Math.hypot(sceneAABB.size[0], sceneAABB.size[1], sceneAABB.size[2]);
    orbitRadiusH = Math.max(diag * 0.62, 8);
    orbitHeight = orbitCenter[1] + Math.max(sceneAABB.size[1] * 0.4, diag * 0.28);
    applyCamera();
  }

  function buildShape(geomDef, scale, isDynamic) {
    if (geomDef.shape !== undefined && shapeDefs[geomDef.shape]) {
      return createImplicitShape(shapeDefs[geomDef.shape], scale);
    }
    let meshIndex = geomDef.mesh;
    if (meshIndex === undefined && geomDef.node !== undefined) meshIndex = gltfJson.nodes[geomDef.node]?.mesh;
    if (meshIndex === undefined || !glbBin) return null;
    const geo = getMeshGeometry(gltfJson, glbBin, meshIndex);
    return geo ? createMeshShape(geo, scale, !!geomDef.convexHull, isDynamic) : null;
  }

  function collectColliders(nodeIndex, out) {
    for (const c of (gltfJson.nodes[nodeIndex].children || [])) {
      const cd = gltfJson.nodes[c];
      const ce = cd?.extensions?.KHR_physics_rigid_bodies;
      if (ce?.motion) continue;
      if (ce?.collider?.geometry) { out.push(c); processed.add(c); }
      collectColliders(c, out);
    }
  }

  function makeNode(entity, body, isDynamic, pos, rot, motion) {
    const node = {
      entity, body, isDynamic,
      initialPosition: { x: pos[0], y: pos[1], z: pos[2] },
      initialRotation: { x: rot[0], y: rot[1], z: rot[2], w: rot[3] },
      initialLinearVelocity: (motion && Array.isArray(motion.linearVelocity)) ? motion.linearVelocity.slice() : [0, 0, 0],
      initialAngularVelocity: (motion && Array.isArray(motion.angularVelocity)) ? motion.angularVelocity.slice() : [0, 0, 0],
    };
    physicsNodes.push(node);
    if (isDynamic) dynamicNodes.push(node);
    return node;
  }

  // Pass 1: compound bodies (a node with motion but no collider of its own; its descendant
  // collider nodes each become a collider attached to the one dynamic/kinematic body).
  for (const nodeIndex of sceneNodeIndices) {
    const nd = gltfJson.nodes[nodeIndex];
    const pe = nd?.extensions?.KHR_physics_rigid_bodies;
    if (!pe?.motion || pe.collider?.geometry) continue;

    const childIndices = [];
    collectColliders(nodeIndex, childIndices);
    if (childIndices.length === 0) continue;

    const parentWorld = worldMatrices.get(nodeIndex);
    const parentDec = mat4Decompose(parentWorld);
    const parentInv = mat4Invert(parentWorld) || mat4FromTRS([0, 0, 0], [0, 0, 0, 1], [1, 1, 1]);
    const parentMotion = pe.motion;

    let bodyDesc;
    if (parentMotion.isKinematic) bodyDesc = RAPIER.RigidBodyDesc.kinematicVelocityBased();
    else bodyDesc = RAPIER.RigidBodyDesc.dynamic();
    bodyDesc.setTranslation(parentDec.t[0], parentDec.t[1], parentDec.t[2]);
    bodyDesc.setRotation({ x: parentDec.r[0], y: parentDec.r[1], z: parentDec.r[2], w: parentDec.r[3] });
    applyMotionToBodyDesc(bodyDesc, parentMotion, parentDec.r);
    const body = world.createRigidBody(bodyDesc);

    const childDebug = [];
    for (const ci of childIndices) {
      const cgeom = gltfJson.nodes[ci].extensions.KHR_physics_rigid_bodies.collider.geometry;
      const childWorld = worldMatrices.get(ci);
      const childDec = mat4Decompose(childWorld);
      const cShape = buildShape(cgeom, childDec.s, true);
      if (!cShape) continue;
      const rel = mat4Decompose(mat4Multiply(parentInv, childWorld));
      cShape.colliderDesc.setTranslation(rel.t[0], rel.t[1], rel.t[2]);
      cShape.colliderDesc.setRotation({ x: rel.r[0], y: rel.r[1], z: rel.r[2], w: rel.r[3] });
      world.createCollider(cShape.colliderDesc, body);
      const de = createDebugEntity(cShape, DEBUG_COLOR_DYNAMIC);
      childDebug.push({ entity: de, relMat: mat4FromTRS(rel.t, rel.r, [1, 1, 1]) });
    }

    let entity = nodeIndexToEntity.get(nodeIndex) || (nd.name ? nameToEntity.get(nd.name) : null);
    const node = makeNode(entity, body, true, parentDec.t, parentDec.r, parentMotion);
    node.childDebug = childDebug;
    processed.add(nodeIndex);
  }

  // Pass 2: single-shape bodies.
  for (const nodeIndex of sceneNodeIndices) {
    if (processed.has(nodeIndex)) continue;
    const nodeDef = gltfJson.nodes[nodeIndex];
    const physicsExt = nodeDef?.extensions?.KHR_physics_rigid_bodies;
    const geometry = physicsExt?.collider?.geometry;
    if (!geometry) continue;

    const motion = physicsExt.motion || null;
    const isDynamic = !!motion;
    let entity = nodeIndexToEntity.get(nodeIndex);
    if (!entity && nodeDef.name) entity = nameToEntity.get(nodeDef.name);
    if (!entity) console.warn('[MotionProperties] no entity for node', nodeIndex, nodeDef.name);

    const translation = nodeDef.translation || [0, 0, 0];
    const rotation = nodeDef.rotation || [0, 0, 0, 1];
    const scale = nodeDef.scale || [1, 1, 1];

    let bodyPosition = [translation[0], translation[1], translation[2]];
    let shapeResult = buildShape(geometry, scale, isDynamic);

    if (!shapeResult) {
      const aabb = entity ? getEntityAABB(entity) : null;
      if (aabb) {
        shapeResult = createBoxShape(aabb.size);
        if (!isDynamic) bodyPosition = aabb.center;
      } else {
        shapeResult = createBoxShape(isDynamic ? [1, 1, 1] : [40, 2, 40]);
      }
    }

    const body = createBody(shapeResult.colliderDesc, bodyPosition, rotation, motion);
    const node = makeNode(entity, body, isDynamic, bodyPosition, rotation, motion);

    if (isDynamic) {
      node.debugEntity = createDebugEntity(shapeResult, DEBUG_COLOR_DYNAMIC);
    } else {
      const staticDebug = createDebugEntity(shapeResult, DEBUG_COLOR_STATIC);
      staticDebug.getTransform().localPosition = Rn.Vector3.fromCopyArray(bodyPosition);
      staticDebug.getTransform().localRotation = Rn.Quaternion.fromCopyArray(rotation);
    }
  }

  if (debugEntities.length > 0) {
    debugRenderPass.addEntities(debugEntities);
  }
  setWireframeVisible(showWireframe);

  // Physics step + transform sync.
  setInterval(() => {
    world.step();

    for (const node of dynamicNodes) {
      const p = node.body.translation();
      if (p.y < RESET_Y_THRESHOLD || p.y > RESET_Y_THRESHOLD_TOP) {
        node.body.setTranslation(node.initialPosition, true);
        node.body.setRotation(node.initialRotation, true);
        const lv = node.initialLinearVelocity;
        const av = node.initialAngularVelocity;
        node.body.setLinvel({ x: lv[0], y: lv[1], z: lv[2] }, true);
        node.body.setAngvel({ x: av[0], y: av[1], z: av[2] }, true);
      }
    }

    for (const node of physicsNodes) {
      if (!node.isDynamic) continue;
      const pos = node.body.translation();
      const ori = node.body.rotation();
      const v = Rn.Vector3.fromCopyArray([pos.x, pos.y, pos.z]);
      const q = Rn.Quaternion.fromCopyArray([ori.x, ori.y, ori.z, ori.w]);
      if (node.entity) {
        node.entity.getTransform().localPosition = v;
        node.entity.getTransform().localRotation = q;
      }
      if (node.debugEntity) {
        node.debugEntity.getTransform().localPosition = v;
        node.debugEntity.getTransform().localRotation = q;
      }
      if (node.childDebug) {
        const parentMat = mat4FromTRS([pos.x, pos.y, pos.z], [ori.x, ori.y, ori.z, ori.w], [1, 1, 1]);
        for (const cd of node.childDebug) {
          const dec = mat4Decompose(mat4Multiply(parentMat, cd.relMat));
          cd.entity.getTransform().localPosition = Rn.Vector3.fromCopyArray(dec.t);
          cd.entity.getTransform().localRotation = Rn.Quaternion.fromCopyArray(dec.r);
        }
      }
    }
  }, 1000 / 60);

  const draw = function () {
    orbitAngle += 0.0015;
    applyCamera();
    engine.process([expression]);
    requestAnimationFrame(draw);
  };
  draw();
};

function setWireframeVisible(visible) {
  showWireframe = visible;
  for (const entity of debugEntities) {
    try {
      entity.getSceneGraph().isVisible = visible;
    } catch (e) {}
  }
  const hint = document.getElementById('hint');
  if (hint) {
    hint.textContent = 'W: wireframe ' + (visible ? 'ON' : 'OFF');
  }
}

window.addEventListener('keydown', (event) => {
  if (event.repeat) {
    return;
  }
  if (event.code === 'KeyW' || event.key === 'w' || event.key === 'W') {
    setWireframeVisible(!showWireframe);
  }
});

document.body.onload = load;
