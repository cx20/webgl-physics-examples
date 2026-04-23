const { mat4, vec3, quat } = glMatrix;

const MODEL_URL = 'https://raw.githubusercontent.com/eoineoineoin/glTF_Physics/master/samples/MotionProperties/MotionProperties.glb';
const IDENTITY_QUATERNION = [0, 0, 0, 1];
const SHOW_DEBUG_COLLIDERS = false;
const RESET_Y_THRESHOLD = -20;

const PHYSICS_SUBSTEPS = 4;
const PHYSICS_DT = 1 / (60 * PHYSICS_SUBSTEPS);

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

let viewProj = mat4.create();
let projection = mat4.create();
let view = mat4.create();
let cameraCenter = vec3.create();
let cameraRadius = 18;
let cameraHeight = 7;

let whiteTexture;
let debugBoxMesh;

let modelAsset = null;
const physicsNodes = [];
const dynamicNodes = [];

function isPowerOf2(value) {
    return (value & (value - 1)) === 0;
}

function createShader(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source.trimStart());
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

async function loadGLTFAsset(url) {
    const response = await fetch(url);
    const baseUrl = url.substring(0, url.lastIndexOf('/') + 1);
    const contentType = response.headers.get('content-type') || '';

    if (url.toLowerCase().endsWith('.glb') || contentType.includes('model/gltf-binary') || contentType.includes('application/octet-stream')) {
        const data = await response.arrayBuffer();
        const header = new Uint32Array(data, 0, 3);
        if (header[0] !== 0x46546C67) {
            throw new Error('Invalid GLB header.');
        }

        let offset = 12;
        let gltf = null;
        let binChunk = null;
        const decoder = new TextDecoder();

        while (offset < data.byteLength) {
            const chunkLength = new DataView(data, offset, 4).getUint32(0, true);
            const chunkType = new DataView(data, offset + 4, 4).getUint32(0, true);
            const chunkData = data.slice(offset + 8, offset + 8 + chunkLength);
            if (chunkType === 0x4E4F534A) {
                gltf = JSON.parse(decoder.decode(chunkData).replace(/\0+$/, ''));
            } else if (chunkType === 0x004E4942) {
                binChunk = chunkData;
            }
            offset += 8 + chunkLength;
        }

        if (!gltf) {
            throw new Error('GLB JSON chunk is missing.');
        }

        const buffers = [];
        for (const buf of gltf.buffers || []) {
            if (buf.uri) {
                const bufferUrl = new URL(buf.uri, baseUrl).href;
                const externalData = await fetch(bufferUrl).then((r) => r.arrayBuffer());
                buffers.push(new Uint8Array(externalData));
            } else {
                if (!binChunk) {
                    throw new Error('GLB BIN chunk is missing.');
                }
                buffers.push(new Uint8Array(binChunk, 0, buf.byteLength || binChunk.byteLength));
            }
        }

        return { gltf, buffers, baseUrl };
    }

    const gltf = await response.json();
    const buffers = [];
    for (const buf of gltf.buffers || []) {
        if (!buf.uri) {
            throw new Error('This sample supports external-buffer glTF or embedded GLB only.');
        }
        const bufferUrl = new URL(buf.uri, baseUrl).href;
        const data = await fetch(bufferUrl).then((r) => r.arrayBuffer());
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
        const blobUrl = URL.createObjectURL(blob);
        const texture = await loadTexture(blobUrl, { sampler: samplerDef, flipY: false });
        URL.revokeObjectURL(blobUrl);
        return texture;
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
    const matrix = mat4.create();
    if (node.matrix) {
        mat4.copy(matrix, node.matrix);
        return matrix;
    }

    const translation = node.translation || [0, 0, 0];
    const rotation = node.rotation || [0, 0, 0, 1];
    const scale = node.scale || [1, 1, 1];
    mat4.fromRotationTranslationScale(matrix, rotation, translation, scale);
    return matrix;
}

async function buildModel(url) {
    const { gltf, buffers, baseUrl } = await loadGLTFAsset(url);
    const sceneIndex = gltf.scene || 0;
    const scene = gltf.scenes[sceneIndex];

    const nodes = (gltf.nodes || []).map((node) => ({
        name: node.name || '',
        mesh: node.mesh,
        children: node.children || [],
        localMatrix: getNodeLocalMatrix(node),
        restWorldMatrix: mat4.create(),
        worldMatrix: mat4.create(),
        worldScale: vec3.fromValues(1, 1, 1),
        bodyId: null,
        debugSize: null,
        initialPosition: null,
        initialRotation: null,
        physicsExt: node.extensions ? node.extensions.KHR_physics_rigid_bodies : null
    }));

    const meshes = [];
    for (let meshIndex = 0; meshIndex < (gltf.meshes || []).length; meshIndex++) {
        const meshDef = gltf.meshes[meshIndex];
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

            const normals = attrs.NORMAL !== undefined
                ? getAccessorData(gltf, buffers, attrs.NORMAL)
                : computeFlatNormals(positions, indices);

            const texCoords = attrs.TEXCOORD_0 !== undefined
                ? getAccessorData(gltf, buffers, attrs.TEXCOORD_0)
                : new Float32Array((positions.length / 3) * 2);

            const bbox = calculateBoundingBox(positions);
            const gpu = createMeshBuffers(positions, normals, texCoords, indices);

            let texture = null;
            let baseColor = [1, 1, 1, 1];
            let doubleSided = false;

            if (primitive.material !== undefined) {
                const matDef = gltf.materials[primitive.material];
                if (matDef) {
                    doubleSided = !!matDef.doubleSided;
                    if (matDef.pbrMetallicRoughness) {
                        const pbr = matDef.pbrMetallicRoughness;
                        if (pbr.baseColorFactor) {
                            baseColor = pbr.baseColorFactor;
                        }
                        if (pbr.baseColorTexture) {
                            texture = await loadMaterialTexture(gltf, buffers, baseUrl, pbr.baseColorTexture.index);
                        }
                    }
                }
            }

            primitives.push({ ...gpu, bbox, texture, baseColor, doubleSided });
        }

        let meshBbox = primitives[0].bbox;
        for (let i = 1; i < primitives.length; i++) {
            meshBbox = mergeBoundingBox(meshBbox, primitives[i].bbox);
        }
        meshes.push({ primitives, bbox: meshBbox });
    }

    function computeRestWorld(nodeIndex, parentMatrix) {
        const node = nodes[nodeIndex];
        mat4.multiply(node.restWorldMatrix, parentMatrix, node.localMatrix);
        mat4.copy(node.worldMatrix, node.restWorldMatrix);
        mat4.getScaling(node.worldScale, node.restWorldMatrix);

        for (const child of node.children) {
            computeRestWorld(child, node.restWorldMatrix);
        }
    }

    for (const root of scene.nodes) {
        computeRestWorld(root, mat4.create());
    }

    let modelBbox = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };

    function traverseBBox(nodeIndex) {
        const node = nodes[nodeIndex];
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
            for (const corner of corners) {
                const p = vec3.transformMat4(vec3.create(), corner, node.restWorldMatrix);
                modelBbox.min[0] = Math.min(modelBbox.min[0], p[0]);
                modelBbox.min[1] = Math.min(modelBbox.min[1], p[1]);
                modelBbox.min[2] = Math.min(modelBbox.min[2], p[2]);
                modelBbox.max[0] = Math.max(modelBbox.max[0], p[0]);
                modelBbox.max[1] = Math.max(modelBbox.max[1], p[1]);
                modelBbox.max[2] = Math.max(modelBbox.max[2], p[2]);
            }
        }

        for (const child of node.children) {
            traverseBBox(child);
        }
    }

    for (const root of scene.nodes) {
        traverseBBox(root);
    }

    return {
        gltf,
        buffers,
        baseUrl,
        nodes,
        meshes,
        roots: scene.nodes,
        bbox: modelBbox
    };
}

