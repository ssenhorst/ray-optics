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

import TaskEvaluator, { validateTask } from '../../src/core/goals/TaskEvaluator.js';
import { GOAL_TYPES } from '../../src/core/goals/goalTypes.js';

/**
 * Build a ray segment record of the kind the simulator records.
 */
function seg(id, x1, y1, x2, y2, extra = {}) {
  return { id, x1, y1, x2, y2, unbounded: false, brightness: 1, wavelength: 540, depth: 1, sourceName: null, ...extra };
}

describe('validateTask', () => {
  test('accepts a well-formed task', () => {
    expect(validateTask({
      title: 'Focus',
      goals: [{ type: 'raysThroughPoint', point: { x: 0, y: 0 }, radius: 5 }],
    })).toBeNull();
  });

  test('rejects an unknown goal type', () => {
    expect(validateTask({ goals: [{ type: 'nope' }] })).toMatch(/unknown type/);
  });

  test('rejects an unknown key in a goal', () => {
    expect(validateTask({ goals: [{ type: 'raysThroughPoint', point: { x: 0, y: 0 }, colour: 'red' }] }))
      .toMatch(/unknown key/);
  });

  test('rejects a goal missing its required fields', () => {
    expect(validateTask({ goals: [{ type: 'raysThroughPoint' }] })).toMatch(/requires a point/);
    expect(validateTask({ goals: [{ type: 'detectorPower', detector: 'D' }] })).toMatch(/requires either/);
  });

  test('rejects repeated goal ids', () => {
    expect(validateTask({
      goals: [
        { type: 'collimated', id: 'a', angle: 0 },
        { type: 'collimated', id: 'a', angle: 0 },
      ],
    })).toMatch(/repeats the id/);
  });
});

describe('raysThroughPoint', () => {
  const goal = { type: 'raysThroughPoint', point: { x: 100, y: 0 }, radius: 10, count: 2, minDepth: 0 };

  test('is met when enough rays pass through the target', () => {
    const result = GOAL_TYPES.raysThroughPoint.evaluate(goal, {
      segments: [seg(0, 0, 0, 200, 0, { depth: 0 }), seg(1, 0, 5, 200, 5, { depth: 0 })],
    });
    expect(result.satisfied).toBe(true);
    expect(result.progress).toBe(1);
  });

  test('is not met when a ray misses, and reports partial progress', () => {
    const result = GOAL_TYPES.raysThroughPoint.evaluate(goal, {
      segments: [seg(0, 0, 0, 200, 0, { depth: 0 }), seg(1, 0, 90, 200, 90, { depth: 0 })],
    });
    expect(result.satisfied).toBe(false);
    expect(result.progress).toBeGreaterThan(0.4);
    expect(result.progress).toBeLessThan(1);
  });

  test('progress increases as a ray gets closer', () => {
    const at = (y) => GOAL_TYPES.raysThroughPoint.evaluate(goal, {
      segments: [seg(0, 0, 0, 200, 0, { depth: 0 }), seg(1, 0, y, 200, y, { depth: 0 })],
    }).progress;
    expect(at(40)).toBeGreaterThan(at(90));
    expect(at(15)).toBeGreaterThan(at(40));
  });

  test('minDepth ignores the light before it has been through the optics', () => {
    const result = GOAL_TYPES.raysThroughPoint.evaluate(
      { ...goal, count: 1, minDepth: 1 },
      { segments: [seg(0, 0, 0, 200, 0, { depth: 0 })] }
    );
    expect(result.satisfied).toBe(false);
  });

  test('a source filter only counts that source', () => {
    const result = GOAL_TYPES.raysThroughPoint.evaluate(
      { ...goal, count: 1, source: 'A' },
      {
        segments: [
          seg(0, 0, 90, 200, 90, { depth: 0, sourceName: 'A' }),
          seg(1, 0, 0, 200, 0, { depth: 0, sourceName: 'B' }),
        ],
      }
    );
    expect(result.satisfied).toBe(false);
  });
});

