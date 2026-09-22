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
import WavePointSource from '../../src/core/sceneObjs/wave/WavePointSource.js';
import WaveLineSource from '../../src/core/sceneObjs/wave/WaveLineSource.js';
import WaveInterface from '../../src/core/sceneObjs/wave/WaveInterface.js';
import {
  buildWaveModel, buildSubspaceStack, collectInterfaces, subspaceIndexAt,
  resolveWaveSettings
} from '../../src/core/waveOptics/waveSceneModel.js';
import {
  computeModelFieldAt, propagateChain, fieldAmplitudes
} from '../../src/core/waveOptics/WaveFieldEngineCpu.js';
import { greensFunction } from '../../src/core/waveOptics/hankel.js';
import { wavenumber } from '../../src/core/waveOptics/conventions.js';

const WAVELENGTH = 20;
const K = wavenumber(WAVELENGTH, 1);

function makeScene({ sourceDensity = 8, backgroundIndex = 1 } = {}) {
  const scene = new Scene();
  scene.waveOptics.wavelength = WAVELENGTH;
  scene.waveOptics.refractiveIndex = backgroundIndex;
  scene.waveOptics.sourceDensity = sourceDensity;
  return scene;
}

function addInterface(scene, { x, y0, y1, indexAfter = 1, ...rest }) {
  const surface = new WaveInterface(scene);
  surface.p1 = { x, y: y0 };
  surface.p2 = { x, y: y1 };
  surface.refractiveIndexAfter = indexAfter;
  Object.assign(surface, rest);
  scene.objs.push(surface);
  return surface;
}

function addLineSource(scene, { x, y0, y1, ...rest }) {
  const line = new WaveLineSource(scene);
  line.p1 = { x, y: y0 };
  line.p2 = { x, y: y1 };
  line.amplitude = 1;
  Object.assign(line, rest);
  scene.objs.push(line);
  return line;
}

const amplitudesAt = (scene, points) =>
  fieldAmplitudes(computeModelFieldAt(buildWaveModel(scene), points));

/**
 * The transverse centre of the beam on a vertical scan.
 *
 * A collimated beam this close to its aperture is a top hat covered in Fresnel
 * ripples, so its brightest sample is essentially arbitrary. The centroid of
 * the bright region tracks the beam centre instead; the threshold keeps stray
 * edge diffraction from dragging it.
 */
function beamCentroid(scene, x, from, to, step) {
  const points = [];
  for (let y = from; y <= to; y += step) points.push({ x, y });
  const amplitudes = amplitudesAt(scene, points);

  const peak = Math.max(...amplitudes);
  let weightSum = 0;
  let positionSum = 0;
  for (let i = 0; i < points.length; i++) {
    if (amplitudes[i] < 0.5 * peak) continue;
    const weight = amplitudes[i] * amplitudes[i];
    weightSum += weight;
    positionSum += weight * points[i].y;
  }
  return positionSum / weightSum;
}

describe('a transparent index-matched interface is invisible', () => {
  test('the field beyond it matches the bare point source', () => {
    // The end-to-end version of the Rayleigh-Sommerfeld normalisation check,
    // this time through the scene objects and the subspace machinery.
    const scene = makeScene();
    Object.assign(scene.objs[scene.objs.push(new WavePointSource(scene)) - 1],
      { x: 0, y: 0, amplitude: 1, phase: 0 });
    addInterface(scene, { x: 200, y0: -1500, y1: 1500, indexAfter: 1 });

    for (const [x, y] of [[400, 0], [800, 0], [600, 200]]) {
      const [re, im] = computeModelFieldAt(buildWaveModel(scene), [{ x, y }]);
      const analytic = greensFunction(K * Math.hypot(x, y));
      const magnitude = Math.hypot(analytic.re, analytic.im);
      expect(Math.hypot(re - analytic.re, im - analytic.im) / magnitude)
        .toBeLessThan(0.03);
    }
  });
});