function drawPrimitive(primitive, modelMatrix) {
    bindMesh(primitive);

    gl.uniformMatrix4fv(uniforms.model, false, modelMatrix);
    gl.uniform4fv(uniforms.baseColor, primitive.baseColor);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, primitive.texture || whiteTexture);
    gl.uniform1i(uniforms.texture, 0);
    gl.uniform1i(uniforms.hasTexture, primitive.texture ? 1 : 0);

    if (primitive.doubleSided) {
        gl.disable(gl.CULL_FACE);
    } else {
        gl.enable(gl.CULL_FACE);
    }

    if (primitive.hasIndices) {
        gl.drawElements(gl.TRIANGLES, primitive.indexCount, primitive.indexType, 0);
    } else {
        gl.drawArrays(gl.TRIANGLES, 0, primitive.indexCount);
    }
}

function drawModel() {
    function drawNode(nodeIndex, parentMatrix) {
        const node = modelAsset.nodes[nodeIndex];
        const worldMatrix = node.bodyId
            ? node.worldMatrix
            : mat4.multiply(mat4.create(), parentMatrix, node.localMatrix);

        if (node.mesh !== undefined) {
            const mesh = modelAsset.meshes[node.mesh];
            for (const primitive of mesh.primitives) {
                drawPrimitive(primitive, worldMatrix);
            }
        }

        for (const child of node.children) {
            drawNode(child, worldMatrix);
        }
    }

    for (const root of modelAsset.roots) {
        drawNode(root, mat4.create());
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
        const nested = enumToNumber(value.value());
        if (!Number.isNaN(nested)) {
            return nested;
        }
    }
    if (typeof value.valueOf === 'function') {
        const nestedValue = value.valueOf();
        if (nestedValue !== value) {
            const nested = enumToNumber(nestedValue);
            if (!Number.isNaN(nested)) {
                return nested;
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

function setMassPropertyVec3(target, keys, value) {
    for (const key of keys) {
        if (Array.isArray(target[key]) && target[key].length >= 3) {
            target[key][0] = value[0];
            target[key][1] = value[1];
            target[key][2] = value[2];
            return true;
        }
    }
    return false;
}

function setMassPropertyQuat(target, keys, value) {
    for (const key of keys) {
        if (Array.isArray(target[key]) && target[key].length >= 4) {
            target[key][0] = value[0];
            target[key][1] = value[1];
            target[key][2] = value[2];
            target[key][3] = value[3];
            return true;
        }
    }
    return false;
}

function applyMotionMassProperties(bodyId, motionDef) {
    if (!motionDef || typeof HK.HP_Body_GetMassProperties !== 'function' || typeof HK.HP_Body_SetMassProperties !== 'function') {
        return;
    }

    const massPropResult = HK.HP_Body_GetMassProperties(bodyId);
    checkResult(massPropResult[0], 'HP_Body_GetMassProperties');
    const massProperties = massPropResult[1];

    let changed = false;

    if (Array.isArray(massProperties)) {
        let vec3SlotCount = 0;
        for (let i = 0; i < massProperties.length; i++) {
            const slot = massProperties[i];
            if (motionDef.mass !== undefined && typeof slot === 'number') {
                massProperties[i] = motionDef.mass;
                changed = true;
                continue;
            }
            if (!Array.isArray(slot)) {
                continue;
            }

            if (slot.length === 4 && motionDef.inertiaOrientation) {
                slot[0] = motionDef.inertiaOrientation[0];
                slot[1] = motionDef.inertiaOrientation[1];
                slot[2] = motionDef.inertiaOrientation[2];
                slot[3] = motionDef.inertiaOrientation[3];
                changed = true;
                continue;
            }

            if (slot.length === 3) {
                const vecSource = vec3SlotCount === 0 ? motionDef.inertiaDiagonal : motionDef.centerOfMass;
                if (vecSource) {
                    slot[0] = vecSource[0];
                    slot[1] = vecSource[1];
                    slot[2] = vecSource[2];
                    changed = true;
                }
                vec3SlotCount++;
            }
        }
    } else if (massProperties && typeof massProperties === 'object') {
        if (motionDef.mass !== undefined) {
            if (typeof massProperties.mass === 'number') {
                massProperties.mass = motionDef.mass;
                changed = true;
            } else if (typeof massProperties.m_mass === 'number') {
                massProperties.m_mass = motionDef.mass;
                changed = true;
            }
        }
        if (motionDef.inertiaDiagonal) {
            changed = setMassPropertyVec3(massProperties, ['inertiaDiagonal', 'm_inertiaDiagonal', 'inertia', 'm_inertia'], motionDef.inertiaDiagonal) || changed;
        }
        if (motionDef.inertiaOrientation) {
            changed = setMassPropertyQuat(massProperties, ['inertiaOrientation', 'm_inertiaOrientation'], motionDef.inertiaOrientation) || changed;
        }
        if (motionDef.centerOfMass) {
            changed = setMassPropertyVec3(massProperties, ['centerOfMass', 'm_centerOfMass', 'center', 'm_center'], motionDef.centerOfMass) || changed;
        }
    }

    if (changed) {
        checkResult(HK.HP_Body_SetMassProperties(bodyId, massProperties), 'HP_Body_SetMassProperties');
    }
}

function createBody(shapeId, motionType, position, rotation, setMass, motionDef, gravityFactor) {
    const created = HK.HP_Body_Create();
    checkResult(created[0], 'HP_Body_Create');
    const bodyId = created[1];

    checkResult(HK.HP_Body_SetShape(bodyId, shapeId), 'HP_Body_SetShape');
    checkResult(HK.HP_Body_SetMotionType(bodyId, motionType), 'HP_Body_SetMotionType');

    // Set body quality so Havok enables CCD for fast-moving dynamic bodies.
    if (typeof HK.HP_Body_SetQuality === 'function' && HK.QualityType) {
        const isDynamic = motionType !== HK.MotionType.STATIC;
        const quality = isDynamic ? HK.QualityType.MOVING : HK.QualityType.FIXED;
        if (quality !== undefined) {
            HK.HP_Body_SetQuality(bodyId, quality);
        }
    }

    if (setMass) {
        const massResult = HK.HP_Shape_BuildMassProperties(shapeId);
        checkResult(massResult[0], 'HP_Shape_BuildMassProperties');
        checkResult(HK.HP_Body_SetMassProperties(bodyId, massResult[1]), 'HP_Body_SetMassProperties');
        applyMotionMassProperties(bodyId, motionDef);
    }

    if (gravityFactor !== undefined && typeof HK.HP_Body_SetGravityFactor === 'function') {
        checkResult(HK.HP_Body_SetGravityFactor(bodyId, gravityFactor), 'HP_Body_SetGravityFactor');
    }

    if (motionDef && motionDef.linearVelocity && typeof HK.HP_Body_SetLinearVelocity === 'function') {
        checkResult(HK.HP_Body_SetLinearVelocity(bodyId, motionDef.linearVelocity), 'HP_Body_SetLinearVelocity');
    }
    if (motionDef && motionDef.angularVelocity && typeof HK.HP_Body_SetAngularVelocity === 'function') {
        checkResult(HK.HP_Body_SetAngularVelocity(bodyId, motionDef.angularVelocity), 'HP_Body_SetAngularVelocity');
    }

    checkResult(HK.HP_Body_SetPosition(bodyId, position), 'HP_Body_SetPosition');
    checkResult(HK.HP_Body_SetOrientation(bodyId, rotation), 'HP_Body_SetOrientation');
    checkResult(HK.HP_World_AddBody(worldId, bodyId, false), 'HP_World_AddBody');
    return bodyId;
}

function applyPhysicsMaterial(shapeId, materialDef) {
    if (!materialDef || typeof HK.HP_Shape_SetMaterial !== 'function') {
        return;
    }

    const dynamicFriction = materialDef.dynamicFriction !== undefined ? materialDef.dynamicFriction : 0.5;
    const staticFriction = materialDef.staticFriction !== undefined ? materialDef.staticFriction : 0.5;
    const restitution = materialDef.restitution !== undefined ? materialDef.restitution : 0.0;
    HK.HP_Shape_SetMaterial(
        shapeId,
        [dynamicFriction, staticFriction, restitution, HK.MaterialCombine.MAXIMUM, HK.MaterialCombine.MAXIMUM]
    );
}

function createMeshPhysicsShape(node, colliderGeom, motionDef, materialDef) {
    const meshIndex = colliderGeom.mesh;
    const isConvex = !!colliderGeom.convexHull;
    const meshDef = modelAsset.gltf.meshes[meshIndex];

    const allPositions = [];
    const allIndices = [];
    let vertexOffset = 0;

    for (const primitive of meshDef.primitives) {
        const positions = getAccessorData(modelAsset.gltf, modelAsset.buffers, primitive.attributes.POSITION);
        for (let i = 0; i < positions.length; i += 3) {
            allPositions.push(
                positions[i]     * node.worldScale[0],
                positions[i + 1] * node.worldScale[1],
                positions[i + 2] * node.worldScale[2]
            );
        }
        if (!isConvex && primitive.indices !== undefined) {
            const indices = getAccessorData(modelAsset.gltf, modelAsset.buffers, primitive.indices);
            for (let i = 0; i < indices.length; i++) {
                allIndices.push(indices[i] + vertexOffset);
            }
        }
        vertexOffset += positions.length / 3;
    }

    const posFloat32 = new Float32Array(allPositions);
    let shapeId;

    if (isConvex) {
        const created = HK.HP_Shape_CreateConvexHull(posFloat32);
        checkResult(created[0], 'HP_Shape_CreateConvexHull');
        shapeId = created[1];
    } else {
        const indicesUint32 = new Uint32Array(allIndices);
        const created = HK.HP_Shape_CreateMesh(posFloat32, indicesUint32);
        checkResult(created[0], 'HP_Shape_CreateMesh');
        shapeId = created[1];
    }

    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < allPositions.length; i += 3) {
        minX = Math.min(minX, allPositions[i]);     maxX = Math.max(maxX, allPositions[i]);
        minY = Math.min(minY, allPositions[i + 1]); maxY = Math.max(maxY, allPositions[i + 1]);
        minZ = Math.min(minZ, allPositions[i + 2]); maxZ = Math.max(maxZ, allPositions[i + 2]);
    }
    const size = [maxX - minX, maxY - minY, maxZ - minZ];
    const volume = Math.max((maxX - minX) * (maxY - minY) * (maxZ - minZ), 0.0001);

    if (motionDef) {
        const density = motionDef.mass !== undefined ? motionDef.mass / volume : 1;
        checkResult(HK.HP_Shape_SetDensity(shapeId, density), 'HP_Shape_SetDensity');
    }
    applyPhysicsMaterial(shapeId, materialDef);

    return { shapeId, size };
}

function createPhysicsShape(node, shapeDef, motionDef, materialDef) {
    if (!shapeDef) {
        throw new Error('Invalid KHR_implicit_shapes definition.');
    }

    let shapeId;
    let size;
    let volume = 0.0001;

    if (shapeDef.type === 'box' && shapeDef.box) {
        size = [
            Math.abs(shapeDef.box.size[0] * node.worldScale[0]),
            Math.abs(shapeDef.box.size[1] * node.worldScale[1]),
            Math.abs(shapeDef.box.size[2] * node.worldScale[2])
        ];

        const created = HK.HP_Shape_CreateBox([0, 0, 0], IDENTITY_QUATERNION, size);
        checkResult(created[0], 'HP_Shape_CreateBox');
        shapeId = created[1];
        volume = Math.max(size[0] * size[1] * size[2], 0.0001);
    } else if (shapeDef.type === 'sphere' && shapeDef.sphere) {
        const baseRadius = shapeDef.sphere.radius !== undefined ? shapeDef.sphere.radius : 0.5;
        const maxScale = Math.max(
            Math.abs(node.worldScale[0]),
            Math.abs(node.worldScale[1]),
            Math.abs(node.worldScale[2])
        );
        const radius = Math.max(Math.abs(baseRadius * maxScale), 0.0001);
        const created = HK.HP_Shape_CreateSphere([0, 0, 0], radius);
        checkResult(created[0], 'HP_Shape_CreateSphere');
        shapeId = created[1];
        size = [radius * 2, radius * 2, radius * 2];
        volume = Math.max((4.0 / 3.0) * Math.PI * radius * radius * radius, 0.0001);
    } else if (shapeDef.type === 'capsule' && shapeDef.capsule) {
        const capsuleDef = shapeDef.capsule;
        const radiusTop = capsuleDef.radiusTop !== undefined ? capsuleDef.radiusTop : 0.5;
        const radiusBottom = capsuleDef.radiusBottom !== undefined ? capsuleDef.radiusBottom : 0.5;
        const height = capsuleDef.height !== undefined ? capsuleDef.height : 1.0;
        const avgRadius = (radiusTop + radiusBottom) * 0.5;
        const scaleXZ = Math.max(Math.abs(node.worldScale[0]), Math.abs(node.worldScale[2]));
        const scaledRadius = Math.max(avgRadius * scaleXZ, 0.0001);
        const scaledHalfShaft = Math.max(height * Math.abs(node.worldScale[1]) * 0.5, 0);
        const created = HK.HP_Shape_CreateCapsule([0, -scaledHalfShaft, 0], [0, scaledHalfShaft, 0], scaledRadius);
        checkResult(created[0], 'HP_Shape_CreateCapsule');
        shapeId = created[1];
        size = [scaledRadius * 2, scaledHalfShaft * 2 + scaledRadius * 2, scaledRadius * 2];
        volume = Math.max(Math.PI * scaledRadius * scaledRadius * (scaledHalfShaft * 2) + (4.0 / 3.0) * Math.PI * scaledRadius * scaledRadius * scaledRadius, 0.0001);
    } else if (shapeDef.type === 'cylinder' && shapeDef.cylinder) {
        const cylDef = shapeDef.cylinder;
        const cRadiusTop = cylDef.radiusTop !== undefined ? cylDef.radiusTop : 0.5;
        const cRadiusBottom = cylDef.radiusBottom !== undefined ? cylDef.radiusBottom : 0.5;
        const cHeight = cylDef.height !== undefined ? cylDef.height : 1.0;
        const avgCylRadius = Math.max((cRadiusTop + cRadiusBottom) * 0.5, 0.0001);
        const scaleXZ = Math.max(Math.abs(node.worldScale[0]), Math.abs(node.worldScale[2]));
        const scaledCylRadius = Math.max(avgCylRadius * scaleXZ, 0.0001);
        const scaledCylHalfHeight = Math.max(cHeight * Math.abs(node.worldScale[1]) * 0.5, 0.0001);
        if (typeof HK.HP_Shape_CreateCylinder === 'function') {
            const created = HK.HP_Shape_CreateCylinder([0, -scaledCylHalfHeight, 0], [0, scaledCylHalfHeight, 0], scaledCylRadius);
            checkResult(created[0], 'HP_Shape_CreateCylinder');
            shapeId = created[1];
        } else {
            const s = [scaledCylRadius * 2, scaledCylHalfHeight * 2, scaledCylRadius * 2];
            const created = HK.HP_Shape_CreateBox([0, 0, 0], IDENTITY_QUATERNION, s);
            checkResult(created[0], 'HP_Shape_CreateBox');
            shapeId = created[1];
        }
        size = [scaledCylRadius * 2, scaledCylHalfHeight * 2, scaledCylRadius * 2];
        volume = Math.max(Math.PI * scaledCylRadius * scaledCylRadius * scaledCylHalfHeight * 2, 0.0001);
    } else {
        throw new Error('Unsupported KHR_implicit_shapes collider type: ' + String(shapeDef.type));
    }

    if (motionDef) {
        const density = motionDef.mass !== undefined ? motionDef.mass / volume : 1;
        checkResult(HK.HP_Shape_SetDensity(shapeId, density), 'HP_Shape_SetDensity');
    }

    applyPhysicsMaterial(shapeId, materialDef);

    return { shapeId, size };
}

function initPhysics() {
    const world = HK.HP_World_Create();
    checkResult(world[0], 'HP_World_Create');
    worldId = world[1];

    checkResult(HK.HP_World_SetGravity(worldId, [0, -9.8, 0]), 'HP_World_SetGravity');
    checkResult(HK.HP_World_SetIdealStepTime(worldId, PHYSICS_DT), 'HP_World_SetIdealStepTime');

    const shapeDefs = (modelAsset.gltf.extensions && modelAsset.gltf.extensions.KHR_implicit_shapes && modelAsset.gltf.extensions.KHR_implicit_shapes.shapes) || [];
    const scenePhysics = (modelAsset.gltf.extensions && modelAsset.gltf.extensions.KHR_physics_rigid_bodies) || {};
    const materialDefs = scenePhysics.physicsMaterials || [];

    for (const node of modelAsset.nodes) {
        if (!node.physicsExt || !node.physicsExt.collider || !node.physicsExt.collider.geometry) {
            continue;
        }

        const shapeIndex = node.physicsExt.collider.geometry.shape;
        const motionDef = node.physicsExt.motion || null;
        const materialDef = node.physicsExt.collider.physicsMaterial !== undefined
            ? materialDefs[node.physicsExt.collider.physicsMaterial]
            : null;

        let shapeResult;
        if (shapeIndex === undefined) {
            shapeResult = createMeshPhysicsShape(node, node.physicsExt.collider.geometry, motionDef, materialDef);
        } else {
            const shapeDef = shapeDefs[shapeIndex];
            shapeResult = createPhysicsShape(node, shapeDef, motionDef, materialDef);
        }
        const { shapeId, size } = shapeResult;
        const position = vec3.create();
        const rotation = quat.create();
        mat4.getTranslation(position, node.restWorldMatrix);
        mat4.getRotation(rotation, node.restWorldMatrix);

        node.initialPosition = [position[0], position[1], position[2]];
        node.initialRotation = [rotation[0], rotation[1], rotation[2], rotation[3]];
        node.debugSize = size;

        const motionType = !motionDef
            ? HK.MotionType.STATIC
            : (motionDef.isKinematic ? HK.MotionType.ANIMATED : HK.MotionType.DYNAMIC);
        const gravityFactor = motionDef && motionDef.gravityFactor !== undefined ? motionDef.gravityFactor : undefined;
        node.bodyId = createBody(shapeId, motionType, node.initialPosition, node.initialRotation, !!motionDef, motionDef, gravityFactor);
        physicsNodes.push(node);

        if (motionDef) {
            dynamicNodes.push(node);
        }
    }
}

function updatePhysicsTransforms() {
    for (const node of physicsNodes) {
        const pResult = HK.HP_Body_GetPosition(node.bodyId);
        checkResult(pResult[0], 'HP_Body_GetPosition');
        const qResult = HK.HP_Body_GetOrientation(node.bodyId);
        checkResult(qResult[0], 'HP_Body_GetOrientation');

        const position = pResult[1];
        const rotation = qResult[1];
        mat4.fromRotationTranslationScale(
            node.worldMatrix,
            quat.fromValues(rotation[0], rotation[1], rotation[2], rotation[3]),
            vec3.fromValues(position[0], position[1], position[2]),
            node.worldScale
        );
    }
}

function resetDynamicBodiesIfNeeded() {
    for (const node of dynamicNodes) {
        const pResult = HK.HP_Body_GetPosition(node.bodyId);
        checkResult(pResult[0], 'HP_Body_GetPosition reset');
        if (pResult[1][1] >= RESET_Y_THRESHOLD) {
            continue;
        }

        checkResult(HK.HP_Body_SetPosition(node.bodyId, node.initialPosition), 'HP_Body_SetPosition reset');
        checkResult(HK.HP_Body_SetOrientation(node.bodyId, node.initialRotation), 'HP_Body_SetOrientation reset');
        checkResult(HK.HP_Body_SetLinearVelocity(node.bodyId, [0, 0, 0]), 'HP_Body_SetLinearVelocity reset');
        checkResult(HK.HP_Body_SetAngularVelocity(node.bodyId, [0, 0, 0]), 'HP_Body_SetAngularVelocity reset');
    }
}

function drawPhysicsDebug() {
    if (!SHOW_DEBUG_COLLIDERS) {
        return;
    }

    gl.useProgram(lineProgram);
    gl.uniformMatrix4fv(lineUniforms.viewProj, false, viewProj);

    gl.bindBuffer(gl.ARRAY_BUFFER, debugBoxMesh.positionBuffer);
    gl.enableVertexAttribArray(lineAttribs.position);
    gl.vertexAttribPointer(lineAttribs.position, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, debugBoxMesh.indexBuffer);

    gl.disable(gl.CULL_FACE);
    for (const node of physicsNodes) {
        const model = mat4.clone(node.worldMatrix);
        mat4.scale(model, model, node.debugSize);
        gl.uniformMatrix4fv(lineUniforms.model, false, model);
        gl.uniform4fv(lineUniforms.color, node.physicsExt.motion ? [1.0, 0.35, 0.2, 1.0] : [0.2, 0.9, 0.35, 1.0]);
        gl.drawElements(gl.LINES, debugBoxMesh.count, gl.UNSIGNED_SHORT, 0);
    }
    gl.enable(gl.CULL_FACE);
}

function renderFrame(timeSec) {
    for (let i = 0; i < PHYSICS_SUBSTEPS; i++) {
        checkResult(HK.HP_World_Step(worldId, PHYSICS_DT), 'HP_World_Step');
    }
    resetDynamicBodiesIfNeeded();
    updatePhysicsTransforms();

    gl.clearColor(0.97, 0.97, 0.98, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const aspect = canvas.width / canvas.height;
    mat4.perspective(projection, Math.PI / 4, aspect, 0.1, 2000);

    const orbit = 0;
    const eye = vec3.fromValues(
        cameraCenter[0] + Math.sin(orbit) * cameraRadius,
        cameraCenter[1] + cameraHeight,
        cameraCenter[2] + Math.cos(orbit) * cameraRadius
    );
    mat4.lookAt(view, eye, cameraCenter, [0, 1, 0]);
    mat4.multiply(viewProj, projection, view);

    gl.useProgram(program);
    gl.uniformMatrix4fv(uniforms.viewProj, false, viewProj);
    gl.uniform3fv(uniforms.lightDir, [0.45, 1.0, 0.35]);

    drawModel();
    drawPhysicsDebug();

    requestAnimationFrame((ts) => renderFrame(ts * 0.001));
}

async function main() {
    canvas = document.getElementById('c');
    gl = canvas.getContext('webgl2');
    if (!gl) {
        throw new Error('WebGL 2.0 is not supported in this browser.');
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
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    HK = await HavokPhysics();

    whiteTexture = createSolidTexture(255, 255, 255, 255);
    debugBoxMesh = createDebugWireframeBoxMesh();

    modelAsset = await buildModel(MODEL_URL);

    const bbox = modelAsset.bbox;
    const centerX = (bbox.min[0] + bbox.max[0]) * 0.5;
    const centerY = (bbox.min[1] + bbox.max[1]) * 0.5;
    const centerZ = (bbox.min[2] + bbox.max[2]) * 0.5;
    const sizeX = bbox.max[0] - bbox.min[0];
    const sizeY = bbox.max[1] - bbox.min[1];
    const sizeZ = bbox.max[2] - bbox.min[2];
    const diagonal = Math.sqrt(sizeX * sizeX + sizeY * sizeY + sizeZ * sizeZ);

    vec3.set(cameraCenter, centerX, centerY + Math.max(sizeY * 0.15, 0.5), centerZ);
    cameraRadius = Math.max(diagonal * 0.72, 5.8);
    cameraHeight = Math.max(sizeY * 0.5, 3.2);

    initPhysics();
    updatePhysicsTransforms();

    requestAnimationFrame((ts) => renderFrame(ts * 0.001));
}

main().catch((err) => {
    console.error(err);
});
