import Rn from 'rhodonite';

const DUCK_GLTF_URL = 'https://cx20.github.io/gltf-test/sampleModels/Duck/glTF/Duck.gltf';
const TEXTURE_COIN_NORMAL = '../../../../assets/textures/rockn.png';

const PHYSICS_SCALE = 0.1;
const COIN_INTERVAL = 6;
const MAX_COINS = 6000;
const GROUND_Y = -10;
const FIXED_TIMESTEP = 1 / 60;
const IDENTITY_QUATERNION = [0, 0, 0, 1];

const COIN_TYPES = {
  GOLD: { color: [1.0, 0.766, 0.336, 1.0], height: 0.10, diameter: 1.0, metallic: 1.0, roughness: 0.22 },
  SILVER: { color: [0.972, 0.96, 0.915, 1.0], height: 0.075, diameter: 0.8, metallic: 1.0, roughness: 0.35 },
  COPPER: { color: [0.955, 0.637, 0.538, 1.0], height: 0.05, diameter: 0.6, metallic: 1.0, roughness: 0.28 },
};
const COIN_TYPE_NAMES = ['GOLD', 'SILVER', 'COPPER'];

let HK, worldId, engine;
const entities = [];
const debugEntities = [];
const coins = [];

let showWireframe = true;
const DEBUG_COLOR_STATIC = [0.2, 1.0, 0.4, 1.0];
const DEBUG_COLOR_DYNAMIC = [1.0, 0.5, 0.2, 1.0];

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function getNextPosition() {
  return [
    rand(-25, 25) * PHYSICS_SCALE,
    rand(10, 20) * PHYSICS_SCALE + 10,
    rand(-25, 25) * PHYSICS_SCALE,
  ];
}

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

function createStaticBody(size, pos) {
  const sRes = HK.HP_Shape_CreateBox([0, 0, 0], IDENTITY_QUATERNION, size);
  checkResult(sRes[0], 'HP_Shape_CreateBox static');
  const bRes = HK.HP_Body_Create();
  checkResult(bRes[0], 'HP_Body_Create static');
  const bodyId = bRes[1];
  HK.HP_Body_SetShape(bodyId, sRes[1]);
  HK.HP_Body_SetMotionType(bodyId, HK.MotionType.STATIC);
  HK.HP_Body_SetPosition(bodyId, pos);
  HK.HP_Body_SetOrientation(bodyId, IDENTITY_QUATERNION);
  HK.HP_World_AddBody(worldId, bodyId, false);
}

function getNumComponents(type) {
  if (type === 'SCALAR') return 1;
  if (type === 'VEC2') return 2;
  if (type === 'VEC3') return 3;
  if (type === 'VEC4') return 4;
  if (type === 'MAT2') return 4;
  if (type === 'MAT3') return 9;
  if (type === 'MAT4') return 16;
  throw new Error('Unsupported accessor type: ' + type);
}

function getAccessorData(json, bin, accessorIndex) {
  const accessor = json.accessors[accessorIndex];
  const bufferView = json.bufferViews[accessor.bufferView];
  const components = getNumComponents(accessor.type);
  const count = accessor.count;
  const byteOffset = (bufferView.byteOffset || 0) + (accessor.byteOffset || 0);

  let TypedArray = Float32Array;
  if (accessor.componentType === 5126) TypedArray = Float32Array;
  else if (accessor.componentType === 5125) TypedArray = Uint32Array;
  else if (accessor.componentType === 5123) TypedArray = Uint16Array;
  else if (accessor.componentType === 5122) TypedArray = Int16Array;
  else if (accessor.componentType === 5121) TypedArray = Uint8Array;
  else if (accessor.componentType === 5120) TypedArray = Int8Array;

  const byteStride = bufferView.byteStride || components * TypedArray.BYTES_PER_ELEMENT;

  if (byteStride !== components * TypedArray.BYTES_PER_ELEMENT) {
    const out = new TypedArray(count * components);
    const dataView = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
    for (let i = 0; i < count; i++) {
      for (let c = 0; c < components; c++) {
        const src = byteOffset + i * byteStride + c * TypedArray.BYTES_PER_ELEMENT;
        const dst = i * components + c;
        if (accessor.componentType === 5126) out[dst] = dataView.getFloat32(src, true);
        else if (accessor.componentType === 5125) out[dst] = dataView.getUint32(src, true);
        else if (accessor.componentType === 5123) out[dst] = dataView.getUint16(src, true);
        else if (accessor.componentType === 5122) out[dst] = dataView.getInt16(src, true);
        else if (accessor.componentType === 5121) out[dst] = dataView.getUint8(src);
        else out[dst] = dataView.getInt8(src);
      }
    }
    return out;
  }

  return new TypedArray(bin.buffer, bin.byteOffset + byteOffset, count * components);
}

