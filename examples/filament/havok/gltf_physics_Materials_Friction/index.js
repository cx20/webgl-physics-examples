// Filament + Havok — glTF Physics "Materials_Friction" sample.
//
// Renders the Khronos glTF_Physics "Materials_Friction" model with Google Filament and
// simulates it with Havok, driven by the KHR_physics_rigid_bodies / KHR_implicit_shapes
// extensions embedded in the GLB (box colliders with per-collider friction materials).
//
// Filament cannot easily draw line wireframes, so the collider debug view is rendered on a
// separate transparent WebGL2 canvas overlaid on top, using the same camera. Press W to toggle it.
//
// Libraries are loaded as globals via <script> tags: Filament, HavokPhysics, and gl-matrix
// (vec3 / quat / mat4).

const MODEL_URL = 'https://raw.githubusercontent.com/eoineoineoin/glTF_Physics/master/samples/Materials_Friction/Materials_Friction.glb';
const IBL_URL = 'https://cx20.github.io/gltf-test/textures/ktx/papermill/papermill_ibl.ktx';
const SKY_URL = 'https://cx20.github.io/gltf-test/textures/ktx/papermill/papermill_skybox.ktx';

const FIXED_TIMESTEP = 1 / 60;
const RESET_Y_THRESHOLD = -20;
const IDENTITY_QUATERNION = [0, 0, 0, 1];

const DEBUG_COLOR_DYNAMIC = [1.0, 0.5, 0.2, 1.0]; // orange = moving bodies
const DEBUG_COLOR_STATIC = [0.2, 1.0, 0.4, 1.0];  // green  = static bodies

let HK = null;
let worldId = null;

// Filament objects
let engine = null;
let asset = null;

// Physics <-> Filament bookkeeping
const physicsNodes = [];   // dynamic bodies: { entity, bodyId, nodeScale, initPos, initRot, parentInvWorldMat, size }
const staticBodies = [];   // static bodies:  { bodyId, size }

// Camera framing (computed from collider bounds)
const sceneMin = [Infinity, Infinity, Infinity];
const sceneMax = [-Infinity, -Infinity, -Infinity];

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

function applyPhysicsMaterial(shapeId, materialDef) {
  if (!materialDef || typeof HK.HP_Shape_SetMaterial !== 'function') return;
  const dynamicFriction = materialDef.dynamicFriction !== undefined ? materialDef.dynamicFriction : 0.5;
  const staticFriction = materialDef.staticFriction !== undefined ? materialDef.staticFriction : 0.5;
  const restitution = materialDef.restitution !== undefined ? materialDef.restitution : 0.0;
  HK.HP_Shape_SetMaterial(shapeId, [
    dynamicFriction,
    staticFriction,
    restitution,
    HK.MaterialCombine.MAXIMUM,
    HK.MaterialCombine.MINIMUM,
  ]);
}

// Extract a rotation quaternion from a matrix that may carry non-uniform scale: gl-matrix's
// mat4.getRotation is wrong unless each basis column is normalized first.
function getRotationFromMat(out, m) {
  const sx = Math.hypot(m[0], m[1], m[2]) || 1;
  const sy = Math.hypot(m[4], m[5], m[6]) || 1;
  const sz = Math.hypot(m[8], m[9], m[10]) || 1;
  const n = [
    m[0] / sx, m[1] / sx, m[2] / sx, 0,
    m[4] / sy, m[5] / sy, m[6] / sy, 0,
    m[8] / sz, m[9] / sz, m[10] / sz, 0,
    0, 0, 0, 1,
  ];
  return mat4.getRotation(out, n);
}

// World transforms (column-major mat4) for every glTF node, indexed by node index.
function buildWorldTransforms(gltfJson) {
  const nodes = gltfJson.nodes || [];
  const worldMats = nodes.map(() => mat4.create());
  const scenes = gltfJson.scenes || [];
  const roots = scenes[gltfJson.scene || 0]?.nodes || [];
  function computeNode(i, parentMat) {
    const n = nodes[i];
    const local = mat4.create();
    if (n.matrix) {
      mat4.set(local, ...n.matrix);
    } else {
      const t = n.translation || [0, 0, 0];
      const r = n.rotation || [0, 0, 0, 1];
      const s = n.scale || [1, 1, 1];
      mat4.fromRotationTranslationScale(local,
        quat.fromValues(r[0], r[1], r[2], r[3]),
        vec3.fromValues(t[0], t[1], t[2]),
        vec3.fromValues(s[0], s[1], s[2]));
    }
    mat4.multiply(worldMats[i], parentMat, local);
    for (const c of (n.children || [])) computeNode(c, worldMats[i]);
  }
  for (const r of roots) computeNode(r, mat4.create());
  return worldMats;
}

