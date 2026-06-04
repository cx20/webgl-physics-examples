# PlayCanvas — Agent Guide

Renderer-specific guidance for `examples/playcanvas/`. Read the root [`AGENTS.md`](../../AGENTS.md),
[`examples/AGENTS.md`](../AGENTS.md), and
[`docs/physics-implementation-notes.md`](../../docs/physics-implementation-notes.md) first.

## Folder Overview

PlayCanvas samples (`pc.*`, ES modules). Physics engines present:

```
examples/playcanvas/{ammo,havok}/<scene>/
```

The physics is driven directly (Havok handle API, or ammo.js) rather than through PlayCanvas's
built-in rigidbody component, and the result is copied onto `pc.Entity` transforms.

## Code Style & Idioms

- `new pc.Application(canvas, ...)`; entities via `new pc.Entity()` + `addComponent('render'|'model'|'camera', ...)`.
- Camera + orbit: `import { CameraControls } from 'playcanvas/scripts/esm/camera-controls.mjs'`,
  then `const cc = camera.script.create(CameraControls); cc.reset(focus, position)`. For comparison
  scenes use the head-on view: `fov: 45`, `cc.reset(new pc.Vec3(0,0,0), new pc.Vec3(0,0,40))`.
- Each frame: step the world, then `entity.setPosition(...)` / `entity.setRotation(new pc.Quat(...))`.

## Engine notes

- **Havok**: low-level `HK.HP_*`. `HP_Shape_CreateBox` takes **full** side lengths — these samples
  often write `createStaticBox(x,y,z, hw,hh,hd)` and pass `[hw*2, hh*2, hd*2]`, i.e. they keep
  half-extents in JS and double them for Havok. Keep that convention.
- **ammo.js** gotchas (see `reference_playcanvas_ammo_gotchas`):
  - Pre-allocate textures at the **exact** image dimensions.
  - Use `flipY = false` for custom UVs; fix triangle/normal **winding**.
  - `btConvexHullShape` jitters when stacked pieces interpenetrate — prefer primitive box/convex
    shapes where possible.

## Build / Run

No build step — `index.html` loads the ESM. `node --check index.js`.

## Troubleshooting

- *Texture wrong size / blurry* → texture not pre-allocated at the image's exact dimensions.
- *Texture flipped / mis-UV'd* → `flipY = false` and check winding.
- *Stacked convex pieces jitter* → `btConvexHullShape` instability; use simpler colliders.
- *Collider ≠ mesh* → Havok full-vs-half extents.
