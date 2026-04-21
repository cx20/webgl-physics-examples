const { mat4, mat3, vec3, quat } = glMatrix;

const DUCK_GLTF_URL = 'https://rawcdn.githack.com/cx20/gltf-test/5465cc37/sampleModels/Duck/glTF/Duck.gltf';
const FALL_SCALE = 5.0;
const SHOW_DEBUG_BBOX = true;
const IDENTITY_QUATERNION = [0, 0, 0, 1];

let canvas;
let gl;
let extUint;

let program;
let attribs;
let uniforms;

let lineProgram;
let lineAttribs;
let lineUniforms;

let HK;
let worldId;
let duckBody;

let viewProj = mat4.create();
let projection = mat4.create();
let view = mat4.create();
let cameraCenter = vec3.fromValues(0, 5, 0);

let groundMesh;
let groundTexture;
let debugBoxMesh;

let duckModel = null;
let duckWorldMatrix = mat4.create();
let duckOffset = vec3.create();
let duckDebugSize = [1, 1, 1];

function isPowerOf2(value) {
    return (value & (value - 1)) === 0;
}

function createShader(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(shader));
    }
    return shader;
}

function createProgram(vsSource, fsSource) {
    const vs = createShader(gl.VERTEX_SHADER, vsSource);
    const fs = createShader(gl.FRAGMENT_SHADER, fsSource);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        throw new Error(gl.getProgramInfoLog(prog));
    }
    return prog;
}

function resize() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';
    gl.viewport(0, 0, canvas.width, canvas.height);
}

function createSolidTexture(r, g, b, a) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        1,
        1,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        new Uint8Array([r, g, b, a])
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    return tex;
}

function requiresMipmap(minFilter) {
    return minFilter === gl.NEAREST_MIPMAP_NEAREST ||
        minFilter === gl.LINEAR_MIPMAP_NEAREST ||
        minFilter === gl.NEAREST_MIPMAP_LINEAR ||
        minFilter === gl.LINEAR_MIPMAP_LINEAR;
}

function loadTexture(url, options = {}) {
    const flipY = !!options.flipY;
    const sampler = options.sampler || null;

    return new Promise((resolve) => {
        const texture = gl.createTexture();
        const image = new Image();
        image.crossOrigin = 'anonymous';
        image.onload = () => {
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, flipY ? 1 : 0);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);

            const pot = isPowerOf2(image.width) && isPowerOf2(image.height);
            if (sampler) {
                const wrapS = sampler.wrapS !== undefined ? sampler.wrapS : gl.REPEAT;
                const wrapT = sampler.wrapT !== undefined ? sampler.wrapT : gl.REPEAT;
                const minFilter = sampler.minFilter !== undefined ? sampler.minFilter : gl.LINEAR_MIPMAP_LINEAR;
                const magFilter = sampler.magFilter !== undefined ? sampler.magFilter : gl.LINEAR;

                if (pot) {
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrapS);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrapT);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, minFilter);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, magFilter);
                    if (requiresMipmap(minFilter)) {
                        gl.generateMipmap(gl.TEXTURE_2D);
                    }
                } else {
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, magFilter);
                }
            } else {
                if (pot) {
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
                    gl.generateMipmap(gl.TEXTURE_2D);
                } else {
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
                }
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            }
            resolve(texture);
        };
        image.src = url;
    });
}

