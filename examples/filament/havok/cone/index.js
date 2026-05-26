// Filament + Havok — Falling Cone sample.
//
// Many carrot-textured cones drop into a walled box and pile up, simulated by Havok and rendered
// by Filament. The cone geometry + its textured material (texture.filamat) are built by hand; each
// cone collides as a convex hull (apex + base ring). The four walls are collider-only.
//
// Collider wireframes are rendered in the same Filament pass as LINES renderables using
// `cube.filamat` (an unlit vertex-colour material) — no second canvas, no compositor stutter.
// Press W to toggle them in / out of the scene.
//
// A compiled .filamat is tied to a Filament version, so this sample uses the matching `dev` build
// (see index.html). Libraries are globals: Filament, HavokPhysics, gl-matrix.

const FILAMAT_TEX_URL = 'https://cx20.github.io/webgl-test/examples/filament/texture/texture.filamat';
const FILAMAT_CUBE_URL = 'https://cx20.github.io/webgl-test/examples/filament/cube/cube.filamat';
const GRASS_URL = '../../../../assets/textures/grass.jpg';
const CARROT_URL = '../../../../assets/textures/carrot.jpg';

const CONE_COUNT = 200;
const CONE_HALF_HEIGHT = 2;
const CONE_RADIUS = 1;
const WIREFRAME_OUTSET = 1.005;

const FIXED_TIMESTEP = 1 / 60;
const IDENTITY_QUATERNION = [0, 0, 0, 1];
const RESET_Y_THRESHOLD = -10;
const GROUND = { size: [40, 4, 40], pos: [0, -2, 0] };
const WALLS = [
  { size: [10, 10, 1], pos: [0, 5, -5] },
  { size: [10, 10, 1], pos: [0, 5, 5] },
  { size: [1, 10, 10], pos: [-5, 5, 0] },
  { size: [1, 10, 10], pos: [5, 5, 0] },
];

// Packed UBYTE4 colours that cube.filamat samples as the line colour.
const COLOR_DYNAMIC = [255, 128, 51, 255];  // orange (linear-ish; cube.filamat is unlit so it's literally what we see)
const COLOR_STATIC = [51, 255, 102, 255];   // green

let HK = null;
let worldId = null;

let engine = null;
let scene = null;
let showWireframe = true;
const cones = [];                    // { entity, wireframeEntity, bodyId, curPos, curRot }
const staticWireframeEntities = [];  // ground + walls (no per-frame sync)

// ---- Havok helpers ----
function enumToNumber(value) {
  if (typeof value === 'number' || typeof value === 'bigint') return Number(value);
  if (!value || typeof value !== 'object') return NaN;
  if (typeof value.value === 'number' || typeof value.value === 'bigint') return Number(value.value);
  if (typeof value.m_value === 'number' || typeof value.m_value === 'bigint') return Number(value.m_value);
  return NaN;
}

function checkResult(result, label) {
  if (result === HK.Result.RESULT_OK) return;
  const rc = enumToNumber(result);
  const ok = enumToNumber(HK.Result.RESULT_OK);
  if (!Number.isNaN(rc) && !Number.isNaN(ok) && rc === ok) return;
  console.warn('[Havok] ' + label + ' returned:', result);
}

// ---- Cone collider (convex hull of apex + base ring) ----
function buildConeHullPoints(halfHeight, radius, segments = 16) {
  const pts = [0, halfHeight, 0];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    pts.push(radius * Math.cos(a), -halfHeight, radius * Math.sin(a));
  }
  return new Float32Array(pts);
}

function createConeShape() {
  if (typeof HK.HP_Shape_CreateConvexHull === 'function') {
    const pts = buildConeHullPoints(CONE_HALF_HEIGHT, CONE_RADIUS);
    const nPoints = pts.length / 3;
    let shapeId = null;
    if (typeof HK._malloc === 'function' && HK.HEAPU8) {
      const ptr = HK._malloc(pts.byteLength);
      new Float32Array(HK.HEAPU8.buffer, ptr, pts.length).set(pts);
      const res = HK.HP_Shape_CreateConvexHull(ptr, nPoints);
      HK._free(ptr);
      if (enumToNumber(res[0]) === enumToNumber(HK.Result.RESULT_OK) && res[1]) shapeId = res[1];
    }
    if (!shapeId) {
      const res = HK.HP_Shape_CreateConvexHull(pts, nPoints);
      if (enumToNumber(res[0]) === enumToNumber(HK.Result.RESULT_OK) && res[1]) shapeId = res[1];
    }
    if (shapeId) return shapeId;
  }
  if (typeof HK.HP_Shape_CreateCylinder === 'function') {
    const res = HK.HP_Shape_CreateCylinder([0, -CONE_HALF_HEIGHT, 0], [0, CONE_HALF_HEIGHT, 0], CONE_RADIUS);
    checkResult(res[0], 'HP_Shape_CreateCylinder cone fallback');
    return res[1];
  }
  const res = HK.HP_Shape_CreateBox([0, 0, 0], IDENTITY_QUATERNION, [CONE_RADIUS * 2, CONE_HALF_HEIGHT * 2, CONE_RADIUS * 2]);
  checkResult(res[0], 'HP_Shape_CreateBox cone fallback');
  return res[1];
}

