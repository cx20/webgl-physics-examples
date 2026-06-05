const Quaternion = gr.lib.math.Quaternion;
// Spawn 200 erasers at once over the small floor, matching the other eraser samples
// (x,z in +/-6, y in 14..28). They are recycled in the Rigid $update when they fall off.
const ERASER_COUNT = 200;
function spawnPosition() {
    return [Math.random() * 12 - 6, 14 + Math.random() * 14, Math.random() * 12 - 6];
}
gr(function() {
    const scene = gr("#main")("scene").single();
    for (let i = 0; i < ERASER_COUNT; i++) {
        scene.addChildByName("rigid-eraser", { position: spawnPosition() });
    }
});

let GeometryFactory = gr.lib.fundamental.Geometry.GeometryFactory;
let Geometry = gr.lib.fundamental.Geometry.Geometry;
GeometryFactory.addType("custom", {}, function(gl,attrs){
  let geometry = new Geometry(gl);
  let positions = new Float32Array([
    // Front face
    -0.5*2, -0.5*2,  0.5*2, // v0
     0.5*2, -0.5*2,  0.5*2, // v1
     0.5*2,  0.5*2,  0.5*2, // v2
    -0.5*2,  0.5*2,  0.5*2, // v3
    // Back face
    -0.5*2, -0.5*2, -0.5*2, // v4
     0.5*2, -0.5*2, -0.5*2, // v5
     0.5*2,  0.5*2, -0.5*2, // v6
    -0.5*2,  0.5*2, -0.5*2, // v7
    // Top face
     0.5*2,  0.5*2,  0.5*2, // v2
    -0.5*2,  0.5*2,  0.5*2, // v3
    -0.5*2,  0.5*2, -0.5*2, // v7
     0.5*2,  0.5*2, -0.5*2, // v6
    // Bottom face
    -0.5*2, -0.5*2,  0.5*2, // v0
     0.5*2, -0.5*2,  0.5*2, // v1
     0.5*2, -0.5*2, -0.5*2, // v5
    -0.5*2, -0.5*2, -0.5*2, // v4
    // Right face
     0.5*2, -0.5*2,  0.5*2, // v1
     0.5*2,  0.5*2,  0.5*2, // v2
     0.5*2,  0.5*2, -0.5*2, // v6
     0.5*2, -0.5*2, -0.5*2, // v5
    // Left face
    -0.5*2, -0.5*2,  0.5*2, // v0
    -0.5*2,  0.5*2,  0.5*2, // v3
    -0.5*2,  0.5*2, -0.5*2, // v7
    -0.5*2, -0.5*2, -0.5*2  // v4
  ]);
  // Data of texture
  //  (0, 1)                  (1, 1)
  //   t +-----+-----+-----+----+
  //     | [1] | [2] | [3] |    |
  //     +-----+-----+-----+----+
  //     | [4] | [5] | [6] |    |
  //     +-----+-----+-----+----+ -> s
  //  (0, 0)                  (1, 0)
  //
  let texcoords = new Float32Array([
    // Front face
    0.5,  0.5, // v0
    0.75, 0.5, // v1
    0.75, 1.0, // v2
    0.5,  1.0, // v3

    // Back face
    0.25, 0.5, // v4
    0.5,  0.5, // v5
    0.5,  1.0, // v6
    0.25, 1.0, // v7

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
    0.25, 0.5  // v4
  ]);
  geometry.addAttributes(positions, {
    POSITION:{
      size: 3
    }
  });
  geometry.addAttributes(texcoords, {
    TEXCOORD:{
      size: 2
    }
  });
  let indices = [
     0,  1,  2,    0,  2 , 3,  // Front face
     4,  5,  6,    4,  6 , 7,  // Back face
     8,  9, 10,    8, 10, 11,  // Top face
    12, 13, 14,   12, 14, 15,  // Bottom face
    16, 17, 18,   16, 18, 19,  // Right face
    20, 21, 22,   20, 22, 23   // Left face
  ];
  geometry.addIndex("default", indices, WebGLRenderingContext.TRIANGLES);
  return geometry;
});

gr.register(() => {
    gr.registerComponent("OimoScene", {
        $awake: function() {
            // Configure the world like the other Oimo eraser samples (glboost/oimo). A bare
            // `new OIMO.World()` keeps Oimo's defaults (notably worldscale 100), which runs the
            // simulation in 1/100-scale space and never settles the dense pile.
            this.world = new OIMO.World({
                timestep: 1 / 60,
                iterations: 8,
                broadphase: 2, // 1 brute force, 2 sweep and prune, 3 volume tree
                worldscale: 1,
                random: true,
                info: false,
                gravity: [0, -9.8, 0]
            });
        },
        $update: function() {
            this.world.step();
        }
    });
    gr.overrideDeclaration("scene", ["OimoScene"]);
    gr.registerComponent("Rigid", {
        attributes: {
            shape: {
                default: "box",
                converter: "String"
            },
            move: {
                converter: "Boolean",
                default: true
            }
        },
        $mount: function() {
            this.__bindAttributes();
            this.transform = this.node.getComponent("Transform");
            const p = this.transform.position;
            const r = this.transform.rotation;
            const s = this.transform.scale;
            const oimoScene = this.node.getComponentInAncestor("OimoScene");
            this.body = oimoScene.world.add({
                type: this.shape,
                size: [s.X * 2, s.Y * 2, s.Z * 2],
                pos: [p.X, p.Y, p.Z],
                rot: [r.X, r.Y, r.Z],
                move: this.move,
                density: 1,
                friction: 0.5,
                restitution: 0.1
            });
        },
        $update: function() {
            // Recycle movable erasers that fall off the small floor back to the top.
            if (this.move) {
                const cur = this.body.getPosition();
                if (cur.y < -15) {
                    const sp = spawnPosition();
                    this.body.resetPosition(sp[0], sp[1], sp[2]);
                }
            }
            const p = this.body.getPosition();
            this.transform.setAttribute("position", [p.x, p.y, p.z]);
            const r = this.body.getQuaternion();
            this.transform.setAttribute("rotation", new Quaternion([r.x, r.y, r.z, r.w]));
        }
    });
    gr.registerNode("rigid-cube", ["Rigid"], {
        material:"#green",
        geometry: "cube",
        scale: 0.5
    }, "mesh");
    gr.registerNode("rigid-eraser", ["Rigid"], {
        material: "new(textureShader)",
        geometry: "c1",
        texture: "../../../../assets/textures/eraser_001/eraser.png",
        // Eraser full size [4.0, 0.8, 2.0] (c1 geometry is 2 units, so scale = size / 2),
        // matching the other Oimo eraser samples (glboost/oimo, babylonjs/oimo).
        scale: [2.0, 0.4, 1.0]
    }, "mesh");
});