function computeFlatNormals(positions, indices) {
    const normals = new Float32Array(positions.length);

    if (indices) {
        for (let i = 0; i < indices.length; i += 3) {
            const i0 = indices[i] * 3;
            const i1 = indices[i + 1] * 3;
            const i2 = indices[i + 2] * 3;

            const p0 = vec3.fromValues(positions[i0], positions[i0 + 1], positions[i0 + 2]);
            const p1 = vec3.fromValues(positions[i1], positions[i1 + 1], positions[i1 + 2]);
            const p2 = vec3.fromValues(positions[i2], positions[i2 + 1], positions[i2 + 2]);

            const e1 = vec3.sub(vec3.create(), p1, p0);
            const e2 = vec3.sub(vec3.create(), p2, p0);
            const n = vec3.normalize(vec3.create(), vec3.cross(vec3.create(), e1, e2));

            normals[i0] += n[0];
            normals[i0 + 1] += n[1];
            normals[i0 + 2] += n[2];

            normals[i1] += n[0];
            normals[i1 + 1] += n[1];
            normals[i1 + 2] += n[2];

            normals[i2] += n[0];
            normals[i2 + 1] += n[1];
            normals[i2 + 2] += n[2];
        }
    } else {
        for (let i = 0; i < positions.length; i += 9) {
            const p0 = vec3.fromValues(positions[i], positions[i + 1], positions[i + 2]);
            const p1 = vec3.fromValues(positions[i + 3], positions[i + 4], positions[i + 5]);
            const p2 = vec3.fromValues(positions[i + 6], positions[i + 7], positions[i + 8]);

            const e1 = vec3.sub(vec3.create(), p1, p0);
            const e2 = vec3.sub(vec3.create(), p2, p0);
            const n = vec3.normalize(vec3.create(), vec3.cross(vec3.create(), e1, e2));

            for (let j = 0; j < 3; j++) {
                const dst = i + j * 3;
                normals[dst] = n[0];
                normals[dst + 1] = n[1];
                normals[dst + 2] = n[2];
            }
        }
        return normals;
    }

    for (let i = 0; i < normals.length; i += 3) {
        const n = vec3.fromValues(normals[i], normals[i + 1], normals[i + 2]);
        const len = vec3.length(n);
        if (len > 0) {
            vec3.scale(n, n, 1.0 / len);
            normals[i] = n[0];
            normals[i + 1] = n[1];
            normals[i + 2] = n[2];
        } else {
            normals[i] = 0;
            normals[i + 1] = 1;
            normals[i + 2] = 0;
        }
    }

    return normals;
}

function calculateBoundingBox(positions) {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];

    for (let i = 0; i < positions.length; i += 3) {
        min[0] = Math.min(min[0], positions[i]);
        min[1] = Math.min(min[1], positions[i + 1]);
        min[2] = Math.min(min[2], positions[i + 2]);

        max[0] = Math.max(max[0], positions[i]);
        max[1] = Math.max(max[1], positions[i + 1]);
        max[2] = Math.max(max[2], positions[i + 2]);
    }

    return { min, max };
}

function mergeBoundingBox(a, b) {
    return {
        min: [
            Math.min(a.min[0], b.min[0]),
            Math.min(a.min[1], b.min[1]),
            Math.min(a.min[2], b.min[2])
        ],
        max: [
            Math.max(a.max[0], b.max[0]),
            Math.max(a.max[1], b.max[1]),
            Math.max(a.max[2], b.max[2])
        ]
    };
}

function getAccessorData(gltf, buffers, accessorIndex) {
    const accessor = gltf.accessors[accessorIndex];
    const bufferView = gltf.bufferViews[accessor.bufferView];
    const buffer = buffers[bufferView.buffer || 0];

    const componentMap = {
        5120: Int8Array,
        5121: Uint8Array,
        5122: Int16Array,
        5123: Uint16Array,
        5125: Uint32Array,
        5126: Float32Array
    };
    const compsMap = {
        SCALAR: 1,
        VEC2: 2,
        VEC3: 3,
        VEC4: 4,
        MAT4: 16
    };

    const TypedArray = componentMap[accessor.componentType];
    const components = compsMap[accessor.type];
    const count = accessor.count;
    const byteOffset = (bufferView.byteOffset || 0) + (accessor.byteOffset || 0);
    const byteStride = bufferView.byteStride || 0;
    const packedStride = TypedArray.BYTES_PER_ELEMENT * components;

    if (byteStride && byteStride !== packedStride) {
        const out = new TypedArray(count * components);
        const dataView = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
        for (let i = 0; i < count; i++) {
            const src = byteOffset + i * byteStride;
            for (let c = 0; c < components; c++) {
                const at = src + c * TypedArray.BYTES_PER_ELEMENT;
                const dst = i * components + c;
                if (accessor.componentType === 5126) out[dst] = dataView.getFloat32(at, true);
                else if (accessor.componentType === 5125) out[dst] = dataView.getUint32(at, true);
                else if (accessor.componentType === 5123) out[dst] = dataView.getUint16(at, true);
                else if (accessor.componentType === 5122) out[dst] = dataView.getInt16(at, true);
                else if (accessor.componentType === 5121) out[dst] = dataView.getUint8(at);
                else out[dst] = dataView.getInt8(at);
            }
        }
        return out;
    }

    return new TypedArray(buffer.buffer, buffer.byteOffset + byteOffset, count * components);
}

