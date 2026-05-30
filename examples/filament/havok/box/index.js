// Filament + Havok — Stacked Boxes sample.
//
// 256 coloured cubes (a 16x16 bitmap picture) fall and pile up on a grass ground, simulated by
// Havok and rendered by Filament. Geometry and materials are built by hand: cube.filamat (vertex-
// colour unlit material) gives each cube a flat colour, texture.filamat textures the grass floor.
//
// Collider wireframes are rendered in the same Filament pass as LINES renderables using
// `cube.filamat` (an unlit vertex-colour material) — no second canvas, no compositor stutter.
// Press W to toggle them in / out of the scene.
//
// A compiled .filamat is tied to a Filament version, so this sample uses the matching `dev` build
// (see index.html). Libraries are globals: Filament, HavokPhysics, gl-matrix.

const FILAMAT_CUBE_URL = 'https://cx20.github.io/webgl-test/examples/filament/cube/cube.filamat';
const FILAMAT_TEX_URL = 'https://cx20.github.io/webgl-test/examples/filament/texture/texture.filamat';
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
const BOX_SIZE = 1;
const RESET_Y_THRESHOLD = -10;
const GROUND = { size: [30, 0.4, 30], pos: [0, 0, 0] };
const WIREFRAME_OUTSET = 1.005;

const COLOR_DYNAMIC = [255, 128, 51, 255];  // orange
const COLOR_STATIC = [51, 255, 102, 255];   // green

let HK = null;
let worldId = null;

let engine = null;
let scene = null;
let showWireframe = true;
const boxes = []; // { entity, wireframeEntity, bodyId, curPos, curRot }
const staticWireframeEntities = [];

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
const CUBE_POSITIONS = new Float32Array([
  -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5,
  -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, -0.5,
  0.5, 0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5,
  -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, -0.5, -0.5, -0.5, -0.5, -0.5,
  0.5, -0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5, -0.5, -0.5,
  -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5, -0.5, -0.5, -0.5, -0.5,
]);
const CUBE_INDICES = new Uint16Array([
  0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 8, 9, 10, 8, 10, 11,
  12, 13, 14, 12, 14, 15, 16, 17, 18, 16, 18, 19, 20, 21, 22, 20, 22, 23,
]);

function buildColorCubeVB(eng, rgb) {
  const VA = Filament.VertexAttribute, AT = Filament.VertexBuffer$AttributeType;
  const vb = Filament.VertexBuffer.Builder()
    .vertexCount(24).bufferCount(2)
    .attribute(VA.POSITION, 0, AT.FLOAT3, 0, 0)
    .attribute(VA.COLOR, 1, AT.UBYTE4, 0, 0)
    .normalized(VA.COLOR)
    .build(eng);
  vb.setBufferAt(eng, 0, CUBE_POSITIONS);
  const r = Math.round(rgb[0] * 255), g = Math.round(rgb[1] * 255), b = Math.round(rgb[2] * 255);
  const col = new Uint8Array(24 * 4);
  for (let i = 0; i < 24; i++) { col[i * 4] = r; col[i * 4 + 1] = g; col[i * 4 + 2] = b; col[i * 4 + 3] = 255; }
  vb.setBufferAt(eng, 1, col);
  return vb;
}

function makePlaneGeometry(size, tiles) {
  const h = size / 2;
  return {
    positions: new Float32Array([-h, 0, -h, h, 0, -h, h, 0, h, -h, 0, h]),
    uvs: new Float32Array([0, 0, tiles, 0, tiles, tiles, 0, tiles]),
    indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
  };
}

