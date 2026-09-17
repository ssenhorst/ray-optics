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
import geometry from '../../geometry.js';
import i18next from 'i18next';
import {
  fieldGrid, peakInSubspace, subspaceAt, fieldSerial, drawLabel, formatLength,
  MEASURE_COLOR
} from './waveMeasurement.js';

/**
 * Below this many samples across, the reported width is a measurement of the
 * grid rather than of the optics, and is reported as a limit instead.
 */
const MIN_RESOLVED_SAMPLES = 3;

/**
 * Finds the brightest point of the subspace it is dropped into, and how wide
 * that maximum is across.
 *
 * "Where does this focus, and how tight is it" is the question most of these
 * scenes are built to answer, and reading it off a colour scale by eye is both
 * tedious and imprecise — the eye finds the middle of a saturated blob, not the
 * maximum. The probe searches the computed samples instead.
 *
 * It is confined to one subspace, chosen by where it is dropped, because the
 * interesting maximum is almost never the global one: the brightest point of a
 * scene is wherever the light started. Placing the probe after the last surface
 * asks about the image rather than about the source.
 *
 * The width is the full width at half maximum of the intensity across the
 * transverse direction, the usual way a focal spot is quoted. It is measured
 * from the same samples that are drawn, so it is only as fine as they are; when
 * the spot is narrower than a few of them, that is what is reported.
 *
 * Tools -> Measure -> Focus probe
 * @class
 * @extends BaseSceneObj
 * @memberof sceneObjs
 * @property {number} x - Where the probe sits; it measures the subspace containing this point.
 * @property {number} y - As above.
 * @property {string} units - 'wavelengths' or 'scene'.
 */
class WaveFocusProbe extends BaseSceneObj {
  static type = 'WaveFocusProbe';
  static isOptical = false;
  static serializableDefaults = {
    x: null,
    y: null,
    units: 'wavelengths'
  };

  static getDescription(objData, scene, detailed = false) {
    return i18next.t('main:waveTools.WaveFocusProbe.title');
  }

  static getPropertySchema(objData, scene) {
    return [
      { key: '', type: 'point', label: i18next.t('simulator:waveSceneObjs.common.probePoint') },
      {
        key: 'units', type: 'dropdown',
        label: i18next.t('simulator:waveSceneObjs.common.units'),
        options: {
          wavelengths: i18next.t('simulator:waveSceneObjs.common.unitsWavelengths'),
          scene: i18next.t('simulator:waveSceneObjs.common.unitsScene'),
        },
      },
    ];
  }

  populateObjBar(objBar) {
    objBar.setTitle(i18next.t('main:waveTools.WaveFocusProbe.title'));
    objBar.createDropdown(
      i18next.t('simulator:waveSceneObjs.common.units'), this.units, {
        wavelengths: i18next.t('simulator:waveSceneObjs.common.unitsWavelengths'),
        scene: i18next.t('simulator:waveSceneObjs.common.unitsScene'),
      },
      function (obj, value) { obj.units = value; },
      '<p>' + i18next.t('simulator:waveSceneObjs.common.probeInfo') + '</p>',
      true
    );
  }

  /** This object searches the computed samples, so they have to be read back. */
  readsField() {
    return true;
  }

  /**
   * The measurement, recomputed only when the field has actually changed.
   * @returns {Object|null}
   */
  measure() {
    const serial = fieldSerial(this.scene);
    if (this._cache?.serial === serial &&
      this._cache.x === this.x && this._cache.y === this.y) {
      return this._cache.result;
    }

    const field = fieldGrid(this.scene);
    const result = field
      ? peakInSubspace(field, subspaceAt(this.scene, this.x, this.y))
      : null;
    this._cache = { serial, x: this.x, y: this.y, result };
    return result;
  }

