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
 * @file What the measurement objects need in common: getting at the field, and
 * drawing numbers onto the canvas.
 *
 * There are two ways to get a field value here and they are not
 * interchangeable. The computed grid is already on hand and covers the whole
 * view, so anything that has to search a region uses it. A line of arbitrary
 * points — a slice at any angle, or a far field sampled at a radius far outside
 * the view — cannot come from the grid at all, and is evaluated directly.
 */

import {
  computeModelFieldAt, fieldAmplitudes
} from '../../waveOptics/WaveFieldEngineCpu.js';
import { subspaceIndexAt } from '../../waveOptics/waveSceneModel.js';
import { wavelengthInMedium } from '../../waveOptics/conventions.js';

/**
 * How close a grid sample may sit to a primary source before it is excluded
 * from a peak search, in wavelengths in the local medium.
 *
 * A point or line source radiates the 2D Green's function, which diverges
 * logarithmically at its own location; the near-source clamp elsewhere keeps
 * that finite, but the clamped value can still be far brighter than any real
 * focus nearby. Without this, "the brightest point" is trivially the source
 * itself whenever a probe shares a subspace with one — which is exactly the
 * subspace a probe is usually dropped into, since a lens's focus and its own
 * illumination are typically on the same side of it. One wavelength is enough
 * to clear the near-field falloff around a source without eating into a focus
 * a few wavelengths further out.
 */
const SOURCE_EXCLUSION_WAVELENGTHS = 1;

/** Colour the measurement objects are drawn in. */
export const MEASURE_COLOR = 'rgb(130, 255, 170)';

/** Colour for anything that is not physically in the scene, such as a far field. */
export const VIRTUAL_COLOR = 'rgb(255, 170, 120)';

/** Drawn behind text and marks so they read against a bright field. */
export const MEASURE_OUTLINE = 'rgba(0, 0, 0, 0.8)';

/**
 * The model of the last field computation, if there is one.
 * @param {Scene} scene
 * @returns {Object|null}
 */
export function currentModel(scene) {
  return scene?.simulator?.lastModel ?? null;
}

/**
 * A number identifying the current field, for caching measurements against.
 * @param {Scene} scene
 * @returns {number}
 */
export function fieldSerial(scene) {
  return scene?.simulator?.fieldSerial ?? -1;
}

/**
 * Evaluate the complex field at arbitrary points, on the CPU.
 *
 * @param {Scene} scene
 * @param {Array<{x: number, y: number}>} points
 * @returns {Float64Array|null} Interleaved real and imaginary parts.
 */
export function fieldAt(scene, points) {
  const model = currentModel(scene);
  if (!model || points.length === 0) return null;
  try {
    return computeModelFieldAt(model, points);
  } catch (e) {
    return null;
  }
}

/**
 * The grid brought back from the GPU, with the geometry needed to index it.
 * @param {Scene} scene
 * @returns {{data: Float32Array, grid: Object, interfaces: Array}|null}
 */
export function fieldGrid(scene) {
  const simulator = scene?.simulator;
  const model = currentModel(scene);
  if (!simulator?.fieldReadback || !model) return null;
  const { width, height } = model.grid;
  if (simulator.fieldReadback.length < width * height * 4) return null;

  // Per subspace, because the exclusion radius depends on the local
  // wavelength, and a primary source only needs excluding from a search of
  // the subspace it actually radiates into.
  const excludePointsBySubspace = model.subspaces.map((s) => s.primaries);
  const excludeRadiusBySubspace = model.subspaces.map((s) => SOURCE_EXCLUSION_WAVELENGTHS *
    wavelengthInMedium(model.settings.wavelength, s.refractiveIndex));

  return {
    data: simulator.fieldReadback,
    grid: model.grid,
    interfaces: model.interfaces,
    axisSign: model.settings?.axisSign ?? 1,
    excludePointsBySubspace,
    excludeRadiusBySubspace,
  };
}