// ---- Textured-cone geometry (POSITION + UV0; texture.filamat is unlit, normals dropped) ----
function buildConeGeometry(halfHeight, radius, segments) {
  const pos = [], uv = [], idx = [];
  pos.push(0, halfHeight, 0); uv.push(0.5, 0);
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    pos.push(radius * Math.cos(a), -halfHeight, radius * Math.sin(a));
    uv.push(i / segments, 1);
  }
  for (let i = 0; i < segments; i++) idx.push(0, i + 2, i + 1);
  const capCenter = pos.length / 3;
  pos.push(0, -halfHeight, 0); uv.push(0.5, 0.5);
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    pos.push(radius * Math.cos(a), -halfHeight, radius * Math.sin(a));
    uv.push(0.5 + 0.5 * Math.cos(a), 0.5 + 0.5 * Math.sin(a));
  }
  for (let i = 0; i < segments; i++) idx.push(capCenter, capCenter + i + 1, capCenter + i + 2);
  return { positions: new Float32Array(pos), uvs: new Float32Array(uv), indices: new Uint16Array(idx) };
}

function makePlaneGeometry(size, tiles) {
  const h = size / 2;
  return {
    positions: new Float32Array([-h, 0, -h, h, 0, -h, h, 0, h, -h, 0, h]),
    uvs: new Float32Array([0, 0, tiles, 0, tiles, tiles, 0, tiles]),
    indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
  };
}

function buildVB(eng, positions, uvs, vertexCount) {
  const VA = Filament.VertexAttribute, AT = Filament.VertexBuffer$AttributeType;
  const vb = Filament.VertexBuffer.Builder()
    .vertexCount(vertexCount).bufferCount(2)
    .attribute(VA.POSITION, 0, AT.FLOAT3, 0, 0)
    .attribute(VA.UV0, 1, AT.FLOAT2, 0, 0)
    .build(eng);
  vb.setBufferAt(eng, 0, positions);
  vb.setBufferAt(eng, 1, uvs);
  return vb;
}

function buildIB(eng, indices) {
  const ib = Filament.IndexBuffer.Builder()
    .indexCount(indices.length)
    .bufferType(Filament.IndexBuffer$IndexType.USHORT)
    .build(eng);
  ib.setBuffer(eng, indices);
  return ib;
}

// ---- LINES wireframes (cube.filamat: POSITION + COLOR per vertex) ----
// Apex + base ring; the spokes and the ring loop form the cone outline.
function buildConeLineGeometry(halfHeight, radius, segments = 16) {
  const positions = [0, halfHeight, 0];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    positions.push(radius * Math.cos(a), -halfHeight, radius * Math.sin(a));
  }
  const indices = [];
  for (let i = 0; i < segments; i++) {
    indices.push(0, 1 + i);                                // apex -> ring vertex
    indices.push(1 + i, 1 + ((i + 1) % segments));         // ring loop edge
  }
  return { positions: new Float32Array(positions), indices: new Uint16Array(indices) };
}

const LINE_BOX_INDICES = new Uint16Array([
  0, 1, 1, 2, 2, 3, 3, 0,
  4, 5, 5, 6, 6, 7, 7, 4,
  0, 4, 1, 5, 2, 6, 3, 7,
]);
function buildLineBoxGeometry(hx, hy, hz, cx = 0, cy = 0, cz = 0) {
  return {
    positions: new Float32Array([
      cx - hx, cy - hy, cz - hz,  cx + hx, cy - hy, cz - hz,  cx + hx, cy + hy, cz - hz,  cx - hx, cy + hy, cz - hz,
      cx - hx, cy - hy, cz + hz,  cx + hx, cy - hy, cz + hz,  cx + hx, cy + hy, cz + hz,  cx - hx, cy + hy, cz + hz,
    ]),
    indices: LINE_BOX_INDICES,
  };
}

