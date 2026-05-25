// Filament + Havok — Falling Shogi sample.
//
// Many shogi pieces (a faceted pentagon-prism shape, textured with a shogi piece image) tumble
// into a walled box, simulated by Havok and rendered by Filament. The piece geometry + the
// textured material (texture.filamat) are built by hand; the four walls are collider-only and
// shown as wireframes. Each piece collides as a box. Press W to toggle the collider wireframes.
//
// A compiled .filamat is tied to a Filament version, so this sample uses the matching `dev` build
// (see index.html). Libraries are globals: Filament, HavokPhysics, gl-matrix.

const FILAMAT_TEX_URL = 'https://cx20.github.io/webgl-test/examples/filament/texture/texture.filamat';
const GRASS_URL = '../../../../assets/textures/grass.jpg';
const SHOGI_URL = '../../../../assets/textures/shogi_001/shogi.png';

const PIECE_COUNT = 220;
const PIECE_W = 1.6;
const PIECE_H = 1.6;
const PIECE_D = 0.45;
const COLLIDER_SIZE = [PIECE_W, PIECE_H, PIECE_D * 1.4];

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
const pieces = [];      // { entity, bodyId, curPos, curRot }
const staticBoxes = []; // ground + walls, for the debug overlay

let debugCanvas = null, debugGl = null, debugProg = null, debugVbo = null, showWireframe = true;
let unitCubeLines = null;

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