/**
 * Which subspace each grid row puts a point in, per interface.
 *
 * Membership is a comparison against every interface's `z(y)`, and evaluating
 * those per pixel would mean hundreds of thousands of equation evaluations per
 * measurement. The surfaces are single-valued in `y`, so one value per row is
 * enough and the per-pixel test becomes an integer comparison.
 *
 * @param {Object} grid
 * @param {Array<Object>} interfaces
 * @returns {Array<Float64Array>} One array of `z` per interface, indexed by row.
 */
export function boundaryRows(grid, interfaces) {
  return interfaces.map((surface) => {
    const rows = new Float64Array(grid.height);
    for (let j = 0; j < grid.height; j++) {
      rows[j] = surface.zAt(grid.originY + grid.stepY * j);
    }
    return rows;
  });
}

/**
 * The brightest sample of the grid within one subspace, and how wide the
 * maximum is across the transverse direction.
 *
 * The width is the full width at half maximum of the *intensity*, taken along
 * the column through the peak, which is the usual way a focal spot is quoted.
 * It is interpolated between samples, so it is not quantised to the grid, but a
 * spot narrower than a few samples is still a measurement of the grid rather
 * than of the optics — which the caller can tell from the sample spacing.
 *
 * Two kinds of sample are skipped, both for the same reason: they sit on top
 * of a source rather than in the field it radiates.
 *
 * The first is a primary source in this subspace. The second is the interface
 * that radiates *into* this subspace, whose secondary sources are spread along
 * the surface itself — a sample landing on one of those sees the clamped
 * Rayleigh-Sommerfeld kernel at essentially zero range, which is brighter than
 * any focus further out and is an artefact of the discretisation rather than a
 * field. Within a wavelength of a radiating aperture this model has nothing
 * meaningful to say in any case, so excluding that band costs no real answer.
 *
 * @param {Object} field - From {@link fieldGrid}.
 * @param {number} subspaceIndex - Which subspace to search.
 * @returns {{x: number, y: number, amplitude: number, width: number, samplesAcross: number}|null}
 */
