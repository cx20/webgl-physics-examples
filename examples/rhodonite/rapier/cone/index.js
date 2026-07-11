import Rn from 'rhodonite';

// Rhodonite (rendering) + Rapier (physics, raw world/rigid-body API). Carrot cones rain into a
// walled pen; each collider is a Rapier cone matching the visual cone. Mirrors the Havok sample.

const CONE_COUNT = 200;
const CONE_HALF_HEIGHT = 2;
const CONE_RADIUS = 1;

let RAPIER, world, engine;
const entities = [];
const bodies = [];

let showWireframe = true;
const debugEntities = [];        // all collider wireframes (for the W toggle)
const coneDebugEntities = [];    // per-cone wireframes, parallel to bodies
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

// Static box body. Rapier cuboid takes half-extents; the sizes here are full side lengths.
function createStaticBox(size, pos) {
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(pos[0], pos[1], pos[2]));
  world.createCollider(RAPIER.ColliderDesc.cuboid(size[0] / 2, size[1] / 2, size[2] / 2), body);
}

function buildConeGeometry(halfHeight, radius, segments = 20) {
  const posArr = [];
  const normArr = [];
  const uvArr = [];
  const idxArr = [];

  const slopeLen = Math.sqrt(radius * radius + (2 * halfHeight) * (2 * halfHeight));
  const ny = radius / slopeLen;
  const nr = (2 * halfHeight) / slopeLen;

  posArr.push(0, halfHeight, 0);
  normArr.push(0, 1, 0);
  uvArr.push(0.5, 0);

  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const cx = Math.cos(a);
    const cz = Math.sin(a);
    posArr.push(radius * cx, -halfHeight, radius * cz);
    normArr.push(nr * cx, ny, nr * cz);
    uvArr.push(i / segments, 1);
  }

  for (let i = 0; i < segments; i++) {
    idxArr.push(0, i + 2, i + 1);
  }

  const capCenter = posArr.length / 3;
  posArr.push(0, -halfHeight, 0);
  normArr.push(0, -1, 0);
  uvArr.push(0.5, 0.5);

  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    posArr.push(radius * Math.cos(a), -halfHeight, radius * Math.sin(a));
    normArr.push(0, -1, 0);
    uvArr.push(0.5 + 0.5 * Math.cos(a), 0.5 + 0.5 * Math.sin(a));
  }

  for (let i = 0; i < segments; i++) {
    idxArr.push(capCenter, capCenter + i + 1, capCenter + i + 2);
  }

  return {
    positions: new Float32Array(posArr),
    normals: new Float32Array(normArr),
    texcoords: new Float32Array(uvArr),
    indices: new Uint16Array(idxArr),
  };
}

// Clean low-poly cone wireframe (apex + base ring, side faces only, no base-cap fan)
// so the collider outline is readable rather than a dense fan of lines.
function buildConeWireGeometry(halfHeight, radius, segments = 12) {
  const pos = [0, halfHeight, 0];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    pos.push(radius * Math.cos(a), -halfHeight, radius * Math.sin(a));
  }
  const idx = [];
  for (let i = 0; i < segments; i++) {
    idx.push(0, 1 + i, 1 + ((i + 1) % segments));
  }
  return { positions: new Float32Array(pos), indices: new Uint16Array(idx) };
}

