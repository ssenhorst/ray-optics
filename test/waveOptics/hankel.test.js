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

import {
  besselJ0, besselY0, besselJ1, besselY1, greensFunction, buildHankelGlsl,
  HANKEL_BRANCH_X
} from '../../src/core/waveOptics/hankel.js';

// Reference values computed with scipy.special (j0, y0, j1, y1) to 10 decimals.
const REFERENCE = [
  // x,     J0,             Y0,             J1,             Y1
  [0.1, 0.9975015621, -1.5342386514, 0.0499375260, -6.4589510947],
  [0.5, 0.9384698072, -0.4445187335, 0.2422684577, -1.4714723927],
  [1.0, 0.7651976866, 0.0882569642, 0.4400505857, -0.7812128213],
  [2.0, 0.2238907791, 0.5103756726, 0.5767248078, -0.1070324315],
  [3.0, -0.2600519549, 0.3768500100, 0.3390589585, 0.3246744248],
  [5.0, -0.1775967713, -0.3085176252, -0.3275791376, 0.1478631434],
  [10.0, -0.2459357645, 0.0556711673, 0.0434727462, 0.2490154242],
  [20.0, 0.1670246643, 0.0626405968, 0.0668331242, -0.1655116144],
  [100.0, 0.0199858503, -0.0772443134, -0.0771453520, -0.0203723120],
];

describe('Bessel functions', () => {
  // The Abramowitz & Stegun 9.4 approximations are quoted to better than 2e-7.
  // The bound for Y1 is stated for x*Y1(x), so its absolute error grows as 1/x
  // as x -> 0; a mixed absolute/relative tolerance covers both regimes. The
  // small-x blow-up is harmless here because the renderer clamps r away from
  // the singularity anyway.
  const TOLERANCE = 2e-7;
  const close = (actual, expected) =>
    Math.abs(actual - expected) < TOLERANCE * Math.max(1, Math.abs(expected));

  test.each(REFERENCE)('at x = %p match reference values', (x, j0, y0, j1, y1) => {
    expect(close(besselJ0(x), j0)).toBe(true);
    expect(close(besselY0(x), y0)).toBe(true);
    expect(close(besselJ1(x), j1)).toBe(true);
    expect(close(besselY1(x), y1)).toBe(true);
  });

  test('are continuous across the branch switch', () => {
    const eps = 1e-9;
    const below = HANKEL_BRANCH_X - eps;
    const above = HANKEL_BRANCH_X + eps;

    // A jump here would show up as a visible ring in the rendered field.
    expect(Math.abs(besselJ0(below) - besselJ0(above))).toBeLessThan(2e-7);
    expect(Math.abs(besselY0(below) - besselY0(above))).toBeLessThan(2e-7);
    expect(Math.abs(besselJ1(below) - besselJ1(above))).toBeLessThan(2e-7);
    expect(Math.abs(besselY1(below) - besselY1(above))).toBeLessThan(2e-7);
  });

  test('satisfy the Wronskian identity J0 Y1 - J1 Y0 = -2/(pi x)', () => {
    // An independent check that does not rely on tabulated values, and which
    // exercises arguments between the tabulated points.
    for (let x = 0.05; x < 200; x *= 1.3) {
      const wronskian = besselJ0(x) * besselY1(x) - besselJ1(x) * besselY0(x);
      const expected = -2 / (Math.PI * x);
      expect(Math.abs(wronskian - expected)).toBeLessThan(1e-6 + 1e-5 * Math.abs(expected));
    }
  });
});

describe('greensFunction', () => {
  test('is (i/4) H0(kr)', () => {
    const kr = 2.5;
    const g = greensFunction(kr);
    expect(g.re).toBeCloseTo(-besselY0(kr) / 4, 12);
    expect(g.im).toBeCloseTo(besselJ0(kr) / 4, 12);
  });

  test('decays as 1/sqrt(r) in the far field, not 1/r', () => {
    // The distinguishing property of the 2D Green's function. Comparing two
    // points a factor of 100 apart, the amplitude ratio must be 10, not 100.
    const near = greensFunction(1000);
    const far = greensFunction(100000);
    const nearAmplitude = Math.hypot(near.re, near.im);
    const farAmplitude = Math.hypot(far.re, far.im);
    expect(nearAmplitude / farAmplitude).toBeCloseTo(10, 1);
  });
});

describe('buildHankelGlsl', () => {
  test('emits valid GLSL float literals for every coefficient', () => {
    // Comments are stripped first, since prose legitimately contains bare integers.
    const glsl = buildHankelGlsl().replace(/\/\/[^\n]*/g, '');
    // Any bare integer literal in an expression would be a GLSL type error.
    const numbers = glsl.match(/(?<![\w.])-?\d+(\.\d+)?(e-?\d+)?(?![\w.])/g) || [];
    for (const number of numbers) {
      expect(number).toMatch(/[.e]/);
    }
  });

  test('defines the functions the field shaders call', () => {
    const glsl = buildHankelGlsl();
    expect(glsl).toContain('vec2 hankel0(float x)');
    expect(glsl).toContain('vec2 hankel1(float x)');
    expect(glsl).toContain('vec2 greensFunction(float kr)');
  });
});
