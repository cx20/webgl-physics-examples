let SCALE = 1 / 100;
let canvas = document.getElementById("c");
let app = new pc.fw.Application(canvas);
app.start();
app.setCanvasFillMode(pc.fw.FillMode.FILL_WINDOW);
app.setCanvasResolution(pc.fw.ResolutionMode.AUTO);
app.context.scene.ambientLight = new pc.Color(0.2, 0.2, 0.2);
app.context.systems.rigidbody.setGravity(0, -9.8, 0);

let ground = new pc.fw.Entity();
app.context.systems.model.addComponent(ground, {
    type: "box"
});
app.context.systems.rigidbody.addComponent(ground, {
    type: "static",
    restitution: 0.5
});
app.context.systems.collision.addComponent(ground, {
    type: "box",
    halfExtents: new pc.Vec3(100 * SCALE, 1 * SCALE, 100 * SCALE)
});
app.context.root.addChild(ground);
ground.model.material = createMaterial();
ground.setLocalScale(200 * SCALE, 2 * SCALE, 200 * SCALE);

let light = new pc.fw.Entity();
app.context.systems.light.addComponent(light, {
    type: "directional",
    color: new pc.Color(1, 1, 1),
    castShadows: true,
    shadowResolution: 2048
});
app.context.root.addChild(light);
light.setLocalEulerAngles(45, 30, 0);

let camera = new pc.fw.Entity();
app.context.systems.camera.addComponent(camera, {
    clearColor: new pc.Color(0.5, 0.5, 0.8),
    farClip: 1000
});
app.context.root.addChild(camera);
camera.translate(0, 50 * SCALE, 200 * SCALE);
camera.lookAt(0, 0, 0);

let box = new pc.fw.Entity();
app.context.systems.model.addComponent(box, {
    type: "box",
    castShadows: true
});
app.context.systems.rigidbody.addComponent(box, {
    type: "dynamic",
    mass: 50 * SCALE,
    restitution: 0.5
});
app.context.systems.collision.addComponent(box, {
    type: "box",
    halfExtents: new pc.Vec3(25 * SCALE, 25 * SCALE, 25 * SCALE)
});
app.context.root.addChild(box);
box.setLocalPosition(0, 100 * SCALE, 0);
box.rigidbody.syncEntityToBody();
box.model.material = createMaterial();
box.setLocalScale(50 * SCALE, 50 * SCALE, 50 * SCALE);

function createMaterial() {
    let material = new pc.scene.PhongMaterial();
    material.diffuseMap = getTexture();
    material.update()
    return material;
}

function getTexture() {
    let texture = new pc.gfx.Texture(app.graphicsDevice);
    let img = new Image();
    img.onload = function() {
        texture.minFilter = pc.gfx.FILTER_LINEAR;
        texture.magFilter = pc.gfx.FILTER_LINEAR;
        texture.addressU = pc.gfx.ADDRESS_CLAMP_TO_EDGE;
        texture.addressV = pc.gfx.ADDRESS_CLAMP_TO_EDGE;
        texture.setSource(img);
    };
    img.src = "../../../../assets/textures/frog.jpg"; // frog.jpg
    return texture;
}