function buildLineVB(eng, positions, color4) {
  const VA = Filament.VertexAttribute, AT = Filament.VertexBuffer$AttributeType;
  const vertexCount = positions.length / 3;
  const vb = Filament.VertexBuffer.Builder()
    .vertexCount(vertexCount).bufferCount(2)
    .attribute(VA.POSITION, 0, AT.FLOAT3, 0, 0)
    .attribute(VA.COLOR, 1, AT.UBYTE4, 0, 0)
    .normalized(VA.COLOR)
    .build(eng);
  vb.setBufferAt(eng, 0, positions);
  const col = new Uint8Array(vertexCount * 4);
  for (let i = 0; i < vertexCount; i++) {
    col[i * 4] = color4[0]; col[i * 4 + 1] = color4[1]; col[i * 4 + 2] = color4[2]; col[i * 4 + 3] = color4[3];
  }
  vb.setBufferAt(eng, 1, col);
  return vb;
}

function buildLineRenderable(vb, ib, matInstance, halfExtent) {
  const entity = Filament.EntityManager.get().create();
  Filament.RenderableManager.Builder(1)
    .boundingBox({ center: [0, 0, 0], halfExtent })
    .material(0, matInstance)
    .geometry(0, Filament.RenderableManager$PrimitiveType.LINES, vb, ib)
    .build(engine, entity);
  const rm = engine.getRenderableManager();
  const inst = rm.getInstance(entity);
  if (inst) { rm.setCulling(inst, false); inst.delete(); }
  return entity;
}

// ---- Physics ----
function createStaticBox(size, pos) {
  const s = HK.HP_Shape_CreateBox([0, 0, 0], IDENTITY_QUATERNION, size);
  const b = HK.HP_Body_Create();
  HK.HP_Body_SetShape(b[1], s[1]);
  HK.HP_Body_SetMotionType(b[1], HK.MotionType.STATIC);
  HK.HP_Body_SetPosition(b[1], pos);
  HK.HP_Body_SetOrientation(b[1], IDENTITY_QUATERNION);
  HK.HP_World_AddBody(worldId, b[1], false);
}

function randomDrop(half) {
  return [-half + Math.random() * (2 * half), 20 + Math.random() * 10, -half + Math.random() * (2 * half)];
}

function addCone(coneScene, vb, ib, matInstance, shapeId, pos, wireVB, wireIB, wireMatInstance) {
  const cb = HK.HP_Body_Create();
  const bodyId = cb[1];
  HK.HP_Body_SetShape(bodyId, shapeId);
  HK.HP_Body_SetMotionType(bodyId, HK.MotionType.DYNAMIC);
  const mp = HK.HP_Shape_BuildMassProperties(shapeId);
  HK.HP_Body_SetMassProperties(bodyId, mp[1]);
  HK.HP_Body_SetPosition(bodyId, pos);
  HK.HP_Body_SetOrientation(bodyId, IDENTITY_QUATERNION);
  HK.HP_World_AddBody(worldId, bodyId, false);

  const entity = Filament.EntityManager.get().create();
  Filament.RenderableManager.Builder(1)
    .boundingBox({ center: [0, 0, 0], halfExtent: [CONE_RADIUS, CONE_HALF_HEIGHT, CONE_RADIUS] })
    .material(0, matInstance)
    .geometry(0, Filament.RenderableManager$PrimitiveType.TRIANGLES, vb, ib)
    .build(engine, entity);
  coneScene.addEntity(entity);
  const rm = engine.getRenderableManager();
  const inst = rm.getInstance(entity);
  if (inst) { rm.setCulling(inst, false); inst.delete(); }

  const wireframeEntity = buildLineRenderable(wireVB, wireIB, wireMatInstance, [CONE_RADIUS, CONE_HALF_HEIGHT, CONE_RADIUS]);
  coneScene.addEntity(wireframeEntity);

  cones.push({ entity, wireframeEntity, bodyId, curPos: pos.slice(), curRot: [0, 0, 0, 1] });
}

let tmpMat = null, tmpQuat = null, tmpVec = null;

