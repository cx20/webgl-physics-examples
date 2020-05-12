const dataSet = [
    {imageFile:"../../../../assets/textures/Basketball.jpg", scale:1.0}, // Basketball.jpg
    {imageFile:"../../../../assets/textures/BeachBall.jpg",  scale:0.9}, // BeachBall.jpg
    {imageFile:"../../../../assets/textures/Football.jpg",   scale:1.0}, // Football.jpg
    {imageFile:"../../../../assets/textures/Softball.jpg",   scale:0.3}, // Softball.jpg
    {imageFile:"../../../../assets/textures/TennisBall.jpg", scale:0.3}, // TennisBall.jpg
];

if (wasmSupported()) {
    loadWasmModuleAsync('Ammo', 'https://playcanvas.github.io/lib/ammo/ammo.wasm.js', 'https://playcanvas.github.io/lib/ammo/ammo.wasm.wasm', init);
} else {
    loadWasmModuleAsync('Ammo', 'https://playcanvas.github.io/lib/ammo/ammo.js', '', init);
}

function init() {
    let canvas = document.getElementById("c");

    let app = new pc.Application(canvas);
    app.start();

    app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
    app.setCanvasResolution(pc.RESOLUTION_AUTO);

    window.addEventListener("resize", function () {
        app.resizeCanvas(canvas.width, canvas.height);
    });

    let miniStats = new pc.MiniStats(app);

    app.scene.ambientLight = new pc.Color(0.2, 0.2, 0.2);

    function createColorMaterial (color) {
        var material = new pc.StandardMaterial();
        material.diffuse = color;
        material.update()
        return material;
    }

    function createTextureMaterial(imageFile) {
        let material = new pc.scene.PhongMaterial();
        material.diffuseMap = getTexture(imageFile);
        material.update()

        return material;
    }
    
    function getTexture(imageFile) {
        let texture = new pc.gfx.Texture(app.graphicsDevice);
        let img = new Image();
        img.onload = function() {
            texture.minFilter = pc.gfx.FILTER_LINEAR;
            texture.magFilter = pc.gfx.FILTER_LINEAR;
            texture.addressU = pc.gfx.ADDRESS_CLAMP_TO_EDGE;
            texture.addressV = pc.gfx.ADDRESS_CLAMP_TO_EDGE;
            texture.setSource(img);
        };
        img.crossOrigin = "anonymous";
        //img.src = "https://cx20.github.io/webgl-physics-examples/assets/textures/frog.jpg"; // frog.jpg
        img.src = imageFile;
        return texture;
    }

    //let textureMaterial = createTextureMaterial();

    let light = new pc.Entity("light");
    light.addComponent("light", {
        type: "directional",
        color: new pc.Color(1, 1, 1),
        castShadows: true,
        shadowResolution: 2048
    });
    light.setLocalEulerAngles(45, 30, 0);
    app.root.addChild(light);

    let camera = new pc.Entity("camera");
    camera.addComponent("camera", {
        clearColor: new pc.Color(0.5, 0.5, 0.8),
        farClip: 50
    });
    camera.translate(0, 5, 10);
    camera.lookAt(0, 0, 0);
    app.root.addChild(camera);

	let spheres = [];
    for (let i = 0; i < dataSet.length; i++ ) {
    	let imageFile = dataSet[i].imageFile;
    	let scale = dataSet[i].scale;
	    let sphere = new pc.Entity("sphere" + i);
        sphere.setLocalPosition(Math.random(), i * 10, Math.random());
	    sphere.addComponent("collision", { type: "sphere", radius: scale/2 });
	    sphere.addComponent("rigidbody", { type: "dynamic", restitution: 0.5 });
	    let sphereModel = new pc.Entity("sphereModel" + i);
	    sphereModel.setLocalScale(scale, scale, scale);
	    let material = createTextureMaterial(imageFile);
	    sphereModel.addComponent("model", { type: "sphere", material: material });
	    sphere.addChild(sphereModel);
	    spheres.push(sphere);
        //app.root.addChild(sphere);
    }

    let floor = new pc.Entity("floor");
    floor.setLocalPosition(0, -0.5, 0);
    floor.addComponent("collision", { type: "box", halfExtents: [5, 0.5, 5] });
    floor.addComponent("rigidbody", { type: "static", restitution: 0.5 });
    let floorModel = new pc.Entity("floorModel");
    floorModel.setLocalScale(10, 1, 10);
    let whiteMaterial = createColorMaterial(new pc.Color(1, 1, 1));
    floorModel.addComponent("model", { type: "box", material: whiteMaterial });
    floor.addChild(floorModel);
    app.root.addChild(floor);

    let time = 0;
    let maxBalls = 100;
    let numBalls = 0;
    let balls = [];
    function spawnBall() {
        let index = Math.floor(Math.random() * dataSet.length);
        var sphere = spheres[index];
        var clone = sphere.clone();
        clone.setLocalPosition(Math.random() * 5 - 2.5, Math.random() * 20 + 1, Math.random() * 5 - 2.5);
        balls.push(clone);
        app.root.addChild(clone);
        numBalls++;
    }

    app.on("update", function (dt) {
    	time += dt;
        if (time > 0.1 && numBalls < 100) {
            spawnBall();
            time = 0;
        }
        
        for (let i = 0; i < numBalls; i++ ) {
        	let ball = balls[i];
            if (ball.localPosition.y < -10) {
                let x = -2.5 + Math.random() * 5;
                let y =  1.0 + Math.random() * 20;
                let z = -2.5 + Math.random() * 5;
                ball.setLocalPosition(x, y, z);
                ball.rigidbody.linearVelocity = pc.Vec3.ZERO;
                ball.rigidbody.angularVelocity = pc.Vec3.ZERO;
                ball.rigidbody.syncEntityToBody();
            }
        }
    });
}
