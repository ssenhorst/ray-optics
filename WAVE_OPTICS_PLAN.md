# Wave Optics Extension — Implementation Plan

A plan for adding a 2D scalar wave-optics simulator to this repository, reusing the
existing editor (drag & drop, zoom/pan, undo/redo, save/load, object bar) while
replacing the ray-tracing core with a Huygens/Rayleigh–Sommerfeld field summation.

---

## 0. Decisions locked in

| Question | Decision |
|---|---|
| Green's function | Exact 2D Hankel `H₀⁽¹⁾(kr)` (amplitude ∝ 1/√r), not the 3D-like 1/r |
| Optical axis | `z` = canvas **+x** (horizontal, light travels left→right); `y` = canvas vertical |
| Curve parameter | Interfaces: transverse `y` (zeroed at element center). Line sources: arc length `u` (zeroed at center) |
| Integration | **Separate app entry point** (`dist/wave/`), sharing `Scene`, `Editor`, `geometry` and the Vue control components |

### Note on the 1/r in the original spec

The spec mentioned `1/(r+eps)`. In 2D the free-space Green's function is
`G(r) = (i/4)·H₀⁽¹⁾(kr)`, whose far-field envelope is `1/√r`, not `1/r`. This matters
quantitatively: it changes diffraction amplitudes, the relative weight of near vs far
sources in every sum, and energy balance across interfaces. We implement the Hankel
function exactly (see §2.1); the colormap cutoff you wanted still solves the real
problem, which is the **logarithmic singularity of `H₀⁽¹⁾` at `r→0`** dominating the scale.

---

## 1. Conventions

Fixing these up front because every formula below depends on them.

- **Time convention**: `e^{-iωt}`. Outgoing waves therefore carry `e^{+ikr}`.
  The displayed time-dependent field is `Re{ U(r)·e^{-iωt} }`.
- **Field**: `U` is a complex *scalar*. No polarization; TE/TM are not distinguished
  and Fresnel coefficients are not applied automatically (see §2.4).
- **Wavenumber**: `k_j = n_j · k₀`, `k₀ = 2π/λ₀`.
- **Wavelength units**: `λ₀` is expressed in **scene length units**, not nanometres.
  The existing ray simulator uses nm purely for colour mapping; here λ is a geometric
  quantity and must live on the same ruler as the canvas. Default `λ₀ = 20` units
  (see §3.3 for why this default, not something tiny).
- **Subspaces**: interfaces `I₁ … I_N` are ordered by increasing `z`. Subspace `S₀` is
  `z < I₁`, `S_j` lies between `I_j` and `I_{j+1}`, `S_N` is `z > I_N`.
  `S₀` has the scene-level background index `n₀`; `S_j` takes its index from `I_j`'s
  `refractiveIndexAfter` property.
- **Interface geometry**: each interface is an **open** curve that is single-valued in
  `y`, i.e. `z = f(y)` over a finite interval `y ∈ [y_min, y_max]`. This restriction is
  what makes subspace membership a single comparison per pixel, and it matches the
  "ordering in z" requirement. Validation rejects curves that fold back in `y`, and
  warns when two interfaces overlap in `z`.
- **Forward normal** `n̂` on an interface points in the `+z` half-plane.

---

## 2. Physics core

### 2.1 Point source

```
U(P) = A · e^{iφ} · (i/4) · H₀⁽¹⁾(k · r),     r = |P − s|
```

`H₀⁽¹⁾ = J₀ + iY₀`. Implementation (shared between the JS reference and the GLSL
shader, generated from one table of coefficients so they cannot drift apart):

- `kr < 3`: Abramowitz & Stegun 9.4.1 / 9.4.3 polynomial approximations
  (|ε| < 1.6·10⁻⁸ — far below anything visible).
- `kr ≥ 3`: A&S 9.2.5 / 9.2.6 asymptotic form with the `f₀`, `θ₀` correction
  polynomials, which is already accurate to ~10⁻⁸ at `kr = 3`.
