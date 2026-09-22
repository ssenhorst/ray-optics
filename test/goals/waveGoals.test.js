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

import { WAVE_GOAL_TYPES, findPeaks } from '../../src/core/goals/waveGoalTypes.js';
import TaskEvaluator, { isWaveScene, validateTask } from '../../src/core/goals/TaskEvaluator.js';
import Scene from '../../src/core/Scene.js';

/**
 * A context whose field is given directly as a function of position, so the goal logic can be
 * checked against profiles whose answer is known without running the propagation chain.
 * @param {function(Point): {re: number, im: number}} fn - The field at a point.
 */
function fieldContext(fn) {
  return {
    sampleField: (points) => {
      const out = new Float64Array(points.length * 2);
      points.forEach((p, i) => {
        const { re, im } = fn(p);
        out[i * 2] = re;
        out[i * 2 + 1] = im;
      });
      return out;
    },
  };
}

/** A line along y at a fixed x. */
const vertical = (x, from, to) => ({ p1: { x, y: from }, p2: { x, y: to } });

describe('findPeaks', () => {
  test('finds separated peaks and ignores ripple on a broad one', () => {
    const profile = {
      intensity: Float64Array.from([0, 1, 0, 0.98, 1, 0.99, 0, 1, 0]),
      distanceAt: (i) => i,
    };
    // The middle group is one peak sampled three times: the dips between are far too shallow.
    expect(findPeaks(profile, 0.05, 0.5)).toHaveLength(3);
  });

  test('ignores peaks below the relative threshold', () => {
    const profile = {
      intensity: Float64Array.from([0, 1, 0, 0.01, 0, 1, 0]),
      distanceAt: (i) => i,
    };
    expect(findPeaks(profile, 0.1, 0.2)).toHaveLength(2);
  });
});

describe('waveIntensityPeak', () => {
  const goal = {
    type: 'waveIntensityPeak',
    line: vertical(100, -100, 100),
    point: { x: 100, y: 30 },
    radius: 10,
    samples: 401,
  };

  test('is met when the brightest point is on the target', () => {
    // A single bright spot at y = 30.
    const result = WAVE_GOAL_TYPES.waveIntensityPeak.evaluate(goal,
      fieldContext(({ y }) => ({ re: Math.exp(-((y - 30) ** 2) / 50), im: 0 })));
    expect(result.satisfied).toBe(true);
    expect(result.marks[0].y).toBeCloseTo(30, 0);
  });

  test('is not met when the peak is elsewhere, and reports the distance', () => {
    const result = WAVE_GOAL_TYPES.waveIntensityPeak.evaluate(goal,
      fieldContext(({ y }) => ({ re: Math.exp(-((y + 40) ** 2) / 50), im: 0 })));
    expect(result.satisfied).toBe(false);
    expect(result.detail).toMatch(/70/);
  });

  test('says so when there is no field to measure', () => {
    expect(WAVE_GOAL_TYPES.waveIntensityPeak.evaluate(goal, {}).detail).toMatch(/wave-optics scene/);
  });

  test('draws the target as a circle', () => {
    expect(WAVE_GOAL_TYPES.waveIntensityPeak.getTargets(goal))
      .toEqual([{ type: 'circle', x: 100, y: 30, r: 10 }]);
  });
});

describe('waveFringeSpacing', () => {
  /** A cosine fringe pattern of a given period along y. */
  const fringes = (period) => fieldContext(({ y }) => ({ re: Math.cos(Math.PI * y / period), im: 0 }));

  test('measures the period of the fringes', () => {
    const goal = { type: 'waveFringeSpacing', line: vertical(0, -200, 200), spacing: 40, tolerance: 4, samples: 801 };
    expect(WAVE_GOAL_TYPES.waveFringeSpacing.evaluate(goal, fringes(40)).satisfied).toBe(true);
    expect(WAVE_GOAL_TYPES.waveFringeSpacing.evaluate(goal, fringes(80)).satisfied).toBe(false);
  });

  test('needs at least two fringes to measure anything', () => {
    const goal = { type: 'waveFringeSpacing', line: vertical(0, -10, 10), spacing: 40, samples: 101 };
    const result = WAVE_GOAL_TYPES.waveFringeSpacing.evaluate(goal, fringes(400));
    expect(result.satisfied).toBe(false);
    expect(result.detail).toMatch(/at least 2/);
  });
});

describe('waveFringeContrast', () => {
  const goal = { type: 'waveFringeContrast', line: vertical(0, -100, 100), min: 0.8, samples: 401 };

  test('is met by a deeply modulated pattern', () => {
    const result = WAVE_GOAL_TYPES.waveFringeContrast.evaluate(goal,
      fieldContext(({ y }) => ({ re: Math.cos(Math.PI * y / 40), im: 0 })));
    expect(result.satisfied).toBe(true);
  });

  test('is not met when the pattern rides on a large background', () => {
    const result = WAVE_GOAL_TYPES.waveFringeContrast.evaluate(goal,
      fieldContext(({ y }) => ({ re: 3 + 0.1 * Math.cos(Math.PI * y / 40), im: 0 })));
    expect(result.satisfied).toBe(false);
    expect(result.progress).toBeGreaterThan(0);
  });
});