async function loadGLTF(url) {
    const response = await fetch(url);
    const gltf = await response.json();
    const baseUrl = url.substring(0, url.lastIndexOf('/') + 1);

    const buffers = [];
    for (const buf of gltf.buffers || []) {
        if (!buf.uri) {
            throw new Error('This sample supports external-buffer glTF only.');
        }
        const bufferUrl = new URL(buf.uri, baseUrl).href;
        const data = await fetch(bufferUrl).then(r => r.arrayBuffer());
        buffers.push(new Uint8Array(data));
    }

    return { gltf, buffers, baseUrl };
}

async function loadMaterialTexture(gltf, buffers, baseUrl, textureIndex) {
    const textureDef = gltf.textures[textureIndex];
    const imageDef = gltf.images[textureDef.source];
    const samplerDef = textureDef.sampler !== undefined ? gltf.samplers[textureDef.sampler] : null;

    if (imageDef.uri) {
        return loadTexture(new URL(imageDef.uri, baseUrl).href, { sampler: samplerDef, flipY: false });
    }

    if (imageDef.bufferView !== undefined) {
        const view = gltf.bufferViews[imageDef.bufferView];
        const bin = buffers[view.buffer || 0];
        const offset = view.byteOffset || 0;
        const length = view.byteLength;
        const bytes = new Uint8Array(bin.buffer, bin.byteOffset + offset, length);
        const blob = new Blob([bytes], { type: imageDef.mimeType || 'image/png' });
        const url = URL.createObjectURL(blob);
        const tex = await loadTexture(url, { sampler: samplerDef, flipY: false });
        URL.revokeObjectURL(url);
        return tex;
    }

    return null;
}

function createMeshBuffers(positions, normals, texCoords, indices) {
    const posBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

    const normalBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, normals, gl.STATIC_DRAW);

    const uvBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, texCoords, gl.STATIC_DRAW);

    let indexBuffer = null;
    let indexCount = positions.length / 3;
    let indexType = gl.UNSIGNED_SHORT;

    if (indices) {
        indexBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
        indexCount = indices.length;

        if (indices instanceof Uint32Array) {
            indexType = gl.UNSIGNED_INT;
        } else if (indices instanceof Uint16Array) {
            indexType = gl.UNSIGNED_SHORT;
        } else {
            indexType = gl.UNSIGNED_BYTE;
        }
    }

    return {
        posBuffer,
        normalBuffer,
        uvBuffer,
        indexBuffer,
        indexCount,
        indexType,
        hasIndices: !!indices
    };
}

function bindMesh(mesh) {
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.posBuffer);
    gl.enableVertexAttribArray(attribs.position);
    gl.vertexAttribPointer(attribs.position, 3, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.normalBuffer);
    gl.enableVertexAttribArray(attribs.normal);
    gl.vertexAttribPointer(attribs.normal, 3, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.uvBuffer);
    gl.enableVertexAttribArray(attribs.uv);
    gl.vertexAttribPointer(attribs.uv, 2, gl.FLOAT, false, 0, 0);

    if (mesh.hasIndices) {
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.indexBuffer);
    }
}

