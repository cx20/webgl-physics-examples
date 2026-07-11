import Rn from 'rhodonite';

const DOT_SIZE = 10;
const PHYSICS_SCALE = 1/10;

let entities = [];
let shogiPieces = [];
let world;
let bodies = [];
let RAPIER;
let engine;

let showWireframe = true;
const debugEntities = [];         // all collider wireframes (for the W toggle)
const pieceDebugEntities = [];    // per-piece wireframes, parallel to shogiPieces
const DEBUG_COLOR_DYNAMIC = [1.0, 0.5, 0.2, 1.0];
const DEBUG_COLOR_STATIC = [0.2, 1.0, 0.4, 1.0];

// Rapier has no Euler helper; build a quaternion from XYZ Euler angles (degrees).
function eulerDegToQuat(xDeg, yDeg, zDeg) {
  const x = xDeg * Math.PI / 180, y = yDeg * Math.PI / 180, z = zDeg * Math.PI / 180;
  const cx = Math.cos(x / 2), sx = Math.sin(x / 2);
  const cy = Math.cos(y / 2), sy = Math.sin(y / 2);
  const cz = Math.cos(z / 2), sz = Math.sin(z / 2);
  return {
    x: sx * cy * cz + cx * sy * sz,
    y: cx * sy * cz - sx * cy * sz,
    z: cx * cy * sz - sx * sy * cz,
    w: cx * cy * cz + sx * sy * sz,
  };
}

