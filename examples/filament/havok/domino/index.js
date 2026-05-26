// Filament + Havok — Domino sample.
//
// A 16x16 grid of coloured dominoes (a bitmap picture) is knocked over by a row of balls,
// simulated by Havok and rendered by Filament. Geometry (cube + sphere) and materials are built
// by hand in Filament: the compiled `texture.filamat` (unlit textured material) is reused with a
// tiny 1x1 solid-colour texture per domino colour, so every domino samples a flat colour.
//
// Collider wireframes are rendered in the same Filament pass as LINES renderables using
// `cube.filamat` (an unlit vertex-colour material) — no second canvas, no compositor stutter.
// Press W to toggle them in / out of the scene.
//
// A compiled .filamat is tied to a Filament version, so this sample uses the matching `dev` build
// (see index.html). Libraries are globals: Filament, HavokPhysics, gl-matrix.

const FILAMAT_CUBE_URL = 'https://cx20.github.io/webgl-test/examples/filament/cube/cube.filamat';
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
const BOX_SIZE = 2;
const DOMINO_W = BOX_SIZE * 0.15;
const DOMINO_H = BOX_SIZE * 1.5;
const DOMINO_D = BOX_SIZE * 1.0;
const BALL_RADIUS = BOX_SIZE / 2;
const GROUND = { size: [100, 0.2, 100], pos: [0, 0, 0] };
const WIREFRAME_OUTSET = 1.005;

const COLOR_DYNAMIC = [255, 128, 51, 255];
const COLOR_STATIC = [51, 255, 102, 255];

let HK = null;
let worldId = null;

let engine = null;
let scene = null;
let showWireframe = true;
const bodies = []; // { entity, wireframeEntity, bodyId, scale, kind, curPos, curRot }
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

