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
import WavePlaneWave from '../../src/core/sceneObjs/wave/WavePlaneWave.js';
import WaveSquareGrating from '../../src/core/sceneObjs/wave/WaveSquareGrating.js';
import WaveSinusoidalGrating from '../../src/core/sceneObjs/wave/WaveSinusoidalGrating.js';
import WaveMultiSlit from '../../src/core/sceneObjs/wave/WaveMultiSlit.js';
import WaveZonePlate from '../../src/core/sceneObjs/wave/WaveZonePlate.js';
import WaveBinaryMask from '../../src/core/sceneObjs/wave/WaveBinaryMask.js';
import { buildWaveModel, resolveWaveSettings } from '../../src/core/waveOptics/waveSceneModel.js';
import {
  computeModelFieldAt, computeFieldAt, fieldAmplitudes
} from '../../src/core/waveOptics/WaveFieldEngineCpu.js';
import { wavenumber } from '../../src/core/waveOptics/conventions.js';

const WAVELENGTH = 20;
const K = wavenumber(WAVELENGTH, 1);

function makeScene(sourceDensity = 8) {
  const scene = new Scene();
  scene.waveOptics.wavelength = WAVELENGTH;
  scene.waveOptics.sourceDensity = sourceDensity;
  return scene;
}

/** Add an element of the given class spanning a transverse range. */
function addElement(scene, Type, { x, half, ...rest }) {
  const element = new Type(scene);
  element.p1 = { x, y: -half };
  element.p2 = { x, y: half };
  Object.assign(element, rest);
  scene.objs.push(element);
  return element;
}

function addPlaneWave(scene, { x = 0, y = 0, angle = 0 } = {}) {
  const wave = new WavePlaneWave(scene);
  Object.assign(wave, { x, y, angle, amplitude: 1, phase: 0 });
  scene.objs.push(wave);
  return wave;
}

const amplitudesAt = (scene, points) =>
  fieldAmplitudes(computeModelFieldAt(buildWaveModel(scene), points));

/** Far-field amplitude as a function of sin(theta), for a grating at x = 0. */
function farFieldScan(scene, sines, radius = 120000) {
  const points = sines.map((sinTheta) => {
    const theta = Math.asin(sinTheta);
    return { x: radius * Math.cos(theta), y: radius * Math.sin(theta) };
  });
  return amplitudesAt(scene, points);
}

describe('plane wave', () => {
  test('has uniform amplitude and advances its phase along its direction', () => {
    const scene = makeScene();
    addPlaneWave(scene, { x: 0, y: 0, angle: 0 });
    const model = buildWaveModel(scene);

    const [a, b, c] = fieldAmplitudes(computeModelFieldAt(model, [
      { x: 100, y: 0 }, { x: 900, y: 0 }, { x: 500, y: 600 },
    ]));
    // No spreading and no falloff: that is the point of an ideal plane wave.
    expect(a).toBeCloseTo(1, 6);
    expect(b).toBeCloseTo(1, 6);
    expect(c).toBeCloseTo(1, 6);

    // One wavelength along the direction of travel is one full cycle.
    const field = computeModelFieldAt(model, [{ x: 0, y: 0 }, { x: WAVELENGTH, y: 0 }]);
    expect(Math.atan2(field[1], field[0])).toBeCloseTo(Math.atan2(field[3], field[2]), 6);

    // A quarter wavelength is a quarter turn.
    const quarter = computeModelFieldAt(model, [{ x: 0, y: 0 }, { x: WAVELENGTH / 4, y: 0 }]);
    expect(Math.atan2(quarter[3], quarter[2])).toBeCloseTo(Math.PI / 2, 5);
  });

  test('travels in the stated direction', () => {
    const scene = makeScene();
    addPlaneWave(scene, { angle: 30 });
    const model = buildWaveModel(scene);

    // Along the propagation direction the phase advances; across it, it does not.
    const direction = { x: Math.cos(Math.PI / 6), y: Math.sin(Math.PI / 6) };
    const across = { x: -direction.y, y: direction.x };
    const field = computeModelFieldAt(model, [
      { x: 0, y: 0 },
      { x: across.x * 500, y: across.y * 500 },
    ]);
    expect(Math.atan2(field[1], field[0])).toBeCloseTo(Math.atan2(field[3], field[2]), 5);
  });

  test('refracts at an interface according to Snells law', () => {
    // The cleanest possible refraction test: an ideal input, so the measured
    // angle carries no aperture diffraction of its own.
    const incidence = 40;
    const index = 1.5;
    const scene = makeScene();
    addPlaneWave(scene, { x: 0, y: 0, angle: incidence });
    addElement(scene, require('../../src/core/sceneObjs/wave/WaveInterface.js').default, {
      x: 300, half: 4000, refractiveIndexAfter: index,
    });
    const model = buildWaveModel(scene);

    // Recover the transmitted direction from the transverse phase gradient,
    // which is what phase matching fixes: k2 sin(theta2) = k1 sin(theta1).
    const k2 = wavenumber(WAVELENGTH, index);
    const step = 1;
    const field = computeModelFieldAt(model, [
      { x: 1000, y: 0 }, { x: 1000, y: step },
    ]);
    const gradient = wrapToPi(
      Math.atan2(field[3], field[2]) - Math.atan2(field[1], field[0])
    ) / step;
    const transmitted = Math.asin(gradient / k2) * 180 / Math.PI;
    expect(transmitted).toBeCloseTo(
      Math.asin(Math.sin(incidence * Math.PI / 180) / index) * 180 / Math.PI, 0
    );
  });
});

