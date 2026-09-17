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

import {
  COLORMAP_SIZE, listColormaps, listColormapsForView, hasColormap,
  getColormapTable, getColormapTableRGBA, sampleColormap, colormapCssGradient,
  DEFAULT_INTENSITY_COLORMAP, DEFAULT_FIELD_COLORMAP
} from '../../src/core/waveOptics/colormaps.js';

describe('colormap tables', () => {
  test('every declared colormap decodes to a full table', () => {
    for (const name of listColormaps()) {
      expect(getColormapTable(name).length).toBe(COLORMAP_SIZE * 3);
    }
  });

  test('magma matches matplotlib at both ends', () => {
    // The baked table must be the real thing, not an analytic approximation.
    expect(sampleColormap('magma', 0)).toEqual([0, 0, 4]);
    expect(sampleColormap('magma', 1)).toEqual([252, 253, 191]);
  });

  test('viridis matches matplotlib at both ends', () => {
    expect(sampleColormap('viridis', 0)).toEqual([68, 1, 84]);
    expect(sampleColormap('viridis', 1)).toEqual([253, 231, 37]);
  });

  test('twilight is cyclic, which is why it suits a signed oscillating field', () => {
    // Its ends meet, so the extremes of Re{U} do not read as a discontinuity.
    expect(sampleColormap('twilight', 0)).toEqual(sampleColormap('twilight', 1));
  });

  test('sequential maps are not cyclic', () => {
    expect(sampleColormap('magma', 0)).not.toEqual(sampleColormap('magma', 1));
  });

  test('sampling clamps out-of-range positions', () => {
    expect(sampleColormap('magma', -5)).toEqual(sampleColormap('magma', 0));
    expect(sampleColormap('magma', 5)).toEqual(sampleColormap('magma', 1));
  });

  test('the RGBA table matches the RGB one and is fully opaque', () => {
    const rgb = getColormapTable('magma');
    const rgba = getColormapTableRGBA('magma');
    expect(rgba.length).toBe(COLORMAP_SIZE * 4);
    for (let i = 0; i < COLORMAP_SIZE; i++) {
      expect([rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]])
        .toEqual([rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]]);
      expect(rgba[i * 4 + 3]).toBe(255);
    }
  });

  test('an unknown colormap is an error rather than a silent black map', () => {
    expect(hasColormap('not-a-colormap')).toBe(false);
    expect(() => getColormapTable('not-a-colormap')).toThrow(/Unknown colormap/);
  });
});

describe('view-appropriate colormaps', () => {
  test('the intensity view offers sequential maps including its default', () => {
    const options = listColormapsForView('intensity');
    expect(options).toContain(DEFAULT_INTENSITY_COLORMAP);
    expect(options).not.toContain(DEFAULT_FIELD_COLORMAP);
  });

  test('the field view offers cyclic and diverging maps including its default', () => {
    const options = listColormapsForView('field');
    expect(options).toContain(DEFAULT_FIELD_COLORMAP);
    expect(options).toContain('coolwarm');
    // A sequential map would waste half its range on a signed quantity.
    expect(options).not.toContain('magma');
  });

  test('every offered map is one the renderer can actually load', () => {
    for (const view of ['intensity', 'field']) {
      for (const name of listColormapsForView(view)) {
        expect(hasColormap(name)).toBe(true);
      }
    }
  });
});

describe('colormapCssGradient', () => {
  test('produces a CSS gradient spanning the whole map', () => {
    const gradient = colormapCssGradient('magma', 4);
    expect(gradient).toMatch(/^linear-gradient\(to right, /);
    expect(gradient).toContain('rgb(0,0,4) 0.0%');
    expect(gradient).toContain('rgb(252,253,191) 100.0%');
  });
});
