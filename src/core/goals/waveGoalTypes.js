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
 * @file `src/core/goals/waveGoalTypes.js` defines the goal types for wave-optics scenes.
 *
 * A wave scene has no rays to count, so these goals measure the field instead. Each one samples the
 * intensity along a probe line and then asks a question about the profile: where its brightest peak
 * is, how far apart its fringes are, how deep they modulate, how wide the focus is, and whether two
 * peaks are separated enough to be told apart.
 *
 * Every measure is deliberately scale-free — a length, a ratio or a count — because the absolute
 * field amplitude depends on how bright the author made the source, which is not something a student
 * should have to match.
 */

/**
 * @typedef {Object} IntensityProfile
 * @property {Float64Array} intensity - The intensity at each sample.
 * @property {number} length - The length of the probe line in scene units.
 * @property {function(number): Point} positionAt - The scene position of a sample index.
 */

const EPS = 1e-12;

/**
 * A smooth 0-to-1 score that reaches 1 when `value` is within `tolerance` of zero.
 * @param {number} value - The non-negative error.
 * @param {number} tolerance - The error at which the goal counts as met.
 * @returns {number} The score.
 */
function closenessScore(value, tolerance) {
  if (!isFinite(value) || !(tolerance > 0)) return 0;
  if (value <= tolerance) return 1;
  return tolerance / value;
}

function requireLine(goal) {
  const line = goal.line;
  if (!line || !line.p1 || !line.p2
    || typeof line.p1.x !== 'number' || typeof line.p1.y !== 'number'
    || typeof line.p2.x !== 'number' || typeof line.p2.y !== 'number') {
    return `goal of type '${goal.type}' requires a probe 'line' with points p1 and p2`;
  }
  const length = Math.hypot(line.p2.x - line.p1.x, line.p2.y - line.p1.y);
  if (!(length > 0)) return `goal of type '${goal.type}' has a probe line of zero length`;
  return null;
}

/**
 * Sample the intensity of the field along a goal's probe line.
 * @param {Object} goal - The goal definition.
 * @param {Object} context - The evaluation context, which must carry `sampleField`.
 * @returns {IntensityProfile|null} The profile, or null if the scene cannot be sampled.
 */
function sampleProfile(goal, context) {
  if (typeof context.sampleField !== 'function') return null;

  const { p1, p2 } = goal.line;
  const count = Math.max(16, Math.min(2001, Math.round(goal.samples ?? 401)));
  const points = new Array(count);
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    points[i] = { x: p1.x + (p2.x - p1.x) * t, y: p1.y + (p2.y - p1.y) * t };
  }

  const field = context.sampleField(points);
  if (!field) return null;

  const intensity = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    const re = field[i * 2];
    const im = field[i * 2 + 1];
    intensity[i] = re * re + im * im;
  }

  const length = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  return {
    intensity,
    length,
    positionAt: (index) => {
      const t = Math.max(0, Math.min(1, index / (count - 1)));
      return { x: p1.x + (p2.x - p1.x) * t, y: p1.y + (p2.y - p1.y) * t };
    },
    distanceAt: (index) => (index / (count - 1)) * length,
  };
}

/**
 * The local maxima of a profile, strongest first, keeping only those that stand clear of the
 * surrounding minima. Without the prominence test, sampling ripple on a broad peak would be counted
 * as a row of fringes.
 * @param {IntensityProfile} profile - The sampled profile.
 * @param {number} [relativeThreshold=0.05] - Ignore peaks below this fraction of the strongest.
 * @param {number} [prominence=0.2] - A peak must rise this fraction of its own height above the
 * lowest point separating it from a stronger neighbour.
 * @returns {Array<{index: number, value: number}>} The peaks, in order along the line.
 */
function findPeaks(profile, relativeThreshold = 0.05, prominence = 0.2) {
  const y = profile.intensity;
  let max = 0;
  for (let i = 0; i < y.length; i++) max = Math.max(max, y[i]);
  if (!(max > 0)) return [];

  const candidates = [];
  for (let i = 1; i < y.length - 1; i++) {
    if (y[i] >= y[i - 1] && y[i] > y[i + 1] && y[i] >= relativeThreshold * max) {
      candidates.push({ index: i, value: y[i] });
    }
  }
  if (candidates.length <= 1) return candidates;

  // Drop a candidate when the dip between it and the neighbouring candidate is too shallow: the two
  // are then one peak sampled twice rather than two fringes.
  const kept = [candidates[0]];
  for (let c = 1; c < candidates.length; c++) {
    const previous = kept[kept.length - 1];
    const current = candidates[c];
    let valley = Infinity;
    for (let i = previous.index; i <= current.index; i++) valley = Math.min(valley, y[i]);
    const lower = Math.min(previous.value, current.value);
    if (valley <= lower * (1 - prominence)) {
      kept.push(current);
    } else if (current.value > previous.value) {
      kept[kept.length - 1] = current;
    }
  }
  return kept;
}

