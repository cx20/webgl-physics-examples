# Babylon.js — Agent Guide

Renderer-specific guidance for `examples/babylonjs/`. Read the root [`AGENTS.md`](../../AGENTS.md),
[`examples/AGENTS.md`](../AGENTS.md), and
[`docs/physics-implementation-notes.md`](../../docs/physics-implementation-notes.md) first.

## Folder Overview

Babylon.js samples (`BABYLON.*`, loaded from a CDN). Physics engines present here:

```
examples/babylonjs/{ammo,cannon,havok,oimo,wgsl_compute}/<scene>/
```

`havok` is the reference engine; `wgsl_compute` runs the physics on Babylon's own WebGPU device.

## Code Style & Idioms

- A `createScene(engine)` builds a `BABYLON.Scene`; `engine.runRenderLoop(() => scene.render())`.
- Camera is usually `ArcRotateCamera`; set the view with `camera.setPosition(...)` +
  `camera.setTarget(...)` and `camera.fov` (radians). For comparison scenes use the fixed
  head-on view (eye `(0,0,40)`, target origin, `fov = 45°`) and **no auto-rotation**.
- Lights + `ShadowGenerator`, `StandardMaterial`/`PBRMaterial`, `MeshBuilder.CreateBox` etc.

## Engine notes

### Havok (`scene.enablePhysics(gravity, new BABYLON.HavokPlugin())`)

- **`PhysicsAggregate` collider size**: pass `{ extents: new BABYLON.Vector3(w,h,d) }` to override
  the mesh bounding box. `extents` are **full** dimensions. (Match the other samples'
  `SHOGI_PHYSICS_SIZE` etc.)
- **Teleporting / recycling a body** (the big gotcha):
  ```js
  body.disablePreStep = false;
  body.transformNode.position.copyFrom(spawn);
  body.setLinearVelocity(BABYLON.Vector3.Zero());
  body.setAngularVelocity(BABYLON.Vector3.Zero());
  ```
  Do **not** also re-assign `transformNode.rotationQuaternion` to a new random orientation while
  teleporting — Havok derives a huge angular velocity from the orientation jump and the body
  **spins up**. Re-enabling `disablePreStep = true` afterwards can also leave a dynamic body
  "animated" so it **falls slowly / not at all**. The proven pattern across these samples is to
  leave `disablePreStep = false` and not re-orient on recycle.
- **World scale**: if a sample uses a `PHYSICS_SCALE` (e.g. `1/10`), scale **gravity** too
  (`-9.8 * PHYSICS_SCALE`) or pieces fall `~√10×` too fast. Prefer modelling in the same units as
  the other samples (no scaling) so parameters can be copied directly.

### ammo / cannon / oimo

Standard Babylon physics-plugin usage. Mind each engine's **half-extents** box convention (unlike
Havok's full lengths).

### WGSL compute (`wgsl_compute`)

- Shares Babylon's WebGPU device via `engine._device`; shaders are JS template literals (constants
  like `COUNT`, `SHE`, `GROUND_*` interpolated in).
- Output is drawn into a `RenderTargetTexture` and composited with a `BABYLON.Layer`.
- **Clip-space Y flip**: emit `vec4(clip.x, -clip.y, clip.z, clip.w)` from the WGSL vertex shaders.
- Same GPU-physics rules as `docs/physics-implementation-notes.md` §3 (thick physics floor,
  sleep-from-the-bottom, etc.).

## Build / Run

No build step — open `index.html` in a WebGPU/WebGL browser. `node --check index.js` to lint.

## Troubleshooting

- *Recycled piece spins fast / won't fall* → see the Havok teleport note above.
- *Collider wireframe ≠ mesh* → `extents` are full dimensions; don't pass half.
- *Falls too fast at small scale* → scale gravity by `PHYSICS_SCALE`.
