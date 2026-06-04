# AGENTS.md

Guidance for AI coding agents working with the **cx20/webgl-physics-examples** repository.

## Repository Overview

**Purpose**: a gallery that reproduces the *same* physics scenes across many **renderers** and
many **physics engines**, so they can be compared side by side. Scenes include *Falling Marbles*,
*Falling Football*, *Falling Shogi*, *Falling Eraser*, *Domino*, *Coins*, glTF physics samples,
and more. Each sample is a self-contained static web page (open `index.html` in a WebGL/WebGPU
browser — no build step).

**Top-level layout**:

- `examples/` — every sample, as a **renderer × engine** matrix (see `examples/AGENTS.md`).
- `assets/` — shared textures, models, HDR/env maps used by the samples.
- `docs/` — technical references. Start with
  [`docs/physics-implementation-notes.md`](docs/physics-implementation-notes.md).
- `README.md` — the index tables of all samples.

## Key Patterns and Conventions

### Directory structure

```
examples/<renderer>/<engine>/<scene>/   →  index.html, index.js, style.css
```

- **Renderers** (15): `ashes`, `babylonjs`, `claygl`, `czpg`, `filament`, `glboost`,
  `grimoirejs`, `hilo3d`, `playcanvas`, `rhodonite`, `threejs`, `webgl1`, `webgl2`, `webgpu`,
  `xenogl`.
- **Engines** (10): `ammo`, `ammo_legacy`, `cannon`, `cannon-es`, `havok`, `oimo`,
  `oimophysics`, `physx`, `rapier`, and the bespoke GPU solver `wgsl_compute`.

### The golden rule

> **A scene is the constant; only the renderer + engine vary.** When the same scene exists in
> several cells, every implementation must use the **same scene parameters** — body count, spawn
> region, floor size/position, gravity, collider sizes, camera. A divergence reads as a bug in
> one of them. The full checklist is in `docs/physics-implementation-notes.md` §6.

## Guidelines for AI Agents

### When adding or porting a sample

1. **Copy the closest existing sample** for the same scene (another engine, or the same engine on
   another renderer) and adapt it — do not invent a new structure.
2. **Match the renderer's existing idioms** (its module imports, camera, render loop). Look at
   sibling samples under the same `examples/<renderer>/` first.
3. **Match the engine's existing idioms** (its world setup, body creation, stepping). Look at
   sibling samples under `examples/<*>/<engine>/`.
4. **Keep the scene parameters identical** to the other implementations of that scene.
5. **No build step.** Samples are plain ES modules / scripts loaded by `index.html`. Keep
   dependencies CDN- or vendor-based as the sibling samples do.

### When modifying physics behaviour

- Read [`docs/physics-implementation-notes.md`](docs/physics-implementation-notes.md) first — it
  records the gotchas (Havok full-vs-half box extents, thin-floor tunnelling, rolling-spin sign,
  GPU sleeping/settling, gravity-vs-world-scale, body-teleport velocity inference, …).
- Tune one parameter at a time and re-check; physics feel is sensitive.

### Commit / PR conventions

- **Commit messages and PR titles/descriptions are always in English.**
- Branch off `master`; one logical change per PR. Stage only the files for that change (do not
  sweep in unrelated work-in-progress).
- Verify JavaScript with `node --check <file>` before committing (these samples have no test
  suite; in-browser verification is manual).

## Testing and Validation

1. `node --check` the changed `index.js` (and any embedded shader logic you can lint).
2. Open the sample in a WebGL/WebGPU-capable browser and confirm it runs.
3. For WebGPU compute-physics samples, compare against the engine-backed version of the same
   scene — the layout and camera should match.
4. The primary environment is Windows 11 with a recent Chrome/Edge (WebGPU enabled).

## Documentation

- **`docs/physics-implementation-notes.md`** — libraries, the WGSL compute physics, and the
  cross-implementation consistency checklist. Update it when you discover a new gotcha.
- **`README.md`** — keep the sample tables current when adding a sample.
- **`examples/AGENTS.md`** — focused guidance for working inside the example matrix.

## Additional Resources

- Live site: <https://cx20.github.io/webgl-physics-examples/>.
- When unsure, study the same scene in another cell of the matrix before writing new code.
