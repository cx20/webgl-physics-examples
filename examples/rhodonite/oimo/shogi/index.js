import Rn from 'rhodonite';

const DOT_SIZE = 10;
const PHYSICS_SCALE = 1/10;

let entities = [];
let shogiPieces = [];
let world;
let oimoBodies = [];

const load = async function() {
    await Rn.ModuleManager.getInstance().loadModule('webgl');
    await Rn.ModuleManager.getInstance().loadModule('pbr');
    const c = document.getElementById('world');

    await Rn.System.init({
      approach: Rn.ProcessApproach.DataTexture,
      canvas: c,
    });

    resizeCanvas();
    
    window.addEventListener("resize", function(){
        resizeCanvas();
    });

    function resizeCanvas() {
        Rn.System.resizeCanvas(window.innerWidth, window.innerHeight);
    }

    // Initialize physics world
    world = new OIMO.World({ 
        timestep: 1/60, 
        iterations: 8, 
        broadphase: 2,
        worldscale: 1, 
        random: true,
        info: false,
        gravity: [0, -9.8, 0] 
    });

    // Create ground (physics) - Oimo.js size is full width, not half
    const groundSize = [7.5, 0.2, 7.5];
    const groundY = -1;
    world.add({
        type: 'box',
        size: groundSize,
        pos: [0, groundY, 0],
        density: 1,
        move: false
    });

    // Load shogi texture
    const shogiTexture = await Rn.Texture.loadFromUrl('../../../../assets/textures/shogi_001/shogi.png');
    const sampler = new Rn.Sampler({
      magFilter: Rn.TextureParameter.Linear,
      minFilter: Rn.TextureParameter.Linear,
      wrapS: Rn.TextureParameter.Repeat,
      wrapT: Rn.TextureParameter.Repeat,
    });
    sampler.create();
    
    // Create ground visual (match physics size - Rhodonite Cube uses half-extent)
    const groundEntity = Rn.createMeshEntity();
    const groundPrimitive = new Rn.Cube();
    groundPrimitive.generate({
        widthVector: Rn.Vector3.fromCopyArray([groundSize[0] / 1, groundSize[1] / 1, groundSize[2] / 1]),
    });
    const groundMaterial = Rn.MaterialHelper.createPbrUberMaterial({
        isLighting: true
    });
    groundMaterial.setParameter('baseColorFactor', Rn.Vector4.fromCopyArray([0.4, 0.6, 0.4, 1.0]));
    groundPrimitive.material = groundMaterial;
    const groundMesh = new Rn.Mesh();
    groundMesh.addPrimitive(groundPrimitive);
    groundEntity.getMesh().setMesh(groundMesh);
    groundEntity.getTransform().localPosition = Rn.Vector3.fromCopyArray([0, groundY, 0]);
    entities.push(groundEntity);

    // Create shogi pieces
    populate(shogiTexture, sampler);

    // camera
    const cameraEntity = Rn.createCameraControllerEntity();
    const cameraComponent = cameraEntity.getCamera();
    cameraComponent.zNear = 0.1;
    cameraComponent.zFar = 10000;
    cameraComponent.setFovyAndChangeFocalLength(70);
    cameraComponent.aspect = window.innerWidth / window.innerHeight;

    // Set camera controller target
    const cameraController = cameraEntity.getCameraController();
    if (cameraController && cameraController.controller && entities.length > 0) {
        cameraController.controller.setTarget(groundEntity);
        cameraController.controller.dolly = 0.8;
        cameraController.controller.dollyScale = 2.0;
        cameraController.controller.rotY = -30; // Look down from above
    }

    // Lights
    const lightEntity1 = Rn.createLightEntity();
    const lightComponent1 = lightEntity1.getLight();
    lightComponent1.type = Rn.LightType.Directional;
    lightComponent1.intensity = 1.5;
    lightEntity1.localEulerAngles = Rn.Vector3.fromCopyArray([-Math.PI / 4, Math.PI / 6, 0]);

    const lightEntity2 = Rn.createLightEntity();
    const lightComponent2 = lightEntity2.getLight();
    lightComponent2.type = Rn.LightType.Directional;
    lightComponent2.intensity = 0.8;
    lightEntity2.localEulerAngles = Rn.Vector3.fromCopyArray([Math.PI / 4, -Math.PI / 6, 0]);

    let angle = 0;
    const draw = function(time) {
        // Update physics
        world.step();
        
        // Update shogi piece positions from physics
        for (let i = 0; i < shogiPieces.length; i++) {
            const body = oimoBodies[i];
            const entity = shogiPieces[i];
            
            const pos = body.getPosition();
            const quat = body.getQuaternion();
            
            // If piece falls below the ground, reset it to above
            if (pos.y < -10) {
                const newX = (Math.random() - 0.5) * 5;
                const newY = 10 + Math.random() * 10;
                const newZ = (Math.random() - 0.5) * 5;
                body.resetPosition(newX, newY, newZ);
                body.resetRotation(Math.random() * 360, Math.random() * 360, Math.random() * 360);
            }
            
            entity.getTransform().localPosition = Rn.Vector3.fromCopyArray([pos.x, pos.y, pos.z]);
            entity.getTransform().localRotation = Rn.Quaternion.fromCopyArray([quat.x, quat.y, quat.z, quat.w]);
        }

        // Rotate camera around the scene
        angle += 0.5;
        
        // Use camera controller rotation
        const cameraController = cameraEntity.getCameraController();
        if (cameraController && cameraController.controller) {
            cameraController.controller.rotX = angle; // degrees
        }

        Rn.System.processAuto();

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

    for (let i = 0; i < max; i++) {
        // Random position above the ground (within ground bounds)
        const x = (Math.random() - 0.5) * 5;
        const y = 5 + Math.random() * 10;
        const z = (Math.random() - 0.5) * 5;

        // Create physics body for each piece
        const body = world.add({
            type: 'box',
            size: [pieceW, pieceH, pieceD],
            pos: [x, y, z],
            rot: [Math.random() * 360, Math.random() * 360, Math.random() * 360],
            density: 1,
            move: true
        });
        oimoBodies.push(body);

        // Create material for each piece with lighting enabled
        const material = Rn.MaterialHelper.createPbrUberMaterial({
            isLighting: true
        });
        material.setTextureParameter('baseColorTexture', shogiTexture, sampler);

        // Create mesh with custom geometry
        const primitive = Rn.Primitive.createPrimitive({
            indices: indices,
            attributeSemantics: [Rn.VertexAttribute.Position.XYZ, Rn.VertexAttribute.Normal.XYZ, Rn.VertexAttribute.Texcoord0.XY],
            attributes: [positions, normals, texcoords],
            material: material,
            primitiveMode: Rn.PrimitiveMode.Triangles
        });

        const mesh = new Rn.Mesh();
        mesh.addPrimitive(primitive);

        const entity = Rn.createMeshEntity();
        const meshComponent = entity.getMesh();
        meshComponent.setMesh(mesh);

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
    }
}

document.body.onload = load;