function buildVB(eng, positions, uvs, vertexCount) {
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

function buildSphereLineGeometry(radius, segments = 16) {
  const positions = [];
  for (let plane = 0; plane < 3; plane++) {
    for (let i = 0; i < segments; i++) {
      const a0 = (i / segments) * Math.PI * 2, a1 = ((i + 1) / segments) * Math.PI * 2;
      const c0 = Math.cos(a0) * radius, s0 = Math.sin(a0) * radius;
      const c1 = Math.cos(a1) * radius, s1 = Math.sin(a1) * radius;
      if (plane === 0)      positions.push(c0, s0, 0, c1, s1, 0);
      else if (plane === 1) positions.push(c0, 0, s0, c1, 0, s1);
      else                  positions.push(0, c0, s0, 0, c1, s1);
    }
  }
  const positionArr = new Float32Array(positions);
  const indices = new Uint16Array(positionArr.length / 3);
  for (let i = 0; i < indices.length; i++) indices[i] = i;
  return { positions: positionArr, indices };
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

// ---- Body creation (PBR + wireframe) ----
function addBody(dynScene, vb, ib, halfExtentBox, matInstance, shapeId, motionType, scale, pos, rot, kind, wireVB, wireIB, wireMatInstance) {
  const cb = HK.HP_Body_Create();
  const bodyId = cb[1];
  HK.HP_Body_SetShape(bodyId, shapeId);
  HK.HP_Body_SetMotionType(bodyId, motionType);
  if (motionType === HK.MotionType.DYNAMIC) {
    const mp = HK.HP_Shape_BuildMassProperties(shapeId);
    HK.HP_Body_SetMassProperties(bodyId, mp[1]);
  }
  HK.HP_Body_SetPosition(bodyId, pos);
  HK.HP_Body_SetOrientation(bodyId, rot);
  HK.HP_World_AddBody(worldId, bodyId, false);

  const entity = Filament.EntityManager.get().create();
  Filament.RenderableManager.Builder(1)
    .boundingBox({ center: [0, 0, 0], halfExtent: halfExtentBox })
    .material(0, matInstance)
    .geometry(0, Filament.RenderableManager$PrimitiveType.TRIANGLES, vb, ib)
    .build(engine, entity);
  dynScene.addEntity(entity);
  const rm = engine.getRenderableManager();
  const inst = rm.getInstance(entity);
  if (inst) { rm.setCulling(inst, false); inst.delete(); }

  let wireframeEntity = null;
  if (wireVB && wireIB) {
    wireframeEntity = buildLineRenderable(wireVB, wireIB, wireMatInstance, halfExtentBox);
    dynScene.addEntity(wireframeEntity);
  }

  bodies.push({ entity, wireframeEntity, bodyId, scale, kind, curPos: pos.slice(), curRot: rot.slice() });
}

let tmpMat = null, tmpQuat = null, tmpVec = null, tmpScale = null;

function stepAndSync() {
  checkResult(HK.HP_World_Step(worldId, FIXED_TIMESTEP), 'HP_World_Step');
  const tcm = engine.getTransformManager();
  tcm.openLocalTransformTransaction();
  for (const b of bodies) {
    const p = HK.HP_Body_GetPosition(b.bodyId)[1];
    const r = HK.HP_Body_GetOrientation(b.bodyId)[1];
    b.curPos[0] = p[0]; b.curPos[1] = p[1]; b.curPos[2] = p[2];
    b.curRot[0] = r[0]; b.curRot[1] = r[1]; b.curRot[2] = r[2]; b.curRot[3] = r[3];
    quat.set(tmpQuat, r[0], r[1], r[2], r[3]);
    vec3.set(tmpVec, p[0], p[1], p[2]);
    vec3.set(tmpScale, b.scale[0], b.scale[1], b.scale[2]);
    mat4.fromRotationTranslationScale(tmpMat, tmpQuat, tmpVec, tmpScale);
    if (b.entity) {
      const inst = tcm.getInstance(b.entity);
      tcm.setTransform(inst, tmpMat);
      inst.delete();
    }
    if (b.wireframeEntity) {
      // Wireframe shares the same unit-shape VB as the PBR mesh, so the same scaled transform fits.
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
  for (const b of bodies) {
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
Filament.init([FILAMAT_CUBE_URL, FILAMAT_TEX_URL, FOOTBALL_URL, GRASS_URL], () => {
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

  // Dominoes: one vertex-colour material (cube.filamat) shared by all, with a per-colour cube VB.
  const cubeMat = engine.createMaterial(FILAMAT_CUBE_URL);
  const cubeInst = cubeMat.getDefaultInstance();
  const wireMatInstance = cubeInst; // cube.filamat just samples vertex colour
  const cubeVBByKey = {};
  for (const [key, rgb] of Object.entries(colorHash)) cubeVBByKey[key] = buildColorCubeVB(engine, rgb);
  const cubeIB = buildIB(engine, CUBE_INDICES);

  // Unit-size LINES box + sphere wireframes (sized to the unit shape; per-body scale takes care of
  // the actual domino / ball dimensions in the sync). Outset to avoid z-fighting with PBR.
  const cubeWireVB = buildLineVB(engine, buildLineBoxPositions(0.5 * WIREFRAME_OUTSET, 0.5 * WIREFRAME_OUTSET, 0.5 * WIREFRAME_OUTSET), COLOR_DYNAMIC);
  const cubeWireIB = buildIB(engine, LINE_BOX_INDICES);
  const sphereWireGeo = buildSphereLineGeometry(WIREFRAME_OUTSET);
  const sphereWireVB = buildLineVB(engine, sphereWireGeo.positions, COLOR_DYNAMIC);
  const sphereWireIB = buildIB(engine, sphereWireGeo.indices);

  // Balls: football-textured sphere (texture.filamat).
  const texMat = engine.createMaterial(FILAMAT_TEX_URL);
  const ballInst = texMat.createInstance();
  const sampler = new Filament.TextureSampler(Filament.MinFilter.LINEAR, Filament.MagFilter.LINEAR, Filament.WrapMode.REPEAT);
  ballInst.setTextureParameter('texture', engine.createTextureFromPng(FOOTBALL_URL, { nomips: true }), sampler);
  const sphereGeo = makeSphereGeometry(20, 14);
  const sphereVB = buildVB(engine, sphereGeo.positions, sphereGeo.uvs, sphereGeo.positions.length / 3);
  const sphereIB = buildIB(engine, sphereGeo.indices);

  // Ground: a grass-textured quad placed at the top of the ground collider.
  const groundInst = texMat.createInstance();
  groundInst.setTextureParameter('texture', engine.createTextureFromJpeg(GRASS_URL, { nomips: true }), sampler);
  const planeGeo = makePlaneGeometry(GROUND.size[0], 20);
  const groundVB = buildVB(engine, planeGeo.positions, planeGeo.uvs, 4);
  const groundIB = buildIB(engine, planeGeo.indices);
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
    const groundTop = GROUND.pos[1] + GROUND.size[1] / 2;
    tcm.setTransform(inst, mat4.fromTranslation(mat4.create(), vec3.fromValues(GROUND.pos[0], groundTop, GROUND.pos[2])));
    inst.delete();
    const rm = engine.getRenderableManager();
    const rmInst = rm.getInstance(groundEntity);
    if (rmInst) { rm.setCulling(rmInst, false); rmInst.delete(); }
  }

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

  // Ground (static box). Not rendered by Filament as PBR — only as the green collider wireframe.
  const gs = HK.HP_Shape_CreateBox([0, 0, 0], IDENTITY_QUATERNION, GROUND.size);
  const gb = HK.HP_Body_Create();
  HK.HP_Body_SetShape(gb[1], gs[1]);
  HK.HP_Body_SetMotionType(gb[1], HK.MotionType.STATIC);
  HK.HP_Body_SetPosition(gb[1], GROUND.pos);
  HK.HP_Body_SetOrientation(gb[1], IDENTITY_QUATERNION);
  HK.HP_World_AddBody(worldId, gb[1], false);

  // Ground LINES wireframe (size + position baked).
  {
    const ghx = GROUND.size[0] / 2 * WIREFRAME_OUTSET, ghy = GROUND.size[1] / 2 * WIREFRAME_OUTSET, ghz = GROUND.size[2] / 2 * WIREFRAME_OUTSET;
    const vb = buildLineVB(engine, buildLineBoxPositions(ghx, ghy, ghz, GROUND.pos[0], GROUND.pos[1], GROUND.pos[2]), COLOR_STATIC);
    const ib = buildIB(engine, LINE_BOX_INDICES);
    const entity = buildLineRenderable(vb, ib, wireMatInstance, [ghx, ghy, ghz]);
    scene.addEntity(entity);
    staticWireframeEntities.push(entity);
  }

  // Shared shapes
  const dominoShape = HK.HP_Shape_CreateBox([0, 0, 0], IDENTITY_QUATERNION, [DOMINO_W, DOMINO_H, DOMINO_D])[1];
  const ballShape = HK.HP_Shape_CreateSphere([0, 0, 0], BALL_RADIUS)[1];
  const dominoScale = [DOMINO_W, DOMINO_H, DOMINO_D];
  const ballScale = [BALL_RADIUS, BALL_RADIUS, BALL_RADIUS];

  // 16x16 dominoes (a bitmap picture)
  for (let row = 0; row < 16; row++) {
    for (let col = 0; col < 16; col++) {
      const colorKey = dataSet[row * 16 + col];
      const x = -8 * BOX_SIZE + col * BOX_SIZE;
      const y = BOX_SIZE;
      const z = -8 * BOX_SIZE + row * BOX_SIZE * 1.2;
      addBody(scene, cubeVBByKey[colorKey] || cubeVBByKey['無'], cubeIB, [0.5, 0.5, 0.5], cubeInst,
        dominoShape, HK.MotionType.DYNAMIC, dominoScale, [x, y, z], IDENTITY_QUATERNION, 'box',
        cubeWireVB, cubeWireIB, wireMatInstance);
    }
  }

  // 16 balls dropped along the near edge
  for (let i = 0; i < 16; i++) {
    const x = -8 * BOX_SIZE - 0.5;
    const y = 8;
    const z = -8 * BOX_SIZE + (15 - i) * BOX_SIZE * 1.2;
    addBody(scene, sphereVB, sphereIB, [1, 1, 1], ballInst,
      ballShape, HK.MotionType.DYNAMIC, ballScale, [x, y, z], IDENTITY_QUATERNION, 'sphere',
      sphereWireVB, sphereWireIB, wireMatInstance);
  }

  const center = [0, 2, 0];
  const orbitDist = 30;
  const orbitHeight = 12;

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

  setWireframeVisible(showWireframe);

  // Camera orbit driven directly by wall time.
  const ORBIT_SPEED = 0.24, ORBIT_PHASE = 0.5;
  function render(now) {
    requestAnimationFrame(render);
    if (HK && worldId) {
      try { stepAndSync(); } catch (e) { console.error('[physics] error:', e); HK = null; }
    }
    const angle = ORBIT_PHASE + now * 0.001 * ORBIT_SPEED;
    const eye = [center[0] + Math.sin(angle) * orbitDist, orbitHeight, center[2] + Math.cos(angle) * orbitDist];
    const up = [0, 1, 0];
    camera.lookAt(eye, center, up);
    renderer.render(swapChain, view);
  }
  requestAnimationFrame(render);
}
