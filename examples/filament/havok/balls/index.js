// Filament + Havok — Falling Balls sample.
//
// Many balls of five kinds (basketball, beach ball, football, softball, tennis ball) — each with
// its own texture, size and restitution (bounciness) — drop into a walled box, simulated by Havok
// and rendered by Filament. Geometry (a shared sphere) + the textured material (texture.filamat)
// are built by hand; the four walls are sensors-only colliders shown as wireframes. Press W to
// toggle the collider wireframes.
//
// A compiled .filamat is tied to a Filament version, so this sample uses the matching `dev` build
// (see index.html). Libraries are globals: Filament, HavokPhysics, gl-matrix.

const FILAMAT_TEX_URL = 'https://cx20.github.io/webgl-test/examples/filament/texture/texture.filamat';
const GRASS_URL = '../../../../assets/textures/grass.jpg';

const dataSet = [
  { imageFile: '../../../../assets/textures/Basketball.jpg', scale: 1.0, restitution: 0.6 },
  { imageFile: '../../../../assets/textures/BeachBall.jpg', scale: 0.9, restitution: 0.7 },
  { imageFile: '../../../../assets/textures/Football.jpg', scale: 1.0, restitution: 0.55 },
  { imageFile: '../../../../assets/textures/Softball.jpg', scale: 0.3, restitution: 0.4 },
  { imageFile: '../../../../assets/textures/TennisBall.jpg', scale: 0.3, restitution: 0.75 },
];
const BALL_COUNT = 200;

const FIXED_TIMESTEP = 1 / 60;
const IDENTITY_QUATERNION = [0, 0, 0, 1];
const RESET_Y_THRESHOLD = -10;
const GROUND = { size: [20, 2, 20], pos: [0, -2, 0] };
const WALLS = [
  { size: [5, 5, 0.5], pos: [0, 1.5, -2.5] },
  { size: [5, 5, 0.5], pos: [0, 1.5, 2.5] },
  { size: [0.5, 5, 5], pos: [-2.5, 1.5, 0] },
  { size: [0.5, 5, 5], pos: [2.5, 1.5, 0] },
];

const DEBUG_COLOR_DYNAMIC = [1.0, 0.5, 0.2, 1.0];
const DEBUG_COLOR_STATIC = [0.2, 1.0, 0.4, 1.0];

let HK = null;
let worldId = null;

let engine = null;
const balls = [];       // { entity, bodyId, radius, curPos, curRot }
const staticBoxes = []; // ground + walls, for the debug overlay

