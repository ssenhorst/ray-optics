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

import BaseSceneObj from '../BaseSceneObj.js';
import LineObjMixin from '../LineObjMixin.js';
import i18next from 'i18next';
import { evaluateLatex } from '../../equation.js';
import { wavelengthInMedium } from '../../waveOptics/conventions.js';
import {
  equationInfo, amplitudeExamples, phaseExamples, sagExamples
} from './waveEquationInfo.js';

/** Samples used when scanning the curve for its steepest point. */
const SLOPE_SCAN_SAMPLES = 64;

/** Step used for the central difference that gives the surface slope. */
const SLOPE_EPSILON = 1e-4;

/**
 * A surface that divides space, transmitting the field from the subspace before
 * it into the subspace after it.
 *
 * The surface is single-valued in the transverse coordinate: it is written as
 * `z = f(y)` over a finite range of `y`. That restriction is what gives the
 * scene a well-defined stack of subspaces, since a pixel's subspace is then a
 * single comparison per interface, and it matches the requirement that
 * interfaces be ordered along the optical axis.
 *
 * The chord from `p1` to `p2` sets the transverse extent and the base position,
 * and `z(y)` is the sag equation added to it. `y` in all three equations is
 * measured from the centre of the chord, so a spherical surface is
 * `y^2 / (2 R)` and a thin lens is a phase of `-k y^2 / (2 f)`.
 *
 * Outside its transverse extent the interface is opaque: nothing crosses it
 * there, so a short interface is also a beam blocker, and the light that does
 * appear in the geometric shadow is genuine edge diffraction.
 *
 * Tools -> Interface
 * @class
 * @extends BaseSceneObj
 * @memberof sceneObjs
 * @property {Point} p1 - One end of the chord.
 * @property {Point} p2 - The other end of the chord.
 * @property {number} refractiveIndexAfter - Index of the subspace after this interface.
 * @property {string} eqnSag - Position along the optical axis relative to the chord, in LaTeX.
 * @property {string} eqnAmplitude - Amplitude transmission as a function of `y`, in LaTeX.
 * @property {string} eqnPhase - Phase shift in radians as a function of `y`, in LaTeX.
 */
class WaveInterface extends LineObjMixin(BaseSceneObj) {
  static type = 'WaveInterface';
  static isOptical = true;
  static serializableDefaults = {
    p1: null,
    p2: null,
    refractiveIndexAfter: 1.5,
    eqnSag: '0',
    eqnAmplitude: '1',
    eqnPhase: '0'
  };

  static getDescription(objData, scene, detailed = false) {
    return i18next.t('main:waveTools.WaveInterface.title');
  }

  /** Popover content for the three equation fields. */
  static equationHelp(scene) {
    const variable = i18next.t('simulator:waveSceneObjs.common.yInfo');
    return {
      sag: equationInfo({
        role: i18next.t('simulator:waveSceneObjs.common.sagInfo'),
        variable,
        examples: sagExamples(),
      }),
      amplitude: equationInfo({ variable, examples: amplitudeExamples('y') }),
      phase: equationInfo({
        role: i18next.t('simulator:waveSceneObjs.common.phaseRadiansInfo'),
        variable,
        examples: phaseExamples('y', scene),
      }),
    };
  }

  static getPropertySchema(objData, scene) {
    const help = WaveInterface.equationHelp(scene);
    return [
      ...super.getPropertySchema(objData, scene),
      {
        key: 'refractiveIndexAfter', type: 'number',
        label: i18next.t('simulator:waveSceneObjs.common.refractiveIndexAfter')
      },
      { key: 'eqnSag', type: 'equation', label: 'z(y)', variables: ['y'], info: help.sag },
      { key: 'eqnAmplitude', type: 'equation', label: '|t|(y)', variables: ['y'], info: help.amplitude },
      { key: 'eqnPhase', type: 'equation', label: 'arg t(y)', variables: ['y'], info: help.phase },
    ];
  }

  populateObjBar(objBar) {
    const help = WaveInterface.equationHelp(this.scene);
    objBar.setTitle(i18next.t('main:waveTools.WaveInterface.title'));
    objBar.createNumber(
      i18next.t('simulator:waveSceneObjs.common.refractiveIndexAfter'),
      0.1, 5, 0.01, this.refractiveIndexAfter,
      function (obj, value) { obj.refractiveIndexAfter = value; },
      '<p>' + i18next.t('simulator:waveSceneObjs.common.refractiveIndexAfterInfo') + '</p>'
    );
    objBar.createEquation('z(y)', this.eqnSag, function (obj, value) {
      obj.eqnSag = value;
    }, help.sag);
    objBar.createEquation('|t|(y)', this.eqnAmplitude, function (obj, value) {
      obj.eqnAmplitude = value;
    }, help.amplitude);
    objBar.createEquation('arg t(y)', this.eqnPhase, function (obj, value) {
      obj.eqnPhase = value;
    }, help.phase);
  }