// Map glTF node index -> Filament entity. Filament's getEntities() does not preserve glTF node
// order (AssetLoader partitions renderables first), so match by initial local translation.
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
    if (best >= 0 && bestDist < 0.01) {
      map.set(ni, probes[best].entity);
      used.add(best);
    }
  }
  return map;
}

function createBoxShape(boxDef, worldScale, motionDef, materialDef) {
  const bs = boxDef.size || [1, 1, 1];
  // HP_Shape_CreateBox takes full extents (not half-extents).
  const size = [
    Math.abs(bs[0] * worldScale[0]),
    Math.abs(bs[1] * worldScale[1]),
    Math.abs(bs[2] * worldScale[2]),
  ];
  const created = HK.HP_Shape_CreateBox([0, 0, 0], IDENTITY_QUATERNION, size);
  checkResult(created[0], 'HP_Shape_CreateBox');
  const shapeId = created[1];
  if (motionDef) {
    const volume = Math.max(size[0] * size[1] * size[2], 0.0001);
    const density = motionDef.mass !== undefined ? motionDef.mass / volume : 1;
    checkResult(HK.HP_Shape_SetDensity(shapeId, density), 'HP_Shape_SetDensity');
  }
  applyPhysicsMaterial(shapeId, materialDef);
  return { shapeId, size };
}

function createBody(shapeId, motionType, position, rotation, setMass) {
  const created = HK.HP_Body_Create();
  checkResult(created[0], 'HP_Body_Create');
  const bodyId = created[1];
  checkResult(HK.HP_Body_SetShape(bodyId, shapeId), 'HP_Body_SetShape');
  checkResult(HK.HP_Body_SetMotionType(bodyId, motionType), 'HP_Body_SetMotionType');
  if (setMass) {
    const mass = HK.HP_Shape_BuildMassProperties(shapeId);
    checkResult(mass[0], 'HP_Shape_BuildMassProperties');
    checkResult(HK.HP_Body_SetMassProperties(bodyId, mass[1]), 'HP_Body_SetMassProperties');
  }
  checkResult(HK.HP_Body_SetPosition(bodyId, position), 'HP_Body_SetPosition');
  checkResult(HK.HP_Body_SetOrientation(bodyId, rotation), 'HP_Body_SetOrientation');
  checkResult(HK.HP_World_AddBody(worldId, bodyId, false), 'HP_World_AddBody');
  return bodyId;
}

function expandSceneBounds(pos, size) {
  // Rotation-safe loose bound: the box never extends past pos +/- half its diagonal.
  const r = 0.5 * Math.hypot(size[0], size[1], size[2]);
  for (let k = 0; k < 3; k++) {
    sceneMin[k] = Math.min(sceneMin[k], pos[k] - r);
    sceneMax[k] = Math.max(sceneMax[k], pos[k] + r);
  }
}

