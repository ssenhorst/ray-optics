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

/**
 * @file Chooses the field grid resolution from what the machine has actually
 * managed, rather than from a fixed guess.
 *
 * A full cost model would need to account for the grid size, the source count,
 * the number of subspaces, the chain (whose cost does not depend on the grid at
 * all) and the GPU in the machine. Measuring instead needs almost none of that
 * — climb while each step comes in under its time budget, and remember the
 * highest rung that did.
 *
 * One piece of the cost model cannot be skipped, though: the field pass sums
 * every source at every pixel, so its cost is proportional to
 * `pixels * sourceCount`, not to `pixels` alone. Tracking capacity purely as a
 * *resolution* silently assumes the source count stays roughly constant. It
 * does not — switching from a two-source scene to a four-thousand-source one
 * is a real workload we have no measurement for yet. Trying the resolution
 * that was proven fast for the light scene, at the point where it is heaviest,
 * showed this directly: a scene that had climbed to 2048 samples on two
 * sources went on to spend nearly seven seconds *synchronously* — the field
 * pass ends with `gl.finish()` so the resolution ladder can time real GPU
 * work, which also means an overshoot blocks the main thread for exactly as
 * long as it takes, and on a slow machine that is worse than a visible stall:
 * it can look exactly like the scene never loaded, or take the tab down.
 *
 * So capacity is tracked as *workload* — `resolution^2 * sourceCount`, our
 * stand-in for pixels processed — rather than as a bare resolution. That is
 * the one relationship a measure-don't-model approach still has to assume, but
 * it is linear and directly tied to what the field pass actually does, so a
 * proven workload transfers sensibly between scenes of different complexity
 * instead of carrying over a number that only meant something for the scene
 * it was measured on.
 *
 * Two budgets are tracked separately, because they answer different questions:
 * what can be redrawn while the user is dragging, and what can be redrawn once
 * they stop.
 */

/** The resolutions offered, as samples across the longer viewport axis. */
export const RESOLUTION_LADDER = Object.freeze([64, 128, 256, 512, 1024, 2048]);

/**
 * Never drop below this while dragging. A grid coarse enough to alias badly is
 * worse than a slow one: it misreports the field instead of merely showing
 * less of it, which makes it impossible to judge what the scene is doing.
 */
export const MIN_INTERACTIVE_RESOLUTION = 256;

/** Time budget for a redraw during a drag, about 30 frames per second. */
export const INTERACTIVE_BUDGET_MS = 35;

/** Time budget for one step of the refinement after the user stops. */
export const SETTLED_BUDGET_MS = 500;

/**
 * A step is only considered cheap enough to climb from if it used less than
 * this fraction of its budget, since the next rung costs about four times as
 * much.
 */
const HEADROOM = 0.3;

/**
 * A source count assumed before anything has been measured. It only sets how
 * cautious the very first computation in the session is; every one after that
 * is sized from a real measurement.
 */
const DEFAULT_SOURCE_COUNT = 200;

/**
 * How far a single measurement is allowed to raise the proven workload. Caps
 * a lucky fast frame (a GPU idle from being warmed up, say) from being taken
 * as license to leap several rungs at once; roughly one and a half rungs'
 * worth of workload (a rung is a 4x change in pixel count) per measurement.
 */
const MAX_WORKLOAD_GROWTH = 6;

/**
 * When a step overruns its budget, the next workload target is scaled down
 * proportionally to what the timing implies would have fit — then pulled in
 * a little further, since the proportionality is only approximate and the
 * next attempt should clear the budget rather than land back on the edge.
 */
const OVERRUN_SAFETY_MARGIN = 0.7;

/**
 * Snap a resolution onto the ladder, rounding down.
 * @param {number} resolution
 * @returns {number}
 */
export function snapToLadder(resolution) {
  let chosen = RESOLUTION_LADDER[0];
  for (const rung of RESOLUTION_LADDER) {
    if (rung <= resolution) chosen = rung;
  }
  return chosen;
}

/**
 * The next rung above a resolution, capped.
 * @param {number} resolution
 * @param {number} max
 * @returns {number|null} Null if already at the cap or the top.
 */
export function nextRung(resolution, max) {
  for (const rung of RESOLUTION_LADDER) {
    if (rung > resolution && rung <= max) return rung;
  }
  return null;
}