describe('square grating', () => {
  test('is opaque over the duty fraction of each period', () => {
    const scene = makeScene();
    const grating = addElement(scene, WaveSquareGrating, {
      x: 0, half: 200, pitch: 40, dutyCycle: 0.25,
    });
    // Bars occupy the first quarter of each period.
    expect(grating.transmissionAt(2).amplitude).toBe(0);
    expect(grating.transmissionAt(20).amplitude).toBe(1);
    expect(grating.transmissionAt(42).amplitude).toBe(0);
    // And the pattern is periodic through negative y.
    expect(grating.transmissionAt(-38).amplitude).toBe(0);
    expect(grating.transmissionAt(-20).amplitude).toBe(1);
  });

  test('reports its narrowest bar or gap', () => {
    const scene = makeScene();
    const grating = addElement(scene, WaveSquareGrating, {
      x: 0, half: 200, pitch: 40, dutyCycle: 0.1,
    });
    expect(grating.minimumFeatureSize()).toBeCloseTo(4, 9);
  });

  test('a bar narrower than the sampling still sets the order strengths', () => {
    // The duty cycle is what divides light between the orders, and at a low
    // duty the bar is a fraction of a wavelength wide — far below the sample
    // spacing. Cell averaging is what carries it, so this is the test that the
    // sampling rule is allowed to stop refining at the wavelength.
    const pitch = 60;
    const build = (dutyCycle) => {
      const scene = makeScene();
      addPlaneWave(scene, { x: 0, y: 0 });
      addElement(scene, WaveSquareGrating, {
        x: 200, half: 15 * pitch, pitch, dutyCycle,
      });
      return scene;
    };

    const order = WAVELENGTH / pitch;
    // For bars of transmission zero the Fourier coefficients of the profile are
    // c0 = 1 - d and cm = -d sinc(m d), so the first order relative to the
    // zeroth is a pure function of the duty cycle. Taking the ratio at a fixed
    // angle cancels the obliquity factor, which the infinite-grating result
    // does not carry.
    const sinc = (x) => (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x));

    for (const duty of [0.1, 0.25, 0.5]) {
      const [zeroth, first] = farFieldScan(build(duty), [0, order], 200000);
      const predicted = duty * Math.abs(sinc(duty)) / (1 - duty);
      expect(first / zeroth).toBeGreaterThan(0.92 * predicted);
      expect(first / zeroth).toBeLessThan(1.08 * predicted);
    }
  }, 60000);

  test('diffracts into orders at sin(theta) = m lambda / pitch', () => {
    const pitch = 60;
    const scene = makeScene();
    addPlaneWave(scene, { x: 0, y: 0 });
    addElement(scene, WaveSquareGrating, {
      x: 200, half: 15 * pitch, pitch, dutyCycle: 0.5,
    });

    const order = WAVELENGTH / pitch;
    const [zeroth, first, between, second] = farFieldScan(
      scene, [0, order, order * 1.5, 2 * order]
    );
    expect(first).toBeGreaterThan(5 * between);
    expect(zeroth).toBeGreaterThan(between);
    // A half duty cycle cancels the even orders.
    expect(second).toBeLessThan(0.2 * first);
  });
});