describe('refraction', () => {
  // A collimated beam at 30 degrees in vacuum crossing into n = 1.5 must
  // continue at asin(sin 30 / 1.5) = 19.47 degrees. Nothing in the code applies
  // Snell's law; it emerges from sampling the incident field on the surface and
  // re-radiating it with the wavenumber of the medium beyond.
  const incidence = 30 * Math.PI / 180;

  function steeredScene(indexAfter) {
    const scene = makeScene();
    addLineSource(scene, {
      x: 0, y0: -200, y1: 200,
      eqnPhase: `${(K * Math.sin(incidence)).toFixed(8)}\\cdot u`,
    });
    addInterface(scene, { x: 150, y0: -400, y1: 400, indexAfter });
    return scene;
  }

  /**
   * Beam angles are measured on a finite aperture, so they carry the beam's own
   * diffraction spread (about 3 degrees of half-angle for a 20-wavelength
   * aperture) plus the centroid's sensitivity to edge diffraction. A degree and
   * a half of tolerance is well inside that, and still an order of magnitude
   * tighter than the 10-degree difference an index error would produce.
   */
  const ANGLE_TOLERANCE_DEGREES = 1.5;
  const expectAngle = (actual, expected) =>
    expect(Math.abs(actual - expected)).toBeLessThan(ANGLE_TOLERANCE_DEGREES);

  const beamAngle = (scene, x1, x2) => {
    const y1 = beamCentroid(scene, x1, -400, 1000, 8);
    const y2 = beamCentroid(scene, x2, -400, 1000, 8);
    return Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI;
  };

  test('an index-matched interface leaves the beam direction alone', () => {
    expectAngle(beamAngle(steeredScene(1), 400, 700), 30);
  });

  test('a denser medium bends the beam towards the normal, by Snells law', () => {
    const expected = Math.asin(Math.sin(incidence) / 1.5) * 180 / Math.PI;
    expect(expected).toBeCloseTo(19.47, 1);
    expectAngle(beamAngle(steeredScene(1.5), 400, 700), expected);
  });

  test('a slab restores the original direction after two interfaces', () => {
    // Entering and leaving a parallel slab displaces the beam but returns it to
    // its original angle, which exercises the full two-interface chain.
    const scene = makeScene({ sourceDensity: 6 });
    addLineSource(scene, {
      x: 0, y0: -200, y1: 200,
      eqnPhase: `${(K * Math.sin(incidence)).toFixed(8)}\\cdot u`,
    });
    addInterface(scene, { x: 150, y0: -400, y1: 400, indexAfter: 1.5 });
    addInterface(scene, { x: 650, y0: -700, y1: 700, indexAfter: 1 });

    const model = buildWaveModel(scene);
    expect(model.subspaces).toHaveLength(3);
    expect(model.subspaces.map((s) => s.refractiveIndex)).toEqual([1, 1.5, 1]);

    expectAngle(beamAngle(scene, 350, 600), 19.47);
    expectAngle(beamAngle(scene, 800, 1100), 30);
  }, 30000);
});

describe('a short interface blocks', () => {
  test('a narrow slit casts a shadow with diffraction into it', () => {
    const scene = makeScene();
    Object.assign(scene.objs[scene.objs.push(new WavePointSource(scene)) - 1],
      { x: 0, y: 0, amplitude: 1 });
    // The interface exists only over a narrow band; everywhere else it is opaque.
    addInterface(scene, { x: 200, y0: -40, y1: 40, indexAfter: 1 });

    const [onAxis, inShadow, deepShadow] = amplitudesAt(scene, [
      { x: 600, y: 0 }, { x: 600, y: 400 }, { x: 600, y: 1200 },
    ]);

    // Light gets through the opening...
    expect(onAxis).toBeGreaterThan(0);
    // ...far less reaches the geometric shadow...
    expect(inShadow).toBeLessThan(0.3 * onAxis);
    // ...and less still further in, but it is diffraction, not a hard cut-off.
    expect(deepShadow).toBeLessThan(inShadow);
    expect(deepShadow).toBeGreaterThan(0);
  });

  test('an opaque transmission blocks everything', () => {
    const scene = makeScene();
    Object.assign(scene.objs[scene.objs.push(new WavePointSource(scene)) - 1],
      { x: 0, y: 0, amplitude: 1 });
    addInterface(scene, { x: 200, y0: -1500, y1: 1500, eqnAmplitude: '0' });

    const [beyond] = amplitudesAt(scene, [{ x: 600, y: 0 }]);
    expect(beyond).toBe(0);
  });
});

