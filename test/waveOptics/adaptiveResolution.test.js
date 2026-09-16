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
    // However slow the machine proves to be.
    for (let i = 0; i < 10; i++) {
      adaptive.record(adaptive.chooseInitial(2048, true), 5000, true);
    }
    expect(adaptive.chooseInitial(2048, true)).toBe(MIN_INTERACTIVE_RESOLUTION);
  });

  test('climbs when redraws come in comfortably under budget', () => {
    const adaptive = new AdaptiveResolution();
    let resolution = adaptive.chooseInitial(2048, false);
    const seen = [resolution];
    for (let i = 0; i < 6; i++) {
      adaptive.record(resolution, 1, false);
      resolution = adaptive.chooseInitial(2048, false);
      seen.push(resolution);
    }
    expect(seen.at(-1)).toBe(2048);
    // Monotonically, never oscillating.
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
  });

  test('backs off after a redraw overruns its budget', () => {
    const adaptive = new AdaptiveResolution();
    adaptive.record(1024, 1, false);
    const fast = adaptive.chooseInitial(2048, false);
    adaptive.record(fast, SETTLED_BUDGET_MS * 5, false);
    expect(adaptive.chooseInitial(2048, false)).toBeLessThan(fast);
  });

  test('never exceeds the resolution the user asked for', () => {
    const adaptive = new AdaptiveResolution();
    for (let i = 0; i < 8; i++) adaptive.record(2048, 1, false);
    expect(adaptive.chooseInitial(256, false)).toBe(256);
    expect(adaptive.chooseInitial(512, false)).toBe(512);
  });

  test('tracks the drag and settled budgets separately', () => {
    const adaptive = new AdaptiveResolution();
    // Fast when settled, far too slow to sustain during a drag.
    for (let i = 0; i < 8; i++) {
      adaptive.record(1024, 10, false);
      adaptive.record(1024, INTERACTIVE_BUDGET_MS * 10, true);
    }
    expect(adaptive.chooseInitial(2048, false)).toBeGreaterThan(
      adaptive.chooseInitial(2048, true)
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
});
