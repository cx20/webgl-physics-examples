const dataSet = [
    {imageFile:"../../../../assets/textures/Basketball.jpg", scale:1.0}, // Basketball.jpg
    {imageFile:"../../../../assets/textures/BeachBall.jpg",  scale:0.9}, // BeachBall.jpg
    {imageFile:"../../../../assets/textures/Football.jpg",   scale:1.0}, // Football.jpg
    {imageFile:"../../../../assets/textures/Softball.jpg",   scale:0.3}, // Softball.jpg
    {imageFile:"../../../../assets/textures/TennisBall.jpg", scale:0.3}, // TennisBall.jpg
];
 
let meshSpheres = [];
let oimoSpheres = [];

let app = clay.application.create('#main', {
    init: function (app) {
        this.initWorld();
        
        this.addGround(app);
        this.addBox(app);
        this.addBall(app);
        
        // Create a orthographic camera
        this._camera = app.createCamera(null, null, 'perspective');
        this._camera.position.set(0, 0, 500);
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
    },
    initWorld: function(app) {
        this._world = new OIMO.World({ 
            timestep: 1/60 * 5, 
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
            size: [400*2, 4*2, 400*2],
            pos: [0, -80, 0],
            rot: [0, 0, 0],
            move: false,
            density: 1
        });

        this._meshGround = app.createMesh(geometryGround, materialGround);
        this._meshGround.scale.set(400, 4, 400);
        this._meshGround.position.set(0, -80, 0);
        materialGround.set('diffuseMap', diffuse);
        
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
            { size:[100, 100,  10], pos:[  0, 50,-50], rot:[0,0,0] },
            { size:[100, 100,  10], pos:[  0, 50, 50], rot:[0,0,0] },
            { size:[ 10, 100, 100], pos:[-50, 50,  0], rot:[0,0,0] },
            { size:[ 10, 100, 100], pos:[ 50, 50,  0], rot:[0,0,0] } 
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
            meshSurface.position.set(pos[0], pos[1] - 80, pos[2]);
            meshSurface.scale.set(size[0]/2, size[1]/2, size[2]/2);
            let oimoGround = this._world.add({
                type: "box",
                size: [size[0], size[1], size[2]],
                pos: [pos[0], pos[1] - 80, pos[2]],
                rot: [0, 0, 0],
                move: false,
                density: 1
            });
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
            let x = -50 + Math.random()*100;
            let y = 200 + Math.random()*100;
            let z = -50 + Math.random()*100;
            let w = 10;
            let h = 10;
            let d = 10;
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
            if ( meshSphere.position.y < -100 ) {
                let x = -50 + Math.random()*100;
                let y = 200 + Math.random()*100;
                let z = -50 + Math.random()*100;
               oimoSphere.resetPosition(x, y, z);
            }
        }
    }
});