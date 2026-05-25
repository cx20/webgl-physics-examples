// Filament + Havok — "Falling glTF" sample (no glTF Physics extension).
//
// Loads the classic Duck glTF with Google Filament and drives it with a hand-built Havok scene:
// a static ground box and a dynamic box collider sized to the duck. The duck tumbles as it falls;
// click anywhere to bounce it back up. A wireframe overlay (toggle with W) shows the colliders.
//
// Libraries are loaded as globals via <script> tags: Filament, HavokPhysics, gl-matrix
// (vec3 / quat / mat4).

const DUCK_URL = 'https://rawcdn.githack.com/cx20/gltf-test/5465cc37/sampleModels/Duck/glTF/Duck.gltf';
const IBL_URL = 'https://cx20.github.io/gltf-test/textures/ktx/papermill/papermill_ibl.ktx';
const SKY_URL = 'https://cx20.github.io/gltf-test/textures/ktx/papermill/papermill_skybox.ktx';

const FIXED_TIMESTEP = 1 / 60;
const IDENTITY_QUATERNION = [0, 0, 0, 1];

// Duck collider half-ish extents (matches the other renderers' Falling glTF samples).
const cubeSizeX = 5;
const cubeSizeY = 5;
const cubeSizeZ = 9 / 16 * 5;
const DUCK_SCALE = 5;
const GROUND_SIZE = [800, 8, 800];
const GROUND_POS = [0, -5, 0];

const DEBUG_COLOR_DYNAMIC = [1.0, 0.5, 0.2, 1.0]; // orange = duck collider
const DEBUG_COLOR_STATIC = [0.2, 1.0, 0.4, 1.0];  // green  = ground

let HK = null;
let worldId = null;
let duckBodyId = null;

let engine = null;
let asset = null;

// Debug overlay
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

function createStaticBox(size, pos) {
  const s = HK.HP_Shape_CreateBox([0, 0, 0], IDENTITY_QUATERNION, size);
  checkResult(s[0], 'HP_Shape_CreateBox static');
  const b = HK.HP_Body_Create();
  checkResult(b[0], 'HP_Body_Create static');
  const bodyId = b[1];
  HK.HP_Body_SetShape(bodyId, s[1]);
  HK.HP_Body_SetMotionType(bodyId, HK.MotionType.STATIC);
  HK.HP_Body_SetPosition(bodyId, pos);
  HK.HP_Body_SetOrientation(bodyId, IDENTITY_QUATERNION);
  HK.HP_World_AddBody(worldId, bodyId, false);
  return bodyId;
}