describe('sinusoidal phase grating', () => {
  test('imposes the stated peak-to-peak phase and no absorption', () => {
    const scene = makeScene();
    const grating = addElement(scene, WaveSinusoidalGrating, {
      x: 0, half: 200, pitch: 40, maxPhaseShift: 2,
    });
    expect(grating.transmissionAt(10).phase).toBeCloseTo(1, 9);
    expect(grating.transmissionAt(30).phase).toBeCloseTo(-1, 9);
    expect(grating.transmissionAt(0).amplitude).toBe(1);
    expect(grating.transmissionAt(17).amplitude).toBe(1);
  });

  test('its zeroth order vanishes at the first zero of J0', () => {
    // The order amplitudes are J_m of half the peak-to-peak shift, so the
    // zeroth order disappears at a peak-to-peak shift of 2 * 2.405.
    const pitch = 60;
    const build = (maxPhaseShift) => {
      const scene = makeScene();
      addPlaneWave(scene, { x: 0, y: 0 });
      addElement(scene, WaveSinusoidalGrating, {
        x: 200, half: 15 * pitch, pitch, maxPhaseShift,
      });
      return scene;
    };

    const onAxis = (shift) => farFieldScan(build(shift), [0])[0];
    const reference = onAxis(0.2);
    expect(onAxis(2 * 2.405)).toBeLessThan(0.1 * reference);
    // Away from the zero it comes back.
    expect(onAxis(2 * 4.0)).toBeGreaterThan(0.2 * reference);
  });
});

