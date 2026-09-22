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

import Scene from '../../src/core/Scene.js';
import WaveLineSource from '../../src/core/sceneObjs/wave/WaveLineSource.js';
import WavePointSource from '../../src/core/sceneObjs/wave/WavePointSource.js';
import {
  resolveWaveSettings, collectWaveSources, countWaveSources, resolveSourceDensity
} from '../../src/core/waveOptics/waveSceneModel.js';
import { computeFieldAt, fieldAmplitudes } from '../../src/core/waveOptics/WaveFieldEngineCpu.js';
import { wavenumber, MAX_SOURCES } from '../../src/core/waveOptics/conventions.js';

const WAVELENGTH = 20;
const K = wavenumber(WAVELENGTH, 1);

/** A scene with one line source, and a helper to sample it at a given density. */
function makeLine({ length = 200, eqnAmplitude = '1', eqnPhase = '0', amplitude = 1 } = {}) {
  const scene = new Scene();
  scene.waveOptics.wavelength = WAVELENGTH;
  scene.waveOptics.refractiveIndex = 1;

  const line = new WaveLineSource(scene);
  line.p1 = { x: 0, y: -length / 2 };
  line.p2 = { x: 0, y: length / 2 };
  line.amplitude = amplitude;
  line.eqnAmplitude = eqnAmplitude;
  line.eqnPhase = eqnPhase;
  scene.objs.push(line);

  const settings = resolveWaveSettings(scene);
  const sample = (samplesPerWavelength) =>
    line.getWaveSources({ scene, settings, samplesPerWavelength });

  return { scene, line, settings, sample };
}

const fieldAt = (x, y, sources) =>
  computeFieldAt([{ x, y }], { sources, wavelength: WAVELENGTH, refractiveIndex: 1 });

describe('sampling', () => {
  test('samples are centred on the line, with u zero at the midpoint', () => {
    const { sample } = makeLine({ length: 200 });
    const sources = sample(8);

    const meanY = sources.reduce((sum, s) => sum + s.y, 0) / sources.length;
    expect(meanY).toBeCloseTo(0, 9);
    expect(sources.every((s) => s.x === 0)).toBe(true);
    // Cell-centred, so no sample sits exactly on an endpoint.
    expect(Math.max(...sources.map((s) => Math.abs(s.y)))).toBeLessThan(100);
  });

  test('an odd amplitude profile sums to zero, confirming u is centred', () => {
    const { sample } = makeLine({ length: 200, eqnAmplitude: 'u' });
    const sources = sample(8);
    const total = sources.reduce((sum, s) => sum + s.re, 0);
    expect(Math.abs(total)).toBeLessThan(1e-9);
  });

  test('the weights carry the arc length each sample stands for', () => {
    // With A(u) = 1 and no phase, the weights must sum to amplitude * length
    // regardless of how many samples were used. This is the property that
    // makes the density a purely numerical control.
    const { sample } = makeLine({ length: 200, amplitude: 0.5 });
    for (const density of [2, 8, 37]) {
      const total = sample(density).reduce((sum, s) => sum + s.re, 0);
      expect(total).toBeCloseTo(0.5 * 200, 9);
    }
  });

  test('sample count scales with density and with the wavelength in the medium', () => {
    const { line, settings } = makeLine({ length: 200 });
    expect(line.sampleCount(settings, 8)).toBe(Math.ceil(200 * 8 / 20));
    expect(line.sampleCount(settings, 16)).toBe(Math.ceil(200 * 16 / 20));

    // A denser medium has a shorter wavelength, so it needs more samples.
    const denser = { ...settings, refractiveIndex: 2 };
    expect(line.sampleCount(denser, 8)).toBe(Math.ceil(200 * 8 / 10));
  });
});

describe('density independence', () => {
  test('the radiated field converges as the density rises', () => {
    // The whole point of the arc-length weighting: the density must control
    // accuracy only. Without it the field would grow in proportion to it.
    const { sample } = makeLine({ length: 200 });
    const at = (density) => {
      const [re, im] = fieldAt(600, 0, sample(density));
      return { re, im };
    };

    const coarse = at(4);
    const medium = at(8);
    const fine = at(32);
    const finest = at(64);

    const difference = (a, b) => Math.hypot(a.re - b.re, a.im - b.im);
    const magnitude = Math.hypot(finest.re, finest.im);

    // Successive refinements must get closer together, not merely differ.
    expect(difference(medium, fine)).toBeLessThan(difference(coarse, medium));
    expect(difference(fine, finest)).toBeLessThan(difference(medium, fine));
    // And the two finest must agree to well under a percent.
    expect(difference(fine, finest)).toBeLessThan(0.01 * magnitude);
  });

  test('doubling the density does not double the field', () => {
    // The failure mode the weighting prevents, stated directly.
    const { sample } = makeLine({ length: 200 });
    const a = fieldAmplitudes(fieldAt(600, 0, sample(8)))[0];
    const b = fieldAmplitudes(fieldAt(600, 0, sample(16)))[0];
    expect(b / a).toBeCloseTo(1, 2);
  });
});

