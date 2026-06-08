const dataSet = [
    {imageFile:"../../../../assets/textures/Basketball.jpg", scale:1.0}, // Basketball.jpg
    {imageFile:"../../../../assets/textures/BeachBall.jpg",  scale:0.9}, // BeachBall.jpg
    {imageFile:"../../../../assets/textures/Football.jpg",   scale:1.0}, // Football.jpg
    {imageFile:"../../../../assets/textures/Softball.jpg",   scale:0.3}, // Softball.jpg
    {imageFile:"../../../../assets/textures/TennisBall.jpg", scale:0.3}, // TennisBall.jpg
];

// glboost var
let glBoostContext;
let renderer;
let camera;
let scene;
let meshs = [];

//oimo var
let world;
let G = -10, nG = -10;
let wakeup = false;
let bodys = [];

// collider wireframe (W key)
let debugMeshs = [];        // all collider wireframes (for the W toggle)
let pieceDebugMeshs = [];   // per-ball wireframes, parallel to bodys
let showWireframe = true;
const DEBUG_COLOR_DYNAMIC = new GLBoost.Vector4(1.0, 0.5, 0.2, 1.0);
const DEBUG_COLOR_STATIC = new GLBoost.Vector4(0.2, 1.0, 0.4, 1.0);

init();

function init() {
    let width = window.innerWidth;
    let height = window.innerHeight;
    let canvas = document.getElementById("world");
    glBoostContext = new GLBoost.GLBoostMiddleContext(canvas);
    renderer = glBoostContext.createRenderer({ canvas: canvas, clearColor: {red:0, green:0, blue:0, alpha:1}});
    renderer.resize(width, height);
    scene = glBoostContext.createScene();

    camera = glBoostContext.createPerspectiveCamera({
        eye: new GLBoost.Vector3(0.0, 24, 48),
        center: new GLBoost.Vector3(0.0, 0.0, 0.0),
        up: new GLBoost.Vector3(0.0, 1.0, 0.0)
    }, {
        fovy: 45.0,
        aspect: width/height,
        zNear: 0.001,
        zFar: 300.0
    });
    camera.cameraController = glBoostContext.createCameraController();
    scene.addChild(camera);

    let directionalLight1 = glBoostContext.createDirectionalLight(new GLBoost.Vector3(1, 1, 1), new GLBoost.Vector3(30, 30, 30));
    scene.addChild( directionalLight1 );
    let directionalLight2 = glBoostContext.createDirectionalLight(new GLBoost.Vector3(1, 1, 1), new GLBoost.Vector3(-30, -30, -30));
    scene.addChild( directionalLight2 );

    // oimo init
    world = new OIMO.World({ 
        timestep: 1/60, 
        iterations: 8, 
        broadphase: 2, // 1 brute force, 2 sweep and prune, 3 volume tree
        worldscale: 1, // scale full world 
        random: true,  // randomize sample
        info: false,   // calculate statistic or not
        gravity: [0,-9.8,0] 
    });

    populate();

    // animate
    expression = glBoostContext.createExpressionAndRenderPasses(1);
    expression.renderPasses[0].scene = scene;
    expression.prepareToRender();

    animate();
}