  draw(canvasRenderer, isAboveLight, isHovered) {
    if (!isAboveLight) return;
    const ctx = canvasRenderer.ctx;
    const ls = canvasRenderer.lengthScale;
    const color = isHovered ? this.scene.highlightColorCss : MEASURE_COLOR;

    // The probe itself: a small ring where it was dropped, which is only a
    // choice of subspace and has no other meaning.
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5 * ls;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(this.x, this.y, 5 * ls, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    const result = this.measure();
    if (!result) {
      drawLabel(
        canvasRenderer, i18next.t('simulator:waveSceneObjs.common.probeNoField'),
        { x: this.x + 10 * ls, y: this.y - 6 * ls }, { color }
      );
      return;
    }

    // A line from the probe to what it found, so it is obvious which mark
    // belongs to which probe when there are several.
    ctx.save();
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 1 * ls;
    ctx.setLineDash([3 * ls, 3 * ls]);
    ctx.beginPath();
    ctx.moveTo(this.x, this.y);
    ctx.lineTo(result.x, result.y);
    ctx.stroke();
    ctx.restore();

    this.drawPeakMark(canvasRenderer, result, color);

    const wavelength = this.scene?.waveOptics?.wavelength || 20;
    const lines = [
      i18next.t('simulator:waveSceneObjs.common.probeAt', {
        x: result.x.toFixed(1), y: result.y.toFixed(1),
      }),
      this.widthText(result, wavelength),
    ];
    drawLabel(canvasRenderer, lines, { x: result.x + 12 * ls, y: result.y + 10 * ls }, { color });
  }

  /** The crosshair on the maximum, with its half-maximum width drawn to scale. */
  drawPeakMark(canvasRenderer, result, color) {
    const ctx = canvasRenderer.ctx;
    const ls = canvasRenderer.lengthScale;
    const arm = 7 * ls;

    ctx.save();
    ctx.setLineDash([]);
    ctx.lineWidth = 3 * ls;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
    for (const pass of [0, 1]) {
      ctx.beginPath();
      ctx.moveTo(result.x - arm, result.y);
      ctx.lineTo(result.x + arm, result.y);
      ctx.moveTo(result.x, result.y - arm);
      ctx.lineTo(result.x, result.y + arm);
      if (result.width > 0) {
        // The width is drawn where it was measured: a bar across the spot,
        // capped, so the number and the picture cannot disagree.
        const half = result.width / 2;
        ctx.moveTo(result.x, result.y - half);
        ctx.lineTo(result.x, result.y + half);
        ctx.moveTo(result.x - arm * 0.7, result.y - half);
        ctx.lineTo(result.x + arm * 0.7, result.y - half);
        ctx.moveTo(result.x - arm * 0.7, result.y + half);
        ctx.lineTo(result.x + arm * 0.7, result.y + half);
      }
      ctx.stroke();
      ctx.lineWidth = 1.5 * ls;
      ctx.strokeStyle = color;
    }
    ctx.restore();
  }

  /** @returns {string} The width line of the label. */
  widthText(result, wavelength) {
    if (result.width === null) {
      return i18next.t('simulator:waveSceneObjs.common.probeWidthUnbounded');
    }
    const formatted = formatLength(result.width, this.units, wavelength);
    if (result.samplesAcross < MIN_RESOLVED_SAMPLES) {
      // Reporting a number here would be reporting the grid spacing.
      return i18next.t('simulator:waveSceneObjs.common.probeWidthUnresolved', {
        width: formatted,
      });
    }
    return i18next.t('simulator:waveSceneObjs.common.probeWidth', { width: formatted });
  }

  move(diffX, diffY) {
    this.x += diffX;
    this.y += diffY;
    return true;
  }

  rotate(angle, center = null) {
    center = center || this.getDefaultCenter();
    const dx = this.x - center.x;
    const dy = this.y - center.y;
    this.x = center.x + dx * Math.cos(angle) - dy * Math.sin(angle);
    this.y = center.y + dx * Math.sin(angle) + dy * Math.cos(angle);
    return true;
  }

  scale(scale, center = null) {
    center = center || this.getDefaultCenter();
    this.x = center.x + (this.x - center.x) * scale;
    this.y = center.y + (this.y - center.y) * scale;
    return true;
  }

  getDefaultCenter() {
    return { x: this.x, y: this.y };
  }

  onConstructMouseDown(mouse) {
    const mousePos = mouse.getPosSnappedToGrid();
    this.x = mousePos.x;
    this.y = mousePos.y;
  }

  onConstructMouseUp() {
    return { isDone: true };
  }

  checkMouseOver(mouse) {
    if (mouse.isOnPoint(this)) {
      return { part: 0, targetPoint: geometry.point(this.x, this.y), snapContext: {} };
    }
  }

  onDrag(mouse) {
    const mousePos = mouse.getPosSnappedToGrid();
    this.x = mousePos.x;
    this.y = mousePos.y;
  }

  /** Measurements take no part in ray tracing. */
  checkRayIntersects(ray) {
    return null;
  }
}

export default WaveFocusProbe;