/**
 * The rung below a resolution.
 * @param {number} resolution
 * @param {number} min
 * @returns {number}
 */
export function previousRung(resolution, min) {
  let chosen = min;
  for (const rung of RESOLUTION_LADDER) {
    if (rung < resolution && rung >= min) chosen = rung;
  }
  return chosen;
}

/**
 * The compute workload a resolution and source count imply: our stand-in for
 * the number of source-pixel pairs the field pass has to sum, which is what
 * its cost is actually proportional to.
 * @param {number} resolution
 * @param {number} sourceCount
 * @returns {number}
 */
function workloadOf(resolution, sourceCount) {
  return resolution * resolution * Math.max(1, sourceCount);
}

/**
 * Tracks what this machine has managed, for both budgets, in workload units.
 * @class
 */
export class AdaptiveResolution {
  constructor() {
    this.provenInteractiveWorkload = workloadOf(MIN_INTERACTIVE_RESOLUTION, DEFAULT_SOURCE_COUNT);
    this.provenSettledWorkload = workloadOf(512, DEFAULT_SOURCE_COUNT);
  }

  /**
   * Where to start a redraw.
   * @param {number} sourceCount - How many point sources this redraw will sum.
   * @param {number} target - The resolution the user asked for, or the cap in auto mode.
   * @param {boolean} interacting
   * @returns {number}
   */
  chooseInitial(sourceCount, target, interacting) {
    const proven = interacting ? this.provenInteractiveWorkload : this.provenSettledWorkload;
    const floor = interacting ? MIN_INTERACTIVE_RESOLUTION : RESOLUTION_LADDER[0];
    const targetRung = snapToLadder(target);

    if (!(sourceCount > 0)) {
      // Nothing to sum, so any resolution is effectively free.
      return Math.max(floor, targetRung);
    }

    // The resolution at which the proven workload is fully spent on this many
    // sources — snapped *down*, since overshooting is what caused the problem
    // this class exists to avoid.
    const affordable = snapToLadder(Math.sqrt(proven / sourceCount));
    return Math.max(floor, Math.min(targetRung, affordable));
  }

  /**
   * Record how long a redraw took, and adjust what this machine is believed to
   * manage, in workload terms.
   * @param {number} resolution
   * @param {number} sourceCount
   * @param {number} elapsedMs
   * @param {boolean} interacting
   */
  record(resolution, sourceCount, elapsedMs, interacting) {
    const budget = interacting ? INTERACTIVE_BUDGET_MS : SETTLED_BUDGET_MS;
    const key = interacting ? 'provenInteractiveWorkload' : 'provenSettledWorkload';
    const workload = workloadOf(resolution, sourceCount);
    const safeElapsed = Math.max(elapsedMs, 0.05);

    // Cost is close to linear in workload, so the ratio of budget to elapsed
    // time is a direct estimate of how much workload the budget actually
    // affords — used to pull back after an overrun, or to justify climbing
    // after a comfortably fast step, rather than only nudging by one rung.
    const impliedCapacity = workload * (budget / safeElapsed);

    if (elapsedMs > budget) {
      this[key] = Math.min(this[key], impliedCapacity * OVERRUN_SAFETY_MARGIN);
    } else if (elapsedMs < budget * HEADROOM) {
      const capped = Math.min(impliedCapacity, workload * MAX_WORKLOAD_GROWTH);
      this[key] = Math.max(this[key], capped);
    } else {
      this[key] = Math.max(this[key], workload);
    }
  }

  /**
   * The next resolution to refine to, or null to stop.
   *
   * This still steps by resolution rather than by workload: it runs only
   * within one scene's refinement sequence, where the source count is fixed
   * and `lastElapsedMs` is a real measurement at that count already — exactly
   * the situation workload tracking exists to substitute for when there is no
   * such measurement yet.
   * @param {number} current
   * @param {number} target
   * @param {number} lastElapsedMs
   * @returns {number|null}
   */
  nextStep(current, target, lastElapsedMs) {
    if (current >= target) return null;
    if (lastElapsedMs > SETTLED_BUDGET_MS * HEADROOM) return null;
    return nextRung(current, snapToLadder(target));
  }
}