/**
 * The full width at half maximum of the peak around a given sample, in scene units.
 * @param {IntensityProfile} profile - The sampled profile.
 * @param {number} peakIndex - The sample at the top of the peak.
 * @returns {number} The width, or Infinity if the profile never falls to half on both sides.
 */
function fullWidthHalfMaximum(profile, peakIndex) {
  const y = profile.intensity;
  const half = y[peakIndex] / 2;
  if (!(half > 0)) return Infinity;

  const crossing = (from, step) => {
    for (let i = from; i >= 0 && i < y.length; i += step) {
      if (y[i] <= half) {
        // Interpolate between this sample and the previous one for a smooth measure.
        const previous = i - step;
        const span = y[previous] - y[i];
        const fraction = span > EPS ? (y[previous] - half) / span : 0;
        return previous + step * fraction;
      }
    }
    return null;
  };

  const left = crossing(peakIndex, -1);
  const right = crossing(peakIndex, 1);
  if (left === null || right === null) return Infinity;
  return profile.distanceAt(right) - profile.distanceAt(left);
}

/** The reason a wave goal cannot say anything, when the scene is not a wave scene. */
const NO_FIELD = { satisfied: false, progress: 0, detail: 'this goal needs a wave-optics scene' };

/**
 * Require the brightest point along a probe line to sit at a given place. This is how "put the focus
 * here" or "send the first order to this point" is stated.
 */
const waveIntensityPeak = {
  validate(goal) {
    const err = requireLine(goal);
    if (err) return err;
    if (!goal.point || typeof goal.point.x !== 'number' || typeof goal.point.y !== 'number') {
      return "goal of type 'waveIntensityPeak' requires a point with numeric x and y";
    }
    if (goal.radius !== undefined && !(goal.radius > 0)) return 'radius must be a positive number';
    return null;
  },

  getTargets(goal) {
    return [{ type: 'circle', x: goal.point.x, y: goal.point.y, r: goal.radius ?? 10 }];
  },

  evaluate(goal, context) {
    const profile = sampleProfile(goal, context);
    if (!profile) return NO_FIELD;

    const peaks = findPeaks(profile, goal.threshold ?? 0.05);
    if (peaks.length === 0) {
      return { satisfied: false, progress: 0, detail: 'no light along the probe line' };
    }

    const order = goal.order ?? 0;
    const strongest = [...peaks].sort((a, b) => b.value - a.value);
    const chosen = strongest[Math.min(order, strongest.length - 1)];
    const at = profile.positionAt(chosen.index);
    const radius = goal.radius ?? 10;
    const offset = Math.hypot(at.x - goal.point.x, at.y - goal.point.y);
    const satisfied = offset <= radius;

    return {
      satisfied,
      progress: satisfied ? 1 : closenessScore(offset, radius),
      detail: `the peak is ${offset.toFixed(1)} units from the target`,
      marks: [{ type: 'point', x: at.x, y: at.y, label: 'peak' }],
    };
  },
};

/**
 * Require the fringes along a probe line to have a given spacing. This is the measurement that ties
 * a grating's pitch, the wavelength and the geometry together.
 */
const waveFringeSpacing = {
  validate(goal) {
    const err = requireLine(goal);
    if (err) return err;
    if (!(goal.spacing > 0)) return "goal of type 'waveFringeSpacing' requires a positive 'spacing'";
    return null;
  },

  getTargets(goal) {
    return [];
  },

  evaluate(goal, context) {
    const profile = sampleProfile(goal, context);
    if (!profile) return NO_FIELD;

    const peaks = findPeaks(profile, goal.threshold ?? 0.1);
    if (peaks.length < 2) {
      return {
        satisfied: false,
        progress: 0,
        detail: `${peaks.length} fringe${peaks.length === 1 ? '' : 's'} on the line, at least 2 needed`,
      };
    }

    let total = 0;
    for (let i = 1; i < peaks.length; i++) {
      total += profile.distanceAt(peaks[i].index) - profile.distanceAt(peaks[i - 1].index);
    }
    const measured = total / (peaks.length - 1);
    const tolerance = goal.tolerance ?? goal.spacing * 0.08;
    const error = Math.abs(measured - goal.spacing);
    const satisfied = error <= tolerance;

    return {
      satisfied,
      progress: satisfied ? 1 : closenessScore(error, tolerance),
      detail: `fringe spacing ${measured.toFixed(1)} units (want ${goal.spacing} ± ${tolerance.toFixed(1)})`,
    };
  },
};

/**
 * Require the fringes along a probe line to modulate deeply enough. Contrast is what decides whether
 * a pattern prints, so this is the goal an exercise about mask design ends at.
 */
