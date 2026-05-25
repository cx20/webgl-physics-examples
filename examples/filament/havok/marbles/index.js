// Filament + Havok — "Falling Marbles" sample (using glTF, no glTF Physics extension).
//
// Loads the IridescenceMetallicSpheres glTF with Google Filament and drops every sphere into a
// hand-built Havok scene: a ground box and four low walls. Each glTF sphere gets a dynamic Havok
// sphere body; bodies that fall out respawn above the box. A wireframe overlay (toggle with W)
// shows the colliders.
//
// NOTE: this is the iridescence parameter-sweep model (~340 spheres, each with its own
// KHR_materials_iridescence material), so it is GPU-heavy by nature.
//
// Libraries are loaded as globals via <script> tags: Filament, HavokPhysics, gl-matrix
// (vec3 / quat / mat4).

const GLTF_URL = 'https://cx20.github.io/gltf-test/tutorialModels/IridescenceMetallicSpheres/glTF/IridescenceMetallicSpheres.gltf';
const IBL_URL = 'https://cx20.github.io/gltf-test/textures/ktx/papermill/papermill_ibl.ktx';
const SKY_URL = 'https://cx20.github.io/gltf-test/textures/ktx/papermill/papermill_skybox.ktx';

const FIXED_TIMESTEP = 1 / 60;
const RESET_Y_THRESHOLD = -10;
const IDENTITY_QUATERNION = [0, 0, 0, 1];

const DEBUG_COLOR_DYNAMIC = [1.0, 0.5, 0.2, 1.0]; // orange = marbles
const DEBUG_COLOR_STATIC = [0.2, 1.0, 0.4, 1.0];  // green  = ground + walls

const GROUND = { size: [40, 4, 40], pos: [0, -2, 0] };
const WALLS = [
  { size: [10, 10, 1], pos: [0, 5, -5] },
  { size: [10, 10, 1], pos: [0, 5, 5] },
  { size: [1, 10, 10], pos: [-5, 5, 0] },
  { size: [1, 10, 10], pos: [5, 5, 0] },
];

let HK = null;
let worldId = null;

let engine = null;
let asset = null;

const marbles = [];       // { entity, bodyId, nodeScale, parentInvWorldMat, radius }
const staticBoxes = [];   // { size, pos } for the debug overlay

// Debug overlay
let debugCanvas = null;
let debugGl = null;
let debugProg = null;
let debugVbo = null;
let showWireframe = true;
let unitSphereVerts = null;

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

function getRotationFromMat(out, m) {
  const sx = Math.hypot(m[0], m[1], m[2]) || 1;
  const sy = Math.hypot(m[4], m[5], m[6]) || 1;
  const sz = Math.hypot(m[8], m[9], m[10]) || 1;
  const n = [m[0] / sx, m[1] / sx, m[2] / sx, 0, m[4] / sy, m[5] / sy, m[6] / sy, 0, m[8] / sz, m[9] / sz, m[10] / sz, 0, 0, 0, 0, 1];
  return mat4.getRotation(out, n);
}

function buildWorldTransforms(gltfJson) {
  const nodes = gltfJson.nodes || [];
  const worldMats = nodes.map(() => mat4.create());
  const roots = (gltfJson.scenes || [])[gltfJson.scene || 0]?.nodes || [];
  function compute(i, parentMat) {
    const n = nodes[i];
    const local = mat4.create();
    if (n.matrix) {
      mat4.set(local, ...n.matrix);
    } else {
      const t = n.translation || [0, 0, 0], r = n.rotation || [0, 0, 0, 1], s = n.scale || [1, 1, 1];
      mat4.fromRotationTranslationScale(local, quat.fromValues(r[0], r[1], r[2], r[3]), vec3.fromValues(t[0], t[1], t[2]), vec3.fromValues(s[0], s[1], s[2]));
    }
    mat4.multiply(worldMats[i], parentMat, local);
    for (const c of (n.children || [])) compute(c, worldMats[i]);
  }
  for (const r of roots) compute(r, mat4.create());
  return worldMats;
}