describe('N slits', () => {
  test('places slits symmetrically about the centre', () => {
    const scene = makeScene();
    const single = addElement(scene, WaveMultiSlit, {
      x: 0, half: 200, slitCount: 1, slitWidth: 20,
    });
    expect(single.transmissionAt(0).amplitude).toBe(1);
    expect(single.transmissionAt(30).amplitude).toBe(0);

    single.slitCount = 2;
    single.slitSpacing = 100;
    // An even count straddles the axis.
    expect(single.transmissionAt(0).amplitude).toBe(0);
    expect(single.transmissionAt(50).amplitude).toBe(1);
    expect(single.transmissionAt(-50).amplitude).toBe(1);
  });

  test('more slits sharpen the fringes without moving them', () => {
    const spacing = 80;
    const build = (slitCount) => {
      const scene = makeScene();
      addPlaneWave(scene, { x: 0, y: 0 });
      addElement(scene, WaveMultiSlit, {
        x: 200, half: 400, slitCount, slitWidth: 12, slitSpacing: spacing,
      });
      return scene;
    };

    const order = WAVELENGTH / spacing;
    // The principal maximum stays at sin(theta) = lambda / spacing...
    const peakOf = (n) => farFieldScan(build(n), [order])[0];
    const midOf = (n) => farFieldScan(build(n), [order * 0.5])[0];

    // ...and the light between orders is pushed down as slits are added.
    expect(midOf(2) / peakOf(2)).toBeGreaterThan(midOf(8) / peakOf(8));
  }, 30000);

  test('resolves the narrower of the slit and the gap', () => {
    const scene = makeScene();
    const slits = addElement(scene, WaveMultiSlit, {
      x: 0, half: 300, slitCount: 3, slitWidth: 50, slitSpacing: 60,
    });
    expect(slits.minimumFeatureSize()).toBeCloseTo(10, 9);
  });

  test('slits closer together than they are wide merge into one opening', () => {
    const scene = makeScene();
    const slits = addElement(scene, WaveMultiSlit, {
      x: 0, half: 300, slitCount: 2, slitWidth: 60, slitSpacing: 60,
    });

    // Raising the count on a wide slit whose spacing has never been touched
    // used to leave a gap of zero, which asked for a step of essentially
    // nothing and froze the tab before the first frame.
    expect(slits.minimumFeatureSize()).toBeCloseTo(120, 9);
    expect(slits.getWarning()).toBeTruthy();

    const context = {
      scene, settings: resolveWaveSettings(scene), samplesPerWavelength: 8,
    };
    expect(slits.getSurfaceSampleCount(context)).toBeLessThan(1000);
  });

  test('narrowing a slit past the wavelength does not cost more samples', () => {
    const scene = makeScene();
    const slit = addElement(scene, WaveMultiSlit, {
      x: 0, half: 300, slitCount: 1, slitWidth: WAVELENGTH,
    });
    const context = {
      scene, settings: resolveWaveSettings(scene), samplesPerWavelength: 8,
    };
    const countAt = (width) => {
      slit.slitWidth = width;
      return slit.getSurfaceSampleCount(context);
    };

    // An opening has no propagating structure below half a wavelength, so
    // narrowing it must never cost sources: it is turning into a point source,
    // which is the cheapest thing there is.
    const coarse = countAt(2 * WAVELENGTH);
    for (const width of [WAVELENGTH, WAVELENGTH / 2, WAVELENGTH / 8, WAVELENGTH / 100]) {
      expect(countAt(width)).toBeLessThanOrEqual(coarse);
    }
  });

  test('a sub-sample slit transmits in proportion to its width, wherever it sits', () => {
    // Point sampling made this depend on whether a sample happened to fall
    // inside the opening, so the same slit flickered between full and no
    // transmission as it was dragged. Averaging over the cell makes the
    // transmitted weight the slit's actual width.
    const scene = makeScene();
    const slit = addElement(scene, WaveMultiSlit, {
      x: 0, half: 200, slitCount: 1, slitWidth: WAVELENGTH,
    });
    const context = {
      scene, settings: resolveWaveSettings(scene), samplesPerWavelength: 8,
    };
    const totalWeight = () => slit.getSurfaceSamples(context)
      .reduce((sum, s) => sum + Math.hypot(s.tRe, s.tIm) * s.ds, 0);

    // Well past the point where a slit is narrower than one sample.
    for (const width of [WAVELENGTH, WAVELENGTH / 4, WAVELENGTH / 20]) {
      slit.slitWidth = width;
      expect(totalWeight() / width).toBeCloseTo(1, 6);
    }

    // And it does not matter where the opening falls between two samples.
    slit.slitWidth = WAVELENGTH / 20;
    const aligned = totalWeight();
    const halfCell = 400 / slit.getSurfaceSampleCount(context) / 2;
    slit.p1 = { x: 0, y: -200 + halfCell };
    slit.p2 = { x: 0, y: 200 + halfCell };
    expect(totalWeight()).toBeCloseTo(aligned, 6);
  });
});