const waveFringeContrast = {
  validate(goal) {
    const err = requireLine(goal);
    if (err) return err;
    if (!(goal.min > 0 && goal.min <= 1)) {
      return "goal of type 'waveFringeContrast' requires 'min' between 0 and 1";
    }
    return null;
  },

  getTargets(goal) {
    return [];
  },

  evaluate(goal, context) {
    const profile = sampleProfile(goal, context);
    if (!profile) return NO_FIELD;

    let max = -Infinity;
    let min = Infinity;
    for (let i = 0; i < profile.intensity.length; i++) {
      max = Math.max(max, profile.intensity[i]);
      min = Math.min(min, profile.intensity[i]);
    }
    if (!(max > EPS)) {
      return { satisfied: false, progress: 0, detail: 'no light along the probe line' };
    }

    const visibility = (max - min) / (max + min);
    const satisfied = visibility >= goal.min;
    return {
      satisfied,
      progress: satisfied ? 1 : Math.max(0, Math.min(1, visibility / goal.min)),
      detail: `contrast ${visibility.toFixed(3)} (need ${goal.min})`,
    };
  },
};

/**
 * Require the principal peak along a probe line to be no wider than a given size. Measured as the
 * full width at half maximum, which is how a spot size is quoted.
 */
const waveSpotSize = {
  validate(goal) {
    const err = requireLine(goal);
    if (err) return err;
    if (goal.max === undefined && goal.target === undefined) {
      return "goal of type 'waveSpotSize' requires either 'max' or 'target'";
    }
    return null;
  },

  getTargets(goal) {
    return [];
  },

  evaluate(goal, context) {
    const profile = sampleProfile(goal, context);
    if (!profile) return NO_FIELD;

    let peakIndex = 0;
    for (let i = 1; i < profile.intensity.length; i++) {
      if (profile.intensity[i] > profile.intensity[peakIndex]) peakIndex = i;
    }
    if (!(profile.intensity[peakIndex] > EPS)) {
      return { satisfied: false, progress: 0, detail: 'no light along the probe line' };
    }

    const width = fullWidthHalfMaximum(profile, peakIndex);
    if (!isFinite(width)) {
      return {
        satisfied: false,
        progress: 0,
        detail: 'the peak does not fall to half within the probe line',
      };
    }

    if (goal.target !== undefined) {
      const tolerance = goal.tolerance ?? goal.target * 0.1;
      const error = Math.abs(width - goal.target);
      const satisfied = error <= tolerance;
      return {
        satisfied,
        progress: satisfied ? 1 : closenessScore(error, tolerance),
        detail: `spot ${width.toFixed(1)} units across (want ${goal.target} ± ${tolerance.toFixed(1)})`,
      };
    }

    const satisfied = width <= goal.max;
    return {
      satisfied,
      progress: satisfied ? 1 : closenessScore(width - goal.max, goal.max),
      detail: `spot ${width.toFixed(1)} units across (need ${goal.max} or less)`,
    };
  },
};

/**
 * Require a given number of peaks along a probe line, each pair separated by a dip deep enough for
 * them to be told apart. This is the Rayleigh question: are these two points resolved?
 */
const waveResolvedPeaks = {
  validate(goal) {
    const err = requireLine(goal);
    if (err) return err;
    if (!(goal.count >= 1)) return "goal of type 'waveResolvedPeaks' requires a 'count' of at least 1";
    if (goal.dip !== undefined && !(goal.dip > 0 && goal.dip < 1)) {
      return 'dip must be between 0 and 1';
    }
    return null;
  },

  getTargets(goal) {
    return [];
  },

  evaluate(goal, context) {
    const profile = sampleProfile(goal, context);
    if (!profile) return NO_FIELD;

    // The Rayleigh criterion puts the dip at about 0.81 of the peaks for two incoherent points; a
    // fifth of the way down is a forgiving default for a teaching exercise.
    const dip = goal.dip ?? 0.2;
    const peaks = findPeaks(profile, goal.threshold ?? 0.05, dip);
    const satisfied = peaks.length === goal.count;

    let detail = `${peaks.length} peak${peaks.length === 1 ? '' : 's'} resolved, want ${goal.count}`;
    const marks = peaks.map(peak => {
      const at = profile.positionAt(peak.index);
      return { type: 'point', x: at.x, y: at.y };
    });

    if (peaks.length === 2) {
      const y = profile.intensity;
      let valley = Infinity;
      for (let i = peaks[0].index; i <= peaks[1].index; i++) valley = Math.min(valley, y[i]);
      const lower = Math.min(peaks[0].value, peaks[1].value);
      detail += `, dip to ${(valley / lower).toFixed(2)} of the peaks`;
    }

    return {
      satisfied,
      progress: satisfied ? 1 : Math.max(0, 1 - Math.abs(peaks.length - goal.count) / goal.count) * 0.9,
      detail,
      marks,
    };
  },
};

/**
 * The wave-optics goal types, keyed by the `type` field of a goal in the scene JSON.
 * @const {Object<string, Object>}
 */
export const WAVE_GOAL_TYPES = {
  waveIntensityPeak,
  waveFringeSpacing,
  waveFringeContrast,
  waveSpotSize,
  waveResolvedPeaks,
};

export { findPeaks, fullWidthHalfMaximum, sampleProfile };
