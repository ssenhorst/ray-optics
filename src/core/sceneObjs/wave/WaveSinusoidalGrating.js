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
 * A grating that imposes a sinusoidal phase across the interface.
 *
 * Unlike a square grating, a sinusoidal one has a single spatial frequency, so
 * its orders follow the Bessel series: the amplitude of order m is `J_m` of
 * half the peak-to-peak shift. At a shift of about 2.4 radians the zeroth order
 * vanishes entirely, which is the cleanest demonstration of why phase gratings
 * are used in place of absorbing ones.
 *
 * Tools -> Interfaces -> Sinusoidal phase grating
 * @class
 * @extends WaveInterface
 * @memberof sceneObjs
 * @property {number} pitch - The period of the pattern, in scene length units.
 * @property {number} maxPhaseShift - The peak-to-peak phase excursion, in radians.
 */
class WaveSinusoidalGrating extends WaveInterface {
  static type = 'WaveSinusoidalGrating';
  static isOptical = true;
  static serializableDefaults = {
    ...SHARED_INTERFACE_DEFAULTS,
    refractiveIndexAfter: 1,
    pitch: 40,
    maxPhaseShift: Math.PI
  };

  static getDescription(objData, scene, detailed = false) {
    return i18next.t('main:waveTools.WaveSinusoidalGrating.title');
  }

  static getPropertySchema(objData, scene) {
    return [
      ...WaveInterface.getPropertySchema(objData, scene)
        .filter((entry) => !['eqnAmplitude', 'eqnPhase'].includes(entry.key)),
      { key: 'pitch', type: 'number', label: i18next.t('simulator:waveSceneObjs.common.pitch') },
      { key: 'maxPhaseShift', type: 'number', label: i18next.t('simulator:waveSceneObjs.common.maxPhaseShift') },
    ];
  }

  populateObjBar(objBar) {
    objBar.setTitle(i18next.t('main:waveTools.WaveSinusoidalGrating.title'));
    this.populateGeometryObjBar(objBar);
    objBar.createNumber(
      i18next.t('simulator:waveSceneObjs.common.pitch'), 1, 400, 1, this.pitch,
      function (obj, value) { obj.pitch = value; }
    );
    objBar.createNumber(
      i18next.t('simulator:waveSceneObjs.common.maxPhaseShift'), 0, 4 * Math.PI, 0.05, this.maxPhaseShift,
      function (obj, value) { obj.maxPhaseShift = value; },
      '<p>' + i18next.t('simulator:waveSceneObjs.common.maxPhaseShiftInfo') + '</p>'
    );
  }

  transmissionAt(y) {
    const pitch = this.pitch > 0 ? this.pitch : 1;
    return {
      amplitude: 1,
      // Half the peak-to-peak excursion either side of zero.
      phase: 0.5 * this.maxPhaseShift * Math.sin(2 * Math.PI * y / pitch),
    };
  }

  minimumFeatureSize() {
    return this.pitch > 0 ? this.pitch : 1;
  }
}

export default WaveSinusoidalGrating;