- `kr → 0`: `Y₀` diverges logarithmically. Clamp `r ≥ r_min` with
  `r_min = λ/(100·n)` — a physical soft core rather than an arbitrary `eps`, so it
  scales correctly when λ changes.

`H₁⁽¹⁾` is needed for the interface kernel and uses A&S 9.4.4 / 9.4.6 the same way.

### 2.2 Line source

A line source is a **continuous line current**, sampled at `M` points:

```
U(P) = Σ_m A(u_m)·e^{iφ(u_m)} · (i/4)·H₀⁽¹⁾(k·r_m) · Δu_m
```

**The `Δu_m` weight is essential and was not in the spec.** Without it, doubling the
source density doubles the field, so the density slider would change the physics
instead of only the accuracy. With it, the result converges as density rises and then
stops changing — which is what you want from an accuracy control.

`u` is arc length from the centre of the line, in canvas units, as specified.
`A(u)` and `φ(u)` are user equations, evaluated **on the CPU** at the `M` sample points
using the existing `evaluatex` / `formula-parser` machinery, then uploaded as data.
No formula compilation into GLSL is needed — `M` is at most a few thousand.

### 2.3 Interface re-radiation (the propagation chain)

This is the heart of the simulation. For interface `I_j` with samples `s_m`, arc-length
spacing `Δs_m`, downstream wavenumber `k_j`, and complex transmission
`t_j(y) = A_j(y)·e^{iφ_j(y)}`:

```
U_j(P) = Σ_m t_j(y_m) · U_j^inc(s_m) · K_j(r_m, θ_m) · Δs_m

K_j(r, θ) = (i·k_j/2) · H₁⁽¹⁾(k_j·r) · cos θ ,     cos θ = n̂_m · r̂_m
```

`U_j^inc(s_m)` is the field at `s_m` computed from subspace `S_{j−1}`'s source set.

This is the **2D Rayleigh–Sommerfeld integral of the first kind**. Two properties make
it the right choice and both are worth stating because they are easy to get wrong:

1. **It is correctly normalised.** In the far field `K` reduces to
   `√(k/2πi) · e^{ikr}/√r · cos θ`, the standard 2D Fresnel kernel. Consequently a
   full-height, `t=1`, index-matched interface reproduces the incident field exactly
   instead of scaling it. That is a unit test (§7), not an assumption.
2. **It is sampling-density independent**, again thanks to `Δs_m`.

The obliquity factor `cos θ` uses only the observation-side angle (Rayleigh–Sommerfeld
I). The Kirchhoff variant `(cos θ_inc + cos θ_obs)/2` differs only at large angles; we
can add it as an option later.

**Refraction** emerges from this scheme without extra work: the incident field is
sampled with medium `j−1`'s Green functions and re-radiated with medium `j`'s, which is
the Huygens construction that gives Snell's law in the geometric limit.

**Blocking is automatic**: only the sampled points on `I_j` radiate into `S_j`, so a
finite-length interface is intrinsically a beam blocker outside its `y` range, and the
field that does appear in the geometric shadow is genuine edge diffraction.

For subspace membership outside an interface's `y` extent, `f(y)` is extended as a
constant at the endpoint `z` value — i.e. the blocker continues as an opaque screen at
that depth.

### 2.4 What this model deliberately does not do

State these in the UI (an info popover) so results are not over-interpreted:

- No back-propagation, no reflections, no multiple scattering between interfaces.
- No self-shadowing within one interface (as specified).
- No Fresnel transmission coefficients — supply them yourself via `A_j(y)` if wanted.
- Scalar only: no polarization, no TE/TM split.
- Evanescent fields only insofar as `H₀⁽¹⁾` carries them within ~λ of a source.
- A **complex refractive index** would be a cheap future add (absorbing media come free
  from `Im{k} > 0`), and is worth keeping in the data layout from day one.

---

## 3. Accuracy limits that must be surfaced in the UI

These are the three ways this simulator will silently produce a beautiful, wrong
picture. Each gets a live readout in the status bar and a warning when violated.

### 3.1 Interface / source sampling — Nyquist

