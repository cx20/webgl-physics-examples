// Filament + Havok — Minimum sample.
//
// A textured cube falls onto a ground and settles, simulated by Havok and rendered by Filament.
// Unlike the glTF samples, the cube geometry and its textured (unlit) material are built by hand
// in Filament, using the compiled `texture.filamat` material package + a JPEG texture (mirrors
// cx20's webgl-test Filament textured-cube example). Press W to toggle the collider wireframes.
//
// Because a compiled .filamat is tied to a Filament version, this sample uses the matching `dev`
// Filament build (see index.html), not the pinned v1.70.1 used by the other samples.
//
// Libraries are loaded as globals via <script> tags: Filament, HavokPhysics, gl-matrix.

const FILAMAT_URL = 'https://cx20.github.io/webgl-test/examples/filament/texture/texture.filamat';
const TEXTURE_URL = '../../../../assets/textures/frog.jpg';

const FIXED_TIMESTEP = 1 / 60;
const IDENTITY_QUATERNION = [0, 0, 0, 1];
const GROUND = { size: [4, 0.1, 4], pos: [0, 0, 0] };
const CUBE_SIZE = [1, 1, 1];

const DEBUG_COLOR_DYNAMIC = [1.0, 0.5, 0.2, 1.0]; // orange = cube
const DEBUG_COLOR_STATIC = [0.2, 1.0, 0.4, 1.0];  // green  = ground

// Unit cube geometry (24 verts so each face has its own UVs), from cx20's webgl-test texture cube.
const CUBE_POSITIONS = new Float32Array([
  -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5,        // Front
  -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, -0.5,    // Back
  0.5, 0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5,        // Top
  -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, -0.5, -0.5, -0.5, -0.5, -0.5,    // Bottom
  0.5, -0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5, -0.5, -0.5,        // Right
  -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5, -0.5, -0.5, -0.5, -0.5,    // Left
]);
const CUBE_UVS = new Float32Array([
  0, 0, 1, 0, 1, 1, 0, 1,   // Front
  1, 0, 1, 1, 0, 1, 0, 0,   // Back
  0, 1, 0, 0, 1, 0, 1, 1,   // Top
  1, 1, 0, 1, 0, 0, 1, 0,   // Bottom
  1, 0, 1, 1, 0, 1, 0, 0,   // Right
  0, 0, 1, 0, 1, 1, 0, 1,   // Left
]);
const CUBE_INDICES = new Uint16Array([
  0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 8, 9, 10, 8, 10, 11,
  12, 13, 14, 12, 14, 15, 16, 17, 18, 16, 18, 19, 20, 21, 22, 20, 22, 23,
]);

let HK = null;
let worldId = null;
let groundBodyId = null;
let cubeBodyId = null;

let engine = null;
let cubeEntity = null;

let debugCanvas = null;
let debugGl = null;
let debugProg = null;
let debugVbo = null;
let showWireframe = true;

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

function initPhysics() {
  const w = HK.HP_World_Create();
  checkResult(w[0], 'HP_World_Create');
  worldId = w[1];
  checkResult(HK.HP_World_SetGravity(worldId, [0, -9.81, 0]), 'HP_World_SetGravity');
  checkResult(HK.HP_World_SetIdealStepTime(worldId, FIXED_TIMESTEP), 'HP_World_SetIdealStepTime');

  // Ground (static)
  const gs = HK.HP_Shape_CreateBox([0, 0, 0], IDENTITY_QUATERNION, GROUND.size);
  checkResult(gs[0], 'HP_Shape_CreateBox ground');
  const gb = HK.HP_Body_Create();
  groundBodyId = gb[1];
  HK.HP_Body_SetShape(groundBodyId, gs[1]);
  HK.HP_Body_SetMotionType(groundBodyId, HK.MotionType.STATIC);
  HK.HP_Body_SetPosition(groundBodyId, GROUND.pos);
  HK.HP_Body_SetOrientation(groundBodyId, IDENTITY_QUATERNION);
  HK.HP_World_AddBody(worldId, groundBodyId, false);

  // Cube (dynamic), dropped from above with a slight tilt so it tumbles as it lands.
  const cs = HK.HP_Shape_CreateBox([0, 0, 0], IDENTITY_QUATERNION, CUBE_SIZE);
  checkResult(cs[0], 'HP_Shape_CreateBox cube');
  const cb = HK.HP_Body_Create();
  cubeBodyId = cb[1];
  HK.HP_Body_SetShape(cubeBodyId, cs[1]);
  HK.HP_Body_SetMotionType(cubeBodyId, HK.MotionType.DYNAMIC);
  const mp = HK.HP_Shape_BuildMassProperties(cs[1]);
  HK.HP_Body_SetMassProperties(cubeBodyId, mp[1]);
  HK.HP_Body_SetPosition(cubeBodyId, [0, 2, 0]);
  const angle = Math.PI * 10 / 180;
  const sn = Math.sin(angle / 2), cs2 = Math.cos(angle / 2), inv = 1 / Math.sqrt(2);
  HK.HP_Body_SetOrientation(cubeBodyId, [inv * sn, 0, inv * sn, cs2]);
  HK.HP_World_AddBody(worldId, cubeBodyId, false);
}