describe('Fresnel zone plate', () => {
  test('zones alternate every half wave of extra path', () => {
    const scene = makeScene();
    const plate = addElement(scene, WaveZonePlate, {
      x: 0, half: 300, focalLength: 500,
    });
    // Boundaries at y = sqrt(n lambda f) = sqrt(n * 10000) = 100 sqrt(n).
    expect(plate.transmissionAt(50).amplitude).toBe(1);
    expect(plate.transmissionAt(120).amplitude).toBe(0);
    expect(plate.transmissionAt(150).amplitude).toBe(1);
  });

  test('the phase-reversing form transmits everywhere instead', () => {
    const scene = makeScene();
    const plate = addElement(scene, WaveZonePlate, {
      x: 0, half: 300, focalLength: 500, phaseReversing: true,
    });
    expect(plate.transmissionAt(50)).toEqual({ amplitude: 1, phase: 0 });
    expect(plate.transmissionAt(120)).toEqual({ amplitude: 1, phase: Math.PI });
  });

  test('concentrates light at its focus, unlike a plain aperture', () => {
    // A zone plate keeps a large undiffracted component and has weaker foci at
    // f/3, f/5 and so on, so its on-axis profile is not a single clean peak.
    // What distinguishes it is that it concentrates light at f where an open
    // aperture of the same size does not, which is the comparison made here.
    const WaveInterface = require('../../src/core/sceneObjs/wave/WaveInterface.js').default;
    const focal = 500;
    const half = 260;

    const withPlate = makeScene();
    addPlaneWave(withPlate, { x: 0, y: 0 });
    addElement(withPlate, WaveZonePlate, { x: 200, half, focalLength: focal });

    const openAperture = makeScene();
    addPlaneWave(openAperture, { x: 0, y: 0 });
    addElement(openAperture, WaveInterface, { x: 200, half, refractiveIndexAfter: 1 });

    const atFocus = (scene) => amplitudesAt(scene, [{ x: 200 + focal, y: 0 }])[0];
    expect(atFocus(withPlate)).toBeGreaterThan(1.5 * atFocus(openAperture));

    // And the phase-reversing form concentrates more still, since it uses the
    // zones it would otherwise have thrown away.
    const reversing = makeScene();
    addPlaneWave(reversing, { x: 0, y: 0 });
    addElement(reversing, WaveZonePlate, {
      x: 200, half, focalLength: focal, phaseReversing: true,
    });
    expect(atFocus(reversing)).toBeGreaterThan(atFocus(withPlate));
  }, 30000);

  test('the outermost zone sets the sampling', () => {
    const scene = makeScene();
    const wide = addElement(scene, WaveZonePlate, { x: 0, half: 400, focalLength: 500 });
    const narrow = addElement(scene, WaveZonePlate, { x: 0, half: 100, focalLength: 500 });
    // A larger plate has finer outer zones and so needs finer sampling.
    expect(wide.minimumFeatureSize()).toBeLessThan(narrow.minimumFeatureSize());
  });
});

describe('binary mask', () => {
  test('is open where the function is non-negative', () => {
    const scene = makeScene();
    const mask = addElement(scene, WaveBinaryMask, {
      x: 0, half: 200, eqnMask: '50-\\operatorname{abs}(y)',
    });
    expect(mask.transmissionAt(0).amplitude).toBe(1);
    expect(mask.transmissionAt(49).amplitude).toBe(1);
    expect(mask.transmissionAt(51).amplitude).toBe(0);
  });

  test('measures its own feature size from the pattern', () => {
    const scene = makeScene();
    // A ruling of period 2 pi / 0.15 = 41.9, so bars and gaps of about 20.9.
    const mask = addElement(scene, WaveBinaryMask, {
      x: 0, half: 400, eqnMask: '\\cos(0.15\\cdot y)',
    });
    expect(mask.minimumFeatureSize()).toBeGreaterThan(19);
    expect(mask.minimumFeatureSize()).toBeLessThan(23);

    // A finer pattern is detected as finer.
    mask.eqnMask = '\\cos(0.6\\cdot y)';
    expect(mask.minimumFeatureSize()).toBeLessThan(7);
  });

  test('reproduces the same field as the equivalent general interface', () => {
    const WaveInterface = require('../../src/core/sceneObjs/wave/WaveInterface.js').default;
    const probes = [{ x: 700, y: 0 }, { x: 700, y: 200 }, { x: 1200, y: -120 }];

    const masked = makeScene();
    addPlaneWave(masked, { x: 0, y: 0 });
    addElement(masked, WaveBinaryMask, {
      x: 200, half: 300, eqnMask: '50-\\operatorname{abs}(y)',
    });

    const explicit = makeScene();
    addPlaneWave(explicit, { x: 0, y: 0 });
    addElement(explicit, WaveInterface, {
      x: 200, half: 300,
      refractiveIndexAfter: 1,
      eqnAmplitude: '\\max(0,\\operatorname{sign}(50-\\operatorname{abs}(y)))',
    });

    const fromMask = amplitudesAt(masked, probes);
    const fromEquation = amplitudesAt(explicit, probes);
    for (let i = 0; i < probes.length; i++) {
      expect(fromMask[i]).toBeCloseTo(fromEquation[i], 6);
    }
  });
});

function wrapToPi(angle) {
  return angle - Math.PI * 2 * Math.round(angle / (Math.PI * 2));
}
