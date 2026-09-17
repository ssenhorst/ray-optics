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
import geometry from '../../geometry.js';
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

/** Samples across the smallest feature that still has to be resolved. */
const SAMPLES_PER_FEATURE = 2;

/**
 * The finest transmission structure worth resolving, as a fraction of the
 * wavelength in the denser medium.
 *
 * A pattern of period `d` diffracts to `sin(theta) = lambda / d`, so structure
 * finer than half a wavelength has no propagating orders at all: it couples
 * only to evanescent waves, which this model does not carry. Sampling past that
 * point buys nothing and costs sources in proportion, which is why a slit
 * narrowed towards a point source used to make the scene *more* expensive the
 * closer it got to the ideal it was approaching.
 *
 * With this floor the pattern term only ever binds when the density is dropped
 * well below its default: at the default eight samples per wavelength the
 * wavelength alone already puts four samples across the finest pattern that can
 * radiate at all, so nothing that diffracts is ever undersampled.
 */
const FINEST_USEFUL_FEATURE_IN_WAVELENGTHS = 0.5;

/** Sub-samples aimed for across the finest feature, when averaging is needed. */
const SUBSAMPLES_PER_FEATURE = 8;

/**
 * The most samples one surface may contribute, whatever it asks for.
 *
 * The uniform density reduction in {@link resolveSourceDensity} cannot rescue a
 * runaway here, because the feature-driven part of the step does not depend on
 * the density: a surface asking for billions of samples would still ask for
 * billions after the reduction, and the tab would stop responding before the
 * first frame. This is the backstop that keeps a bad parameter a bad picture
 * rather than a lost session.
 */
const MAX_SURFACE_SAMPLES = 40000;

/** The most sub-samples used when averaging a transmission over one cell. */
const MAX_SUBSAMPLES = 32;

/**
 * The properties every interface has, whatever its transmission is defined by.
 * Subclasses spread this into their own `serializableDefaults` so they keep the
 * geometry and the index without redeclaring them.
 */