describe('phase profiles', () => {
  test('a linear phase ramp steers the beam to the expected angle', () => {
    // phi(u) = k sin(theta) u makes the far field peak at theta, the standard
    // phased-array result.
    const steer = 20 * Math.PI / 180;
    const { sample } = makeLine({
      length: 400,
      eqnPhase: `${K * Math.sin(steer)}\\cdot u`,
    });
    const sources = sample(16);

    const radius = 40000;
    let bestAngle = null;
    let bestAmplitude = -1;
    for (let degrees = -60; degrees <= 60; degrees += 0.5) {
      const angle = degrees * Math.PI / 180;
      const amplitude = fieldAmplitudes(
        fieldAt(radius * Math.cos(angle), radius * Math.sin(angle), sources)
      )[0];
      if (amplitude > bestAmplitude) {
        bestAmplitude = amplitude;
        bestAngle = degrees;
      }
    }
    expect(bestAngle).toBeCloseTo(20, 0);
  });

  test('an unsteered line radiates strongest along its normal', () => {
    const { sample } = makeLine({ length: 400 });
    const sources = sample(16);
    const radius = 40000;
    const amplitudeAt = (degrees) => {
      const angle = degrees * Math.PI / 180;
      return fieldAmplitudes(
        fieldAt(radius * Math.cos(angle), radius * Math.sin(angle), sources)
      )[0];
    };
    expect(amplitudeAt(0)).toBeGreaterThan(amplitudeAt(10));
    expect(amplitudeAt(0)).toBeGreaterThan(amplitudeAt(-10));
  });

  test('a quadratic phase profile brings the field to a focus', () => {
    // phi(u) = -k u^2 / (2 f) is the thin-lens phase; the field on axis must
    // peak near u = f rather than decaying monotonically.
    const focal = 600;
    const { sample } = makeLine({
      length: 400,
      eqnPhase: `-${K / (2 * focal)}\\cdot u^2`,
    });
    const sources = sample(16);
    const onAxis = (x) => fieldAmplitudes(fieldAt(x, 0, sources))[0];

    expect(onAxis(focal)).toBeGreaterThan(onAxis(focal / 3));
    expect(onAxis(focal)).toBeGreaterThan(onAxis(focal * 3));
  });
});

describe('error handling', () => {
  test('an unparseable equation is reported instead of throwing', () => {
    const { line, sample } = makeLine({ eqnAmplitude: '\\frac{' });
    expect(sample(8)).toEqual([]);
    expect(line.getError()).toBeTruthy();
  });

  test('a valid equation clears a previous error', () => {
    const { line, scene, settings } = makeLine({ eqnAmplitude: '\\frac{' });
    line.getWaveSources({ scene, settings, samplesPerWavelength: 8 });
    expect(line.getError()).toBeTruthy();

    line.eqnAmplitude = '1';
    expect(line.getWaveSources({ scene, settings, samplesPerWavelength: 8 }).length)
      .toBeGreaterThan(0);
    expect(line.getError()).toBeNull();
  });

  test('a degenerate line contributes nothing', () => {
    const { line, scene, settings } = makeLine();
    line.p2 = { ...line.p1 };
    expect(line.getWaveSources({ scene, settings, samplesPerWavelength: 8 })).toEqual([]);
    expect(line.getWaveSourceCount({ settings, samplesPerWavelength: 8 })).toBe(0);
  });
});

describe('the source budget', () => {
  test('counts sources without sampling them', () => {
    const { scene, settings } = makeLine({ length: 200 });
    scene.objs.push(Object.assign(new WavePointSource(scene), { x: 5, y: 5 }));
    const context = { scene, settings, samplesPerWavelength: 8 };

    expect(countWaveSources(scene, context))
      .toBe(collectWaveSources(scene, context).length);
  });

  test('lowers the density uniformly rather than dropping sources', () => {
    const { scene, settings } = makeLine({ length: 200 });
    // Ask for far more samples than the budget allows.
    settings.sourceDensity = 1e5;
    const density = resolveSourceDensity(scene, settings);

    expect(density.isReduced).toBe(true);
    expect(density.samplesPerWavelength).toBeLessThan(1e5);

    const sources = collectWaveSources(scene, {
      scene, settings, samplesPerWavelength: density.samplesPerWavelength
    });
    expect(sources.length).toBeLessThanOrEqual(MAX_SOURCES + 1);
    expect(sources.length).toBeGreaterThan(MAX_SOURCES * 0.9);

    // The line is still sampled over its whole length, not truncated.
    expect(Math.max(...sources.map((s) => s.y))).toBeGreaterThan(99);
    expect(Math.min(...sources.map((s) => s.y))).toBeLessThan(-99);
  });

  test('leaves a scene within budget alone', () => {
    const { scene, settings } = makeLine({ length: 200 });
    const density = resolveSourceDensity(scene, settings);
    expect(density.isReduced).toBe(false);
    expect(density.samplesPerWavelength).toBe(settings.sourceDensity);
  });
});
