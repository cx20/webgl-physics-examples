const dataSet = [
    {imageFile:"../../../../assets/textures/Basketball.jpg", scale:1.0}, // Basketball.jpg
    {imageFile:"../../../../assets/textures/BeachBall.jpg",  scale:0.9}, // BeachBall.jpg
    {imageFile:"../../../../assets/textures/Football.jpg",   scale:1.0}, // Football.jpg
    {imageFile:"../../../../assets/textures/Softball.jpg",   scale:0.3}, // Softball.jpg
    {imageFile:"../../../../assets/textures/TennisBall.jpg", scale:0.3}, // TennisBall.jpg
];
 
let meshSpheres = [];
let oimoSpheres = [];

// collider wireframe (W key)
let debugMeshes = [];        // all collider wireframes (for the W toggle)
let ballDebugMeshes = [];    // per-ball wireframes, parallel to oimoSpheres
let showWireframe = true;
const DEBUG_COLOR_DYNAMIC = [1.0, 0.5, 0.2];
const DEBUG_COLOR_STATIC = [0.2, 1.0, 0.4];

let app = clay.application.create('#main', {
    init: function (app) {
        this.initWorld();
        
        this.addGround(app);
        this.addBox(app);
        this.addBall(app);
        
        // Create a orthographic camera
        this._camera = app.createCamera(null, null, 'perspective');
        this._camera.position.set(0, 0, 60);
        this._rad = 0;
        app.resize(window.innerWidth, window.innerHeight);
         
        app.createAmbientLight("#fff", 0.2);
        this._mainLight = app.createDirectionalLight([-1, -1, -1]);
        this._control = new clay.plugin.OrbitControl({
            target: this._camera,
            domElement: app.container,
            autoRotateSpeed: 10,
            autoRotate :true
        });

        setWireframeVisible(showWireframe);
    },
    initWorld: function(app) {
        this._world = new OIMO.World({ 
            timestep: 1/60, 
            iterations: 8, 
            broadphase: 2, // 1 brute force, 2 sweep and prune, 3 volume tree
            worldscale: 1, // scale full world 
            random: true,  // randomize sample
            info: false,   // calculate statistic or not
            gravity: [0,-9.8,0] 
        });
    },
    addGround: function(app) {
        let geometryGround  = new clay.geometry.Cube();
        geometryGround.generateTangents();
        
        let shader = clay.shader.library.get('clay.standard', 'diffuseMap');
        let materialGround = new clay.Material({
            shader: shader
        })
        let diffuse = new clay.Texture2D();
        diffuse.load("../../../../assets/textures/grass.jpg"); // grass.jpg

        this._oimoGround = this._world.add({
           type: "box",
            size: [40*2, 0.4*2, 40*2],
            pos: [0, -8, 0],
            rot: [0, 0, 0],
            move: false,
            density: 1
        });

        this._meshGround = app.createMesh(geometryGround, materialGround);
        this._meshGround.scale.set(40, 0.4, 40);
        this._meshGround.position.set(0, -8, 0);
        materialGround.set('diffuseMap', diffuse);

        // Collider wireframe (matches the Oimo ground box, full size)
        addWireframeBox(app, 40 * 2, 0.4 * 2, 40 * 2, [0, -8, 0], DEBUG_COLOR_STATIC);
    },
    addBox: function(app) {
        let shader = clay.shader.library.get('clay.standard', 'diffuseMap');
        let materialSurface = new clay.Material({
            shader: shader
        });
        let diffuseSurface = new clay.Texture2D();
        diffuseSurface.load("./white.png"); // white.png
        materialSurface.set('diffuseMap', diffuseSurface);
        materialSurface.set('color', [0x70/0xFF, 0x70/0xFF, 0x70/0xFF]);
        materialSurface.depthMask = false;
        materialSurface.transparent = true;
        materialSurface.set('alpha', 0.5);
    
        let boxDataSet = [
            { size:[10, 10,  1], pos:[  0, 5,-5], rot:[0,0,0] },
            { size:[10, 10,  1], pos:[  0, 5, 5], rot:[0,0,0] },
            { size:[ 1, 10, 10], pos:[-5, 5,  0], rot:[0,0,0] },
            { size:[ 1, 10, 10], pos:[ 5, 5,  0], rot:[0,0,0] } 
        ];
        let geometrySurface = new clay.geometry.Cube();
        let surfaces = [];
        for ( let i = 0; i < boxDataSet.length; i++ ) {
            let size = boxDataSet[i].size;
            let pos  = boxDataSet[i].pos;
            let rot  = boxDataSet[i].rot;
            let meshSurface = app.createMesh(
                geometrySurface,
                materialSurface
            );
            meshSurface.position.set(pos[0], pos[1] - 8, pos[2]);
            meshSurface.scale.set(size[0]/2, size[1]/2, size[2]/2);
            let oimoGround = this._world.add({
                type: "box",
                size: [size[0], size[1], size[2]],
                pos: [pos[0], pos[1] - 8, pos[2]],
                rot: [0, 0, 0],
                move: false,
                density: 1
            });

            // Collider wireframe (matches the Oimo wall box, full size)
            addWireframeBox(app, size[0], size[1], size[2], [pos[0], pos[1] - 8, pos[2]], DEBUG_COLOR_STATIC);
        }
    },
    addBall: function (app) {
        let shader = clay.shader.library.get('clay.standard', 'diffuseMap');
        let materialSpheres = [];
        for (let i = 0; i < dataSet.length; i++ ) {
            let diffuseSphere = new clay.Texture2D();
            diffuseSphere.load(dataSet[i].imageFile);
            let materialSphere = new clay.Material({
                shader: shader
            });
            materialSphere.set('diffuseMap', diffuseSphere);
            materialSpheres.push(materialSphere);
        }
        
        let geometrySphere = new clay.geometry.Sphere();
        let n = 400;
        while (n--){
            let x = -25 + Math.random()*50;
            let y = 10 + Math.random()*40;
            let z = -25 + Math.random()*50;
            let w = 1;
            let h = 1;
            let d = 1;
            let pos = Math.floor(Math.random() * dataSet.length);
            let scale = dataSet[pos].scale;
            
            let meshSphere = app.createMesh(
                geometrySphere,
                materialSpheres[pos]
            );
            meshSphere.scale.set(w*scale, h*scale, d*scale);
            meshSphere.position.set(x, y, z);
            meshSpheres.push(meshSphere);
            let oimoSphere = this._world.add({
                type: "sphere",
                size: [w*scale, h*scale, d*scale],
                pos: [x, y, z],
                rot: [0, 0, 0],
                move: true,
                density: 1,
                friction: 0.2,
                restitution: 0.6
            });
            oimoSpheres.push(oimoSphere);

            // Per-ball collider wireframe (matches the Oimo sphere radius w*scale)
            let debugMesh = addWireframeSphere(app, w * scale, [x, y, z], DEBUG_COLOR_DYNAMIC);
            ballDebugMeshes.push(debugMesh);
        }
    },
    loop: function () {
        this._control.update(app.deltaTime);

        this._world.step();
        for ( let i = 0; i < oimoSpheres.length; i++ ) {
            let oimoSphere = oimoSpheres[i];
           let meshSphere = meshSpheres[i];
            let pos = oimoSphere.getPosition();
            meshSphere.position.set(pos.x, pos.y, pos.z);
            let rot = oimoSphere.getQuaternion();
            meshSphere.rotation.set(rot.x, rot.y, rot.z, rot.w);
            let debugMesh = ballDebugMeshes[i];
            if (debugMesh) {
                debugMesh.position.set(pos.x, pos.y, pos.z);
                debugMesh.rotation.set(rot.x, rot.y, rot.z, rot.w);
            }
            if ( meshSphere.position.y < -20 ) {
                let x = -25 + Math.random()*50;
                let y = 10 + Math.random()*40;
                let z = -25 + Math.random()*50;
               oimoSphere.resetPosition(x, y, z);
            }
        }
    }
});

