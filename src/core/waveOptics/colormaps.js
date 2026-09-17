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
 * @file Access to the baked colormap lookup tables in `colormapData.js`.
 *
 * The tables are shared by the GLSL display pass (uploaded as a 256x1 texture)
 * and by the JS reference renderer, so the two cannot disagree.
 */

import { COLORMAP_DATA, COLORMAP_SIZE } from './colormapData.js';

export { COLORMAP_SIZE };

/** Default colormap for the intensity view. */
export const DEFAULT_INTENSITY_COLORMAP = 'magma';

/** Default colormap for the instantaneous-field view. */
export const DEFAULT_FIELD_COLORMAP = 'twilight';

const decodedTables = new Map();

/**
 * Decode a hex string into an RGB byte table.
 * @param {string} hex
 * @returns {Uint8Array} `COLORMAP_SIZE * 3` bytes.
 */
function decodeHex(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

/**
 * The identifiers of all available colormaps.
 * @param {string} [kind] - Restrict to 'sequential', 'cyclic' or 'diverging'.
 * @returns {string[]}
 */
export function listColormaps(kind) {
  return Object.keys(COLORMAP_DATA).filter(
    (key) => !kind || COLORMAP_DATA[key].kind === kind
  );
}

/**
 * The colormaps suitable for a given field view.
 *
 * The intensity view shows a magnitude and wants a sequential map. The
 * instantaneous-field view shows a signed oscillating quantity, which suits a
 * cyclic map (the default, twilight, joins its two ends so the sign change at
 * the extremes is not a visual discontinuity) or a diverging one.
 *
 * @param {string} view - 'intensity' or 'field'.
 * @returns {string[]}
 */
export function listColormapsForView(view) {
  return view === 'field'
    ? [...listColormaps('cyclic'), ...listColormaps('diverging')]
    : listColormaps('sequential');
}

/**
 * Whether a colormap identifier is known.
 * @param {string} name
 * @returns {boolean}
 */
export function hasColormap(name) {
  return Object.prototype.hasOwnProperty.call(COLORMAP_DATA, name);
}

/**
 * The human-readable name of a colormap (its matplotlib name).
 * @param {string} name
 * @returns {string}
 */
export function colormapDisplayName(name) {
  return COLORMAP_DATA[name]?.name ?? name;
}

/**
 * The RGB lookup table of a colormap, decoded and cached.
 * @param {string} name
 * @returns {Uint8Array} `COLORMAP_SIZE * 3` bytes.
 */
export function getColormapTable(name) {
  if (!hasColormap(name)) {
    throw new Error(`Unknown colormap: ${name}`);
  }
  let table = decodedTables.get(name);
  if (!table) {
    table = decodeHex(COLORMAP_DATA[name].hex);
    decodedTables.set(name, table);
  }
  return table;
}

/**
 * The RGBA lookup table of a colormap, in the layout a GL texture wants.
 * @param {string} name
 * @returns {Uint8Array} `COLORMAP_SIZE * 4` bytes.
 */
export function getColormapTableRGBA(name) {
  const rgb = getColormapTable(name);
  const rgba = new Uint8Array(COLORMAP_SIZE * 4);
  for (let i = 0; i < COLORMAP_SIZE; i++) {
    rgba[i * 4] = rgb[i * 3];
    rgba[i * 4 + 1] = rgb[i * 3 + 1];
    rgba[i * 4 + 2] = rgb[i * 3 + 2];
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}

/**
 * Sample a colormap, matching what the GLSL display pass does for the same
 * input (nearest-neighbour lookup into the same table).
 * @param {string} name
 * @param {number} t - Position in the map, clamped to [0, 1].
 * @returns {number[]} `[r, g, b]` in 0..255.
 */
export function sampleColormap(name, t) {
  const table = getColormapTable(name);
  const clamped = Math.min(1, Math.max(0, t));
  const index = Math.min(COLORMAP_SIZE - 1, Math.round(clamped * (COLORMAP_SIZE - 1)));
  return [table[index * 3], table[index * 3 + 1], table[index * 3 + 2]];
}

/**
 * A CSS gradient string for a colormap, used to preview it in the UI.
 * @param {string} name
 * @param {number} [stops=16] - Number of gradient stops.
 * @returns {string}
 */
export function colormapCssGradient(name, stops = 16) {
  const parts = [];
  for (let i = 0; i < stops; i++) {
    const t = i / (stops - 1);
    const [r, g, b] = sampleColormap(name, t);
    parts.push(`rgb(${r},${g},${b}) ${(t * 100).toFixed(1)}%`);
  }
  return `linear-gradient(to right, ${parts.join(', ')})`;
}
