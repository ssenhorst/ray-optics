<!--
  Copyright 2026 The Ray Optics Simulation authors and contributors

  Licensed under the Apache License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License.
  You may obtain a copy of the License at

      http://www.apache.org/licenses/LICENSE-2.0

  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  See the License for the specific language governing permissions and
  limitations under the License.
-->

<template>
  <div class="wave-status">
    <div v-if="fatalError" class="wave-status-error">{{ fatalError }}</div>
    <div v-else-if="status.error" class="wave-status-error">{{ status.error }}</div>

    <div v-if="status.isAliasing" class="wave-status-warning">
      Aliased: only {{ status.pixelsPerWavelength.toFixed(1) }} samples per wavelength.
      Below 2 the picture is not a faithful rendering of the field &mdash; raise
      the field samples or the wavelength.
    </div>
    <div v-else-if="status.isCoarse" class="wave-status-note">
      Coarse: {{ status.pixelsPerWavelength.toFixed(1) }} samples per wavelength.
      This view wants {{ status.comfortablePixels }} or more &mdash; raise the
      field samples or the wavelength.
    </div>

    <div v-if="status.isSourceUndersampled" class="wave-status-warning">
      Sources undersampled: {{ status.samplesPerWavelength.toFixed(1) }} samples
      per wavelength. Below 2 a line source behaves like a grating and radiates
      spurious orders that look like real diffraction.
    </div>
    <div v-else-if="status.isSourceCoarse" class="wave-status-note">
      Source sampling is marginal at
      {{ status.samplesPerWavelength.toFixed(1) }} samples per wavelength; 4 or
      more is safe.
    </div>

    <div v-if="status.isDensityReduced" class="wave-status-warning">
      The source budget was reached, so the sampling density was lowered for
      every source to {{ status.samplesPerWavelength.toFixed(1) }} per
      wavelength. Shorten the sources or lower the density to control this.
    </div>

    <div v-if="status.warnings.includes('interfacesOverlap')" class="wave-status-warning">
      Interfaces overlap along the optical axis, so their order &mdash; and the
      subspace each point belongs to &mdash; is ambiguous. Separate them, or
      reduce the sag, to get a meaningful result.
    </div>

    <div v-if="status.urlWarning === 'tooLarge'" class="wave-status-warning">
      This scene is too large to fit in a link. The URL has been left as it was;
      save the scene as a file instead.
    </div>
    <div v-else-if="status.urlWarning === 'failed'" class="wave-status-warning">
      The scene could not be compressed into a link.
    </div>

    <div v-if="status.isPhaseUnreliable" class="wave-status-warning">
      The viewport spans more than ~10⁴ wavelengths, so float32 can no longer
      carry the phase accurately.
    </div>

    <div class="wave-status-line">
      <span>{{ status.sourceCount }} source{{ status.sourceCount === 1 ? '' : 's' }}</span>
      <span v-if="status.interfaceCount">
        {{ status.interfaceCount }} interface{{ status.interfaceCount === 1 ? '' : 's' }}
      </span>
      <span>{{ status.gridWidth }}&times;{{ status.gridHeight }} grid</span>
      <span>{{ status.pixelsPerWavelength.toFixed(1) }} px/&lambda;</span>
      <span>{{ status.samplesPerWavelength.toFixed(1) }} samples/&lambda;</span>
      <span>{{ status.computeMs.toFixed(1) }} ms</span>
      <span v-if="status.mousePos">
        ({{ status.mousePos.x.toFixed(0) }}, {{ status.mousePos.y.toFixed(0) }})
      </span>
    </div>
  </div>
</template>

<script>
/**
 * @module WaveStatusArea
 * @description Live readouts for the wave simulation.
 *
 * The sampling warnings are the point of this panel: an undersampled field
 * still renders as a plausible-looking picture, so the only way to tell is to
 * be told.
 */
import { computed } from 'vue';
import { app } from '../services/waveApp.js';
import { useWaveStore } from '../store/wave.js';

export default {
  name: 'WaveStatusArea',
  setup() {
    const store = useWaveStore();
    return {
      status: computed(() => store.state.status),
      fatalError: computed(() => app.fatalError),
    };
  },
};
</script>

<style scoped>
.wave-status {
  position: absolute;
  left: 12px;
  bottom: 12px;
  z-index: 8;
  max-width: 420px;
  padding: 6px 10px;
  border-radius: 4px;
  background-color: rgba(20, 22, 26, 0.8);
  backdrop-filter: blur(4px);
  color: rgba(255, 255, 255, 0.7);
  font-size: 11px;
  line-height: 1.5;
  pointer-events: none;
}

.wave-status-line {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  font-variant-numeric: tabular-nums;
}

.wave-status-error {
  color: #ff8b8b;
  margin-bottom: 4px;
}

.wave-status-warning {
  color: #ffd27f;
  margin-bottom: 4px;
}

.wave-status-note {
  color: rgba(255, 255, 255, 0.55);
  margin-bottom: 4px;
}
</style>
