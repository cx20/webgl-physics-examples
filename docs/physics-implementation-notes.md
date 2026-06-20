# Physics Implementation Notes

A technical reference for the physics used in this repository: the third‑party physics
**libraries** that are wired into each renderer, and the bespoke **WGSL compute‑shader physics**
under `wgsl_compute`. It collects the architecture, the algorithms, and — most usefully — the
**gotchas** discovered while building and cross‑checking the samples, so that the dozens of
renderer × engine combinations stay visually and behaviourally consistent.

> Audience: anyone adding a new sample, porting one between renderers, or trying to understand
> why two “identical” samples look different.

---

## 1. How the repository is organised

Samples live under `examples/<renderer>/<engine>/<scene>/`. It is a matrix:

- **Renderers** (15): `ashes`, `babylonjs`, `claygl`, `czpg`, `filament`, `glboost`,
  `grimoirejs`, `hilo3d`, `playcanvas`, `rhodonite`, `threejs`, `webgl1`, `webgl2`, `webgpu`,
  `xenogl`.
- **Physics** (10): `ammo`, `ammo_legacy`, `cannon`, `cannon-es`, `havok`, `oimo`,
  `oimophysics`, `physx`, `rapier`, **`wgsl_compute`**.

The same scene (e.g. *Falling Shogi*, *Falling Marbles*, *Falling Football*) is reproduced across
many cells of the matrix. Because the **scene** is meant to be the constant and only the
**renderer + engine** varies, the single most important rule is:

> **Keep the scene parameters identical across every implementation of a scene** — piece count,
> spawn region, floor size/position, gravity, collider sizes, camera. A reader compares cells
> side by side; any divergence reads as a bug in one of them.

