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
import {
  equationInfo
} from './waveEquationInfo.js';

/** Positions scanned when measuring how fine the mask's features are. */
const FEATURE_SCAN_SAMPLES = 2048;

/**
 * An opaque screen whose openings are wherever a function is non-negative.
 *
 * Writing a hard-edged pattern as an amplitude equation means spelling out a
 * window function with `sign` and `abs` every time. Taking the sign of an
 * ordinary expression instead makes arbitrary binary patterns easy to state:
 * `cos(2 pi y / 40)` is a Ronchi ruling, `cos(y^2 / 300)` is a zone plate, and
 * `abs(y) - 50` is a pair of half-planes.
 *
 * The feature size is measured from the pattern rather than assumed, so a mask
 * finer than the sampling raises the undersampling warning instead of quietly
 * diffracting into the wrong orders.
 *
 * Tools -> Interfaces -> Binary mask
 * @class
 * @extends WaveInterface
 * @memberof sceneObjs
 * @property {string} eqnMask - The pattern function of `y`, in LaTeX. Open where it is non-negative.
 */
class WaveBinaryMask extends WaveInterface {
  static type = 'WaveBinaryMask';
  static isOptical = true;
  static serializableDefaults = {
    ...SHARED_INTERFACE_DEFAULTS,
    refractiveIndexAfter: 1,
    eqnMask: '\\cos(0.15\\cdot y)'
  };

  static getDescription(objData, scene, detailed = false) {
    return i18next.t('main:waveTools.WaveBinaryMask.title');
  }

  /** Popover content for the mask equation. */
  static maskHelp(scene) {
    return equationInfo({
      role: i18next.t('simulator:waveSceneObjs.common.maskInfo'),
      variable: i18next.t('simulator:waveSceneObjs.common.yInfo'),
      examples: [
        {
          expression: 'cos(0.15*y)',
          meaning: i18next.t('simulator:waveSceneObjs.eqnInfo.maskRuling'),
        },
        {
          expression: '50-abs(y)',
          meaning: i18next.t('simulator:waveSceneObjs.eqnInfo.maskSlit', { half: 50 }),
        },
        {
          expression: 'cos(y^2/300)',
          meaning: i18next.t('simulator:waveSceneObjs.eqnInfo.maskZonePlate'),
        },
      ],
    });
  }

  static getPropertySchema(objData, scene) {
    return [
      ...WaveInterface.getPropertySchema(objData, scene)
        .filter((entry) => !['eqnAmplitude', 'eqnPhase'].includes(entry.key)),
      {
        key: 'eqnMask', type: 'equation', label: 'f(y)', variables: ['y'],
        info: WaveBinaryMask.maskHelp(scene),
      },
    ];
  }

  populateObjBar(objBar) {
    objBar.setTitle(i18next.t('main:waveTools.WaveBinaryMask.title'));
    this.populateGeometryObjBar(objBar);
    objBar.createEquation('f(y)', this.eqnMask, function (obj, value) {
      obj.eqnMask = value;
    }, WaveBinaryMask.maskHelp(this.scene));
  }

  transmissionAt(y) {
    return {
      amplitude: this.compiled('eqnMask')({ y }) < 0 ? 0 : 1,
      phase: 0,
    };
  }

  /**
   * The narrowest opaque or clear run in the pattern, found by scanning it.
   *
   * There is no way to read this off an arbitrary expression, and getting it
   * wrong is not a small error: a mask sampled too coarsely is reproduced as a
   * different, coarser pattern, which diffracts convincingly into entirely the
   * wrong orders.
   *
   * @returns {number|null}
   */
  minimumFeatureSize() {
    const extent = this.getExtent();
    if (!extent) return null;

    let mask;
    try {
      mask = this.compiled('eqnMask');
    } catch (e) {
      return null;
    }

    const span = extent.yMax - extent.yMin;
    const step = span / FEATURE_SCAN_SAMPLES;
    const centerY = this.centerY();

    let shortest = Infinity;
    let runStart = null;
    let previous = null;
    for (let i = 0; i <= FEATURE_SCAN_SAMPLES; i++) {
      const y = extent.yMin + i * step;
      let open;
      try {
        open = mask({ y: y - centerY }) >= 0;
      } catch (e) {
        return null;
      }
      if (previous === null) {
        previous = open;
        continue;
      }
      if (open !== previous) {
        // Only runs bounded by a change at both ends are features of the
        // pattern. The first and last are cut short by the aperture, and
        // counting them would force needless oversampling of a coarse mask
        // that merely happens to start mid-bar.
        if (runStart !== null) {
          const runLength = (i - runStart) * step;
          if (runLength < shortest) shortest = runLength;
        }
        runStart = i;
        previous = open;
      }
    }

    // A pattern that never changes over the aperture has no feature to resolve.
    return Number.isFinite(shortest) ? shortest : null;
  }
}

export default WaveBinaryMask;
