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

import WaveInterface, { SHARED_INTERFACE_DEFAULTS } from './WaveInterface.js';
import i18next from 'i18next';

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
    if (this.slitCount > 1) {
      objBar.createNumber(
        i18next.t('simulator:waveSceneObjs.common.slitSpacing'), 1, 400, 1, this.slitSpacing,
        function (obj, value) { obj.slitSpacing = value; },
        '<p>' + i18next.t('simulator:waveSceneObjs.common.slitSpacingInfo') + '</p>'
      );
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

  minimumFeatureSize() {
    const count = Math.max(1, Math.round(this.slitCount));
    if (count === 1) return this.slitWidth;
    // The opaque strip between neighbours can be finer than a slit.
    return Math.max(1e-6, Math.min(this.slitWidth, this.slitSpacing - this.slitWidth));
  }
}

export default WaveMultiSlit;
