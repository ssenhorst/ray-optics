/*
 * Copyright 2026 The Wave Optics Simulation authors and contributors
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
 * @file Conventions and derived quantities shared by every part of the
 * wave-optics simulator.
 *
 * Conventions fixed here, because every formula in this directory depends on
 * them:
 *
 * - Time dependence is `e^{-i w t}`, so outgoing waves carry `e^{+ikr}` and the
 *   displayed instantaneous field is `Re{ U e^{-i w t} }`.
 * - The optical axis `z` is the canvas `+x` direction (light travels left to
 *   right); the transverse coordinate `y` is the canvas `+y` direction.
 * - The wavelength is measured in *scene length units*, not nanometres. Unlike
 *   the ray simulator, where the wavelength only selects a colour, here it is a
 *   geometric quantity and has to live on the same ruler as the canvas.
 * - `U` is a complex scalar. There is no polarization.
 */

/**
 * Default vacuum wavelength, in scene length units.
 *
 * This is deliberately large. The instantaneous-field view renders the carrier
 * itself, so it needs several grid samples per wavelength; at the default
 * 256-sample grid over a ~1500 unit wide viewport a wavelength much below ~12
 * units aliases. See {@link samplingDiagnostics}.
 */
export const DEFAULT_WAVELENGTH = 20;

/** Default refractive index of the space containing the sources. */
export const DEFAULT_REFRACTIVE_INDEX = 1;

/**
 * The near-source clamp, as a fraction of the wavelength in the medium.
 *
 * `Y0` diverges logarithmically at the origin, so the radius is clamped. The
 * clamp is expressed in wavelengths rather than in absolute units so that it
 * scales correctly when the wavelength or the refractive index changes: the
 * clamped argument `k r_min` is always `2 pi / 100`, independent of both.
 */
export const MIN_RADIUS_IN_WAVELENGTHS = 0.01;

/** Default grid resolution when the automatic ladder is turned off. */
export const DEFAULT_GRID_RESOLUTION = 512;

/**
 * Default sampling density of extended sources, in samples per wavelength in
 * the medium. Four is the Nyquist limit for a source that radiates into a half
 * space; eight leaves comfortable margin.
 */
export const DEFAULT_SOURCE_DENSITY = 8;

/**
 * Minimum samples per wavelength on an extended source. Below the Nyquist limit
 * of two the sampled line behaves like a grating and radiates spurious orders
 * that look exactly like real diffraction.
 */
export const MIN_SAMPLES_PER_WAVELENGTH = 2;

/** Samples per wavelength below which extended sources are merely coarse. */
export const COMFORTABLE_SAMPLES_PER_WAVELENGTH = 4;

/**
 * The total number of point sources the field pass will sum over. The cost is
 * this count times the number of grid samples, so it is the one number that can
 * make the simulation unresponsive. When a scene asks for more, the density is
 * scaled down uniformly rather than the source list being truncated, which
 * would silently delete part of a source.
 */
export const MAX_SOURCES = 20000;

/**
 * Minimum grid samples per wavelength before the instantaneous-field and phase
 * views alias. Two is the Nyquist limit; below it the picture is meaningless.
 */
export const MIN_PIXELS_PER_WAVELENGTH = 2;

/** Grid samples per wavelength below which the rendering is merely coarse rather than wrong. */
export const COMFORTABLE_PIXELS_PER_WAVELENGTH = 4;

/**
 * The same threshold for the amplitude-phase view, which is markedly more
 * demanding. Hue wraps once per wavelength, and a hue cycle spread over three
 * or four samples reads as colour noise long before a twilight-mapped real
 * field would look wrong.
 */
export const COMFORTABLE_PIXELS_PER_WAVELENGTH_PHASE = 8;

/**
 * The grid density a view wants before it stops looking coarse.
 * @param {string} view - 'intensity', 'field' or 'amplitudePhase'.
 * @returns {number}
 */
export function comfortablePixelsPerWavelength(view) {
  return view === 'amplitudePhase'
    ? COMFORTABLE_PIXELS_PER_WAVELENGTH_PHASE
    : COMFORTABLE_PIXELS_PER_WAVELENGTH;
}

/**
 * The largest `k r` that float32 can carry without the phase degrading. The
 * relative error of a float32 product is about 6e-8, so at `k r = 1e6` the
 * absolute phase error approaches 0.06 rad and keeps growing from there.
 */