function buildUvVB(eng, positions, uvs, vertexCount) {
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
const LINE_BOX_INDICES = new Uint16Array([
  0, 1, 1, 2, 2, 3, 3, 0,
  4, 5, 5, 6, 6, 7, 7, 4,
  0, 4, 1, 5, 2, 6, 3, 7,
]);
function buildLineBoxPositions(hx, hy, hz, cx = 0, cy = 0, cz = 0) {
  return new Float32Array([
    cx - hx, cy - hy, cz - hz,  cx + hx, cy - hy, cz - hz,  cx + hx, cy + hy, cz - hz,  cx - hx, cy + hy, cz - hz,
    cx - hx, cy - hy, cz + hz,  cx + hx, cy - hy, cz + hz,  cx + hx, cy + hy, cz + hz,  cx - hx, cy + hy, cz + hz,
  ]);
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

// ---- Body creation (builds the matching PBR + wireframe renderables) ----
function addBox(coneScene, vb, ib, matInstance, shapeId, pos, wireVB, wireIB, wireMatInstance) {
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
    .boundingBox({ center: [0, 0, 0], halfExtent: [BOX_SIZE / 2, BOX_SIZE / 2, BOX_SIZE / 2] })
    .material(0, matInstance)
    .geometry(0, Filament.RenderableManager$PrimitiveType.TRIANGLES, vb, ib)
    .build(engine, entity);
  coneScene.addEntity(entity);
  const rm = engine.getRenderableManager();
  const inst = rm.getInstance(entity);
  if (inst) { rm.setCulling(inst, false); inst.delete(); }

  const wireframeEntity = buildLineRenderable(wireVB, wireIB, wireMatInstance, [BOX_SIZE / 2, BOX_SIZE / 2, BOX_SIZE / 2]);
  coneScene.addEntity(wireframeEntity);

  boxes.push({ entity, wireframeEntity, bodyId, curPos: pos.slice(), curRot: [0, 0, 0, 1] });
}

function randomRespawn() {
  return [-5 + Math.random() * 10, 20 + Math.random() * 10, -5 + Math.random() * 10];
}

let tmpMat = null, tmpQuat = null, tmpVec = null, tmpScale = null;

function stepAndSync() {
  checkResult(HK.HP_World_Step(worldId, FIXED_TIMESTEP), 'HP_World_Step');
  const tcm = engine.getTransformManager();
  tcm.openLocalTransformTransaction();
  for (const b of boxes) {
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
    quat.set(tmpQuat, r[0], r[1], r[2], r[3]);
    vec3.set(tmpVec, p[0], p[1], p[2]);
    // PBR cube uses a unit-size mesh and scales by BOX_SIZE.
    vec3.set(tmpScale, BOX_SIZE, BOX_SIZE, BOX_SIZE);
    mat4.fromRotationTranslationScale(tmpMat, tmpQuat, tmpVec, tmpScale);
    if (b.entity) {
      const inst = tcm.getInstance(b.entity);
      tcm.setTransform(inst, tmpMat);
      inst.delete();
    }
    // Wireframe is pre-sized so a non-scaling transform is correct.
    if (b.wireframeEntity) {
      mat4.fromRotationTranslation(tmpMat, tmpQuat, tmpVec);
      const inst = tcm.getInstance(b.wireframeEntity);
      tcm.setTransform(inst, tmpMat);
      inst.delete();
    }
  }
  tcm.commitLocalTransformTransaction();
}

// ---- W-key wireframe toggle ----
function setWireframeVisible(visible) {
  showWireframe = visible;
  const hint = document.getElementById('hint');
  if (hint) hint.textContent = 'W: wireframe ' + (visible ? 'ON' : 'OFF');
  if (!scene) return;
  for (const b of boxes) {
    if (!b.wireframeEntity) continue;
    if (visible) scene.addEntity(b.wireframeEntity); else scene.remove(b.wireframeEntity);
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
Filament.init([FILAMAT_CUBE_URL, FILAMAT_TEX_URL, GRASS_URL], () => {
  window.Fov = Filament.Camera$Fov;
  main().catch(e => console.error(e));
});

async function main() {
  tmpMat = mat4.create();
  tmpQuat = quat.create();
  tmpVec = vec3.create();
  tmpScale = vec3.create();

  const canvas = document.getElementsByTagName('canvas')[0];
  engine = Filament.Engine.create(canvas);
  scene = engine.createScene();

  // Boxes: one vertex-colour material (cube.filamat), with a per-colour cube vertex buffer.
  const cubeMat = engine.createMaterial(FILAMAT_CUBE_URL);
  const cubeInst = cubeMat.getDefaultInstance();
  const wireMatInstance = cubeInst; // cube.filamat just samples vertex colour — same instance is fine
  const cubeVBByKey = {};
  for (const [key, rgb] of Object.entries(colorHash)) cubeVBByKey[key] = buildColorCubeVB(engine, rgb);
  const cubeIB = buildIB(engine, CUBE_INDICES);

  // Shared LINES box wireframe (unit cube outset slightly so it sits just outside the PBR cube).
  const wireHalf = 0.5 * WIREFRAME_OUTSET;
  const cubeWireVB = buildLineVB(engine, buildLineBoxPositions(wireHalf, wireHalf, wireHalf), COLOR_DYNAMIC);
  const cubeWireIB = buildIB(engine, LINE_BOX_INDICES);

  // Grass ground (texture.filamat).
  const texMat = engine.createMaterial(FILAMAT_TEX_URL);
  const groundInst = texMat.createInstance();
  const linear = new Filament.TextureSampler(Filament.MinFilter.LINEAR, Filament.MagFilter.LINEAR, Filament.WrapMode.REPEAT);
  groundInst.setTextureParameter('texture', engine.createTextureFromJpeg(GRASS_URL, { nomips: true }), linear);
  const planeGeo = makePlaneGeometry(GROUND.size[0], 12);
  const groundVB = buildUvVB(engine, planeGeo.positions, planeGeo.uvs, 4);
  const groundIB = buildIB(engine, planeGeo.indices);

  const swapChain = engine.createSwapChain();
  const renderer = engine.createRenderer();
  const camera = engine.createCamera(Filament.EntityManager.get().create());
  const view = engine.createView();
  view.setCamera(camera);
  view.setScene(scene);
  renderer.setClearOptions({ clearColor: [0.1, 0.1, 0.15, 1.0], clear: true });

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

  // Ground LINES wireframe (size + position baked).
  {
    const ghx = GROUND.size[0] / 2 * WIREFRAME_OUTSET, ghy = GROUND.size[1] / 2 * WIREFRAME_OUTSET, ghz = GROUND.size[2] / 2 * WIREFRAME_OUTSET;
    const vb = buildLineVB(engine, buildLineBoxPositions(ghx, ghy, ghz, GROUND.pos[0], GROUND.pos[1], GROUND.pos[2]), COLOR_STATIC);
    const ib = buildIB(engine, LINE_BOX_INDICES);
    const entity = buildLineRenderable(vb, ib, wireMatInstance, [ghx, ghy, ghz]);
    scene.addEntity(entity);
    staticWireframeEntities.push(entity);
  }

  const boxShape = HK.HP_Shape_CreateBox([0, 0, 0], IDENTITY_QUATERNION, [BOX_SIZE, BOX_SIZE, BOX_SIZE])[1];

  // 16x16 cubes forming the picture (a vertical wall that collapses into a pile).
  for (let x = 0; x < 16; x++) {
    for (let y = 0; y < 16; y++) {
      const colorKey = dataSet[y * 16 + x];
      const px = -12 + x * BOX_SIZE * 1.5 + Math.random() * 0.1;
      const py = (15 - y) * BOX_SIZE * 1.2 + Math.random() * 0.1;
      const pz = Math.random() * 0.1;
      addBox(scene, cubeVBByKey[colorKey] || cubeVBByKey['無'], cubeIB, cubeInst, boxShape, [px, py, pz], cubeWireVB, cubeWireIB, wireMatInstance);
    }
  }

  const camTarget = [0, 4, 0];
  let camTheta  = 0.5;   // azimuth (rad)
  let camPhi    = 0.28;   // elevation (rad)
  let camRadius = 29.1;

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

  // Mouse-drag orbit + scroll zoom.
  let isDragging = false, lastX = 0, lastY = 0;
  canvas.addEventListener('mousedown', e => { isDragging = true; lastX = e.clientX; lastY = e.clientY; });
  window.addEventListener('mouseup',   () => { isDragging = false; });
  window.addEventListener('mousemove', e => {
    if (!isDragging) return;
    camTheta -= (e.clientX - lastX) * 0.01;
    camPhi   += (e.clientY - lastY) * 0.01;
    camPhi = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, camPhi));
    lastX = e.clientX; lastY = e.clientY;
  });
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    camRadius *= 1 + e.deltaY * 0.001;
    camRadius = Math.max(1.0, Math.min(500.0, camRadius));
  }, { passive: false });
  setWireframeVisible(showWireframe);

  function render(now) {
    requestAnimationFrame(render);
    if (HK && worldId) {
      try { stepAndSync(); } catch (e) { console.error('[physics] error:', e); HK = null; }
    }
    const ex = camTarget[0] + camRadius * Math.cos(camPhi) * Math.sin(camTheta);
    const ey = camTarget[1] + camRadius * Math.sin(camPhi);
    const ez = camTarget[2] + camRadius * Math.cos(camPhi) * Math.cos(camTheta);
    camera.lookAt([ex, ey, ez], camTarget, [0, 1, 0]);
    renderer.render(swapChain, view);
  }
  requestAnimationFrame(render);
}