// Parse the GLB's physics extensions and build the Havok world. Materials_Friction uses only
// KHR_implicit_shapes box colliders, so this handles single box shapes (static + dynamic).
async function initPhysicsFromUrl(meshUrl, filamentAsset, filamentEngine) {
  const ab = await (await fetch(meshUrl)).arrayBuffer();
  const head = new Uint8Array(ab, 0, 4);
  const isGlb = head[0] === 0x67 && head[1] === 0x6c && head[2] === 0x54 && head[3] === 0x46;
  let gltfJson;
  if (isGlb) {
    const dv = new DataView(ab);
    const jsonLen = dv.getUint32(12, true);
    gltfJson = JSON.parse(new TextDecoder().decode(new Uint8Array(ab, 20, jsonLen)));
  } else {
    gltfJson = JSON.parse(new TextDecoder().decode(new Uint8Array(ab)));
  }

  const ext = gltfJson.extensions || {};
  const shapeDefs = ext.KHR_implicit_shapes?.shapes || [];
  const matDefs = ext.KHR_physics_rigid_bodies?.physicsMaterials || [];
  const nodes = gltfJson.nodes || [];
  const worldMats = buildWorldTransforms(gltfJson);

  const parentMap = new Map();
  for (let i = 0; i < nodes.length; i++) {
    for (const c of (nodes[i].children || [])) parentMap.set(c, i);
  }

  const nodeEntityMap = buildNodeEntityMap(gltfJson, filamentAsset, filamentEngine);

  const created = HK.HP_World_Create();
  checkResult(created[0], 'HP_World_Create');
  worldId = created[1];
  checkResult(HK.HP_World_SetGravity(worldId, [0, -9.8, 0]), 'HP_World_SetGravity');
  checkResult(HK.HP_World_SetIdealStepTime(worldId, FIXED_TIMESTEP), 'HP_World_SetIdealStepTime');

  for (let i = 0; i < nodes.length; i++) {
    const physExt = nodes[i].extensions?.KHR_physics_rigid_bodies;
    const geom = physExt?.collider?.geometry;
    if (geom?.shape === undefined) continue;
    const shapeDef = shapeDefs[geom.shape];
    if (!shapeDef || !shapeDef.box) continue; // this sample is box-only

    const motionDef = physExt.motion || null;
    const matDef = physExt.collider.physicsMaterial !== undefined ? matDefs[physExt.collider.physicsMaterial] : null;

    const worldScale = vec3.create();
    mat4.getScaling(worldScale, worldMats[i]);
    const shape = createBoxShape(shapeDef.box, worldScale, motionDef, matDef);

    const wPos = vec3.create(); mat4.getTranslation(wPos, worldMats[i]);
    const wRot = quat.create(); getRotationFromMat(wRot, worldMats[i]);
    const initPos = [wPos[0], wPos[1], wPos[2]];
    const initRot = [wRot[0], wRot[1], wRot[2], wRot[3]];

    const bodyId = createBody(
      shape.shapeId,
      motionDef ? HK.MotionType.DYNAMIC : HK.MotionType.STATIC,
      initPos, initRot, !!motionDef,
    );
    expandSceneBounds(initPos, shape.size);

    if (motionDef) {
      const nodeScale = [worldScale[0], worldScale[1], worldScale[2]];
      const parentInvWorldMat = mat4.create();
      const pIdx = parentMap.get(i);
      if (pIdx !== undefined) mat4.invert(parentInvWorldMat, worldMats[pIdx]);

      const name = nodes[i].name;
      const named = name ? filamentAsset.getEntitiesByName(name) : [];
      const entity = named.length > 0 ? named[0] : (nodeEntityMap.get(i) || null);
      if (!entity) console.warn('[physics] no Filament entity for node', i, name || '(unnamed)');

      const entry = { entity, bodyId, nodeScale, initPos, initRot, parentInvWorldMat, size: shape.size };
      physicsNodes.push(entry);

      // Keep dynamic renderables visible even when their (now stale) AABB leaves the frustum.
      if (entity) {
        const rm = filamentEngine.getRenderableManager();
        const inst = rm.getInstance(entity);
        if (inst) { rm.setCulling(inst, false); inst.delete(); }
      }
    } else {
      staticBodies.push({ bodyId, size: shape.size });
    }
  }

  console.log('[Filament+Havok] physics ready:',
    physicsNodes.length, 'dynamic,', staticBodies.length, 'static');
}

// ---- Physics step + transform sync ----
function physicsStep() {
  if (!HK || !worldId) return;
  checkResult(HK.HP_World_Step(worldId, FIXED_TIMESTEP), 'HP_World_Step');

  for (const entry of physicsNodes) {
    const pr = HK.HP_Body_GetPosition(entry.bodyId);
    if (pr[1][1] < RESET_Y_THRESHOLD) {
      checkResult(HK.HP_Body_SetPosition(entry.bodyId, entry.initPos), 'reset SetPosition');
      checkResult(HK.HP_Body_SetOrientation(entry.bodyId, entry.initRot), 'reset SetOrientation');
      checkResult(HK.HP_Body_SetLinearVelocity(entry.bodyId, [0, 0, 0]), 'reset SetLinearVelocity');
      checkResult(HK.HP_Body_SetAngularVelocity(entry.bodyId, [0, 0, 0]), 'reset SetAngularVelocity');
    }
  }

  const tcm = engine.getTransformManager();
  tcm.openLocalTransformTransaction();
  for (const entry of physicsNodes) {
    if (!entry.entity) continue;
    const pr = HK.HP_Body_GetPosition(entry.bodyId);
    const qr = HK.HP_Body_GetOrientation(entry.bodyId);
    const p = pr[1], r = qr[1];
    const physWorld = mat4.fromRotationTranslationScale(
      mat4.create(),
      quat.fromValues(r[0], r[1], r[2], r[3]),
      vec3.fromValues(p[0], p[1], p[2]),
      vec3.fromValues(entry.nodeScale[0], entry.nodeScale[1], entry.nodeScale[2]),
    );
    const localMat = mat4.multiply(mat4.create(), entry.parentInvWorldMat, physWorld);
    const inst = tcm.getInstance(entry.entity);
    tcm.setTransform(inst, localMat);
    inst.delete();
  }
  tcm.commitLocalTransformTransaction();
}

