// Create a PlayCanvas application
var canvas = document.getElementById("c");
var app = new pc.fw.Application(canvas, {});
app.start();

var DOT_SIZE = 0.3;
var X_START_POS = -7;
var Y_START_POS =  0;
var Z_START_POS =  0;
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

var texture_grass = getTexture("../../../../assets/textures/grass.jpg");
var texture_ball = getTexture("../../../../assets/textures/football.png");
// create a few materials for our objects
var black  = createMaterial(new pc.Color( 0xdc/0xff, 0xaa/0xff, 0x6b/0xff ), texture_ball);
var white  = createMaterial(new pc.Color( 0xff/0xff, 0xff/0xff, 0xff/0xff ), texture_ball);
var beige  = createMaterial(new pc.Color( 0xff/0xff, 0xcc/0xff, 0xcc/0xff ), texture_ball);
var brown  = createMaterial(new pc.Color( 0x80/0xff, 0x00/0xff, 0x00/0xff ), texture_ball);
var red    = createMaterial(new pc.Color( 0xff/0xff, 0x00/0xff, 0x00/0xff ), texture_ball);
var yellow = createMaterial(new pc.Color( 0xff/0xff, 0xff/0xff, 0x00/0xff ), texture_ball);
var green  = createMaterial(new pc.Color( 0x00/0xff, 0xff/0xff, 0x00/0xff ), texture_ball);
var ltblue = createMaterial(new pc.Color( 0x00/0xff, 0xff/0xff, 0xff/0xff ), texture_ball);
var blue   = createMaterial(new pc.Color( 0x00/0xff, 0x00/0xff, 0xff/0xff ), texture_ball);
var purple = createMaterial(new pc.Color( 0x80/0xff, 0x00/0xff, 0x80/0xff ), texture_ball);

function getRgbColor( c )
{
    var colorHash = {
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
  var material = new pc.scene.PhongMaterial();
  material.diffuse = color;
  material.diffuseMapTint = true;
  material.diffuseMap = texture;
  material.update()
  return material;
}

// Create camera entity
function Camera() {
  var cam = new pc.fw.Entity();
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
  var x = Math.sin(this.timer * 0.25) * 6;
  var z = Math.cos(this.timer * 0.25) * 4;
  var e = this.entity;
  e.setPosition(x, 5, z);
  e.lookAt(0, 2, 0);
}

// Create spot light entity
function Light() {
  var light = new pc.fw.Entity();
  light.setPosition(10, 10, 10);
  light.setEulerAngles(45, 45, 0);
  app.context.systems.light.addComponent(light, {
    type: "spot",
    intensity: 0.5,
    castShadows: true,
    range: 60
  });
  app.context.root.addChild(light);
  this.entity = light;
}

// Create ground
function Ground() {
  var ground = new pc.fw.Entity();
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
  var material = createMaterial(new pc.Color(1, 1, 1), texture_grass);
  ground.model.model.meshInstances[0].material = material;
  app.context.root.addChild(ground);
  this.entity = ground;
}

// Create wall
function Wall() {
  this.balls = [];

  for (var i = 0; i < dataSet.length; i++) {
    var ball = new Ball();
    ball.entity.model.material = getRgbColor(dataSet[i]);
    this.balls.push(ball);
  }
  this.reset();
}

Wall.prototype.reset = function () {
  for (var i = 0; i < this.balls.length; i++) {
    var e = this.balls[i].entity;
    var x = (X_START_POS+(i % 16)) * DOT_SIZE;
    var y = (15-Math.floor( i / 16 )) * DOT_SIZE;
    var z = 0;
    e.setPosition(x, y, z);
    e.setEulerAngles(0, 0, 0);
    e.rigidbody.linearVelocity = pc.Vec3.ZERO;
    e.rigidbody.angularVelocity = pc.Vec3.ZERO;
    e.rigidbody.syncEntityToBody();
  }
};

function Ball() {
  var e = new pc.fw.Entity();
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
  var e = this.entity;
  e.setPosition(0, 1, 5);
  e.rigidbody.syncEntityToBody();
  e.rigidbody.linearVelocity = new pc.Vec3((Math.random() - 0.5) * 10, 7, -30);
  e.rigidbody.angularVelocity = pc.Vec3.ZERO;
};

// Create the scene
var camera = new Camera();
var light = new Light();
var ground = new Ground();
var wall = new Wall();

// Reset the wall and fire the ball every 4 seconds
var n = 0;
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
