let app = clay.application.create('#main', {
    init: function (app) {
        this._world = new OIMO.World({ 
            timestep: 1/60 * 2, 
            iterations: 8, 
            broadphase: 2, // 1 brute force, 2 sweep and prune, 3 volume tree
            worldscale: 1, // scale full world 
            random: true,  // randomize sample
            info: false,   // calculate statistic or not
            gravity: [0,-9.8,0] 
        });
        
        // Create a orthographic camera
        this._camera = app.createCamera(null, null, 'perspective');
        this._camera.position.set(0, 50, 400);
        app.resize(window.innerWidth, window.innerHeight);
        
        // Create geometry
        let geometryCube  = new clay.geometry.Cube();
        let geometryGround  = new clay.geometry.Cube();
        geometryCube .generateTangents();
        geometryGround .generateTangents();
        
        let shader = clay.shader.library.get('clay.standard', 'diffuseMap');
        let material = new clay.Material({
            shader: shader
        })
                
        this._oimoCube = this._world.add({
            type: "box",
            size: [50*2, 50*2, 50*2],
            pos: [0, 100, 0],
            rot: [10, 0, 10],
            move: true,
            density: 1
        });
        
        this._oimoGround = this._world.add({
           type: "box",
            size: [200*2, 4*2, 200*2],
            pos: [0, -50, 0],
            rot: [0, 0, 0],
            move: false,
            density: 1
        });
        
        this._rad = 0;
         
        this._meshCube = app.createMesh(geometryCube, material);
        this._meshCube.scale.set(50, 50, 50);
        this._meshCube.position.set(0, 100, 0);
        this._meshGround = app.createMesh(geometryGround, material);
        this._meshGround.scale.set(200, 4, 200);
        this._meshGround.position.set(0, -50, 0);
        let diffuse = new clay.Texture2D;
        diffuse.load("../../../../assets/textures/frog.jpg");
        material.set('diffuseMap', diffuse);
        
        app.createAmbientLight("#fff", 1.0);

        this._control = new clay.plugin.OrbitControl({
            target: this._camera,
            domElement: app.container,
            autoRotateSpeed: 10,
            autoRotate :true
        });
    },
    loop: function () {
        this._control.update(app.deltaTime);

        this._world.step();
        
        let pos = this._oimoCube.getPosition();
        this._meshCube.position.set(pos.x, pos.y, pos.z);
        let rot = this._oimoCube.getQuaternion();
        this._meshCube.rotation.set(rot.x, rot.y, rot.z, rot.w);
        //this._camera.lookAt( new clay.Vector3(0,0,0), new clay.Vector3(0, 1, 0));
        //this._camera.position.set( 400 * Math.sin(this._rad ), 0, 400 * Math.cos(this._rad ));
        this._rad += Math.PI/180;
     }
});

window.onresize = function () {
    app.resize(window.innerWidth, window.innerHeight);
};