export const MAX_RELIABLE_PHASE = 1e6;

/**
 * The available field views: the time-averaged intensity, the instantaneous
 * real field, and the bivariate amplitude-and-phase rendering.
 */
export const FIELD_VIEWS = ['intensity', 'field', 'amplitudePhase'];

/**
 * The angular wavenumber in a medium.
 * @param {number} wavelength - The vacuum wavelength in scene length units.
 * @param {number} refractiveIndex - The refractive index of the medium.
 * @returns {number}
 */
export function wavenumber(wavelength, refractiveIndex = 1) {
  return 2 * Math.PI * refractiveIndex / wavelength;
}

/**
 * The wavelength inside a medium.
 * @param {number} wavelength - The vacuum wavelength in scene length units.
 * @param {number} refractiveIndex - The refractive index of the medium.
 * @returns {number}
 */
export function wavelengthInMedium(wavelength, refractiveIndex = 1) {
  return wavelength / refractiveIndex;
}

/**
 * The radius at which the logarithmic singularity of the Green's function is
 * clamped.
 * @param {number} wavelength - The vacuum wavelength in scene length units.
 * @param {number} refractiveIndex - The refractive index of the medium.
 * @returns {number}
 */
export function minimumRadius(wavelength, refractiveIndex = 1) {
  return MIN_RADIUS_IN_WAVELENGTHS * wavelengthInMedium(wavelength, refractiveIndex);
}

/**
 * @typedef {Object} SamplingDiagnostics
 * @property {number} pixelsPerWavelength - Grid samples per wavelength in the medium.
 * @property {number} samplesPerWavelength - Source samples per wavelength actually used.
 * @property {number} maxPhase - The largest `k r` the computation will reach.
 * @property {number} comfortablePixels - Grid density the active view wants.
 * @property {boolean} isAliasing - Whether the grid is below the Nyquist limit.
 * @property {boolean} isCoarse - Whether the grid resolves the carrier only marginally.
 * @property {boolean} isSourceUndersampled - Whether sources are below the Nyquist limit.
 * @property {boolean} isSourceCoarse - Whether source sampling is merely marginal.
 * @property {boolean} isPhaseUnreliable - Whether float32 can still carry the phase.
 */

/**
 * Report whether the current settings can actually represent the field, so the
 * UI can warn instead of silently drawing a convincing but wrong picture.
 *
 * There are two distinct sampling rates here and they fail differently. The
 * display grid, if too coarse, aliases the carrier into a moire pattern. The
 * source sampling, if too coarse, turns a continuous source into a grating that
 * radiates real-looking spurious orders.
 *
 * @param {Object} options
 * @param {number} options.gridSpacing - Scene length units between grid samples.
 * @param {number} options.wavelength - The vacuum wavelength in scene length units.
 * @param {number} options.refractiveIndex - The largest refractive index in the scene.
 * @param {number} options.sceneExtent - The diagonal of the computed region, in scene units.
 * @param {number} [options.samplesPerWavelength] - Effective source sampling density.
 * @param {string} [options.view] - The active field view, which sets how much
 *   grid density counts as comfortable.
 * @returns {SamplingDiagnostics}
 */
export function samplingDiagnostics({
  gridSpacing, wavelength, refractiveIndex = 1, sceneExtent = 0,
  samplesPerWavelength = DEFAULT_SOURCE_DENSITY, view = 'intensity'
}) {
  const mediumWavelength = wavelengthInMedium(wavelength, refractiveIndex);
  const pixelsPerWavelength = mediumWavelength / gridSpacing;
  const maxPhase = wavenumber(wavelength, refractiveIndex) * sceneExtent;
  const comfortablePixels = comfortablePixelsPerWavelength(view);

  return {
    pixelsPerWavelength,
    samplesPerWavelength,
    comfortablePixels,
    maxPhase,
    isAliasing: pixelsPerWavelength < MIN_PIXELS_PER_WAVELENGTH,
    isCoarse: pixelsPerWavelength < comfortablePixels,
    isSourceUndersampled: samplesPerWavelength < MIN_SAMPLES_PER_WAVELENGTH,
    isSourceCoarse: samplesPerWavelength < COMFORTABLE_SAMPLES_PER_WAVELENGTH,
    isPhaseUnreliable: maxPhase > MAX_RELIABLE_PHASE,
  };
}