function stepAndSync() {
  checkResult(HK.HP_World_Step(worldId, FIXED_TIMESTEP), 'HP_World_Step');
  const tcm = engine.getTransformManager();
  tcm.openLocalTransformTransaction();
  for (const c of cones) {
    let pos = HK.HP_Body_GetPosition(c.bodyId)[1];
    if (pos[1] < RESET_Y_THRESHOLD) {
      HK.HP_Body_SetPosition(c.bodyId, randomDrop(5));
      HK.HP_Body_SetLinearVelocity(c.bodyId, [0, 0, 0]);
      HK.HP_Body_SetAngularVelocity(c.bodyId, [0, 0, 0]);
      pos = HK.HP_Body_GetPosition(c.bodyId)[1];
    }
    const r = HK.HP_Body_GetOrientation(c.bodyId)[1];
    c.curPos[0] = pos[0]; c.curPos[1] = pos[1]; c.curPos[2] = pos[2];
    c.curRot[0] = r[0]; c.curRot[1] = r[1]; c.curRot[2] = r[2]; c.curRot[3] = r[3];
    quat.set(tmpQuat, r[0], r[1], r[2], r[3]);
    vec3.set(tmpVec, pos[0], pos[1], pos[2]);
    mat4.fromRotationTranslation(tmpMat, tmpQuat, tmpVec);
    if (c.entity) {
      const inst = tcm.getInstance(c.entity);
      tcm.setTransform(inst, tmpMat);
      inst.delete();
    }
    if (c.wireframeEntity) {
      const inst = tcm.getInstance(c.wireframeEntity);
      tcm.setTransform(inst, tmpMat);
      inst.delete();
    }
  }
  tcm.commitLocalTransformTransaction();
}

// ---- W-key wireframe toggle (adds / removes the wireframe entities from the scene) ----
function setWireframeVisible(visible) {
  showWireframe = visible;
  const hint = document.getElementById('hint');
  if (hint) hint.textContent = 'W: wireframe ' + (visible ? 'ON' : 'OFF');
  if (!scene) return;
  for (const c of cones) {
    if (!c.wireframeEntity) continue;
    if (visible) scene.addEntity(c.wireframeEntity); else scene.remove(c.wireframeEntity);
  }
  for (const e of staticWireframeEntities) {
    if (visible) scene.addEntity(e); else scene.remove(e);
  }
}

window.addEventListener('keydown', (event) => {
  if (event.repeat) return;
  if (event.code === 'KeyW' || event.key === 'w' || event.key === 'W') {
    setWireframeVisible(!showWireframe);
  }
});

// ---- Filament app ----
Filament.init([FILAMAT_TEX_URL, FILAMAT_CUBE_URL, GRASS_URL, CARROT_URL], () => {
  window.Fov = Filament.Camera$Fov;
  main().catch(e => console.error(e));
});

