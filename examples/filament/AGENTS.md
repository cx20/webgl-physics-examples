# Filament — Agent Guide

Renderer-specific guidance for `examples/filament/`. Read the root [`AGENTS.md`](../../AGENTS.md),
[`examples/AGENTS.md`](../AGENTS.md), and
[`docs/physics-implementation-notes.md`](../../docs/physics-implementation-notes.md) first.

## Folder Overview

Filament samples — the lowest-level renderer here (Google Filament via its JS/WASM bindings,
`Filament.*`). Physics engine present:

```
examples/filament/havok/<scene>/
```

Everything is explicit: meshes are built as in-memory glTF (vertex buffers, accessors, materials),
the camera is driven by hand, and the physics result is written onto Filament transform instances.

## Code Style & Idioms

- `Filament.init([...assets], () => main())`; create `engine`, `scene`, `view`, `renderer`,
  `swapChain`, a `camera`, and a `TransformManager`.
- **Camera** is manual: maintain `camTarget` + spherical `camTheta/camPhi/camRadius`, compute the
  eye each frame and `camera.lookAt(eye, target, up)`; `camera.setProjectionFov(fovDeg, aspect,
  near, far, fovAxis)`. For comparison scenes: target origin, `camRadius = 40`, `camTheta =
  camPhi = 0` (head-on), `fov = 45`.
- Static geometry is often a flat **quad** for the floor while the **physics** body is a thin box —
  keep their top surfaces aligned.

## Gotchas (see `reference_filament_havok_gltf_physics`)

- **Skip punctual lights at feature level 1** (`engine.getSupportedFeatureLevel()`), or Filament
  crashes building the froxel UBO. Light the scene with IBL / sunlight instead.
- Remember `scene.remove` / `popRenderable` bookkeeping, colour grading, and the **node → entity**
  map when syncing physics transforms back to renderables.
- The wireframe collider overlay is drawn as its own line geometry; keep it in sync with the OBB
  sizes.
- **Havok** `HP_Shape_CreateBox` takes **full** side lengths.

## Build / Run

No build step — `index.html` loads the Filament WASM + JS. `node --check index.js`.

## Troubleshooting

- *Blank screen / crash on start* → a punctual light at FL1; remove it or use IBL.
- *Pieces sink through the floor* → thicken the physics box; align its top with the visible quad.
- *Pieces drift from their meshes* → node→entity index mapping is off.
