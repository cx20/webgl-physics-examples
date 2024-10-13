import * as pc from 'playcanvas';
import { loadWasmModuleAsync } from "https://rawcdn.githack.com/playcanvas/engine/f8e929634cf7b057f7c80ac206a4f3d2d11843dc/examples/src/wasm-loader.js";

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
loadWasmModuleAsync(
    'Ammo', 
    'https://rawcdn.githack.com/playcanvas/engine/f8e929634cf7b057f7c80ac206a4f3d2d11843dc/examples/src/lib/ammo/ammo.wasm.js',
    'https://rawcdn.githack.com/playcanvas/engine/f8e929634cf7b057f7c80ac206a4f3d2d11843dc/examples/src/lib/ammo/ammo.wasm.wasm',
    init);

function init() {
    // create a few materials for our objects
    let black  = createMaterial(new pc.Color( 0xdc/0xff, 0xaa/0xff, 0x6b/0xff ));
    let white  = createMaterial(new pc.Color( 0xff/0xff, 0xff/0xff, 0xff/0xff ));
    let beige  = createMaterial(new pc.Color( 0xff/0xff, 0xcc/0xff, 0xcc/0xff ));
    let brown  = createMaterial(new pc.Color( 0x80/0xff, 0x00/0xff, 0x00/0xff ));
    let red    = createMaterial(new pc.Color( 0xff/0xff, 0x00/0xff, 0x00/0xff ));
    let yellow = createMaterial(new pc.Color( 0xff/0xff, 0xff/0xff, 0x00/0xff ));
    let green  = createMaterial(new pc.Color( 0x00/0xff, 0xff/0xff, 0x00/0xff ));
    let ltblue = createMaterial(new pc.Color( 0x00/0xff, 0xff/0xff, 0xff/0xff ));
    let blue   = createMaterial(new pc.Color( 0x00/0xff, 0x00/0xff, 0xff/0xff ));
    let purple = createMaterial(new pc.Color( 0x80/0xff, 0x00/0xff, 0x80/0xff ));

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


    // Create a PlayCanvas application
    let canvas = document.getElementById("c");
    let app = new pc.Application(canvas, {});
    app.start();

    // Fill the available space at full resolution
    app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
    app.setCanvasResolution(pc.RESOLUTION_AUTO);

    app.scene.ambientLight = new pc.Color(1, 1, 1);

    function createMaterial (color) {
      let material = new pc.StandardMaterial();
      material.diffuse = color;
      // we need to call material.update when we change its properties
      material.update()
      return material;
    }

    // Create camera entity
    function Camera() {
      let cam = new pc.Entity();
      app.systems.camera.addComponent(cam, {
        clearColor: new pc.Color(0.1, 0.1, 0.1),
        farClip: 20
      });
      app.root.addChild(cam);
      this.entity = cam;
      this.timer = 0;
    }

    Camera.prototype.update = function (dt) {
      this.timer += dt;
      // Spin the camera around a center point
      let x = Math.sin(this.timer * 0.25) * 9;
      let z = Math.cos(this.timer * 0.25) * 6;
      let e = this.entity;
      e.setPosition(x, 5, z);
      e.lookAt(0, 2, 0);
    }

    // Create spot light entity
    function Light() {
      let light = new pc.Entity();
      light.setPosition(10, 10, 10);
      //light.setLocalEulerAngles(45, 45, 0);
      light.setLocalEulerAngles(45, 45, 45);
      app.systems.light.addComponent(light, {
        type: "directional",
        color: new pc.Color(1, 1, 1),
        castShadows: true,
        shadowResolution: 2048
      });
      app.root.addChild(light);
      this.entity = light;
    }

    // Create ground
    function Ground() {
      let ground = new pc.Entity();
      ground.setPosition(0, -0.5, 0);
      ground.setLocalScale(10, 1, 10);
      app.systems.model.addComponent(ground, {
        type: "box"
      });
      app.systems.rigidbody.addComponent(ground, {
        type: "static"
      });
      app.systems.collision.addComponent(ground, {
        type: "box",
        halfExtents: [5, 0.5, 5]
      });
      let blue = createMaterial(new pc.Color(0.28, 0.46, 1));
      ground.model.model.meshInstances[0].material = blue;
      app.root.addChild(ground);
      this.entity = ground;
    }

    // Create wall
    function Wall() {
      this.bricks = [];

      //for (let i = 0; i < 25; i++) {
      for (let i = 0; i < dataSet.length; i++) {
        let body = new pc.Entity();
        app.systems.model.addComponent(body, {
          type: "box",
          castShadows: true
        });
        app.systems.rigidbody.addComponent(body, {
          type: "dynamic"
        });
        app.systems.collision.addComponent(body, {
          type: "box",
          halfExtents: [0.5*DOT_SIZE, 0.5*DOT_SIZE, 0.5*DOT_SIZE]
        });
        app.root.addChild(body);
        body.model.material = getRgbColor(dataSet[i]);
        body.setLocalScale(1*DOT_SIZE, 1*DOT_SIZE, 1*DOT_SIZE);

        this.bricks.push(body);
      }
      this.reset();
    }

    Wall.prototype.reset = function () {
      for (let i = 0; i < this.bricks.length; i++) {
        let e = this.bricks[i];
        let x = (X_START_POS+(i % 16)) * DOT_SIZE;
        let y = (15-Math.floor( i / 16 )) * DOT_SIZE;
        let z = 0;
        //e.setPosition(i % 5 - 2, i / 5, 0);
        e.setPosition(x, y, z);
        e.setEulerAngles(0, 0, 0);
        e.rigidbody.linearVelocity = pc.Vec3.ZERO;
        e.rigidbody.angularVelocity = pc.Vec3.ZERO;
        e.rigidbody.syncEntityToBody();
      }
    };

    function Ball() {
      let e = new pc.Entity();
      e.setPosition(0, -10, 0);
      app.systems.model.addComponent(e, {
        type: "sphere",
        castShadows: true
      });
      app.systems.rigidbody.addComponent(e, {
        type: "dynamic"
      });
      app.systems.collision.addComponent(e, {
        type: "sphere",
        radius: 0.5
      });
      let red = createMaterial(new pc.Color(1, 0.28, 0.28));
      e.model.model.meshInstances[0].material = red;
      app.root.addChild(e);
      this.entity = e;
    }

    Ball.prototype.fire = function () {
      let e = this.entity;
      //e.setPosition(0, 2, 5);
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
    let ball = new Ball();

    // Reset the wall and fire the ball every 4 seconds
    let n = 0;
    setInterval(function () {
      n++;
      if (n % 4 === 0)
        wall.reset();
      if (n % 4 === 1)
        ball.fire();
    }, 1000);

    // Register an update event to rotate the camera
    app.on("update", function (dt) {
      camera.update(dt);
    });
}