A practical checklist for that is in [§6](#6-cross-implementation-consistency-checklist).

---

## 2. Third‑party physics libraries

All of these are **CPU** engines. The renderer only draws; each frame you step the world and copy
each body’s transform onto the matching mesh/node.

| Engine | Notes |
| --- | --- |
| **Havok** (`havok`) | WASM build (`HavokPhysics()`), low‑level `HP_*` handle API. Fast, stable, good sleeping. Used as the reference for several scenes. |
| **ammo.js** (`ammo`, `ammo_legacy`) | Emscripten port of Bullet. `ammo_legacy` pins an older build for renderers that need it. |
| **cannon / cannon‑es** (`cannon`, `cannon-es`) | Pure‑JS. `cannon-es` is the maintained fork. Easy to read, weaker stacking. |
| **Oimo** (`oimo`, `oimophysics`) | Pure‑JS. `oimophysics` is the newer rewrite. |
| **PhysX** (`physx`) | WASM build of NVIDIA PhysX. |
| **Rapier** (`rapier`) | Rust/WASM, deterministic, modern API. |

### 2.1 The universal integration pattern

```text
init:   create world, set gravity, create static colliders (floor/walls), create dynamic bodies
frame:  world.step(fixedDt)
        for each body: read world transform → write to render mesh
        recycle bodies that fell out of bounds
```

Use a **fixed timestep** for the physics step (`1/60` or `1/200`) even though rendering is
variable — it keeps stacking stable and makes samples reproducible.

### 2.2 Library gotchas worth knowing

- **Havok `HP_Shape_CreateBox` takes FULL side lengths, not half‑extents.** This is the single
  most common mistake when porting. If a sample passes “half” values it silently builds a box
  **2× too big**, and the collider wireframe is visibly larger than the mesh. (Bullet/ammo and
  most engines, by contrast, use **half‑extents** for boxes — always check which convention the
  engine you are porting *from* and *to* use.)
- **Havok body teleport must not infer velocity.** When recycling a body by moving it, set the
  transform and then **zero linear and angular velocity**; do not also re‑orient it in a way the
  engine reads as motion. See the Babylon‑specific note in [§5.1](#51-babylonjs--havok).
- **cannon‑es friction over‑grips slopes.** A `ContactMaterial`’s friction is ignored if the two
  `Material`s already set per‑material friction; and the default model makes boxes grip slopes far
  more than other engines. Scenes with ramps need a `FRICTION_SCALE` fudge to match. (See
  `reference_cannon_es_friction_slope`.)
- **PlayCanvas + ammo.js texture/winding quirks.** Pre‑allocate textures at the exact image
  dimensions, use `flipY = false` for custom UVs, fix normal winding, and beware
  `btConvexHullShape` jitter when stacking. (See `reference_playcanvas_ammo_gotchas`.)
- **Default materials differ.** Two engines with “default” friction/restitution will pile
  differently. When matching a reference, copy its friction/restitution (or its *lack* of them)
  explicitly rather than relying on defaults.

---

## 3. Custom GPU physics (`wgsl_compute`)

These samples run the **entire simulation in a WGSL compute shader** and draw the bodies with an
instanced render pass — no CPU physics engine. There are two families:

- **Spheres** — *Falling Marbles*, *Falling Football*, *Falling Coins/Balls*. Cheap narrow‑phase
  (distance test), so they scale to thousands of bodies with a spatial grid.
- **Oriented boxes (OBB)** — *Falling Shogi*, *Falling Eraser*. Box‑box collision via the
  Separating Axis Theorem, with sleeping so dense heaps settle.

### 3.1 Architecture

Per‑body state is packed into a storage buffer as 4 × `vec4<f32>` (64 bytes):

```wgsl
struct State {
    position   : vec4<f32>,   // xyz + a packed scalar (seed)
    velocity   : vec4<f32>,   // xyz + a packed scalar (sleepTimer)
    rotation   : vec4<f32>,   // quaternion
    angularVel : vec4<f32>,   // xyz
}
```

- **Ping‑pong buffers.** Two state buffers `A`/`B`; the compute reads `src` and writes `dst`, then
  they swap. Bodies read their **neighbours’ previous‑frame state** from `src`, which makes the
  step order‑independent (no race between threads).
- **Sub‑steps.** Each frame runs `SUBSTEPS` (4–8) compute dispatches with `dt = frameDt /
  SUBSTEPS`. More sub‑steps = less penetration per step = more stable stacking, at linear cost.
- **Dispatch.** One thread per body: `dispatchWorkgroups(ceil(COUNT / 64))` with
  `@workgroup_size(64)`, guarded by `if (i >= COUNT) { return; }`.

> **Keep the shader’s `COUNT` and the buffer length in lock‑step.** A hardcoded `const COUNT :
> u32 = 200u` while the buffers hold 150 bodies makes the inner loop read **past the buffer**;
> WebGPU returns zeros, which appear as **phantom colliders at the origin** that shove real bodies
> around. Inject `COUNT` from JS (string‑replace a `__COUNT__` token, or build the WGSL as a
> template literal) so the two can never disagree.

### 3.2 Broad phase: O(N²) → uniform spatial grid (O(N))

The naive narrow loop is `for j in 0..COUNT` — every body tests every other (O(N²)). For a few
hundred bodies on a GPU that is fine; for thousands it is the bottleneck. The marbles/football
samples replace it with a **uniform spatial grid**:

1. **clear** pass: zero the grid (`cs-clear`).
2. **build** pass: each body `atomicAdd`s itself into the cell for its position (`cs-build`,
   capacity‑capped per cell).
3. **step** pass: each body scans only the **3×3×3 neighbouring cells**.

```wgsl
const GRID_X=64u; const GRID_Y=64u; const GRID_Z=64u;
const CELL_CAPACITY=12u;
const CELL_SIZE = /* injected: must be >= the largest body diameter */;
```

- `CELL_SIZE` must be **≥ the largest collision diameter** so the 3×3×3 scan can’t miss an
  overlapping pair. Inject it from JS based on the actual body radius.
- The grid is rebuilt **every sub‑step** (clear → build → step) because positions change each
  sub‑step.
- This turns O(N²) into roughly O(N) and lets the marbles sample run ~1500 bodies smoothly.

### 3.3 Narrow phase

**Spheres** — trivial:

```wgsl
let d = posA - posB; let dist = length(d);
if (dist < rA + rB) { /* overlap: resolve along n = d/dist */ }
```

**OBB (shogi/eraser)** — Separating Axis Theorem using **only the six face normals** (the three
axes of each box), deliberately *not* the edge–edge cross products. Face‑only SAT gives a **stable
face‑direction contact normal** (no jitter/crawl as the minimal axis flips between frames), which
matters far more for a calm heap than the occasional missed deep edge contact.

```wgsl
// minimal penetration over the 6 face axes → contact normal n
// if any axis separates (pen <= 0): no contact
```

### 3.4 Contact resolution

Two parts, applied per contact:

- **Positional (Baumgarte) push‑out** to remove penetration, clamped so a deep overlap can’t
  launch a body:
  `pos += n * min(max(pen - SLOP, 0) * pushFactor * BAUMGARTE, MAX_PUSH)`.
- **Velocity impulse**: a restitution impulse along `n` (only if approaching, `vn < 0`) plus a
  tangential friction impulse. For the box samples the impulse also feeds **angular** velocity via
  `cross(r_i, J)` where `r_i` is the contact lever.

`pushFactor`/`impFactor` are `1.0` against an immovable static (floor/wall) and `0.5` for a
movable pair, so a body is pushed fully out of the floor but only half‑way out of another body
(the other body resolves its half).

### 3.5 Rolling without slipping (spheres)

A sphere that merely translates looks like it is **sliding**. To make it visibly roll, drive the
spin from the contact:

```wgsl
// On the ground, the zero‑velocity contact point gives, for a sphere of radius r:
//   omega_x =  vz / r,   omega_z = -vx / r
let rolling = vec3<f32>(vel.z / r, angVel.y * 0.96, -vel.x / r);
angVel = mix(angVel, rolling, k);
```

> **Get the signs right.** The naïve guess (`-vz/r`, `+vx/r`) spins the ball **backwards** — it
> looks like it is skidding, not rolling. Derive it from “velocity of the contact point = 0”:
> `v = ω × r_contact` with `r_contact = (0,-r,0)` gives `ω_x = v_z/r`, `ω_z = -v_x/r`. With a
> textured ball the wrong sign is obvious; with a plain sphere you can’t tell, which is how such a
> bug survives.

### 3.6 Sleeping & settling (boxes)

A dense heap of thin tiles never fully stops if every body is integrated every frame. Each body
carries a `sleepTimer` (packed into `velocity.w`):

- A body may accumulate sleep time only when it has a **stable support** (the floor or an
  **already‑sleeping** neighbour), is **slow** (`|v| < WAKE_LIN`, `|ω| < WAKE_ANG`), and its
  **push‑out has converged** (`pushMag < PUSH_REST` — so a body still being shoved out of a deep
  overlap does not freeze mid‑penetration and look like it is floating).
- After `SLEEP_TIME`, velocities are zeroed; a sleeping body is treated by its neighbours as an
  **immovable static** (full push‑out, and it counts as stable support) so heaps lock from the
  bottom up.
- A sleeping body still wakes if a fast mover pokes it or its support disappears.

**Toppling tiles upright vs. a natural jumble.** A flat tile balanced on its edge is a *metastable*
state the discrete solver can leave frozen. Two torques manage this:

- A **gravity‑about‑contact torque** `cross(-rAvg, (0,-g,0)) * GTIP` topples a body quickly toward
  a flat rest (it vanishes once balanced, i.e. when the average contact lever is vertical). This
  is the fast, realistic one.
- It **vanishes for a perfectly upright tile** (lever is vertical), so a tiny extra **bias toward
  flat**, applied *only to near‑upright bodies*, breaks that balance.

The decisive trick for a *natural* heap (rather than a tidy flat stack **or** a frozen‑on‑edge
mess) is **when** to apply the toppling torque:

```wgsl
let settledSupport = stableSupport && |v| < WAKE_LIN && |ω| < WAKE_ANG;
if (!settledSupport) { angVel += gravityTipTorque; }   // only topple bodies still in motion
if (abs(zaxis.y) < 0.35) { angVel += smallFlatBias; }  // only un-balance near-upright bodies
```

- A **moving** body is toppled by gravity (fast).
- A body **already slow on a stable support** is left alone, so settled and **buried** bodies
  actually come to rest and **stay put** (otherwise the torque keeps nudging them and the bottom
  of the pile visibly squirms — which is unphysical).
- Bodies sleep at **whatever angle they wedge at**, giving a Havok‑like jumble instead of an
  unnaturally tidy flat stack.

> This is a bespoke OBB solver, not a full rigid‑body engine: it will never match a production
> engine like Havok exactly. The goal is a *plausible, calm* heap with the **same scene
> parameters** as the engine‑backed samples.

### 3.7 Recycling (the “fountain”)

Bodies that spill off the small floor are teleported back to the top instead of being lost:

```wgsl
if (pos.y < RESET_Y) {
    pos = randomSpawnAboveThePlate();
    vel = vec3(0, -0.3, 0);     // small downward kick so it is awake and falls
    rot = randomOrientation();
    angVel = randomTumble();    // so it lands at a varied angle (keeps the jumble)
    sleepTimer = 0;
}
```

A small downward velocity (rather than exactly zero) keeps the recycled body from being considered
asleep in mid‑air.

### 3.8 Falling Coins — fixed‑axis spin model

The *Falling Coins* samples (`wgsl_compute/coins`) use a different rotation scheme from the OBB
boxes. Coins are sphere colliders, so spin has no effect on collisions, but it must look right
visually — a coin tumbling through the air must *spin*, slow down when it hits the floor, and
not accumulate angular error over thousands of frames.

#### State layout (per coin, 4 × `vec4<f32>` = 64 bytes)

```wgsl
struct CoinState {
    position : vec4<f32>,   // xyz = world position, w = seed (packed scalar)
    velocity : vec4<f32>,   // xyz = linear velocity,  w unused
    axis     : vec4<f32>,   // xyz = fixed unit rotation axis (set once at spawn, w unused)
    spin     : vec4<f32>,   // x = accumulated angle (radians), y = per‑coin spin rate (zw unused)
}
```

The key design choice is that **each coin has one fixed rotation axis** assigned at spawn time
(uniformly distributed on the sphere) and a **fixed spin rate** (uniform in `[0.5, 2.0]` rad/s
base). The visible spin is driven by those two constants plus the current linear speed:

```wgsl
const SPIN_BASE    : f32 = 4.0;   // base angular rate multiplier
const SPIN_SPEED_K : f32 = 0.5;   // extra rate per (m/s) of linear speed
const FLOOR_SPIN_F : f32 = 0.3;   // spin factor while on the floor

let inAir      = !onFloor || pos.y - radius > groundY + 0.05;
let spinFactor = select(FLOOR_SPIN_F, 1.0, inAir);
angle += spinRate * (SPIN_BASE + speed * SPIN_SPEED_K) * spinFactor * dt;
```

- **Why fixed axis, not quaternion × angular velocity?** Quaternion integration needs angular
  damping to converge; over many substeps a coin's spin decays to near‑zero and it slides without
  rotating. The fixed‑axis model removes the damping problem: every coin always has its assigned
  rate, driven by how fast it is moving, so coins moving slowly spin slowly and fast‑moving or
  airborne coins tumble quickly.
- **Why `spinFactor`?** Coins tumble freely in air (`spinFactor=1.0`) but visually slow down when
  they touch the floor (`spinFactor=0.3`), mimicking friction without coupling the physics into
  the rotation model.
- **Speed cap.** A `MAX_SPEED = 25 m/s` clamp prevents runaway coins from accumulating infinite
  speed after many substeps of overlapping collisions.

#### Jacobi collision response

The old sequential model accumulated impulses *in‑place* inside the neighbour loop:

```wgsl
// sequential (old)
for j in neighbours { pos += halfCorrection; vel += impulse; }
```

Because reads came from `srcStates` (previous frame) but writes went directly to the
current local `pos`/`vel`, corrections from later neighbours in the scan built on partially‑corrected
state. The scan order isn't random — it follows the grid cell order — so one hemisphere of
contacts consistently "wins", creating a subtle but visible directional drift in dense piles.

The **Jacobi** model accumulates all corrections into separate accumulators and applies once:

```wgsl
// Jacobi (new)
var posCorr = vec3<f32>(0.0);
var velCorr = vec3<f32>(0.0);
for j in neighbours {
    posCorr += halfCorrection;
    velCorr += impulse;
}
pos += posCorr;
vel += velCorr;
```

All inputs come from `srcStates` (the ping‑pong read buffer), so no contact overrides another;
the response to all neighbours is symmetric and order‑independent.

#### Update ordering

The old code applied `pos += vel * dt` before the floor and collision tests, meaning gravity
could push a coin through the floor before the floor correction ran. The Babylon.js‑style
ordering fixes this:

```text
1. gravity        → vel.y -= g * dt
2. coin–coin      → Jacobi posCorr / velCorr
3. floor contact  → clamp pos.y, apply restitution + friction multiplier
4. speed cap      → clamp |vel| to MAX_SPEED
5. position step  → pos += vel * dt     ← always last
6. spin update    → angle += …
7. linear damping → vel *= damping
```

Moving the position step to after all collision corrections means the floor and coin–coin
responses act on the *updated* velocity, not the pre‑collision one, giving more stable stacking.

#### Floor friction

Rather than a full tangential impulse model, the floor applies a simple velocity multiplier to
the horizontal components:

```wgsl
vel.x *= params.friction;   // friction = 0.92
vel.z *= params.friction;
```

This is enough to make coins slow their lateral drift when they land, without the oscillation
that a full Coulomb friction model can introduce in a simple explicit integrator.

---

## 4. Debugging GPU physics

You cannot `console.log` from a compute shader. To diagnose behaviour, **read the state buffer
back to the CPU** every N frames and aggregate it:

1. Add `COPY_SRC` usage to the state buffers and create a mappable readback buffer
   (`COPY_DST | MAP_READ`).
2. After `submit`, `copyBufferToBuffer(latestState, readback)`, then `mapAsync(READ)`; guard with a
   `busy` flag so you never map twice concurrently.
3. Aggregate into an on‑screen overlay: counts of *airborne / settled / asleep*, the **tilt
   distribution** of settled bodies (flat / leaning / standing), max speed, max angular velocity,
   average/max height.

This turns “it looks wrong” into numbers — e.g. it revealed that shogi pieces were freezing at
~74° (standing) rather than settling flat, and later that the bottom of the pile never stopped
moving. **Remove the instrumentation (and the `COPY_SRC`) before committing.**

---

## 5. Renderer‑specific integration gotchas

### 5.1 Babylon.js + Havok

- **Teleporting a body** (recycle): set `body.disablePreStep = false`, move
  `body.transformNode.position`, then `setLinearVelocity(0)` / `setAngularVelocity(0)`. Do **not**
  re‑assign `transformNode.rotationQuaternion` to a new random orientation while teleporting —
  Havok derives a large angular velocity from the orientation jump and the piece **spins up**.
  Re‑enabling the prestep optimisation (`disablePreStep = true`) on the next frame can also leave
  a dynamic body in a bad “animated” state where it **falls slowly or not at all**; the
  battle‑tested pattern across the repo’s Babylon+Havok samples is to leave `disablePreStep =
  false` and simply **not re‑orient** on recycle.
- **Custom collider extents**: `new BABYLON.PhysicsAggregate(mesh, BOX, { ..., extents })` lets you
  give a box a collider size different from the mesh bounding box. `extents` are **full**
  dimensions.

### 5.2 Babylon.js + WGSL (shared device)

The compute/render passes run on **Babylon’s own WebGPU device** (`engine._device`) and composite
into the scene via a `RenderTargetTexture` + `Layer`. Note the **Y flip**: Babylon’s clip space
differs, so the WGSL vertex shader emits `vec4(clip.x, -clip.y, clip.z, clip.w)`.

### 5.3 Filament + Havok / Rhodonite + Havok

- **Filament**: skip punctual lights at feature level 1 to avoid a froxel UBO crash; remember
  `popRenderable`, colour grading, and the node→entity map. (See
  `reference_filament_havok_gltf_physics`.) Static geometry is often a flat **quad** for the floor
  while the physics body is a thin **box** — keep their top surfaces aligned.
- **Rhodonite**: entity names carry a `_(NN)` suffix and the `gltfNodeIndex` is unreliable; the
  Havok constraint/trigger API and the wireframe overlay have their own patterns. (See
  `reference_rhodonite_havok_gltf_physics`.)

### 5.4 Babylon.js Lite + Havok (glTF Physics extension)

This is the set of [Babylon.js Lite](https://github.com/BabylonJS/Babylon-Lite) samples under
`examples/babylonjs-lite/havok/` — the *Falling X* scenes and the seven
**`gltf_physics_*`** examples that load the Khronos
[`KHR_physics_rigid_bodies`](https://github.com/eoineoineoin/glTF_Physics) sample assets
(Basic Shapes, Materials Friction/Restitution, Motion Properties, Filtering, Triggers,
JointTypes). Babylon.js **Lite** is a minimal, WebGPU‑only, tree‑shakeable rewrite with a small
functional API (`createEngine`, `loadGltf`, `createHavokWorld`, `createPhysicsAggregate`, …); it is
**not** the full Babylon.js, so most of [§5.1](#51-babylonjs--havok) does not apply.

Libraries are referenced via an **importmap** in `index.html`
(`@babylonjs/lite`, `@babylonjs/havok`) so `index.js` carries no version string; Havok is
`await HavokPhysics()` (the WASM resolves relative to the mapped ESM module).

#### No built‑in glTF‑physics loader → parse the glb yourself

Full Babylon.js has a rigid‑body loader that auto‑creates physics from `KHR_physics_rigid_bodies`.
**Lite has none.** Like the three.js / Rhodonite / PlayCanvas ports, fetch the `.glb`, parse its
JSON chunk, and read `extensions.KHR_implicit_shapes.shapes` + `extensions.KHR_physics_rigid_bodies`
(per‑node `collider` / `trigger` / `motion`, plus scene‑level `physicsMaterials`, `collisionFilters`,
`physicsJoints`) yourself.

#### The top‑level anchor pattern (the central gotcha)

The Lite Havok wrapper writes a body’s **world** pose back into its bound node’s **local**
`position`/`rotationQuaternion`, and `loadGltf` puts the whole asset under a synthetic `__root__`
whose **scale.x = −1** (the right‑handed‑glTF → left‑handed‑Babylon flip). So binding a body
directly to a loaded glTF node seeds it from the node’s *local, un‑flipped* transform — the body
(and its W‑key collider wireframe) ends up at the **mirror‑X** of the rendered mesh. This is exactly
the bug that made *Falling Marbles*’ colliders not line up with the marbles.

The fix used by every `gltf_physics_*` example (and now marbles): give each body an **invisible,
unit‑scale, top‑level anchor** (`createTransformNode`) placed at the Babylon left‑handed world pose,
and **reparent the asset’s own mesh/subtree under that anchor** for the visual:

```text
anchorWorldPose = decompose( F · nodeWorldMatrix )      // F = diag(-1, 1, 1)
anchor.position/rotationQuaternion = anchorWorldPose     // body binds here (top-level → local == world)
subtree.parent = anchor;  subtree.scaling = decompose.scale   // its negative X reproduces the __root__ flip
```

- `nodeWorldMatrix` is the product of the glTF ancestor local TRS — **not** including `__root__`.
- Decompose pushing a negative determinant onto **scale.x** (matching `__root__`). The body gets a
  proper (reflected) quaternion; the visual subtree’s decomposed scale carries the −X, which keeps
  normals/winding correct (and, for marbles, the iridescent IBL — removing the −X turned the spheres
  near‑black). The compose/decompose/`matToQuat` math is worth **unit‑testing in Node** — you cannot
  see a sign error until it renders.

> **Reparenting must update `children`, not just `.parent`.** Setting `subtree.parent = anchor`
> alone is enough for *rendering* and for primitive colliders, but the **mesh/convex shape
> accumulator walks `anchor.children`** — splice the node out of its old `parent.children` and push
> it onto `anchor.children`, or `createPhysicsShape({type: MESH|CONVEX_HULL, …})` throws *“Cannot
> create physics mesh shape without vertex positions.”*

> **Don’t reparent the array you’re iterating.** `for (const n of root.children)` while the reparent
> splices nodes out of `root.children` skips half of them (some marbles stayed frozen at their model
> positions). Iterate a **copy**: `for (const n of [...root.children])`.

#### Camera azimuth is per‑scene

Lite’s `ArcRotateCamera` `alpha` is offset by ~π from full Babylon, **and** each asset’s “front”
faces a different way, so the un‑mirrored scene still needs a per‑example azimuth (`+π/2` for the
Materials scenes, `−π/2` for Motion Properties, …). Expect a *“rotate 180°”* follow‑up per scene;
`beta ≈ π/2.2`.

#### Building colliders with the Lite wrapper

Prefer `createTransformNode` anchors + `createPhysicsShape` + `createPhysicsBody` over aggregates —
it handles every shape uniformly:

- **Primitive**: `createPhysicsShape(world, {type, parameters:{center, extents|radius|pointA/pointB}})`.
  Box `extents` are **FULL** dimensions, same as the full‑Babylon convention (see
  [§2.2](#22-library-gotchas-worth-knowing)). Havok has no tapered capsule/cone, so a tapered glTF
  capsule/cylinder collapses to a single‑radius shape (avg/max); the visual mesh still shows the true
  taper.
- **Mesh / convex**: `createPhysicsShape(world, {type: MESH|CONVEX_HULL, mesh: anchor,
  includeChildMeshes: true})` — it accumulates the reparented subtree’s `_cpuPositions` in
  anchor‑local space (scale included).
- **Loaded `boundMin`/`boundMax` are already WORLD‑space** (`loadGltf` bakes the node world matrix
  via `computeAabb`). Use `boundMax − boundMin` directly; multiplying by the node scale again makes
  colliders 2× too big (this made the *Triggers* boxes huge).

#### Materials, mass, filtering, triggers, joints, compounds

- **Material combine.** `createPhysicsAggregate` defaults friction combine to **MINIMUM**, so a
  zero‑friction floor cancels each body’s friction (both *Materials Friction* boxes slid the same).
  The glTF samples / ports use **MAXIMUM** — override after building the shape:
  `hknp.HP_Shape_SetMaterial(shape._hkShape, [f, f, r, MaterialCombine.MAXIMUM, MaterialCombine.MAXIMUM])`.
- **Mass properties.** `setPhysicsBodyMassProperties(world, body, {mass, centerOfMass, inertia,
  inertiaOrientation})` (inertia component `0` ⇒ locked axis; `mass 0` + motion ⇒ DYNAMIC
  infinite‑mass). `gravityFactor` has **no** wrapper setter — call
  `hknp.HP_Body_SetGravityFactor(body._hkBody, f)` (negative ⇒ balloons float up).
- **Collision filtering.** Map each named `collisionSystems`/`collideWithSystems` to a bit, OR into
  membership/collide masks, apply with `setPhysicsShapeFilterMembershipMask` / `…CollideMask`.
- **Triggers.** `setPhysicsShapeIsTrigger(world, shape, true)` + a STATIC body → bodies pass
  through. `onPhysicsTrigger` only reports ENTERED/EXITED (**not which volume**) — do manual
  distance overlap for per‑volume highlighting. **Do not recolour a loaded PBR mesh’s material**
  (it is already built as a PBR renderable → crash in `buildPbrRenderables`/`addTex`); hide the
  loaded mesh (`setMeshVisible(mesh, false)`) and add a separate primitive + standard material you
  can tint.
- **Joints.** glTF joints are generic 6‑DoF (`limits` with `linearAxes`/`angularAxes` + min/max), so
  build every one as a `SIX_DOF` constraint and lock/limit/free each axis (`LINEAR_X/Y/Z = 0..2`,
  `ANGULAR_X/Y/Z = 3..5`; min == max ⇒ locked, unlisted ⇒ free). The joint frame is a `jointSpace`
  node’s transform relative to its body (F cancels in the body‑relative frame, but apply the body’s
  decomposed scale to the pivot/axes).
- **Kinematic spinners.** Lite’s step **snaps every `ANIMATED` body to its node each pre‑step**, so
  `setPhysicsBodyAngularVelocity` on a kinematic body is overwritten — it won’t spin. Instead
  **rotate its anchor node every step** in `onPhysicsAfterStep` (world‑frame increment `dq · q`); the
  pre‑step teleport carries the body and drives its joint. Angular velocity is a **pseudovector**
  under F: `(ωx, ωy, ωz) → (ωx, −ωy, −ωz)`.
- **Compound bodies.** A node with `motion` but no collider of its own, whose children *are*
  colliders (e.g. a “car” of wheel cylinders + a chassis convex), becomes a
  `createPhysicsShape({type: CONTAINER})`; add each child with
  `addPhysicsShapeChildFromParent(world, container, compoundAnchor, childShape, childTN)` (reparent
  the compound subtree first so `childTN.worldMatrix` is current). Two‑pass: collect the compound’s
  descendant collider nodes into a `consumed` set, then skip them in the main loop. Decorative /
  trigger descendants (the headlights) just ride along visually.

---

## 6. Cross‑implementation consistency checklist

When a scene exists in several renderer × engine cells, line them up against these. (Concrete
values are from *Falling Shogi*; the principle is general.)

- [ ] **World scale / units.** If one sample models at `1/10` scale, **everything** must scale —
      including **gravity**. Falling speed for a height `h` is `t = sqrt(2h/g)`; a `1/10`‑scale
      world with unchanged `g = 9.8` falls `~sqrt(10) ≈ 3×` too fast. Scale gravity by the length
      scale (`g → g * 0.1`) so the motion matches.
- [ ] **Gravity magnitude.** `-9.8` everywhere (not a mix of `-9.8 / -9.81 / -10`).
- [ ] **Body count.** Same `PIECE_COUNT` (e.g. 300).
- [ ] **Spawn region.** Same `x,z ∈ ±7.5`, `y ∈ 15..30`.
- [ ] **Recycle threshold.** Same `y < -15`.
- [ ] **Floor.** Same footprint and height **and the same surface level** (e.g. a `13 × 0.1 × 13`
      slab with its top at `y ≈ -9.95`). A heap overflowing a small floor is part of the look.
- [ ] **Collider size = mesh size.** Watch the half‑vs‑full‑extents convention; an oversized
      collider changes how loosely the heap packs and shows up in the wireframe.
- [ ] **Thin static floors tunnel.** A box collider only a few cm thick lets a fast body sink past
      the box centre, flipping the SAT push‑out normal **downward** and dropping the body through.
      Make the **physics** floor thick (its **rendered** plate can stay thin) and keep their top
      surfaces aligned.
- [ ] **Camera.** Same eye/target/FOV (e.g. eye `(0,0,40)`, target origin, 45° vertical FOV) and
      **no auto‑rotation** — comparisons need a fixed, identical viewpoint.

---

## 7. Quick lessons

- Keep the **scene** constant; vary only the **renderer + engine**.
- Inject `COUNT` (and other shader constants) from one source of truth.
- Know your box convention: **half‑extents (most engines) vs full lengths (Havok)**.
- Make static floors **thick in physics**, thin in render.
- Derive rolling spin from the contact constraint and **check the sign**.
- For GPU physics, **read back and measure**; don’t eyeball it.
- For a calm heap: **sleep from the bottom up**, and stop torquing bodies once they have settled.
- Match **gravity to the world scale**, and match **materials explicitly** when comparing engines.
- For **Babylon.js Lite**, drive each loaded‑glTF body from a **top‑level anchor at the left‑handed
  world pose** (`decompose(diag(-1,1,1) · nodeWorld)`) with the mesh reparented under it — binding a
  body straight to a `__root__`‑nested node mirrors the collider in X.
