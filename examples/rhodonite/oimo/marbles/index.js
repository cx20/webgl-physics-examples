import Rn from 'rhodonite';

const modelUrl = 'https://cx20.github.io/gltf-test/tutorialModels/IridescenceMetallicSpheres/glTF/IridescenceMetallicSpheres.gltf';
const scale = 1.0;
const PHYSICS_SCALE = 1/10;

const canvas = document.getElementById('world');
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

(async () => {
  // Rhodonite Configuration
  Rn.Config.isUboEnabled = false;
  Rn.Config.maxLightNumberInShader = 8;
  Rn.Config.maxMorphTargetNumber = 8;
  Rn.Config.maxSkeletalBoneNumber = 400;
  Rn.Config.maxSkeletonNumber = 84;
  
  await Rn.System.init({
    approach: Rn.ProcessApproach.DataTexture,
    canvas,
  });

  Rn.MeshRendererComponent.isDepthMaskTrueForTransparencies = true;

  // Create ForwardRenderPipeline
  const forwardRenderPipeline = new Rn.ForwardRenderPipeline();
  forwardRenderPipeline.setup(canvas.width, canvas.height, {
    isBloom: false,
    isShadow: false,
  });
  
  // Camera
  const cameraEntity = Rn.createCameraControllerEntity();
  const cameraComponent = cameraEntity.getCamera();
  cameraComponent.zNear = 0.1;
  cameraComponent.zFar = 1000.0;
  cameraComponent.setFovyAndChangeFocalLength(75.0);
  cameraComponent.aspect = canvas.width / canvas.height;

  // Lights
  const lightEntity1 = Rn.createLightEntity();
  lightEntity1.getTransform().localPosition = Rn.Vector3.fromCopyArray([1.0, 1.0, 100000.0]);
  lightEntity1.getComponent(Rn.LightComponent).intensity = 1;
  lightEntity1.getComponent(Rn.LightComponent).type = Rn.LightType.Directional;
  lightEntity1.getTransform().localEulerAngles = Rn.Vector3.fromCopyArray([-Math.PI / 2, -Math.PI / 4, Math.PI / 4]);

  const lightEntity2 = Rn.createLightEntity();
  lightEntity2.getTransform().localPosition = Rn.Vector3.fromCopyArray([1.0, 1.0, 100000.0]);
  lightEntity2.getComponent(Rn.LightComponent).intensity = 1;
  lightEntity2.getComponent(Rn.LightComponent).type = Rn.LightType.Directional;
  lightEntity2.getTransform().localEulerAngles = Rn.Vector3.fromCopyArray([Math.PI / 2, Math.PI / 4, -Math.PI / 4]);

  // Create ground with physics
  const materialGround = Rn.MaterialHelper.createPbrUberMaterial({
    isLighting: true
  });
  const grassTexture = await Rn.Texture.loadFromUrl('../../../../assets/textures/grass.jpg');
  const sampler = new Rn.Sampler({
    magFilter: Rn.TextureParameter.Linear,
    minFilter: Rn.TextureParameter.Linear,
    wrapS: Rn.TextureParameter.Repeat,
    wrapT: Rn.TextureParameter.Repeat,
  });
  sampler.create();
  materialGround.setTextureParameter('baseColorTexture', grassTexture, sampler);

  const groundEntity = Rn.MeshHelper.createCube({
    physics: {
      use: true,
      move: false,
      density: 1,
      friction: 0.2,
      restitution: 0.3,
    },
    material: materialGround
  });
  groundEntity.tryToSetTag({
    tag: "type",
    value: "ground"
  });
  groundEntity.getTransform().localScale = Rn.Vector3.fromCopyArray([400 * PHYSICS_SCALE, 0.01 * 400 * PHYSICS_SCALE, 400 * PHYSICS_SCALE]);
  groundEntity.getTransform().localPosition = Rn.Vector3.fromCopyArray([0, -15 * PHYSICS_SCALE, 0]);

  // Load glTF model
  const assets = await Rn.defaultAssetLoader.load({
    mainExpression: (await Rn.GltfImporter.importFromUrl(
      modelUrl,
      {
        defaultMaterialHelperArgumentArray: [
          {
            makeOutputSrgb: false,
          },
        ],
      }
    ))
  });

  // Environment Cube
  const envExpression = await createEnvCubeExpression('https://cx20.github.io/gltf-test/textures/papermill_hdr', cameraEntity);

  const mainRenderPass = assets.mainExpression.renderPasses[0];
  
  // Create physics-enabled spheres based on original model
  const sphereEntities = [];
  const entitiesToRemove = [];
  
  mainRenderPass.entities.forEach(entity => {
    const entityName = entity.uniqueName || entity.getTagValue('name') || '';
    
    // Remove Plane (label) meshes
    if (entityName.includes('Plane')) {
      entitiesToRemove.push(entity);
      console.log('Removing label:', entityName);
    }
    // Process Sphere entities
    else if (entityName.includes('Sphere')) {
      const meshComponent = entity.getMesh();
      if (meshComponent && meshComponent.mesh) {
        const primitive = meshComponent.mesh.getPrimitiveAt(0);
        if (primitive) {
          const transform = entity.getTransform();
          const currentPos = transform.localPosition;
          const currentScale = transform.localScale;
          const material = primitive.material;
          
          // Create new sphere with physics
          const randomX = (Math.random() - 0.5) * 2;
          const randomY = Math.random() * 20;
          const randomZ = (Math.random() - 0.5) * 2;
          
          const physicsSphere = Rn.MeshHelper.createSphere({
            radius: currentScale.x, // Use original scale as radius
            widthSegments: 32,
            heightSegments: 32,
            material: material,
            physics: {
              use: true,
              move: true,
              //shape: Rn.PhysicsShape.Sphere,
              density: 1,
              friction: 0.1,
              restitution: 0.3,
            }
          });
          
          physicsSphere.getTransform().localPosition = Rn.Vector3.fromCopyArray([
            currentPos.x + randomX,
            currentPos.y + randomY,
            currentPos.z + randomZ
          ]);
          
          physicsSphere.tryToSetTag({
            tag: "type",
            value: "physicsSphere"
          });
          
          sphereEntities.push(physicsSphere);
          mainRenderPass.addEntities([physicsSphere]);
          
          console.log('Created physics sphere:', entityName, 'at position:', physicsSphere.getTransform().localPosition);
        }
      }
      
      // Mark original sphere for removal
      entitiesToRemove.push(entity);
    }
  });
  
  // Remove original entities from render pass
  entitiesToRemove.forEach(entity => {
    //mainRenderPass.removeEntity(entity);
  });
  
  console.log(`Created ${sphereEntities.length} physics spheres and removed ${entitiesToRemove.length} original entities`);
  
  // Camera Controller
  const mainCameraControllerComponent = cameraEntity.getCameraController();
  const controller = mainCameraControllerComponent.controller;
  const entities = mainRenderPass.entities;
  controller.setTargets(entities);
  controller.dolly = 0.83;

  await forwardRenderPipeline.setExpressions([envExpression, assets.mainExpression]);

  // IBL Textures
  const diffuseCubeTexture = new Rn.CubeTexture();
  await diffuseCubeTexture.loadTextureImages({
    baseUrl: "https://cx20.github.io/gltf-test/textures/papermill_hdr/diffuse/diffuse",
    isNamePosNeg: true,
    hdriFormat: Rn.HdriFormat.RGBE_PNG,
    mipmapLevelNumber: 1
  });

  const specularCubeTexture = new Rn.CubeTexture();
  await specularCubeTexture.loadTextureImages({
    baseUrl: "https://cx20.github.io/gltf-test/textures/papermill_hdr/specular/specular",
    isNamePosNeg: true,
    hdriFormat: Rn.HdriFormat.RGBE_PNG,
    mipmapLevelNumber: 10
  });
  
  await forwardRenderPipeline.setIBLTextures(diffuseCubeTexture, specularCubeTexture);

  // Set Camera
  Rn.CameraComponent.current = cameraComponent.componentSID;
  const zFar = cameraComponent.zFar * 0.95;
  envExpression.renderPasses[0].entities[0].getTransform().localScale = Rn.Vector3.fromCopy3(-zFar, zFar, zFar);

  // Animation Loop
  let startTime = Date.now();
  let angle = 0;

  const randomNumber = (min, max) => {
    if (min == max) {
      return min;
    }
    const random = Math.random();
    return ((random * (max - min)) + min);
  };

  const getNextPosition = (y) => {
    return Rn.Vector3.fromCopyArray([
      randomNumber(-50, 50) * PHYSICS_SCALE, 
      (randomNumber(0, 200) + y) * PHYSICS_SCALE, 
      randomNumber(-50, 50) * PHYSICS_SCALE
    ]);
  };

  const draw = function (frame) {
    angle += 0.2;
    
    const date = new Date();
    const time = (date.getTime() - startTime) / 1000;
    Rn.AnimationComponent.globalTime = time;
    if (time > Rn.AnimationComponent.endInputValue) {
      startTime = date.getTime();
    }

    // Auto rotation
    const mainCameraControllerComponent = cameraEntity.getComponent(Rn.CameraControllerComponent);
    const controller = mainCameraControllerComponent.controller;
    controller.rotX = angle;

    // Reset spheres that fall below the ground
    sphereEntities.forEach((sphere) => {
      const currentPos = sphere.getTransform().localPosition;
      if (currentPos.y < -100 * PHYSICS_SCALE) {
        sphere.getTransform().localPosition = getNextPosition(200);
        const physicsComponent = sphere.getComponent(Rn.PhysicsComponent);
        if (physicsComponent) {
          //physicsComponent.resetVelocity();
        }
      }
    });

    Rn.System.process(frame);
  };

  forwardRenderPipeline.startRenderLoop(draw);
})();

