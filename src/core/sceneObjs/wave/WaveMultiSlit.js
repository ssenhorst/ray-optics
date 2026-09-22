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

import WaveInterface, { SHARED_INTERFACE_DEFAULTS } from './WaveInterface.js';
import geometry from '../../geometry.js';
import i18next from 'i18next';
import { drawHandle, drawGuide, drawHandleLabel, isOnHandle } from './waveHandles.js';

/** The narrowest slit or closest spacing a drag may set, in scene length units. */
const MIN_SLIT_DIMENSION = 0.5;

/**
 * An opaque screen with a row of identical slits, centred on the interface.
 *
 * One slit gives the single-slit envelope, two give Young's fringes, and more
 * sharpen those fringes towards the grating limit while the envelope stays put.
 * Being able to raise the count with everything else fixed is what makes that
 * relationship visible.
 *
 * Tools -> Interfaces -> N slits
 * @class
 * @extends WaveInterface
 * @memberof sceneObjs
 * @property {number} slitCount - How many slits.
 * @property {number} slitWidth - The width of each slit, in scene length units.
 * @property {number} slitSpacing - Centre-to-centre spacing, in scene length units.
 */
class WaveMultiSlit extends WaveInterface {
  static type = 'WaveMultiSlit';
  static isOptical = true;
  static serializableDefaults = {
    ...SHARED_INTERFACE_DEFAULTS,
    refractiveIndexAfter: 1,
    slitCount: 2,
    slitWidth: 15,
    slitSpacing: 60
  };

  static getDescription(objData, scene, detailed = false) {
    return i18next.t('main:waveTools.WaveMultiSlit.title');
  }

  static getPropertySchema(objData, scene) {
    return [
      ...WaveInterface.getPropertySchema(objData, scene)
        .filter((entry) => !['eqnAmplitude', 'eqnPhase'].includes(entry.key)),
      { key: 'slitCount', type: 'number', label: i18next.t('simulator:waveSceneObjs.common.slitCount') },
      { key: 'slitWidth', type: 'number', label: i18next.t('simulator:waveSceneObjs.common.slitWidth') },
      { key: 'slitSpacing', type: 'number', label: i18next.t('simulator:waveSceneObjs.common.slitSpacing') },
    ];
  }

  populateObjBar(objBar) {
    objBar.setTitle(i18next.t('main:waveTools.WaveMultiSlit.title'));
    this.populateGeometryObjBar(objBar);
    objBar.createNumber(
      i18next.t('simulator:waveSceneObjs.common.slitCount'), 1, 32, 1, this.slitCount,
      function (obj, value) { obj.slitCount = Math.max(1, Math.round(value)); }
    );
    objBar.createNumber(
      i18next.t('simulator:waveSceneObjs.common.slitWidth'), 1, 200, 1, this.slitWidth,
      function (obj, value) { obj.slitWidth = value; }
    );
    // Shown even at one slit, where it does nothing yet: it is the parameter
    // that decides what raising the count will produce, and hiding it is how a
    // spacing narrower than the slit goes unnoticed until the slits merge.
    objBar.createNumber(
      i18next.t('simulator:waveSceneObjs.common.slitSpacing'), 1, 400, 1, this.slitSpacing,
      function (obj, value) { obj.slitSpacing = value; },
      '<p>' + i18next.t('simulator:waveSceneObjs.common.slitSpacingInfo') + '</p>'
    );
    this.populateProfileObjBar(objBar);
  }

  /** The transverse offset of the centre of slit `index`, from the aperture centre. */
  slitCentreOffset(index) {
    const count = Math.max(1, Math.round(this.slitCount));
    return -(count - 1) * this.slitSpacing / 2 + index * this.slitSpacing;
  }

  /**
   * The two on-canvas controls: the edge of the first slit sets its width, and
   * the centre of the next slit sets the spacing.
   * @returns {{width: Point, spacing: Point|null}|null}
   */
  controlPoints() {
    if (!this.isValid()) return null;
    const extent = this.getExtent();
    const centerY = this.centerY();
    const at = (offset) => {
      const y = Math.min(extent.yMax, Math.max(extent.yMin, centerY + offset));
      return { x: this.zAt(y), y };
    };
    const count = Math.max(1, Math.round(this.slitCount));
    const first = this.slitCentreOffset(0);
    return {
      first: at(first),
      width: at(first + this.slitWidth / 2),
      // The spacing control is the centre of the *last* slit, which is the one
      // that always moves when the spacing changes. With an odd count the
      // second slit sits on the axis and would not move at all.
      spacing: count > 1 ? at(this.slitCentreOffset(count - 1)) : null,
      previous: count > 1 ? at(this.slitCentreOffset(count - 2)) : null,
    };
  }

