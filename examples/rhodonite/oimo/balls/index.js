import Rn from 'rhodonite';

let entities = [];
const PHYSICS_SCALE = 1/10;

const dataSet = [
    {imageFile:"../../../../assets/textures/Basketball.jpg", scale:1.0},
    {imageFile:"../../../../assets/textures/BeachBall.jpg",  scale:0.9},
    {imageFile:"../../../../assets/textures/Football.jpg",   scale:1.0},
    {imageFile:"../../../../assets/textures/Softball.jpg",   scale:0.3},
    {imageFile:"../../../../assets/textures/TennisBall.jpg", scale:0.3},
];

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

    const texturePromises = dataSet.map(data => Rn.Texture.loadFromUrl(data.imageFile));
    const textures = await Promise.all(texturePromises);

    const sampler = new Rn.Sampler({
      magFilter: Rn.TextureParameter.Linear,
      minFilter: Rn.TextureParameter.Linear,
      wrapS: Rn.TextureParameter.Repeat,
      wrapT: Rn.TextureParameter.Repeat,
    });
    sampler.create();
    
    const materialGround = Rn.MaterialHelper.createPbrUberMaterial({
        isLighting: true
    });
    materialGround.setParameter('baseColorFactor', Rn.Vector4.fromCopyArray4([0x3D/0xFF, 0x41/0xFF, 0x43/0xFF, 1]));
    
    const materialGroundTrans = Rn.MaterialHelper.createPbrUberMaterial({
        isLighting: true
    });
    materialGroundTrans.setParameter('baseColorFactor', Rn.Vector4.fromCopyArray4([0x3D/0xFF, 0x41/0xFF, 0x43/0xFF, 0.6]));
    materialGroundTrans.alphaMode = Rn.AlphaMode.Blend;
    
    // Ground
    const entity1 = Rn.MeshHelper.createCube({
        physics: {
            use: true,
            move: false,
            density: 1,
            friction: 0.6,
            restitution: 0.5,
        },
        material: materialGround
    });
    entity1.tryToSetTag({
        tag: "type",
        value: "ground"
    });
    entity1.scale = Rn.Vector3.fromCopyArray([40 * PHYSICS_SCALE, 4 * PHYSICS_SCALE, 40 * PHYSICS_SCALE]);
    entity1.position = Rn.Vector3.fromCopyArray([0, -2 * PHYSICS_SCALE, 0]);
    entities.push(entity1);

    // Box walls
    const boxDataSet = [
        { size:[10, 10,  1], pos:[ 0, 5,-5] }, // front
        { size:[10, 10,  1], pos:[ 0, 5, 5] }, // back
        { size:[ 1, 10, 10], pos:[-5, 5, 0] }, // left
        { size:[ 1, 10, 10], pos:[ 5, 5, 0] }  // right
    ];

    for (let i = 0; i < boxDataSet.length; i++) {
        const size = boxDataSet[i].size;
        const pos = boxDataSet[i].pos;
        
        const wallEntity = Rn.MeshHelper.createCube({
            physics: {
                use: true,
                move: false,
                density: 1,
                friction: 0.6,
                restitution: 0.5,
            },
            material: materialGroundTrans
        });
        wallEntity.tryToSetTag({
            tag: "type",
            value: "wall"
        });
        wallEntity.scale = Rn.Vector3.fromCopyArray([size[0] * PHYSICS_SCALE, size[1] * PHYSICS_SCALE, size[2] * PHYSICS_SCALE]);
        wallEntity.position = Rn.Vector3.fromCopyArray([pos[0] * PHYSICS_SCALE, pos[1] * PHYSICS_SCALE, pos[2] * PHYSICS_SCALE]);
        entities.push(wallEntity);
    }

    populate(textures, sampler);

	// camera
	const cameraEntity = Rn.createCameraControllerEntity();
	cameraEntity.localPosition = Rn.Vector3.fromCopyArray([0 * PHYSICS_SCALE, 15 * PHYSICS_SCALE, 30 * PHYSICS_SCALE]);
	cameraEntity.localEulerAngles = Rn.Vector3.fromCopyArray([-0.1, 0.0, 0.0]);
	const cameraComponent = cameraEntity.getCamera();
	cameraComponent.zNear = 0.1;
	cameraComponent.zFar = 1000;
	cameraComponent.setFovyAndChangeFocalLength(60);
	cameraComponent.aspect = window.innerWidth / window.innerHeight;

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
	
    const draw = function(time) {
        Rn.System.processAuto();

        requestAnimationFrame(draw);
    }

    draw();

}

function populate(textures, sampler) {
    const max = 200;
    
    for (let i = 0; i < max; i++) {
        const x = -5 + Math.random() * 10;
        const y = 20 + Math.random() * 10;
        const z = -5 + Math.random() * 10;
        const w = 2 + Math.random() * 1;

        const pos = Math.floor(Math.random() * dataSet.length);
        const scale = dataSet[pos].scale;
        const radius = (w * scale) / 2;

        let modelMaterial = Rn.MaterialHelper.createPbrUberMaterial({
            isLighting: true
        });
        modelMaterial.setTextureParameter('baseColorTexture', textures[pos], sampler);

        const entity = Rn.MeshHelper.createSphere({
            radius: radius * PHYSICS_SCALE,
            widthSegments: 20,
            heightSegments: 10,
            physics: {
                use: true,
                move: true,
                density: 1,
                friction: 0.4,
                restitution: 0.6,
            },
            material: modelMaterial
        });
        entity.tryToSetTag({
            tag: "type",
            value: "ball"
        });
        entity.position = Rn.Vector3.fromCopyArray([x * PHYSICS_SCALE, y * PHYSICS_SCALE, z * PHYSICS_SCALE]);
        entities.push(entity);
    }
}
document.body.onload = load;