function getMeshGeometry(json, bin, meshIndex) {
  const meshDef = json.meshes[meshIndex];
  if (!meshDef) return null;
  const positions = [];
  const indices = [];
  let vertexOffset = 0;

  for (const primitive of meshDef.primitives) {
    if (!primitive.attributes || primitive.attributes.POSITION === undefined) continue;

    const pos = getAccessorData(json, bin, primitive.attributes.POSITION);
    for (let i = 0; i < pos.length; i++) positions.push(pos[i]);

    if (primitive.indices !== undefined) {
      const idx = getAccessorData(json, bin, primitive.indices);
      for (let i = 0; i < idx.length; i++) indices.push(idx[i] + vertexOffset);
    } else {
      const vertexCount = pos.length / 3;
      for (let i = 0; i + 2 < vertexCount; i += 3) {
        indices.push(vertexOffset + i, vertexOffset + i + 1, vertexOffset + i + 2);
      }
    }

    vertexOffset += pos.length / 3;
  }

  return { positions, indices };
}

function buildCylinderGeometry(segments = 24) {
  const positions = [];
  const normals = [];
  const texcoords = [];
  const indices = [];

  for (let i = 0; i <= segments; i++) {
    const u = i / segments;
    const a = u * Math.PI * 2;
    const x = Math.cos(a) * 0.5;
    const z = Math.sin(a) * 0.5;
    positions.push(x, -0.5, z, x, 0.5, z);
    normals.push(Math.cos(a), 0, Math.sin(a), Math.cos(a), 0, Math.sin(a));
    texcoords.push(u, 0, u, 1);
  }

  for (let i = 0; i < segments; i++) {
    const b = i * 2;
    indices.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
  }

  const topCenter = positions.length / 3;
  positions.push(0, 0.5, 0);
  normals.push(0, 1, 0);
  texcoords.push(0.5, 0.5);
  const topStart = positions.length / 3;
  for (let i = 0; i <= segments; i++) {
    const u = i / segments;
    const a = u * Math.PI * 2;
    const x = Math.cos(a) * 0.5;
    const z = Math.sin(a) * 0.5;
    positions.push(x, 0.5, z);
    normals.push(0, 1, 0);
    texcoords.push(0.5 + x, 0.5 + z);
  }
  for (let i = 0; i < segments; i++) {
    indices.push(topCenter, topStart + i + 1, topStart + i);
  }

  const bottomCenter = positions.length / 3;
  positions.push(0, -0.5, 0);
  normals.push(0, -1, 0);
  texcoords.push(0.5, 0.5);
  const bottomStart = positions.length / 3;
  for (let i = 0; i <= segments; i++) {
    const u = i / segments;
    const a = u * Math.PI * 2;
    const x = Math.cos(a) * 0.5;
    const z = Math.sin(a) * 0.5;
    positions.push(x, -0.5, z);
    normals.push(0, -1, 0);
    texcoords.push(0.5 + x, 0.5 + z);
  }
  for (let i = 0; i < segments; i++) {
    indices.push(bottomCenter, bottomStart + i, bottomStart + i + 1);
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    texcoords: new Float32Array(texcoords),
    indices: new Uint16Array(indices),
  };
}

