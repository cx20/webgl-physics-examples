let { Asset, EntityMgr, System, ComponentSystem, Camera, Texture, vec3, vec4, mat4, quat, Screen, MeshRenderer, Shader, Material, Mesh, Accessor, bufferView } = Ashes;

async function main() {
    let screen = new Screen('#c');
    screen.bgColor = [0, 0, 0, 1];

    let scene = EntityMgr.create('root');

    // Camera
    let mainCamera = EntityMgr.create('camera');
    let cam = EntityMgr.addComponent(mainCamera, new Camera(screen.width / screen.height));

    // Set default position
    let cameraTrans = mainCamera.components.Transform;
    vec3.set(cameraTrans.translate, 0, 0, 200);

    // Add it to scene
    scene.appendChild(mainCamera);
    screen.mainCamera = cam;
    
    document.querySelector('body').appendChild(scene);

    let entityCube1 = scene.appendChild(EntityMgr.create('entityCube1'));
    let entityCube2 = scene.appendChild(EntityMgr.create('entityCube2'));

    // Load a material
    let vs = document.getElementById("vs").textContent;
    let fs = document.getElementById("fs").textContent;
    let macro = {};
    let shader = new Shader(vs, fs, macro);
    let textureMat = new Material(shader);
    textureMat.doubleSided = true;

    //let map = new Texture();
    //map.data = Texture.defaultData;
    //Material.setTexture(textureMat, 'texture', map);
    let frog = await Asset.loadTexture('../../../../assets/textures/frog.jpg', { minFilter: screen.gl.NEAREST_MIPMAP_NEAREST });
    Material.setTexture(textureMat, 'texture', frog);

    // Create a renderer component
    let textureMR1 = new MeshRenderer(screen, new TextureMesh(), textureMat);
    let textureMR2 = new MeshRenderer(screen, new TextureMesh(), textureMat);

    EntityMgr.addComponent(entityCube1, textureMR1);
    EntityMgr.addComponent(entityCube2, textureMR2);
    EntityMgr.addComponent(entityCube1, new OimoComponent(
        "box",
        [50*2, 50*2, 50*2],
        [0, 100, 0],
        [10, 0, 10],
        true
    ));
    EntityMgr.addComponent(entityCube2, new OimoComponent(
        "box",
        [200*2, 4*2, 200*2],
        [0, -50, 0],
        [0, 0, 0],
        false
    ));
}

class OimoComponent {
    constructor(type, size, pos, rot, move) {
        this.body = OimoSystem.getWorld().add({
            type: type,
            size: size,
            pos: pos,
            rot: rot,
            move: move,
            density: 1
        });
        this.size = size;
    }
}

class OimoSystem extends ComponentSystem {
    depends = [
        OimoComponent.name
    ];
    static world = new OIMO.World({ 
        timestep: 1/30, 
        iterations: 8, 
        broadphase: 2, // 1 brute force, 2 sweep and prune, 3 volume tree
        worldscale: 1, // scale full world 
        random: true,  // randomize sample
        info: false,   // calculate statistic or not
        gravity: [0,-9.8,0] 
    });
    static getWorld() { 
    	  return this.world;
    }
    onUpdate(dt) {
        //console.log(dt);
        OimoSystem.getWorld().step();
        for(let {components} of this.group) {
          let trans = components.Transform;
          let size = components.OimoComponent.size;
          vec3.set(trans.scale, size[0], size[1], size[2]);
          let pos = components.OimoComponent.body.getPosition();
          vec3.set(trans.translate, pos.x, pos.y, pos.z);
          let rot = components.OimoComponent.body.getQuaternion();
          vec4.set(trans.quaternion, rot.x, rot.y, rot.z, rot.w);
        }
    }
}

System.registSystem(new OimoSystem());

