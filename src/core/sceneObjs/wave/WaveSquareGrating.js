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
 * A grating whose transmission is a square wave across the interface.
 *
 * With the default bar transmission of zero this is a Ronchi ruling: opaque
 * bars separated by clear gaps. Giving the bars a transmission of one and a
 * phase shift instead turns it into a binary phase grating, which suppresses
 * the zeroth order at a half-wave shift; the two are the same geometry and are
 * worth being able to compare directly.
 *
 * Tools -> Interfaces -> Square grating
 * @class
 * @extends WaveInterface
 * @memberof sceneObjs
 * @property {number} pitch - The period of the pattern, in scene length units.
 * @property {number} dutyCycle - The fraction of each period occupied by a bar.
 * @property {number} barTransmission - Amplitude transmission through a bar.
 * @property {number} barPhase - Phase shift imposed by a bar, in radians.
 */
class WaveSquareGrating extends WaveInterface {
  static type = 'WaveSquareGrating';
  static isOptical = true;
  static serializableDefaults = {
    ...SHARED_INTERFACE_DEFAULTS,
    refractiveIndexAfter: 1,
    pitch: 40,
    dutyCycle: 0.5,
    barTransmission: 0,
    barPhase: 0
  };

  static getDescription(objData, scene, detailed = false) {
    return i18next.t('main:waveTools.WaveSquareGrating.title');
  }

  static getPropertySchema(objData, scene) {
    return [
      ...WaveInterface.getPropertySchema(objData, scene)
        .filter((entry) => !['eqnAmplitude', 'eqnPhase'].includes(entry.key)),
      { key: 'pitch', type: 'number', label: i18next.t('simulator:waveSceneObjs.common.pitch') },
      { key: 'dutyCycle', type: 'number', label: i18next.t('simulator:waveSceneObjs.common.dutyCycle') },
      { key: 'barTransmission', type: 'number', label: i18next.t('simulator:waveSceneObjs.common.barTransmission') },
      { key: 'barPhase', type: 'number', label: i18next.t('simulator:waveSceneObjs.common.barPhase') },
    ];
  }

  populateObjBar(objBar) {
    objBar.setTitle(i18next.t('main:waveTools.WaveSquareGrating.title'));
    this.populateGeometryObjBar(objBar);
    objBar.createNumber(
      i18next.t('simulator:waveSceneObjs.common.pitch'), 1, 400, 1, this.pitch,
      function (obj, value) { obj.pitch = value; }
    );
    objBar.createNumber(
      i18next.t('simulator:waveSceneObjs.common.dutyCycle'), 0.02, 0.98, 0.01, this.dutyCycle,
      function (obj, value) { obj.dutyCycle = value; },
      '<p>' + i18next.t('simulator:waveSceneObjs.common.dutyCycleInfo') + '</p>'
    );
    if (objBar.showAdvanced(!this.arePropertiesDefault(['barTransmission', 'barPhase']))) {
      objBar.createNumber(
        i18next.t('simulator:waveSceneObjs.common.barTransmission'), 0, 1, 0.01, this.barTransmission,
        function (obj, value) { obj.barTransmission = value; },
        '<p>' + i18next.t('simulator:waveSceneObjs.common.barTransmissionInfo') + '</p>'
      );
      objBar.createNumber(
        i18next.t('simulator:waveSceneObjs.common.barPhase'), -Math.PI, Math.PI, 0.01, this.barPhase,
        function (obj, value) { obj.barPhase = value; }
      );
    }
  }

  transmissionAt(y) {
    const pitch = this.pitch > 0 ? this.pitch : 1;
    // Position within one period, kept positive for negative y.
    const fraction = ((y / pitch) % 1 + 1) % 1;
    const inBar = fraction < this.dutyCycle;
    return inBar
      ? { amplitude: this.barTransmission, phase: this.barPhase }
      : { amplitude: 1, phase: 0 };
  }

  minimumFeatureSize() {
    const pitch = this.pitch > 0 ? this.pitch : 1;
    return pitch * Math.min(this.dutyCycle, 1 - this.dutyCycle);
  }
}

export default WaveSquareGrating;