function createGroundMesh() {
    const positions = new Float32Array([
        -0.5, 0.0, -0.5,
         0.5, 0.0, -0.5,
         0.5, 0.0,  0.5,
        -0.5, 0.0, -0.5,
         0.5, 0.0,  0.5,
        -0.5, 0.0,  0.5
    ]);

    const normals = new Float32Array([
        0, 1, 0,
        0, 1, 0,
        0, 1, 0,
        0, 1, 0,
        0, 1, 0,
        0, 1, 0
    ]);

    const uv = new Float32Array([
        0, 0,
        1, 0,
        1, 1,
        0, 0,
        1, 1,
        0, 1
    ]);

    return createMeshBuffers(positions, normals, uv, null);
}

function createDebugWireframeBoxMesh() {
    const positions = new Float32Array([
        -0.5, -0.5, -0.5,
         0.5, -0.5, -0.5,
         0.5,  0.5, -0.5,
        -0.5,  0.5, -0.5,
        -0.5, -0.5,  0.5,
         0.5, -0.5,  0.5,
         0.5,  0.5,  0.5,
        -0.5,  0.5,  0.5
    ]);
    const indices = new Uint16Array([
        0, 1, 1, 2, 2, 3, 3, 0,
        4, 5, 5, 6, 6, 7, 7, 4,
        0, 4, 1, 5, 2, 6, 3, 7
    ]);

    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

    const indexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

    return {
        positionBuffer,
        indexBuffer,
        count: indices.length
    };
}

function getNodeLocalMatrix(node) {
    const m = mat4.create();
    if (node.matrix) {
        mat4.copy(m, node.matrix);
        return m;
    }
    const t = node.translation || [0, 0, 0];
    const r = node.rotation || [0, 0, 0, 1];
    const s = node.scale || [1, 1, 1];
    mat4.fromRotationTranslationScale(m, r, t, s);
    return m;
}

