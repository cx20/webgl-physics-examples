import Rn from 'rhodonite';

// Rhodonite (rendering) + Rapier (physics, raw world/rigid-body API). Textured eraser boxes rain
// onto a small ground slab and overflow the edges; each collider is a box matching the eraser's
// extents. Mirrors the Rhodonite + Havok eraser sample.

const ERASER_COUNT = 200;
// Flat eraser box (full side lengths) and its half-extents.
const ERASER_SIZE = [2.4, 0.6, 1.2];
const EHALF = [ERASER_SIZE[0] / 2, ERASER_SIZE[1] / 2, ERASER_SIZE[2] / 2];

// Six eraser faces in atlas-column order: +x, -x, +y, -y, +z, -z (right, left, top, bottom, front, back).
const ERASER_FACE_TEXTURES = [
  '../../../../assets/textures/eraser_003/eraser_right.png',
  '../../../../assets/textures/eraser_003/eraser_left.png',
  '../../../../assets/textures/eraser_003/eraser_top.png',
  '../../../../assets/textures/eraser_003/eraser_bottom.png',
  '../../../../assets/textures/eraser_003/eraser_front.png',
  '../../../../assets/textures/eraser_003/eraser_back.png',
];

let RAPIER, world, engine;
const entities = [];
const bodies = [];

let showWireframe = true;
const debugEntities = [];          // all collider wireframes (for the W toggle)
const eraserDebugEntities = [];    // per-eraser wireframes, parallel to bodies
const DEBUG_COLOR_DYNAMIC = [1.0, 0.5, 0.2, 1.0];
const DEBUG_COLOR_STATIC = [0.2, 1.0, 0.4, 1.0];

// Mirror the other Rhodonite samples: PbrUber + RN_USE_WIREFRAME, with calcBaryCentricCoord()
// on the mesh so the wireframe shader can draw the edges.
function makeDebugMaterial(color) {
  const mat = Rn.MaterialHelper.createPbrUberMaterial(engine, { isLighting: false, isSkinning: false, isMorphing: false });
  try { mat.addShaderDefine('RN_USE_WIREFRAME'); } catch (e) {}
  try { mat.setParameter('wireframe', Rn.Vector3.fromCopy3(1, 0, 1)); } catch (e) {}
  try { mat.setParameter('baseColorFactor', Rn.Vector4.fromCopyArray4(color)); } catch (e) {}
  return mat;
}

function createDebugBox(size, pos, color) {
  const entity = Rn.MeshHelper.createCube(engine, { material: makeDebugMaterial(color) });
  entity.getTransform().localScale = Rn.Vector3.fromCopyArray([size[0], size[1], size[2]]);
  entity.getTransform().localPosition = Rn.Vector3.fromCopyArray(pos);
  try { entity.getMesh().calcBaryCentricCoord(); } catch (e) {}
  debugEntities.push(entity);
  return entity;
}

// Box wireframe geometry (full size w x h x d, centred on the origin).
function buildBoxGeometry(w, h, d) {
  const x = w / 2, y = h / 2, z = d / 2;
  const positions = new Float32Array([
    -x, -y, -z,  x, -y, -z,  x, y, -z,  -x, y, -z,
    -x, -y,  z,  x, -y,  z,  x, y,  z,  -x, y,  z,
  ]);
  const indices = new Uint16Array([
    0, 1, 2, 0, 2, 3,   4, 6, 5, 4, 7, 6,
    0, 4, 7, 0, 7, 3,   1, 5, 6, 1, 6, 2,
    3, 7, 6, 3, 6, 2,   0, 5, 1, 0, 4, 5,
  ]);
  return { positions, indices };
}