Sample spacing must satisfy `Δs ≤ λ/(2·n_max)`; `λ/4` is comfortable. Coarser sampling
produces **spurious grating lobes** that look exactly like real diffraction orders.

Status bar shows `samples per λ`; warn below 2.

### 3.2 Display grid — carrier aliasing

The time-dependent and phase views render the carrier `e^{ikr}` itself, so the grid
needs ≥ 2 px/λ to be non-aliasing and ~4–8 px/λ to look right. The intensity view is
far more forgiving because `|U|²` of a single beam is smooth — but interference fringes
still need resolving.

Concretely: a 256×256 grid over a 1500-unit-wide viewport gives 5.9 units/px, so
**λ must be ≳ 12 units** for the time view. This is why the default is `λ₀ = 20` rather
than something physically evocative like 0.5 µm. Status bar shows `pixels per λ`.

### 3.3 float32 phase precision

The GPU computes `k·r` in float32 (~7 significant digits), so the absolute phase error
is roughly `10⁻⁷ · k·r` radians. At `k·r = 10⁵` (≈16 000 λ across the scene) that is
0.01 rad — invisible. At `10⁷` it is ~1 rad and the picture is garbage.

Practical limit: **keep the viewport within ~10⁴ wavelengths across**. Warn beyond that.
If we ever need more, the fix is compensated (float-float) summation for the phase, not
a switch to doubles.

---

## 4. Architecture

```
src/core/waveOptics/
  conventions.js            constants, unit helpers, k from λ and n
  hankel.js                 J0/Y0/J1/Y1 + H0/H1, as JS functions AND a GLSL source
                            string generated from one shared coefficient table
  waveSceneModel.js         Scene.objs -> ordered {subspaces, interfaces, sources};
                            z-ordering + single-valued-in-y validation, warnings
  sampling.js               arc-length resampling of curves, Δs, CPU evaluation of
                            A(·)/φ(·) via the existing formula parser
  spectrum.js               frequency decomposition for pulses (§5)
  WaveFieldEngineCpu.js     reference backend — no GL, runs in Node/jest
  WaveFieldEngineWebGL2.js  production GPU backend
  WaveSimulator.js          orchestration: model -> per-frequency chain -> field
                            textures -> display pass; caching and invalidation
  colormaps.js              twilight, magma, + Oklch bivariate; GLSL and JS LUTs

src/core/sceneObjs/wave/
  WavePointSource.js        click to place
  WaveLineSource.js         LineObjMixin; A(u), φ(u) equations, density multiplier
  WaveInterface.js          CurveObjMixin (allowOpen, forced open); n_after, A(y), φ(y)

src/waveApp/               separate entry point (§6)
```

### 4.1 GPU backend (WebGL2)

**WebGL2, not WebGL1.** The existing `FloatColorRenderer` uses WebGL1 +
`OES_texture_float`; we need `EXT_color_buffer_float` (render *to* float),
`texelFetch`, integer arithmetic and GLSL ES 3.00. WebGL2 support is universal enough
now, and it is considerably simpler than adapting the repo's WebGPU machinery, which is
tightly specialised to ray tracing. WebGPU stays open as a later backend.

**Source buffer layout** (two `RGBA32F` textures, one texel per source):
```
tex0: (x, y, Re w, Im w)          position and complex weight (Δs already folded in)
tex1: (nx, ny, kind, reserved)    forward normal; kind = isotropic | RS-kernel
```
`reserved` is where a complex-`k` imaginary part would go later.

**Pass structure per frequency component:**

1. **Chain passes** — for `j = 1…N`, sequentially: render an `M_j × 1` `RG32F` target;
   each fragment is one sample point on `I_j` and sums over `S_{j−1}`'s source buffer.
   The result is multiplied by `t_j(y_m)·Δs_m` (precomputed on the CPU) to become
   `S_j`'s interface source buffer.
