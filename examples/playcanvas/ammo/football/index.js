let DOT_SIZE = 0.3;
let X_START_POS = -7;
let Y_START_POS =  0;
let Z_START_POS =  0;
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
    "無","無","無","無","無","無","無","無","無","無","無","無","無","肌","肌","肌",
    "無","無","無","無","無","無","赤","赤","赤","赤","赤","無","無","肌","肌","肌",
    "無","無","無","無","無","赤","赤","赤","赤","赤","赤","赤","赤","赤","肌","肌",
    "無","無","無","無","無","茶","茶","茶","肌","肌","茶","肌","無","赤","赤","赤",
    "無","無","無","無","茶","肌","茶","肌","肌","肌","茶","肌","肌","赤","赤","赤",
    "無","無","無","無","茶","肌","茶","茶","肌","肌","肌","茶","肌","肌","肌","赤",
    "無","無","無","無","茶","茶","肌","肌","肌","肌","茶","茶","茶","茶","赤","無",
    "無","無","無","無","無","無","肌","肌","肌","肌","肌","肌","肌","赤","無","無",
    "無","無","赤","赤","赤","赤","赤","青","赤","赤","赤","青","赤","無","無","無",
    "無","赤","赤","赤","赤","赤","赤","赤","青","赤","赤","赤","青","無","無","茶",
    "肌","肌","赤","赤","赤","赤","赤","赤","青","青","青","青","青","無","無","茶",
    "肌","肌","肌","無","青","青","赤","青","青","黄","青","青","黄","青","茶","茶",
    "無","肌","無","茶","青","青","青","青","青","青","青","青","青","青","茶","茶",
    "無","無","茶","茶","茶","青","青","青","青","青","青","青","青","青","茶","茶",
    "無","茶","茶","茶","青","青","青","青","青","青","青","無","無","無","無","無",
    "無","茶","無","無","青","青","青","青","無","無","無","無","無","無","無","無"
];

// ***********    Initialize app   *******************
if (wasmSupported()) {
    loadWasmModuleAsync('Ammo', 'https://playcanvas.github.io/lib/ammo/ammo.wasm.js', 'https://playcanvas.github.io/lib/ammo/ammo.wasm.wasm', init);
} else {
    loadWasmModuleAsync('Ammo', 'https://playcanvas.github.io/lib/ammo/ammo.js', '', init);
}

