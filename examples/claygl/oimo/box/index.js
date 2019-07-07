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

function getRgbColor( c )
{
    let colorHash = {
        "無":[0xDC/0xFF, 0xAA/0xFF, 0x6B/0xFF],    // 段ボール色
        "白":[0xff/0xFF, 0xff/0xFF, 0xff/0xFF],
        "肌":[0xff/0xFF, 0xcc/0xFF, 0xcc/0xFF],
        "茶":[0x80/0xFF, 0x00/0xFF, 0x00/0xFF],
        "赤":[0xff/0xFF, 0x00/0xFF, 0x00/0xFF],
        "黄":[0xff/0xFF, 0xff/0xFF, 0x00/0xFF],
        "緑":[0x00/0xFF, 0xff/0xFF, 0x00/0xFF],
        "水":[0x00/0xFF, 0xff/0xFF, 0xff/0xFF],
        "青":[0x00/0xFF, 0x00/0xFF, 0xff/0xFF],
        "紫":[0x80/0xFF, 0x00/0xFF, 0x80/0xFF]
    };
    return colorHash[c];
}

let meshCubes = [];
let oimoCubes = [];

let app = clay.application.create('#main', {
    init: function (app) {
        this._world = new OIMO.World({ 
            timestep: 1/60 * 5, 
            iterations: 8, 
            broadphase: 2, // 1 brute force, 2 sweep and prune, 3 volume tree
            worldscale: 1, // scale full world 
            random: true,  // randomize sample
            info: false,   // calculate statistic or not
            gravity: [0,-9.8,0] 
        });
        
        // Create a orthographic camera
        this._camera = app.createCamera(null, null, 'perspective');
        this._camera.position.set(0, 0, 500);
        app.resize(window.innerWidth, window.innerHeight);
        // Create geometry
        let geometryCube  = new clay.geometry.Cube();
        let geometryGround  = new clay.geometry.Cube();
        geometryCube .generateTangents();
        geometryGround .generateTangents();
        
        let shader = clay.shader.library.get('clay.standard', 'diffuseMap');
        let materialGround = new clay.Material({
            shader: shader
        })
        let diffuse = new clay.Texture2D;
        diffuse.load("white.png"); // white.png
                
        this._oimoGround = this._world.add({
           type: "box",
            size: [200*2, 4*2, 200*2],
            pos: [0, -80, 0],
            rot: [0, 0, 0],
            move: false,
            density: 1
        });
        
        let box_size = 8;
        let i = 0;
        for (let y = 0; y < 16; y++) {
            for (let x = 0; x < 16; x++) {
                //i = (15 - x) + (15 - y) * 16;
                i = x + (15 - y) * 16;
                let x1 = -130 + x * (box_size+1)*2;
                let y1 = 30 + y * (box_size+1)*2;
                let z1 = 0;
                let rgbColor = getRgbColor(dataSet[i]);
                let meshCube = app.createCube({color:rgbColor});
                meshCube.scale.set(box_size, box_size, box_size);
                meshCube.position.set(x1*2, y1*2, z1*2);
                meshCubes.push(meshCube);
                let oimoCube = this._world.add({
                    type: "box",
                    size: [box_size*2, box_size*2, box_size*2],
                    pos: [x1, y1, z1],
                    rot: [0, 0, 0],
                    move: true,
                    density: 1
                });
                oimoCubes.push(oimoCube);
            }
        }
        this._rad = 0;
         
        this._meshGround = app.createMesh(geometryGround, materialGround);
        this._meshGround.scale.set(200, 4, 200);
        this._meshGround.position.set(0, -80, 0);
        materialGround.set('diffuseMap', diffuse);
        
        app.createAmbientLight("#fff", 0.2);
        this._mainLight = app.createDirectionalLight([-1, -1, -1]);

        this._control = new clay.plugin.OrbitControl({
            target: this._camera,
            domElement: app.container,
            autoRotateSpeed: 10,
            autoRotate :true
        });
    },
    loop: function () {
        this._control.update(app.deltaTime);

        this._world.step();
        
        for ( let i = 0; i < oimoCubes.length; i++ ) {
            let oimoCube = oimoCubes[i];
            let meshCube = meshCubes[i];
            let pos = oimoCube.getPosition();
            meshCube.position.set(pos.x, pos.y, pos.z);
            let rot = oimoCube.getQuaternion();
            meshCube.rotation.set(rot.x, rot.y, rot.z, rot.w);
        }
     }
});