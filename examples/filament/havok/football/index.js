// Filament + Havok — Falling Football sample.
//
// 256 balls (a 16x16 bitmap picture) fall and pile up, simulated by Havok and rendered by Filament.
// Each ball is a sphere textured with the football image tinted by its picture colour. The provided
// texture.filamat can't multiply texture * colour, so a per-colour "tinted football" texture is
// baked at load time on a canvas (football.png x colour) and bound to a material instance. Press W
// to toggle the collider wireframes.
//
// A compiled .filamat is tied to a Filament version, so this sample uses the matching `dev` build
// (see index.html). Libraries are globals: Filament, HavokPhysics, gl-matrix.

const FILAMAT_TEX_URL = 'https://cx20.github.io/webgl-test/examples/filament/texture/texture.filamat';
const FOOTBALL_URL = '../../../../assets/textures/football.png';
const GRASS_URL = '../../../../assets/textures/grass.jpg';

const dataSet = [
  '無', '無', '無', '無', '無', '無', '無', '無', '無', '無', '無', '無', '無', '肌', '肌', '肌',
  '無', '無', '無', '無', '無', '無', '赤', '赤', '赤', '赤', '赤', '無', '無', '肌', '肌', '肌',
  '無', '無', '無', '無', '無', '赤', '赤', '赤', '赤', '赤', '赤', '赤', '赤', '赤', '肌', '肌',
  '無', '無', '無', '無', '無', '茶', '茶', '茶', '肌', '肌', '茶', '肌', '無', '赤', '赤', '赤',
  '無', '無', '無', '無', '茶', '肌', '茶', '肌', '肌', '肌', '茶', '肌', '肌', '赤', '赤', '赤',
  '無', '無', '無', '無', '茶', '肌', '茶', '茶', '肌', '肌', '肌', '茶', '肌', '肌', '肌', '赤',
  '無', '無', '無', '無', '茶', '茶', '肌', '肌', '肌', '肌', '茶', '茶', '茶', '茶', '赤', '無',
  '無', '無', '無', '無', '無', '無', '肌', '肌', '肌', '肌', '肌', '肌', '肌', '赤', '無', '無',
  '無', '無', '赤', '赤', '赤', '赤', '赤', '青', '赤', '赤', '赤', '青', '赤', '無', '無', '無',
  '無', '赤', '赤', '赤', '赤', '赤', '赤', '赤', '青', '赤', '赤', '赤', '青', '無', '無', '茶',
  '肌', '肌', '赤', '赤', '赤', '赤', '赤', '赤', '青', '青', '青', '青', '青', '無', '無', '茶',
  '肌', '肌', '肌', '無', '青', '青', '赤', '青', '青', '黄', '青', '青', '黄', '青', '茶', '茶',
  '無', '肌', '無', '茶', '青', '青', '青', '青', '青', '青', '青', '青', '青', '青', '茶', '茶',
  '無', '無', '茶', '茶', '茶', '青', '青', '青', '青', '青', '青', '青', '青', '青', '茶', '茶',
  '無', '茶', '茶', '茶', '青', '青', '青', '青', '青', '青', '青', '無', '無', '無', '無', '無',
  '無', '茶', '無', '無', '青', '青', '青', '青', '無', '無', '無', '無', '無', '無', '無', '無',
];

const colorHash = {
  '無': [0xDC / 255, 0xAA / 255, 0x6B / 255],
  '白': [1, 1, 1],
  '肌': [1, 0xCC / 255, 0xCC / 255],
  '茶': [0x80 / 255, 0, 0],
  '赤': [1, 0, 0],
  '黄': [1, 1, 0],
  '緑': [0, 1, 0],
  '水': [0, 1, 1],
  '青': [0, 0, 1],
  '紫': [0x80 / 255, 0, 0x80 / 255],
};

