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
  oklabToLinearSrgb, linearSrgbToOklab, srgbToOklch, oklchToSrgb,
  linearToSrgb, srgbToLinear, isInGamut, amplitudePhaseColor,
  phaseWheelCssGradient, buildOklchGlsl, DEFAULT_PHASE_CHROMA
} from '../../src/core/waveOptics/oklch.js';

// Reference values computed independently from Ottosson's published matrices.
const OKLCH_REFERENCE = [
  ['white', [1, 1, 1], 0.999999993, 0.0],
  ['red', [1, 0, 0], 0.627955361, 0.257683308],
  ['green', [0, 1, 0], 0.866439612, 0.294827240],
  ['blue', [0, 0, 1], 0.452013718, 0.313214372],
  ['mid grey', [0.5, 0.5, 0.5], 0.598180727, 0.0],
];

describe('Oklab conversions', () => {
  test.each(OKLCH_REFERENCE)('%s has the expected lightness and chroma', (_name, rgb, L, chroma) => {
    const actual = srgbToOklch(rgb);
    expect(actual.L).toBeCloseTo(L, 7);
    expect(actual.chroma).toBeCloseTo(chroma, 7);
  });

  test('the transfer function round-trips', () => {
    for (let value = 0; value <= 1; value += 0.05) {
      expect(srgbToLinear(linearToSrgb(value))).toBeCloseTo(value, 10);
    }
  });

  test('Oklab and linear sRGB round-trip', () => {
    // The two published matrices are quoted to ten digits but are not exact
    // inverses, so the round-trip closes to about 2e-7 — four orders of
    // magnitude below one step of an 8-bit channel.
    const linear = [0.2, 0.55, 0.9];
    const [L, a, b] = linearSrgbToOklab(linear);
    const back = oklabToLinearSrgb(L, a, b);
    for (let i = 0; i < 3; i++) {
      expect(back[i]).toBeCloseTo(linear[i], 6);
    }
  });
});

describe('oklchToSrgb gamut mapping', () => {
  test('reproduces colours that are already representable', () => {
    for (const [, rgb] of OKLCH_REFERENCE) {
      const { L, chroma, hue } = srgbToOklch(rgb);
      const actual = oklchToSrgb(L, chroma, hue);
      for (let i = 0; i < 3; i++) {
        expect(actual[i]).toBeCloseTo(rgb[i], 3);
      }
    }
  });

  test('brings an impossible chroma back into gamut', () => {
    // Far beyond anything sRGB can hold at any lightness.
    for (let hue = 0; hue < Math.PI * 2; hue += 0.3) {
      const rgb = oklchToSrgb(0.6, 2.0, hue);
      for (const channel of rgb) {
        expect(channel).toBeGreaterThanOrEqual(0);
        expect(channel).toBeLessThanOrEqual(1);
      }
      expect(isInGamut(rgb.map(srgbToLinear))).toBe(true);
    }
  });

  test('preserves lightness and hue when it reduces chroma', () => {
    // Only chroma may give way, so the amplitude and phase readings stay true.
    for (let hue = 0; hue < Math.PI * 2; hue += 0.4) {
      const mapped = srgbToOklch(oklchToSrgb(0.6, 2.0, hue));
      expect(mapped.L).toBeCloseTo(0.6, 2);
      expect(Math.abs(wrapToPi(mapped.hue - hue))).toBeLessThan(0.02);
      // It must actually have reduced the chroma, not just clipped channels.
      expect(mapped.chroma).toBeLessThan(2.0);
    }
  });
});

describe('amplitudePhaseColor', () => {
  test('maps zero amplitude to black and full amplitude to white', () => {
    for (let phase = 0; phase < Math.PI * 2; phase += 0.5) {
      expect(amplitudePhaseColor(0, phase)).toEqual([0, 0, 0]);
      const white = amplitudePhaseColor(1, phase);
      for (const channel of white) expect(channel).toBeCloseTo(1, 6);
    }
  });

  test('lightness increases with amplitude at every phase', () => {
    for (let phase = 0; phase < Math.PI * 2; phase += 0.8) {
      let previous = -1;
      for (let amplitude = 0; amplitude <= 1.0001; amplitude += 0.05) {
        const { L } = srgbToOklch(amplitudePhaseColor(amplitude, phase));
        expect(L).toBeGreaterThan(previous);
        previous = L;
      }
    }
  });

  test('phase sets the hue without disturbing the lightness', () => {
    const lightnesses = [];
    for (let phase = 0; phase < Math.PI * 2; phase += 0.25) {
      const { L, hue } = srgbToOklch(amplitudePhaseColor(0.5, phase));
      lightnesses.push(L);
      expect(Math.abs(wrapToPi(hue - phase))).toBeLessThan(0.02);
    }
    for (const L of lightnesses) expect(L).toBeCloseTo(lightnesses[0], 2);
  });

  test('clamps amplitudes outside the unit range', () => {
    expect(amplitudePhaseColor(-3, 1)).toEqual(amplitudePhaseColor(0, 1));
    expect(amplitudePhaseColor(7, 1)).toEqual(amplitudePhaseColor(1, 1));
  });

  test('always returns a representable colour', () => {
    for (let amplitude = 0; amplitude <= 1; amplitude += 0.05) {
      for (let phase = 0; phase < Math.PI * 2; phase += 0.3) {
        for (const chroma of [0, DEFAULT_PHASE_CHROMA, 0.35]) {
          for (const channel of amplitudePhaseColor(amplitude, phase, chroma)) {
            expect(channel).toBeGreaterThanOrEqual(0);
            expect(channel).toBeLessThanOrEqual(1);
          }
        }
      }
    }
  });
});

describe('phaseWheelCssGradient', () => {
  test('spans a full turn and closes on itself', () => {
    const gradient = phaseWheelCssGradient(DEFAULT_PHASE_CHROMA, 0.65, 12);
    expect(gradient).toMatch(/^conic-gradient\(/);
    expect(gradient).toContain('0.0deg');
    expect(gradient).toContain('360.0deg');

    // Phase is cyclic, so the wheel must not show a seam.
    const stops = gradient.match(/rgb\(\d+,\d+,\d+\)/g);
    expect(stops[0]).toBe(stops[stops.length - 1]);
    // ...but it must actually vary in between.
    expect(new Set(stops).size).toBeGreaterThan(8);
  });
});

describe('buildOklchGlsl', () => {
  test('emits valid GLSL float literals', () => {
    // Strip comments and loop headers, whose integers are genuine ints; what
    // this guards against is a matrix coefficient emitted without a decimal
    // point, which would be a GLSL type error.
    const glsl = buildOklchGlsl()
      .replace(/\/\/[^\n]*/g, '')
      .replace(/for\s*\([^)]*\)/g, '');
    const numbers = glsl.match(/(?<![\w.])-?\d+(\.\d+)?(e-?\d+)?(?![\w.])/g) || [];
    for (const number of numbers) {
      expect(number).toMatch(/[.e]/);
    }
  });

  test('defines the function the display shader calls', () => {
    expect(buildOklchGlsl()).toContain(
      'vec3 amplitudePhaseColor(float amplitude, float phase, float chroma)'
    );
  });
});

function wrapToPi(angle) {
  return angle - Math.PI * 2 * Math.round(angle / (Math.PI * 2));
}
