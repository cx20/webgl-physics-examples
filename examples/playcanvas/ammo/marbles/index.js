import * as pc from 'playcanvas';
import { CameraControls } from 'playcanvas/scripts/esm/camera-controls.mjs';
import { loadWasmModuleAsync } from "https://rawcdn.githack.com/playcanvas/engine/f8e929634cf7b057f7c80ac206a4f3d2d11843dc/examples/src/wasm-loader.js";

const BASE_URL = "https://cx20.github.io/gltf-test";
const MARBLE_COUNT = 220;
const BOX_HALF = 5;
const SPAWN_MARGIN = 0.7;
const MARBLE_RADIUS = 0.5;
const MARBLE_VISUAL_SCALE = 0.42;
const HDR_URL = "https://cx20.github.io/gltf-test/textures/hdr/papermill_playcanvas_texture-tool.hdr";

const _DBG_COLOR_DYNAMIC = new pc.Color(0, 1, 0, 1);
const _DBG_COLOR_STATIC  = new pc.Color(1, 1, 0, 1);

function _drawWireSphere(app, pos, radius, color) {
    const pts = [];
    const segs = 16;
    for (let axis = 0; axis < 3; axis++) {
        let prev = null;
        for (let i = 0; i <= segs; i++) {
            const t = (i / segs) * Math.PI * 2;
            const c = Math.cos(t) * radius;
            const s = Math.sin(t) * radius;
            let cur;
            if      (axis === 0) cur = new pc.Vec3(pos.x,     pos.y + c, pos.z + s);
            else if (axis === 1) cur = new pc.Vec3(pos.x + c, pos.y,     pos.z + s);
            else                 cur = new pc.Vec3(pos.x + c, pos.y + s, pos.z    );
            if (prev) { pts.push(prev); pts.push(cur); }
            prev = cur;
        }
    }
    app.drawLines(pts, pts.map(() => color), false);
}

function drawPhysicsDebug(app, entities) {
    for (const entity of entities) {
        const col = entity.collision;
        if (!col || !col.type) continue;
        const isDynamic = entity.rigidbody?.type === pc.BODYTYPE_DYNAMIC;
        const color = isDynamic ? _DBG_COLOR_DYNAMIC : _DBG_COLOR_STATIC;
        const mat = new pc.Mat4().setTRS(entity.getPosition(), entity.getRotation(), pc.Vec3.ONE);
        switch (col.type) {
            case 'box': {
                const h = col.halfExtents;
                app.drawWireAlignedBox(new pc.Vec3(-h.x, -h.y, -h.z), new pc.Vec3(h.x, h.y, h.z), color, false, undefined, mat);
                break;
            }
            case 'sphere':
                _drawWireSphere(app, entity.getPosition(), col.radius, color);
                break;
        }
    }
}

let showWireframe = true;

loadWasmModuleAsync(
    'Ammo',
    'https://rawcdn.githack.com/playcanvas/engine/f8e929634cf7b057f7c80ac206a4f3d2d11843dc/examples/src/lib/ammo/ammo.wasm.js',
    'https://rawcdn.githack.com/playcanvas/engine/f8e929634cf7b057f7c80ac206a4f3d2d11843dc/examples/src/lib/ammo/ammo.wasm.wasm',
    init
);

