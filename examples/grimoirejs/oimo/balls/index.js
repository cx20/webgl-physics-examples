const Quaternion = gr.lib.math.Quaternion;
const dataSet = [
    {imageFile:"../../../../assets/textures/Basketball.jpg", scale:1.0}, // Basketball.jpg
    {imageFile:"../../../../assets/textures/BeachBall.jpg",  scale:0.9}, // BeachBall.jpg
    {imageFile:"../../../../assets/textures/Football.jpg",   scale:1.0}, // Football.jpg
    {imageFile:"../../../../assets/textures/Softball.jpg",   scale:0.3}, // Softball.jpg
    {imageFile:"../../../../assets/textures/TennisBall.jpg", scale:0.3}, // TennisBall.jpg
];

const GeometryFactory = gr.lib.fundamental.Geometry.GeometryFactory;
const Geometry = gr.lib.fundamental.Geometry.Geometry;

// collider wireframe (W key)
let debugNodes = [];
let showWireframe = true;

// Box-edge wireframe geometry (2-unit cube, matching Grimoire's "cube" so it lines up with
// the rigid-cube collider [scale * 2]). Drawn as GL LINES.
GeometryFactory.addType("collider-box-wire", {}, function(gl, attrs) {
    const geometry = new Geometry(gl);
    const c = [
        [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
        [-1, -1,  1], [1, -1,  1], [1, 1,  1], [-1, 1,  1]
    ];
    const positions = [];
    const normals = [];
    const inv = 1 / Math.sqrt(3);
    for (let i = 0; i < c.length; i++) {
        positions.push(c[i][0], c[i][1], c[i][2]);
        normals.push(c[i][0] * inv, c[i][1] * inv, c[i][2] * inv);
    }
    geometry.addAttributes(new Float32Array(positions), { POSITION: { size: 3 } });
    geometry.addAttributes(new Float32Array(normals), { NORMAL: { size: 3 } });
    geometry.addAttributes(new Float32Array((positions.length / 3) * 2), { TEXCOORD: { size: 2 } });
    const indices = [0,1, 1,5, 5,4, 4,0, 3,2, 2,6, 6,7, 7,3, 0,3, 1,2, 5,6, 4,7];
    geometry.addIndex("default", indices, WebGLRenderingContext.LINES);
    return geometry;
});

// Sphere wireframe geometry (radius 1, three great circles) drawn as GL LINES.
GeometryFactory.addType("collider-sphere-wire", {}, function(gl, attrs) {
    const geometry = new Geometry(gl);
    const SEG = 24;
    const positions = [];
    const normals = [];
    const indices = [];
    let idx = 0;
    for (let ring = 0; ring < 3; ring++) {
        const base = idx;
        for (let i = 0; i < SEG; i++) {
            const a = (i / SEG) * Math.PI * 2;
            let p;
            if (ring === 0) p = [Math.cos(a), Math.sin(a), 0];
            else if (ring === 1) p = [Math.cos(a), 0, Math.sin(a)];
            else p = [0, Math.cos(a), Math.sin(a)];
            positions.push(p[0], p[1], p[2]);
            normals.push(p[0], p[1], p[2]);
            indices.push(base + i, base + ((i + 1) % SEG));
            idx++;
        }
    }
    geometry.addAttributes(new Float32Array(positions), { POSITION: { size: 3 } });
    geometry.addAttributes(new Float32Array(normals), { NORMAL: { size: 3 } });
    geometry.addAttributes(new Float32Array((positions.length / 3) * 2), { TEXCOORD: { size: 2 } });
    geometry.addIndex("default", indices, WebGLRenderingContext.LINES);
    return geometry;
});

function setWireframeVisible(visible) {
    showWireframe = visible;
    for (let i = 0; i < debugNodes.length; i++) {
        try { debugNodes[i].enabled = visible; } catch (e) {}
    }
    const hint = document.getElementById('hint');
    if (hint) {
        hint.textContent = 'W: wireframe ' + (visible ? 'ON' : 'OFF');
    }
}

window.addEventListener('keydown', function(event) {
    if (event.repeat) return;
    if (event.code === 'KeyW' || event.key === 'w' || event.key === 'W') {
        setWireframeVisible(!showWireframe);
    }
});

gr(function() {
    const scene = gr("#main")("scene").single();
    let timer = setInterval(function() {
        let idx = Math.floor(Math.random() * dataSet.length);
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

            // Collider wireframe placed as a sibling (scene child) and synced to the physics
            // transform each frame.
            // WIP: the node is created (debugNodes fills) and the material is valid, but the
            // LINES wireframe geometry does not render with the default mesh material yet.
            // Needs follow-up (box/ball meshes themselves render fine).
            try {
                const wireName = this.shape === "box" ? "collider-box-wire" : "collider-sphere-wire";
                const parent = this.node.parent || this.node;
                const wireNode = parent.addChildByName(wireName, {
                    scale: [s.X, s.Y, s.Z],
                    position: [p.X, p.Y, p.Z]
                });
                if (wireNode) {
                    try { wireNode.enabled = showWireframe; } catch (e) {}
                    this.wireNode = wireNode;
                    debugNodes.push(wireNode);
                }
            } catch (e) {}
        },
        $update: function() {
            const p = this.body.getPosition();
            this.transform.setAttribute("position", [p.x, p.y, p.z]);
            const r = this.body.getQuaternion();
            this.transform.setAttribute("rotation", new Quaternion([r.x, r.y, r.z, r.w]));
            if (this.wireNode) {
                this.wireNode.setAttribute("position", [p.x, p.y, p.z]);
                this.wireNode.setAttribute("rotation", new Quaternion([r.x, r.y, r.z, r.w]));
            }
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
    gr.registerNode("collider-box-wire", [], {
        geometry: "collider-box-wire",
        albedo: "#44ee88",
        emission: "#44ee88"
    }, "mesh");
    gr.registerNode("collider-sphere-wire", [], {
        geometry: "collider-sphere-wire",
        albedo: "#ff8844",
        emission: "#ff8844"
    }, "mesh");
});