async function loadDuckCoinPositions() {
  const gltfResponse = await fetch(DUCK_GLTF_URL);
  const json = await gltfResponse.json();
  const bufferUri = new URL(json.buffers[0].uri, DUCK_GLTF_URL).toString();
  const bin = new Uint8Array(await (await fetch(bufferUri)).arrayBuffer());

  let meshIndex = 0;
  if (json.nodes && json.nodes.length > 0) {
    const nodeWithMesh = json.nodes.find((n) => n && n.mesh !== undefined);
    if (nodeWithMesh) meshIndex = nodeWithMesh.mesh;
  }

  const geometry = getMeshGeometry(json, bin, meshIndex);
  if (!geometry || geometry.positions.length === 0) {
    throw new Error('Duck.gltf has no readable POSITION data.');
  }

  const coinPositions = [];
  const sourceIndices = geometry.indices;
  const sourcePositions = geometry.positions;

  for (let i = 0; i < sourceIndices.length && coinPositions.length < MAX_COINS; i += COIN_INTERVAL) {
    const v = sourceIndices[i];
    coinPositions.push([
      sourcePositions[v * 3 + 0] * PHYSICS_SCALE,
      sourcePositions[v * 3 + 1] * PHYSICS_SCALE + GROUND_Y,
      sourcePositions[v * 3 + 2] * PHYSICS_SCALE,
    ]);
  }

  return coinPositions;
}

function buildVisualMeshes(normalTexture, normalSampler) {
  const cylinder = buildCylinderGeometry(32);
  const meshesByType = {};

  for (const typeName of COIN_TYPE_NAMES) {
    const params = COIN_TYPES[typeName];
    const mat = Rn.MaterialHelper.createPbrUberMaterial(engine, { isLighting: true });
    mat.setParameter('baseColorFactor', Rn.Vector4.fromCopyArray4(params.color));
    try { mat.setParameter('metallicFactor', params.metallic); } catch (e) {}
    try { mat.setParameter('roughnessFactor', params.roughness); } catch (e) {}
    try { mat.setTextureParameter('normalTexture', normalTexture, normalSampler); } catch (e) {}
    try { mat.setTextureParameter('normalMapTexture', normalTexture, normalSampler); } catch (e) {}
    try { mat.setParameter('normalScale', Rn.Vector2.fromCopyArray2([0.6, 0.6])); } catch (e) {}

    const primitive = Rn.Primitive.createPrimitive(engine, {
      indices: cylinder.indices,
      attributeSemantics: [
        Rn.VertexAttribute.Position.XYZ,
        Rn.VertexAttribute.Normal.XYZ,
        Rn.VertexAttribute.Texcoord0.XY,
      ],
      attributes: [cylinder.positions, cylinder.normals, cylinder.texcoords],
      material: mat,
      primitiveMode: Rn.PrimitiveMode.Triangles,
    });
    const mesh = new Rn.Mesh(engine);
    mesh.addPrimitive(primitive);
    meshesByType[typeName] = mesh;
  }

  return meshesByType;
}

function createTypeData() {
  const typeData = {};
  for (const typeName of COIN_TYPE_NAMES) {
    const params = COIN_TYPES[typeName];
    const radius = params.diameter * 0.5;

    const shapeRes = HK.HP_Shape_CreateSphere([0, 0, 0], radius);
    checkResult(shapeRes[0], 'HP_Shape_CreateSphere ' + typeName);
    const shapeId = shapeRes[1];

    HK.HP_Shape_SetDensity(shapeId, 1);
    const massRes = HK.HP_Shape_BuildMassProperties(shapeId);
    checkResult(massRes[0], 'HP_Shape_BuildMassProperties ' + typeName);

    typeData[typeName] = {
      shapeId,
      massProps: massRes[1],
      radius,
      scale: [params.diameter, params.height, params.diameter],
      debugScale: [params.diameter, params.diameter, params.diameter],
    };
  }
  return typeData;
}

