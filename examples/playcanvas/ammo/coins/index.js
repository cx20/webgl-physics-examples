import * as pc from 'playcanvas';
import { loadWasmModuleAsync } from "https://rawcdn.githack.com/playcanvas/engine/f8e929634cf7b057f7c80ac206a4f3d2d11843dc/examples/src/wasm-loader.js";

// PlayCanvas + ammo.js — Falling Coins.
//
// Gold / silver / copper coins pour down like a waterfall onto an open floor. Each coin is drawn as
// a metallic cylinder (PBR metalness + a shared normal map for the minted relief, reflecting the
// papermill HDR environment) but collides as a sphere, so the coins roll and cascade rather than
// stacking flat. Coins that settle near the floor or fall off the edge recycle back to the top, so
// the stream never stops.

const HDR_URL = "https://cx20.github.io/gltf-test/textures/hdr/papermill_playcanvas_texture-tool.hdr";
const NORMAL_URL = "../../../../assets/textures/rockn.png";

// sRGB base colours from the three.js sample. With metalness=1 the base colour is the metal's tint;
// gloss = 1 - roughness.
const COIN_TYPES = [
    { name: "gold",   color: [1.0, 0.765, 0.337], diameter: 2.0, height: 0.20, gloss: 0.80 },
    { name: "silver", color: [0.973, 0.961, 0.918], diameter: 1.6, height: 0.16, gloss: 0.60 },
    { name: "copper", color: [0.953, 0.635, 0.541], diameter: 1.2, height: 0.12, gloss: 0.80 }
];

const COIN_COUNT = 350;
const DROP_HALF = 3.0;          // horizontal spread of the falling column
const SPAWN_Y_MIN = 24;         // recycled coins re-enter at the top of this band
const SPAWN_Y_MAX = 32;
const COLUMN_Y_MIN = 2;         // initial fill spans the whole column for an instant waterfall
const COLUMN_Y_MAX = 32;

