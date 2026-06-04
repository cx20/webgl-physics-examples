# WebGPU — Agent Guide

Renderer-specific guidance for `examples/webgpu/`. Read the root [`AGENTS.md`](../../AGENTS.md),
[`examples/AGENTS.md`](../AGENTS.md), and
[`docs/physics-implementation-notes.md`](../../docs/physics-implementation-notes.md) first.

## Folder Overview

Raw WebGPU samples (no engine/framework wrapper — direct `navigator.gpu`). Physics present:

```
examples/webgpu/{havok,oimo,wgsl_compute}/<scene>/
```

`wgsl_compute` here is the **reference implementation of the GPU compute physics** — the marbles /
football / shogi / eraser solvers. The `havok` / `oimo` variants are CPU-engine-driven and just
draw with WebGPU.

## Code Style & Idioms

- Manual everything: request adapter/device, configure the canvas context, build pipelines, write
  uniform/storage buffers, hand-rolled `mat4` perspective/lookAt.
- The camera is a fixed view matrix (e.g. eye `(0,0,40)` looking at the origin, `perspective(45,
  …)`). No orbit controls in the compute samples.
- Shaders are in `<script type="x-shader/...">` blocks in `index.html` (read via
  `getElementById(...).textContent`) **or** JS template literals.

## `wgsl_compute` rules (the important part)

These run the whole simulation in a compute shader. Follow
`docs/physics-implementation-notes.md` §3, in particular:

- **Inject `COUNT` from JS** (replace a `__COUNT__` token or use a template literal). A hardcoded
  shader `COUNT` that disagrees with the buffer length makes the inner loop read past the buffer →
  **phantom colliders at the origin**.
- **Ping-pong** two state buffers (`src` read, `dst` write, swap); run `SUBSTEPS` dispatches per
  frame at `dt = frameDt / SUBSTEPS`.
- **Broad phase**: brute-force O(N²) is fine for a few hundred bodies; use the uniform spatial grid
  (`cs-clear` → `cs-build` → step) for thousands. `CELL_SIZE ≥ largest body diameter`.
- **Narrow phase**: spheres (distance) or OBB face-normal SAT (stable contact normal).
- **Static floor**: make the **physics** collider thick (rendered plate can be thin) so fast bodies
  cannot tunnel; align top surfaces (`y ≈ -9.95`).
- **Rolling spheres**: drive spin from the contact, `ω_x = vz/r`, `ω_z = -vx/r` — check the sign or
  the ball looks like it is skidding.
- **Settling boxes**: sleep from the bottom up; stop torquing a body once it is slow on a stable
  support, so buried bodies stay put.

## Debugging GPU physics

You cannot log from a shader. Add `COPY_SRC` to the state buffers + a mappable readback buffer,
`copyBufferToBuffer` after submit, `mapAsync(READ)` every N frames, and aggregate to an overlay
(airborne/settled/asleep counts, tilt distribution, max speed). **Remove the readback and
`COPY_SRC` before committing.** See physics notes §4.

## Build / Run

No build step — open `index.html` in a WebGPU browser (Chrome/Edge with WebGPU). `node --check
index.js`.

## Troubleshooting

- *Bodies near the origin get shoved for no reason* → shader `COUNT` ≠ buffer length (phantoms).
- *Bodies tunnel through the floor* → thin physics floor; thicken it.
- *Sphere looks like it slides* → wrong rolling-spin sign.
- *Pile never rests / bottom squirms* → keep torquing settled bodies; gate it on "still moving".
