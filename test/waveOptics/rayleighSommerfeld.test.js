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
 * The normalisation tests for the propagation chain.
 *
 * Everything the interface machinery does rests on the Rayleigh-Sommerfeld
 * kernel being correctly normalised, which is not something the rest of the
 * code can check for itself. These tests build the secondary sources by hand,
 * independently of the scene objects, and compare against closed-form results.
 */

import { computeFieldAt, fieldAmplitudes } from '../../src/core/waveOptics/WaveFieldEngineCpu.js';
import { greensFunction } from '../../src/core/waveOptics/hankel.js';
import { wavenumber } from '../../src/core/waveOptics/conventions.js';

const WAVELENGTH = 20;
const K = wavenumber(WAVELENGTH, 1);

const field = (points, sources, directionalCount) =>
  computeFieldAt(points, {
    sources, wavelength: WAVELENGTH, refractiveIndex: 1, directionalCount
  });

/**
 * Sample a flat vertical surface at x = z, over |y| <= halfHeight, and give
 * each sample the incident field from `primaries` times the arc length it
 * stands for. This is exactly what an interface with unit transmission does.
 */
function transparentScreen(z, halfHeight, primaries, samplesPerWavelength = 8) {
  const step = WAVELENGTH / samplesPerWavelength;
  const count = Math.ceil(2 * halfHeight / step);
  const points = [];
  for (let i = 0; i < count; i++) {
    points.push({ x: z, y: -halfHeight + (i + 0.5) * (2 * halfHeight / count) });
  }
  const spacing = 2 * halfHeight / count;
  const incident = field(points, primaries, 0);

  return points.map((point, i) => ({
    x: point.x,
    y: point.y,
    nx: 1,
    ny: 0,
    re: incident[i * 2] * spacing,
    im: incident[i * 2 + 1] * spacing,
  }));
}

describe('a transparent screen reproduces the incident field', () => {
  // The single most important check in the whole simulator: if this passes,
  // the arc-length weighting, the obliquity factor and the i*k/2 prefactor are
  // all correct together. If any one of them were wrong the amplitude would be
  // off by a constant factor or by a factor depending on geometry.
  const primaries = [{ x: 0, y: 0, re: 1, im: 0 }];
  const screen = transparentScreen(200, 1500, primaries);

  const OBSERVATION_POINTS = [
    ['on axis, near', 400, 0],
    ['on axis, far', 1200, 0],
    ['off axis', 600, 150],
    ['well off axis', 600, 400],
  ];

  test.each(OBSERVATION_POINTS)('%s', (_name, x, y) => {
    const [re, im] = field([{ x, y }], screen, screen.length);

    const r = Math.hypot(x, y);
    const analytic = greensFunction(K * r);

    const error = Math.hypot(re - analytic.re, im - analytic.im);
    const magnitude = Math.hypot(analytic.re, analytic.im);
    expect(error / magnitude).toBeLessThan(0.02);
  });

  test('the reproduction is not a coincidence of amplitude alone', () => {
    // Check the phase explicitly, so an amplitude-only match cannot pass.
    const [re, im] = field([{ x: 700, y: 0 }], screen, screen.length);
    const analytic = greensFunction(K * 700);
    const phaseError = Math.atan2(im, re) - Math.atan2(analytic.im, analytic.re);
    expect(Math.abs(Math.atan2(Math.sin(phaseError), Math.cos(phaseError)))).toBeLessThan(0.05);
  });

  test('converges as the screen sampling is refined', () => {
    const analytic = greensFunction(K * 500);
    const magnitude = Math.hypot(analytic.re, analytic.im);
    const errorAt = (density) => {
      const samples = transparentScreen(200, 1500, primaries, density);
      const [re, im] = field([{ x: 500, y: 0 }], samples, samples.length);
      return Math.hypot(re - analytic.re, im - analytic.im) / magnitude;
    };
    expect(errorAt(16)).toBeLessThan(errorAt(2));
  });

  test('a half-amplitude screen halves the field', () => {
    // Transmission multiplies the incident field, so the response is linear.
    const halved = screen.map((s) => ({ ...s, re: s.re * 0.5, im: s.im * 0.5 }));
    const [re, im] = field([{ x: 600, y: 0 }], halved, halved.length);
    const [fullRe, fullIm] = field([{ x: 600, y: 0 }], screen, screen.length);
    expect(re).toBeCloseTo(fullRe * 0.5, 9);
    expect(im).toBeCloseTo(fullIm * 0.5, 9);
  });
});

describe('a slit produces the Fraunhofer pattern', () => {
  test('the far field of a plane-wave-illuminated slit follows sinc^2', () => {
    // A slit of width a, uniformly illuminated, has far-field intensity
    // proportional to sinc^2(pi a sin(theta) / lambda), with zeros at
    // sin(theta) = m lambda / a. This checks the kernel's angular behaviour,
    // which the on-axis reproduction test cannot see.
    const width = 8 * WAVELENGTH;
    const step = WAVELENGTH / 16;
    const count = Math.round(width / step);
    const sources = [];
    for (let i = 0; i < count; i++) {
      sources.push({
        x: 0,
        y: -width / 2 + (i + 0.5) * (width / count),
        nx: 1, ny: 0,
        re: width / count, im: 0,       // unit incident field, arc-length weighted
      });
    }

    const radius = 200000;   // deep in the far field: R >> a^2 / lambda = 1280
    const amplitudeAt = (sinTheta) => {
      const theta = Math.asin(sinTheta);
      return fieldAmplitudes(field(
        [{ x: radius * Math.cos(theta), y: radius * Math.sin(theta) }],
        sources, sources.length
      ))[0];
    };

    const peak = amplitudeAt(0);
    for (const order of [1, 2, 3]) {
      // Zeros of the pattern.
      expect(amplitudeAt(order * WAVELENGTH / width)).toBeLessThan(0.02 * peak);
    }

    // And the first side lobe sits near the textbook 4.7% of the peak intensity.
    const sideLobe = amplitudeAt(1.43 * WAVELENGTH / width);
    expect((sideLobe / peak) ** 2).toBeGreaterThan(0.03);
    expect((sideLobe / peak) ** 2).toBeLessThan(0.06);
  });
});