function populate() {
    let max = 256;

    let ground2 = world.add({
        type: "box",
        size: [20, 2, 20],
        pos: [0, -1, 0],
        rot: [0, 0, 0],
        move: false,
        density: 1,
        friction: 0.5,
        restitution: 0.1,
    });
    
    addStaticBox([20, 2, 20], [0,-1,0], [0,0,0]);
    
    let boxDataSet = [
        { size:[5, 5,  0.5], pos:[  0, 2.5,-2.5], rot:[0,0,0] },
        { size:[5, 5,  0.5], pos:[  0, 2.5, 2.5], rot:[0,0,0] },
        { size:[ 0.5, 5, 5], pos:[-2.5, 2.5,  0], rot:[0,0,0] },
        { size:[ 0.5, 5, 5], pos:[ 2.5, 2.5,  0], rot:[0,0,0] } 
    ];
    
    let surfaces = [];
    for ( let i = 0; i < boxDataSet.length; i++ ) {
        let size = boxDataSet[i].size
        let pos  = boxDataSet[i].pos;
        let rot  = boxDataSet[i].rot;

        surfaces[i] = world.add({
            type: "box",
            size: size,
            pos: pos,
            rot: rot,
            move: false,
            density: 1,
            friction: 0.5,
            restitution: 0.1,
        });

        addStaticBox(size, pos, rot, true);
    }

    let w;	
    let h;
    let d;
    let textures = [];
    let materials = [];
    for (let i = 0; i < dataSet.length; i++) {
        let imageFile = dataSet[i].imageFile;

        textures[i] = glBoostContext.createTexture(imageFile);
        materials[i] = glBoostContext.createClassicMaterial();

        materials[i].setTexture(textures[i]);
        materials[i].shaderClass = GLBoost.LambertShader;
   }

    let x, y, z;
    let i = max;
    while (i--){
        x = -5 + Math.random()*10;
        y = 10 + Math.random()*5;
        z = -5 + Math.random()*10;
        w = 1 + Math.random()*0.5;
        h = 0.5 + Math.random()*0.5;
        d = 0.5 + Math.random()*0.5;
        let pos = Math.floor(Math.random() * dataSet.length);
        let scale = dataSet[pos].scale;
        w *= scale;
        bodys[i] = world.add({
            type: "sphere",
            size: [w*0.5],
            pos: [x, y, z],
            rot: [0, 0, 0],
            move: true,
            density: 1,
            friction: 0.5,
            restitution: 0.1,
        });

        let geoBox = glBoostContext.createSphere(w*0.5, 24, 24, null);
        meshs[i] = glBoostContext.createMesh(geoBox, materials[pos]);
        meshs[i].translate = new GLBoost.Vector3(w*0.5, w*0.5, w*0.5);
        scene.addChild(meshs[i]);

        // Per-ball collider wireframe (matches the Oimo sphere radius w*0.5)
        let wireGeo = createWireframeSphereGeometry(w*0.5, DEBUG_COLOR_DYNAMIC);
        let debugMesh = glBoostContext.createMesh(wireGeo, glBoostContext.createClassicMaterial());
        debugMesh.translate = new GLBoost.Vector3(x, y, z);
        scene.addChild(debugMesh);
        debugMeshs.push(debugMesh);
        pieceDebugMeshs[i] = debugMesh;
    }

    setWireframeVisible(showWireframe);
}

function addStaticBox(size, position, rotation, spec) {
    let geo1 = glBoostContext.createCube(new GLBoost.Vector3(size[0], size[1], size[2]), new GLBoost.Vector4(0.5, 0.5, 0.5, 1));
    
    let material = glBoostContext.createClassicMaterial();
    material.shaderClass = GLBoost.LambertShader;
    material.baseColor = new GLBoost.Vector4(0.5, 0.5, 0.5, 0.5);
    
    let mground1 = glBoostContext.createMesh(geo1, material);
    mground1.translate = new GLBoost.Vector3(position[0], position[1], position[2]);
    
    if ( spec ) {
        mground1.opacity = 0.5;
    }
    mground1.dirty = true;
    scene.addChild( mground1 );

    // Collider wireframe (matches the Oimo box, full size)
    let wireGeo = createWireframeBoxGeometry(size[0], size[1], size[2], DEBUG_COLOR_STATIC);
    let wireMesh = glBoostContext.createMesh(wireGeo, glBoostContext.createClassicMaterial());
    wireMesh.translate = new GLBoost.Vector3(position[0], position[1], position[2]);
    scene.addChild(wireMesh);
    debugMeshs.push(wireMesh);
}

function animate() {
    renderer.clearCanvas();
    renderer.draw(expression);
    
    world.step();
    
    let p, r, m, x, y, z;
    let i = bodys.length;
    let mesh;
    wakeup = false;

    if (G !== nG) {
        wakeup = true;
        G = nG;
    }

    while (i--) {
        let body = bodys[i];
        mesh = meshs[i];
        let p = body.getPosition();
        let q = body.getQuaternion();
        mesh.translate = new GLBoost.Vector3(p.x, p.y, p.z);
        mesh.quaternion = new GLBoost.Quaternion(q.x, q.y, q.z, q.w);
        let debugMesh = pieceDebugMeshs[i];
        if ( debugMesh ) {
            debugMesh.translate = new GLBoost.Vector3(p.x, p.y, p.z);
            debugMesh.quaternion = new GLBoost.Quaternion(q.x, q.y, q.z, q.w);
        }
        if ( p.y < -15 ) {
            x = -5 + Math.random()*10;
            y = 10 + Math.random()*5;
            z = -5 + Math.random()*10;
            bodys[i].resetPosition(x, y, z);
        }
    }

    let rotateMatrixY = GLBoost.Matrix33.rotateY(1);
    let rotatedVector = rotateMatrixY.multiplyVector(camera.eye);
    camera.eye = rotatedVector;

    requestAnimationFrame(animate);
}