// Eraser box: 24 vertices (6 faces) with per-face UVs into a 6-column atlas (+x,-x,+y,-y,+z,-z).
function createEraserGeometry() {
  const faces = [
    { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },
    { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
    { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },
    { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
    { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
    { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
  ];
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  const localUV = [[0, 1], [1, 1], [1, 0], [0, 0]];
  const positions = [], normals = [], texcoords = [], indices = [];
  const dotHalf = (a) => Math.abs(a[0]) * EHALF[0] + Math.abs(a[1]) * EHALF[1] + Math.abs(a[2]) * EHALF[2];
  faces.forEach((f, fi) => {
    const base = positions.length / 3;
    const halfU = dotHalf(f.u), halfV = dotHalf(f.v);
    for (let ci = 0; ci < 4; ci++) {
      const [su, sv] = corners[ci];
      positions.push(
        f.n[0] * EHALF[0] + f.u[0] * su * halfU + f.v[0] * sv * halfV,
        f.n[1] * EHALF[1] + f.u[1] * su * halfU + f.v[1] * sv * halfV,
        f.n[2] * EHALF[2] + f.u[2] * su * halfU + f.v[2] * sv * halfV,
      );
      normals.push(...f.n);
      texcoords.push((localUV[ci][0] + fi) / 6, localUV[ci][1]);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  });
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    texcoords: new Float32Array(texcoords),
    indices: new Uint16Array(indices),
  };
}

// Build a 6-cell atlas (right,left,top,bottom,front,back) PNG data URL from the eraser_003 images.
async function buildEraserAtlasDataUrl() {
  const cell = 256;
  const images = await Promise.all(ERASER_FACE_TEXTURES.map(async (s) => {
    const im = new Image();
    im.src = s;
    await im.decode();
    return im;
  }));
  const canvas = document.createElement('canvas');
  canvas.width = cell * 6;
  canvas.height = cell;
  const ctx = canvas.getContext('2d');
  for (let i = 0; i < 6; i++) ctx.drawImage(images[i], i * cell, 0, cell, cell);
  return canvas.toDataURL('image/png');
}

// Random unit quaternion.
function randomQuat() {
  const qx = Math.random() - 0.5;
  const qy = Math.random() - 0.5;
  const qz = Math.random() - 0.5;
  const qw = Math.random() - 0.5;
  const l = Math.sqrt(qx * qx + qy * qy + qz * qz + qw * qw) || 1;
  return { x: qx / l, y: qy / l, z: qz / l, w: qw / l };
}

// Static box body. Rapier cuboid takes half-extents; the sizes here are full side lengths.
function createStaticBox(size, pos) {
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(pos[0], pos[1], pos[2]));
  world.createCollider(RAPIER.ColliderDesc.cuboid(size[0] / 2, size[1] / 2, size[2] / 2), body);
}

const load = async function () {
  const canvas = document.getElementById('world');
  engine = await Rn.Engine.init({
    approach: Rn.ProcessApproach.DataTexture,
    canvas,
  });

  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
  function resizeCanvas() {
    engine.resizeCanvas(window.innerWidth, window.innerHeight);
  }

  // Rhodonite v0.19.9 added a Rapier physics backend. This sample drives Rapier directly
  // (raw world / rigid-body API), mirroring how the Havok version used the Havok low-level API.
  RAPIER = (await import('https://cdn.skypack.dev/@dimforge/rapier3d-compat@0.17.3')).default;
  await RAPIER.init();
  world = new RAPIER.World({ x: 0, y: -9.8, z: 0 });

  const sampler = new Rn.Sampler(engine, {
    magFilter: Rn.TextureParameter.Linear,
    minFilter: Rn.TextureParameter.Linear,
    wrapS: Rn.TextureParameter.ClampToEdge,
    wrapT: Rn.TextureParameter.ClampToEdge,
  });
  const eraserTex = await Rn.Texture.loadFromUrl(engine, await buildEraserAtlasDataUrl());

  // Ground: small low floor (no walls), matching the other eraser samples - a
  // 20 x 0.1 x 20 slab at y = -10 that the heap overflows.
  createStaticBox([20, 0.1, 20], [0, -10, 0]);
  const groundMat = Rn.MaterialHelper.createPbrUberMaterial(engine, { isLighting: true });
  groundMat.setParameter('baseColorFactor', Rn.Vector4.fromCopyArray4([0.24, 0.4, 0.22, 1]));
  const groundEntity = Rn.MeshHelper.createCube(engine, { material: groundMat });
  groundEntity.getTransform().localPosition = Rn.Vector3.fromCopyArray([0, -10, 0]);
  groundEntity.getTransform().localScale = Rn.Vector3.fromCopyArray([20, 0.1, 20]);
  entities.push(groundEntity);
  createDebugBox([20, 0.1, 20], [0, -10, 0], DEBUG_COLOR_STATIC);

  // Shared material, primitive, mesh — created ONCE for all erasers.
  const sharedMat = Rn.MaterialHelper.createPbrUberMaterial(engine, { isLighting: true });
  sharedMat.setTextureParameter('baseColorTexture', eraserTex, sampler);

  const geo = createEraserGeometry();
  const sharedPrimitive = Rn.Primitive.createPrimitive(engine, {
    indices: geo.indices,
    attributeSemantics: [
      Rn.VertexAttribute.Position.XYZ,
      Rn.VertexAttribute.Normal.XYZ,
      Rn.VertexAttribute.Texcoord0.XY,
    ],
    attributes: [geo.positions, geo.normals, geo.texcoords],
    material: sharedMat,
    primitiveMode: Rn.PrimitiveMode.Triangles,
  });
  const sharedMesh = new Rn.Mesh(engine);
  sharedMesh.addPrimitive(sharedPrimitive);

  // Shared box-shaped collider wireframe (one mesh reused by every eraser). The wireframe shader
  // needs un-indexed geometry + barycentric coords (what MeshComponent.calcBaryCentricCoord does).
  const eraserWireGeo = buildBoxGeometry(ERASER_SIZE[0], ERASER_SIZE[1], ERASER_SIZE[2]);
  const eraserWirePrimitive = Rn.Primitive.createPrimitive(engine, {
    indices: eraserWireGeo.indices,
    attributeSemantics: [Rn.VertexAttribute.Position.XYZ],
    attributes: [eraserWireGeo.positions],
    material: makeDebugMaterial(DEBUG_COLOR_DYNAMIC),
    primitiveMode: Rn.PrimitiveMode.Triangles,
  });
  const eraserWireMesh = new Rn.Mesh(engine);
  eraserWireMesh.addPrimitive(eraserWirePrimitive);
  try {
    for (const prim of eraserWireMesh.primitives) prim.convertToUnindexedGeometry();
    eraserWireMesh._calcBaryCentricCoord();
  } catch (e) { console.warn('[Eraser] baryCentric failed:', e); }

  for (let i = 0; i < ERASER_COUNT; i++) {
    const x = (Math.random() - 0.5) * 12;
    const y = 14 + Math.random() * 14;
    const z = (Math.random() - 0.5) * 12;

    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z).setRotation(randomQuat())
    );
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(EHALF[0], EHALF[1], EHALF[2]).setDensity(1),
      body
    );
    bodies.push(body);

    const entity = Rn.createMeshEntity(engine);
    entity.getMesh().setMesh(sharedMesh);
    entities.push(entity);

    const debugEntity = Rn.createMeshEntity(engine);
    debugEntity.getMesh().setMesh(eraserWireMesh);
    debugEntities.push(debugEntity);
    eraserDebugEntities.push(debugEntity);
  }

  // Camera
  const cameraEntity = Rn.createCameraControllerEntity(engine);
  // Fixed head-on view matching the other eraser samples (eye at (0,0,40) looking at the
  // origin, 45 deg FOV); no auto-rotation.
  cameraEntity.localPosition = Rn.Vector3.fromCopyArray([0, 0, 40]);
  cameraEntity.localEulerAngles = Rn.Vector3.fromCopyArray([0, 0, 0]);
  const cameraComponent = cameraEntity.getCamera();
  cameraComponent.zNear = 0.1;
  cameraComponent.zFar = 1000;
  cameraComponent.setFovyAndChangeFocalLength(45);
  cameraComponent.aspect = window.innerWidth / window.innerHeight;

  // Lights
  const lightEntity1 = Rn.createLightEntity(engine);
  const lc1 = lightEntity1.getLight();
  lc1.type = Rn.LightType.Directional;
  lc1.intensity = 2.1;
  lightEntity1.localEulerAngles = Rn.Vector3.fromCopyArray([-Math.PI / 4, Math.PI / 6, 0]);
  const lightEntity2 = Rn.createLightEntity(engine);
  const lc2 = lightEntity2.getLight();
  lc2.type = Rn.LightType.Directional;
  lc2.intensity = 0.9;
  lightEntity2.localEulerAngles = Rn.Vector3.fromCopyArray([Math.PI / 4, -Math.PI / 4, 0]);

  // RenderPass
  const renderPass = new Rn.RenderPass(engine);
  renderPass.cameraComponent = cameraComponent;
  renderPass.toClearColorBuffer = true;
  renderPass.clearColor = Rn.Vector4.fromCopyArray4([0.5, 0.5, 0.8, 1]);
  renderPass.addEntities(entities);

  // Collider wireframes are drawn in a second pass on top of the model (no depth test).
  const debugRenderPass = new Rn.RenderPass(engine);
  debugRenderPass.cameraComponent = cameraComponent;
  debugRenderPass.toClearColorBuffer = false;
  try { debugRenderPass.isDepthTest = false; } catch (e) {}
  debugRenderPass.addEntities(debugEntities);

  const expression = new Rn.Expression();
  expression.addRenderPasses([renderPass, debugRenderPass]);

  setWireframeVisible(showWireframe);

  // 1 ground (no walls) static entity before the eraser entities
  const physicsEntityOffset = 1;

  const draw = function () {
    world.step();

    for (let i = 0; i < bodies.length; i++) {
      const pos = bodies[i].translation();
      const ori = bodies[i].rotation();
      const entity = entities[physicsEntityOffset + i];
      entity.getTransform().localPosition = Rn.Vector3.fromCopyArray([pos.x, pos.y, pos.z]);
      entity.getTransform().localRotation = Rn.Quaternion.fromCopyArray([ori.x, ori.y, ori.z, ori.w]);

      const debugEntity = eraserDebugEntities[i];
      debugEntity.getTransform().localPosition = Rn.Vector3.fromCopyArray([pos.x, pos.y, pos.z]);
      debugEntity.getTransform().localRotation = Rn.Quaternion.fromCopyArray([ori.x, ori.y, ori.z, ori.w]);

      if (pos.y < -15) {
        const nx = (Math.random() - 0.5) * 12;
        const ny = 14 + Math.random() * 14;
        const nz = (Math.random() - 0.5) * 12;
        bodies[i].setTranslation({ x: nx, y: ny, z: nz }, true);
        bodies[i].setRotation(randomQuat(), true);
        bodies[i].setLinvel({ x: 0, y: 0, z: 0 }, true);
        bodies[i].setAngvel({ x: 0, y: 0, z: 0 }, true);
      }
    }

    engine.process([expression]);
    requestAnimationFrame(draw);
  };

  draw();
};

function setWireframeVisible(visible) {
  showWireframe = visible;
  for (const entity of debugEntities) {
    try { entity.getSceneGraph().isVisible = visible; } catch (e) {}
  }
  const hint = document.getElementById('hint');
  if (hint) {
    hint.textContent = 'W: wireframe ' + (visible ? 'ON' : 'OFF');
  }
}

window.addEventListener('keydown', (event) => {
  if (event.repeat) return;
  if (event.code === 'KeyW' || event.key === 'w' || event.key === 'W') {
    setWireframeVisible(!showWireframe);
  }
});

document.body.onload = load;