// Mirror the Rhodonite + Havok shogi sample: PbrUber + RN_USE_WIREFRAME, with
// barycentric coords on the mesh so the wireframe shader can draw the edges.
function makeDebugMaterial(color) {
  const mat = Rn.MaterialHelper.createPbrUberMaterial(engine, { isLighting: false, isSkinning: false, isMorphing: false });
  try { mat.addShaderDefine('RN_USE_WIREFRAME'); } catch (e) {}
  try { mat.setParameter('wireframe', Rn.Vector3.fromCopy3(1, 0, 1)); } catch (e) {}
  try { mat.setParameter('baseColorFactor', Rn.Vector4.fromCopyArray4(color)); } catch (e) {}
  return mat;
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

// Build a collider-wireframe mesh (full size w x h x d). The wireframe shader needs
// un-indexed geometry + barycentric coords (what _calcBaryCentricCoord adds).
function makeWireMesh(w, h, d, color) {
  const geo = buildBoxGeometry(w, h, d);
  const primitive = Rn.Primitive.createPrimitive(engine, {
    indices: geo.indices,
    attributeSemantics: [Rn.VertexAttribute.Position.XYZ],
    attributes: [geo.positions],
    material: makeDebugMaterial(color),
    primitiveMode: Rn.PrimitiveMode.Triangles,
  });
  const mesh = new Rn.Mesh(engine);
  mesh.addPrimitive(primitive);
  try {
    for (const prim of mesh.primitives) prim.convertToUnindexedGeometry();
    mesh._calcBaryCentricCoord();
  } catch (e) { console.warn('[Shogi] baryCentric failed:', e); }
  return mesh;
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

window.addEventListener('keydown', (event) => {
  if (event.repeat) return;
  if (event.code === 'KeyW' || event.key === 'w' || event.key === 'W') {
    setWireframeVisible(!showWireframe);
  }
});

const load = async function() {
    const c = document.getElementById('world');

    engine = await Rn.Engine.init({
      approach: Rn.ProcessApproach.DataTexture,
      canvas: c,
    });

    resizeCanvas();

    window.addEventListener("resize", function(){
        resizeCanvas();
    });

    function resizeCanvas() {
        engine.resizeCanvas(window.innerWidth, window.innerHeight);
    }

    // Rhodonite v0.19.9 added a Rapier physics backend. This sample drives Rapier
    // directly (raw world/rigid-body API) because the shogi piece uses a custom
    // mesh with a box collider, mirroring the Oimo version.
    RAPIER = (await import('https://cdn.skypack.dev/@dimforge/rapier3d-compat@0.17.3')).default;
    await RAPIER.init();

    // Initialize physics world
    world = new RAPIER.World({ x: 0, y: -9.8, z: 0 });

    // Create ground (physics). Oimo box "size" is full width; Rapier cuboid takes half-extents.
    const groundSize = [7.5, 0.2, 7.5];
    const groundY = -1;
    const groundBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, groundY, 0));
    world.createCollider(
        RAPIER.ColliderDesc.cuboid(groundSize[0] / 2, groundSize[1] / 2, groundSize[2] / 2)
            .setFriction(0.5).setRestitution(0.2),
        groundBody
    );

    // Load shogi texture
    const shogiTexture = await Rn.Texture.loadFromUrl(engine, '../../../../assets/textures/shogi_001/shogi.png');
    const sampler = new Rn.Sampler(engine, {
      magFilter: Rn.TextureParameter.Linear,
      minFilter: Rn.TextureParameter.Linear,
      wrapS: Rn.TextureParameter.Repeat,
      wrapT: Rn.TextureParameter.Repeat,
    });

    // Create ground visual (match physics size - Rhodonite Cube uses half-extent)
    const groundEntity = Rn.createMeshEntity(engine);
    const groundPrimitive = new Rn.Cube(engine);
    groundPrimitive.generate({
        widthVector: Rn.Vector3.fromCopyArray([groundSize[0] / 1, groundSize[1] / 1, groundSize[2] / 1]),
    });
    const groundMaterial = Rn.MaterialHelper.createPbrUberMaterial(engine, {
        isLighting: true
    });
    groundMaterial.setParameter('baseColorFactor', Rn.Vector3.fromCopyArray([0.4, 0.6, 0.4, 1.0]));
    groundPrimitive.material = groundMaterial;
    const groundMesh = new Rn.Mesh(engine);
    groundMesh.addPrimitive(groundPrimitive);
    groundEntity.getMesh().setMesh(groundMesh);
    groundEntity.getTransform().localPosition = Rn.Vector3.fromCopyArray([0, groundY, 0]);
    entities.push(groundEntity);

    // Ground collider wireframe (matches the ground box, which is full size)
    const groundDebugEntity = Rn.createMeshEntity(engine);
    groundDebugEntity.getMesh().setMesh(makeWireMesh(groundSize[0], groundSize[1], groundSize[2], DEBUG_COLOR_STATIC));
    groundDebugEntity.getTransform().localPosition = Rn.Vector3.fromCopyArray([0, groundY, 0]);
    debugEntities.push(groundDebugEntity);

    // Create shogi pieces
    populate(shogiTexture, sampler);

    // camera
    const cameraEntity = Rn.createCameraControllerEntity(engine);
    cameraEntity.localPosition = Rn.Vector3.fromCopyArray([0, 5, 15]);
    const cameraComponent = cameraEntity.getCamera();
    cameraComponent.zNear = 0.1;
    cameraComponent.zFar = 1000;
    cameraComponent.setFovyAndChangeFocalLength(45);
    cameraComponent.aspect = window.innerWidth / window.innerHeight;

    // Lights
    const lightEntity1 = Rn.createLightEntity(engine);
    const lightComponent1 = lightEntity1.getLight();
    lightComponent1.type = Rn.LightType.Directional;
    lightComponent1.intensity = 1.5;
    lightEntity1.localEulerAngles = Rn.Vector3.fromCopyArray([-Math.PI / 4, Math.PI / 6, 0]);

    const lightEntity2 = Rn.createLightEntity(engine);
    const lightComponent2 = lightEntity2.getLight();
    lightComponent2.type = Rn.LightType.Directional;
    lightComponent2.intensity = 0.8;
    lightEntity2.localEulerAngles = Rn.Vector3.fromCopyArray([Math.PI / 4, -Math.PI / 6, 0]);

    // renderPass
    const renderPass = new Rn.RenderPass(engine);
    renderPass.cameraComponent = cameraComponent;
    renderPass.toClearColorBuffer = true;
    renderPass.clearColor = Rn.Vector4.fromCopyArray4([0.2, 0.2, 0.2, 1]);
    renderPass.addEntities(entities);

    // Collider wireframes are drawn in a second pass on top of the model (no depth test).
    const debugRenderPass = new Rn.RenderPass(engine);
    debugRenderPass.cameraComponent = cameraComponent;
    debugRenderPass.toClearColorBuffer = false;
    try { debugRenderPass.isDepthTest = false; } catch (e) {}
    debugRenderPass.addEntities(debugEntities);

    // expression
    const expression = new Rn.Expression();
    expression.addRenderPasses([renderPass, debugRenderPass]);

    setWireframeVisible(showWireframe);

    let angle = 0;
    const draw = function(time) {
        // Update physics
        world.step();

        // Update shogi piece positions from physics
        for (let i = 0; i < shogiPieces.length; i++) {
            const body = bodies[i];
            const entity = shogiPieces[i];

            const pos = body.translation();
            const quat = body.rotation();

            // If piece falls below the ground, reset it to above
            if (pos.y < -10) {
                const newX = (Math.random() - 0.5) * 5;
                const newY = 10 + Math.random() * 10;
                const newZ = (Math.random() - 0.5) * 5;
                body.setTranslation({ x: newX, y: newY, z: newZ }, true);
                body.setRotation(eulerDegToQuat(Math.random() * 360, Math.random() * 360, Math.random() * 360), true);
                body.setLinvel({ x: 0, y: 0, z: 0 }, true);
                body.setAngvel({ x: 0, y: 0, z: 0 }, true);
            }

            entity.getTransform().localPosition = Rn.Vector3.fromCopyArray([pos.x, pos.y, pos.z]);
            entity.getTransform().localRotation = Rn.Quaternion.fromCopyArray([quat.x, quat.y, quat.z, quat.w]);

            const debugEntity = pieceDebugEntities[i];
            debugEntity.getTransform().localPosition = Rn.Vector3.fromCopyArray([pos.x, pos.y, pos.z]);
            debugEntity.getTransform().localRotation = Rn.Quaternion.fromCopyArray([quat.x, quat.y, quat.z, quat.w]);
        }

        // Rotate camera around the scene
        angle += 0.01;
        cameraEntity.localPosition = Rn.Vector3.fromCopyArray([
            Math.sin(angle) * 15,
            5,
            Math.cos(angle) * 15
        ]);
        cameraEntity.localEulerAngles = Rn.Vector3.fromCopyArray([
            -0.3,
            angle,
            0
        ]);

        engine.process([expression]);

        requestAnimationFrame(draw);
    }

    draw();

}