async function buildDuckModel(url) {
    const { gltf, buffers, baseUrl } = await loadGLTF(url);
    const sceneIndex = gltf.scene || 0;
    const scene = gltf.scenes[sceneIndex];

    const nodes = (gltf.nodes || []).map(node => ({
        mesh: node.mesh,
        children: node.children || [],
        localMatrix: getNodeLocalMatrix(node)
    }));

    const meshes = [];
    for (let m = 0; m < (gltf.meshes || []).length; m++) {
        const meshDef = gltf.meshes[m];
        const primitives = [];

        for (const primitive of meshDef.primitives) {
            const attrs = primitive.attributes;
            const positions = getAccessorData(gltf, buffers, attrs.POSITION);

            let indices = null;
            if (primitive.indices !== undefined) {
                indices = getAccessorData(gltf, buffers, primitive.indices);
                if (indices instanceof Uint32Array && !extUint) {
                    throw new Error('Model uses uint32 indices but OES_element_index_uint is unavailable.');
                }
            }

            let normals = attrs.NORMAL !== undefined
                ? getAccessorData(gltf, buffers, attrs.NORMAL)
                : computeFlatNormals(positions, indices);

            let texCoords = attrs.TEXCOORD_0 !== undefined
                ? getAccessorData(gltf, buffers, attrs.TEXCOORD_0)
                : new Float32Array((positions.length / 3) * 2);

            const bbox = calculateBoundingBox(positions);
            const gpu = createMeshBuffers(positions, normals, texCoords, indices);

            let texture = null;
            let baseColor = [1, 1, 1, 1];
            if (primitive.material !== undefined) {
                const matDef = gltf.materials[primitive.material];
                if (matDef && matDef.pbrMetallicRoughness) {
                    const pbr = matDef.pbrMetallicRoughness;
                    if (pbr.baseColorFactor) {
                        baseColor = pbr.baseColorFactor;
                    }
                    if (pbr.baseColorTexture) {
                        texture = await loadMaterialTexture(gltf, buffers, baseUrl, pbr.baseColorTexture.index);
                    }
                }
            }

            primitives.push({ ...gpu, bbox, texture, baseColor });
        }

        let meshBbox = primitives[0].bbox;
        for (let i = 1; i < primitives.length; i++) {
            meshBbox = mergeBoundingBox(meshBbox, primitives[i].bbox);
        }
        meshes.push({ primitives, bbox: meshBbox });
    }

    let modelBbox = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };

    function traverseBBox(nodeIndex, parentMat) {
        const node = nodes[nodeIndex];
        const worldMat = mat4.multiply(mat4.create(), parentMat, node.localMatrix);

        if (node.mesh !== undefined) {
            const meshBbox = meshes[node.mesh].bbox;
            const corners = [
                [meshBbox.min[0], meshBbox.min[1], meshBbox.min[2]],
                [meshBbox.max[0], meshBbox.min[1], meshBbox.min[2]],
                [meshBbox.min[0], meshBbox.max[1], meshBbox.min[2]],
                [meshBbox.max[0], meshBbox.max[1], meshBbox.min[2]],
                [meshBbox.min[0], meshBbox.min[1], meshBbox.max[2]],
                [meshBbox.max[0], meshBbox.min[1], meshBbox.max[2]],
                [meshBbox.min[0], meshBbox.max[1], meshBbox.max[2]],
                [meshBbox.max[0], meshBbox.max[1], meshBbox.max[2]]
            ];
            for (const c of corners) {
                const p = vec3.transformMat4(vec3.create(), c, worldMat);
                modelBbox.min[0] = Math.min(modelBbox.min[0], p[0]);
                modelBbox.min[1] = Math.min(modelBbox.min[1], p[1]);
                modelBbox.min[2] = Math.min(modelBbox.min[2], p[2]);
                modelBbox.max[0] = Math.max(modelBbox.max[0], p[0]);
                modelBbox.max[1] = Math.max(modelBbox.max[1], p[1]);
                modelBbox.max[2] = Math.max(modelBbox.max[2], p[2]);
            }
        }

        for (const child of node.children) {
            traverseBBox(child, worldMat);
        }
    }

    for (const root of scene.nodes) {
        traverseBBox(root, mat4.create());
    }

    return {
        nodes,
        meshes,
        roots: scene.nodes,
        bbox: modelBbox
    };
}

function drawPrimitive(prim, modelMatrix) {
    bindMesh(prim);

    gl.uniformMatrix4fv(uniforms.model, false, modelMatrix);
    gl.uniform4fv(uniforms.baseColor, prim.baseColor);

    if (prim.texture) {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, prim.texture);
        gl.uniform1i(uniforms.texture, 0);
        gl.uniform1i(uniforms.hasTexture, 1);
    } else {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, groundTexture);
        gl.uniform1i(uniforms.texture, 0);
        gl.uniform1i(uniforms.hasTexture, 0);
    }

    if (prim.hasIndices) {
        gl.drawElements(gl.TRIANGLES, prim.indexCount, prim.indexType, 0);
    } else {
        gl.drawArrays(gl.TRIANGLES, 0, prim.indexCount);
    }
}

function drawDuckModel() {
    function drawNode(nodeIndex, parentMat) {
        const node = duckModel.nodes[nodeIndex];
        const worldMat = mat4.multiply(mat4.create(), parentMat, node.localMatrix);

        if (node.mesh !== undefined) {
            const mesh = duckModel.meshes[node.mesh];
            for (const prim of mesh.primitives) {
                drawPrimitive(prim, worldMat);
            }
        }

        for (const child of node.children) {
            drawNode(child, worldMat);
        }
    }

    for (const rootNode of duckModel.roots) {
        drawNode(rootNode, duckWorldMatrix);
    }
}

