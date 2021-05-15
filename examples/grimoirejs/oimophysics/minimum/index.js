const Quaternion = gr.lib.math.Quaternion;
gr(function() {
    const scene = gr("#main")("scene").single();
    const n = scene.addChildByName("rigid-cube", {
        position: [Math.random() * 3 - 1.5, Math.random() * 5 + 5, Math.random() * 3 - 1.5]
    });
});

gr.register(() => {
    gr.registerComponent("OimoScene", {
        attributes: {
        },
        $awake: function() {
            this.world = new OIMO.World();
            this.world.gravity = new OIMO.Vec3(0, -9.80665, 0);
        },
        $update: function() {
            this.world.step(1/60);
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
            const shapec = new OIMO.ShapeConfig();
            shapec.geometry = new OIMO.BoxGeometry(new OIMO.Vec3(s.X, s.Y, s.Z));
            const bodyc = new OIMO.RigidBodyConfig();
            bodyc.type = this.move ? OIMO.RigidBodyType.DYNAMIC : OIMO.RigidBodyType.STATIC;
            bodyc.position = new OIMO.Vec3(p.X, p.Y, p.Z);
            this.body = new OIMO.RigidBody(bodyc);
            this.body.setRotationXyz(new OIMO.Vec3(r.X, r.Y, r.Z));
            this.body.addShape(new OIMO.Shape(shapec));
            oimoScene.world.addRigidBody(this.body);
        },
        $update: function() {
            const p = this.body.getPosition();
            this.transform.setAttribute("position", [p.x, p.y, p.z]);
            const r = this.body.getOrientation();
            this.transform.setAttribute("rotation", new Quaternion([r.x, r.y, r.z, r.w]));
        }
    });
    gr.registerNode("rigid-cube", ["Rigid"], {
        geometry: "cube",
        scale: 5,
        texture: "../../../../assets/textures/frog.jpg"
    }, "mesh");
});