const load = async function() {
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
  const carrotTex = await Rn.Texture.loadFromUrl(engine, '../../../../assets/textures/carrot.jpg');

  // Ground
  createStaticBox([40, 4, 40], [0, -2, 0]);
  const groundMat = Rn.MaterialHelper.createPbrUberMaterial(engine, { isLighting: true });
  groundMat.setParameter('baseColorFactor', Rn.Vector4.fromCopyArray4([0.24, 0.25, 0.26, 1]));
  const groundEntity = Rn.MeshHelper.createCube(engine, { material: groundMat });
  groundEntity.getTransform().localPosition = Rn.Vector3.fromCopyArray([0, -2, 0]);
  groundEntity.getTransform().localScale = Rn.Vector3.fromCopyArray([40, 4, 40]);
  entities.push(groundEntity);
  createDebugBox([40, 4, 40], [0, -2, 0], DEBUG_COLOR_STATIC);

  // Walls
  const wallDefs = [
    { size: [10, 10, 1], pos: [0, 5, -5] },
    { size: [10, 10, 1], pos: [0, 5,  5] },
    { size: [1, 10, 10], pos: [-5, 5, 0] },
    { size: [1, 10, 10], pos: [ 5, 5, 0] },
  ];
  const wallMat = Rn.MaterialHelper.createPbrUberMaterial(engine, { isLighting: true });
  wallMat.setParameter('baseColorFactor', Rn.Vector4.fromCopyArray4([0.24, 0.25, 0.26, 0.4]));
  for (const { size, pos } of wallDefs) {
    createStaticBox(size, pos);
    const wallEntity = Rn.MeshHelper.createCube(engine, { material: wallMat });
    wallEntity.getTransform().localPosition = Rn.Vector3.fromCopyArray(pos);
    wallEntity.getTransform().localScale = Rn.Vector3.fromCopyArray(size);
    entities.push(wallEntity);
    createDebugBox(size, pos, DEBUG_COLOR_STATIC);
  }

  // Shared material, primitive, mesh — created ONCE for all cones
  const sharedMat = Rn.MaterialHelper.createPbrUberMaterial(engine, { isLighting: true });
  sharedMat.setTextureParameter('baseColorTexture', carrotTex, sampler);
  // Cull back faces so the cone's far (inner) wall doesn't z-fight with the near wall.
  sharedMat.cullFace = true;
  sharedMat.cullFaceBack = true;

  const coneGeo = buildConeGeometry(CONE_HALF_HEIGHT, CONE_RADIUS, 20);
  const sharedPrimitive = Rn.Primitive.createPrimitive(engine, {
    indices: coneGeo.indices,
    attributeSemantics: [
      Rn.VertexAttribute.Position.XYZ,
      Rn.VertexAttribute.Normal.XYZ,
      Rn.VertexAttribute.Texcoord0.XY,
    ],
    attributes: [coneGeo.positions, coneGeo.normals, coneGeo.texcoords],
    material: sharedMat,
    primitiveMode: Rn.PrimitiveMode.Triangles,
  });
  const sharedMesh = new Rn.Mesh(engine);
  sharedMesh.addPrimitive(sharedPrimitive);

  // Shared cone-shaped collider wireframe (one mesh reused by every cone, like the visual mesh,
  // so the debug pass instances rather than issuing 200 separate draws). The wireframe shader
  // needs un-indexed geometry + barycentric coords (what MeshComponent.calcBaryCentricCoord does).
  const coneWireGeo = buildConeWireGeometry(CONE_HALF_HEIGHT, CONE_RADIUS, 12);
  const coneWirePrimitive = Rn.Primitive.createPrimitive(engine, {
    indices: coneWireGeo.indices,
    attributeSemantics: [Rn.VertexAttribute.Position.XYZ],
    attributes: [coneWireGeo.positions],
    material: makeDebugMaterial(DEBUG_COLOR_DYNAMIC),
    primitiveMode: Rn.PrimitiveMode.Triangles,
  });
  const coneWireMesh = new Rn.Mesh(engine);
  coneWireMesh.addPrimitive(coneWirePrimitive);
  try {
    for (const prim of coneWireMesh.primitives) prim.convertToUnindexedGeometry();
    coneWireMesh._calcBaryCentricCoord();
  } catch (e) { console.warn('[Cone] baryCentric failed:', e); }

  for (let i = 0; i < CONE_COUNT; i++) {
    const x = -3.5 + Math.random() * 7;
    const y = 20 + Math.random() * 10;
    const z = -3.5 + Math.random() * 7;

    const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z));
    // Rapier cone: apex up along +Y, half-height and base radius match the visual mesh.
    world.createCollider(RAPIER.ColliderDesc.cone(CONE_HALF_HEIGHT, CONE_RADIUS).setDensity(1), body);
    bodies.push(body);

    const entity = Rn.createMeshEntity(engine);
    entity.getMesh().setMesh(sharedMesh);
    entities.push(entity);

    const debugEntity = Rn.createMeshEntity(engine);
    debugEntity.getMesh().setMesh(coneWireMesh);
    debugEntities.push(debugEntity);
    coneDebugEntities.push(debugEntity);
  }

  // Camera
  const cameraEntity = Rn.createCameraControllerEntity(engine);
  cameraEntity.localPosition = Rn.Vector3.fromCopyArray([18, 20, 30]);
  cameraEntity.localEulerAngles = Rn.Vector3.fromCopyArray([-0.55, 0.52, 0]);
  const cameraComponent = cameraEntity.getCamera();
  // Larger zNear (and tighter zFar) for better depth-buffer precision; the camera orbits far
  // from the scene, so this avoids the cones z-fighting. (0.01 / 1000 was far too wide a range.)
  cameraComponent.zNear = 1.0;
  cameraComponent.zFar = 200;
  cameraComponent.setFovyAndChangeFocalLength(60);
  cameraComponent.aspect = window.innerWidth / window.innerHeight;

  // Lights
  const lightEntity1 = Rn.createLightEntity(engine);
  const lc1 = lightEntity1.getLight();
  lc1.type = Rn.LightType.Directional;
  lc1.intensity = 1;
  lightEntity1.localEulerAngles = Rn.Vector3.fromCopyArray([-Math.PI / 4, Math.PI / 6, 0]);
  const lightEntity2 = Rn.createLightEntity(engine);
  const lc2 = lightEntity2.getLight();
  lc2.type = Rn.LightType.Directional;
  lc2.intensity = 0.5;
  lightEntity2.localEulerAngles = Rn.Vector3.fromCopyArray([Math.PI / 4, -Math.PI / 4, 0]);

  // RenderPass
  const renderPass = new Rn.RenderPass(engine);
  renderPass.cameraComponent = cameraComponent;
  renderPass.toClearColorBuffer = true;
  renderPass.clearColor = Rn.Vector4.fromCopyArray4([0.24, 0.25, 0.26, 1]);
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

  // 1 ground + 4 walls = 5 static entities before cone entities
  const physicsEntityOffset = 5;

  let angle = 0;
  const draw = function() {
    world.step();

    for (let i = 0; i < bodies.length; i++) {
      const pos = bodies[i].translation();
      const ori = bodies[i].rotation();
      const entity = entities[physicsEntityOffset + i];
      entity.getTransform().localPosition = Rn.Vector3.fromCopyArray([pos.x, pos.y, pos.z]);
      entity.getTransform().localRotation = Rn.Quaternion.fromCopyArray([ori.x, ori.y, ori.z, ori.w]);

      const debugEntity = coneDebugEntities[i];
      debugEntity.getTransform().localPosition = Rn.Vector3.fromCopyArray([pos.x, pos.y, pos.z]);
      debugEntity.getTransform().localRotation = Rn.Quaternion.fromCopyArray([ori.x, ori.y, ori.z, ori.w]);

      if (pos.y < -10) {
        const nx = -5 + Math.random() * 10;
        const ny = 20 + Math.random() * 10;
        const nz = -5 + Math.random() * 10;
        bodies[i].setTranslation({ x: nx, y: ny, z: nz }, true);
        bodies[i].setLinvel({ x: 0, y: 0, z: 0 }, true);
        bodies[i].setAngvel({ x: 0, y: 0, z: 0 }, true);
      }
    }

    angle += 0.005;
    cameraEntity.localPosition = Rn.Vector3.fromCopyArray([
      Math.sin(angle) * 34,
      20,
      Math.cos(angle) * 34,
    ]);
    cameraEntity.localEulerAngles = Rn.Vector3.fromCopyArray([-0.55, angle, 0]);

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
