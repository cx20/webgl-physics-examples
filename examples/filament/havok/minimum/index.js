// Filament + Havok — Minimum sample (PBR).
//
// A textured cube falls onto a ground and settles, simulated by Havok and rendered by Filament with
// a lit, physically-based material. There is no lit .filamat we can load, so the scene is emitted
// as an in-code glTF (GLB): a single cube mesh (the JPEG as baseColorTexture, with hand-authored
// flat per-face normals so the lighting reads correctly) loaded through Filament's gltfio. The
// papermill IBL and a directional sun light the scene, so the cube is shaded instead of looking
// flat. The cube node is matched to its Havok box body and synced every frame.
//
// Collider wireframes are drawn on a separate transparent WebGL2 canvas overlaid with the same
// camera (Filament can't easily draw lines); the ground is shown only as a wireframe. Press W to
// toggle them.
//
// Libraries are loaded as globals via <script> tags: Filament, HavokPhysics, gl-matrix
// (vec3 / quat / mat4).

const IBL_URL = 'https://cx20.github.io/gltf-test/textures/ktx/papermill/papermill_ibl.ktx';
const TEXTURE_URL = '../../../../assets/textures/frog.jpg';

const FIXED_TIMESTEP = 1 / 60;
const IDENTITY_QUATERNION = [0, 0, 0, 1];
const GROUND = { size: [4, 0.1, 4], pos: [0, 0, 0] };
const CUBE_SIZE = [1, 1, 1];
const CUBE_ROUGHNESS = 0.7;

const DEBUG_COLOR_DYNAMIC = [1.0, 0.5, 0.2, 1.0]; // orange = cube
const DEBUG_COLOR_STATIC = [0.2, 1.0, 0.4, 1.0];  // green  = ground

// Unit cube geometry (24 verts so each face has its own UVs + flat normal).
const CUBE_POSITIONS = new Float32Array([
  -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5,        // Front  (+Z)
  -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, -0.5,    // Back   (-Z)
  0.5, 0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5,        // Top    (+Y)
  -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, -0.5, -0.5, -0.5, -0.5, -0.5,    // Bottom (-Y)
  0.5, -0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5, -0.5, -0.5,        // Right  (+X)
  -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5, -0.5, -0.5, -0.5, -0.5,    // Left   (-X)
]);
const CUBE_NORMALS = new Float32Array([
  0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1,        // Front
  0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1,    // Back
  0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0,        // Top
  0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0,    // Bottom
  1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0,        // Right
  -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0,    // Left
]);
const CUBE_UVS = new Float32Array([
  0, 0, 1, 0, 1, 1, 0, 1,   // Front
  1, 0, 1, 1, 0, 1, 0, 0,   // Back
  0, 1, 0, 0, 1, 0, 1, 1,   // Top
  1, 1, 0, 1, 0, 0, 1, 0,   // Bottom
  1, 0, 1, 1, 0, 1, 0, 0,   // Right
  0, 0, 1, 0, 1, 1, 0, 1,   // Left
]);
const CUBE_INDICES = new Uint32Array([
  0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 8, 9, 10, 8, 10, 11,
  12, 13, 14, 12, 14, 15, 16, 17, 18, 16, 18, 19, 20, 21, 22, 20, 22, 23,
]);

let HK = null;
let worldId = null;
let groundBodyId = null;
let cubeBodyId = null;

let engine = null;
let asset = null;
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

// ---- In-code GLB assembly (one textured cube node) ----
function alignTo4(n) { return (n + 3) & ~3; }