function spawnCoins(coinPositions, meshesByType, debugSphereMesh, typeData) {
  for (let i = 0; i < coinPositions.length; i++) {
    const typeName = COIN_TYPE_NAMES[Math.floor(Math.random() * COIN_TYPE_NAMES.length)];
    const td = typeData[typeName];

    const bodyRes = HK.HP_Body_Create();
    checkResult(bodyRes[0], 'HP_Body_Create coin');
    const bodyId = bodyRes[1];
    HK.HP_Body_SetShape(bodyId, td.shapeId);
    HK.HP_Body_SetMotionType(bodyId, HK.MotionType.DYNAMIC);
    HK.HP_Body_SetMassProperties(bodyId, td.massProps);
    HK.HP_Body_SetPosition(bodyId, coinPositions[i]);
    HK.HP_Body_SetOrientation(bodyId, IDENTITY_QUATERNION);
    HK.HP_World_AddBody(worldId, bodyId, false);

    const coinEntity = Rn.createMeshEntity(engine);
    coinEntity.getMesh().setMesh(meshesByType[typeName]);
    coinEntity.getTransform().localScale = Rn.Vector3.fromCopyArray(td.scale);
    entities.push(coinEntity);

    const debugEntity = Rn.createMeshEntity(engine);
    debugEntity.getMesh().setMesh(debugSphereMesh);
    debugEntity.getTransform().localScale = Rn.Vector3.fromCopyArray(td.debugScale);
    debugEntities.push(debugEntity);

    coins.push({ bodyId, coinEntity, debugEntity });
  }
}

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