function enumToNumber(value) {
    if (typeof value === 'number') {
        return value;
    }
    if (typeof value === 'bigint') {
        return Number(value);
    }
    if (typeof value === 'string') {
        const parsed = Number(value.trim());
        return Number.isNaN(parsed) ? NaN : parsed;
    }
    if (!value || typeof value !== 'object') {
        return NaN;
    }

    if (typeof value.value === 'number' || typeof value.value === 'bigint') {
        return Number(value.value);
    }
    if (typeof value.m_value === 'number' || typeof value.m_value === 'bigint') {
        return Number(value.m_value);
    }
    if (typeof value.value === 'function') {
        const v = value.value();
        const n = enumToNumber(v);
        if (!Number.isNaN(n)) {
            return n;
        }
    }
    if (typeof value.valueOf === 'function') {
        const v = value.valueOf();
        if (v !== value) {
            const n = enumToNumber(v);
            if (!Number.isNaN(n)) {
                return n;
            }
        }
    }

    return NaN;
}

function checkResult(result, label) {
    if (result === HK.Result.RESULT_OK) {
        return;
    }

    const resultCode = enumToNumber(result);
    const okCode = enumToNumber(HK.Result.RESULT_OK);

    if (!Number.isNaN(resultCode) && !Number.isNaN(okCode) && resultCode === okCode) {
        return;
    }

    if (typeof result === 'object' && typeof HK.Result.RESULT_OK === 'object') {
        try {
            if (JSON.stringify(result) === JSON.stringify(HK.Result.RESULT_OK)) {
                return;
            }
        } catch (_e) {
        }
    }

    throw new Error(label + ' failed with code: ' + String(result));
}

function createBody(shapeId, motionType, position, rotation, setMass) {
    const created = HK.HP_Body_Create();
    checkResult(created[0], 'HP_Body_Create');
    const bodyId = created[1];

    checkResult(HK.HP_Body_SetShape(bodyId, shapeId), 'HP_Body_SetShape');
    checkResult(HK.HP_Body_SetMotionType(bodyId, motionType), 'HP_Body_SetMotionType');

    if (setMass) {
        const massResult = HK.HP_Shape_BuildMassProperties(shapeId);
        checkResult(massResult[0], 'HP_Shape_BuildMassProperties');
        checkResult(HK.HP_Body_SetMassProperties(bodyId, massResult[1]), 'HP_Body_SetMassProperties');
    }

    checkResult(HK.HP_Body_SetPosition(bodyId, position), 'HP_Body_SetPosition');
    checkResult(HK.HP_Body_SetOrientation(bodyId, rotation), 'HP_Body_SetOrientation');
    checkResult(HK.HP_World_AddBody(worldId, bodyId, false), 'HP_World_AddBody');

    return bodyId;
}

function eulerDegreesToQuaternion(x, y, z) {
    const q = quat.create();
    quat.fromEuler(q, x, y, z);
    return [q[0], q[1], q[2], q[3]];
}

function initPhysics(collisionSize) {
    const world = HK.HP_World_Create();
    checkResult(world[0], 'HP_World_Create');
    worldId = world[1];

    checkResult(HK.HP_World_SetGravity(worldId, [0, -9.8, 0]), 'HP_World_SetGravity');
    checkResult(HK.HP_World_SetIdealStepTime(worldId, 1 / 60), 'HP_World_SetIdealStepTime');

    const groundShapeResult = HK.HP_Shape_CreateBox([0, 0, 0], IDENTITY_QUATERNION, [800, 8, 800]);
    checkResult(groundShapeResult[0], 'HP_Shape_CreateBox (ground)');
    const groundShapeId = groundShapeResult[1];

    const duckShapeResult = HK.HP_Shape_CreateBox([0, 0, 0], IDENTITY_QUATERNION, collisionSize);
    checkResult(duckShapeResult[0], 'HP_Shape_CreateBox (duck)');
    const duckShapeId = duckShapeResult[1];
    checkResult(HK.HP_Shape_SetDensity(duckShapeId, 1), 'HP_Shape_SetDensity');

    createBody(groundShapeId, HK.MotionType.STATIC, [0, -5, 0], IDENTITY_QUATERNION, false);

    duckBody = createBody(
        duckShapeId,
        HK.MotionType.DYNAMIC,
        [0, 20, 0],
        eulerDegreesToQuaternion(8, 0, 10),
        true
    );

    checkResult(HK.HP_Body_SetAngularVelocity(duckBody, [0, 0, 3.5]), 'HP_Body_SetAngularVelocity');
}