function initPhysics() {
  const w = HK.HP_World_Create();
  checkResult(w[0], 'HP_World_Create');
  worldId = w[1];
  checkResult(HK.HP_World_SetGravity(worldId, [0, -9.8, 0]), 'HP_World_SetGravity');
  checkResult(HK.HP_World_SetIdealStepTime(worldId, FIXED_TIMESTEP), 'HP_World_SetIdealStepTime');

  createStaticBox(GROUND_SIZE, GROUND_POS);

  // Duck: dynamic box collider matching the duck's bounding box.
  const size = [cubeSizeX * 2, cubeSizeY * 2, cubeSizeZ * 2];
  const ds = HK.HP_Shape_CreateBox([0, 0, 0], IDENTITY_QUATERNION, size);
  checkResult(ds[0], 'HP_Shape_CreateBox duck');
  const db = HK.HP_Body_Create();
  checkResult(db[0], 'HP_Body_Create duck');
  duckBodyId = db[1];
  HK.HP_Body_SetShape(duckBodyId, ds[1]);
  HK.HP_Body_SetMotionType(duckBodyId, HK.MotionType.DYNAMIC);
  const mp = HK.HP_Shape_BuildMassProperties(ds[1]);
  checkResult(mp[0], 'HP_Shape_BuildMassProperties duck');
  HK.HP_Body_SetMassProperties(duckBodyId, mp[1]);
  HK.HP_Body_SetPosition(duckBodyId, [0, 20, 0]);
  HK.HP_Body_SetOrientation(duckBodyId, IDENTITY_QUATERNION);
  HK.HP_Body_SetAngularVelocity(duckBodyId, [0, 0, 3.5]);
  HK.HP_World_AddBody(worldId, duckBodyId, false);
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
    const mvp = mat4.multiply(mat4.create(), vp, model);
    gl.uniformMatrix4fv(uMVP, false, mvp);
    gl.uniform4fv(uColor, color);
    const verts = makeBoxLineVerts(size[0], size[1], size[2]);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW);
    gl.drawArrays(gl.LINES, 0, verts.length / 3);
  }

  drawBox(GROUND_SIZE, DEBUG_COLOR_STATIC, GROUND_POS, IDENTITY_QUATERNION);
  if (duckBodyId !== null) {
    const pr = HK.HP_Body_GetPosition(duckBodyId);
    const qr = HK.HP_Body_GetOrientation(duckBodyId);
    drawBox([cubeSizeX * 2, cubeSizeY * 2, cubeSizeZ * 2], DEBUG_COLOR_DYNAMIC, pr[1], qr[1]);
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

document.addEventListener('click', () => {
  if (duckBodyId !== null && HK && worldId) {
    HK.HP_Body_SetLinearVelocity(duckBodyId, [0, 5, 0]);
  }
});

// ---- Filament app ----
Filament.init([IBL_URL, SKY_URL], () => {
  window.gltfio = Filament.gltfio;
  window.Fov = Filament.Camera$Fov;
  window.LightType = Filament.LightManager$Type;
  window.ToneMapping = Filament.ColorGrading$ToneMapping;
  main().catch(e => console.error(e));
});

async function main() {
  const canvas = document.getElementsByTagName('canvas')[0];
  engine = Filament.Engine.create(canvas);
  const scene = engine.createScene();

  const ibl = engine.createIblFromKtx1(IBL_URL);
  ibl.setIntensity(50000);
  scene.setIndirectLight(ibl);
  scene.setSkybox(engine.createSkyFromKtx1(SKY_URL));

  const sun = Filament.EntityManager.get().create();
  Filament.LightManager.Builder(LightType.SUN)
    .color([0.98, 0.92, 0.89])
    .intensity(50000.0)
    .direction([0.6, -1.0, -0.8])
    .sunAngularRadius(1.9)
    .sunHaloSize(10.0)
    .sunHaloFalloff(80.0)
    .build(engine, sun);
  scene.addEntity(sun);

  const swapChain = engine.createSwapChain();
  const renderer = engine.createRenderer();
  const camera = engine.createCamera(Filament.EntityManager.get().create());
  camera.setExposure(16.0, 1.0 / 125.0, 100.0);
  const view = engine.createView();
  view.setCamera(camera);
  view.setScene(scene);
  // Explicit LINEAR color grading; the default path trips "uniform buffer too small" at FL1.
  view.setColorGrading(Filament.ColorGrading.Builder().toneMapping(ToneMapping.LINEAR).build(engine));
  renderer.setClearOptions({ clearColor: [0.6, 0.6, 0.6, 1.0], clear: true });

  initDebugCanvas(canvas);

  // Load the Duck (.gltf with external .bin + texture, resolved against its folder).
  const bytes = new Uint8Array(await (await fetch(DUCK_URL)).arrayBuffer());
  const basePath = DUCK_URL.substring(0, DUCK_URL.lastIndexOf('/') + 1);
  const assetLoader = engine.createAssetLoader();
  asset = assetLoader.createAsset(bytes);
  await new Promise((resolve) => {
    asset.loadResources(() => {
      assetLoader.delete();
      const rm = engine.getRenderableManager();
      for (const e of asset.getEntities()) {
        const inst = rm.getInstance(e);
        if (inst) { rm.setCastShadows(inst, true); rm.setCulling(inst, false); inst.delete(); }
      }
      resolve();
    }, () => {}, basePath);
  });

  HK = await HavokPhysics();
  initPhysics();

  // Camera: auto-orbit framing the duck's fall onto the ground.
  const center = [0, 4, 0];
  const orbitDist = 26;
  const orbitHeight = 12;

  let aspect = 1;
  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.width = Math.floor(window.innerWidth * dpr);
    const height = canvas.height = Math.floor(window.innerHeight * dpr);
    if (debugCanvas) { debugCanvas.width = width; debugCanvas.height = height; }
    aspect = width / height;
    view.setViewport([0, 0, width, height]);
    const fovAxis = aspect < 1 ? Fov.HORIZONTAL : Fov.VERTICAL;
    camera.setProjectionFov(75, aspect, 0.1, 5000.0, fovAxis);
  }
  window.addEventListener('resize', resize);
  resize();

  setWireframeVisible(showWireframe);

  const root = asset.getRoot();
  const tcm = engine.getTransformManager();
  const offsetLocal = vec3.fromValues(0, -cubeSizeY, 0); // re-center the duck on the collider box

  let angle = 0.4;
  function render() {
    requestAnimationFrame(render);

    if (asset) {
      let e = asset.popRenderable();
      while (e.getId() !== 0) { scene.addEntity(e); e = asset.popRenderable(); }
    }

    if (HK && worldId) {
      checkResult(HK.HP_World_Step(worldId, FIXED_TIMESTEP), 'HP_World_Step');
      const pr = HK.HP_Body_GetPosition(duckBodyId);
      const qr = HK.HP_Body_GetOrientation(duckBodyId);
      const p = pr[1], q = qr[1];
      // Duck visual = body transform, scaled, shifted down so it sits centered in the collider.
      const rot = quat.fromValues(q[0], q[1], q[2], q[3]);
      const off = vec3.transformQuat(vec3.create(), offsetLocal, rot);
      const m = mat4.fromRotationTranslationScale(
        mat4.create(), rot,
        vec3.fromValues(p[0] + off[0], p[1] + off[1], p[2] + off[2]),
        vec3.fromValues(DUCK_SCALE, DUCK_SCALE, DUCK_SCALE),
      );
      const inst = tcm.getInstance(root);
      tcm.setTransform(inst, m);
      inst.delete();
    }

    angle += 0.0035;
    const eye = [center[0] + Math.sin(angle) * orbitDist, orbitHeight, center[2] + Math.cos(angle) * orbitDist];
    const up = [0, 1, 0];
    camera.lookAt(eye, center, up);

    renderer.render(swapChain, view);
    drawDebug(eye, center, up, aspect);
  }
  requestAnimationFrame(render);
}
