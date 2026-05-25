// Filament + Havok — Falling Cone sample.
//
// Many carrot-textured cones drop into a walled box and pile up, simulated by Havok and rendered
// by Filament. The cone geometry + its textured material (texture.filamat) are built by hand; each
// cone collides as a convex hull (apex + base ring). The four walls are collider-only wireframes.
// Press W to toggle the collider wireframes.
//
// A compiled .filamat is tied to a Filament version, so this sample uses the matching `dev` build
// (see index.html). Libraries are globals: Filament, HavokPhysics, gl-matrix.

const FILAMAT_TEX_URL = 'https://cx20.github.io/webgl-test/examples/filament/texture/texture.filamat';
const GRASS_URL = '../../../../assets/textures/grass.jpg';
const CARROT_URL = '../../../../assets/textures/carrot.jpg';

const CONE_COUNT = 200;
const CONE_HALF_HEIGHT = 2;
const CONE_RADIUS = 1;

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

const DEBUG_COLOR_DYNAMIC = [1.0, 0.5, 0.2, 1.0];
const DEBUG_COLOR_STATIC = [0.2, 1.0, 0.4, 1.0];

let HK = null;
let worldId = null;

let engine = null;
const cones = [];       // { entity, bodyId, curPos, curRot }
const staticBoxes = []; // ground + walls, for the debug overlay

let debugCanvas = null, debugGl = null, debugProg = null, debugVbo = null, showWireframe = true;
let unitCubeLines = null, coneLines = null;

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

// ---- Geometry ----
// Cone visual (side + base cap), POSITION + UV0 (texture.filamat is unlit, so normals are dropped).
function buildConeGeometry(halfHeight, radius, segments) {
  const pos = [], uv = [], idx = [];
  pos.push(0, halfHeight, 0); uv.push(0.5, 0); // apex
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    pos.push(radius * Math.cos(a), -halfHeight, radius * Math.sin(a));
    uv.push(i / segments, 1);
  }
  for (let i = 0; i < segments; i++) idx.push(0, i + 2, i + 1);
  const capCenter = pos.length / 3;
  pos.push(0, -halfHeight, 0); uv.push(0.5, 0.5); // base centre
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
    .vertexCount(vertexCount)
    .bufferCount(2)
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

function createStaticBox(size, pos) {
  const s = HK.HP_Shape_CreateBox([0, 0, 0], IDENTITY_QUATERNION, size);
  const b = HK.HP_Body_Create();
  HK.HP_Body_SetShape(b[1], s[1]);
  HK.HP_Body_SetMotionType(b[1], HK.MotionType.STATIC);
  HK.HP_Body_SetPosition(b[1], pos);
  HK.HP_Body_SetOrientation(b[1], IDENTITY_QUATERNION);
  HK.HP_World_AddBody(worldId, b[1], false);
  staticBoxes.push({ size, pos });
}

function randomDrop(half) {
  return [-half + Math.random() * (2 * half), 20 + Math.random() * 10, -half + Math.random() * (2 * half)];
}

// ---- Body creation (builds the matching Filament renderable) ----
function addCone(scene, vb, ib, matInstance, shapeId, pos) {
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
  scene.addEntity(entity);
  const rm = engine.getRenderableManager();
  const inst = rm.getInstance(entity);
  if (inst) { rm.setCulling(inst, false); inst.delete(); }

  cones.push({ entity, bodyId, curPos: pos.slice(), curRot: [0, 0, 0, 1] });
}

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
    const m = mat4.fromRotationTranslation(
      mat4.create(), quat.fromValues(r[0], r[1], r[2], r[3]), vec3.fromValues(pos[0], pos[1], pos[2]));
    const inst = tcm.getInstance(c.entity);
    tcm.setTransform(inst, m);
    inst.delete();
  }
  tcm.commitLocalTransformTransaction();
}

// ---- Debug wireframe overlay ----
function makeBoxLineVerts(sx, sy, sz) {
  const hx = sx / 2, hy = sy / 2, hz = sz / 2;
  const c = [[-hx, -hy, -hz], [hx, -hy, -hz], [hx, hy, -hz], [-hx, hy, -hz], [-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]];
  const edges = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
  const v = [];
  for (const [a, b] of edges) v.push(...c[a], ...c[b]);
  return new Float32Array(v);
}

