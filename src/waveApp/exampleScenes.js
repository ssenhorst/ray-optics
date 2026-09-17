/*
 * Copyright 2026 The Ray Optics Simulation authors and contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * @file The worked examples offered in the toolbar.
 *
 * They are built against the current viewport rather than stored at fixed
 * coordinates, so each one fills the window it is loaded into instead of
 * arriving half off-screen on a smaller display.
 *
 * Each is also a readable demonstration of how the scene objects are meant to
 * be combined, which is the quickest way to learn what the equation fields
 * accept.
 */

/** The wavelength every example uses, in scene length units. */
const WAVELENGTH = 20;

/** The wavenumber in vacuum at that wavelength. */
const K = 2 * Math.PI / WAVELENGTH;

const round = (value) => Math.round(value * 1e6) / 1e6;

/** A phase ramp that steers radiation to a given angle. */
const steerPhase = (variable, degrees) =>
  `${round(K * Math.sin(degrees * Math.PI / 180))}\\cdot ${variable}`;

/** A quadratic phase that converges at a given distance. */
const focusPhase = (variable, distance) =>
  `-${round(K / (2 * distance))}\\cdot ${variable}^2`;

const pointSource = (x, y, extra = {}) =>
  ({ type: 'WavePointSource', x: round(x), y: round(y), amplitude: 1, ...extra });

const lineSource = (x, y0, y1, extra = {}) => ({
  type: 'WaveLineSource',
  p1: { x: round(x), y: round(y0) },
  p2: { x: round(x), y: round(y1) },
  amplitude: 1,
  ...extra,
});

const planeWave = (x, y, angle = 0) =>
  ({ type: 'WavePlaneWave', x: round(x), y: round(y), angle, amplitude: 1 });

const element = (type, x, y0, y1, extra = {}) => ({
  type,
  p1: { x: round(x), y: round(y0) },
  p2: { x: round(x), y: round(y1) },
  refractiveIndexAfter: 1,
  ...extra,
});

const interface_ = (x, y0, y1, extra = {}) => element('WaveInterface', x, y0, y1, extra);

/**
 * Wrap objects into a loadable scene.
 * @param {string} name
 * @param {Array<Object>} objs
 * @param {Object} waveOptics
 * @returns {Object}
 */
const build = (name, objs, waveOptics) => ({
  version: 5,
  name,
  objs,
  origin: { x: 0, y: 0 },
  scale: 1,
  waveOptics: {
    wavelength: WAVELENGTH,
    refractiveIndex: 1,
    sourceDensity: 8,
    gridResolution: 512,
    view: 'intensity',
    ...waveOptics,
  },
});

/**
 * The available examples.
 *
 * Each entry builds its scene from the viewport size in scene units.
 * @type {Array<{id: string, name: string, description: string, build: function}>}
 */