function populate(shogiTexture, sampler) {
    const max = 300;
    const w = DOT_SIZE * 0.8 * 1.0;
    const h = DOT_SIZE * 0.8 * 1.0;
    const d = DOT_SIZE * 0.8 * 0.2;

    // Create shogi piece geometry (same as raw WebGL version)
    const positions = new Float32Array([
        // Front face
        -0.5 * w,  -0.5 * h,  0.7 * d, // v0
         0.5 * w,  -0.5 * h,  0.7 * d, // v1
         0.35 * w,  0.5 * h,  0.4 * d, // v2
        -0.35 * w,  0.5 * h,  0.4 * d, // v3
        // Back face
        -0.5 * w,  -0.5 * h, -0.7 * d, // v4
         0.5 * w,  -0.5 * h, -0.7 * d, // v5
         0.35 * w,  0.5 * h, -0.4 * d, // v6
        -0.35 * w,  0.5 * h, -0.4 * d, // v7
        // Top face
         0.35 * w,  0.5 * h,  0.4 * d, // v2
        -0.35 * w,  0.5 * h,  0.4 * d, // v3
        -0.35 * w,  0.5 * h, -0.4 * d, // v7
         0.35 * w,  0.5 * h, -0.4 * d, // v6
        // Bottom face
        -0.5 * w,  -0.5 * h,  0.7 * d, // v0
         0.5 * w,  -0.5 * h,  0.7 * d, // v1
         0.5 * w,  -0.5 * h, -0.7 * d, // v5
        -0.5 * w,  -0.5 * h, -0.7 * d, // v4
        // Right face
         0.5 * w,  -0.5 * h,  0.7 * d, // v1
         0.35 * w,  0.5 * h,  0.4 * d, // v2
         0.35 * w,  0.5 * h, -0.4 * d, // v6
         0.5 * w,  -0.5 * h, -0.7 * d, // v5
        // Left face
        -0.5 * w,  -0.5 * h,  0.7 * d, // v0
        -0.35 * w,  0.5 * h,  0.4 * d, // v3
        -0.35 * w,  0.5 * h, -0.4 * d, // v7
        -0.5 * w,  -0.5 * h, -0.7 * d, // v4
        // Front2 face
        -0.35 * w,  0.5 * h,  0.4 * d,  // v3
         0.35 * w,  0.5 * h,  0.4 * d,  // v2
         0.0 * w,   0.6 * h,  0.35 * d, // v8
        // Back2 face
        -0.35 * w,  0.5 * h, -0.4 * d,  // v7
         0.35 * w,  0.5 * h, -0.4 * d,  // v6
         0.0 * w,   0.6 * h, -0.35 * d, // v9
        // Right2 Face
         0.35 * w,  0.5 * h,  0.4 * d,  // v2
         0.35 * w,  0.5 * h, -0.4 * d,  // v6
         0.0 * w,   0.6 * h, -0.35 * d, // v9
         0.0 * w,   0.6 * h,  0.35 * d, // v8
        // Left2 Face
        -0.35 * w,  0.5 * h,  0.4 * d,  // v3
        -0.35 * w,  0.5 * h, -0.4 * d,  // v7
         0.0 * w,   0.6 * h, -0.35 * d, // v9
         0.0 * w,   0.6 * h,  0.35 * d  // v8
    ]);

    // 法線を計算（傾斜を考慮）
    const frontNz = 0.9, frontNy = 0.3;  // 前面は少し上向き
    const backNz = -0.9, backNy = 0.3;  // 背面は少し上向き
    const rightNx = 0.9, rightNy = 0.3; // 右面は少し上向き
    const leftNx = -0.9, leftNy = 0.3;  // 左面は少し上向き

    const normals = new Float32Array([
        // Front face (4 vertices) - 前面（少し上向きに傾斜）
         0, frontNy, frontNz,  0, frontNy, frontNz,  0, frontNy, frontNz,  0, frontNy, frontNz,
        // Back face (4 vertices) - 背面（少し上向きに傾斜）
         0, backNy, backNz,  0, backNy, backNz,  0, backNy, backNz,  0, backNy, backNz,
        // Top face (4 vertices) - 上面
         0,  1,  0,   0,  1,  0,   0,  1,  0,   0,  1,  0,
        // Bottom face (4 vertices) - 底面
         0, -1,  0,   0, -1,  0,   0, -1,  0,   0, -1,  0,
        // Right face (4 vertices) - 右面（少し上向きに傾斜）
         rightNx, rightNy,  0,  rightNx, rightNy,  0,  rightNx, rightNy,  0,  rightNx, rightNy,  0,
        // Left face (4 vertices) - 左面（少し上向きに傾斜）
         leftNx, leftNy,  0,  leftNx, leftNy,  0,  leftNx, leftNy,  0,  leftNx, leftNy,  0,
        // Front2 face (3 vertices) - 前面上部
         0, 0.5, 0.87,  0, 0.5, 0.87,  0, 0.5, 0.87,
        // Back2 face (3 vertices) - 背面上部
         0, 0.5, -0.87,  0, 0.5, -0.87,  0, 0.5, -0.87,
        // Right2 Face (4 vertices) - 右上部
         0.87, 0.5,  0,  0.87, 0.5,  0,  0.87, 0.5,  0,  0.87, 0.5,  0,
        // Left2 Face (4 vertices) - 左上部
        -0.87, 0.5,  0, -0.87, 0.5,  0, -0.87, 0.5,  0, -0.87, 0.5,  0
    ]);

    const texcoords = new Float32Array([
        // Front face (左右反転)
        0.5,          0.5, // v0
        0.75,         0.5, // v1
        0.75 -0.25/8, 1.0, // v2
        0.5  +0.25/8, 1.0, // v3

        // Back face
        0.5 ,         0.5, // v5
        0.25,         0.5, // v4
        0.25 +0.25/8, 1.0, // v7
        0.5  -0.25/8, 1.0, // v6

        // Top face
        0.75, 0.5, // v2
        0.5,  0.5, // v3
        0.5,  0.0, // v7
        0.75, 0.0, // v6

        // Bottom face
        0.0,  0.5, // v0
        0.25, 0.5, // v1
        0.25, 1.0, // v5
        0.0,  1.0, // v4

        // Right face
        0.0,  0.5, // v1
        0.0,  0.0, // v2
        0.25, 0.0, // v6
        0.25, 0.5, // v5

        // Left face
        0.5,  0.5, // v0
        0.5,  0.0, // v3
        0.25, 0.0, // v7
        0.25, 0.5, // v4

        // Front2 face
        0.75,  0.0, // v3
        1.0,   0.0, // v2
        1.0,   0.5, // v8
        // Back2 face
        0.75,  0.0, // v7
        1.0,   0.0, // v6
        1.0,   0.5, // v9
        // Right2 Face
        0.75,  0.0, // v2
        1.0,   0.0, // v6
        1.0,   0.5, // v9
        0.75,  0.5, // v8
        // Left2 Face
        0.75,  0.0, // v3
        1.0,   0.0, // v7
        1.0,   0.5, // v9
        0.75,  0.5  // v8
    ]);

    const indices = new Uint16Array([
         0,  1,  2,    0,  2 , 3,  // Front face
         4,  6,  5,    4,  7 , 6,  // Back face (reversed winding)
         8,  9, 10,    8, 10, 11,  // Top face
        12, 14, 13,   12, 15, 14,  // Bottom face (reversed winding)
        16, 18, 17,   16, 19, 18,  // Right face (reversed winding)
        20, 21, 22,   20, 22, 23,  // Left face
        24, 25, 26,                // Front2 face
        27, 29, 28,                // Back2 face (reversed winding)
        30, 31, 33,   31, 32, 33,  // Right2 face (reversed winding)
        34, 36, 35,   34, 37, 36   // Left2 face (reversed winding)
    ]);

    // Shogi piece size for physics (scaled)
    const pieceW = w * PHYSICS_SCALE;
    const pieceH = h * PHYSICS_SCALE;
    const pieceD = d * PHYSICS_SCALE;

    // Build shared mesh once
    const material = Rn.MaterialHelper.createPbrUberMaterial(engine, { isLighting: true });
    material.setTextureParameter('baseColorTexture', shogiTexture, sampler);

    const primitive = Rn.Primitive.createPrimitive(engine, {
        indices: indices,
        attributeSemantics: [Rn.VertexAttribute.Position.XYZ, Rn.VertexAttribute.Normal.XYZ, Rn.VertexAttribute.Texcoord0.XY],
        attributes: [positions, normals, texcoords],
        material: material,
        primitiveMode: Rn.PrimitiveMode.Triangles
    });

    const sharedMesh = new Rn.Mesh(engine);
    sharedMesh.addPrimitive(primitive);

    // Shared collider wireframe (one mesh reused by every piece), matching the
    // piece box [pieceW, pieceH, pieceD].
    const pieceWireMesh = makeWireMesh(pieceW, pieceH, pieceD, DEBUG_COLOR_DYNAMIC);

    for (let i = 0; i < max; i++) {
        // Random position above the ground (within ground bounds)
        const x = (Math.random() - 0.5) * 5;
        const y = 5 + Math.random() * 10;
        const z = (Math.random() - 0.5) * 5;

        // Create physics body for each piece. Rapier cuboid takes half-extents.
        const rbDesc = RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z);
        rbDesc.setRotation(eulerDegToQuat(Math.random() * 360, Math.random() * 360, Math.random() * 360));
        const body = world.createRigidBody(rbDesc);
        world.createCollider(
            RAPIER.ColliderDesc.cuboid(pieceW / 2, pieceH / 2, pieceD / 2)
                .setDensity(1).setFriction(0.5).setRestitution(0.2),
            body
        );
        bodies.push(body);

        const entity = Rn.createMeshEntity(engine);
        entity.getMesh().setMesh(sharedMesh);
        entity.tryToSetTag({
            tag: "type",
            value: "shogi"
        });

        // Initial position will be updated by physics
        entity.getTransform().localPosition = Rn.Vector3.fromCopyArray([x, y, z]);
        entity.getTransform().localScale = Rn.Vector3.fromCopyArray([
            PHYSICS_SCALE,
            PHYSICS_SCALE,
            PHYSICS_SCALE
        ]);

        entities.push(entity);
        shogiPieces.push(entity);

        // Per-piece collider wireframe (no scale: geometry is already at physics size)
        const debugEntity = Rn.createMeshEntity(engine);
        debugEntity.getMesh().setMesh(pieceWireMesh);
        debugEntity.getTransform().localPosition = Rn.Vector3.fromCopyArray([x, y, z]);
        debugEntities.push(debugEntity);
        pieceDebugEntities.push(debugEntity);
    }
}

document.body.onload = load;