let debugCanvas = null, debugGl = null, debugProg = null, debugVbo = null, showWireframe = true;
let unitCubeLines = null, unitSphereLines = null;

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
function makeSphereGeometry(segments, rings) {
  const pos = [], uv = [], idx = [];
  for (let y = 0; y <= rings; y++) {
    const v = y / rings, theta = v * Math.PI, st = Math.sin(theta), ct = Math.cos(theta);
    for (let x = 0; x <= segments; x++) {
      const u = x / segments, phi = u * 2 * Math.PI;
      pos.push(st * Math.cos(phi), ct, st * Math.sin(phi));
      uv.push(u, v);
    }
  }
  for (let y = 0; y < rings; y++) {
    for (let x = 0; x < segments; x++) {
      const a = y * (segments + 1) + x, b = a + segments + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
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

// ---- Body creation (builds the matching Filament renderable) ----
function addBall(scene, vb, ib, matInstance, shapeId, radius, pos) {
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
    .boundingBox({ center: [0, 0, 0], halfExtent: [radius, radius, radius] })
    .material(0, matInstance)
    .geometry(0, Filament.RenderableManager$PrimitiveType.TRIANGLES, vb, ib)
    .build(engine, entity);
  scene.addEntity(entity);
  const rm = engine.getRenderableManager();
  const inst = rm.getInstance(entity);
  if (inst) { rm.setCulling(inst, false); inst.delete(); }

  balls.push({ entity, bodyId, radius, curPos: pos.slice(), curRot: [0, 0, 0, 1] });
}

function randomDrop(yBase, ySpread) {
  return [-5 + Math.random() * 10, yBase + Math.random() * ySpread, -5 + Math.random() * 10];
}

function stepAndSync() {
  checkResult(HK.HP_World_Step(worldId, FIXED_TIMESTEP), 'HP_World_Step');
  const tcm = engine.getTransformManager();
  tcm.openLocalTransformTransaction();
  for (const b of balls) {
    let p = HK.HP_Body_GetPosition(b.bodyId)[1];
    if (p[1] < RESET_Y_THRESHOLD) {
      HK.HP_Body_SetPosition(b.bodyId, randomDrop(10, 8));
      HK.HP_Body_SetLinearVelocity(b.bodyId, [0, 0, 0]);
      HK.HP_Body_SetAngularVelocity(b.bodyId, [0, 0, 0]);
      p = HK.HP_Body_GetPosition(b.bodyId)[1];
    }
    const r = HK.HP_Body_GetOrientation(b.bodyId)[1];
    b.curPos[0] = p[0]; b.curPos[1] = p[1]; b.curPos[2] = p[2];
    b.curRot[0] = r[0]; b.curRot[1] = r[1]; b.curRot[2] = r[2]; b.curRot[3] = r[3];
    const m = mat4.fromRotationTranslationScale(
      mat4.create(), quat.fromValues(r[0], r[1], r[2], r[3]),
      vec3.fromValues(p[0], p[1], p[2]), vec3.fromValues(b.radius, b.radius, b.radius));
    const inst = tcm.getInstance(b.entity);
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

function makeSphereLineVerts(radius, segments = 12) {
  const v = [];
  for (let c = 0; c < 3; c++) {
    for (let i = 0; i < segments; i++) {
      const a0 = (i / segments) * Math.PI * 2, a1 = ((i + 1) / segments) * Math.PI * 2;
      const c0 = Math.cos(a0) * radius, s0 = Math.sin(a0) * radius, c1 = Math.cos(a1) * radius, s1 = Math.sin(a1) * radius;
      if (c === 0) v.push(c0, s0, 0, c1, s1, 0);
      else if (c === 1) v.push(c0, 0, s0, c1, 0, s1);
      else v.push(0, c0, s0, 0, c1, s1);
    }
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
  unitSphereLines = makeSphereLineVerts(1);
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
  gl.bufferData(gl.ARRAY_BUFFER, unitCubeLines, gl.DYNAMIC_DRAW);
  const cubeCount = unitCubeLines.length / 3;
  for (const sb of staticBoxes) {
    drawScaled(sb.pos, IDENTITY_QUATERNION, sb.size);
    gl.drawArrays(gl.LINES, 0, cubeCount);
  }

  // Balls (orange spheres)
  gl.uniform4fv(uColor, DEBUG_COLOR_DYNAMIC);
  gl.bufferData(gl.ARRAY_BUFFER, unitSphereLines, gl.DYNAMIC_DRAW);
  const sphCount = unitSphereLines.length / 3;
  const s = [0, 0, 0];
  for (const b of balls) {
    s[0] = s[1] = s[2] = b.radius;
    drawScaled(b.curPos, b.curRot, s);
    gl.drawArrays(gl.LINES, 0, sphCount);
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
Filament.init([FILAMAT_TEX_URL, GRASS_URL, ...dataSet.map(d => d.imageFile)], () => {
  window.Fov = Filament.Camera$Fov;
  main().catch(e => console.error(e));
});

async function main() {
  const canvas = document.getElementsByTagName('canvas')[0];
  engine = Filament.Engine.create(canvas);
  const scene = engine.createScene();

  const texMat = engine.createMaterial(FILAMAT_TEX_URL);
  const linear = new Filament.TextureSampler(Filament.MinFilter.LINEAR, Filament.MagFilter.LINEAR, Filament.WrapMode.REPEAT);

  // Grass ground
  const groundInst = texMat.createInstance();
  groundInst.setTextureParameter('texture', engine.createTextureFromJpeg(GRASS_URL, { nomips: true }), linear);
  const planeGeo = makePlaneGeometry(GROUND.size[0], 8);
  const groundVB = buildVB(engine, planeGeo.positions, planeGeo.uvs, 4);
  const groundIB = buildIB(engine, planeGeo.indices);

  const sphereGeo = makeSphereGeometry(20, 14);
  const sphereVB = buildVB(engine, sphereGeo.positions, sphereGeo.uvs, sphereGeo.positions.length / 3);
  const sphereIB = buildIB(engine, sphereGeo.indices);

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

  // Ground collider + grass renderable; four wall colliders (shown only as wireframes).
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

  // Per-type material (texture) + physics shape (radius + restitution).
  const typeData = dataSet.map((d) => {
    const radius = d.scale * 0.5;
    const inst = texMat.createInstance();
    inst.setTextureParameter('texture', engine.createTextureFromJpeg(d.imageFile, { nomips: true }), linear);
    const s = HK.HP_Shape_CreateSphere([0, 0, 0], radius);
    if (typeof HK.HP_Shape_SetMaterial === 'function') {
      HK.HP_Shape_SetMaterial(s[1], [0.5, 0.5, d.restitution, HK.MaterialCombine.MAXIMUM, HK.MaterialCombine.MAXIMUM]);
    }
    return { matInst: inst, shapeId: s[1], radius };
  });

  for (let i = 0; i < BALL_COUNT; i++) {
    const t = typeData[Math.floor(Math.random() * typeData.length)];
    addBall(scene, sphereVB, sphereIB, t.matInst, t.shapeId, t.radius, randomDrop(6, 13));
  }

  const center = [0, 0, 0];
  const orbitDist = 18;
  const orbitHeight = 10;

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