describe('a curved interface focuses', () => {
  test('a lens phase profile brings a collimated beam to a focus', () => {
    const focal = 400;
    const scene = makeScene();
    addLineSource(scene, { x: 0, y0: -200, y1: 200 });
    addInterface(scene, {
      x: 200, y0: -220, y1: 220, indexAfter: 1,
      eqnPhase: `-${(K / (2 * focal)).toFixed(10)}\\cdot y^2`,
    });

    const onAxis = (x) => amplitudesAt(scene, [{ x, y: 0 }])[0];
    // The focus sits a focal length beyond the interface, at x = 600.
    expect(onAxis(600)).toBeGreaterThan(onAxis(300));
    expect(onAxis(600)).toBeGreaterThan(onAxis(1100));
  });

  test('a sag equation displaces the surface along the optical axis', () => {
    const scene = makeScene();
    const surface = addInterface(scene, {
      x: 300, y0: -100, y1: 100, eqnSag: '0.01\\cdot y^2',
    });

    // Flat at the centre, bulging forward at the edges.
    expect(surface.zAt(0)).toBeCloseTo(300, 9);
    expect(surface.zAt(100)).toBeCloseTo(300 + 0.01 * 100 * 100, 9);
    expect(surface.slopeAt(50)).toBeCloseTo(2 * 0.01 * 50, 4);

    // The normal tilts with the surface and keeps pointing downstream.
    const samples = surface.getSurfaceSamples({
      settings: resolveWaveSettings(scene), samplesPerWavelength: 8,
      refractiveIndexBefore: 1,
    });
    expect(samples.every((s) => s.nx > 0)).toBe(true);
    const edge = samples[samples.length - 1];
    expect(edge.ny).toBeLessThan(0);
    // The arc length per sample exceeds the transverse step where it is steep.
    expect(edge.ds).toBeGreaterThan(samples[Math.floor(samples.length / 2)].ds);
  });
});

describe('the subspace stack', () => {
  test('orders interfaces along the optical axis regardless of creation order', () => {
    const scene = makeScene();
    addInterface(scene, { x: 500, y0: -100, y1: 100, indexAfter: 2 });
    addInterface(scene, { x: 100, y0: -100, y1: 100, indexAfter: 1.5 });

    const ordered = collectInterfaces(scene);
    expect(ordered.map((s) => s.p1.x)).toEqual([100, 500]);

    const model = buildWaveModel(scene);
    expect(model.subspaces.map((s) => s.refractiveIndex)).toEqual([1, 1.5, 2]);
  });

  test('places each source in the subspace it sits in', () => {
    const scene = makeScene();
    addInterface(scene, { x: 100, y0: -100, y1: 100, indexAfter: 1.5 });
    addInterface(scene, { x: 500, y0: -100, y1: 100, indexAfter: 2 });
    for (const x of [50, 300, 900]) {
      Object.assign(scene.objs[scene.objs.push(new WavePointSource(scene)) - 1],
        { x, y: 0, amplitude: 1 });
    }

    const model = buildWaveModel(scene);
    expect(model.subspaces.map((s) => s.primaries.length)).toEqual([1, 1, 1]);
  });

  test('an opaque extension still assigns a subspace beyond the interface ends', () => {
    // Outside its transverse extent the interface continues as an opaque
    // screen, so points behind it are still in the later subspace.
    const scene = makeScene();
    addInterface(scene, { x: 100, y0: -50, y1: 50, indexAfter: 1.5 });
    const interfaces = collectInterfaces(scene);

    expect(subspaceIndexAt(interfaces, 50, 0)).toBe(0);
    expect(subspaceIndexAt(interfaces, 200, 0)).toBe(1);
    // Far off the end of the interface, the same comparison still applies.
    expect(subspaceIndexAt(interfaces, 50, 900)).toBe(0);
    expect(subspaceIndexAt(interfaces, 200, 900)).toBe(1);
  });

  test('warns when interfaces overlap along the axis', () => {
    const scene = makeScene();
    addInterface(scene, { x: 200, y0: -100, y1: 100, eqnSag: '2\\cdot y' });
    addInterface(scene, { x: 260, y0: -100, y1: 100, eqnSag: '-2\\cdot y' });

    expect(buildWaveModel(scene).warnings).toContain('interfacesOverlap');
  });

  test('accepts interfaces that are cleanly separated', () => {
    const scene = makeScene();
    addInterface(scene, { x: 200, y0: -100, y1: 100 });
    addInterface(scene, { x: 600, y0: -100, y1: 100 });
    expect(buildWaveModel(scene).warnings).toEqual([]);
  });

  test('ignores a degenerate interface', () => {
    const scene = makeScene();
    const surface = addInterface(scene, { x: 200, y0: 50, y1: 50 });
    expect(surface.isValid()).toBe(false);
    expect(collectInterfaces(scene)).toEqual([]);
    expect(buildWaveModel(scene).subspaces).toHaveLength(1);
  });
});