function updateDuckWorldMatrix() {
    const pResult = HK.HP_Body_GetPosition(duckBody);
    checkResult(pResult[0], 'HP_Body_GetPosition');
    const qResult = HK.HP_Body_GetOrientation(duckBody);
    checkResult(qResult[0], 'HP_Body_GetOrientation');

    const p = pResult[1];
    const q = qResult[1];

    const bodyRot = quat.fromValues(q[0], q[1], q[2], q[3]);
    const bodyPos = vec3.fromValues(p[0], p[1], p[2]);

    mat4.fromRotationTranslation(duckWorldMatrix, bodyRot, bodyPos);
    mat4.scale(duckWorldMatrix, duckWorldMatrix, [FALL_SCALE, FALL_SCALE, FALL_SCALE]);
    mat4.translate(duckWorldMatrix, duckWorldMatrix, duckOffset);
}

function drawGround() {
    const groundModel = mat4.create();
    // Keep visual floor aligned to the top face of the physics ground box.
    mat4.translate(groundModel, groundModel, [0, -1, 0]);
    mat4.scale(groundModel, groundModel, [400, 1, 400]);

    bindMesh(groundMesh);
    gl.uniformMatrix4fv(uniforms.model, false, groundModel);
    gl.uniform4fv(uniforms.baseColor, [0.65, 0.72, 0.65, 1.0]);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, groundTexture);
    gl.uniform1i(uniforms.texture, 0);
    gl.uniform1i(uniforms.hasTexture, 1);

    gl.disable(gl.CULL_FACE);
    if (groundMesh.hasIndices) {
        gl.drawElements(gl.TRIANGLES, groundMesh.indexCount, groundMesh.indexType, 0);
    } else {
        gl.drawArrays(gl.TRIANGLES, 0, groundMesh.indexCount);
    }
    gl.enable(gl.CULL_FACE);
}

function drawPhysicsDebugBox() {
    if (!SHOW_DEBUG_BBOX) {
        return;
    }

    const pResult = HK.HP_Body_GetPosition(duckBody);
    checkResult(pResult[0], 'HP_Body_GetPosition');
    const qResult = HK.HP_Body_GetOrientation(duckBody);
    checkResult(qResult[0], 'HP_Body_GetOrientation');
    const p = pResult[1];
    const q = qResult[1];
    const rot = quat.fromValues(q[0], q[1], q[2], q[3]);
    const model = mat4.create();
    mat4.fromRotationTranslation(model, rot, p);
    mat4.scale(model, model, duckDebugSize);

    gl.useProgram(lineProgram);
    gl.uniformMatrix4fv(lineUniforms.viewProj, false, viewProj);
    gl.uniformMatrix4fv(lineUniforms.model, false, model);
    gl.uniform4fv(lineUniforms.color, [0.0, 1.0, 0.0, 1.0]);

    gl.bindBuffer(gl.ARRAY_BUFFER, debugBoxMesh.positionBuffer);
    gl.enableVertexAttribArray(lineAttribs.position);
    gl.vertexAttribPointer(lineAttribs.position, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, debugBoxMesh.indexBuffer);

    gl.disable(gl.CULL_FACE);
    gl.drawElements(gl.LINES, debugBoxMesh.count, gl.UNSIGNED_SHORT, 0);
    gl.enable(gl.CULL_FACE);
}