// Cone outline: apex->base spokes + base ring loop.
function makeConeLineVerts(halfHeight, radius, segments = 12) {
  const apex = [0, halfHeight, 0];
  const ring = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    ring.push([radius * Math.cos(a), -halfHeight, radius * Math.sin(a)]);
  }
  const v = [];
  for (let i = 0; i < segments; i++) {
    const n = ring[(i + 1) % segments];
    v.push(apex[0], apex[1], apex[2], ring[i][0], ring[i][1], ring[i][2]);
    v.push(ring[i][0], ring[i][1], ring[i][2], n[0], n[1], n[2]);
  }
  return new Float32Array(v);
}

function initDebugCanvas(mainCanvas) {
  debugCanvas = document.createElement('canvas');
  debugCanvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none';
  debugCanvas.width = mainCanvas.width;
  debugCanvas.height = mainCanvas.height;
  mainCanvas.parentElement.appendChild(debugCanvas);
  const gl = debugGl = debugCanvas.getContext('webgl2');
  if (!gl) { console.warn('[debug] WebGL2 unavailable for wireframe overlay'); return; }
  const vs = gl.createShader(gl.VERTEX_SHADER);
  gl.shaderSource(vs, '#version 300 es\nin vec3 aPos; uniform mat4 uMVP;\nvoid main(){gl_Position=uMVP*vec4(aPos,1.0);}');
  gl.compileShader(vs);
  const fs = gl.createShader(gl.FRAGMENT_SHADER);
  gl.shaderSource(fs, '#version 300 es\nprecision mediump float; uniform vec4 uColor; out vec4 o;\nvoid main(){o=uColor;}');
  gl.compileShader(fs);
  debugProg = gl.createProgram();
  gl.attachShader(debugProg, vs); gl.attachShader(debugProg, fs);
  gl.linkProgram(debugProg);
  gl.deleteShader(vs); gl.deleteShader(fs);
  if (!gl.getProgramParameter(debugProg, gl.LINK_STATUS)) {
    console.warn('[debug] shader link error:', gl.getProgramInfoLog(debugProg));
    debugProg = null; return;
  }
  debugVbo = gl.createBuffer();
  unitCubeLines = makeBoxLineVerts(1, 1, 1);
  coneLines = makeConeLineVerts(CONE_HALF_HEIGHT, CONE_RADIUS);
}

function drawDebug(eye, center, up, aspect) {
  if (!debugGl || !debugProg) return;
  const gl = debugGl;
  gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  if (!showWireframe || !HK || !worldId) return;
  gl.enable(gl.DEPTH_TEST);
  gl.useProgram(debugProg);
  const aPos = gl.getAttribLocation(debugProg, 'aPos');
  const uMVP = gl.getUniformLocation(debugProg, 'uMVP');
  const uColor = gl.getUniformLocation(debugProg, 'uColor');
  const viewM = mat4.lookAt(mat4.create(), eye, center, up);
  const projM = mat4.perspective(mat4.create(), 75 * Math.PI / 180, aspect, 0.01, 10000.0);
  const vp = mat4.multiply(mat4.create(), projM, viewM);
  gl.bindBuffer(gl.ARRAY_BUFFER, debugVbo);
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);

  const model = mat4.create(), mvp = mat4.create(), sq = quat.create(), sp = vec3.create(), ss = vec3.create();
  function setMVP(p, r, scale) {
    quat.set(sq, r[0], r[1], r[2], r[3]);
    vec3.set(sp, p[0], p[1], p[2]);
    vec3.set(ss, scale[0], scale[1], scale[2]);
    mat4.fromRotationTranslationScale(model, sq, sp, ss);
    mat4.multiply(mvp, vp, model);
    gl.uniformMatrix4fv(uMVP, false, mvp);
  }

  // Ground + walls (static, green)
  gl.uniform4fv(uColor, DEBUG_COLOR_STATIC);
  gl.bufferData(gl.ARRAY_BUFFER, unitCubeLines, gl.DYNAMIC_DRAW);
  const cubeCount = unitCubeLines.length / 3;
  for (const sb of staticBoxes) {
    setMVP(sb.pos, IDENTITY_QUATERNION, sb.size);
    gl.drawArrays(gl.LINES, 0, cubeCount);
  }

  // Cones (orange, native-size outline placed at the body transform)
  gl.uniform4fv(uColor, DEBUG_COLOR_DYNAMIC);
  gl.bufferData(gl.ARRAY_BUFFER, coneLines, gl.DYNAMIC_DRAW);
  const coneCount = coneLines.length / 3;
  const one = [1, 1, 1];
  for (const c of cones) {
    setMVP(c.curPos, c.curRot, one);
    gl.drawArrays(gl.LINES, 0, coneCount);
  }
  gl.disableVertexAttribArray(aPos);
}