// Build a box-edge wireframe (full size w x h x d, centred on the origin) as GL LINES.
function addWireframeBox(app, w, h, d, position, color) {
    let x = w / 2, y = h / 2, z = d / 2;
    let c = [
        [-x, -y, -z], [ x, -y, -z], [ x,  y, -z], [-x,  y, -z],
        [-x, -y,  z], [ x, -y,  z], [ x,  y,  z], [-x,  y,  z]
    ];
    let edges = [
        [0, 1], [1, 5], [5, 4], [4, 0], // bottom face
        [3, 2], [2, 6], [6, 7], [7, 3], // top face
        [0, 3], [1, 2], [5, 6], [4, 7]  // verticals
    ];
    let positions = [];
    for (let e = 0; e < edges.length; e++) {
        positions.push(c[edges[e][0]][0], c[edges[e][0]][1], c[edges[e][0]][2]);
        positions.push(c[edges[e][1]][0], c[edges[e][1]][1], c[edges[e][1]][2]);
    }
    return createLineMesh(app, positions, position, color);
}

// Build a sphere wireframe (radius r) as three great circles drawn with GL LINES.
function addWireframeSphere(app, r, position, color) {
    let SEG = 24;
    let positions = [];
    for (let ring = 0; ring < 3; ring++) {
        for (let i = 0; i < SEG; i++) {
            let a0 = (i / SEG) * Math.PI * 2;
            let a1 = ((i + 1) / SEG) * Math.PI * 2;
            let p0, p1;
            if (ring === 0) {
                p0 = [Math.cos(a0) * r, Math.sin(a0) * r, 0];
                p1 = [Math.cos(a1) * r, Math.sin(a1) * r, 0];
            } else if (ring === 1) {
                p0 = [Math.cos(a0) * r, 0, Math.sin(a0) * r];
                p1 = [Math.cos(a1) * r, 0, Math.sin(a1) * r];
            } else {
                p0 = [0, Math.cos(a0) * r, Math.sin(a0) * r];
                p1 = [0, Math.cos(a1) * r, Math.sin(a1) * r];
            }
            positions.push(p0[0], p0[1], p0[2], p1[0], p1[1], p1[2]);
        }
    }
    return createLineMesh(app, positions, position, color);
}

function createLineMesh(app, positions, position, color) {
    let geometry = new clay.Geometry();
    geometry.attributes.position.value = new Float32Array(positions);
    geometry.dirty();
    let material = new clay.Material({ shader: clay.shader.library.get('clay.basic') });
    material.set('color', color);
    // Draw collider wireframes on top of the (opaque) balls so they stay visible.
    material.depthTest = false;
    let mesh = app.createMesh(geometry, material);
    mesh.mode = (clay.Mesh.LINES !== undefined ? clay.Mesh.LINES : 1);
    mesh.position.set(position[0], position[1], position[2]);
    debugMeshes.push(mesh);
    return mesh;
}

function setWireframeVisible(visible) {
    showWireframe = visible;
    for (let i = 0; i < debugMeshes.length; i++) {
        debugMeshes[i].invisible = !visible;
    }
    let hint = document.getElementById('hint');
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