2. **Field passes** — for each subspace `j`, one full-screen quad into the shared
   `RG32F` field texture, with `discard` for pixels not in `S_j`, summing over `S_j`'s
   sources (interface `I_j`'s secondary sources + primary sources placed in `S_j`).
3. **Display pass** — field texture → canvas, applying time phase, colormap and cutoffs.

**Subspace membership** is a 1D `R32F` LUT of `z(y)` per interface (1024 samples, built
on the CPU by rasterising the Bézier), plus its `y` extent and endpoint `z` values for
the constant extension. Per pixel: `N` texture lookups and comparisons.

**The field texture also stores `|U|`** in its third channel. The display pass magnifies
it with linear filtering, and interpolating a rapidly oscillating `Re`/`Im` pair and
*then* taking the magnitude loses amplitude between samples — halfway between two
samples 97° apart in phase the interpolated magnitude is only 0.66 of the true value.
That shows up as false rings at the *grid* pitch, which are easy to mistake for physics.
`|U|` is smooth, so interpolating it directly is well behaved. (Found while bringing up
M1: a single point source, whose intensity must be a featureless monotonic glow, was
rendering with ring artefacts.)

**The GL context needs `preserveDrawingBuffer: true`.** The field is drawn on demand
rather than once per frame, so the drawing buffer has to survive compositing; otherwise
the canvas can come back blank after a re-rasterisation with nothing having changed.

**Cost estimate.** Each pixel touches only its own subspace's sources, so the field
passes cost `≈ P × M_avg` Hankel evaluations. At 256² and 2000 sources that is 1.3·10⁸
evaluations ≈ 4 GFLOP — ~10–30 ms on a mid-range GPU. The chain passes cost
`Σ_j M_j·M_{j−1}` ≈ 1.6·10⁷ — negligible. 512² and 8000 sources is ~16× that and still
interactive.

### 4.2 Why animation is free

For a monochromatic source `U(r)` is time-independent. **The field is computed once and
cached in the float texture; animation re-runs only the display pass.** 60 fps is
trivial regardless of source count. This is the single most important performance
property of the design, and it shapes the caching layer: invalidate the field texture on
geometry/parameter/view change, never on a time step.

### 4.3 Recompute triggers and progressive refinement

The grid is viewport-aligned, so pan and zoom invalidate it. To keep dragging smooth:
render at ¼ resolution during interaction, full resolution after a ~150 ms idle debounce.

A later option worth keeping in mind: pin the compute domain to a scene-space rectangle
instead of the viewport, which makes pan/zoom free (just resample the texture) at the
cost of an explicit "simulation region" object to manage.

### 4.4 CPU reference backend

`WaveFieldEngineCpu.js` implements the identical math in plain JS. It is slow and that is
fine — it exists so the physics can be unit-tested in jest without a GL context, and so
the GPU backend has something to be validated against. Both backends are driven through
the same interface by `WaveSimulator`.

---

## 5. Time-dependent sources (pulses)

Architected in from the start even though phase 1 only exposes a single frequency:

**every computation is parameterised by a single frequency component**, and a source is
a list of `(ω_m, complex weight c_m)` pairs. A pulse is then:

```
U(r, t) = Σ_m c_m · U_{ω_m}(r) · e^{-i ω_m t}
```

- Run the whole chain once per frequency → `N_f` cached field textures (a
  `TEXTURE_2D_ARRAY`).
- The display pass sums `N_f` terms per pixel per frame. At `N_f = 16` and 256² that is
  ~10⁶ fetches per frame — still trivially real-time.
- Gaussian pulse parametrisation: centre λ, bandwidth, `N_f` components (default 16).
  Note the group delay: the pulse arrives at `z` at `t ≈ n·z/c`, so the time axis needs
  a sensible default range derived from the scene extent.
- This same machinery gives **polychromatic / partially coherent** sources later, by
  summing intensities instead of amplitudes across components.

Cost is linear in `N_f` for the field computation, which is the honest trade-off to show
in the UI.

---

## 6. App integration (separate entry point)

### 6.1 Build

`webpack.config.mjs` currently has one entry. Add a second:

```js
entry: {
  simulator: './src/app/main.js',
  wave:      './src/waveApp/main.js',
}
```
plus a second `HtmlWebpackPlugin` emitting `wave/index.html` with `chunks: ['wave']`,
and `output.filename: '[name]/main.js'`. `dist/simulator/` is unchanged.

### 6.2 What is reused verbatim

`Scene`, `Editor`, `geometry`, the formula/equation stack, `CanvasRenderer`, the Vue
stores (`scene`, `preferences`, `status`, `theme`), `ObjBar`, `Sidebar` / `PropertyList`
and all of `sidebar/controls/*`, `toolbar/controls/*`, `SaveModal`, `LanguageModal`,
`StatusArea`, `Footer`. Serialization, undo/redo, URL sharing and snap-to-grid come for
free from `Scene` + `Editor`.

### 6.3 What is new

`src/waveApp/` gets its own `main.js`, `index.html`, `App.vue`, `CanvasContainer.vue`
(a `canvasWave` WebGL2 layer replacing the three ray light layers) and a purpose-built
`services/waveApp.js`.

**On `services/app.js`**: it is ~1600 lines and mostly generic (file open/save, URL
sync, editor wiring, undo, welcome, rename); only the simulator factory and a few
engine-selection bits are ray-specific. Extracting a shared `appCore.js` is the tidy
option but touches upstream code heavily, which cuts against the isolation you chose the
separate entry point for. **Recommendation: start with a lean purpose-built
`waveApp.js` (~300 lines) that covers only what the wave app needs, and extract shared
helpers opportunistically once both sides have stabilised.**

### 6.4 New UI controls

- **Tools**: Point source, Line source, Interface — plus the reused decorations
  (Ruler, Protractor, Text label, Line arrow).
- **View**: Time-dependent / Intensity / Amplitude-phase (replaces the ray View bar).
- **Source density** slider (reusing the `RayDensityBar` pattern), in samples per unit
  length, with the derived samples/λ shown in the status bar.
- **Grid resolution**: 128² / 256² (default) / 512² / 1024² / viewport.
- **Colormap**: picker + min/max cutoff sliders, log toggle for intensity,
  percentile auto-scale button.
- **λ₀**, **background index n₀**.
- **Animation**: play/pause, speed, time scrub.
- **Status bar**: source count, interface sample count, samples/λ, pixels/λ, compute
  time, and the warnings from §3.

### 6.5 Display: colormaps

- **Time-dependent** → **twilight** (default). Cyclic, so `−max` and `+max` meet, which
  suits an oscillating signed field well. Also offer coolwarm / RdBu.
- **Intensity** → **magma** (default). Plus viridis, inferno, gray. Log/dB toggle.
- **Amplitude-phase** → bivariate in **Oklch**: hue = phase, amplitude driving `L` and
  `C` together along a path chosen to stay inside sRGB. Gamut mapping by reducing `C`
  until in gamut (binary search in the shader, ~8 iterations). Oklch is used in place of
  CIE LCh for its better perceptual uniformity and cheaper gamut handling; the
  construction is otherwise identical.
- All colormaps ship as 256-entry LUT textures generated at build time from the
  matplotlib data, so GLSL and the JS reference agree exactly.

---

## 7. Tests

The CPU backend is the reference; these are jest tests under `test/waveOptics/`:

1. **`hankel.test.js`** — `J₀/Y₀/J₁/Y₁` against known values across `kr ∈ [10⁻³, 10³]`,
   and continuity across the `kr = 3` branch switch.
2. **`freeSpace.test.js`** — *the normalization test*. Propagating a point source
   through a full-height, `t = 1`, index-matched interface must reproduce the analytic
   `H₀⁽¹⁾` field to < 1%. This is what pins down the `Δs`, `cos θ` and `ik/2` factors.
3. **`singleSlit.test.js`** — far-field pattern of a slit matches `sinc²` within
   tolerance; also confirms the finite-length-interface-as-blocker behaviour.
4. **`lens.test.js`** — an interface with `t(y) = exp(−i k₀ y²/(2f))` focuses at `z = f`
   with the expected spot size, and a two-interface glass slab refracts per Snell.
5. **`sampling.test.js`** — the field converges as source density rises and is stable
   thereafter (the property that the `Δs` weighting buys).
6. **`waveSceneModel.test.js`** — z-ordering, single-valued-in-y validation, and the
   warnings.

A headless-GL test of the WebGL2 backend is not worth the setup cost; instead add a
manual comparison page that renders CPU and GPU results side by side.

---

## 8. Milestones

Each milestone ends with something visible and runnable.

**M0 — Scaffolding. ✅ Done.** Second webpack entry (`dist/wave/`), `src/waveApp/` shell,
WebGL2 field canvas layer, `WaveSimulator` wired to `Editor`.

**M1 — Minimal working core. ✅ Done.** `WavePointSource`; homogeneous space with
scene-level `λ` and `n`; the WebGL2 field kernel; intensity (magma) *and* instantaneous
field (twilight) views; colormap picker, percentile colour scale with saturation/floor
cutoffs and a log/dB option; grid resolution 64–1024 with progressive refinement during
interaction; animation transport. Verified in headless Chrome: a single source renders as
a smooth `|H₀(kr)|²` glow, and two sources 7λ apart give the textbook 15 far-field maxima.
Tests: 42 covering the Hankel functions against scipy, the field summation against the
analytic Green's function, two-slit fringe positions, and the colormap tables.

*The instantaneous-field view and the animation transport were pulled forward from M2:
once the field texture exists they cost only a display shader, and they exercise the
"animation is free" claim early.*

**M2 — Amplitude-phase view. ✅ Done.** The bivariate Oklch view: hue = phase, lightness
= amplitude, chroma following an envelope that vanishes at both ends where sRGB has no
room for it, with an 8-step in-shader binary search reducing chroma until the colour is
representable. Lightness and hue are preserved exactly, so both readings stay faithful.
A phase wheel in the toolbar serves as the legend. The rest of the original M2 — the
time-dependent view, the animation loop, the colormap picker, log intensity and the
percentile auto-scale — landed with M1.

*The "comfortable" grid-density threshold is now view-dependent: the amplitude-phase
view wants 8 samples per wavelength where the others want 4, because hue wraps once per
wavelength and turns to colour noise well before a twilight-mapped real field looks
wrong.*

**M3 — Line sources. ✅ Done.** `WaveLineSource`, drawn by dragging, with `A(u)` and
`φ(u)` as LaTeX equations in the arc length from the line's centre. A scene-level source
density in **samples per wavelength** (not per unit length, so it stays meaningful when
λ changes), the `Δu` weighting, and Nyquist warnings. A source budget caps the total
point count by lowering the density uniformly rather than truncating the source list,
which would silently delete part of a source.

Verified: a linear phase ramp steers the far field to the predicted angle; a quadratic
ramp focuses, with the peak at the Fresnel-shifted position and a waist of 36 units
against the diffraction limit `λf/2a` = 30.

**M4 — Interfaces and subspaces.** `WaveInterface` as an open Bézier curve; z-ordering
validation; per-subspace refractive index; the chained RS propagation; `t(y)`; subspace
membership LUTs and per-subspace draw passes; interface rendering on the overlay layer.
*This is the largest milestone and the one that makes it a wave-optics simulator rather
than a point-source plotter.*

**M5 — Pulses.** Frequency decomposition, per-component cached field textures, animated
recombination, Gaussian pulse UI.

**M6 — Polish and performance.** Progressive resolution during pan/zoom, full status-bar
instrumentation, sample scenes (single slit, double slit, lens, prism), save/load and
URL sharing verified, docs.

Tests land with the milestone they cover, not at the end.

---

## 9. Deferred / out of scope for now

- **Areas** of point sources (explicitly deferred in the spec).
- Reflections, back-propagation, multiple scattering between interfaces.
- Self-shadowing within an interface.
- Polarization, Fresnel coefficients, TE/TM.
- Complex refractive index (absorbing media) — cheap, and the data layout leaves room.
- Angular-spectrum (FFT) propagation for the plane-interface case, which would be far
  faster than the `O(M²)` sum when interfaces are flat and full-height.
- Non-monotonic / closed interface curves.
- WebGPU backend.
