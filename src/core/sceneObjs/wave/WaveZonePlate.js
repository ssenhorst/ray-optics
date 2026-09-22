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
import { drawFocalMarks, focalHandleAt } from './waveHandles.js';

/** The shortest focal length a drag may set, in scene length units. */
const MIN_FOCAL_LENGTH = 20;

/**
 * A Fresnel zone plate: zones that alternate every half wave of extra path to
 * the focus, so that what would have cancelled instead adds.
 *
 * Zone `n` ends where the path from the focus is `n` half-wavelengths longer
 * than on axis, which in the paraxial limit puts the boundaries at
 * `y = sqrt(n lambda f)`. The blocking form removes the cancelling zones; the
 * phase-reversal form inverts them instead, which wastes none of the light and
 * is four times as efficient.
 *
 * The zone spacing is derived from the scene's wavelength, so the focal length
 * control means what it says. A physical plate has fixed zones and a focal
 * length that varies with wavelength; that distinction only becomes observable
 * once more than one wavelength is in play.
 *
 * Tools -> Interfaces -> Fresnel zone plate
 * @class
 * @extends WaveInterface
 * @memberof sceneObjs
 * @property {number} focalLength - The focal length at the scene's wavelength.
 * @property {boolean} phaseReversing - Invert the alternate zones instead of blocking them.
 */
class WaveZonePlate extends WaveInterface {
  static type = 'WaveZonePlate';
  static isOptical = true;
  static serializableDefaults = {
    ...SHARED_INTERFACE_DEFAULTS,
    refractiveIndexAfter: 1,
    focalLength: 400,
    phaseReversing: false
  };

  static getDescription(objData, scene, detailed = false) {
    return i18next.t('main:waveTools.WaveZonePlate.title');
  }

  static getPropertySchema(objData, scene) {
    return [
      ...WaveInterface.getPropertySchema(objData, scene)
        .filter((entry) => !['eqnAmplitude', 'eqnPhase'].includes(entry.key)),
      { key: 'focalLength', type: 'number', label: i18next.t('simulator:waveSceneObjs.common.focalLength') },
      { key: 'phaseReversing', type: 'boolean', label: i18next.t('simulator:waveSceneObjs.common.phaseReversing') },
    ];
  }

  populateObjBar(objBar) {
    objBar.setTitle(i18next.t('main:waveTools.WaveZonePlate.title'));
    this.populateGeometryObjBar(objBar);
    objBar.createNumber(
      i18next.t('simulator:waveSceneObjs.common.focalLength'), 20, 4000, 10, this.focalLength,
      function (obj, value) { obj.focalLength = value; },
      '<p>' + i18next.t('simulator:waveSceneObjs.common.focalLengthInfo') + '</p>'
    );
    objBar.createBoolean(
      i18next.t('simulator:waveSceneObjs.common.phaseReversing'), this.phaseReversing,
      function (obj, value) { obj.phaseReversing = value; },
      '<p>' + i18next.t('simulator:waveSceneObjs.common.phaseReversingInfo') + '</p>'
    );
    this.populateProfileObjBar(objBar);
  }

  /** The point the zones are constructed around: the centre of the aperture. */
  focalCenter() {
    const y = this.centerY();
    return { x: this.zAt(y), y };
  }

  checkMouseOver(mouse) {
    if (this.isValid() && this.isSelected()) {
      const focal = focalHandleAt(mouse, this.focalCenter(), this.focalLength);
      if (focal) {
        return {
          part: 3,
          targetPoint: geometry.point(focal.point.x, focal.point.y),
          focalSign: focal.sign,
        };
      }
    }
    return super.checkMouseOver(mouse);
  }

  onDrag(mouse, dragContext, ctrl, shift) {
    if (dragContext.part === 3) {
      // The zones are laid out for whatever focal length the mark is dragged
      // to, so the pattern visibly coarsens as the focus is pushed away.
      const signed = (mouse.pos.x - this.focalCenter().x) * dragContext.focalSign;
      this.focalLength = Math.max(MIN_FOCAL_LENGTH, signed);
      return;
    }
    super.onDrag(mouse, dragContext, ctrl, shift);
  }

  drawControls(canvasRenderer, isHovered) {
    super.drawControls(canvasRenderer, isHovered);
    if (this.isSelected()) {
      drawFocalMarks(canvasRenderer, this.focalCenter(), this.focalLength);
    }
  }

  /** The wavelength the zone spacing is derived from. */
  designWavelength() {
    const wavelength = this.scene?.waveOptics?.wavelength;
    return wavelength > 0 ? wavelength : 20;
  }

  transmissionAt(y) {
    const focal = this.focalLength > 0 ? this.focalLength : 1;
    // The zone index: how many half-waves of extra path this position adds.
    const zone = Math.floor(y * y / (this.designWavelength() * focal));
    const contributing = zone % 2 === 0;

    if (this.phaseReversing) {
      return { amplitude: 1, phase: contributing ? 0 : Math.PI };
    }
    return { amplitude: contributing ? 1 : 0, phase: 0 };
  }

  minimumFeatureSize() {
    // Zones narrow towards the edge, so the outermost one sets the sampling.
    const extent = this.getExtent();
    if (!extent) return null;
    const halfHeight = Math.max(
      Math.abs(extent.yMax - this.centerY()),
      Math.abs(extent.yMin - this.centerY())
    );
    if (!(halfHeight > 0)) return null;
    const focal = this.focalLength > 0 ? this.focalLength : 1;
    // d(y^2 / (lambda f)) = 1 gives the width of the zone at y.
    return Math.max(1e-6, this.designWavelength() * focal / (2 * halfHeight));
  }
}

export default WaveZonePlate;