  /**
   * Compile a LaTeX equation, reusing the last compilation while the source is
   * unchanged. `zAt` is called once per lookup-table entry and once per
   * membership test, so recompiling each time would dominate.
   * @param {string} key - The property name holding the LaTeX.
   * @returns {function}
   * @private
   */
  compiled(key) {
    this._compiledCache ??= {};
    const cache = this._compiledCache;
    if (cache[key]?.source !== this[key]) {
      cache[key] = { source: this[key], fn: evaluateLatex(this[key]) };
    }
    return cache[key].fn;
  }

  /** @returns {boolean} Whether the chord spans a usable transverse range. */
  isValid() {
    return Boolean(this.p1) && Boolean(this.p2) && this.p1.y !== this.p2.y;
  }

  /**
   * The transverse extent and the axial position at each end.
   * @returns {{yMin: number, yMax: number, zAtYMin: number, zAtYMax: number}|null}
   */
  getExtent() {
    if (!this.isValid()) return null;
    const yMin = Math.min(this.p1.y, this.p2.y);
    const yMax = Math.max(this.p1.y, this.p2.y);
    return { yMin, yMax, zAtYMin: this.zAt(yMin), zAtYMax: this.zAt(yMax) };
  }

  /** @returns {number} The transverse centre of the chord. */
  centerY() {
    return (this.p1.y + this.p2.y) / 2;
  }

  /**
   * The position along the optical axis at a transverse position.
   *
   * Beyond the transverse extent the surface is extended at the axial position
   * of the nearer end. That extension is never radiated from; it exists so that
   * every point in the scene still has a well-defined subspace, which is what
   * makes a short interface read as an opaque screen continuing to the edges.
   *
   * @param {number} y - Transverse position in scene coordinates.
   * @returns {number}
   */
  zAt(y) {
    if (!this.isValid()) return NaN;
    const yMin = Math.min(this.p1.y, this.p2.y);
    const yMax = Math.max(this.p1.y, this.p2.y);
    const clamped = Math.min(yMax, Math.max(yMin, y));
    const fraction = (clamped - this.p1.y) / (this.p2.y - this.p1.y);
    const base = this.p1.x + (this.p2.x - this.p1.x) * fraction;
    return base + this.compiled('eqnSag')({ y: clamped - this.centerY() });
  }

  /**
   * The slope `dz/dy` of the surface, by central difference.
   * @param {number} y - Transverse position in scene coordinates.
   * @returns {number}
   */
  slopeAt(y) {
    const step = SLOPE_EPSILON * Math.max(1, Math.abs(this.p2.y - this.p1.y));
    return (this.zAt(y + step) - this.zAt(y - step)) / (2 * step);
  }

  /**
   * The mean axial position, used to order the interfaces.
   * @returns {number}
   */
  meanZ() {
    if (!this.isValid()) return NaN;
    const extent = this.getExtent();
    let total = 0;
    for (let i = 0; i <= SLOPE_SCAN_SAMPLES; i++) {
      total += this.zAt(extent.yMin + (extent.yMax - extent.yMin) * i / SLOPE_SCAN_SAMPLES);
    }
    return total / (SLOPE_SCAN_SAMPLES + 1);
  }