function buildNodeEntityMap(gltfJson, filamentAsset, filamentEngine) {
  const all = filamentAsset.getEntities();
  const rootId = filamentAsset.getRoot().getId();
  const candidates = all.filter(e => e.getId() !== rootId);
  const tcm = filamentEngine.getTransformManager();
  const nodes = gltfJson.nodes || [];
  const map = new Map();
  const probes = candidates.map(e => {
    const inst = tcm.getInstance(e);
    const lm = tcm.getTransform(inst);
    inst.delete();
    return { entity: e, t: [lm[12], lm[13], lm[14]] };
  });
  const used = new Set();
  for (let ni = 0; ni < nodes.length; ni++) {
    const t = nodes[ni].translation || [0, 0, 0];
    let best = -1, bestDist = Infinity;
    for (let i = 0; i < probes.length; i++) {
      if (used.has(i)) continue;
      const dx = probes[i].t[0] - t[0], dy = probes[i].t[1] - t[1], dz = probes[i].t[2] - t[2];
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bestDist) { bestDist = d; best = i; }
    }
    if (best >= 0 && bestDist < 0.01) { map.set(ni, probes[best].entity); used.add(best); }
  }
  return map;
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
  staticBoxes.push({ size, pos });
}

function randomDrop() {
  return [(Math.random() - 0.5) * 8, 15 + Math.random() * 20, (Math.random() - 0.5) * 8];
}

// Find the glTF spheres, give each a dynamic Havok sphere body, and link it to its Filament entity.
async function initMarbles(meshUrl, filamentAsset, filamentEngine) {
  const gltfJson = JSON.parse(await (await fetch(meshUrl)).text());
  const nodes = gltfJson.nodes || [];
  const accessors = gltfJson.accessors || [];
  const meshesDef = gltfJson.meshes || [];
  const worldMats = buildWorldTransforms(gltfJson);
  const parentMap = new Map();
  for (let i = 0; i < nodes.length; i++) for (const c of (nodes[i].children || [])) parentMap.set(c, i);
  const nodeEntityMap = buildNodeEntityMap(gltfJson, filamentAsset, filamentEngine);

  // World
  const w = HK.HP_World_Create();
  checkResult(w[0], 'HP_World_Create');
  worldId = w[1];
  checkResult(HK.HP_World_SetGravity(worldId, [0, -10, 0]), 'HP_World_SetGravity');
  checkResult(HK.HP_World_SetIdealStepTime(worldId, FIXED_TIMESTEP), 'HP_World_SetIdealStepTime');

  createStaticBox(GROUND.size, GROUND.pos);
  for (const wd of WALLS) createStaticBox(wd.size, wd.pos);

  function geomRadiusFor(meshIndex) {
    const prim = meshesDef[meshIndex]?.primitives?.[0];
    const acc = prim && accessors[prim.attributes.POSITION];
    if (!acc || !acc.min || !acc.max) return 1;
    let r = 0;
    for (let k = 0; k < 3; k++) r = Math.max(r, Math.abs(acc.min[k]), Math.abs(acc.max[k]));
    return r || 1;
  }

  for (let i = 0; i < nodes.length; i++) {
    const name = nodes[i].name || '';
    if (!name.includes('Sphere') || nodes[i].mesh === undefined) continue;

    const worldScale = vec3.create();
    mat4.getScaling(worldScale, worldMats[i]);
    const radius = Math.max(geomRadiusFor(nodes[i].mesh) * worldScale[0], 0.1);

    const drop = randomDrop();
    const ss = HK.HP_Shape_CreateSphere([0, 0, 0], radius);
    checkResult(ss[0], 'HP_Shape_CreateSphere marble');
    const mp = HK.HP_Shape_BuildMassProperties(ss[1]);
    checkResult(mp[0], 'HP_Shape_BuildMassProperties marble');
    const b = HK.HP_Body_Create();
    checkResult(b[0], 'HP_Body_Create marble');
    const bodyId = b[1];
    HK.HP_Body_SetShape(bodyId, ss[1]);
    HK.HP_Body_SetMotionType(bodyId, HK.MotionType.DYNAMIC);
    HK.HP_Body_SetMassProperties(bodyId, mp[1]);
    HK.HP_Body_SetPosition(bodyId, drop);
    HK.HP_Body_SetOrientation(bodyId, IDENTITY_QUATERNION);
    HK.HP_World_AddBody(worldId, bodyId, false);

    const parentInvWorldMat = mat4.create();
    const pIdx = parentMap.get(i);
    if (pIdx !== undefined) mat4.invert(parentInvWorldMat, worldMats[pIdx]);
    const named = filamentAsset.getEntitiesByName(name);
    const entity = named.length > 0 ? named[0] : (nodeEntityMap.get(i) || null);
    if (entity) {
      const rm = filamentEngine.getRenderableManager();
      const inst = rm.getInstance(entity);
      if (inst) { rm.setCulling(inst, false); inst.delete(); }
    }
    marbles.push({ entity, bodyId, nodeScale: [worldScale[0], worldScale[1], worldScale[2]], parentInvWorldMat, radius, curPos: drop.slice(), curRot: [0, 0, 0, 1] });
  }

  console.log('[Filament+Havok] marbles ready:', marbles.length);
}