describe('raysConverge', () => {
  test('finds the crossing point of the rays', () => {
    const result = GOAL_TYPES.raysConverge.evaluate(
      { type: 'raysConverge', point: { x: 100, y: 100 }, radius: 5 },
      { segments: [seg(0, 0, 100, 50, 100), seg(1, 0, 0, 50, 50), seg(2, 0, 200, 50, 150)] }
    );
    expect(result.marks[0].x).toBeCloseTo(100, 6);
    expect(result.marks[0].y).toBeCloseTo(100, 6);
    expect(result.satisfied).toBe(true);
  });

  test('reports that parallel rays never cross', () => {
    const result = GOAL_TYPES.raysConverge.evaluate(
      { type: 'raysConverge', radius: 5 },
      { segments: [seg(0, 0, 0, 50, 0), seg(1, 0, 20, 50, 20)] }
    );
    expect(result.satisfied).toBe(false);
    expect(result.detail).toMatch(/parallel/);
  });
});

describe('collimated', () => {
  const goal = { type: 'collimated', angle: 0, tolerance: 1 };

  test('is met when the outgoing rays are parallel to the target direction', () => {
    const result = GOAL_TYPES.collimated.evaluate(goal, {
      segments: [seg(0, 0, 0, 50, 0, { unbounded: true }), seg(1, 0, 20, 50, 20, { unbounded: true })],
    });
    expect(result.satisfied).toBe(true);
  });

  test('is not met when a ray is tilted', () => {
    const result = GOAL_TYPES.collimated.evaluate(goal, {
      segments: [seg(0, 0, 0, 50, 0, { unbounded: true }), seg(1, 0, 20, 50, 40, { unbounded: true })],
    });
    expect(result.satisfied).toBe(false);
    expect(result.detail).toMatch(/1 of 2/);
  });

  test('light that never reached the optics does not count against the student', () => {
    const result = GOAL_TYPES.collimated.evaluate(goal, {
      segments: [
        seg(0, 0, 0, 50, 0, { unbounded: true }),
        seg(1, 0, 0, 50, 50, { unbounded: true, depth: 0 }),
      ],
    });
    expect(result.satisfied).toBe(true);
  });
});

describe('TaskEvaluator', () => {
  const scene = {
    task: {
      title: 'Two things',
      goals: [
        { id: 'a', type: 'raysThroughPoint', point: { x: 100, y: 0 }, radius: 10, count: 1, minDepth: 0 },
        { id: 'b', type: 'raysThroughPoint', point: { x: 100, y: 500 }, radius: 10, count: 1, minDepth: 0 },
      ],
    },
    objs: [],
  };

  test('requires every goal by default', () => {
    const status = new TaskEvaluator(scene).evaluate([seg(0, 0, 0, 200, 0, { depth: 0 })], 1);
    expect(status.hasTask).toBe(true);
    expect(status.goals[0].satisfied).toBe(true);
    expect(status.goals[1].satisfied).toBe(false);
    expect(status.complete).toBe(false);
  });

  test('requireAll false accepts any one goal', () => {
    const anyScene = { ...scene, task: { ...scene.task, requireAll: false } };
    const status = new TaskEvaluator(anyScene).evaluate([seg(0, 0, 0, 200, 0, { depth: 0 })], 1);
    expect(status.complete).toBe(true);
  });

  test('reports no task when the scene has none', () => {
    const status = new TaskEvaluator({ objs: [] }).evaluate([], 0);
    expect(status.hasTask).toBe(false);
  });

  test('collects the target shapes for the canvas', () => {
    const targets = new TaskEvaluator(scene).getTargets();
    expect(targets).toHaveLength(2);
    expect(targets[0]).toMatchObject({ type: 'circle', x: 100, y: 0, r: 10, goalIndex: 0 });
  });
});
