if (wasmSupported()) {
    loadWasmModuleAsync('Ammo', 'http://playcanvas.github.io/lib/ammo/ammo.wasm.js', 'http://playcanvas.github.io/lib/ammo/ammo.wasm.wasm', demo);
} else {
    loadWasmModuleAsync('Ammo', 'http://playcanvas.github.io/lib/ammo/ammo.js', '', demo);
}

function demo() {
    var canvas = document.getElementById("application-canvas");

    // Create the application and start the update loop
    var app = new pc.Application(canvas);
    app.start();

    // Set the canvas to fill the window and automatically change resolution to be the same as the canvas size
    app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
    app.setCanvasResolution(pc.RESOLUTION_AUTO);

    window.addEventListener("resize", function () {
        app.resizeCanvas(canvas.width, canvas.height);
    });

    var miniStats = new pc.MiniStats(app);

    app.scene.ambientLight = new pc.Color(0.2, 0.2, 0.2);

    function createColorMaterial(color) {
        var material = new pc.StandardMaterial();
        material.diffuse = color;
        material.update()

        return material;
    }
    function createTextureMaterial() {
        var material = new pc.scene.PhongMaterial();
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
        img.crossOrigin = "anonymous";
        img.src = "https://cx20.github.io/webgl-physics-examples/assets/textures/frog.jpg"; // frog.jpg
        return texture;
    }

    // Create a couple of materials for our objects
    var textureMaterial = createTextureMaterial();
    //var gray = createColorMaterial(new pc.Color(0.7, 0.7, 0.7));

    // Define a scene hierarchy in JSON format. This is loaded/parsed in
    // the parseScene function below
    var scene = [
        {
            // The Box entity has a collision component of type 'compound' and a
            // rigidbody component. This means that any descendent entity with a
            // collision component is added to a compound collision shape on the
            // Box entity. You can use compound collision shapes to define
            // complex, rigid shapes.
            name: 'Box',
            pos: [0, 10, 0],
            components: [
                {
                    type: 'collision',
                    options: {
                        type: 'compound'
                    }
                }, {
                    type: 'rigidbody',
                    options: {
                        type: 'dynamic',
                        friction: 0.5,
                        mass: 10,
                        restitution: 0.5
                    }
                }
            ],
            children: [
                {
                    name: 'Seat',
                    components: [
                        {
                            type: 'collision',
                            options: {
                                type: 'box',
                                halfExtents: [ 1, 1, 1 ]
                            }
                        }
                    ],
                    children: [
                        {
                            name: 'Seat Model',
                            scl: [ 2, 2, 2 ],
                            components: [
                                {
                                    type: 'model',
                                    options: {
                                        type: 'box',
                                        material: textureMaterial
                                    }
                                }
                            ]
                        }
                    ]
                }
            ]
        }, {
            name: 'Ground',
            pos: [ 0, -0.5, 0 ],
            components: [
                {
                    type: 'collision',
                    options: {
                        type: 'box',
                        halfExtents: [ 5, 0.5, 5 ]
                    }
                }, {
                    type: 'rigidbody',
                    options: {
                        type: 'static',
                        restitution: 0.5
                    }
                }
            ],
            children: [
                {
                    name: 'Ground Model',
                    scl: [ 10, 1, 10 ],
                    components: [
                        {
                            type: 'model',
                            options: {
                                type: 'box',
                                material: textureMaterial
                            }
                        }
                    ]
                }
            ]
        }, {
            name: 'Directional Light',
            rot: [ 45, 30, 0 ],
            components: [
                {
                    type: 'light',
                    options: {
                        type: 'directional',
                        castShadows: true,
                        shadowDistance: 8,
                        shadowBias: 0.1,
                        normalOffsetBias: 0.05
                    }
                }
            ]
        }, {
            name: 'Camera',
            pos: [ 0, 4, 7 ],
            rot: [ -30, 0, 0 ],
            components: [
                {
                    type: 'camera',
                    options: {
                        color: [ 0.5, 0.5, 0.5 ]
                    }
                }
            ]
        }
    ];

    // Convert an entity definition in the structure above to a pc.Entity object
    function parseEntity(e) {
        var entity = new pc.Entity(e.name);

        if (e.pos) {
            entity.setLocalPosition(e.pos[0], e.pos[1], e.pos[2]);
        }
        if (e.rot) {
            entity.setLocalEulerAngles(e.rot[0], e.rot[1], e.rot[2]);
        }
        if (e.scl) {
            entity.setLocalScale(e.scl[0], e.scl[1], e.scl[2]);
        }

        if (e.components) {
            e.components.forEach(function (c) {
                entity.addComponent(c.type, c.options);
            });
        }

        if (e.children) {
            e.children.forEach(function (child) {
                entity.addChild(parseEntity(child));
            });
        }

        return entity;
    }

    // Parse the scene data above into entities and add them to the scene's root entity
    function parseScene(s) {
        s.forEach(function (e) {
            app.root.addChild(parseEntity(e));
        });
    }

    parseScene(scene);
}