export const EXAMPLE_SCENES = [
  {
    id: 'twoPointSources',
    name: 'Two point sources',
    description: 'Interference between two coherent point sources.',
    build: (width, height) => build('Two point sources', [
      pointSource(width * 0.35, height * 0.5 - 3.5 * WAVELENGTH),
      pointSource(width * 0.35, height * 0.5 + 3.5 * WAVELENGTH),
    ], { view: 'field', gridResolution: 1024 }),
  },
  {
    id: 'singleSlit',
    name: 'Single slit',
    description: 'A point source behind an opaque screen with one narrow opening.',
    build: (width, height) => build('Single slit', [
      pointSource(width * 0.16, height * 0.5),
      // The spacing does nothing at one slit, but it is what raising the count
      // will use, so it is set wide enough here to give real fringes.
      element('WaveMultiSlit', width * 0.38, height * 0.28, height * 0.72, {
        slitCount: 1, slitWidth: 3 * WAVELENGTH, slitSpacing: 9 * WAVELENGTH,
      }),
    ], { upperCutoff: 0.8 }),
  },
  {
    id: 'doubleSlit',
    name: 'Double slit',
    description: "Young's experiment: one screen with two openings.",
    build: (width, height) => build('Double slit', [
      pointSource(width * 0.12, height * 0.5),
      element('WaveMultiSlit', width * 0.34, height * 0.22, height * 0.78, {
        slitCount: 2, slitWidth: 1.5 * WAVELENGTH, slitSpacing: 6 * WAVELENGTH,
      }),
    ], { upperCutoff: 0.7 }),
  },
  {
    id: 'fiveSlits',
    name: 'Five slits',
    description: 'More slits sharpen the fringes without moving them.',
    build: (width, height) => build('Five slits', [
      planeWave(width * 0.1, height * 0.5),
      element('WaveMultiSlit', width * 0.3, height * 0.28, height * 0.72, {
        slitCount: 5, slitWidth: 0.7 * WAVELENGTH, slitSpacing: 3.5 * WAVELENGTH,
      }),
    ], { upperCutoff: 0.7 }),
  },
  {
    id: 'grating',
    name: 'Diffraction grating',
    description: 'A plane wave on a square grating, splitting into diffraction orders.',
    build: (width, height) => build('Diffraction grating', [
      planeWave(width * 0.1, height * 0.5),
      element('WaveSquareGrating', width * 0.3, height * 0.15, height * 0.85, {
        pitch: 3 * WAVELENGTH, dutyCycle: 0.5,
      }),
    ], { upperCutoff: 2.2 }),
  },
  {
    id: 'zonePlate',
    name: 'Fresnel zone plate',
    description: 'Zones alternating every half wave of path bring a plane wave to a focus.',
    build: (width, height) => build('Fresnel zone plate', [
      planeWave(width * 0.08, height * 0.5),
      element('WaveZonePlate', width * 0.22, height * 0.22, height * 0.78, {
        focalLength: width * 0.42, phaseReversing: true,
      }),
    ], { upperCutoff: 1.1 }),
  },
  {
    id: 'lens',
    name: 'Lens',
    description: 'A collimated beam brought to a focus by a quadratic phase profile.',
    build: (width, height) => {
      const halfHeight = height * 0.22;
      const lensX = width * 0.35;
      return build('Lens', [
        planeWave(width * 0.1, height * 0.5),
        interface_(
          lensX, height * 0.5 - halfHeight, height * 0.5 + halfHeight,
          { eqnPhase: focusPhase('y', width * 0.32) }
        ),
      ], { upperCutoff: 3 });
    },
  },
  {
    id: 'refraction',
    name: 'Refraction',
    description: 'A tilted beam crossing into a denser medium, bending towards the normal.',
    build: (width, height) => build('Refraction', [
      lineSource(
        width * 0.08, height * 0.26, height * 0.68,
        { eqnPhase: steerPhase('u', 30) }
      ),
      interface_(width * 0.35, -height, height * 2, { refractiveIndexAfter: 1.6 }),
    ], { upperCutoff: 1.4 }),
  },
  {
    id: 'slab',
    name: 'Glass slab',
    description: 'Two interfaces: the beam is displaced but leaves at its original angle.',
    build: (width, height) => build('Glass slab', [
      lineSource(
        width * 0.06, height * 0.27, height * 0.67,
        { eqnPhase: steerPhase('u', 35) }
      ),
      interface_(width * 0.28, -height, height * 2, { refractiveIndexAfter: 1.7 }),
      interface_(width * 0.55, -height, height * 2, { refractiveIndexAfter: 1 }),
    ], { upperCutoff: 1.4 }),
  },
  {
    id: 'curvedSurface',
    name: 'Curved surface',
    description: 'A collimated beam refracted by the shape of a glass surface, with no phase plate.',
    build: (width, height) => {
      // A single refracting surface with a collimated input focuses at
      // n2 R / (n2 - n1) beyond it, so R is chosen to put the focus on screen.
      // The sag is positive: the vertex is nearest the source and the edges sit
      // further along the axis, which is a surface convex towards the source.
      //
      // This example halves the wavelength. How tight a focus can be is set by
      // the Fresnel number, and at the default wavelength the aperture is only
      // about six wavelengths across, which smears the focus over most of the
      // view. The shorter wavelength buys a recognisable one while still
      // leaving roughly seven grid samples per wavelength.
      const index = 1.5;
      const radius = width * 0.15;
      const halfHeight = height * 0.14;
      const surfaceX = width * 0.25;
      return build('Curved surface', [
        lineSource(width * 0.06, height * 0.5 - halfHeight * 0.85, height * 0.5 + halfHeight * 0.85),
        interface_(
          surfaceX, height * 0.5 - halfHeight, height * 0.5 + halfHeight,
          {
            refractiveIndexAfter: index,
            eqnSag: `${round(1 / (2 * radius))}\\cdot y^2`,
          }
        ),
      ], { wavelength: 10, gridResolution: 1024, upperCutoff: 3 });
    },
  },
  {
    id: 'beamSteering',
    name: 'Beam steering',
    description: 'A phase ramp along a line source aims the radiation off-axis.',
    build: (width, height) => build('Beam steering', [
      lineSource(
        width * 0.12, height * 0.2, height * 0.8,
        { eqnPhase: steerPhase('u', 20) }
      ),
    ], { view: 'amplitudePhase', gridResolution: 1024 }),
  },
];

/**
 * Build one example for the current viewport.
 *
 * @param {string} id
 * @param {number} width - Viewport width in scene length units.
 * @param {number} height - Viewport height in scene length units.
 * @returns {string|null} The scene as JSON, or null if the id is unknown.
 */
export function buildExampleScene(id, width, height) {
  const example = EXAMPLE_SCENES.find((entry) => entry.id === id);
  if (!example) return null;
  return JSON.stringify(example.build(width, height));
}
