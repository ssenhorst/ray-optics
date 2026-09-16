# `src/waveApp`

The wave-optics simulator, built by webpack into `dist/wave/` alongside the ray
simulator in `dist/simulator/`. Run it with `npm start` and open `/wave/`.

It shares the core library with the ray simulator — `Scene`, `Editor`, the
geometry helpers and the object bar — so editing, dragging, zooming, undo and
the scene file format behave the same way. What is replaced is the simulation
core: instead of tracing rays, it sums the fields of 2D point sources.

The physics lives in [`src/core/waveOptics`](../core/waveOptics); this directory
is only the app shell.

- `main.js` — the entry point.
- `index.html` — the page.
- `services/waveApp.js` — the glue between the core library and the Vue UI:
  canvases, simulator, editor, object bar, file loading. Deliberately a lean
  counterpart to `src/app/services/app.js` rather than a refactor of it, since
  the ray app's engine selection, colour modes and export paths do not apply.
- `store/wave.js` — a Vue store over `scene.waveOptics`, plus the transient view
  state (time, animation, tool) that is intentionally not saved with the scene.
- `components/` — the toolbar, canvas stack, object bar and status area.
- `exampleScenes.js` — the worked examples in the toolbar, built against the
  current viewport so each one fills the window it is loaded into.

## What it models

A scalar field `U` in two dimensions, time-harmonic with `e^{-i w t}`. The
optical axis `z` is the canvas `+x` direction and the transverse coordinate `y`
is the canvas `+y`.

Interfaces divide space into an ordered stack of subspaces, each with its own
refractive index. The field in a subspace is the sum of the sites on the
interface preceding it, which re-radiate what reached them through the
Rayleigh-Sommerfeld kernel, plus whatever sources sit inside it. Refraction is
not implemented as a rule: it emerges from sampling the incident field on a
surface and re-radiating it with the wavenumber of the medium beyond.

Wavelengths are in **scene length units**, not nanometres. Unlike the ray
simulator, where the wavelength only picks a colour, here it is a geometric
quantity and has to live on the same ruler as the canvas.

Deliberately not modelled: reflections, back-propagation, multiple scattering
between interfaces, self-shadowing within one interface, Fresnel transmission
coefficients (supply them through an interface's `|t|(y)` if wanted), and
polarization.

## Reading the status bar

An undersampled field still renders as a plausible-looking picture, so the
status bar reports what the settings can actually represent:

- **px/λ** — grid samples per wavelength. Below 2 the instantaneous-field and
  amplitude-phase views alias; the amplitude-phase view wants 8 or more, since
  hue wraps once per wavelength.
- **samples/λ** — sampling density on line sources and interfaces. Below 2 a
  sampled line behaves like a grating and radiates spurious orders that look
  exactly like real diffraction.

Both of these produce warnings rather than silent failure. The scene extent is
also checked: past about 10⁴ wavelengths across, float32 can no longer carry the
phase.

## Testing

`npm run test:waveOptics` runs the suite in `test/waveOptics`. The physics is
checked against closed-form results rather than against itself: the Hankel
functions against tabulated values, the propagation kernel against the analytic
Green's function, slit diffraction against `sinc²`, and refraction against
Snell's law.