  /**
   * The axial range the surface occupies, used to detect interfaces that
   * overlap and so have no well-defined order.
   * @returns {{min: number, max: number}|null}
   */
  getAxialRange() {
    if (!this.isValid()) return null;
    const extent = this.getExtent();
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i <= SLOPE_SCAN_SAMPLES; i++) {
      const z = this.zAt(extent.yMin + (extent.yMax - extent.yMin) * i / SLOPE_SCAN_SAMPLES);
      if (z < min) min = z;
      if (z > max) max = z;
    }
    return { min, max };
  }

  /**
   * How many samples this surface needs.
   *
   * The count is set by the steepest part of the curve, so that the arc-length
   * spacing satisfies the requested density everywhere rather than only on
   * average. Sampling is uniform in `y`, which is what keeps the subspace
   * lookup table and the sample positions consistent.
   *
   * @param {Object} context
   * @returns {number}
   */
  getSurfaceSampleCount({ settings, samplesPerWavelength, refractiveIndexBefore = 1 }) {
    if (!this.isValid()) return 0;
    const extent = this.getExtent();
    const span = extent.yMax - extent.yMin;

    let steepest = 1;
    for (let i = 0; i <= SLOPE_SCAN_SAMPLES; i++) {
      const y = extent.yMin + span * i / SLOPE_SCAN_SAMPLES;
      const factor = Math.hypot(1, this.slopeAt(y));
      if (factor > steepest) steepest = factor;
    }

    // Nyquist has to hold in whichever of the two media has the shorter
    // wavelength, since the same samples serve both sides.
    const shortest = wavelengthInMedium(
      settings.wavelength,
      Math.max(refractiveIndexBefore, this.refractiveIndexAfter)
    );
    return Math.max(1, Math.ceil(span * samplesPerWavelength * steepest / shortest));
  }

  /**
   * Sample the surface into secondary source sites.
   *
   * Each sample carries its forward normal, the arc length it stands for, and
   * the complex transmission there. The incident field is filled in later by
   * the propagation chain.
   *
   * @param {Object} context
   * @returns {Array<{x: number, y: number, nx: number, ny: number, ds: number, tRe: number, tIm: number}>}
   */
  getSurfaceSamples(context) {
    this.error = null;
    if (!this.isValid()) return [];

    let amplitudeOf;
    let phaseOf;
    try {
      amplitudeOf = this.compiled('eqnAmplitude');
      phaseOf = this.compiled('eqnPhase');
      this.compiled('eqnSag');
    } catch (e) {
      this.error = e.toString();
      return [];
    }

    const extent = this.getExtent();
    const span = extent.yMax - extent.yMin;
    const count = this.getSurfaceSampleCount(context);
    const step = span / count;
    const centerY = this.centerY();

    const samples = [];
    for (let i = 0; i < count; i++) {
      const y = extent.yMin + (i + 0.5) * step;
      const local = y - centerY;

      let z;
      let slope;
      let amplitude;
      let phase;
      try {
        z = this.zAt(y);
        slope = this.slopeAt(y);
        amplitude = amplitudeOf({ y: local });
        phase = phaseOf({ y: local });
      } catch (e) {
        this.error = e.toString();
        return [];
      }
      if (![z, slope, amplitude, phase].every(Number.isFinite)) continue;

      // The surface is z = f(y), so its tangent is (f', 1) and the forward
      // normal is (1, -f') normalised.
      const norm = Math.hypot(1, slope);
      samples.push({
        x: z,
        y,
        nx: 1 / norm,
        ny: -slope / norm,
        ds: step * norm,
        tRe: amplitude * Math.cos(phase),
        tIm: amplitude * Math.sin(phase),
      });
    }
    return samples;
  }

  draw(canvasRenderer, isAboveLight, isHovered) {
    if (!isAboveLight) return;

    const ctx = canvasRenderer.ctx;
    const ls = canvasRenderer.lengthScale;

    if (!this.isValid()) {
      ctx.fillStyle = 'rgb(128,128,128)';
      ctx.fillRect(this.p1.x - 1.5 * ls, this.p1.y - 1.5 * ls, 3 * ls, 3 * ls);
      return;
    }

    const extent = this.getExtent();
    const span = extent.yMax - extent.yMin;
    const color = isHovered
      ? this.scene.highlightColorCss
      : canvasRenderer.rgbaToCssColor(this.scene.theme.mirror.color);

    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5 * ls;
    ctx.setLineDash([]);
    ctx.beginPath();
    for (let i = 0; i <= SLOPE_SCAN_SAMPLES; i++) {
      const y = extent.yMin + span * i / SLOPE_SCAN_SAMPLES;
      const z = this.zAt(y);
      if (i === 0) ctx.moveTo(z, y); else ctx.lineTo(z, y);
    }
    ctx.stroke();

    // Short dashed stubs past each end, marking that the surface goes on as an
    // opaque screen rather than simply stopping.
    const stub = Math.min(span * 0.15, 40 * ls);
    ctx.setLineDash([3 * ls, 3 * ls]);
    ctx.lineWidth = 1 * ls;
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.moveTo(extent.zAtYMin, extent.yMin);
    ctx.lineTo(extent.zAtYMin, extent.yMin - stub);
    ctx.moveTo(extent.zAtYMax, extent.yMax);
    ctx.lineTo(extent.zAtYMax, extent.yMax + stub);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
  }

  getError() {
    return this.error;
  }

  /** Wave objects take no part in ray tracing. */
  checkRayIntersects(ray) {
    return null;
  }
}

export default WaveInterface;