function buildCubeGlb(textureBytes) {
  const accessors = [];
  const bufferViews = [];
  const binChunks = [];
  let binOffset = 0;

  function addBufferView(typedArray, target) {
    const padded = alignTo4(binOffset);
    if (padded > binOffset) { binChunks.push(new Uint8Array(padded - binOffset)); binOffset = padded; }
    const bytes = new Uint8Array(typedArray.buffer, typedArray.byteOffset, typedArray.byteLength);
    const index = bufferViews.length;
    const bv = { buffer: 0, byteOffset: binOffset, byteLength: bytes.byteLength };
    if (target !== undefined) bv.target = target;
    bufferViews.push(bv);
    binChunks.push(bytes);
    binOffset += bytes.byteLength;
    return index;
  }

  const posBV = addBufferView(CUBE_POSITIONS, 34962);
  accessors.push({ bufferView: posBV, componentType: 5126, count: 24, type: 'VEC3', min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] });
  const nrmBV = addBufferView(CUBE_NORMALS, 34962);
  accessors.push({ bufferView: nrmBV, componentType: 5126, count: 24, type: 'VEC3' });
  const uvBV = addBufferView(CUBE_UVS, 34962);
  accessors.push({ bufferView: uvBV, componentType: 5126, count: 24, type: 'VEC2' });
  const idxBV = addBufferView(CUBE_INDICES, 34963);
  accessors.push({ bufferView: idxBV, componentType: 5125, count: 36, type: 'SCALAR' });
  const imgBV = addBufferView(textureBytes, undefined);

  const gltf = {
    asset: { version: '2.0', generator: 'filament-havok-minimum' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: 'cube', mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3, material: 0 }] }],
    materials: [{
      name: 'cube',
      pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0.0, roughnessFactor: CUBE_ROUGHNESS },
    }],
    images: [{ bufferView: imgBV, mimeType: 'image/jpeg' }],
    samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }],
    textures: [{ sampler: 0, source: 0 }],
    accessors, bufferViews,
    buffers: [{ byteLength: binOffset }],
  };

  let jsonBytes = new TextEncoder().encode(JSON.stringify(gltf));
  const jsonPad = alignTo4(jsonBytes.length) - jsonBytes.length;
  if (jsonPad) {
    const t = new Uint8Array(jsonBytes.length + jsonPad);
    t.set(jsonBytes); t.fill(0x20, jsonBytes.length);
    jsonBytes = t;
  }

  const binBuf = new Uint8Array(alignTo4(binOffset));
  let o = 0;
  for (const ch of binChunks) { binBuf.set(ch, o); o += ch.byteLength; }

  const totalLen = 12 + 8 + jsonBytes.length + 8 + binBuf.length;
  const glb = new Uint8Array(totalLen);
  const dv = new DataView(glb.buffer);
  let p = 0;
  dv.setUint32(p, 0x46546C67, true); p += 4; // 'glTF'
  dv.setUint32(p, 2, true); p += 4;
  dv.setUint32(p, totalLen, true); p += 4;
  dv.setUint32(p, jsonBytes.length, true); p += 4;
  dv.setUint32(p, 0x4E4F534A, true); p += 4; // 'JSON'
  glb.set(jsonBytes, p); p += jsonBytes.length;
  dv.setUint32(p, binBuf.length, true); p += 4;
  dv.setUint32(p, 0x004E4942, true); p += 4; // 'BIN\0'
  glb.set(binBuf, p);
  return glb;
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

async function fetchBytes(url) {
  return new Uint8Array(await (await fetch(url)).arrayBuffer());
}

// ---- Filament app ----
Filament.init([IBL_URL], () => {
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

  // IBL for lighting + reflections; no skybox, so the background stays the dark clear colour.
  const ibl = engine.createIblFromKtx1(IBL_URL);
  ibl.setIntensity(50000);
  scene.setIndirectLight(ibl);

  const sun = Filament.EntityManager.get().create();
  Filament.LightManager.Builder(LightType.SUN)
    .color([0.98, 0.92, 0.89])
    .intensity(50000.0)
    .direction([0.5, -1.0, -0.6])
    .castShadows(true)
    .build(engine, sun);
  scene.addEntity(sun);

  const swapChain = engine.createSwapChain();
  const renderer = engine.createRenderer();
  const camera = engine.createCamera(Filament.EntityManager.get().create());
  camera.setExposure(16.0, 1.0 / 125.0, 100.0);
  const view = engine.createView();
  view.setCamera(camera);
  view.setScene(scene);
  // Explicit LINEAR color grading; the default path trips a "uniform buffer too small" GL error
  // at feature level 1.
  const colorGrading = Filament.ColorGrading.Builder().toneMapping(ToneMapping.LINEAR).build(engine);
  view.setColorGrading(colorGrading);
  renderer.setClearOptions({ clearColor: [0.13, 0.13, 0.15, 1.0], clear: true });

  initDebugCanvas(canvas);

  HK = await HavokPhysics();
  initPhysics();

  // Build & load the cube GLB (the texture is embedded so gltfio resolves no external URIs).
  const textureBytes = await fetchBytes(TEXTURE_URL);
  const glb = buildCubeGlb(textureBytes);
  const assetLoader = engine.createAssetLoader();
  asset = assetLoader.createAsset(glb);
  await new Promise((resolve) => {
    asset.loadResources(() => {
      assetLoader.delete();
      const rm = engine.getRenderableManager();
      for (const e of asset.getEntities()) {
        const inst = rm.getInstance(e);
        if (inst) { rm.setCastShadows(inst, true); rm.setReceiveShadows(inst, true); inst.delete(); }
      }
      resolve();
    }, () => {}, '');
  });
  const named = asset.getEntitiesByName('cube');
  cubeEntity = named.length > 0 ? named[0] : null;
  if (cubeEntity) {
    const rm = engine.getRenderableManager();
    const inst = rm.getInstance(cubeEntity);
    if (inst) { rm.setCulling(inst, false); inst.delete(); }
  } else {
    console.warn('[Filament+Havok] cube entity not found');
  }

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

    if (asset) {
      let e = asset.popRenderable();
      while (e.getId() !== 0) { scene.addEntity(e); e = asset.popRenderable(); }
    }

    if (HK && worldId) {
      checkResult(HK.HP_World_Step(worldId, FIXED_TIMESTEP), 'HP_World_Step');
      if (cubeEntity) {
        const pr = HK.HP_Body_GetPosition(cubeBodyId);
        const qr = HK.HP_Body_GetOrientation(cubeBodyId);
        const p = pr[1], q = qr[1];
        const m = mat4.fromRotationTranslation(mat4.create(), quat.fromValues(q[0], q[1], q[2], q[3]), vec3.fromValues(p[0], p[1], p[2]));
        const inst = tcm.getInstance(cubeEntity);
        tcm.setTransform(inst, m);
        inst.delete();
      }
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