describe('sampling diagnostics across media', () => {
  // The wavelength is shorter inside a denser medium, so the grid has fewer
  // samples per wavelength there. The diagnostic has to report the worst case
  // anywhere in the scene, not the background, or a glass region would alias
  // while the status bar still claimed the grid was fine.
  function diagnosticsFor(indexAfter) {
    const scene = makeScene();
    scene.setViewportSize(1500, 900);
    addInterface(scene, { x: 500, y0: -200, y1: 200, indexAfter });
    return buildWaveModel(scene, { resolution: 256 }).diagnostics;
  }

  test('samples per wavelength fall in proportion to the largest index', () => {
    const vacuum = diagnosticsFor(1);
    const glass = diagnosticsFor(2.5);
    expect(glass.pixelsPerWavelength).toBeCloseTo(vacuum.pixelsPerWavelength / 2.5, 6);
  });

  test('a dense enough medium raises the aliasing warning on its own', () => {
    expect(diagnosticsFor(1).isAliasing).toBe(false);
    // The background grid is fine; only the medium makes it inadequate.
    expect(diagnosticsFor(4).isAliasing).toBe(true);
  });

  test('the background index is used when it is the largest', () => {
    const scene = makeScene({ backgroundIndex: 3 });
    scene.setViewportSize(1500, 900);
    addInterface(scene, { x: 500, y0: -200, y1: 200, indexAfter: 1 });
    const withGlass = buildWaveModel(scene, { resolution: 256 }).diagnostics;

    const plain = makeScene({ backgroundIndex: 3 });
    plain.setViewportSize(1500, 900);
    expect(withGlass.pixelsPerWavelength)
      .toBeCloseTo(buildWaveModel(plain, { resolution: 256 }).diagnostics.pixelsPerWavelength, 6);
  });
});

describe('propagateChain', () => {
  test('gives each subspace its own boundary sources, directional first', () => {
    const scene = makeScene();
    Object.assign(scene.objs[scene.objs.push(new WavePointSource(scene)) - 1],
      { x: 0, y: 0, amplitude: 1 });
    addInterface(scene, { x: 200, y0: -100, y1: 100, indexAfter: 1.5 });

    const resolved = propagateChain(buildWaveModel(scene));
    expect(resolved).toHaveLength(2);

    expect(resolved[0].directionalCount).toBe(0);
    expect(resolved[0].sources).toHaveLength(1);

    expect(resolved[1].directionalCount).toBeGreaterThan(0);
    expect(resolved[1].directionalCount).toBe(resolved[1].sources.length);
    // Every boundary source carries a downstream-pointing normal.
    expect(resolved[1].sources.every((s) => s.nx > 0)).toBe(true);
    expect(resolved[1].refractiveIndex).toBe(1.5);
  });

  test('an unilluminated interface radiates nothing', () => {
    const scene = makeScene();
    addInterface(scene, { x: 200, y0: -100, y1: 100 });
    const resolved = propagateChain(buildWaveModel(scene));
    expect(resolved[1].sources.every((s) => s.re === 0 && s.im === 0)).toBe(true);
  });
});