async function createEnvCubeExpression(baseuri, cameraEntity) {
  const environmentCubeTexture = new Rn.CubeTexture();
  await environmentCubeTexture.loadTextureImages({
    baseUrl: baseuri + '/environment/environment',
    isNamePosNeg: true,
    hdriFormat: Rn.HdriFormat.LDR_SRGB,
    mipmapLevelNumber: 1
  });

  const sphereMaterial = Rn.MaterialHelper.createEnvConstantMaterial();
  const sampler = new Rn.Sampler({
    wrapS: Rn.TextureParameter.ClampToEdge,
    wrapT: Rn.TextureParameter.ClampToEdge,
    minFilter: Rn.TextureParameter.Linear,
    magFilter: Rn.TextureParameter.Linear,
  });
  sphereMaterial.setTextureParameter("colorEnvTexture", environmentCubeTexture, sampler);
  sphereMaterial.setParameter("envHdriFormat", Rn.HdriFormat.LDR_SRGB.index);
  sphereMaterial.setParameter("makeOutputSrgb", 0);
  
  const spherePrimitive = new Rn.Sphere();
  spherePrimitive.generate({
    radius: 1,
    widthSegments: 40,
    heightSegments: 40,
    material: sphereMaterial,
  });

  const sphereMesh = new Rn.Mesh();
  sphereMesh.addPrimitive(spherePrimitive);

  const sphereEntity = Rn.createMeshEntity();
  sphereEntity.getTransform().localScale = Rn.Vector3.fromCopyArray([-1, 1, 1]);
  sphereEntity.getTransform().localPosition = Rn.Vector3.fromCopyArray([0, 0, 0]);

  const sphereMeshComponent = sphereEntity.getMesh();
  sphereMeshComponent.setMesh(sphereMesh);

  const sphereRenderPass = new Rn.RenderPass();
  sphereRenderPass.addEntities([sphereEntity]);

  const sphereExpression = new Rn.Expression();
  sphereExpression.addRenderPasses([sphereRenderPass]);

  return sphereExpression;
}