// ---- Debug wireframe overlay (separate transparent WebGL2 canvas) ----
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

  function drawBox(size, color, p, r) {
    const model = mat4.fromRotationTranslation(mat4.create(), quat.fromValues(r[0], r[1], r[2], r[3]), vec3.fromValues(p[0], p[1], p[2]));
    gl.uniformMatrix4fv(uMVP, false, mat4.multiply(mat4.create(), vp, model));
    gl.uniform4fv(uColor, color);
    const verts = makeBoxLineVerts(size[0], size[1], size[2]);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW);
    gl.drawArrays(gl.LINES, 0, verts.length / 3);
  }

  drawBox(GROUND.size, DEBUG_COLOR_STATIC, GROUND.pos, IDENTITY_QUATERNION);
  if (cubeBodyId !== null) {
    const pr = HK.HP_Body_GetPosition(cubeBodyId);
    const qr = HK.HP_Body_GetOrientation(cubeBodyId);
    drawBox(CUBE_SIZE, DEBUG_COLOR_DYNAMIC, pr[1], qr[1]);
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
Filament.init([TEXTURE_URL, FILAMAT_URL], () => {
  window.Fov = Filament.Camera$Fov;
  main().catch(e => console.error(e));
});

function buildCube(eng) {
  const VertexAttribute = Filament.VertexAttribute;
  const AttributeType = Filament.VertexBuffer$AttributeType;
  const vb = Filament.VertexBuffer.Builder()
    .vertexCount(24)
    .bufferCount(2)
    .attribute(VertexAttribute.POSITION, 0, AttributeType.FLOAT3, 0, 0)
    .attribute(VertexAttribute.UV0, 1, AttributeType.FLOAT2, 0, 0)
    .build(eng);
  vb.setBufferAt(eng, 0, CUBE_POSITIONS);
  vb.setBufferAt(eng, 1, CUBE_UVS);
  const ib = Filament.IndexBuffer.Builder()
    .indexCount(36)
    .bufferType(Filament.IndexBuffer$IndexType.USHORT)
    .build(eng);
  ib.setBuffer(eng, CUBE_INDICES);

  const material = eng.createMaterial(FILAMAT_URL);
  const matInstance = material.getDefaultInstance();
  const sampler = new Filament.TextureSampler(
    Filament.MinFilter.LINEAR_MIPMAP_LINEAR, Filament.MagFilter.LINEAR, Filament.WrapMode.REPEAT);
  const texture = eng.createTextureFromJpeg(TEXTURE_URL, { nomips: true });
  matInstance.setTextureParameter('texture', texture, sampler);

  const entity = Filament.EntityManager.get().create();
  Filament.RenderableManager.Builder(1)
    .boundingBox({ center: [0, 0, 0], halfExtent: [0.5, 0.5, 0.5] })
    .material(0, matInstance)
    .geometry(0, Filament.RenderableManager$PrimitiveType.TRIANGLES, vb, ib)
    .build(eng, entity);
  return entity;
}

async function main() {
  const canvas = document.getElementsByTagName('canvas')[0];
  engine = Filament.Engine.create(canvas);
  const scene = engine.createScene();

  cubeEntity = buildCube(engine);
  scene.addEntity(cubeEntity);
  const rm = engine.getRenderableManager();
  const rmInst = rm.getInstance(cubeEntity);
  if (rmInst) { rm.setCulling(rmInst, false); rmInst.delete(); } // bbox is at origin; cube moves via transform

  const swapChain = engine.createSwapChain();
  const renderer = engine.createRenderer();
  const camera = engine.createCamera(Filament.EntityManager.get().create());
  const view = engine.createView();
  view.setCamera(camera);
  view.setScene(scene);
  renderer.setClearOptions({ clearColor: [0.13, 0.13, 0.15, 1.0], clear: true });

  initDebugCanvas(canvas);

  HK = await HavokPhysics();
  initPhysics();

  const center = [0, 0.5, 0];
  const orbitDist = 6;
  const orbitHeight = 3;

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

  const tcm = engine.getTransformManager();
  let angle = 0.5;
  function render() {
    requestAnimationFrame(render);

    if (HK && worldId) {
      checkResult(HK.HP_World_Step(worldId, FIXED_TIMESTEP), 'HP_World_Step');
      const pr = HK.HP_Body_GetPosition(cubeBodyId);
      const qr = HK.HP_Body_GetOrientation(cubeBodyId);
      const p = pr[1], q = qr[1];
      const m = mat4.fromRotationTranslation(mat4.create(), quat.fromValues(q[0], q[1], q[2], q[3]), vec3.fromValues(p[0], p[1], p[2]));
      const inst = tcm.getInstance(cubeEntity);
      tcm.setTransform(inst, m);
      inst.delete();
    }

    angle += 0.005;
    const eye = [center[0] + Math.sin(angle) * orbitDist, orbitHeight, center[2] + Math.cos(angle) * orbitDist];
    const up = [0, 1, 0];
    camera.lookAt(eye, center, up);

    renderer.render(swapChain, view);
    drawDebug(eye, center, up, aspect);
  }
  requestAnimationFrame(render);
}
