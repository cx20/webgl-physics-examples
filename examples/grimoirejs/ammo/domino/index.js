Ammo().then(function(Ammo) {
let update_trans = new Ammo.btTransform();

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
let dataSet = [
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
    let colorHash = {
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
    for ( let x = 0; x < 16; x++ ) {
        for ( let z = 0; z < 16; z ++ ) {
            i = x + (z) * 16;
            material: "#" + dataSet[i],
            y = -3.5;
            const n = scene.addChildByName("rigid-cube", {
                albedo: getRgbColor(dataSet[i]),
                scale: [0.2 * 0.5, 1.2 * 0.5, 1.0 * 0.5],
                position: [x-8, y, z-8]
            });
        }
    }
    for ( i = 0; i < 16; i++ ) {
        x = -0.4;
        y = -2;
        z = i;
        const n = scene.addChildByName("rigid-cube", {
            albedo: "#ff0000",
            scale: [0.5, 0.5, 0.5],
            position: [x-8, y, z-8]
        });
    }

});

gr.register(() => {
    gr.registerComponent("AmmoScene", {
        attributes: {
        },
        $awake: function() {
            let collisionConfiguration = new Ammo.btDefaultCollisionConfiguration();
            let dispatcher = new Ammo.btCollisionDispatcher(collisionConfiguration);
            let overlappingPairCache = new Ammo.btDbvtBroadphase();
            let solver = new Ammo.btSequentialImpulseConstraintSolver();
            let dynamicsWorld = new Ammo.btDiscreteDynamicsWorld(
                dispatcher, 
                overlappingPairCache, 
                solver, 
                collisionConfiguration
            );
            dynamicsWorld.setGravity(new Ammo.btVector3(0, -10, 0));
            this.world = dynamicsWorld;
        },
        $update: function() {
            this.world.stepSimulation(1/60, 0);
        }
    });
    gr.overrideDeclaration("scene", ["AmmoScene"]);
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
            const ammoScene = this.node.getComponentInAncestor("AmmoScene");
            let size = new Ammo.btVector3(s.X, s.Y, s.Z);
            let pos = new Ammo.btVector3(p.X, p.Y, p.Z);
            let form = new Ammo.btTransform();
            form.setIdentity();
            form.setOrigin(pos);
            let shape;
            let mass = this.move ? 10 : 0;
            if ( this.shape == "box" ) {
                shape = new Ammo.btBoxShape(size);
            } else if ( this.shape == "sphere" ) {
                shape = new Ammo.btSphereShape(size);
            }
            let localInertia = new Ammo.btVector3(0, 0, 0);
            shape.calculateLocalInertia(mass,localInertia);
            let body = new Ammo.btRigidBody(
                new Ammo.btRigidBodyConstructionInfo(
                    mass,
                    new Ammo.btDefaultMotionState(form),
                    shape,
                    localInertia
                )
            );
            this.body = body;
            ammoScene.world.addRigidBody(body);
        },
        $update: function() {
            this.body.getMotionState().getWorldTransform(update_trans);
            const p = update_trans.getOrigin();
            this.transform.setAttribute("position", [p.x(), p.y(), p.z()]);
            const r = update_trans.getRotation();
            this.transform.setAttribute("rotation", [r.x(), r.y(), r.z(), r.w()]);
        }
    });
    gr.registerNode("rigid-cube", ["Rigid"], {
        geometry: "cube",
        scale: 0.5
    }, "mesh");
});
});