export function peakInSubspace(field, subspaceIndex) {
  const { data, grid, interfaces } = field;
  const axisSign = field.axisSign ?? 1;
  const rows = boundaryRows(grid, interfaces);
  const excludePoints = field.excludePointsBySubspace?.[subspaceIndex] ?? [];
  const excludeRadius = field.excludeRadiusBySubspace?.[subspaceIndex] ?? 0;
  const excludeRadiusSq = excludeRadius ** 2;

  // The interface whose sample sites radiate into this subspace: the one
  // bounding it from below. The first subspace has none, and nothing to skip.
  const sourceSurface = subspaceIndex > 0 ? rows[subspaceIndex - 1] : null;

  let bestIndex = -1;
  let bestAmplitude = -1;
  let bestI = 0;
  let bestJ = 0;

  for (let j = 0; j < grid.height; j++) {
    const y = grid.originY + grid.stepY * j;

    // The band to skip around the radiating surface, measured perpendicular to
    // it. `z(y)` gives the axial offset, which for a tilted or curved surface
    // is longer than the true distance by the same factor the arc length is,
    // so it is divided out here rather than excluding a wider band wherever the
    // surface happens to be steep.
    let axialBand = 0;
    if (sourceSurface && excludeRadius > 0) {
      const below = sourceSurface[Math.max(0, j - 1)];
      const above = sourceSurface[Math.min(grid.height - 1, j + 1)];
      const spanY = (Math.min(grid.height - 1, j + 1) - Math.max(0, j - 1)) * grid.stepY;
      const slope = spanY !== 0 ? (above - below) / spanY : 0;
      axialBand = excludeRadius * Math.hypot(1, slope);
    }

    for (let i = 0; i < grid.width; i++) {
      const x = grid.originX + grid.stepX * i;
      let index = 0;
      for (let s = 0; s < rows.length; s++) {
        if (axisSign * x >= axisSign * rows[s][j]) index++; else break;
      }
      if (index !== subspaceIndex) continue;

      if (axialBand > 0 && Math.abs(x - sourceSurface[j]) < axialBand) continue;

      if (excludeRadiusSq > 0) {
        let tooClose = false;
        for (const source of excludePoints) {
          const dx = x - source.x;
          const dy = y - source.y;
          if (dx * dx + dy * dy < excludeRadiusSq) { tooClose = true; break; }
        }
        if (tooClose) continue;
      }

      const amplitude = data[(j * grid.width + i) * 4 + 2];
      if (amplitude > bestAmplitude) {
        bestAmplitude = amplitude;
        bestIndex = j * grid.width + i;
        bestI = i;
        bestJ = j;
      }
    }
  }
  if (bestIndex < 0 || !(bestAmplitude > 0)) return null;

  const halfIntensity = bestAmplitude * bestAmplitude / 2;
  const at = (j) => {
    const amplitude = data[(j * grid.width + bestI) * 4 + 2];
    return amplitude * amplitude;
  };
  const edge = (direction) => {
    let previous = at(bestJ);
    for (let j = bestJ + direction; j >= 0 && j < grid.height; j += direction) {
      const value = at(j);
      if (value < halfIntensity) {
        // Linear interpolation across the crossing, in units of rows.
        const fraction = (previous - halfIntensity) / (previous - value || 1);
        return Math.abs(j - direction + direction * fraction - bestJ);
      }
      previous = value;
    }
    return null;
  };

  const low = edge(-1);
  const high = edge(1);
  const rowsAcross = low !== null && high !== null ? low + high : null;

  return {
    x: grid.originX + grid.stepX * bestI,
    y: grid.originY + grid.stepY * bestJ,
    amplitude: bestAmplitude,
    width: rowsAcross === null ? null : rowsAcross * Math.abs(grid.stepY),
    samplesAcross: rowsAcross,
  };
}

/**
 * Which subspace a point is in, for the current model.
 * @param {Scene} scene
 * @param {number} x
 * @param {number} y
 * @returns {number}
 */
export function subspaceAt(scene, x, y) {
  const model = currentModel(scene);
  if (!model) return 0;
  return subspaceIndexAt(model.interfaces, x, y, model.settings?.axisSign ?? 1);
}

/**
 * Draw text with a dark outline, so it stays readable over any field.
 *
 * @param {CanvasRenderer} canvasRenderer
 * @param {string|Array<string>} text - A line, or several.
 * @param {{x: number, y: number}} at
 * @param {Object} [options]
 */
export function drawLabel(canvasRenderer, text, at, {
  color = MEASURE_COLOR, align = 'left', baseline = 'top', size = 12,
} = {}) {
  const ctx = canvasRenderer.ctx;
  const ls = canvasRenderer.lengthScale;
  const lines = Array.isArray(text) ? text : [text];
  ctx.save();
  ctx.font = `${size * ls}px Arial`;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  ctx.lineWidth = 3 * ls;
  ctx.strokeStyle = MEASURE_OUTLINE;
  ctx.fillStyle = color;
  lines.forEach((line, i) => {
    const y = at.y + i * size * 1.25 * ls;
    ctx.strokeText(line, at.x, y);
    ctx.fillText(line, at.x, y);
  });
  ctx.restore();
}

/**
 * Format a length in the units a measurement is set to report in.
 *
 * @param {number} value - In scene length units.
 * @param {string} units - 'wavelengths' or 'scene'.
 * @param {number} wavelength
 * @returns {string}
 */
export function formatLength(value, units, wavelength) {
  if (units === 'wavelengths' && wavelength > 0) {
    return `${(value / wavelength).toFixed(2)} λ`;
  }
  return value.toFixed(1);
}

export { fieldAmplitudes };
