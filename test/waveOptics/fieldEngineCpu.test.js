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
  computeFieldAt, computeFieldGrid, fieldAmplitudes, instantaneousField
} from '../../src/core/waveOptics/WaveFieldEngineCpu.js';
import { wavenumber } from '../../src/core/waveOptics/conventions.js';

const WAVELENGTH = 20;
const K = wavenumber(WAVELENGTH, 1);

/** A single unit-amplitude, zero-phase source at the origin. */
const UNIT_SOURCE = [{ x: 0, y: 0, re: 1, im: 0 }];

const params = (sources) => ({ sources, wavelength: WAVELENGTH, refractiveIndex: 1 });

/** Evaluate the field at one point and return it as a complex pair. */
function fieldAt(x, y, sources = UNIT_SOURCE) {
  const out = computeFieldAt([{ x, y }], params(sources));
  return { re: out[0], im: out[1] };
}

describe('point source field', () => {
  // Independently computed with scipy.special.hankel1: (i/4) H0^(1)(kr).
  const GREENS_REFERENCE = [
    [0.5, 0.111129683377, 0.234617451810],
    [1.0, -0.022064241054, 0.191299421639],
    [3.0, -0.094212502503, -0.065012988725],
    [7.5, -0.029328321537, 0.066584914470],
    [25.0, 0.031812358067, 0.024066695819],
  ];

  test.each(GREENS_REFERENCE)(
    'at kr = %p matches the analytic Greens function',
    (kr, re, im) => {
      const field = fieldAt(kr / K, 0);
      expect(field.re).toBeCloseTo(re, 6);
      expect(field.im).toBeCloseTo(im, 6);
    }
  );

  test('decays as 1/sqrt(r), the 2D law, rather than 1/r', () => {
    // Averaging over a whole wavelength removes the oscillation, leaving the
    // envelope. A 3D-style 1/r source would give a ratio of 100 here.
    const envelope = (radius) => {
      let sum = 0;
      const samples = 64;
      for (let i = 0; i < samples; i++) {
        const r = radius + WAVELENGTH * i / samples;
        const field = fieldAt(r, 0);
        sum += field.re * field.re + field.im * field.im;
      }
      return Math.sqrt(sum / samples);
    };

    const ratio = envelope(200 * WAVELENGTH) / envelope(20000 * WAVELENGTH);
    expect(ratio).toBeCloseTo(10, 1);
  });

  test('advances its phase by 2 pi per wavelength, outward', () => {
    // Pins down both the magnitude of k and the sign convention: with e^{-iwt}
    // an outgoing wave carries e^{+ikr}, so the phase must *increase* with r.
    const r0 = 50 * WAVELENGTH;
    const near = fieldAt(r0, 0);
    const far = fieldAt(r0 + WAVELENGTH, 0);

    const phaseStep = Math.atan2(far.im, far.re) - Math.atan2(near.im, near.re);
    expect(Math.abs(wrapToPi(phaseStep))).toBeLessThan(0.01);

    const quarter = fieldAt(r0 + WAVELENGTH / 4, 0);
    const quarterStep = wrapToPi(
      Math.atan2(quarter.im, quarter.re) - Math.atan2(near.im, near.re)
    );
    expect(quarterStep).toBeCloseTo(Math.PI / 2, 1);
  });

  test('is finite at the source, where the Greens function diverges', () => {
    const field = fieldAt(0, 0);
    expect(Number.isFinite(field.re)).toBe(true);
    expect(Number.isFinite(field.im)).toBe(true);
  });

  test('scales linearly with amplitude and rotates with phase', () => {
    const plain = fieldAt(137, 91);
    const scaled = fieldAt(137, 91, [{ x: 0, y: 0, re: 3, im: 0 }]);
    expect(scaled.re).toBeCloseTo(plain.re * 3, 10);
    expect(scaled.im).toBeCloseTo(plain.im * 3, 10);

    // A source with phase pi/2 has weight i, which rotates the field.
    const rotated = fieldAt(137, 91, [{ x: 0, y: 0, re: 0, im: 1 }]);
    expect(rotated.re).toBeCloseTo(-plain.im, 10);
    expect(rotated.im).toBeCloseTo(plain.re, 10);
  });
});