  checkMouseOver(mouse) {
    const controls = this.isSelected() ? this.controlPoints() : null;
    if (controls) {
      if (isOnHandle(mouse, controls.width)) {
        return { part: 3, targetPoint: geometry.point(controls.width.x, controls.width.y) };
      }
      if (controls.spacing && isOnHandle(mouse, controls.spacing)) {
        return { part: 4, targetPoint: geometry.point(controls.spacing.x, controls.spacing.y) };
      }
    }
    return super.checkMouseOver(mouse);
  }

  onDrag(mouse, dragContext, ctrl, shift) {
    const offset = mouse.pos.y - this.centerY();
    if (dragContext.part === 3) {
      // The handle is the edge of the first slit, so its distance from that
      // slit's centre is half the width.
      this.slitWidth = Math.max(
        MIN_SLIT_DIMENSION, 2 * Math.abs(offset - this.slitCentreOffset(0))
      );
      return;
    }
    if (dragContext.part === 4) {
      // The row stays centred on the aperture, so the last slit sits half the
      // row width out and the spacing follows from where it is dragged to.
      const count = Math.max(2, Math.round(this.slitCount));
      this.slitSpacing = Math.max(MIN_SLIT_DIMENSION, 2 * Math.abs(offset) / (count - 1));
      return;
    }
    super.onDrag(mouse, dragContext, ctrl, shift);
  }

  drawControls(canvasRenderer, isHovered) {
    super.drawControls(canvasRenderer, isHovered);
    const controls = this.isSelected() ? this.controlPoints() : null;
    if (!controls) return;

    drawGuide(canvasRenderer, controls.first, controls.width);
    drawHandle(canvasRenderer, controls.width);
    drawHandleLabel(canvasRenderer, 'w', controls.width);
    if (controls.spacing) {
      drawGuide(canvasRenderer, controls.previous, controls.spacing);
      drawHandle(canvasRenderer, controls.spacing);
      drawHandleLabel(canvasRenderer, 's', controls.spacing);
    }
  }

  transmissionAt(y) {
    const count = Math.max(1, Math.round(this.slitCount));
    const halfWidth = this.slitWidth / 2;
    // Slits are laid out symmetrically about the centre, so an odd count puts
    // one on the axis and an even count straddles it.
    const firstCentre = -(count - 1) * this.slitSpacing / 2;
    for (let i = 0; i < count; i++) {
      if (Math.abs(y - (firstCentre + i * this.slitSpacing)) < halfWidth) {
        return { amplitude: 1, phase: 0 };
      }
    }
    return { amplitude: 0, phase: 0 };
  }

  /** Whether neighbouring slits touch, so the row is really one wide opening. */
  slitsMerge() {
    return Math.round(this.slitCount) > 1 && this.slitSpacing <= this.slitWidth;
  }

  minimumFeatureSize() {
    const count = Math.max(1, Math.round(this.slitCount));
    const width = Math.max(1e-6, this.slitWidth);
    if (count === 1) return width;

    // Slits spaced no further apart than they are wide overlap into a single
    // opening, so the finest feature is that merged opening. Subtracting the
    // width from the spacing here instead gave a gap of zero or less, which
    // asked for a step of essentially nothing: the sample count ran away into
    // the billions and the tab stopped responding. It is reachable by raising
    // the slit count on a single wide slit, where the spacing is not on screen.
    if (this.slitsMerge()) {
      return (count - 1) * Math.max(0, this.slitSpacing) + width;
    }
    // Otherwise the opaque strip between neighbours can be finer than a slit.
    return Math.min(width, this.slitSpacing - width);
  }

  getWarning() {
    if (this.slitsMerge()) {
      return i18next.t('simulator:waveSceneObjs.common.slitsMergeWarning');
    }
    return super.getWarning();
  }
}

export default WaveMultiSlit;