// Build a box-edge wireframe geometry (full size w x h x d, centred on the origin)
// as GL LINES, with a per-vertex colour so it draws as a solid coloured outline.
function createWireframeBoxGeometry(w, h, d, color) {
    let x = w / 2, y = h / 2, z = d / 2;
    let c = [
        new GLBoost.Vector3(-x, -y, -z), // 0
        new GLBoost.Vector3( x, -y, -z), // 1
        new GLBoost.Vector3( x,  y, -z), // 2
        new GLBoost.Vector3(-x,  y, -z), // 3
        new GLBoost.Vector3(-x, -y,  z), // 4
        new GLBoost.Vector3( x, -y,  z), // 5
        new GLBoost.Vector3( x,  y,  z), // 6
        new GLBoost.Vector3(-x,  y,  z)  // 7
    ];
    let edges = [
        [0, 1], [1, 5], [5, 4], [4, 0], // bottom face
        [3, 2], [2, 6], [6, 7], [7, 3], // top face
        [0, 3], [1, 2], [5, 6], [4, 7]  // verticals
    ];
    let positions = [];
    let colors = [];
    for (let e = 0; e < edges.length; e++) {
        positions.push(c[edges[e][0]]);
        positions.push(c[edges[e][1]]);
        colors.push(color);
        colors.push(color);
    }
    let geometry = glBoostContext.createGeometry();
    geometry.setVerticesData({
        position: positions,
        color: colors
    }, null, GLBoost.LINES);
    return geometry;
}

// Build a sphere wireframe geometry (radius r, centred on the origin) as three
// great circles drawn with GL LINES, with a per-vertex colour.
function createWireframeSphereGeometry(r, color) {
    let SEG = 24;
    let positions = [];
    let colors = [];
    for (let ring = 0; ring < 3; ring++) {
        for (let i = 0; i < SEG; i++) {
            let a0 = (i / SEG) * Math.PI * 2;
            let a1 = ((i + 1) / SEG) * Math.PI * 2;
            let p0, p1;
            if (ring === 0) {
                p0 = new GLBoost.Vector3(Math.cos(a0) * r, Math.sin(a0) * r, 0);
                p1 = new GLBoost.Vector3(Math.cos(a1) * r, Math.sin(a1) * r, 0);
            } else if (ring === 1) {
                p0 = new GLBoost.Vector3(Math.cos(a0) * r, 0, Math.sin(a0) * r);
                p1 = new GLBoost.Vector3(Math.cos(a1) * r, 0, Math.sin(a1) * r);
            } else {
                p0 = new GLBoost.Vector3(0, Math.cos(a0) * r, Math.sin(a0) * r);
                p1 = new GLBoost.Vector3(0, Math.cos(a1) * r, Math.sin(a1) * r);
            }
            positions.push(p0);
            positions.push(p1);
            colors.push(color);
            colors.push(color);
        }
    }
    let geometry = glBoostContext.createGeometry();
    geometry.setVerticesData({
        position: positions,
        color: colors
    }, null, GLBoost.LINES);
    return geometry;
}

function setWireframeVisible(visible) {
    showWireframe = visible;
    for (let i = 0; i < debugMeshs.length; i++) {
        debugMeshs[i].isVisible = visible;
    }
    let hint = document.getElementById('hint');
    if (hint) {
        hint.textContent = 'W: wireframe ' + (visible ? 'ON' : 'OFF');
    }
}

window.addEventListener('keydown', function(event) {
    if (event.repeat) return;
    if (event.code === 'KeyW' || event.key === 'w' || event.key === 'W') {
        setWireframeVisible(!showWireframe);
    }
});