function init() {

    // Create a PlayCanvas application
    let canvas = document.getElementById("c");
    let app = new pc.Application(canvas, {});
    app.start();

    let texture_grass = getTexture("../../../../assets/textures/grass.jpg");
    let texture_ball = getTexture("../../../../assets/textures/football.png");

    // create a few materials for our objects
    let black  = createMaterial(new pc.Color( 0xdc/0xff, 0xaa/0xff, 0x6b/0xff ), texture_ball);
    let white  = createMaterial(new pc.Color( 0xff/0xff, 0xff/0xff, 0xff/0xff ), texture_ball);
    let beige  = createMaterial(new pc.Color( 0xff/0xff, 0xcc/0xff, 0xcc/0xff ), texture_ball);
    let brown  = createMaterial(new pc.Color( 0x80/0xff, 0x00/0xff, 0x00/0xff ), texture_ball);
    let red    = createMaterial(new pc.Color( 0xff/0xff, 0x00/0xff, 0x00/0xff ), texture_ball);
    let yellow = createMaterial(new pc.Color( 0xff/0xff, 0xff/0xff, 0x00/0xff ), texture_ball);
    let green  = createMaterial(new pc.Color( 0x00/0xff, 0xff/0xff, 0x00/0xff ), texture_ball);
    let ltblue = createMaterial(new pc.Color( 0x00/0xff, 0xff/0xff, 0xff/0xff ), texture_ball);
    let blue   = createMaterial(new pc.Color( 0x00/0xff, 0x00/0xff, 0xff/0xff ), texture_ball);
    let purple = createMaterial(new pc.Color( 0x80/0xff, 0x00/0xff, 0x80/0xff ), texture_ball);

    function getRgbColor( c )
    {
        let colorHash = {
            "無":black,   // 0x000000,
            "白":white,   // 0xffffff,
            "肌":beige,   // 0xffcccc,
            "茶":brown,   // 0x800000,
            "赤":red,     // 0xff0000,
            "黄":yellow,  // 0xffff00,
            "緑":green,   // 0x00ff00,
            "水":ltblue,  // 0x00ffff,
            "青":blue,    // 0x0000ff,
            "紫":purple   // 0x800080
        };
        return colorHash[ c ];
    }

    // Fill the available space at full resolution
    app.setCanvasFillMode(pc.fw.FillMode.FILL_WINDOW);
    app.setCanvasResolution(pc.fw.ResolutionMode.AUTO);

    app.context.scene.ambientLight = new pc.Color(1, 1, 1);

    function createMaterial (color, texture) {
      let material = new pc.scene.PhongMaterial();
      material.diffuse = color;
      material.diffuseMapTint = true;
      material.diffuseMap = texture;
      material.update()
      return material;
    }

    // Create camera entity
    function Camera() {
      let cam = new pc.Entity();
      app.context.systems.camera.addComponent(cam, {
        clearColor: new pc.Color(0.1, 0.1, 0.1),
        farClip: 1000
      });
      app.context.root.addChild(cam);
      this.entity = cam;
      this.timer = 0;
    }

    Camera.prototype.update = function (dt) {
      this.timer += dt;
      // Spin the camera around a center point
      let x = Math.sin(this.timer * 0.25) * 6;
      let z = Math.cos(this.timer * 0.25) * 4;
      let e = this.entity;
      e.setPosition(x, 5, z);
      e.lookAt(0, 2, 0);
    }

    // Create spot light entity
    function Light() {
      let light = new pc.Entity();
      light.setPosition(10, 10, 10);
      light.setEulerAngles(45, 45, 0);
      app.context.systems.light.addComponent(light, {
        type: "directional",
        color: new pc.Color(1, 1, 1),
        castShadows: true,
        shadowResolution: 2048
      });
      app.context.root.addChild(light);
      this.entity = light;
    }

    // Create ground
    function Ground() {
      let ground = new pc.Entity();
      ground.setPosition(0, -0.5, 0);
      ground.setLocalScale(10, 1, 10);
      app.context.systems.model.addComponent(ground, {
        type: "box"
      });
      app.context.systems.rigidbody.addComponent(ground, {
        type: "static"
      });
      app.context.systems.collision.addComponent(ground, {
        type: "box",
        halfExtents: [5, 0.5, 5]
      });
      let material = createMaterial(new pc.Color(1, 1, 1), texture_grass);
      ground.model.model.meshInstances[0].material = material;
      app.context.root.addChild(ground);
      this.entity = ground;
    }

    // Create wall
    function Wall() {
      this.balls = [];

      for (let i = 0; i < dataSet.length; i++) {
        let ball = new Ball();
        ball.entity.model.material = getRgbColor(dataSet[i]);
        this.balls.push(ball);
      }
      this.reset();
    }

    Wall.prototype.reset = function () {
      for (let i = 0; i < this.balls.length; i++) {
        let e = this.balls[i].entity;
        let x = (X_START_POS+(i % 16)) * DOT_SIZE;
        let y = (15-Math.floor( i / 16 )) * DOT_SIZE;
        let z = 0;
        e.setPosition(x, y, z);
        e.setEulerAngles(0, 0, 0);
        e.rigidbody.linearVelocity = pc.Vec3.ZERO;
        e.rigidbody.angularVelocity = pc.Vec3.ZERO;
        e.rigidbody.syncEntityToBody();
      }
    };

    function Ball() {
      let e = new pc.Entity();
      e.setPosition(0, 0, 0);
      app.context.systems.model.addComponent(e, {
        type: "sphere",
        castShadows: true
      });
      app.context.systems.rigidbody.addComponent(e, {
        type: "dynamic"
      });
      app.context.systems.collision.addComponent(e, {
        type: "sphere",
        radius: DOT_SIZE/2
      });
      e.setLocalScale(DOT_SIZE, DOT_SIZE, DOT_SIZE);
      app.context.root.addChild(e);
      this.entity = e;
    }

    Ball.prototype.fire = function () {
      let e = this.entity;
      e.setPosition(0, 1, 5);
      e.rigidbody.syncEntityToBody();
      e.rigidbody.linearVelocity = new pc.Vec3((Math.random() - 0.5) * 10, 7, -30);
      e.rigidbody.angularVelocity = pc.Vec3.ZERO;
    };

    // Create the scene
    let camera = new Camera();
    let light = new Light();
    let ground = new Ground();
    let wall = new Wall();

    // Reset the wall and fire the ball every 4 seconds
    let n = 0;
    setInterval(function () {
      n++;
      if (n % 4 === 0)
        wall.reset();
    }, 1000);

    // Register an update event to rotate the camera
    app.on("update", function (dt) {
      camera.update(dt);
    });

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
        img.src = imageFile;
        return texture;
    }
}
