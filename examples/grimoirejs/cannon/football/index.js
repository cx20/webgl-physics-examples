var timeStep = 1 / 60

// ‥‥‥‥‥‥‥‥‥‥‥‥‥□□□
// ‥‥‥‥‥‥〓〓〓〓〓‥‥□□□
// ‥‥‥‥‥〓〓〓〓〓〓〓〓〓□□
// ‥‥‥‥‥■■■□□■□‥■■■
// ‥‥‥‥■□■□□□■□□■■■
// ‥‥‥‥■□■■□□□■□□□■
// ‥‥‥‥■■□□□□■■■■■‥
// ‥‥‥‥‥‥□□□□□□□■‥‥
// ‥‥■■■■■〓■■■〓■‥‥‥
// ‥■■■■■■■〓■■■〓‥‥■
// □□■■■■■■〓〓〓〓〓‥‥■
// □□□‥〓〓■〓〓□〓〓□〓■■
// ‥□‥■〓〓〓〓〓〓〓〓〓〓■■
// ‥‥■■■〓〓〓〓〓〓〓〓〓■■
// ‥■■■〓〓〓〓〓〓〓‥‥‥‥‥
// ‥■‥‥〓〓〓〓‥‥‥‥‥‥‥‥
var dataSet = [
    "BK","BK","BK","BK","BK","BK","BK","BK","BK","BK","BK","BK","BK","BG","BG","BG",
    "BK","BK","BK","BK","BK","BK","RD","RD","RD","RD","RD","BK","BK","BG","BG","BG",
    "BK","BK","BK","BK","BK","RD","RD","RD","RD","RD","RD","RD","RD","RD","BG","BG",
    "BK","BK","BK","BK","BK","BR","BR","BR","BG","BG","BR","BG","BK","RD","RD","RD",
    "BK","BK","BK","BK","BR","BG","BR","BG","BG","BG","BR","BG","BG","RD","RD","RD",
    "BK","BK","BK","BK","BR","BG","BR","BR","BG","BG","BG","BR","BG","BG","BG","RD",
    "BK","BK","BK","BK","BR","BR","BG","BG","BG","BG","BR","BR","BR","BR","RD","BK",
    "BK","BK","BK","BK","BK","BK","BG","BG","BG","BG","BG","BG","BG","RD","BK","BK",
    "BK","BK","RD","RD","RD","RD","RD","BL","RD","RD","RD","BL","RD","BK","BK","BK",
    "BK","RD","RD","RD","RD","RD","RD","RD","BL","RD","RD","RD","BL","BK","BK","BR",
    "BG","BG","RD","RD","RD","RD","RD","RD","BL","BL","BL","BL","BL","BK","BK","BR",
    "BG","BG","BG","BK","BL","BL","RD","BL","BL","YL","BL","BL","YL","BL","BR","BR",
    "BK","BG","BK","BR","BL","BL","BL","BL","BL","BL","BL","BL","BL","BL","BR","BR",
    "BK","BK","BR","BR","BR","BL","BL","BL","BL","BL","BL","BL","BL","BL","BR","BR",
    "BK","BR","BR","BR","BL","BL","BL","BL","BL","BL","BL","BK","BK","BK","BK","BK",
    "BK","BR","BK","BK","BL","BL","BL","BL","BK","BK","BK","BK","BK","BK","BK","BK"
];

function getRgbColor(colorType)
{
    var colorHash = {
        "BK":"#dcaa6b", // black
        "WH":"#FFFFFF", // white
        "BG":"#FFCCCC", // beige
        "BR":"#800000", // brown
        "RD":"#FF0000", // red
        "YL":"#FFFF00", // yellow
        "GN":"#00FF00", // green
        "WT":"#00FFFF", // water
        "BL":"#0000FF", // blue
        "PR":"#800080"  // purple
    };
    return colorHash[colorType];
}


const Quaternion = gr.lib.math.Quaternion;
gr(function() {
    const scene = gr("#main")("scene").single();
    for (var i = 0; i < dataSet.length; i++) {
        var x = i % 16 - 8;
        var y = 16 - Math.floor(i / 16);
        var z = 0;
        const n = scene.addChildByName("rigid-ball", {
            //material: "#" + dataSet[i],
            color: getRgbColor(dataSet[i]),
            scale: 0.5,
            position: [x + Math.random() * 0.1, y,  Math.random() * 0.1]
        });
    }

});

gr.register(() => {
    gr.registerComponent("CannonScene", {
        attributes: {
        },
        $awake: function () {
            this.world = new CANNON.World();
            this.world.gravity.set(0, -9.82, 0);
            this.world.broadphase = new CANNON.NaiveBroadphase();
            this.world.solver.iterations = 10;
            this.world.solver.tolerance = 0.1;
        },
        $update: function () {
            this.world.step(timeStep);
        }
    });
    gr.overrideDeclaration("scene", ["CannonScene"]);
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
        $mount: function () {
            this.__bindAttributes();
            this.transform = this.node.getComponent("Transform");
            const p = this.transform.position;
            const r = this.transform.rotation;
            const s = this.transform.scale;
            var mass = 1.0;
            var shape;
            if (this.shape == "box") {
                shape = new CANNON.Box(new CANNON.Vec3(s.X, s.Y, s.Z));
            }
            else if (this.shape == "sphere") {
                shape = new CANNON.Sphere(s.X);
            }
            body = new CANNON.Body({
                mass: this.move ? 1.0 : 0.0,
                position: new CANNON.Vec3(p.X, p.Y, p.Z),
                shape: shape
            });
            this.body = body;
            const cannonScene = this.node.getComponentInAncestor("CannonScene");
            cannonScene.world.addBody(body);
        },
        $update: function () {
            const p = this.body.position;
            this.transform.setAttribute("position", [p.x, p.y, p.z]);
            const r = this.body.quaternion;
            this.transform.setAttribute("rotation", new Quaternion([r.x, r.y, r.z, r.w]));
        }
    });
    gr.registerNode("rigid-cube", ["Rigid"], {
        //material:"#green",
        color: "#00ff00",
        geometry: "cube",
        shape: "box",
        scale: 1.0
    }, "mesh");
    gr.registerNode("rigid-ball", ["Rigid"], {
        //material:"#green",
        color: "#00ff00",
        geometry: "sphere",
        shape: "sphere",
        scale: 1.0,
        texture: "../../../../assets/textures/football.png"
   }, "mesh");
});