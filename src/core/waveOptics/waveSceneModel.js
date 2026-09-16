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
 * @file Turns a {@link Scene} into the flat description the field engines
 * consume, and works out the sampling grid.
 *
 * At this stage the model is a single homogeneous subspace. When interfaces
 * arrive it grows into an ordered stack of subspaces, but the grid layout and
 * the source-collection protocol below stay as they are.
 */

import {
  DEFAULT_WAVELENGTH, DEFAULT_REFRACTIVE_INDEX, DEFAULT_GRID_RESOLUTION,
  samplingDiagnostics
} from './conventions.js';

/**
 * @typedef {Object} WaveSource
 * @property {number} x - Position along the optical axis, in scene units.
 * @property {number} y - Transverse position, in scene units.
 * @property {number} re - Real part of the complex weight.
 * @property {number} im - Imaginary part of the complex weight.
 */

/**
 * @typedef {Object} FieldGrid
 * @property {number} width - Samples across the grid.
 * @property {number} height - Samples down the grid.
 * @property {number} originX - Scene x of the first sample's centre.
 * @property {number} originY - Scene y of the first sample's centre.
 * @property {number} stepX - Scene x per sample; positive.
 * @property {number} stepY - Scene y per sample; negative, see below.
 * @property {number} spacing - The larger of the two step magnitudes.
 * @property {number} extent - The diagonal of the covered region, in scene units.
 */

/**
 * Resolve a scene's wave-optics settings, filling in anything missing.
 * @param {Scene} scene
 * @returns {Object}
 */
export function resolveWaveSettings(scene) {
  const stored = scene?.waveOptics ?? {};
  return {
    wavelength: positiveOr(stored.wavelength, DEFAULT_WAVELENGTH),
    refractiveIndex: positiveOr(stored.refractiveIndex, DEFAULT_REFRACTIVE_INDEX),
    gridResolution: positiveOr(stored.gridResolution, DEFAULT_GRID_RESOLUTION),
    view: stored.view ?? 'intensity',
    intensityColormap: stored.intensityColormap ?? 'magma',
    fieldColormap: stored.fieldColormap ?? 'twilight',
    scalePercentile: clamp(stored.scalePercentile ?? 99, 1, 100),
    upperCutoff: positiveOr(stored.upperCutoff, 1),
    lowerCutoff: clamp(stored.lowerCutoff ?? 0, 0, 0.999),
    logScale: Boolean(stored.logScale),
    dynamicRange: positiveOr(stored.dynamicRange, 40),
  };
}

/**
 * Collect every wave source contributed by the objects in a scene.
 *
 * Objects opt in by implementing `getWaveSources`, which keeps the ray-only
 * scene objects inert here without needing a type check per class.
 *
 * @param {Scene} scene
 * @param {Object} context - Passed through to each object.
 * @returns {WaveSource[]}
 */
export function collectWaveSources(scene, context = {}) {
  const sources = [];
  for (const obj of scene.objs ?? []) {
    if (typeof obj?.getWaveSources !== 'function') continue;
    const contributed = obj.getWaveSources(context);
    if (!contributed) continue;
    for (const source of contributed) {
      if (Number.isFinite(source.x) && Number.isFinite(source.y) &&
        Number.isFinite(source.re) && Number.isFinite(source.im)) {
        sources.push(source);
      }
    }
  }
  return sources;
}

/**
 * Lay out the sampling grid over the current viewport.
 *
 * The grid is viewport-aligned, so the requested resolution counts samples
 * across the *longer* viewport axis and the shorter axis follows from the
 * aspect ratio. That keeps the samples square, which is what the aliasing
 * diagnostics assume.
 *
 * `stepY` is negative: WebGL row 0 is the bottom of the framebuffer, which is
 * the bottom of the screen, which is the *largest* scene y (scene y grows
 * downward). Encoding the flip in the step means the field pass and the
 * display pass agree without either of them flipping a texture coordinate.
 *
 * @param {Scene} scene
 * @param {number} resolution - Samples across the longer viewport axis.
 * @returns {FieldGrid}
 */
export function computeFieldGrid(scene, resolution) {
  const viewportWidth = Math.max(1, scene.width);
  const viewportHeight = Math.max(1, scene.height);
  const scale = scene.scale || 1;

  const samples = Math.max(2, Math.round(resolution));
  const isLandscape = viewportWidth >= viewportHeight;
  const width = isLandscape
    ? samples
    : Math.max(2, Math.round(samples * viewportWidth / viewportHeight));
  const height = isLandscape
    ? Math.max(2, Math.round(samples * viewportHeight / viewportWidth))
    : samples;

  // The viewport in scene coordinates: screen = scene * scale + origin.
  const sceneLeft = -scene.origin.x / scale;
  const sceneTop = -scene.origin.y / scale;
  const sceneWidth = viewportWidth / scale;
  const sceneHeight = viewportHeight / scale;

  const stepX = sceneWidth / width;
  const stepY = sceneHeight / height;

  return {
    width,
    height,
    originX: sceneLeft + 0.5 * stepX,
    originY: sceneTop + sceneHeight - 0.5 * stepY,
    stepX,
    stepY: -stepY,
    spacing: Math.max(stepX, stepY),
    extent: Math.hypot(sceneWidth, sceneHeight),
  };
}

/**
 * The scene position of one grid sample.
 * @param {FieldGrid} grid
 * @param {number} i - Column index.
 * @param {number} j - Row index, counting from the bottom.
 * @returns {{x: number, y: number}}
 */
export function gridSamplePosition(grid, i, j) {
  return {
    x: grid.originX + grid.stepX * i,
    y: grid.originY + grid.stepY * j,
  };
}

/**
 * Build the complete description of what is to be computed.
 *
 * @param {Scene} scene
 * @param {Object} [options]
 * @param {number} [options.resolution] - Overrides the stored grid resolution,
 *   used to drop to a coarse grid while the user is interacting.
 * @returns {{settings: Object, sources: WaveSource[], grid: FieldGrid, diagnostics: Object}}
 */
export function buildWaveModel(scene, { resolution } = {}) {
  const settings = resolveWaveSettings(scene);
  const grid = computeFieldGrid(scene, resolution ?? settings.gridResolution);
  const sources = collectWaveSources(scene, { scene, settings });

  return {
    settings,
    sources,
    grid,
    diagnostics: {
      sourceCount: sources.length,
      ...samplingDiagnostics({
        gridSpacing: grid.spacing,
        wavelength: settings.wavelength,
        refractiveIndex: settings.refractiveIndex,
        sceneExtent: grid.extent,
      }),
    },
  };
}

function positiveOr(value, fallback) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function clamp(value, low, high) {
  if (!Number.isFinite(value)) return low;
  return Math.min(high, Math.max(low, value));
}
