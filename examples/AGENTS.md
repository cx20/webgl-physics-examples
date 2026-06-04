# Examples — Agent Guide

Focused guidance for working inside the **renderer × engine** example matrix. Read the root
[`AGENTS.md`](../AGENTS.md) and [`docs/physics-implementation-notes.md`](../docs/physics-implementation-notes.md)
first.

## Folder Overview

Every sample is a self-contained static page (`index.html` + `index.js` + `style.css`) with **no
build step**. The same scene is reproduced in many cells so they can be compared:

```
examples/<renderer>/<engine>/<scene>/
```

- `<renderer>` draws the scene (Babylon.js, three.js, Filament, PlayCanvas, raw WebGL1/2/WebGPU, …).
- `<engine>` simulates it (Havok, ammo.js, cannon-es, Oimo, PhysX, Rapier, or `wgsl_compute`).
- `<scene>` is the shared scenario (`marbles`, `football`, `shogi`, `eraser`, `domino`, `coins`, …).

## The two physics approaches

### A. Library-backed (`<renderer>/<engine != wgsl_compute>/`)

A CPU engine owns the simulation; the renderer only draws. The universal shape:

```text
init:   create world + gravity; create static colliders (floor/walls); create dynamic bodies
frame:  world.step(FIXED_DT)                      // fixed timestep, e.g. 1/60 or 1/200
        for each body: read transform → mesh/node
        recycle bodies that fell below the reset threshold
```

### B. GPU compute (`<renderer>/wgsl_compute/`)

The entire simulation runs in a **WGSL compute shader**; bodies are drawn with an instanced render
pass. State lives in ping-pong storage buffers; collisions are spheres (distance test, often with a
uniform spatial grid) or oriented boxes (face-normal SAT) with a per-body sleep timer. The custom
solver will never exactly match an engine — aim for the *same scene parameters* and a *plausible*
result. Full details and gotchas are in `docs/physics-implementation-notes.md` §3.

## Adding / porting a sample

1. **Start from the nearest sibling.** For a new engine of an existing scene, copy that scene from
   another engine on the same renderer. For a new renderer, copy the same engine+scene from a
   renderer with a similar API.
2. **Keep the scene parameters identical** to the other implementations (see the checklist below).
3. **Adapt only the renderer glue and engine calls**, not the scenario.
4. Update the relevant table in the root `README.md`.

## Cross-implementation consistency checklist

When the same scene exists in several cells, line them up against these (values shown for *Falling
Shogi*; the principle is general):

- [ ] **World scale + gravity.** If a sample models at `1/10` scale, scale **gravity** too
      (`g → g·0.1`) — otherwise it falls `~√10×` too fast.
- [ ] **Gravity magnitude** consistent (`-9.8`, not a mix of `-9.8/-9.81/-10`).
- [ ] **Body count / spawn region / recycle threshold** identical (300 pieces, `x,z ∈ ±7.5`,
      `y ∈ 15..30`, reset `y < -15`).
- [ ] **Floor** same footprint, level and surface height (`13 × 0.1 × 13` slab, top `≈ -9.95`).
- [ ] **Collider size = mesh size.** Mind the **box convention**: most engines use *half-extents*,
      **Havok `HP_Shape_CreateBox` uses full lengths**.
- [ ] **Thin static floors tunnel.** Make the *physics* floor thick (the *rendered* plate may stay
      thin) with aligned top surfaces.
- [ ] **Camera** same eye/target/FOV (`(0,0,40)` → origin, 45°), no auto-rotation.

## Renderer notes

| Renderer | API entry | Camera idiom |
| --- | --- | --- |
| `babylonjs` | `BABYLON.*`, `ArcRotateCamera`; WGSL variants share `engine._device` and composite via `RenderTargetTexture` + `Layer` (note the **clip-space Y flip**). | `setPosition` / `setTarget` |
| `threejs` | `THREE.*`, ES module imports, `OrbitControls` | `camera.position.set` + `controls` |
| `playcanvas` | `pc.*`, `CameraControls` script | `cc.reset(focus, pos)` |
| `filament` | low-level `Filament.*`, manual `camera.lookAt`, glTF authored in JS | manual orbit math |
| `webgl1/2` | raw GL + hand-written matrices | hand-written `lookAt` |
| `webgpu` | raw WebGPU; `wgsl_compute` here is the reference GPU solver | hand-written view matrix |

## Engine notes

| Engine | Box extents | Notable gotchas |
| --- | --- | --- |
| `havok` | **full** lengths | teleport must zero velocity and not re-orient (Babylon: see physics notes §5.1); default material friction/restitution. |
| `ammo` / `ammo_legacy` | half-extents | Bullet port; PlayCanvas texture/winding quirks. |
| `cannon` / `cannon-es` | half-extents | friction over-grips slopes; `ContactMaterial` ignored if per-`Material` friction is set. |
| `oimo` / `oimophysics` | half-extents | pure-JS; two API generations. |
| `physx` / `rapier` | half-extents | WASM; modern APIs. |
| `wgsl_compute` | half-extents (`SHE`) | inject `COUNT` from JS; thick physics floor; sleep from the bottom up. |

## Debugging

- **Library samples**: log a few body transforms; toggle the collider wireframe (most samples bind
  `W`).
- **GPU compute samples**: you cannot log from a shader — read the state buffer back to the CPU
  every N frames and aggregate (counts of airborne/settled/asleep, tilt distribution, max speed).
  Remove the readback (and `COPY_SRC`) before committing. See physics notes §4.

## Troubleshooting

- *Sample looks different from its siblings* → run the consistency checklist above.
- *Pieces fall through the floor* → thicken the **physics** floor collider.
- *Collider wireframe larger than the mesh* → box half-vs-full-extents mismatch.
- *GPU pile never settles / bottom squirms* → sleep gating; don't keep torquing settled bodies.
- *Recycled body spins up (Babylon + Havok)* → don't re-orient on teleport; zero the velocities.

## Resources

- `docs/physics-implementation-notes.md` — the in-depth reference this guide summarises.
- Sibling samples — the best template is always the same scene in another cell.