describe('waveSpotSize', () => {
  /** A Gaussian in intensity whose full width at half maximum is known. */
  const spot = (fwhm) => fieldContext(({ y }) => {
    const sigma = fwhm / (2 * Math.sqrt(2 * Math.log(2)));
    return { re: Math.exp(-(y * y) / (4 * sigma * sigma)), im: 0 };
  });

  test('measures the width at half maximum', () => {
    const goal = { type: 'waveSpotSize', line: vertical(0, -100, 100), max: 25, samples: 801 };
    expect(WAVE_GOAL_TYPES.waveSpotSize.evaluate(goal, spot(20)).satisfied).toBe(true);
    expect(WAVE_GOAL_TYPES.waveSpotSize.evaluate(goal, spot(40)).satisfied).toBe(false);
  });

  test('accepts a target width with a tolerance', () => {
    const goal = { type: 'waveSpotSize', line: vertical(0, -100, 100), target: 20, tolerance: 3, samples: 801 };
    const result = WAVE_GOAL_TYPES.waveSpotSize.evaluate(goal, spot(20));
    expect(result.satisfied).toBe(true);
    expect(result.detail).toMatch(/20\./);
  });

  test('says so when the peak never falls to half within the line', () => {
    const goal = { type: 'waveSpotSize', line: vertical(0, -5, 5), max: 25, samples: 101 };
    expect(WAVE_GOAL_TYPES.waveSpotSize.evaluate(goal, spot(200)).detail).toMatch(/does not fall to half/);
  });
});

describe('waveResolvedPeaks', () => {
  /** Two Gaussian peaks a given distance apart, on a shared pedestal. */
  const pair = (separation, pedestal) => fieldContext(({ y }) => {
    const bump = (centre) => Math.exp(-((y - centre) ** 2) / 200);
    return { re: Math.sqrt(bump(-separation / 2) ** 2 + bump(separation / 2) ** 2 + pedestal), im: 0 };
  });

  const goal = { type: 'waveResolvedPeaks', line: vertical(0, -120, 120), count: 2, dip: 0.2, samples: 801 };

  test('counts two peaks when they are well separated', () => {
    const result = WAVE_GOAL_TYPES.waveResolvedPeaks.evaluate(goal, pair(80, 0));
    expect(result.satisfied).toBe(true);
    expect(result.detail).toMatch(/dip to/);
  });

  test('counts one when they have merged', () => {
    const result = WAVE_GOAL_TYPES.waveResolvedPeaks.evaluate(goal, pair(6, 0));
    expect(result.satisfied).toBe(false);
    expect(result.detail).toMatch(/1 peak/);
  });
});

describe('wave goals in a scene', () => {
  /** A scene with a single point source, which has a closed-form field. */
  function pointSourceScene(task) {
    const scene = new Scene();
    scene.loadJSON(JSON.stringify({
      version: 5,
      objs: [{ type: 'WavePointSource', x: 0, y: 0, amplitude: 1 }],
      width: 800, height: 600, origin: { x: 400, y: 300 }, scale: 1,
      waveOptics: { wavelength: 20 },
      task,
    }), () => { });
    return scene;
  }

  test('a scene with wave objects is recognised as a wave scene', () => {
    expect(isWaveScene(pointSourceScene(null))).toBe(true);
    const rayScene = new Scene();
    rayScene.loadJSON(JSON.stringify({
      version: 5, objs: [{ type: 'SingleRay', p1: { x: 0, y: 0 }, p2: { x: 1, y: 0 } }],
      width: 800, height: 600, origin: { x: 0, y: 0 }, scale: 1,
    }), () => { });
    expect(isWaveScene(rayScene)).toBe(false);
  });

  test('the evaluator measures the real field of the scene', () => {
    // The field of a point source falls off with distance, so the brightest point along a line
    // across the axis is the one nearest the source.
    const scene = pointSourceScene({
      goals: [{
        id: 'peak', type: 'waveIntensityPeak',
        line: { p1: { x: 200, y: -150 }, p2: { x: 200, y: 150 } },
        point: { x: 200, y: 0 }, radius: 12, samples: 301,
      }],
    });
    expect(scene.error).toBeNull();
    const status = new TaskEvaluator(scene).evaluate([], 0);
    expect(status.hasTask).toBe(true);
    expect(status.goals[0].satisfied).toBe(true);
  });

  test('a wave goal in a ray scene reports that it cannot measure', () => {
    const scene = new Scene();
    scene.loadJSON(JSON.stringify({
      version: 5,
      objs: [{ type: 'SingleRay', p1: { x: 0, y: 0 }, p2: { x: 1, y: 0 } }],
      width: 800, height: 600, origin: { x: 0, y: 0 }, scale: 1,
      task: {
        goals: [{
          id: 'peak', type: 'waveIntensityPeak',
          line: { p1: { x: 0, y: -10 }, p2: { x: 0, y: 10 } },
          point: { x: 0, y: 0 }, radius: 5,
        }],
      },
    }), () => { });
    const status = new TaskEvaluator(scene).evaluate([], 0);
    expect(status.goals[0].satisfied).toBe(false);
    expect(status.goals[0].detail).toMatch(/wave-optics scene/);
  });
});

describe('validateTask for wave goals', () => {
  test('accepts a well-formed wave goal', () => {
    expect(validateTask({
      goals: [{ type: 'waveFringeSpacing', line: { p1: { x: 0, y: 0 }, p2: { x: 0, y: 100 } }, spacing: 40 }],
    })).toBeNull();
  });

  test('rejects a wave goal without a probe line', () => {
    expect(validateTask({ goals: [{ type: 'waveFringeSpacing', spacing: 40 }] }))
      .toMatch(/requires a probe 'line'/);
  });

  test('rejects a probe line of zero length', () => {
    expect(validateTask({
      goals: [{ type: 'waveSpotSize', line: { p1: { x: 5, y: 5 }, p2: { x: 5, y: 5 } }, max: 10 }],
    })).toMatch(/zero length/);
  });

  test('rejects a wave goal missing its own required field', () => {
    expect(validateTask({
      goals: [{ type: 'waveFringeContrast', line: { p1: { x: 0, y: 0 }, p2: { x: 0, y: 10 } } }],
    })).toMatch(/requires 'min'/);
  });
});
