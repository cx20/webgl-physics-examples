const Quaternion = gr.lib.math.Quaternion;
gr(function() {
    const scene = gr("#main")("scene").single();
    setInterval(function() {
        const n = scene.addChildByName("rigid-eraser", {
            position: [Math.random() * 3 - 1.5, Math.random() * 5 + 5, Math.random() * 3 - 1.5]
        });
    }, 200);
});

var GeometryFactory = gr.lib.fundamental.Geometry.GeometryFactory;
var Geometry = gr.lib.fundamental.Geometry.Geometry;
GeometryFactory.addType("custom", {}, function(gl,attrs){
  var geometry = new Geometry(gl);
  var positions = new Float32Array([
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
  var texcoords = new Float32Array([
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
  var indices = [
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
            this.world = new OIMO.World();
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
                density: 1
            });
        },
        $update: function() {
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
        //scale: [1.0, 0.2, 0.5]
        scale: [1.0, 0.2, 0.5]
    }, "mesh");
});