// 立方体の座標データを用意
//             1.0 y 
//              ^  -1.0 
//              | / z
//              |/       x
// -1.0 -----------------> +1.0
//            / |
//      +1.0 /  |
//           -1.0
// 
//         [7]------[6]
//        / |      / |
//      [3]------[2] |
//       |  |     |  |
//       | [4]----|-[5]
//       |/       |/
//      [0]------[1]
//
class TextureMesh extends Mesh {
    constructor() {
        let meshVBO = new Float32Array([
            // Front face
            -0.5, -0.5,  0.5, // v0
             0.5, -0.5,  0.5, // v1
             0.5,  0.5,  0.5, // v2
            -0.5,  0.5,  0.5, // v3
            // Back face
            -0.5, -0.5, -0.5, // v4
             0.5, -0.5, -0.5, // v5
             0.5,  0.5, -0.5, // v6
            -0.5,  0.5, -0.5, // v7
            // Top face
             0.5,  0.5,  0.5, // v2
            -0.5,  0.5,  0.5, // v3
            -0.5,  0.5, -0.5, // v7
             0.5,  0.5, -0.5, // v6
            // Bottom face
            -0.5, -0.5,  0.5, // v0
             0.5, -0.5,  0.5, // v1
             0.5, -0.5, -0.5, // v5
            -0.5, -0.5, -0.5, // v4
            // Right face
             0.5, -0.5,  0.5, // v1
             0.5,  0.5,  0.5, // v2
             0.5,  0.5, -0.5, // v6
             0.5, -0.5, -0.5, // v5
            // Left face
            -0.5, -0.5,  0.5, // v0
            -0.5,  0.5,  0.5, // v3
            -0.5,  0.5, -0.5, // v7
            -0.5, -0.5, -0.5  // v4
        ]);
        let uvVBO = new Float32Array([
            // Front face
            1, 0,
            0, 0,
            0, 1,
            1, 1,
            // Back face
            1, 0,
            0, 0,
            0, 1,
            1, 1,
            // Top face
            1, 0,
            0, 0,
            0, 1,
            1, 1,
            // Bottom face
            1, 0,
            0, 0,
            0, 1,
            1, 1,
            // Right face
            1, 0,
            0, 0,
            0, 1,
            1, 1,
            // Left face
            1, 0,
            0, 0,
            0, 1,
            1, 1
        ]);
        let meshEBO = new Uint16Array([
             0,  1,  2,    0,  2 , 3,  // Front face
             4,  5,  6,    4,  6 , 7,  // Back face
             8,  9, 10,    8, 10, 11,  // Top face
            12, 13, 14,   12, 14, 15,  // Bottom face
            16, 17, 18,   16, 18, 19,  // Right face
            20, 21, 22,   20, 22, 23   // Left face
        ]);
        let vbo = new bufferView(meshVBO.buffer, {
            byteOffset: meshVBO.byteOffset,
            byteLength: meshVBO.byteLength,
            byteStride: 0,
            target: WebGL2RenderingContext.ARRAY_BUFFER
        });
        let uvVbo = new bufferView(uvVBO.buffer, {
            byteOffset: uvVBO.byteOffset,
            byteLength: uvVBO.byteLength,
            byteStride: 0,
            target: WebGL2RenderingContext.ARRAY_BUFFER
        });
        let ebo = new bufferView(meshEBO.buffer, {
            byteOffset: meshEBO.byteOffset,
            byteLength: meshEBO.byteLength,
            byteStride: 0,
            target: WebGL2RenderingContext.ELEMENT_ARRAY_BUFFER
        });
        let position = new Accessor({
            bufferView: vbo,
            componentType: WebGL2RenderingContext.FLOAT,
            byteOffset: 0,
            type: "VEC3",
            count: 24
        }, 'POSITION');
        let uv = new Accessor({
            bufferView: uvVbo,
            componentType: WebGL2RenderingContext.FLOAT,
            byteOffset: 0,
            type: "VEC2",
            count: 24
        }, 'TEXCOORD_0');
        let indices = new Accessor({
            bufferView: ebo,
            componentType: WebGL2RenderingContext.UNSIGNED_SHORT,
            byteOffset: 0,
            type: "SCALAR",
            count: 36
        });
        super([position, uv], indices, WebGL2RenderingContext.TRIANGLES);
    }
}

main();
