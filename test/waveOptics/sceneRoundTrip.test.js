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
 * Saving, loading and the built-in examples.
 *
 * The wave app inherits its file format from the ray simulator's `Scene`, so
 * what needs checking is that the new object types and the nested `waveOptics`
 * settings survive a round trip, and that every example actually builds a
 * scene the engine can run.
 */

import Scene from '../../src/core/Scene.js';
import { EXAMPLE_SCENES, buildExampleScene } from '../../src/waveApp/exampleScenes.js';
import { buildWaveModel } from '../../src/core/waveOptics/waveSceneModel.js';
import { computeModelFieldAt, fieldAmplitudes } from '../../src/core/waveOptics/WaveFieldEngineCpu.js';

/** Load JSON into a fresh scene, failing loudly on a parse error. */
function load(json) {
  const scene = new Scene();
  let completed = false;
  scene.loadJSON(json, () => { completed = true; });
  expect(completed).toBe(true);
  expect(scene.error).toBeFalsy();
  return scene;
}

describe('scene serialization', () => {
  test('wave objects survive a save and load', () => {
    const original = new Scene();
    original.waveOptics.wavelength = 12.5;
    original.waveOptics.view = 'amplitudePhase';
    original.waveOptics.sourceDensity = 11;
    original.objs = [];

    original.pushObj(new (require('../../src/core/sceneObjs/wave/WavePointSource.js').default)(
      original, { type: 'WavePointSource', x: 10, y: 20, amplitude: 0.6, phase: 45 }
    ));
    original.pushObj(new (require('../../src/core/sceneObjs/wave/WaveLineSource.js').default)(
      original, {
        type: 'WaveLineSource', p1: { x: 0, y: -50 }, p2: { x: 0, y: 50 },
        amplitude: 2, eqnAmplitude: '\\exp(-u^2/900)', eqnPhase: '0.15\\cdot u',
      }
    ));
    original.pushObj(new (require('../../src/core/sceneObjs/wave/WaveInterface.js').default)(
      original, {
        type: 'WaveInterface', p1: { x: 100, y: -80 }, p2: { x: 100, y: 80 },
        refractiveIndexAfter: 1.62, eqnSag: 'y^2/700',
        eqnAmplitude: '1', eqnPhase: '-0.0003\\cdot y^2',
      }
    ));

    const reloaded = load(original.toJSON());

    expect(reloaded.objs.map((o) => o.constructor.type))
      .toEqual(['WavePointSource', 'WaveLineSource', 'WaveInterface']);
    expect(reloaded.waveOptics.wavelength).toBe(12.5);
    expect(reloaded.waveOptics.view).toBe('amplitudePhase');
    expect(reloaded.waveOptics.sourceDensity).toBe(11);

    const [point, line, surface] = reloaded.objs;
    expect(point.amplitude).toBe(0.6);
    expect(point.phase).toBe(45);
    expect(line.eqnAmplitude).toBe('\\exp(-u^2/900)');
    expect(line.eqnPhase).toBe('0.15\\cdot u');
    expect(surface.refractiveIndexAfter).toBe(1.62);
    expect(surface.eqnSag).toBe('y^2/700');
    expect(surface.eqnPhase).toBe('-0.0003\\cdot y^2');

    // A second round trip must be a fixed point.
    expect(load(reloaded.toJSON()).toJSON()).toBe(reloaded.toJSON());
  });

  test('wave settings left at their defaults are not written out', () => {
    // Keeps saved scenes small and diffable, as for every other scene setting.
    const scene = new Scene();
    expect(scene.toJSON()).not.toContain('waveOptics');

    scene.waveOptics.wavelength = 37;
    expect(scene.toJSON()).toContain('"wavelength": 37');
  });
});

describe('the built-in examples', () => {
  const VIEWPORT = { width: 1500, height: 900 };

  test('every example has a unique id and a description', () => {
    const ids = EXAMPLE_SCENES.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of EXAMPLE_SCENES) {
      expect(entry.name).toBeTruthy();
      expect(entry.description).toBeTruthy();
    }
  });

  test.each(EXAMPLE_SCENES.map((entry) => [entry.id]))(
    '%s loads and produces a field',
    (id) => {
      const scene = load(buildExampleScene(id, VIEWPORT.width, VIEWPORT.height));
      scene.setViewportSize(VIEWPORT.width, VIEWPORT.height);

      // Every object must be free of errors, which is what catches an example
      // whose equations do not parse.
      for (const obj of scene.objs) {
        expect(obj.getError?.() ?? null).toBeNull();
      }

      const model = buildWaveModel(scene);
      expect(model.diagnostics.sourceCount).toBeGreaterThan(0);
      expect(model.warnings).toEqual([]);
      expect(model.diagnostics.isSourceUndersampled).toBe(false);

      // Equations are only evaluated during sampling, so check afterwards too.
      for (const obj of scene.objs) {
        expect(obj.getError?.() ?? null).toBeNull();
      }

      // And the field it produces must be finite and non-trivial somewhere.
      const probes = [];
      for (let i = 1; i < 10; i++) {
        probes.push({ x: VIEWPORT.width * i / 10, y: VIEWPORT.height * 0.5 });
      }
      const amplitudes = fieldAmplitudes(computeModelFieldAt(model, probes));
      expect(amplitudes.every(Number.isFinite)).toBe(true);
      expect(Math.max(...amplitudes)).toBeGreaterThan(0);
    },
    30000
  );

  test('an unknown example id yields nothing rather than throwing', () => {
    expect(buildExampleScene('not-an-example', 1500, 900)).toBeNull();
  });

  test('examples scale to the viewport they are built for', () => {
    const small = JSON.parse(buildExampleScene('lens', 800, 500));
    const large = JSON.parse(buildExampleScene('lens', 1600, 1000));
    const lensX = (data) => data.objs.find((o) => o.type === 'WaveLens').p1.x;
    expect(lensX(large)).toBeCloseTo(2 * lensX(small), 6);
  });
});