async function main() {
  tmpMat = mat4.create();
  tmpQuat = quat.create();
  tmpVec = vec3.create();

  const canvas = document.getElementsByTagName('canvas')[0];
  engine = Filament.Engine.create(canvas);
  scene = engine.createScene();

  const texMat = engine.createMaterial(FILAMAT_TEX_URL);
  const cubeMat = engine.createMaterial(FILAMAT_CUBE_URL);
  const wireMatInstance = cubeMat.getDefaultInstance(); // shared by every wireframe renderable

  // Cone material + geometry (one shared mesh + one material instance for all cones).
  const coneInst = texMat.createInstance();
  const clamp = new Filament.TextureSampler(Filament.MinFilter.LINEAR, Filament.MagFilter.LINEAR, Filament.WrapMode.CLAMP_TO_EDGE);
  coneInst.setTextureParameter('texture', engine.createTextureFromJpeg(CARROT_URL, { nomips: true }), clamp);
  const coneGeo = buildConeGeometry(CONE_HALF_HEIGHT, CONE_RADIUS, 20);
  const coneVB = buildVB(engine, coneGeo.positions, coneGeo.uvs, coneGeo.positions.length / 3);
  const coneIB = buildIB(engine, coneGeo.indices);

  // One shared LINES cone (apex + ring) per-cone wireframe.
  const coneWireGeo = buildConeLineGeometry(CONE_HALF_HEIGHT * WIREFRAME_OUTSET, CONE_RADIUS * WIREFRAME_OUTSET);
  const coneWireVB = buildLineVB(engine, coneWireGeo.positions, COLOR_DYNAMIC);
  const coneWireIB = buildIB(engine, coneWireGeo.indices);

  // Grass ground (textured, unlit) — visible part of the ground.
  const repeat = new Filament.TextureSampler(Filament.MinFilter.LINEAR, Filament.MagFilter.LINEAR, Filament.WrapMode.REPEAT);
  const groundInst = texMat.createInstance();
  groundInst.setTextureParameter('texture', engine.createTextureFromJpeg(GRASS_URL, { nomips: true }), repeat);
  const planeGeo = makePlaneGeometry(GROUND.size[0], 16);
  const groundVB = buildVB(engine, planeGeo.positions, planeGeo.uvs, 4);
  const groundIB = buildIB(engine, planeGeo.indices);

  const swapChain = engine.createSwapChain();
  const renderer = engine.createRenderer();
  const camera = engine.createCamera(Filament.EntityManager.get().create());
  const view = engine.createView();
  view.setCamera(camera);
  view.setScene(scene);
  renderer.setClearOptions({ clearColor: [0.13, 0.14, 0.16, 1.0], clear: true });

  HK = await HavokPhysics();
  const w = HK.HP_World_Create();
  worldId = w[1];
  checkResult(HK.HP_World_SetGravity(worldId, [0, -9.8, 0]), 'HP_World_SetGravity');
  checkResult(HK.HP_World_SetIdealStepTime(worldId, FIXED_TIMESTEP), 'HP_World_SetIdealStepTime');

  // Ground collider + grass renderable; four wall colliders. Each static body also gets a LINES
  // wireframe renderable (size + position baked into its VB so no transform sync is needed).
  createStaticBox(GROUND.size, GROUND.pos);
  for (const wd of WALLS) createStaticBox(wd.size, wd.pos);

  const groundEntity = Filament.EntityManager.get().create();
  Filament.RenderableManager.Builder(1)
    .boundingBox({ center: [0, 0, 0], halfExtent: [GROUND.size[0] / 2, 0.1, GROUND.size[2] / 2] })
    .material(0, groundInst)
    .geometry(0, Filament.RenderableManager$PrimitiveType.TRIANGLES, groundVB, groundIB)
    .build(engine, groundEntity);
  scene.addEntity(groundEntity);
  {
    const tcm = engine.getTransformManager();
    const inst = tcm.getInstance(groundEntity);
    tcm.setTransform(inst, mat4.fromTranslation(mat4.create(), vec3.fromValues(0, GROUND.pos[1] + GROUND.size[1] / 2, 0)));
    inst.delete();
    const rm = engine.getRenderableManager();
    const ri = rm.getInstance(groundEntity);
    if (ri) { rm.setCulling(ri, false); ri.delete(); }
  }

  // One static-wire renderable per static box (size + position baked).
  for (const def of [{ size: GROUND.size, pos: GROUND.pos }, ...WALLS]) {
    const hx = def.size[0] / 2 * WIREFRAME_OUTSET, hy = def.size[1] / 2 * WIREFRAME_OUTSET, hz = def.size[2] / 2 * WIREFRAME_OUTSET;
    const g = buildLineBoxGeometry(hx, hy, hz, def.pos[0], def.pos[1], def.pos[2]);
    const vb = buildLineVB(engine, g.positions, COLOR_STATIC);
    const ib = buildIB(engine, g.indices);
    const entity = buildLineRenderable(vb, ib, wireMatInstance, [hx, hy, hz]);
    scene.addEntity(entity);
    staticWireframeEntities.push(entity);
  }

  const coneShape = createConeShape();
  for (let i = 0; i < CONE_COUNT; i++) {
    addCone(scene, coneVB, coneIB, coneInst, coneShape, randomDrop(3.5), coneWireVB, coneWireIB, wireMatInstance);
  }

  const center = [0, 2, 0];
  const orbitDist = 26;
  const orbitHeight = 16;

  let aspect = 1;
  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.width = Math.floor(window.innerWidth * dpr);
    const height = canvas.height = Math.floor(window.innerHeight * dpr);
    aspect = width / height;
    view.setViewport([0, 0, width, height]);
    const fovAxis = aspect < 1 ? Fov.HORIZONTAL : Fov.VERTICAL;
    camera.setProjectionFov(75, aspect, 0.1, 1000.0, fovAxis);
  }
  window.addEventListener('resize', resize);
  resize();

  setWireframeVisible(showWireframe);

  // Camera orbit driven directly by wall time — pure function of `now`, no drift.
  const ORBIT_SPEED = 0.24; // rad/s
  const ORBIT_PHASE = 0.5;
  function render(now) {
    requestAnimationFrame(render);
    if (HK && worldId) {
      try { stepAndSync(); } catch (e) { console.error('[physics] error:', e); HK = null; }
    }
    const angle = ORBIT_PHASE + now * 0.001 * ORBIT_SPEED;
    const eye = [center[0] + Math.sin(angle) * orbitDist, orbitHeight, center[2] + Math.cos(angle) * orbitDist];
    const up = [0, 1, 0];
    camera.lookAt(eye, center, up);
    renderer.render(swapChain, view);
  }
  requestAnimationFrame(render);
}