const FIXED_TIMESTEP = 1 / 60;
const IDENTITY_QUATERNION = [0, 0, 0, 1];
const BALL_SIZE = 1;
const BALL_RADIUS = BALL_SIZE / 2;
const RESET_Y_THRESHOLD = -10;
// The balls drop across x = -10..+12.5, so the ground is enlarged to catch all of them (matching
// the Babylon.js sample, which uses a ground much larger than the ball spread).
const GROUND = { size: [40, 0.4, 40], pos: [0, 0, 0] };

const DEBUG_COLOR_DYNAMIC = [1.0, 0.5, 0.2, 1.0];
const DEBUG_COLOR_STATIC = [0.2, 1.0, 0.4, 1.0];

let HK = null;
let worldId = null;

let engine = null;
const balls = []; // { entity, bodyId, curPos, curRot }

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

// Bake football.png x colour into a texture (texture.filamat samples it directly, no tint param).
function tintedFootballTexture(eng, img, rgb) {
  const cv = document.createElement('canvas');
  cv.width = img.naturalWidth || img.width;
  cv.height = img.naturalHeight || img.height;
  const ctx = cv.getContext('2d');
  ctx.drawImage(img, 0, 0);
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = `rgb(${Math.round(rgb[0] * 255)},${Math.round(rgb[1] * 255)},${Math.round(rgb[2] * 255)})`;
  ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.globalCompositeOperation = 'destination-in'; // restore the football's own alpha
  ctx.drawImage(img, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  const b64 = cv.toDataURL('image/png').split(',')[1];
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return eng.createTextureFromPng(bytes, { nomips: true });
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

// ---- Body creation (builds the matching Filament renderable) ----
function addBall(scene, vb, ib, matInstance, shapeId, pos) {
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
    .boundingBox({ center: [0, 0, 0], halfExtent: [BALL_RADIUS, BALL_RADIUS, BALL_RADIUS] })
    .material(0, matInstance)
    .geometry(0, Filament.RenderableManager$PrimitiveType.TRIANGLES, vb, ib)
    .build(engine, entity);
  scene.addEntity(entity);
  const rm = engine.getRenderableManager();
  const inst = rm.getInstance(entity);
  if (inst) { rm.setCulling(inst, false); inst.delete(); }

  balls.push({ entity, bodyId, curPos: pos.slice(), curRot: [0, 0, 0, 1] });
}

function randomRespawn() {
  return [-5 + Math.random() * 10, 20 + Math.random() * 10, -5 + Math.random() * 10];
}

function stepAndSync() {
  checkResult(HK.HP_World_Step(worldId, FIXED_TIMESTEP), 'HP_World_Step');
  const tcm = engine.getTransformManager();
  tcm.openLocalTransformTransaction();
  for (const b of balls) {
    let p = HK.HP_Body_GetPosition(b.bodyId)[1];
    if (p[1] < RESET_Y_THRESHOLD) {
      HK.HP_Body_SetPosition(b.bodyId, randomRespawn());
      HK.HP_Body_SetLinearVelocity(b.bodyId, [0, 0, 0]);
      HK.HP_Body_SetAngularVelocity(b.bodyId, [0, 0, 0]);
      p = HK.HP_Body_GetPosition(b.bodyId)[1];
    }
    const r = HK.HP_Body_GetOrientation(b.bodyId)[1];
    b.curPos[0] = p[0]; b.curPos[1] = p[1]; b.curPos[2] = p[2];
    b.curRot[0] = r[0]; b.curRot[1] = r[1]; b.curRot[2] = r[2]; b.curRot[3] = r[3];
    const m = mat4.fromRotationTranslationScale(
      mat4.create(), quat.fromValues(r[0], r[1], r[2], r[3]),
      vec3.fromValues(p[0], p[1], p[2]), vec3.fromValues(BALL_RADIUS, BALL_RADIUS, BALL_RADIUS));
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

  // Ground (static, green)
  gl.uniform4fv(uColor, DEBUG_COLOR_STATIC);
  drawScaled(GROUND.pos, IDENTITY_QUATERNION, GROUND.size);
  gl.bufferData(gl.ARRAY_BUFFER, unitCubeLines, gl.DYNAMIC_DRAW);
  gl.drawArrays(gl.LINES, 0, unitCubeLines.length / 3);

  // Balls (orange spheres)
  gl.uniform4fv(uColor, DEBUG_COLOR_DYNAMIC);
  gl.bufferData(gl.ARRAY_BUFFER, unitSphereLines, gl.DYNAMIC_DRAW);
  const sphCount = unitSphereLines.length / 3;
  const ballScale = [BALL_RADIUS, BALL_RADIUS, BALL_RADIUS];
  for (const b of balls) {
    drawScaled(b.curPos, b.curRot, ballScale);
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
Filament.init([FILAMAT_TEX_URL, GRASS_URL], () => {
  window.Fov = Filament.Camera$Fov;
  main().catch(e => console.error(e));
});

async function main() {
  const canvas = document.getElementsByTagName('canvas')[0];
  engine = Filament.Engine.create(canvas);
  const scene = engine.createScene();

  const texMat = engine.createMaterial(FILAMAT_TEX_URL);
  const linear = new Filament.TextureSampler(Filament.MinFilter.LINEAR, Filament.MagFilter.LINEAR, Filament.WrapMode.REPEAT);

  // Per-colour football material instances (football.png x colour).
  const footballImg = await loadImage(FOOTBALL_URL);
  const ballInstByKey = {};
  for (const [key, rgb] of Object.entries(colorHash)) {
    const inst = texMat.createInstance();
    inst.setTextureParameter('texture', tintedFootballTexture(engine, footballImg, rgb), linear);
    ballInstByKey[key] = inst;
  }

  // Grass ground
  const groundInst = texMat.createInstance();
  groundInst.setTextureParameter('texture', engine.createTextureFromJpeg(GRASS_URL, { nomips: true }), linear);
  const planeGeo = makePlaneGeometry(GROUND.size[0], 16);
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
  renderer.setClearOptions({ clearColor: [0.1, 0.1, 0.15, 1.0], clear: true });

  initDebugCanvas(canvas);

  HK = await HavokPhysics();
  const w = HK.HP_World_Create();
  worldId = w[1];
  checkResult(HK.HP_World_SetGravity(worldId, [0, -10, 0]), 'HP_World_SetGravity');
  checkResult(HK.HP_World_SetIdealStepTime(worldId, FIXED_TIMESTEP), 'HP_World_SetIdealStepTime');

  // Ground collider (static box) + grass renderable on top.
  const gs = HK.HP_Shape_CreateBox([0, 0, 0], IDENTITY_QUATERNION, GROUND.size);
  const gb = HK.HP_Body_Create();
  HK.HP_Body_SetShape(gb[1], gs[1]);
  HK.HP_Body_SetMotionType(gb[1], HK.MotionType.STATIC);
  HK.HP_Body_SetPosition(gb[1], GROUND.pos);
  HK.HP_Body_SetOrientation(gb[1], IDENTITY_QUATERNION);
  HK.HP_World_AddBody(worldId, gb[1], false);

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

  const ballShape = HK.HP_Shape_CreateSphere([0, 0, 0], BALL_RADIUS)[1];

  // 16x16 balls forming the picture.
  for (let x = 0; x < 16; x++) {
    for (let y = 0; y < 16; y++) {
      const colorKey = dataSet[y * 16 + x];
      const px = -10 + x * BALL_SIZE * 1.5 + Math.random() * 0.1;
      const py = (15 - y) * BALL_SIZE * 1.2 + 2 + Math.random() * 0.1;
      const pz = Math.random() * 0.1;
      addBall(scene, sphereVB, sphereIB, ballInstByKey[colorKey] || ballInstByKey['無'], ballShape, [px, py, pz]);
    }
  }

  const center = [0, 4, 0];
  const orbitDist = 28;
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