const RESET_Y = -10;            // fell off the floor edge -> recycle
const SETTLE_Y = 4.0;           // a coin resting below this height is lifted back to the top
const SETTLE_SPEED = 0.5;       // linear speed below which a coin counts as "still"
const SETTLE_FRAMES = 18;

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

    window.addEventListener("resize", function () {
        app.resizeCanvas(canvas.width, canvas.height);
    });

    window.addEventListener("keydown", function (event) {
        const isWKey = event.code === 'KeyW' || event.key === 'w' || event.key === 'W';
        if (!isWKey || event.repeat) return;
        showWireframe = !showWireframe;
        const hint = document.getElementById('hint');
        if (hint) hint.textContent = 'W: wireframe ' + (showWireframe ? 'ON' : 'OFF');
    });

    app.scene.ambientLight = new pc.Color(0.5, 0.5, 0.5);
    app.scene.skyboxIntensity = 1.0;
    app.scene.skyboxMip = 1;

    // HDR environment so the metals have something to reflect.
    app.assets.loadFromUrl(HDR_URL, "texture", function (err, asset) {
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
        intensity: 1.2,
        castShadows: true,
        shadowResolution: 2048,
        shadowBias: 0.2,
        normalOffsetBias: 0.05
    });
    light.setLocalEulerAngles(50, 30, 0);
    app.root.addChild(light);

    const camera = new pc.Entity("camera");
    camera.addComponent("camera", {
        clearColor: new pc.Color(0.13, 0.14, 0.16),
        nearClip: 0.01,
        farClip: 1000,
        fov: 60
    });
    app.root.addChild(camera);

    // Coin materials: PBR metalness + shared normal map (assigned once the texture arrives).
    const coinMaterials = COIN_TYPES.map(function (t) {
        const m = new pc.StandardMaterial();
        m.useMetalness = true;
        m.metalness = 1.0;
        m.diffuse = new pc.Color(t.color[0], t.color[1], t.color[2]);
        m.gloss = t.gloss;
        m.update();
        return m;
    });

    app.assets.loadFromUrl(NORMAL_URL, "texture", function (err, asset) {
        if (err) {
            console.error("Failed to load coin normal map:", err);
            return;
        }
        const tex = asset.resource;
        tex.addressU = pc.ADDRESS_REPEAT;
        tex.addressV = pc.ADDRESS_REPEAT;
        for (const m of coinMaterials) {
            m.normalMap = tex;
            m.bumpiness = 0.6;
            m.update();
        }
    });

    // Open floor (no walls), slate-grey.
    const floorMat = new pc.StandardMaterial();
    floorMat.diffuse = new pc.Color(0.18, 0.19, 0.21);
    floorMat.gloss = 0.2;
    floorMat.metalness = 0.0;
    floorMat.useMetalness = true;
    floorMat.update();

    const floor = new pc.Entity("floor");
    floor.setLocalPosition(0, -1, 0);
    floor.addComponent("collision", { type: "box", halfExtents: [12, 1, 12] });
    floor.addComponent("rigidbody", { type: "static", friction: 0.6, restitution: 0.2 });
    const floorModel = new pc.Entity("floorModel");
    floorModel.setLocalScale(24, 2, 24);
    floorModel.addComponent("model", { type: "box", material: floorMat });
    floor.addChild(floorModel);
    app.root.addChild(floor);

    function randomRange(min, max) {
        return Math.random() * (max - min) + min;
    }

    function randomColumnY() {
        return randomRange(COLUMN_Y_MIN, COLUMN_Y_MAX);
    }

    function placeAtTop(entity) {
        entity.setLocalPosition(
            randomRange(-DROP_HALF, DROP_HALF),
            randomRange(SPAWN_Y_MIN, SPAWN_Y_MAX),
            randomRange(-DROP_HALF, DROP_HALF)
        );
        entity.setLocalEulerAngles(randomRange(0, 360), randomRange(0, 360), randomRange(0, 360));
    }

    function recycle(entry) {
        placeAtTop(entry.entity);
        entry.entity.rigidbody.linearVelocity = pc.Vec3.ZERO;
        entry.entity.rigidbody.angularVelocity = pc.Vec3.ZERO;
        entry.entity.rigidbody.syncEntityToBody();
        entry.rest = 0;
    }

    // Build the coins: cylinder visual + sphere collider.
    const coins = [];
    for (let i = 0; i < COIN_COUNT; i++) {
        const ti = Math.floor(Math.random() * COIN_TYPES.length);
        const t = COIN_TYPES[ti];
        const radius = t.diameter * 0.5;

        const body = new pc.Entity("coin" + i);
        body.addComponent("collision", { type: "sphere", radius: radius });
        body.addComponent("rigidbody", {
            type: "dynamic",
            mass: 1,
            friction: 0.4,
            restitution: 0.2
        });

        const visual = new pc.Entity("coinModel");
        visual.setLocalScale(t.diameter, t.height, t.diameter);
        visual.addComponent("model", { type: "cylinder", material: coinMaterials[ti] });
        visual.model.castShadows = true;
        visual.model.receiveShadows = true;
        body.addChild(visual);

        app.root.addChild(body);

        // Initial fill across the whole column so the waterfall is full from the first frame.
        body.setLocalPosition(randomRange(-DROP_HALF, DROP_HALF), randomColumnY(), randomRange(-DROP_HALF, DROP_HALF));
        body.setLocalEulerAngles(randomRange(0, 360), randomRange(0, 360), randomRange(0, 360));
        body.rigidbody.syncEntityToBody();

        coins.push({ entity: body, rest: 0 });
    }

    let angle = 0;
    const EXPECTED_FPS = 60;
    app.on("update", function (dt) {
        const adjustSpeed = dt / (1 / EXPECTED_FPS);
        angle += 0.4 * adjustSpeed;

        camera.setLocalPosition(Math.sin(Math.PI * angle / 180) * 32, 18, Math.cos(Math.PI * angle / 180) * 32);
        camera.lookAt(0, 6, 0);

        if (showWireframe) {
            drawPhysicsDebug(app, [floor]);
            drawPhysicsDebug(app, coins.map(c => c.entity));
        }

        for (const coin of coins) {
            const pos = coin.entity.getPosition();
            if (pos.y < RESET_Y) {
                recycle(coin);
                continue;
            }
            if (pos.y < SETTLE_Y && coin.entity.rigidbody.linearVelocity.length() < SETTLE_SPEED) {
                coin.rest++;
                if (coin.rest > SETTLE_FRAMES) {
                    recycle(coin);
                }
            } else {
                coin.rest = 0;
            }
        }
    });
}
