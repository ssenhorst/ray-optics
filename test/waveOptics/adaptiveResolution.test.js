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
  AdaptiveResolution, RESOLUTION_LADDER, snapToLadder, nextRung, previousRung,
  MIN_INTERACTIVE_RESOLUTION, INTERACTIVE_BUDGET_MS, SETTLED_BUDGET_MS
} from '../../src/core/waveOptics/adaptiveResolution.js';

describe('the ladder', () => {
  test('reaches 2048', () => {
    expect(RESOLUTION_LADDER.at(-1)).toBe(2048);
  });

  test('snapping rounds down onto a rung', () => {
    expect(snapToLadder(2048)).toBe(2048);
    expect(snapToLadder(700)).toBe(512);
    expect(snapToLadder(10)).toBe(64);
  });

  test('stepping up respects the cap', () => {
    expect(nextRung(256, 2048)).toBe(512);
    expect(nextRung(512, 512)).toBeNull();
    expect(nextRung(2048, 2048)).toBeNull();
  });

  test('stepping down respects the floor', () => {
    expect(previousRung(512, 64)).toBe(256);
    expect(previousRung(256, 256)).toBe(256);
  });
});

describe('AdaptiveResolution', () => {
  test('never drops a drag redraw below the aliasing floor', () => {
    const adaptive = new AdaptiveResolution();
    // However slow the machine proves to be, at whatever source count.
    for (let i = 0; i < 10; i++) {
      const resolution = adaptive.chooseInitial(500, 2048, true);
      adaptive.record(resolution, 500, 5000, true);
    }
    expect(adaptive.chooseInitial(500, 2048, true)).toBe(MIN_INTERACTIVE_RESOLUTION);
  });

  test('climbs when redraws come in comfortably under budget', () => {
    const adaptive = new AdaptiveResolution();
    const sourceCount = 100;
    let resolution = adaptive.chooseInitial(sourceCount, 2048, false);
    const seen = [resolution];
    for (let i = 0; i < 8; i++) {
      adaptive.record(resolution, sourceCount, 1, false);
      resolution = adaptive.chooseInitial(sourceCount, 2048, false);
      seen.push(resolution);
    }
    expect(seen.at(-1)).toBe(2048);
    // Monotonically, never oscillating.
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
  });

  test('backs off after a redraw overruns its budget', () => {
    const adaptive = new AdaptiveResolution();
    const sourceCount = 100;
    adaptive.record(1024, sourceCount, 1, false);
    const fast = adaptive.chooseInitial(sourceCount, 2048, false);
    adaptive.record(fast, sourceCount, SETTLED_BUDGET_MS * 5, false);
    expect(adaptive.chooseInitial(sourceCount, 2048, false)).toBeLessThan(fast);
  });

  test('never exceeds the resolution the user asked for', () => {
    const adaptive = new AdaptiveResolution();
    const sourceCount = 1;
    for (let i = 0; i < 8; i++) adaptive.record(2048, sourceCount, 1, false);
    expect(adaptive.chooseInitial(sourceCount, 256, false)).toBe(256);
    expect(adaptive.chooseInitial(sourceCount, 512, false)).toBe(512);
  });

  test('tracks the drag and settled budgets separately', () => {
    const adaptive = new AdaptiveResolution();
    const sourceCount = 100;
    // Fast when settled, far too slow to sustain during a drag.
    for (let i = 0; i < 8; i++) {
      adaptive.record(1024, sourceCount, 10, false);
      adaptive.record(1024, sourceCount, INTERACTIVE_BUDGET_MS * 10, true);
    }
    expect(adaptive.chooseInitial(sourceCount, 2048, false)).toBeGreaterThan(
      adaptive.chooseInitial(sourceCount, 2048, true)
    );
  });

  test('refinement stops at the target and when a step runs long', () => {
    const adaptive = new AdaptiveResolution();
    expect(adaptive.nextStep(256, 1024, 10)).toBe(512);
    expect(adaptive.nextStep(1024, 1024, 10)).toBeNull();
    // A step that nearly used its budget will not be followed by one costing
    // about four times as much.
    expect(adaptive.nextStep(256, 2048, SETTLED_BUDGET_MS * 0.9)).toBeNull();
  });

  describe('transferring proven capacity between scenes of different complexity', () => {
    // This is the actual bug: a resolution proven fast on a light scene is not
    // safe to reuse, unmodified, on a heavy one. Tracking workload
    // (resolution^2 * sourceCount) rather than a bare resolution is what fixes
    // it, and this is the regression test for it.
    test('a resolution proven on very few sources is not offered to a much heavier scene', () => {
      const adaptive = new AdaptiveResolution();
      // A light scene (2 sources) climbs, fast, all the way to 2048.
      let resolution = adaptive.chooseInitial(2, 2048, false);
      for (let i = 0; i < 8; i++) {
        adaptive.record(resolution, 2, 1, false);
        resolution = adaptive.chooseInitial(2, 2048, false);
      }
      expect(resolution).toBe(2048);

      // A much heavier scene must not be handed that same 2048 on trust: at
      // 2048 pixels and 4000 sources the workload is ~1000x what was proven at
      // 2048 pixels and 2 sources, so the same time budget cannot cover it.
      const heavyChoice = adaptive.chooseInitial(4000, 2048, false);
      expect(heavyChoice).toBeLessThan(2048);
      expect(heavyChoice).toBeLessThanOrEqual(256);
    });

    test('a heavy scene loaded first is also started conservatively', () => {
      // Not just a transfer effect: even with no history at all, a heavy scene
      // should not be handed the ladder's top rung on the first attempt.
      const adaptive = new AdaptiveResolution();
      expect(adaptive.chooseInitial(4000, 2048, false)).toBeLessThan(2048);
    });

    test('a proven-safe resolution does transfer to a similarly sized scene', () => {
      const adaptive = new AdaptiveResolution();
      let resolution = adaptive.chooseInitial(200, 2048, false);
      for (let i = 0; i < 8; i++) {
        adaptive.record(resolution, 200, 1, false);
        resolution = adaptive.chooseInitial(200, 2048, false);
      }
      expect(resolution).toBe(2048);
      // A scene with a comparable source count should still get the top rung,
      // not be punished just for being a different scene.
      expect(adaptive.chooseInitial(250, 2048, false)).toBe(2048);
    });

    test('recovers and climbs again once real measurements exist for the heavier scene', () => {
      const adaptive = new AdaptiveResolution();
      let resolution = adaptive.chooseInitial(2, 2048, false);
      for (let i = 0; i < 8; i++) {
        adaptive.record(resolution, 2, 1, false);
        resolution = adaptive.chooseInitial(2, 2048, false);
      }
      expect(resolution).toBe(2048);

      // Now feed it real, fast measurements at the heavy scene's own source
      // count (as the normal refinement sequence would), and it should climb
      // for that scene too, on its own evidence.
      const sourceCount = 4000;
      resolution = adaptive.chooseInitial(sourceCount, 2048, false);
      for (let i = 0; i < 8; i++) {
        adaptive.record(resolution, sourceCount, 1, false);
        resolution = adaptive.chooseInitial(sourceCount, 2048, false);
      }
      expect(resolution).toBe(2048);
    });

    test('a source count of zero is never a reason to hold back', () => {
      const adaptive = new AdaptiveResolution();
      expect(adaptive.chooseInitial(0, 2048, false)).toBe(2048);
      expect(adaptive.chooseInitial(0, 256, true)).toBe(256);
    });
  });
});
