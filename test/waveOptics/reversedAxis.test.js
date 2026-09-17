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
import WaveLineSource from '../../src/core/sceneObjs/wave/WaveLineSource.js';
import WavePlaneWave from '../../src/core/sceneObjs/wave/WavePlaneWave.js';
import WaveInterface from '../../src/core/sceneObjs/wave/WaveInterface.js';
import {
  buildWaveModel, collectInterfaces, resolveWaveSettings
} from '../../src/core/waveOptics/waveSceneModel.js';
import {
  computeModelFieldAt, fieldAmplitudes
} from '../../src/core/waveOptics/WaveFieldEngineCpu.js';

const WAVELENGTH = 20;
const MIRROR = 800;

/**
 * The same optical system twice: once running left to right, once running right
 * to left with every x coordinate mirrored. Nothing about the physics changed,
 * so every measurement has to come out the same.
 *
 * @param {boolean} reversed
 * @returns {Scene}
 */
function buildScene(reversed) {
  const at = (x) => (reversed ? MIRROR - x : x);
  const scene = new Scene();
  scene.setViewportSize(1600, 800);
  scene.waveOptics.wavelength = WAVELENGTH;
  scene.waveOptics.sourceDensity = 8;
  scene.waveOptics.reversed = reversed;

  const source = new WaveLineSource(scene);
  source.p1 = { x: at(150), y: 300 };
  source.p2 = { x: at(150), y: 500 };
  source.amplitude = 1;
  scene.objs.push(source);

  const first = new WaveInterface(scene, {
    p1: { x: at(400), y: -400 }, p2: { x: at(400), y: 1200 },
    refractiveIndexAfter: 1.6,
  });
  const second = new WaveInterface(scene, {
    p1: { x: at(600), y: -400 }, p2: { x: at(600), y: 1200 },
    refractiveIndexAfter: 1, eqnAmplitude: '0.5',
  });
  // Pushed in the wrong order on purpose: the stack is built from the geometry,
  // not from the order objects happen to sit in the scene.
  scene.objs.push(second, first);
  return scene;
}

describe('reversed optical axis', () => {
  test('orders the surfaces along the direction of travel', () => {
    const forward = collectInterfaces(buildScene(false), 1);
    const backward = collectInterfaces(buildScene(true), -1);

    // The first surface the light meets is at 400 either way, which is x = 400
    // going one way and x = 400 mirrored going the other.
    expect(forward[0].meanZ()).toBeCloseTo(400, 6);
    expect(backward[0].meanZ()).toBeCloseTo(MIRROR - 400, 6);
    expect(forward[0].refractiveIndexAfter).toBeCloseTo(1.6, 9);
    expect(backward[0].refractiveIndexAfter).toBeCloseTo(1.6, 9);
  });

  test('points the surface normal the way the light is going', () => {
    const context = (scene) => ({
      scene,
      settings: resolveWaveSettings(scene),
      samplesPerWavelength: 8,
      axisSign: scene.waveOptics.reversed ? -1 : 1,
    });

    const forward = collectInterfaces(buildScene(false), 1)[0];
    const scene = buildScene(true);
    const backward = collectInterfaces(scene, -1)[0];

    expect(forward.getSurfaceSamples(context(buildScene(false)))[0].nx)
      .toBeCloseTo(1, 9);
    expect(backward.getSurfaceSamples(context(scene))[0].nx).toBeCloseTo(-1, 9);
  });

  test('produces the mirror image of the same system', () => {
    const probes = [];
    for (let x = 250; x <= 780; x += 40) {
      for (const y of [340, 400, 460, 560]) probes.push({ x, y });
    }

    const forward = fieldAmplitudes(computeModelFieldAt(
      buildWaveModel(buildScene(false), { resolution: 64 }), probes
    ));
    const backward = fieldAmplitudes(computeModelFieldAt(
      buildWaveModel(buildScene(true), { resolution: 64 }),
      probes.map((p) => ({ x: MIRROR - p.x, y: p.y }))
    ));

    expect(Math.max(...forward)).toBeGreaterThan(0);
    for (let i = 0; i < probes.length; i++) {
      expect(backward[i]).toBeCloseTo(forward[i], 9);
    }
  }, 30000);

  test('does not report well-separated surfaces as overlapping', () => {
    // The check is "does the next surface start before the previous one ends",
    // and which end is which swaps when the axis does. Compared as raw x it
    // reported every reversed scene with two surfaces as ambiguous.
    for (const reversed of [false, true]) {
      const model = buildWaveModel(buildScene(reversed), { resolution: 32 });
      expect(model.warnings).not.toContain('interfacesOverlap');
    }
  });

  test('lambda in an equation tracks the scene wavelength', () => {
    const scene = new Scene();
    scene.setViewportSize(1600, 800);
    scene.waveOptics.wavelength = WAVELENGTH;
    const surface = new WaveInterface(scene, {
      p1: { x: 400, y: 200 }, p2: { x: 400, y: 600 },
      // The wavenumber, written in terms of the wavelength rather than as a
      // number: a tilt that stays the same *angle* when the wavelength changes.
      eqnPhase: '\\frac{2\\pi}{\\lambda}\\cdot0.5\\cdot y',
    });
    scene.objs.push(surface);

    expect(surface.transmissionAt(10).phase)
      .toBeCloseTo(2 * Math.PI / WAVELENGTH * 5, 9);

    scene.waveOptics.wavelength = WAVELENGTH / 2;
    expect(surface.transmissionAt(10).phase)
      .toBeCloseTo(2 * Math.PI / (WAVELENGTH / 2) * 5, 9);
  });

  test('aims a plane wave along the reversed axis', () => {
    const scene = new Scene();
    scene.setViewportSize(1600, 800);
    scene.waveOptics.wavelength = WAVELENGTH;
    scene.waveOptics.reversed = true;
    const wave = new WavePlaneWave(scene);
    Object.assign(wave, { x: 800, y: 400, angle: 0, amplitude: 1, phase: 0 });
    scene.objs.push(wave);

    // An angle of zero is along the optical axis, which now points at -x.
    expect(wave.direction().x).toBeCloseTo(-1, 9);

    // A quarter wavelength further along that axis is a quarter turn of phase.
    const model = buildWaveModel(scene, { resolution: 64 });
    const field = computeModelFieldAt(model, [
      { x: 800, y: 400 }, { x: 800 - WAVELENGTH / 4, y: 400 },
    ]);
    expect(Math.atan2(field[3], field[2])).toBeCloseTo(Math.PI / 2, 6);
  });
});
