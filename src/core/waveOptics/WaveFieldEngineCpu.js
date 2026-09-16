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
 * @file The reference implementation of the field summation, in plain
 * JavaScript.
 *
 * It is far slower than the WebGL backend and is not used to draw the app. It
 * exists so that the physics can be exercised by unit tests without a GL
 * context, and so the GPU backend has something to be checked against. The two
 * share the Hankel coefficient tables, so agreement between them is meaningful
 * only for the summation itself — which is exactly what needs checking.
 */

import { greensFunction } from './hankel.js';
import { wavenumber, minimumRadius } from './conventions.js';
import { gridSamplePosition } from './waveSceneModel.js';

/**
 * Evaluate the field at a list of points.
 *
 * @param {Array<{x: number, y: number}>} points - Where to evaluate.
 * @param {Object} params
 * @param {import('./waveSceneModel.js').WaveSource[]} params.sources
 * @param {number} params.wavelength - Vacuum wavelength in scene units.
 * @param {number} params.refractiveIndex - Index of the medium.
 * @returns {Float64Array} Interleaved real and imaginary parts, `2 * points.length` long.
 */
export function computeFieldAt(points, { sources, wavelength, refractiveIndex = 1 }) {
  const k = wavenumber(wavelength, refractiveIndex);
  const rMin = minimumRadius(wavelength, refractiveIndex);
  const out = new Float64Array(points.length * 2);

  for (let p = 0; p < points.length; p++) {
    const { x, y } = points[p];
    let re = 0;
    let im = 0;

    for (let s = 0; s < sources.length; s++) {
      const source = sources[s];
      const dx = x - source.x;
      const dy = y - source.y;
      const r = Math.max(Math.hypot(dx, dy), rMin);
      const g = greensFunction(k * r);
      // Complex multiply: g * w.
      re += g.re * source.re - g.im * source.im;
      im += g.re * source.im + g.im * source.re;
    }

    out[p * 2] = re;
    out[p * 2 + 1] = im;
  }

  return out;
}

/**
 * Evaluate the field over a sampling grid, in the same memory layout the GPU
 * backend produces: row 0 first, each sample a `(real, imaginary)` pair.
 *
 * @param {import('./waveSceneModel.js').FieldGrid} grid
 * @param {Object} params - As for {@link computeFieldAt}.
 * @returns {Float64Array} `2 * grid.width * grid.height` long.
 */
export function computeFieldGrid(grid, params) {
  const points = new Array(grid.width * grid.height);
  for (let j = 0; j < grid.height; j++) {
    for (let i = 0; i < grid.width; i++) {
      points[j * grid.width + i] = gridSamplePosition(grid, i, j);
    }
  }
  return computeFieldAt(points, params);
}

/**
 * The amplitude `|U|` at each sample of an interleaved complex field.
 * @param {Float64Array|Float32Array} field
 * @returns {Float64Array}
 */
export function fieldAmplitudes(field) {
  const out = new Float64Array(field.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Math.hypot(field[i * 2], field[i * 2 + 1]);
  }
  return out;
}

/**
 * The instantaneous real field `Re{ U e^{-i w t} }` at a given phase.
 * @param {Float64Array|Float32Array} field - Interleaved complex field.
 * @param {number} phase - The quantity `w t`, in radians.
 * @returns {Float64Array}
 */
export function instantaneousField(field, phase) {
  const cos = Math.cos(phase);
  const sin = Math.sin(phase);
  const out = new Float64Array(field.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = field[i * 2] * cos + field[i * 2 + 1] * sin;
  }
  return out;
}

export default {
  computeFieldAt,
  computeFieldGrid,
  fieldAmplitudes,
  instantaneousField,
};