async function load() {
  HK = await HavokPhysics();

  const canvas = document.getElementById('world');
  engine = await Rn.Engine.init({
    approach: Rn.ProcessApproach.DataTexture,
    canvas,
  });

  function resizeCanvas() {
    engine.resizeCanvas(window.innerWidth, window.innerHeight);
  }
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  const worldRes = HK.HP_World_Create();
  checkResult(worldRes[0], 'HP_World_Create');
  worldId = worldRes[1];
  checkResult(HK.HP_World_SetGravity(worldId, [0, -9.81, 0]), 'HP_World_SetGravity');
  checkResult(HK.HP_World_SetIdealStepTime(worldId, FIXED_TIMESTEP), 'HP_World_SetIdealStepTime');

  const normalSampler = new Rn.Sampler(engine, {
    magFilter: Rn.TextureParameter.Linear,
    minFilter: Rn.TextureParameter.Linear,
    wrapS: Rn.TextureParameter.Repeat,
    wrapT: Rn.TextureParameter.Repeat,
  });
  const normalTexture = await Rn.Texture.loadFromUrl(engine, TEXTURE_COIN_NORMAL);

  createStaticBody([20, 1, 20], [0, GROUND_Y - 0.5, 0]);
  const groundMat = Rn.MaterialHelper.createPbrUberMaterial(engine, { isLighting: true });
  groundMat.setParameter('baseColorFactor', Rn.Vector4.fromCopyArray4([0.25, 0.26, 0.28, 1.0]));
  try { groundMat.setParameter('metallicFactor', 0.05); } catch (e) {}
  try { groundMat.setParameter('roughnessFactor', 0.85); } catch (e) {}
  const groundEntity = Rn.MeshHelper.createCube(engine, { material: groundMat });
  groundEntity.getTransform().localPosition = Rn.Vector3.fromCopyArray([0, GROUND_Y - 0.5, 0]);
  groundEntity.getTransform().localScale = Rn.Vector3.fromCopyArray([20, 1, 20]);
  entities.push(groundEntity);
  createDebugBox([20, 1, 20], [0, GROUND_Y - 0.5, 0], DEBUG_COLOR_STATIC);

  const meshesByType = buildVisualMeshes(normalTexture, normalSampler);

  const debugHelper = Rn.MeshHelper.createSphere(engine, {
    radius: 0.5,
    widthSegments: 10,
    heightSegments: 8,
    material: makeDebugMaterial(DEBUG_COLOR_DYNAMIC),
  });
  try { debugHelper.getSceneGraph().isVisible = false; } catch (e) {}
  const debugSphereMesh = debugHelper.getMesh().mesh;
  try {
    for (const prim of debugSphereMesh.primitives) prim.convertToUnindexedGeometry();
    debugSphereMesh._calcBaryCentricCoord();
  } catch (e) { console.warn('[Coins] baryCentric failed:', e); }

  const typeData = createTypeData();
  const coinPositions = await loadDuckCoinPositions();
  spawnCoins(coinPositions, meshesByType, debugSphereMesh, typeData);
  console.log('Total coins:', coins.length);

  const cameraEntity = Rn.createCameraControllerEntity(engine);
  cameraEntity.localPosition = Rn.Vector3.fromCopyArray([0, -2, 20]);
  cameraEntity.localEulerAngles = Rn.Vector3.fromCopyArray([-0.24, 0, 0]);
  const cameraComponent = cameraEntity.getCamera();
  cameraComponent.zNear = 0.1;
  cameraComponent.zFar = 1000;
  cameraComponent.setFovyAndChangeFocalLength(60);
  cameraComponent.aspect = window.innerWidth / window.innerHeight;

  const lightEntity1 = Rn.createLightEntity(engine);
  const lc1 = lightEntity1.getLight();
  lc1.type = Rn.LightType.Directional;
  lc1.intensity = 1.6;
  lightEntity1.localEulerAngles = Rn.Vector3.fromCopyArray([-Math.PI / 4, Math.PI / 6, 0]);

  const lightEntity2 = Rn.createLightEntity(engine);
  const lc2 = lightEntity2.getLight();
  lc2.type = Rn.LightType.Directional;
  lc2.intensity = 0.7;
  lightEntity2.localEulerAngles = Rn.Vector3.fromCopyArray([Math.PI / 4, -Math.PI / 4, 0]);

  const renderPass = new Rn.RenderPass(engine);
  renderPass.cameraComponent = cameraComponent;
  renderPass.toClearColorBuffer = true;
  renderPass.clearColor = Rn.Vector4.fromCopyArray4([0.12, 0.12, 0.14, 1.0]);
  renderPass.addEntities(entities);

  const debugRenderPass = new Rn.RenderPass(engine);
  debugRenderPass.cameraComponent = cameraComponent;
  debugRenderPass.toClearColorBuffer = false;
  try { debugRenderPass.isDepthTest = false; } catch (e) {}
  debugRenderPass.addEntities(debugEntities);

  const expression = new Rn.Expression();
  expression.addRenderPasses([renderPass, debugRenderPass]);

  setWireframeVisible(showWireframe);

  window.addEventListener('keydown', (event) => {
    if (event.repeat) return;
    if (event.code === 'KeyW' || event.key === 'w' || event.key === 'W') {
      setWireframeVisible(!showWireframe);
    }
  });

  window.addEventListener('click', () => {
    for (const coin of coins) {
      HK.HP_Body_SetLinearVelocity(coin.bodyId, [rand(-1, 1), rand(3, 6), rand(-1, 1)]);
    }
  });

  let orbitAngle = 0;
  const draw = function() {
    HK.HP_World_Step(worldId, FIXED_TIMESTEP);

    for (let i = 0; i < coins.length; i++) {
      const coin = coins[i];
      const [, pos] = HK.HP_Body_GetPosition(coin.bodyId);
      const [, ori] = HK.HP_Body_GetOrientation(coin.bodyId);

      coin.coinEntity.getTransform().localPosition = Rn.Vector3.fromCopyArray([pos[0], pos[1], pos[2]]);
      coin.coinEntity.getTransform().localRotation = Rn.Quaternion.fromCopyArray([ori[0], ori[1], ori[2], ori[3]]);

      coin.debugEntity.getTransform().localPosition = Rn.Vector3.fromCopyArray([pos[0], pos[1], pos[2]]);
      coin.debugEntity.getTransform().localRotation = Rn.Quaternion.fromCopyArray([ori[0], ori[1], ori[2], ori[3]]);

      if (pos[1] < -50) {
        const newPos = getNextPosition();
        HK.HP_Body_SetPosition(coin.bodyId, newPos);
        HK.HP_Body_SetOrientation(coin.bodyId, IDENTITY_QUATERNION);
        HK.HP_Body_SetLinearVelocity(coin.bodyId, [0, 0, 0]);
        HK.HP_Body_SetAngularVelocity(coin.bodyId, [0, 0, 0]);
      }
    }

    orbitAngle += 0.003;
    cameraEntity.localPosition = Rn.Vector3.fromCopyArray([
      Math.sin(orbitAngle) * 20,
      -2,
      Math.cos(orbitAngle) * 20,
    ]);
    cameraEntity.localEulerAngles = Rn.Vector3.fromCopyArray([-0.24, orbitAngle, 0]);

    engine.process([expression]);
    requestAnimationFrame(draw);
  };
  draw();
}

document.body.onload = load;
