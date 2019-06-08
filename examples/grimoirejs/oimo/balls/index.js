const Quaternion = gr.lib.math.Quaternion;
const dataSet = [
    {imageFile:"../../../../assets/textures/Basketball.jpg", scale:1.0}, // Basketball.jpg
    {imageFile:"../../../../assets/textures/BeachBall.jpg",  scale:0.9}, // BeachBall.jpg
    {imageFile:"../../../../assets/textures/Football.jpg",   scale:1.0}, // Football.jpg
    {imageFile:"../../../../assets/textures/Softball.jpg",   scale:0.3}, // Softball.jpg
    {imageFile:"../../../../assets/textures/TennisBall.jpg", scale:0.3}, // TennisBall.jpg
];
gr(function() {
    const scene = gr("#main")("scene").single();
    var timer = setInterval(function() {
        var idx = Math.floor(Math.random() * dataSet.length);
        const n = scene.addChildByName("rigid-sphere", {
            texture: dataSet[idx].imageFile,
            scale:dataSet[idx].scale,
            position: [Math.random() * 4 - 2, Math.random() * 5 + 15, Math.random() * 4 - 2],
        });
    }, 30);
    setTimeout(function(){
        clearInterval(timer);
    }, 10000 );
});
gr.register(() => {
    gr.registerComponent("OimoScene", {
        attributes: {
        },
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
                size: this.shape == "box" ? [s.X*2, s.Y*2, s.Z*2] : [s.X, s.Y, s.Z],
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
            if ( p.y < -10 ) {
                x = Math.random() * 4 - 2;
                y = Math.random() * 5 + 15;
                z = Math.random() * 4 - 2;
                this.body.resetPosition(x, y, z);
                //this.body.linearVelocity = new OIMO.Vec3((Math.random() - 0.5) * 5, 8, (Math.random() - 0.5) * 5);
            }
        }
    });
    gr.registerNode("rigid-cube", ["Rigid"], {
        geometry: "cube",
        shape: "box",
        scale: [1,1,1],
        transparent:"false"
    }, "mesh");
    gr.registerNode("rigid-sphere", ["Rigid"], {
        geometry: "sphere",
        shape: "sphere",
        scale: [1,1,1],
        transparent:"false"
    }, "mesh");
});
