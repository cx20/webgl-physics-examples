var DOT_SIZE = 16;
var X_START_POS = -7;
var Y_START_POS =  0;
var Z_START_POS = -7;
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

// create a few materials for our objects
var black  = createMaterial(new pc.Color( 0xdc/0xff, 0xaa/0xff, 0x6b/0xff ));
var white  = createMaterial(new pc.Color( 0xff/0xff, 0xff/0xff, 0xff/0xff ));
var beige  = createMaterial(new pc.Color( 0xff/0xff, 0xcc/0xff, 0xcc/0xff ));
var brown  = createMaterial(new pc.Color( 0x80/0xff, 0x00/0xff, 0x00/0xff ));
var red    = createMaterial(new pc.Color( 0xff/0xff, 0x00/0xff, 0x00/0xff ));
var yellow = createMaterial(new pc.Color( 0xff/0xff, 0xff/0xff, 0x00/0xff ));
var green  = createMaterial(new pc.Color( 0x00/0xff, 0xff/0xff, 0x00/0xff ));
var ltblue = createMaterial(new pc.Color( 0x00/0xff, 0xff/0xff, 0xff/0xff ));
var blue   = createMaterial(new pc.Color( 0x00/0xff, 0x00/0xff, 0xff/0xff ));
var purple = createMaterial(new pc.Color( 0x80/0xff, 0x00/0xff, 0x80/0xff ));

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

// ***********    Initialize application   *******************
var canvas = document.getElementById("c");

// Create the application and start the update loop
var application = new pc.fw.Application(canvas);
application.start();

// Set the canvas to fill the window and automatically change resolution to be the same as the canvas size
application.setCanvasFillMode(pc.fw.FillMode.FILL_WINDOW);
application.setCanvasResolution(pc.fw.ResolutionMode.AUTO);

application.context.scene.ambientLight = new pc.Color(0.2, 0.2, 0.2);

// Set the gravity for our rigid bodies
application.context.systems.rigidbody.setGravity(0, -9.8, 0);

function createMaterial (color) {
    var material = new pc.scene.PhongMaterial();
    material.diffuse = color;
    // we need to call material.update when we change its properties
    material.update()
    return material;
}

// ***********    Create our floor   *******************

var floor = new pc.fw.Entity();

// add a 'box' model
application.context.systems.model.addComponent(floor, {
    type: "box",
});

// make the floor white
floor.model.material = white;

// scale it
floor.setLocalScale(20, 1, 20);

// add a rigidbody component so that other objects collide with it
application.context.systems.rigidbody.addComponent(floor, {
    type: "static",
    restitution: 0.5
});

// add a collision component
application.context.systems.collision.addComponent(floor, {
    type: "box",
    halfExtents: new pc.Vec3(10, 0.5, 10)
});

// add the floor to the hierarchy
application.context.root.addChild(floor);

// ***********    Create lights   *******************

// make our scene prettier by adding a directional light
var light = new pc.fw.Entity();
application.context.systems.light.addComponent(light, {
    type: "directional",
    color: new pc.Color(1, 1, 1),
    castShadows: true,
    shadowResolution: 2048
});

// set the direction for our light
light.setLocalEulerAngles(45, 30, 0);

// Add the light to the hierarchy
application.context.root.addChild(light);

// ***********    Create camera    *******************

// Create an Entity with a camera component
var camera = new pc.fw.Entity();
application.context.systems.camera.addComponent(camera, {
    clearColor: new pc.Color(0.5, 0.5, 0.8),
    farClip: 50
});

// add the camera to the hierarchy
application.context.root.addChild(camera);

// Move the camera a little further away
camera.translate(0, 10, 15);
camera.lookAt(0, 0, 0);

// ***********    Create templates    *******************

// Create a template for a falling box
// It will have a model component of type 'box'...
var domino = new pc.fw.Entity();
application.context.systems.model.addComponent(domino, {
    type: "box",
    castShadows: true
});

// ...a rigidbody component of type 'dynamic' so that it is simulated
// by the physics engine...
application.context.systems.rigidbody.addComponent(domino, {
    type: "dynamic",
    mass: 50,
    restitution: 0.5
});

// ... and a collision component of type 'box'
application.context.systems.collision.addComponent(domino, {
    type: "box",
    halfExtents: new pc.Vec3(0.05, 0.5, 0.5)
});

domino.setLocalScale(0.1, 1, 1);

// make the box red
//domino.model.material = red;

// Create a template for a falling box
// It will have a model component of type 'box'...
var boxTemplate = new pc.fw.Entity();
application.context.systems.model.addComponent(boxTemplate, {
    type: "box",
    castShadows: true
});

// ...a rigidbody component of type 'dynamic' so that it is simulated
// by the physics engine...
application.context.systems.rigidbody.addComponent(boxTemplate, {
    type: "dynamic",
    mass: 50,
    restitution: 0.5
});

// ... and a collision component of type 'box'
application.context.systems.collision.addComponent(boxTemplate, {
    type: "box",
    halfExtents: new pc.Vec3(0.5, 0.5, 0.5)
});

// make the box red
boxTemplate.model.material = red;

for ( var i = 0; i < dataSet.length; i++ ) 
{
    var x = X_START_POS + (i % 16) * .8;
    var z = Z_START_POS + Math.floor( i / 16 ) * 1.1;
    
    // Clone a random template and position it above the floor
    var clone = domino.clone();
    // enable the clone because the template is disabled
    clone.enabled = true;
    clone.model.material = getRgbColor(dataSet[i]);
    
    application.context.root.addChild(clone);
    
    clone.setLocalPosition( x, 0.5, z );
    
    // when we manually change the position of an Entity with a dynamic rigidbody
    // we need to call syncEntityToBody() so that the rigidbody will get the position
    // and rotation of the Entity.
    clone.rigidbody.syncEntityToBody();
}

// ***********    Update Function   *******************

// initialize variables for our update function
var timer = 0;
var count = 16;
application.on("update", function (dt) {
    // create a falling box every 0.2 seconds
    if (count > 0) {
        timer -= dt;
        if (timer <= 0) {
            count--;
            timer = 0.1;
            var clone = boxTemplate.clone();
            // enable the clone because the template is disabled
            clone.enabled = true;
            application.context.root.addChild(clone);
            
            //clone.setLocalPosition(pc.math.random(-1,1), 10, pc.math.random(-1,1));
            var x = X_START_POS + -0.5;
            var z = Z_START_POS + count * 1.1;
            clone.setLocalPosition( x, 3, z );
            
            // when we manually change the position of an Entity with a dynamic rigidbody
            // we need to call syncEntityToBody() so that the rigidbody will get the position
            // and rotation of the Entity.
            clone.rigidbody.syncEntityToBody();
       }
    }
});