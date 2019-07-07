const dataSet = [
    {imageFile:"../../../../assets/textures/Basketball.jpg", scale:1.0}, // Basketball.jpg
    {imageFile:"../../../../assets/textures/BeachBall.jpg",  scale:0.9}, // BeachBall.jpg
    {imageFile:"../../../../assets/textures/Football.jpg",   scale:1.0}, // Football.jpg
    {imageFile:"../../../../assets/textures/Softball.jpg",   scale:0.3}, // Softball.jpg
    {imageFile:"../../../../assets/textures/TennisBall.jpg", scale:0.3}, // TennisBall.jpg
];
 
var meshSpheres = [];
var oimoSpheres = [];

var app = clay.application.create('#main', {
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
        var geometryGround  = new clay.geometry.Cube();
        geometryGround.generateTangents();
        
        var shader = clay.shader.library.get('clay.standard', 'diffuseMap');
        var materialGround = new clay.Material({
            shader: shader
        })
        var diffuse = new clay.Texture2D();
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
        var shader = clay.shader.library.get('clay.standard', 'diffuseMap');
        var materialSurface = new clay.Material({
            shader: shader
        });
        var diffuseSurface = new clay.Texture2D();
        diffuseSurface.load("./white.png"); // white.png
        materialSurface.set('diffuseMap', diffuseSurface);
        materialSurface.set('color', [0x70/0xFF, 0x70/0xFF, 0x70/0xFF]);
        materialSurface.depthMask = false;
        materialSurface.transparent = true;
        materialSurface.set('alpha', 0.5);
    
        var boxDataSet = [
            { size:[100, 100,  10], pos:[  0, 50,-50], rot:[0,0,0] },
            { size:[100, 100,  10], pos:[  0, 50, 50], rot:[0,0,0] },
            { size:[ 10, 100, 100], pos:[-50, 50,  0], rot:[0,0,0] },
            { size:[ 10, 100, 100], pos:[ 50, 50,  0], rot:[0,0,0] } 
        ];
        var geometrySurface = new clay.geometry.Cube();
        var surfaces = [];
        for ( var i = 0; i < boxDataSet.length; i++ ) {
            var size = boxDataSet[i].size;
            var pos  = boxDataSet[i].pos;
            var rot  = boxDataSet[i].rot;
            var meshSurface = app.createMesh(
                geometrySurface,
                materialSurface
            );
            meshSurface.position.set(pos[0], pos[1] - 80, pos[2]);
            meshSurface.scale.set(size[0]/2, size[1]/2, size[2]/2);
            var oimoGround = this._world.add({
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
        var shader = clay.shader.library.get('clay.standard', 'diffuseMap');
        var materialSpheres = [];
        for (var i = 0; i < dataSet.length; i++ ) {
            var diffuseSphere = new clay.Texture2D();
            diffuseSphere.load(dataSet[i].imageFile);
            var materialSphere = new clay.Material({
                shader: shader
            });
            materialSphere.set('diffuseMap', diffuseSphere);
            materialSpheres.push(materialSphere);
        }
        
        var geometrySphere = new clay.geometry.Sphere();
        var n = 400;
        while (n--){
            var x = -50 + Math.random()*100;
            var y = 200 + Math.random()*100;
            var z = -50 + Math.random()*100;
            var w = 10;
            var h = 10;
            var d = 10;
            var pos = Math.floor(Math.random() * dataSet.length);
            var scale = dataSet[pos].scale;
            
            var meshSphere = app.createMesh(
                geometrySphere,
                materialSpheres[pos]
            );
            meshSphere.scale.set(w*scale, h*scale, d*scale);
            meshSphere.position.set(x, y, z);
            meshSpheres.push(meshSphere);
            var oimoSphere = this._world.add({
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
        for ( var i = 0; i < oimoSpheres.length; i++ ) {
            var oimoSphere = oimoSpheres[i];
           var meshSphere = meshSpheres[i];
            var pos = oimoSphere.getPosition();
            meshSphere.position.set(pos.x, pos.y, pos.z);
            var rot = oimoSphere.getQuaternion();
            meshSphere.rotation.set(rot.x, rot.y, rot.z, rot.w);
            if ( meshSphere.position.y < -100 ) {
                var x = -50 + Math.random()*100;
                var y = 200 + Math.random()*100;
                var z = -50 + Math.random()*100;
               oimoSphere.resetPosition(x, y, z);
            }
        }
    }
});