// Advance the simulation one fixed step and respawn fallen marbles. No Filament work here, so it
// can be called multiple times per render frame (accumulator) without touching the GPU.
function stepPhysics() {
  checkResult(HK.HP_World_Step(worldId, FIXED_TIMESTEP), 'HP_World_Step');
  for (const m of marbles) {
    const p = HK.HP_Body_GetPosition(m.bodyId)[1];
    if (p[1] < RESET_Y_THRESHOLD) {
      HK.HP_Body_SetPosition(m.bodyId, randomDrop());
      HK.HP_Body_SetLinearVelocity(m.bodyId, [0, 0, 0]);
      HK.HP_Body_SetAngularVelocity(m.bodyId, [0, 0, 0]);
    }
  }
}

// Read each body's transform once, cache it (reused by the debug overlay), and push it to Filament.
function syncTransforms() {
  const tcm = engine.getTransformManager();
  tcm.openLocalTransformTransaction();
  for (const m of marbles) {
    const p = HK.HP_Body_GetPosition(m.bodyId)[1];
    const r = HK.HP_Body_GetOrientation(m.bodyId)[1];
    m.curPos[0] = p[0]; m.curPos[1] = p[1]; m.curPos[2] = p[2];
    m.curRot[0] = r[0]; m.curRot[1] = r[1]; m.curRot[2] = r[2]; m.curRot[3] = r[3];
    if (!m.entity) continue;
    const physWorld = mat4.fromRotationTranslationScale(
      mat4.create(),
      quat.fromValues(r[0], r[1], r[2], r[3]),
      vec3.fromValues(p[0], p[1], p[2]),
      vec3.fromValues(m.nodeScale[0], m.nodeScale[1], m.nodeScale[2]),
    );
    const localMat = mat4.multiply(mat4.create(), m.parentInvWorldMat, physWorld);
    const inst = tcm.getInstance(m.entity);
    tcm.setTransform(inst, localMat);
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
  unitSphereVerts = makeSphereLineVerts(1); // shared; scaled per marble via the model matrix
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

  // Static boxes (ground + walls).
  gl.uniform4fv(uColor, DEBUG_COLOR_STATIC);
  for (const b of staticBoxes) {
    const model = mat4.fromTranslation(mat4.create(), vec3.fromValues(b.pos[0], b.pos[1], b.pos[2]));
    gl.uniformMatrix4fv(uMVP, false, mat4.multiply(mat4.create(), vp, model));
    const verts = makeBoxLineVerts(b.size[0], b.size[1], b.size[2]);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW);
    gl.drawArrays(gl.LINES, 0, verts.length / 3);
  }

  // Marbles: one shared unit-sphere buffer, scaled + placed per body (cached transform).
  gl.uniform4fv(uColor, DEBUG_COLOR_DYNAMIC);
  gl.bufferData(gl.ARRAY_BUFFER, unitSphereVerts, gl.DYNAMIC_DRAW);
  const count = unitSphereVerts.length / 3;
  const model = mat4.create(), mvp = mat4.create(), sq = quat.create(), sp = vec3.create(), ss = vec3.create();
  for (const m of marbles) {
    quat.set(sq, m.curRot[0], m.curRot[1], m.curRot[2], m.curRot[3]);
    vec3.set(sp, m.curPos[0], m.curPos[1], m.curPos[2]);
    vec3.set(ss, m.radius, m.radius, m.radius);
    mat4.fromRotationTranslationScale(model, sq, sp, ss);
    mat4.multiply(mvp, vp, model);
    gl.uniformMatrix4fv(uMVP, false, mvp);
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
  view.setColorGrading(Filament.ColorGrading.Builder().toneMapping(ToneMapping.LINEAR).build(engine));
  renderer.setClearOptions({ clearColor: [0.13, 0.13, 0.13, 1.0], clear: true });

  initDebugCanvas(canvas);

  // Load the marbles model (.gltf with an external .bin, resolved against its folder).
  const bytes = new Uint8Array(await (await fetch(GLTF_URL)).arrayBuffer());
  const basePath = GLTF_URL.substring(0, GLTF_URL.lastIndexOf('/') + 1);
  const assetLoader = engine.createAssetLoader();
  asset = assetLoader.createAsset(bytes);
  await new Promise((resolve) => {
    asset.loadResources(() => {
      assetLoader.delete();
      const rm = engine.getRenderableManager();
      for (const e of asset.getEntities()) {
        const inst = rm.getInstance(e);
        if (inst) { rm.setCastShadows(inst, true); inst.delete(); }
      }
      resolve();
    }, () => {}, basePath);
  });

  HK = await HavokPhysics();
  await initMarbles(GLTF_URL, asset, engine);

  // Only the marble spheres are shown; the model's annotation meshes (the "Thin Film Thickness"
  // scale bar, axis line, and backing planes) are kept out of the scene.
  const marbleIds = new Set();
  for (const m of marbles) if (m.entity) marbleIds.add(m.entity.getId());

  // Camera: auto-orbit around the walled box the marbles fall into.
  const center = [0, 3, 0];
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
    camera.setProjectionFov(75, aspect, 0.1, 2000.0, fovAxis);
  }
  window.addEventListener('resize', resize);
  resize();

  setWireframeVisible(showWireframe);

  let angle = 0.4;
  let lastTime = performance.now();
  let accumulator = 0;
  function render() {
    requestAnimationFrame(render);

    if (asset) {
      let e = asset.popRenderable();
      while (e.getId() !== 0) {
        if (marbleIds.has(e.getId())) scene.addEntity(e); // skip non-marble (annotation) meshes
        e = asset.popRenderable();
      }
    }

    // Fixed-timestep physics decoupled from the render rate: step to catch up to wall-clock time
    // (capped) so the simulation runs at real speed even when the GPU-heavy render dips below 60fps.
    if (HK && worldId) {
      try {
        const now = performance.now();
        let dt = (now - lastTime) / 1000;
        lastTime = now;
        if (dt > 0.25) dt = 0.25;
        accumulator += dt;
        let steps = 0;
        while (accumulator >= FIXED_TIMESTEP && steps < 5) {
          stepPhysics();
          accumulator -= FIXED_TIMESTEP;
          steps++;
        }
        if (accumulator > FIXED_TIMESTEP) accumulator = 0; // drop backlog when we hit the cap
        syncTransforms();
      } catch (e) { console.error('[physics] step error:', e); HK = null; }
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