export const SHARED_INTERFACE_DEFAULTS = Object.freeze({
  p1: null,
  p2: null,
  refractiveIndexAfter: 1.5,
  eqnSag: '0',
});

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
    ...SHARED_INTERFACE_DEFAULTS,
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

  /**
   * The controls every interface shares: the index beyond it and its shape.
   *
   * The patterned interfaces reuse this and then add their own parameters in
   * place of the general transmission equations.
   * @param {ObjBar} objBar
   */
  populateGeometryObjBar(objBar) {
    objBar.createNumber(
      i18next.t('simulator:waveSceneObjs.common.refractiveIndexAfter'),
      0.1, 5, 0.01, this.refractiveIndexAfter,
      function (obj, value) { obj.refractiveIndexAfter = value; },
      '<p>' + i18next.t('simulator:waveSceneObjs.common.refractiveIndexAfterInfo') + '</p>'
    );
    objBar.createEquation('z(y)', this.eqnSag, function (obj, value) {
      obj.eqnSag = value;
    }, WaveInterface.equationHelp(this.scene).sag);
  }

  populateObjBar(objBar) {
    const help = WaveInterface.equationHelp(this.scene);
    objBar.setTitle(i18next.t('main:waveTools.WaveInterface.title'));
    this.populateGeometryObjBar(objBar);
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
    let min = Infinity;
    let max = -Infinity;
    for (const point of this.curvePoints()) {
      if (point.x < min) min = point.x;
      if (point.x > max) max = point.x;
    }
    return { min, max };
  }

  /**
   * The complex transmission at a transverse position.
   *
   * This is the hook the patterned interfaces override. The general interface
   * evaluates the user's amplitude and phase equations; a grating or a zone
   * plate computes its profile from its own parameters instead.
   *
   * @param {number} y - Transverse position, measured from the centre.
   * @returns {{amplitude: number, phase: number}}
   */
  transmissionAt(y) {
    return {
      amplitude: this.compiled('eqnAmplitude')({ y }),
      phase: this.compiled('eqnPhase')({ y }),
    };
  }

  /**
   * The smallest feature of the transmission profile, or null if it is smooth.
   *
   * A patterned transmission has to be sampled finely enough to resolve its own
   * structure, not just the wavelength. A grating whose pitch is finer than the
   * sampling would otherwise be reproduced as a different, coarser grating and
   * would diffract into entirely the wrong orders.
   *
   * @returns {number|null}
   */
  minimumFeatureSize() {
    return null;
  }

  /**
   * The complex transmission averaged over one sampling cell.
   *
   * Point-sampling a profile whose structure is finer than the cell makes the
   * transmitted field depend on where the samples happen to land: a slit
   * narrower than the step either swallows a sample or misses it, so the same
   * slit flickers between full and no transmission as it is dragged. Averaging
   * over the cell instead gives a slit its true fractional weight, which is what
   * lets the sample count be capped at the wavelength without the sub-wavelength
   * limit falling apart — a sub-wavelength opening then radiates like the point
   * source it physically is, with an amplitude proportional to its width.
   *
   * The average is of the complex transmission, not of amplitude and phase
   * separately, so a fine phase grating correctly loses contrast towards its
   * mean rather than keeping a full-amplitude phase that is no longer there.
   *
   * @param {number} y - Transverse position, measured from the centre.
   * @param {number} cellWidth - The width of the sampling cell, in scene units.
   * @returns {{amplitude: number, phase: number}}
   */
  averagedTransmission(y, cellWidth) {
    const feature = this.minimumFeatureSize();
    if (!(feature > 0)) return this.transmissionAt(y);

    // The sub-sample count falls out of how the feature compares with the cell,
    // so a profile far coarser than the sampling asks for a single sub-sample
    // and costs exactly what point sampling used to.
    const count = Math.min(
      MAX_SUBSAMPLES,
      Math.max(1, Math.ceil(SUBSAMPLES_PER_FEATURE * cellWidth / feature))
    );
    if (count === 1) return this.transmissionAt(y);
    let re = 0;
    let im = 0;
    for (let i = 0; i < count; i++) {
      const offset = ((i + 0.5) / count - 0.5) * cellWidth;
      const { amplitude, phase } = this.transmissionAt(y + offset);
      re += amplitude * Math.cos(phase);
      im += amplitude * Math.sin(phase);
    }
    return {
      amplitude: Math.hypot(re, im) / count,
      phase: Math.atan2(im, re),
    };
  }

  /**
   * How many samples this surface needs.
   *
   * Sampling is uniform in `y`, which is what keeps the subspace lookup table
   * and the sample positions consistent, so both requirements are expressed as
   * a limit on the transverse step. The wavelength limit uses the steepest part
   * of the curve, so the *arc-length* spacing satisfies the requested density
   * everywhere rather than only on average.
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
    let step = shortest / (samplesPerWavelength * steepest);

    // A patterned transmission has to be resolved as well as the wavelength,
    // but only down to the finest structure that can radiate at all. Below that
    // the averaging in `averagedTransmission` carries the profile instead.
    const feature = this.minimumFeatureSize();
    if (feature > 0) {
      const resolvable = Math.max(feature, shortest * FINEST_USEFUL_FEATURE_IN_WAVELENGTHS);
      step = Math.min(step, resolvable / SAMPLES_PER_FEATURE);
    }

    return Math.max(1, Math.min(MAX_SURFACE_SAMPLES, Math.ceil(span / step)));
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

    try {
      this.compiled('eqnSag');
      this.transmissionAt(0);
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
        ({ amplitude, phase } = this.averagedTransmission(local, step));
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

  /**
   * Points along the drawn profile, used for rendering, for hit testing and
   * for the axial-range scan.
   * @param {number} [count=SLOPE_SCAN_SAMPLES]
   * @returns {Array<{x: number, y: number}>}
   */
  curvePoints(count = SLOPE_SCAN_SAMPLES) {
    if (!this.isValid()) return [];
    const extent = this.getExtent();
    const span = extent.yMax - extent.yMin;
    const points = [];
    for (let i = 0; i <= count; i++) {
      const y = extent.yMin + span * i / count;
      points.push({ x: this.zAt(y), y });
    }
    return points;
  }

  /**
   * Hit testing follows the drawn profile rather than the straight chord, so a
   * curved interface can be grabbed where it actually appears. The endpoints
   * are tested first so they stay reachable where the curve passes close to
   * them.
   */
  checkMouseOver(mouse) {
    if (!this.isValid()) return super.checkMouseOver(mouse);

    if (mouse.isOnPoint(this.p1) &&
      geometry.distanceSquared(mouse.pos, this.p1) <= geometry.distanceSquared(mouse.pos, this.p2)) {
      return { part: 1, targetPoint: geometry.point(this.p1.x, this.p1.y) };
    }
    if (mouse.isOnPoint(this.p2)) {
      return { part: 2, targetPoint: geometry.point(this.p2.x, this.p2.y) };
    }

    const points = this.curvePoints();
    for (let i = 0; i < points.length - 1; i++) {
      if (mouse.isOnSegment(geometry.line(points[i], points[i + 1]))) {
        const mousePos = mouse.getPosSnappedToGrid();
        return {
          part: 0,
          mousePos0: mousePos,
          mousePos1: mousePos,
          snapContext: {},
        };
      }
    }
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
    const points = this.curvePoints();
    points.forEach((point, i) => {
      if (i === 0) ctx.moveTo(point.x, point.y); else ctx.lineTo(point.x, point.y);
    });
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

    // The controls appear once the surface is selected, or under the pointer,
    // rather than on every interface at once: with several controls per object
    // a busy scene otherwise disappears under its own handles.
    if (isHovered || this.isSelected()) {
      this.drawControls(canvasRenderer, isHovered);
    }
  }

  /**
   * The on-canvas controls, drawn only while the surface is selected or hovered.
   *
   * Subclasses extend this with the controls for their own parameters; the
   * endpoints of the chord belong to every interface.
   *
   * @param {CanvasRenderer} canvasRenderer
   * @param {boolean} isHovered
   */
  drawControls(canvasRenderer, isHovered) {
    for (const end of [this.p1, this.p2]) {
      canvasRenderer.drawPoint(
        end,
        isHovered ? this.scene.highlightColor : this.scene.theme.sourcePoint.color,
        this.scene.theme.sourcePoint.size
      );
    }
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