// ---- Debug wireframe overlay (separate transparent WebGL2 canvas) ----
function makeBoxLineVerts(sx, sy, sz) {
  const hx = sx / 2, hy = sy / 2, hz = sz / 2;
  const c = [
    [-hx, -hy, -hz], [hx, -hy, -hz], [hx, hy, -hz], [-hx, hy, -hz],
    [-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz],
  ];
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
  const view = mat4.lookAt(mat4.create(), eye, center, up);
  const proj = mat4.perspective(mat4.create(), 75 * Math.PI / 180, aspect, 0.01, 10000.0);
  const vp = mat4.multiply(mat4.create(), proj, view);
  gl.bindBuffer(gl.ARRAY_BUFFER, debugVbo);
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);

  function drawBox(size, color, p, r) {
    const model = mat4.fromRotationTranslation(mat4.create(),
      quat.fromValues(r[0], r[1], r[2], r[3]), vec3.fromValues(p[0], p[1], p[2]));
    const mvp = mat4.multiply(mat4.create(), vp, model);
    gl.uniformMatrix4fv(uMVP, false, mvp);
    gl.uniform4fv(uColor, color);
    const verts = makeBoxLineVerts(size[0], size[1], size[2]);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW);
    gl.drawArrays(gl.LINES, 0, verts.length / 3);
  }

  for (const entry of physicsNodes) {
    const pr = HK.HP_Body_GetPosition(entry.bodyId);
    const qr = HK.HP_Body_GetOrientation(entry.bodyId);
    drawBox(entry.size, DEBUG_COLOR_DYNAMIC, pr[1], qr[1]);
  }
  for (const sb of staticBodies) {
    const pr = HK.HP_Body_GetPosition(sb.bodyId);
    const qr = HK.HP_Body_GetOrientation(sb.bodyId);
    drawBox(sb.size, DEBUG_COLOR_STATIC, pr[1], qr[1]);
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
  // Use an explicit LINEAR color grading (matches the reference viewer); relying on Filament's
  // default color grading triggers a "uniform buffer too small" GL error at feature level 1.
  const colorGrading = Filament.ColorGrading.Builder().toneMapping(ToneMapping.LINEAR).build(engine);
  view.setColorGrading(colorGrading);
  renderer.setClearOptions({ clearColor: [0.6, 0.6, 0.6, 1.0], clear: true });

  initDebugCanvas(canvas);

  // Load the model.
  const bytes = new Uint8Array(await (await fetch(MODEL_URL)).arrayBuffer());
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
      // Renderables are added to the scene incrementally in render() via popRenderable()
      // (the canonical Filament gltfio pattern — addEntities() does not make them draw).
      for (const l of asset.getLightEntities()) scene.addEntity(l);
      resolve();
    }, () => {}, '');
  });

  // Build physics from the GLB's KHR_physics extensions.
  HK = await HavokPhysics();
  await initPhysicsFromUrl(MODEL_URL, asset, engine);

  // Frame the camera on the collider bounds.
  const center = [
    (sceneMin[0] + sceneMax[0]) / 2,
    (sceneMin[1] + sceneMax[1]) / 2,
    (sceneMin[2] + sceneMax[2]) / 2,
  ];
  const span = Math.max(
    sceneMax[0] - sceneMin[0],
    sceneMax[1] - sceneMin[1],
    sceneMax[2] - sceneMin[2],
    1,
  );
  const radius = span * 0.5;
  const orbitDist = radius * 2.6;
  const orbitHeight = center[1] + radius * 0.7;
  const far = Math.max(2000, radius * 60);

  let width = 0, height = 0, aspect = 1;
  function resize() {
    const dpr = window.devicePixelRatio || 1;
    width = canvas.width = Math.floor(window.innerWidth * dpr);
    height = canvas.height = Math.floor(window.innerHeight * dpr);
    if (debugCanvas) { debugCanvas.width = width; debugCanvas.height = height; }
    aspect = width / height;
    view.setViewport([0, 0, width, height]);
    const fovAxis = aspect < 1 ? Fov.HORIZONTAL : Fov.VERTICAL;
    camera.setProjectionFov(75, aspect, 0.1, far, fovAxis);
  }
  window.addEventListener('resize', resize);
  resize();

  setWireframeVisible(showWireframe);

  let angle = 0.6;
  function render() {
    requestAnimationFrame(render);

    // Move renderables into the scene as Filament finishes their GPU upload.
    if (asset) {
      let e = asset.popRenderable();
      while (e.getId() !== 0) {
        scene.addEntity(e);
        e = asset.popRenderable();
      }
    }

    try { physicsStep(); } catch (e) { console.error('[physics] step error:', e); HK = null; }

    angle += 0.0035;
    const eye = [
      center[0] + Math.sin(angle) * orbitDist,
      orbitHeight,
      center[2] + Math.cos(angle) * orbitDist,
    ];
    const up = [0, 1, 0];
    camera.lookAt(eye, center, up);

    renderer.render(swapChain, view);
    drawDebug(eye, center, up, aspect);
  }
  requestAnimationFrame(render);
}
