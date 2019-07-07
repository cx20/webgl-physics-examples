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

function getRgbColor( c )
{
    var colorHash = {
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

var meshSpheres = [];
var oimoSpheres = [];

var app = clay.application.create('#main', {
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
        this._camera.position.set(0, 0, 5);
        app.resize(window.innerWidth, window.innerHeight);
        // Create geometry
        var geometrySphere  = new clay.geometry.Sphere();
        var geometryGround  = new clay.geometry.Cube();
        geometrySphere.generateTangents();
        geometryGround.generateTangents();
        
        var shader = clay.shader.library.get('clay.standard', 'diffuseMap');
        var materialGround = new clay.Material({
            shader: shader
        })
        var diffuse = new clay.Texture2D();
        diffuse.load("../../../../assets/textures/grass.jpg"); // grass.jpg

        var diffuseFootball = new clay.Texture2D();
        diffuseFootball.load("../../../../assets/textures/football.png"); // Football.png
        
        this._oimoGround = this._world.add({
           type: "box",
            size: [400*2, 4*2, 400*2],
            pos: [0, -80, 0],
            rot: [0, 0, 0],
            move: false,
            density: 1
        });
        
        var box_size = 8;
        var i = 0;
        for (var y = 0; y < 16; y++) {
            for (var x = 0; x < 16; x++) {
                i = (15 - x) + (15 - y) * 16;
                //i = x + (15 - y) * 16;
                var x1 = -130 + x * (box_size+1)*2 + Math.random();
                var y1 = 30 + y * (box_size+1)*2 + Math.random();
                var z1 = 0 + Math.random();
                var rgbColor = getRgbColor(dataSet[i]);
                var meshSphere = app.createSphere({color:rgbColor, diffuseMap:diffuseFootball});
                meshSphere.scale.set(box_size, box_size, box_size);
                meshSphere.position.set(x1*2, y1*2, z1*2);
                meshSpheres.push(meshSphere);
                var oimoSphere = this._world.add({
                    type: "sphere",
                    size: [box_size, box_size, box_size],
                    pos: [x1, y1, z1],
                    rot: [0, 0, 0],
                    move: true,
                    density: 1
                });
                oimoSpheres.push(oimoSphere);
            }
        }
        this._rad = 0;
         
        this._meshGround = app.createMesh(geometryGround, materialGround);
        this._meshGround.scale.set(400, 4, 400);
        this._meshGround.position.set(0, -80, 0);
        materialGround.set('diffuseMap', diffuse);
        
        app.createAmbientLight("#fff", 0.2);
        this._mainLight = app.createDirectionalLight([-1, -1, -1]);
    },
    loop: function () {
        this._world.step();
        
        for ( var i = 0; i < oimoSpheres.length; i++ ) {
            var oimoSphere = oimoSpheres[i];
            var meshSphere = meshSpheres[i];
            var pos = oimoSphere.getPosition();
            meshSphere.position.set(pos.x, pos.y, pos.z);
            var rot = oimoSphere.getQuaternion();
            meshSphere.rotation.set(rot.x, rot.y, rot.z, rot.w);
        }
        this._camera.lookAt( new clay.Vector3(0,0,0), new clay.Vector3(0, 1, 0));
        this._camera.position.set( 400 * Math.sin(this._rad ), 0, 400 * Math.cos(this._rad ));
        this._rad += Math.PI/180 * 0.1;
     }
});