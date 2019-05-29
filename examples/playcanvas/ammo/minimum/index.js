var canvas = document.getElementById("c");
var app = new pc.fw.Application(canvas);
app.start();
app.setCanvasFillMode(pc.fw.FillMode.FILL_WINDOW);
app.setCanvasResolution(pc.fw.ResolutionMode.AUTO);
app.context.scene.ambientLight = new pc.Color(0.2, 0.2, 0.2);
app.context.systems.rigidbody.setGravity(0, -9.8, 0);

var ground = new pc.fw.Entity();

app.context.systems.model.addComponent(ground, {
    type: "box",
});

ground.model.material = createMaterial();
ground.setLocalScale(200, 2, 200);

app.context.systems.rigidbody.addComponent(ground, {type: "static", restitution: 0.5});
app.context.systems.collision.addComponent(ground, {type: "box", halfExtents: new pc.Vec3(100, 1, 100)});
app.context.root.addChild(ground);

var light = new pc.fw.Entity();
app.context.systems.light.addComponent(light, {type: "directional", color: new pc.Color(1, 1, 1), castShadows: true, shadowResolution: 2048});
light.setLocalEulerAngles(45, 30, 0);
app.context.root.addChild(light);

var camera = new pc.fw.Entity();
app.context.systems.camera.addComponent(camera, {clearColor: new pc.Color(0.5, 0.5, 0.8), farClip: 1000});
app.context.root.addChild(camera);
camera.translate(0, 50, 200);
camera.lookAt(0, 0, 0);

var box = new pc.fw.Entity();
app.context.systems.model.addComponent(box, {type: "box", castShadows: true});
app.context.systems.rigidbody.addComponent(box, {type: "dynamic", mass: 50, restitution: 0.5});
app.context.systems.collision.addComponent(box, {type: "box", halfExtents: new pc.Vec3(25, 25, 25)});
app.context.root.addChild(box);
box.setLocalPosition( 0, 100, 0 );
box.rigidbody.syncEntityToBody();
box.model.material = createMaterial();
box.setLocalScale(50, 50, 50);

function createMaterial() {
    var material = new pc.scene.PhongMaterial();
    material.diffuseMap = getTexture();
    material.update()
    return material;
}

function getTexture() {
    var texture = new pc.gfx.Texture(app.graphicsDevice);
    var img = new Image();
    img.onload = function () {
        texture.minFilter = pc.gfx.FILTER_LINEAR;
        texture.magFilter = pc.gfx.FILTER_LINEAR;
        texture.addressU = pc.gfx.ADDRESS_CLAMP_TO_EDGE;
        texture.addressV = pc.gfx.ADDRESS_CLAMP_TO_EDGE;
        texture.setSource(img);
    };
    img.src = "../../../../assets/textures/frog.jpg";  // frog.jpg
    return texture;
}