// ---- W-key wireframe toggle ----
function setWireframeVisible(visible) {
  showWireframe = visible;
  const hint = document.getElementById('hint');
  if (hint) hint.textContent = 'W: wireframe ' + (visible ? 'ON' : 'OFF');
}

window.addEventListener('keydown', (event) => {
  if (event.repeat) return;
  if (event.code === 'KeyW' || event.key === 'w' || event.key === 'W') {
    setWireframeVisible(!showWireframe);
  }
});

// ---- Filament app ----
Filament.init([FILAMAT_TEX_URL, GRASS_URL, CARROT_URL], () => {
  window.Fov = Filament.Camera$Fov;
  main().catch(e => console.error(e));
});

async function main() {
  const canvas = document.getElementsByTagName('canvas')[0];
  engine = Filament.Engine.create(canvas);
  const scene = engine.createScene();

  const texMat = engine.createMaterial(FILAMAT_TEX_URL);

  // Cone material + geometry (one shared mesh + one material instance for all cones).
  const coneInst = texMat.createInstance();
  const clamp = new Filament.TextureSampler(Filament.MinFilter.LINEAR, Filament.MagFilter.LINEAR, Filament.WrapMode.CLAMP_TO_EDGE);
  coneInst.setTextureParameter('texture', engine.createTextureFromJpeg(CARROT_URL, { nomips: true }), clamp);
  const coneGeo = buildConeGeometry(CONE_HALF_HEIGHT, CONE_RADIUS, 20);
  const coneVB = buildVB(engine, coneGeo.positions, coneGeo.uvs, coneGeo.positions.length / 3);
  const coneIB = buildIB(engine, coneGeo.indices);

  // Grass ground
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

  initDebugCanvas(canvas);

  HK = await HavokPhysics();
  const w = HK.HP_World_Create();
  worldId = w[1];
  checkResult(HK.HP_World_SetGravity(worldId, [0, -9.8, 0]), 'HP_World_SetGravity');
  checkResult(HK.HP_World_SetIdealStepTime(worldId, FIXED_TIMESTEP), 'HP_World_SetIdealStepTime');

  // Ground collider + grass renderable; four wall colliders (wireframe-only).
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

  const coneShape = createConeShape();
  for (let i = 0; i < CONE_COUNT; i++) {
    addCone(scene, coneVB, coneIB, coneInst, coneShape, randomDrop(3.5));
  }

  const center = [0, 2, 0];
  const orbitDist = 26;
  const orbitHeight = 16;

  let aspect = 1;
  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.width = Math.floor(window.innerWidth * dpr);
    const height = canvas.height = Math.floor(window.innerHeight * dpr);
    if (debugCanvas) { debugCanvas.width = width; debugCanvas.height = height; }
    aspect = width / height;
    view.setViewport([0, 0, width, height]);
    const fovAxis = aspect < 1 ? Fov.HORIZONTAL : Fov.VERTICAL;
    camera.setProjectionFov(75, aspect, 0.1, 1000.0, fovAxis);
  }
  window.addEventListener('resize', resize);
  resize();

  setWireframeVisible(showWireframe);

  let angle = 0.5;
  function render() {
    requestAnimationFrame(render);
    if (HK && worldId) {
      try { stepAndSync(); } catch (e) { console.error('[physics] error:', e); HK = null; }
    }
    angle += 0.004;
    const eye = [center[0] + Math.sin(angle) * orbitDist, orbitHeight, center[2] + Math.cos(angle) * orbitDist];
    const up = [0, 1, 0];
    camera.lookAt(eye, center, up);
    renderer.render(swapChain, view);
    drawDebug(eye, center, up, aspect);
  }
  requestAnimationFrame(render);
}