// ---- Geometry ----
// Faceted shogi-piece prism (positions + uv0; texture.filamat is unlit so normals are dropped).
function createShogiGeometry(w, h, d) {
  const positions = new Float32Array([
    -0.5 * w, -0.5 * h, 0.7 * d, 0.5 * w, -0.5 * h, 0.7 * d, 0.35 * w, 0.5 * h, 0.4 * d, -0.35 * w, 0.5 * h, 0.4 * d,
    -0.5 * w, -0.5 * h, -0.7 * d, 0.5 * w, -0.5 * h, -0.7 * d, 0.35 * w, 0.5 * h, -0.4 * d, -0.35 * w, 0.5 * h, -0.4 * d,
    0.35 * w, 0.5 * h, 0.4 * d, -0.35 * w, 0.5 * h, 0.4 * d, -0.35 * w, 0.5 * h, -0.4 * d, 0.35 * w, 0.5 * h, -0.4 * d,
    -0.5 * w, -0.5 * h, 0.7 * d, 0.5 * w, -0.5 * h, 0.7 * d, 0.5 * w, -0.5 * h, -0.7 * d, -0.5 * w, -0.5 * h, -0.7 * d,
    0.5 * w, -0.5 * h, 0.7 * d, 0.35 * w, 0.5 * h, 0.4 * d, 0.35 * w, 0.5 * h, -0.4 * d, 0.5 * w, -0.5 * h, -0.7 * d,
    -0.5 * w, -0.5 * h, 0.7 * d, -0.35 * w, 0.5 * h, 0.4 * d, -0.35 * w, 0.5 * h, -0.4 * d, -0.5 * w, -0.5 * h, -0.7 * d,
    -0.35 * w, 0.5 * h, 0.4 * d, 0.35 * w, 0.5 * h, 0.4 * d, 0.0 * w, 0.6 * h, 0.35 * d,
    -0.35 * w, 0.5 * h, -0.4 * d, 0.35 * w, 0.5 * h, -0.4 * d, 0.0 * w, 0.6 * h, -0.35 * d,
    0.35 * w, 0.5 * h, 0.4 * d, 0.35 * w, 0.5 * h, -0.4 * d, 0.0 * w, 0.6 * h, -0.35 * d, 0.0 * w, 0.6 * h, 0.35 * d,
    -0.35 * w, 0.5 * h, 0.4 * d, -0.35 * w, 0.5 * h, -0.4 * d, 0.0 * w, 0.6 * h, -0.35 * d, 0.0 * w, 0.6 * h, 0.35 * d,
  ]);
  const texcoords = new Float32Array([
    0.5, 0.5, 0.75, 0.5, 0.75 - 0.25 / 8, 1.0, 0.5 + 0.25 / 8, 1.0,
    0.5, 0.5, 0.25, 0.5, 0.25 + 0.25 / 8, 1.0, 0.5 - 0.25 / 8, 1.0,
    0.75, 0.5, 0.5, 0.5, 0.5, 0.0, 0.75, 0.0,
    0.0, 0.5, 0.25, 0.5, 0.25, 1.0, 0.0, 1.0,
    0.0, 0.5, 0.0, 0.0, 0.25, 0.0, 0.25, 0.5,
    0.5, 0.5, 0.5, 0.0, 0.25, 0.0, 0.25, 0.5,
    0.75, 0.0, 1.0, 0.0, 1.0, 0.5,
    0.75, 0.0, 1.0, 0.0, 1.0, 0.5,
    0.75, 0.0, 1.0, 0.0, 1.0, 0.5, 0.75, 0.5,
    0.75, 0.0, 1.0, 0.0, 1.0, 0.5, 0.75, 0.5,
  ]);
  // The atlas UVs were authored for a top-left texture origin; Filament samples with the opposite
  // V direction, so flip V to keep the kanji on the piece faces (not the sides).
  for (let i = 1; i < texcoords.length; i += 2) texcoords[i] = 1 - texcoords[i];
  const indices = new Uint16Array([
    0, 1, 2, 0, 2, 3,
    4, 6, 5, 4, 7, 6,
    8, 9, 10, 8, 10, 11,
    12, 14, 13, 12, 15, 14,
    16, 18, 17, 16, 19, 18,
    20, 21, 22, 20, 22, 23,
    24, 25, 26,
    27, 29, 28,
    30, 31, 33, 31, 32, 33,
    34, 36, 35, 34, 37, 36,
  ]);
  return { positions, texcoords, indices };
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

function randomQuat() {
  const x = Math.random() - 0.5, y = Math.random() - 0.5, z = Math.random() - 0.5, w = Math.random() - 0.5;
  const l = Math.hypot(x, y, z, w) || 1;
  return [x / l, y / l, z / l, w / l];
}

function randomDrop() {
  return [(Math.random() - 0.5) * 8, 12 + Math.random() * 26, (Math.random() - 0.5) * 8];
}

// ---- Body creation (builds the matching Filament renderable) ----
function addPiece(scene, vb, ib, matInstance, shapeId, pos, rot) {
  const cb = HK.HP_Body_Create();
  const bodyId = cb[1];
  HK.HP_Body_SetShape(bodyId, shapeId);
  HK.HP_Body_SetMotionType(bodyId, HK.MotionType.DYNAMIC);
  const mp = HK.HP_Shape_BuildMassProperties(shapeId);
  HK.HP_Body_SetMassProperties(bodyId, mp[1]);
  HK.HP_Body_SetPosition(bodyId, pos);
  HK.HP_Body_SetOrientation(bodyId, rot);
  HK.HP_World_AddBody(worldId, bodyId, false);

  const entity = Filament.EntityManager.get().create();
  Filament.RenderableManager.Builder(1)
    .boundingBox({ center: [0, 0, 0], halfExtent: [PIECE_W / 2, PIECE_H * 0.6, PIECE_D * 0.7] })
    .material(0, matInstance)
    .geometry(0, Filament.RenderableManager$PrimitiveType.TRIANGLES, vb, ib)
    .build(engine, entity);
  scene.addEntity(entity);
  const rm = engine.getRenderableManager();
  const inst = rm.getInstance(entity);
  if (inst) { rm.setCulling(inst, false); inst.delete(); }

  pieces.push({ entity, bodyId, curPos: pos.slice(), curRot: rot.slice() });
}

function stepAndSync() {
  checkResult(HK.HP_World_Step(worldId, FIXED_TIMESTEP), 'HP_World_Step');
  const tcm = engine.getTransformManager();
  tcm.openLocalTransformTransaction();
  for (const p of pieces) {
    let pos = HK.HP_Body_GetPosition(p.bodyId)[1];
    if (pos[1] < RESET_Y_THRESHOLD) {
      HK.HP_Body_SetPosition(p.bodyId, randomDrop());
      HK.HP_Body_SetOrientation(p.bodyId, randomQuat());
      HK.HP_Body_SetLinearVelocity(p.bodyId, [0, 0, 0]);
      HK.HP_Body_SetAngularVelocity(p.bodyId, [0, 0, 0]);
      pos = HK.HP_Body_GetPosition(p.bodyId)[1];
    }
    const r = HK.HP_Body_GetOrientation(p.bodyId)[1];
    p.curPos[0] = pos[0]; p.curPos[1] = pos[1]; p.curPos[2] = pos[2];
    p.curRot[0] = r[0]; p.curRot[1] = r[1]; p.curRot[2] = r[2]; p.curRot[3] = r[3];
    const m = mat4.fromRotationTranslation(
      mat4.create(), quat.fromValues(r[0], r[1], r[2], r[3]), vec3.fromValues(pos[0], pos[1], pos[2]));
    const inst = tcm.getInstance(p.entity);
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
  gl.bufferData(gl.ARRAY_BUFFER, unitCubeLines, gl.DYNAMIC_DRAW);
  const count = unitCubeLines.length / 3;

  const model = mat4.create(), mvp = mat4.create(), sq = quat.create(), sp = vec3.create(), ss = vec3.create();
  function drawScaled(p, r, scale) {
    quat.set(sq, r[0], r[1], r[2], r[3]);
    vec3.set(sp, p[0], p[1], p[2]);
    vec3.set(ss, scale[0], scale[1], scale[2]);
    mat4.fromRotationTranslationScale(model, sq, sp, ss);
    mat4.multiply(mvp, vp, model);
    gl.uniformMatrix4fv(uMVP, false, mvp);
  }

  // Ground + walls (static, green)
  gl.uniform4fv(uColor, DEBUG_COLOR_STATIC);
  for (const sb of staticBoxes) {
    drawScaled(sb.pos, IDENTITY_QUATERNION, sb.size);
    gl.drawArrays(gl.LINES, 0, count);
  }

  // Pieces (orange box colliders)
  gl.uniform4fv(uColor, DEBUG_COLOR_DYNAMIC);
  for (const p of pieces) {
    drawScaled(p.curPos, p.curRot, COLLIDER_SIZE);
    gl.drawArrays(gl.LINES, 0, count);
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
Filament.init([FILAMAT_TEX_URL, GRASS_URL, SHOGI_URL], () => {
  window.Fov = Filament.Camera$Fov;
  main().catch(e => console.error(e));
});

async function main() {
  const canvas = document.getElementsByTagName('canvas')[0];
  engine = Filament.Engine.create(canvas);
  const scene = engine.createScene();

  const texMat = engine.createMaterial(FILAMAT_TEX_URL);
  const linear = new Filament.TextureSampler(Filament.MinFilter.LINEAR, Filament.MagFilter.LINEAR, Filament.WrapMode.CLAMP_TO_EDGE);

  // Shogi piece material + geometry (one shared mesh + one material instance for all pieces).
  const pieceInst = texMat.createInstance();
  pieceInst.setTextureParameter('texture', engine.createTextureFromPng(SHOGI_URL, { nomips: true }), linear);
  const pieceGeo = createShogiGeometry(PIECE_W, PIECE_H, PIECE_D);
  const pieceVB = buildVB(engine, pieceGeo.positions, pieceGeo.texcoords, pieceGeo.positions.length / 3);
  const pieceIB = buildIB(engine, pieceGeo.indices);

  // Grass ground
  const grassSampler = new Filament.TextureSampler(Filament.MinFilter.LINEAR, Filament.MagFilter.LINEAR, Filament.WrapMode.REPEAT);
  const groundInst = texMat.createInstance();
  groundInst.setTextureParameter('texture', engine.createTextureFromJpeg(GRASS_URL, { nomips: true }), grassSampler);
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
  checkResult(HK.HP_World_SetGravity(worldId, [0, -10, 0]), 'HP_World_SetGravity');
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

  const pieceShape = HK.HP_Shape_CreateBox([0, 0, 0], IDENTITY_QUATERNION, COLLIDER_SIZE)[1];
  for (let i = 0; i < PIECE_COUNT; i++) {
    addPiece(scene, pieceVB, pieceIB, pieceInst, pieceShape, randomDrop(), randomQuat());
  }

  const center = [0, 2, 0];
  const orbitDist = 30;
  const orbitHeight = 18;

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
