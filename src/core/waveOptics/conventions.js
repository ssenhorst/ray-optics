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

/** Grid resolutions offered in the UI, as samples across the longer viewport axis. */
export const GRID_RESOLUTIONS = [64, 128, 256, 512, 1024];

/** Default grid resolution. */
export const DEFAULT_GRID_RESOLUTION = 256;

/** The resolution used while the user is dragging, panning or zooming. */
export const INTERACTIVE_GRID_RESOLUTION = 96;

/**
 * Minimum grid samples per wavelength before the instantaneous-field and phase
 * views alias. Two is the Nyquist limit; below it the picture is meaningless.
 */
export const MIN_PIXELS_PER_WAVELENGTH = 2;

/** Grid samples per wavelength below which the rendering is merely coarse rather than wrong. */
export const COMFORTABLE_PIXELS_PER_WAVELENGTH = 4;

/**
 * The largest `k r` that float32 can carry without the phase degrading. The
 * relative error of a float32 product is about 6e-8, so at `k r = 1e6` the
 * absolute phase error approaches 0.06 rad and keeps growing from there.
 */
export const MAX_RELIABLE_PHASE = 1e6;

/** The available field views. */
export const FIELD_VIEWS = ['intensity', 'field'];

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
 * @property {number} maxPhase - The largest `k r` the computation will reach.
 * @property {boolean} isAliasing - Whether the grid is below the Nyquist limit.
 * @property {boolean} isCoarse - Whether the grid resolves the carrier only marginally.
 * @property {boolean} isPhaseUnreliable - Whether float32 can still carry the phase.
 */

/**
 * Report whether the current settings can actually represent the field, so the
 * UI can warn instead of silently drawing a convincing but wrong picture.
 *
 * @param {Object} options
 * @param {number} options.gridSpacing - Scene length units between grid samples.
 * @param {number} options.wavelength - The vacuum wavelength in scene length units.
 * @param {number} options.refractiveIndex - The largest refractive index in the scene.
 * @param {number} options.sceneExtent - The diagonal of the computed region, in scene units.
 * @returns {SamplingDiagnostics}
 */
export function samplingDiagnostics({
  gridSpacing, wavelength, refractiveIndex = 1, sceneExtent = 0
}) {
  const mediumWavelength = wavelengthInMedium(wavelength, refractiveIndex);
  const pixelsPerWavelength = mediumWavelength / gridSpacing;
  const maxPhase = wavenumber(wavelength, refractiveIndex) * sceneExtent;

  return {
    pixelsPerWavelength,
    maxPhase,
    isAliasing: pixelsPerWavelength < MIN_PIXELS_PER_WAVELENGTH,
    isCoarse: pixelsPerWavelength < COMFORTABLE_PIXELS_PER_WAVELENGTH,
    isPhaseUnreliable: maxPhase > MAX_RELIABLE_PHASE,
  };
}