function init() {
    const canvas = document.getElementById("c");
    const app = new pc.Application(canvas);
    app.start();

    app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
    app.setCanvasResolution(pc.RESOLUTION_AUTO);

    window.addEventListener("resize", function() {
        app.resizeCanvas(canvas.width, canvas.height);
    });

    window.addEventListener("keydown", function (event) {
        const isWKey = event.code === 'KeyW' || event.key === 'w' || event.key === 'W';
        if (!isWKey || event.repeat) return;
        showWireframe = !showWireframe;
        const hint = document.getElementById('hint');
        if (hint) hint.textContent = 'W: wireframe ' + (showWireframe ? 'ON' : 'OFF');
    });

    app.scene.ambientLight = new pc.Color(0.7, 0.7, 0.7);
    app.scene.skyboxIntensity = 1.0;
    app.scene.skyboxMip = 0;

    app.assets.loadFromUrl(HDR_URL, "texture", function(err, asset) {
        if (err) {
            console.error("Failed to load HDR environment:", err);
            return;
        }

        const source = asset.resource;
        const skybox = pc.EnvLighting.generateSkyboxCubemap(source, 256);
        const envAtlas = pc.EnvLighting.generateAtlas(source);
        app.scene.setSkybox([skybox, envAtlas]);
        app.scene.envAtlas = envAtlas;
    });

    const light = new pc.Entity("light");
    light.addComponent("light", {
        type: "directional",
        color: new pc.Color(1, 1, 1),
        castShadows: true,
        shadowResolution: 2048,
        shadowBias: 0.3,
        normalOffsetBias: 0.02
    });
    light.setLocalEulerAngles(45, 45, 45);
    app.root.addChild(light);

    const camera = new pc.Entity("camera");
    camera.addComponent("camera", {
        clearColor: new pc.Color(0.17, 0.18, 0.22),
        nearClip: 0.01,
        farClip: 1000,
        fov: 60
    });
    camera.addComponent('script');
    app.root.addChild(camera);
    const cc = camera.script.create(CameraControls);
    cc.enableFly = false;
    cc.reset(new pc.Vec3(0, 2, 0), new pc.Vec3(0, 9, 18));

    function createMaterial(color, opacity = 1.0) {
        const material = new pc.StandardMaterial();
        material.diffuse = color;
        material.opacity = opacity;
        material.blendType = opacity < 1.0 ? pc.BLEND_NORMAL : pc.BLEND_NONE;
        material.update();
        return material;
    }

    const floorMat = createMaterial(new pc.Color(0.55, 0.58, 0.65));
    const wallMat = createMaterial(new pc.Color(1, 1, 1), 0.25);

    const floor = new pc.Entity("floor");
    floor.setLocalPosition(0, -2, 0);
    floor.addComponent("collision", { type: "box", halfExtents: [20, 2, 20] });
    floor.addComponent("rigidbody", { type: "static", friction: 0.6, restitution: 0.2 });
    const floorModel = new pc.Entity("floorModel");
    floorModel.setLocalScale(40, 4, 40);
    floorModel.addComponent("model", { type: "box", material: floorMat, castShadows: false });
    floor.addChild(floorModel);
    app.root.addChild(floor);

    const wallData = [
        { size: [10, 10, 1], pos: [0, 5, -5] },
        { size: [10, 10, 1], pos: [0, 5, 5] },
        { size: [1, 10, 10], pos: [-5, 5, 0] },
        { size: [1, 10, 10], pos: [5, 5, 0] }
    ];

    const staticDebugEntities = [floor];
    for (const wall of wallData) {
        const box = new pc.Entity("box");
        box.setLocalPosition(wall.pos[0], wall.pos[1], wall.pos[2]);
        box.addComponent("collision", {
            type: "box",
            halfExtents: [wall.size[0] / 2, wall.size[1] / 2, wall.size[2] / 2]
        });
        box.addComponent("rigidbody", { type: "static", friction: 0.6, restitution: 0.2 });

        const boxModel = new pc.Entity("boxModel");
        boxModel.setLocalScale(wall.size[0], wall.size[1], wall.size[2]);
        boxModel.addComponent("model", { type: "box", material: wallMat, castShadows: false });

        box.addChild(boxModel);
        app.root.addChild(box);
        staticDebugEntities.push(box);
    }

    function randomRange(min, max) {
        return Math.random() * (max - min) + min;
    }

    function randomSpawn() {
        const min = -BOX_HALF + SPAWN_MARGIN;
        const max = BOX_HALF - SPAWN_MARGIN;
        return new pc.Vec3(
            randomRange(min, max),
            randomRange(2.0, 10.0),
            randomRange(min, max)
        );
    }

    function resetBody(entity) {
        const p = randomSpawn();
        entity.setLocalPosition(p.x, p.y, p.z);

        const eulerX = randomRange(0, 360);
        const eulerY = randomRange(0, 360);
        const eulerZ = randomRange(0, 360);
        entity.setLocalEulerAngles(eulerX, eulerY, eulerZ);

        entity.rigidbody.linearVelocity = pc.Vec3.ZERO;
        entity.rigidbody.angularVelocity = pc.Vec3.ZERO;
        entity.rigidbody.syncEntityToBody();
    }

    function collectSphereEntities(entity, output) {
        if (entity.name.indexOf("Sphere") !== -1 && (entity.render || entity.model)) {
            output.push(entity);
        }
        for (const child of entity.children) {
            collectSphereEntities(child, output);
        }
    }

    function enableShadows(entity) {
        if (entity.render) {
            entity.render.castShadows = true;
            entity.render.receiveShadows = true;
        }
        if (entity.model) {
            entity.model.castShadows = true;
            entity.model.receiveShadows = true;
        }
        for (const child of entity.children) {
            enableShadows(child);
        }
    }

    const marbles = [];
    const modelUrl = BASE_URL + "/tutorialModels/IridescenceMetallicSpheres/glTF/IridescenceMetallicSpheres.gltf";
    const filename = "IridescenceMetallicSpheres.gltf";

    app.assets.loadFromUrlAndFilename(modelUrl, filename, "container", function(err, asset) {
        if (err) {
            console.error(err);
            return;
        }

        const resource = asset.resource;
        const sourceRoot = resource.instantiateRenderEntity ?
            resource.instantiateRenderEntity() :
            resource.instantiateModelEntity();

        sourceRoot.enabled = false;
        app.root.addChild(sourceRoot);

        const sphereTemplates = [];
        collectSphereEntities(sourceRoot, sphereTemplates);

        if (sphereTemplates.length === 0) {
            console.warn("No sphere nodes were found in glTF.");
            return;
        }

        for (let i = 0; i < MARBLE_COUNT; i++) {
            const source = sphereTemplates[i % sphereTemplates.length];
            const body = new pc.Entity("marbleBody" + i);
            body.addComponent("collision", { type: "sphere", radius: MARBLE_RADIUS });
            body.addComponent("rigidbody", {
                type: "dynamic",
                mass: 1,
                friction: 0.2,
                restitution: 0.3
            });

            const visual = source.clone();
            visual.enabled = true;
            visual.setLocalPosition(0, 0, 0);
            visual.setLocalEulerAngles(0, 0, 0);
            visual.setLocalScale(MARBLE_VISUAL_SCALE, MARBLE_VISUAL_SCALE, MARBLE_VISUAL_SCALE);
            enableShadows(visual);

            body.addChild(visual);
            app.root.addChild(body);
            resetBody(body);
            marbles.push(body);
        }
    });

    app.on("update", function(dt) {
        if (showWireframe) {
            drawPhysicsDebug(app, staticDebugEntities);
            drawPhysicsDebug(app, marbles);
        }

        for (const marble of marbles) {
            if (marble.getPosition().y < -10) {
                resetBody(marble);
            }
        }
    });
}
