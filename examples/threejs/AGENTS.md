# three.js — Agent Guide

Renderer-specific guidance for `examples/threejs/`. Read the root [`AGENTS.md`](../../AGENTS.md),
[`examples/AGENTS.md`](../AGENTS.md), and
[`docs/physics-implementation-notes.md`](../../docs/physics-implementation-notes.md) first.

## Folder Overview

three.js samples (ES modules: `import * as THREE from 'three'`). This renderer has the **widest**
engine coverage:

```
examples/threejs/{ammo,ammo_legacy,cannon,cannon-es,havok,oimo,oimophysics,physx,rapier}/<scene>/
```

It is the best place to compare engines against each other on a single renderer.

## Code Style & Idioms

- `import { OrbitControls } from 'three/addons/controls/OrbitControls.js'`.
- `PerspectiveCamera`, `WebGLRenderer` (shadow maps, ACES tone mapping). For comparison scenes use
  the fixed head-on view: `camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 1000)`,
  `camera.position.set(0, 0, 40)`, `controls.target` at origin, **`controls.autoRotate = false`**.
- Each frame: `engine.step(FIXED_DT)`, then copy each body's transform onto its mesh
  (`mesh.position.set(...)`, `mesh.quaternion.set(...)`); also update the debug wireframe mesh.

## Engine notes

- **Havok** uses the low-level handle API (`HK.HP_World_*`, `HK.HP_Body_*`,
  `HK.HP_Shape_CreateBox`). Remember **`HP_Shape_CreateBox` takes full side lengths**, not
  half-extents — a static floor box `[13, 0.1, 13]` is full size.
- **cannon-es**: friction over-grips slopes; a `ContactMaterial`'s friction is ignored when the two
  `Material`s already set per-material friction. Ramp scenes need a `FRICTION_SCALE` fudge to match
  the other engines.
- **ammo / ammo_legacy / oimo / oimophysics / physx / rapier**: half-extents box convention; pick
  the matching sibling sample as the template.

## Consistency

Match the scene parameters to the other renderers' versions (count, spawn, floor, gravity,
collider size, camera). For *Falling Shogi* the piece box collider is `[w, h*1.2, d*1.4]` =
`[1.6, 1.92, 0.448]` and the floor is a `13 × 0.1 × 13` slab at `y = -10` — see
`examples/AGENTS.md`.

## Build / Run

No build step — `index.html` loads the ES modules (import map / CDN). `node --check index.js`.

## Troubleshooting

- *Pieces fall through a thin floor* → thicken the **physics** box (the rendered slab can stay
  thin), tops aligned.
- *Boxes grip slopes too much (cannon-es)* → reduce friction / apply `FRICTION_SCALE`.
- *Texture upside-down* → `texture.flipY` / UV convention for that loader.