describe('superposition', () => {
  test('the field of two sources is the sum of their fields', () => {
    const a = { x: -30, y: 12, re: 1, im: 0 };
    const b = { x: 45, y: -8, re: 0.4, im: 0.9 };
    const point = { x: 210, y: 130 };

    const both = computeFieldAt([point], params([a, b]));
    const justA = computeFieldAt([point], params([a]));
    const justB = computeFieldAt([point], params([b]));

    expect(both[0]).toBeCloseTo(justA[0] + justB[0], 12);
    expect(both[1]).toBeCloseTo(justA[1] + justB[1], 12);
  });

  test('two sources produce far-field fringes at d sin(theta) = m lambda', () => {
    // The textbook two-slit result, which no single-source test can catch: it
    // checks the relative phases the summation produces across the field.
    const separation = 10 * WAVELENGTH;
    const sources = [
      { x: 0, y: -separation / 2, re: 1, im: 0 },
      { x: 0, y: separation / 2, re: 1, im: 0 },
    ];
    const radius = 4000 * WAVELENGTH;

    const amplitudeAtAngle = (sinTheta) => {
      const theta = Math.asin(sinTheta);
      const point = {
        x: radius * Math.cos(theta),
        y: radius * Math.sin(theta),
      };
      return fieldAmplitudes(computeFieldAt([point], params(sources)))[0];
    };

    const single = fieldAmplitudes(
      computeFieldAt([{ x: radius, y: 0 }], params([sources[0]]))
    )[0];

    // Maxima at sin(theta) = m / 10 reach twice the single-source amplitude.
    for (const order of [0, 1, 2, 3]) {
      expect(amplitudeAtAngle(order / 10)).toBeCloseTo(2 * single, 2);
    }

    // Minima halfway between them very nearly cancel.
    for (const order of [0, 1, 2]) {
      expect(amplitudeAtAngle((order + 0.5) / 10)).toBeLessThan(0.02 * single);
    }
  });
});

describe('computeFieldGrid', () => {
  const grid = {
    width: 4, height: 3,
    originX: 10, originY: 50,
    stepX: 5, stepY: -5,
    spacing: 5, extent: 25,
  };

  test('lays samples out row-major, matching the GPU texture layout', () => {
    const field = computeFieldGrid(grid, params(UNIT_SOURCE));
    expect(field.length).toBe(grid.width * grid.height * 2);

    // Sample (i=2, j=1) is at (20, 45); check it against a direct evaluation.
    const direct = computeFieldAt([{ x: 20, y: 45 }], params(UNIT_SOURCE));
    const index = (1 * grid.width + 2) * 2;
    expect(field[index]).toBeCloseTo(direct[0], 12);
    expect(field[index + 1]).toBeCloseTo(direct[1], 12);
  });
});

describe('instantaneousField', () => {
  test('is Re{U} at t = 0 and -Re{U} half a period later', () => {
    const field = new Float64Array([0.3, -0.7]);
    expect(instantaneousField(field, 0)[0]).toBeCloseTo(0.3, 12);
    expect(instantaneousField(field, Math.PI)[0]).toBeCloseTo(-0.3, 12);
  });

  test('picks up the imaginary part a quarter period in', () => {
    // Re{(a + ib) e^{-iwt}} = a cos(wt) + b sin(wt).
    const field = new Float64Array([0.3, -0.7]);
    expect(instantaneousField(field, Math.PI / 2)[0]).toBeCloseTo(-0.7, 12);
  });

  test('never exceeds the amplitude', () => {
    const field = new Float64Array([0.3, -0.7]);
    const amplitude = fieldAmplitudes(field)[0];
    for (let phase = 0; phase < Math.PI * 2; phase += 0.05) {
      expect(Math.abs(instantaneousField(field, phase)[0])).toBeLessThanOrEqual(amplitude + 1e-12);
    }
  });
});

function wrapToPi(angle) {
  return angle - Math.PI * 2 * Math.round(angle / (Math.PI * 2));
}
