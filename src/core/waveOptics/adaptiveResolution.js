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
 * @file Chooses the field grid resolution from what the machine has actually
 * managed, rather than from a fixed guess.
 *
 * A cost model would need to account for the grid size, the source count, the
 * number of subspaces, the chain (whose cost does not depend on the grid at
 * all) and the GPU in the machine. Measuring instead needs none of that: climb
 * the ladder while each step comes in under its time budget, and remember the
 * highest rung that did. The estimate corrects itself as the scene changes.
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
 * Tracks what this machine has managed, for both budgets.
 * @class
 */
export class AdaptiveResolution {
  constructor() {
    /** The highest rung a drag redraw has stayed within budget at. */
    this.provenInteractive = MIN_INTERACTIVE_RESOLUTION;
    /** The highest rung a settled redraw has stayed within budget at. */
    this.provenSettled = 512;
  }

  /**
   * Where to start a redraw.
   * @param {number} target - The resolution the user asked for, or the cap in auto mode.
   * @param {boolean} interacting
   * @returns {number}
   */
  chooseInitial(target, interacting) {
    const proven = interacting ? this.provenInteractive : this.provenSettled;
    const floor = interacting ? MIN_INTERACTIVE_RESOLUTION : RESOLUTION_LADDER[0];
    return Math.max(floor, Math.min(snapToLadder(target), proven));
  }

  /**
   * Record how long a redraw took, and adjust what this machine is believed to
   * manage.
   * @param {number} resolution
   * @param {number} elapsedMs
   * @param {boolean} interacting
   */
  record(resolution, elapsedMs, interacting) {
    const budget = interacting ? INTERACTIVE_BUDGET_MS : SETTLED_BUDGET_MS;
    const floor = interacting ? MIN_INTERACTIVE_RESOLUTION : RESOLUTION_LADDER[0];
    const key = interacting ? 'provenInteractive' : 'provenSettled';

    if (elapsedMs > budget) {
      // Too slow: believe one rung less than what was just attempted.
      this[key] = previousRung(resolution, floor);
    } else if (elapsedMs < budget * HEADROOM) {
      // Comfortably fast: allow one rung more than what was just managed.
      this[key] = Math.max(this[key], nextRung(resolution, RESOLUTION_LADDER.at(-1)) ?? resolution);
    } else {
      this[key] = Math.max(this[key], resolution);
    }
  }

  /**
   * The next resolution to refine to, or null to stop.
   * @param {number} current
   * @param {number} target
   * @param {number} lastElapsedMs
   * @returns {number|null}
   */
  nextStep(current, target, lastElapsedMs) {
    if (current >= target) return null;
    // Only climb if the step just finished left room for one costing about
    // four times as much.
    if (lastElapsedMs > SETTLED_BUDGET_MS * HEADROOM) return null;
    return nextRung(current, snapToLadder(target));
  }
}
