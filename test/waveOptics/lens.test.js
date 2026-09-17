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

import Scene from '../../src/core/Scene.js';
import WaveLens from '../../src/core/sceneObjs/wave/WaveLens.js';
import WaveLineSource from '../../src/core/sceneObjs/wave/WaveLineSource.js';
import { buildWaveModel, collectInterfaces } from '../../src/core/waveOptics/waveSceneModel.js';
import {
  computeModelFieldAt, fieldAmplitudes
} from '../../src/core/waveOptics/WaveFieldEngineCpu.js';

const WAVELENGTH = 10;

function makeScene() {
  const scene = new Scene();
  scene.waveOptics.wavelength = WAVELENGTH;
  scene.waveOptics.sourceDensity = 8;
  return scene;
}

function addLens(scene, { x = 300, half = 90, ...rest } = {}) {
  const lens = new WaveLens(scene);
  lens.p1 = { x, y: -half };
  lens.p2 = { x, y: half };
  Object.assign(lens, rest);
  scene.objs.push(lens);
  return lens;
}

/** A collimated input, built as a line source with a flat phase. */
function addCollimatedBeam(scene, { x = 40, half = 80 } = {}) {
  const source = new WaveLineSource(scene);
  source.p1 = { x, y: -half };
  source.p2 = { x, y: half };
  source.amplitude = 1;
  scene.objs.push(source);
  return source;
}

/** The axial position of the brightest point on the axis, past the lens. */
function axialPeak(scene, from, to, steps = 160) {
  const points = [];
  for (let i = 0; i <= steps; i++) {
    points.push({ x: from + (to - from) * i / steps, y: 0 });
  }
  const amplitudes = fieldAmplitudes(computeModelFieldAt(buildWaveModel(scene), points));
  let best = 0;
  for (let i = 1; i < amplitudes.length; i++) {
    if (amplitudes[i] > amplitudes[best]) best = i;
  }
  return { x: points[best].x, amplitude: amplitudes[best] };
}

describe('lens geometry', () => {
  test('presents two surfaces with the glass between them', () => {
    const scene = makeScene();
    const lens = addLens(scene, { focalLength: 300, refractiveIndex: 1.5 });

    const surfaces = collectInterfaces(scene);
    expect(surfaces).toHaveLength(2);
    // Ordered along the axis, with the glass index in force between them and
    // the surrounding index restored after.
    expect(surfaces[0].meanZ()).toBeLessThan(surfaces[1].meanZ());
    expect(surfaces[0].refractiveIndexAfter).toBeCloseTo(1.5, 9);
    expect(surfaces[1].refractiveIndexAfter).toBeCloseTo(1, 9);

    // The lensmaker's equation for a symmetric lens: R = 2 f (n/n0 - 1).
    expect(lens.radiusOfCurvature()).toBeCloseTo(2 * 300 * 0.5, 9);
  });

  test('is thickest on the axis when converging and thinnest when diverging', () => {
    const scene = makeScene();
    const lens = addLens(scene, { focalLength: 300, thickness: 8 });
    const edgeSag = lens.sagAt(lens.halfAperture());
    expect(edgeSag).toBeGreaterThan(0);
    // `thickness` is the thinnest part, which for a converging lens is the rim.
    expect(lens.centerThickness()).toBeCloseTo(8 + 2 * edgeSag, 9);

    lens.focalLength = -300;
    expect(lens.sagAt(lens.halfAperture())).toBeLessThan(0);
    // Now the centre is the thinnest part, so it is the stated thickness.
    expect(lens.centerThickness()).toBeCloseTo(8, 9);
  });

  test('a flatter lens comes of a higher index at the same focal length', () => {
    const scene = makeScene();
    const lens = addLens(scene, { focalLength: 300, refractiveIndex: 1.5 });
    const curved = Math.abs(lens.radiusOfCurvature());
    lens.refractiveIndex = 2.5;
    expect(Math.abs(lens.radiusOfCurvature())).toBeGreaterThan(curved);
  });
});

describe('lens optics', () => {
  test('brings a collimated beam to a focus near its focal length', () => {
    const focalLength = 300;
    const scene = makeScene();
    addCollimatedBeam(scene, { x: 40, half: 100 });
    const lens = addLens(scene, { x: 300, half: 110, focalLength, thickness: 6 });

    const center = lens.center().x;
    const peak = axialPeak(scene, center + 0.4 * focalLength, center + 1.6 * focalLength);

    // Nothing is arranged to put the focus at the focal length: it comes out of
    // refraction at two spherical surfaces and lands a little short, because
    // the principal planes of a thick lens sit inside the glass and spherical
    // aberration pulls the marginal rays in further. For this lens the
    // thick-lens back focal distance predicts about 0.96 f from the centre, and
    // the measurement lands a few per cent inside that.
    expect(peak.x).toBeGreaterThan(center + 0.8 * focalLength);
    expect(peak.x).toBeLessThan(center + 1.05 * focalLength);
  }, 60000);

  test('concentrates the beam far more than the same aperture with no glass', () => {
    const focalLength = 300;
    const build = (refractiveIndex) => {
      const scene = makeScene();
      addCollimatedBeam(scene, { x: 40, half: 100 });
      addLens(scene, { x: 300, half: 110, focalLength, thickness: 6, refractiveIndex });
      return scene;
    };

    // At an index of one the two surfaces are index-matched to their
    // surroundings, so the "lens" is a bare aperture and nothing focuses.
    const focused = axialPeak(build(1.5), 300 + 0.4 * focalLength, 300 + 1.6 * focalLength);
    const flat = axialPeak(build(1), 300 + 0.4 * focalLength, 300 + 1.6 * focalLength);
    expect(focused.amplitude).toBeGreaterThan(2.5 * flat.amplitude);
  }, 60000);

  test('a diverging lens produces no axial focus at all', () => {
    const focalLength = 300;
    const scene = makeScene();
    addCollimatedBeam(scene, { x: 40, half: 100 });
    const lens = addLens(scene, { x: 300, half: 110, focalLength: -focalLength, thickness: 6 });

    const center = lens.center().x;
    const diverging = axialPeak(scene, center + 0.4 * focalLength, center + 1.6 * focalLength);

    lens.focalLength = focalLength;
    const converging = axialPeak(scene, center + 0.4 * focalLength, center + 1.6 * focalLength);
    expect(converging.amplitude).toBeGreaterThan(2.5 * diverging.amplitude);
  }, 60000);
});