function renderFrame(timeSec) {
    checkResult(HK.HP_World_Step(worldId, 1 / 60), 'HP_World_Step');
    updateDuckWorldMatrix();

    gl.clearColor(0.0, 0.0, 0.0, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const aspect = canvas.width / canvas.height;
    mat4.perspective(projection, Math.PI / 4, aspect, 0.1, 2000);

    const orbit = timeSec * 0.2;
    const eye = vec3.fromValues(
        Math.sin(orbit) * 80,
        20,
        Math.cos(orbit) * 80
    );
    mat4.lookAt(view, eye, cameraCenter, [0, 1, 0]);
    mat4.multiply(viewProj, projection, view);

    gl.useProgram(program);
    gl.uniformMatrix4fv(uniforms.viewProj, false, viewProj);
    gl.uniform3fv(uniforms.lightDir, [0.6, 1.0, 0.5]);

    drawGround();
    drawDuckModel();
    drawPhysicsDebugBox();

    requestAnimationFrame((ts) => renderFrame(ts * 0.001));
}

async function main() {
    canvas = document.getElementById('c');
    gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!gl) {
        throw new Error('WebGL 1.0 is not supported in this browser.');
    }

    extUint = gl.getExtension('OES_element_index_uint');

    const vsSource = document.getElementById('vs').textContent;
    const fsSource = document.getElementById('fs').textContent;
    const lineVsSource = document.getElementById('vs-line').textContent;
    const lineFsSource = document.getElementById('fs-line').textContent;

    program = createProgram(vsSource, fsSource);
    lineProgram = createProgram(lineVsSource, lineFsSource);

    attribs = {
        position: gl.getAttribLocation(program, 'aPosition'),
        normal: gl.getAttribLocation(program, 'aNormal'),
        uv: gl.getAttribLocation(program, 'aTexCoord')
    };

    uniforms = {
        viewProj: gl.getUniformLocation(program, 'uViewProj'),
        model: gl.getUniformLocation(program, 'uModel'),
        texture: gl.getUniformLocation(program, 'uTexture'),
        hasTexture: gl.getUniformLocation(program, 'uHasTexture'),
        baseColor: gl.getUniformLocation(program, 'uBaseColor'),
        lightDir: gl.getUniformLocation(program, 'uLightDir')
    };

    lineAttribs = {
        position: gl.getAttribLocation(lineProgram, 'aPosition')
    };

    lineUniforms = {
        viewProj: gl.getUniformLocation(lineProgram, 'uViewProj'),
        model: gl.getUniformLocation(lineProgram, 'uModel'),
        color: gl.getUniformLocation(lineProgram, 'uColor')
    };

    resize();
    window.addEventListener('resize', resize);

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);

    HK = await HavokPhysics();

    groundMesh = createGroundMesh();
    groundTexture = createSolidTexture(255, 255, 255, 255);
    debugBoxMesh = createDebugWireframeBoxMesh();

    duckModel = await buildDuckModel(DUCK_GLTF_URL);

    const bbox = duckModel.bbox;
    const sizeX = (bbox.max[0] - bbox.min[0]) * FALL_SCALE;
    const sizeY = (bbox.max[1] - bbox.min[1]) * FALL_SCALE;
    const sizeZ = (bbox.max[2] - bbox.min[2]) * FALL_SCALE;

    const safeSize = [
        Math.max(0.5, sizeX),
        Math.max(0.5, sizeY),
        Math.max(0.5, sizeZ)
    ];
    duckDebugSize = safeSize;

    const centerX = (bbox.min[0] + bbox.max[0]) * 0.5;
    const centerY = (bbox.min[1] + bbox.max[1]) * 0.5;
    const centerZ = (bbox.min[2] + bbox.max[2]) * 0.5;
    // Align visual mesh centroid to the physics box centroid for 1:1 debug fit.
    vec3.set(duckOffset, -centerX, -centerY, -centerZ);

    initPhysics(safeSize);

    requestAnimationFrame((ts) => renderFrame(ts * 0.001));

    document.addEventListener('click', () => {
        checkResult(HK.HP_Body_SetLinearVelocity(duckBody, [0, 5, 0]), 'HP_Body_SetLinearVelocity');
    });
}

main().catch((err) => {
    console.error(err);
});
