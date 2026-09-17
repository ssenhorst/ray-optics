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

import { greensFunction, rayleighSommerfeldKernel } from './hankel.js';
import { wavenumber, minimumRadius } from './conventions.js';
import { gridSamplePosition, subspaceIndexAt } from './waveSceneModel.js';

/**
 * Evaluate the field at a list of points.
 *
 * Sources come in two kinds and are always ordered with the directional ones
 * first, matching the layout the GPU backend uses so the two cannot disagree
 * about which source is which:
 *
 * - The first `directionalCount` entries are points on an illuminated surface.
 *   They carry a forward normal `(nx, ny)` and re-radiate through the
 *   Rayleigh-Sommerfeld kernel, with the arc length they stand for already
 *   folded into their weight.
 * - The rest are isotropic point sources radiating the free-space Green's
 *   function.
 *
 * @param {Array<{x: number, y: number}>} points - Where to evaluate.
 * @param {Object} params
 * @param {WaveSource[]} params.sources
 * @param {number} params.wavelength - Vacuum wavelength in scene units.
 * @param {number} params.refractiveIndex - Index of the medium radiated into.
 * @param {number} [params.directionalCount=0] - How many leading sources are directional.
 * @param {Array<Object>} [params.planeWaves=[]] - Plane waves filling the medium,
 *   evaluated in closed form rather than as a sum of point sources.
 * @returns {Float64Array} Interleaved real and imaginary parts, `2 * points.length` long.
 */
export function computeFieldAt(points, {
  sources, wavelength, refractiveIndex = 1, directionalCount = 0, planeWaves = []
}) {
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

      const kernel = s < directionalCount
        ? rayleighSommerfeldKernel(k * r, (source.nx * dx + source.ny * dy) / r, k)
        : greensFunction(k * r);

      // Complex multiply: kernel * weight.
      re += kernel.re * source.re - kernel.im * source.im;
      im += kernel.re * source.im + kernel.im * source.re;
    }

    for (let w = 0; w < planeWaves.length; w++) {
      const wave = planeWaves[w];
      const phase = k * (wave.dirX * (x - wave.x) + wave.dirY * (y - wave.y));
      const cos = Math.cos(phase);
      const sin = Math.sin(phase);
      re += cos * wave.re - sin * wave.im;
      im += cos * wave.im + sin * wave.re;
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
 * @param {FieldGrid} grid
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
 * Run the propagation chain over a model's subspaces.
 *
 * Subspace by subspace along the optical axis, the field arriving at the next
 * interface is evaluated at each of its sample sites, multiplied by the complex
 * transmission there and by the arc length the site stands for, and becomes a
 * secondary source radiating into the subspace beyond. The incident field is
 * evaluated with the wavenumber of the medium it travelled through, and the
 * re-radiation uses the wavenumber of the medium it enters; that difference is
 * the whole of the refraction in this model.
 *
 * This is the reference implementation. The GPU backend does the same thing,
 * but the chain here is what the tests check against closed-form results.
 *
 * @param {Object} model - As built by `buildWaveModel`.
 * @returns {Array<{refractiveIndex: number, sources: Array, directionalCount: number,
 *   lowerBoundary: Object|null, upperBoundary: Object|null}>}
 */
export function propagateChain(model) {
  const { subspaces, settings } = model;
  const resolved = [];

  for (let j = 0; j < subspaces.length; j++) {
    const subspace = subspaces[j];
    let directional = [];

    if (j > 0 && subspace.surfaceSamples.length > 0) {
      const previous = resolved[j - 1];
      const incident = computeFieldAt(subspace.surfaceSamples, {
        sources: previous.sources,
        wavelength: settings.wavelength,
        refractiveIndex: subspaces[j - 1].refractiveIndex,
        directionalCount: previous.directionalCount,
        planeWaves: previous.planeWaves,
      });

      directional = subspace.surfaceSamples.map((site, i) => {
        const incidentRe = incident[i * 2];
        const incidentIm = incident[i * 2 + 1];
        // weight = transmission * incident field * arc length.
        return {
          x: site.x,
          y: site.y,
          nx: site.nx,
          ny: site.ny,
          re: (site.tRe * incidentRe - site.tIm * incidentIm) * site.ds,
          im: (site.tRe * incidentIm + site.tIm * incidentRe) * site.ds,
        };
      });
    }

    resolved.push({
      refractiveIndex: subspace.refractiveIndex,
      sources: [...directional, ...subspace.primaries],
      directionalCount: directional.length,
      planeWaves: subspace.planeWaves ?? [],
      lowerBoundary: subspace.lowerBoundary,
      upperBoundary: subspace.upperBoundary,
    });
  }

  return resolved;
}

/**
 * Evaluate a propagated model at arbitrary points, using each point's own
 * subspace.
 *
 * @param {Object} model - As built by `buildWaveModel`.
 * @param {Array<{x: number, y: number}>} points
 * @returns {Float64Array} Interleaved real and imaginary parts.
 */
export function computeModelFieldAt(model, points) {
  const resolved = propagateChain(model);
  const out = new Float64Array(points.length * 2);

  // Group the points by subspace so each subspace is summed over once.
  const bySubspace = new Map();
  points.forEach((point, index) => {
    const j = subspaceIndexAt(model.interfaces, point.x, point.y);
    if (!bySubspace.has(j)) bySubspace.set(j, []);
    bySubspace.get(j).push(index);
  });

  for (const [j, indices] of bySubspace) {
    const subspace = resolved[j];
    const values = computeFieldAt(indices.map((i) => points[i]), {
      sources: subspace.sources,
      wavelength: model.settings.wavelength,
      refractiveIndex: subspace.refractiveIndex,
      directionalCount: subspace.directionalCount,
      planeWaves: subspace.planeWaves,
    });
    indices.forEach((pointIndex, k) => {
      out[pointIndex * 2] = values[k * 2];
      out[pointIndex * 2 + 1] = values[k * 2 + 1];
    });
  }

  return out;
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
  propagateChain,
  computeModelFieldAt,
  fieldAmplitudes,
  instantaneousField,
};
