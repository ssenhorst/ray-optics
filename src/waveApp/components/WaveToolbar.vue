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
  <div class="wave-toolbar">
    <div class="wave-toolbar-row">
      <!-- File -->
      <div class="wave-group">
        <div class="wave-group-body btn-group">
          <button class="btn btn-sm btn-outline-light" @click="onNew">New</button>
          <button class="btn btn-sm btn-outline-light" @click="onOpen">Open</button>
          <button class="btn btn-sm btn-outline-light" @click="onSave">Save</button>
        </div>
        <div class="wave-group-title">File</div>
      </div>

      <!-- Tools -->
      <div class="wave-group">
        <div class="wave-group-body btn-group">
          <button
            v-for="item in tools"
            :key="item.type"
            class="btn btn-sm"
            :class="tool === item.type ? 'btn-primary' : 'btn-outline-light'"
            :title="item.hint"
            @click="tool = item.type"
          >{{ item.label }}</button>
        </div>
        <div class="wave-group-title">Tools</div>
      </div>

      <!-- View -->
      <div class="wave-group">
        <div class="wave-group-body btn-group">
          <button
            v-for="item in views"
            :key="item.value"
            class="btn btn-sm"
            :class="view === item.value ? 'btn-primary' : 'btn-outline-light'"
            :title="item.hint"
            @click="view = item.value"
          >{{ item.label }}</button>
        </div>
        <div class="wave-group-title">View</div>
      </div>

      <!-- Colormap -->
      <div class="wave-group" v-if="view !== 'amplitudePhase'">
        <div class="wave-group-body">
          <select class="form-select form-select-sm wave-select" v-model="colormap">
            <option v-for="name in colormapOptions" :key="name" :value="name">
              {{ colormapLabel(name) }}
            </option>
          </select>
          <span class="wave-colormap-preview" :style="{ background: colormapGradient }"></span>
        </div>
        <div class="wave-group-title">Colormap</div>
      </div>

      <!-- Amplitude/phase mapping -->
      <div class="wave-group" v-if="view === 'amplitudePhase'">
        <div class="wave-group-body">
          <span class="wave-phase-wheel" :style="{ background: phaseWheel }"
            title="Hue shows the phase: 0 to the right, increasing anticlockwise"></span>
          <label class="wave-field wave-field-slider">
            <span>Chroma</span>
            <input type="range" class="form-range wave-range" min="0" max="0.35" step="0.005"
              v-model.number="phaseChroma">
            <output>{{ phaseChroma.toFixed(3) }}</output>
          </label>
        </div>
        <div class="wave-group-title">
          Hue = phase, lightness = amplitude. Chroma is reduced where sRGB
          cannot hold it, so lightness and hue stay exact
        </div>
      </div>

      <!-- Optics -->
      <div class="wave-group">
        <div class="wave-group-body">
          <label class="wave-field">
            <span>&lambda;</span>
            <input type="number" class="form-control form-control-sm" min="0.1" step="1"
              v-model.number="wavelength">
          </label>
          <label class="wave-field">
            <span>n</span>
            <input type="number" class="form-control form-control-sm" min="0.1" step="0.05"
              v-model.number="refractiveIndex">
          </label>
        </div>
        <div class="wave-group-title">Optics (scene units)</div>
      </div>

      <!-- Sampling -->
      <div class="wave-group">
        <div class="wave-group-body">
          <select class="form-select form-select-sm wave-select" v-model.number="gridResolution">
            <option v-for="value in resolutions" :key="value" :value="value">
              {{ value }}
            </option>
          </select>
          <label class="wave-field wave-field-slider">
            <span>Sources</span>
            <input type="range" class="form-range wave-range" min="1" max="32" step="0.5"
              v-model.number="sourceDensity">
            <output>{{ sourceDensity }}/&lambda;</output>
          </label>
        </div>
        <div class="wave-group-title">
          Field samples across the view, and samples per wavelength on extended
          sources
        </div>
      </div>

      <!-- Animation -->
      <div class="wave-group">
        <div class="wave-group-body">
          <button class="btn btn-sm" :class="isAnimating ? 'btn-primary' : 'btn-outline-light'"
            @click="toggleAnimation" :disabled="!isTimeResolved"
            :title="isTimeResolved ? '' : 'The intensity view is time-averaged, so there is nothing to animate'">
            {{ isAnimating ? 'Pause' : 'Play' }}
          </button>
          <input type="range" class="form-range wave-range" min="0" max="1" step="0.002"
            :value="timeFraction" @input="onScrubTime" :disabled="!isTimeResolved">
        </div>
        <div class="wave-group-title">Time ({{ timeLabel }})</div>
      </div>

      <!-- Layout aids -->
      <div class="wave-group">
        <div class="wave-group-body btn-group">
          <button class="btn btn-sm" :class="showGrid ? 'btn-primary' : 'btn-outline-light'"
            @click="showGrid = !showGrid">Grid</button>
          <button class="btn btn-sm" :class="snapToGrid ? 'btn-primary' : 'btn-outline-light'"
            @click="snapToGrid = !snapToGrid">Snap</button>
        </div>
        <div class="wave-group-title">Layout</div>
      </div>
    </div>

    <!-- Colour scale -->
    <div class="wave-toolbar-row wave-toolbar-row-secondary">
      <div class="wave-group wave-group-wide">
        <div class="wave-group-body">
          <label class="wave-field wave-field-slider">
            <span>Saturate at</span>
            <input type="range" class="form-range wave-range" min="0.02" max="3" step="0.01"
              v-model.number="upperCutoff">
            <output>{{ upperCutoff.toFixed(2) }}&times;</output>
          </label>
          <label class="wave-field wave-field-slider" v-if="view === 'intensity' && !logScale">
            <span>Floor</span>
            <input type="range" class="form-range wave-range" min="0" max="0.9" step="0.005"
              v-model.number="lowerCutoff">
            <output>{{ lowerCutoff.toFixed(3) }}</output>
          </label>
          <label class="wave-field" v-if="view === 'intensity'">
            <input type="checkbox" class="form-check-input" v-model="logScale">
            <span>Log</span>
          </label>
          <label class="wave-field wave-field-slider" v-if="view === 'intensity' && logScale">
            <span>Range</span>
            <input type="range" class="form-range wave-range" min="10" max="120" step="1"
              v-model.number="dynamicRange">
            <output>{{ dynamicRange }} dB</output>
          </label>
          <label class="wave-field">
            <span>Scale percentile</span>
            <input type="number" class="form-control form-control-sm" min="50" max="100" step="0.5"
              v-model.number="scalePercentile">
          </label>
        </div>
        <div class="wave-group-title">
          Colour scale &mdash; the reference amplitude is the given percentile of
          |U| over the grid, so the singularity at a source cannot dominate it
        </div>
      </div>
    </div>

    <input type="file" ref="fileInput" accept=".json" style="display:none" @change="onFileChosen">
  </div>
</template>

<script>
/**
 * @module WaveToolbar
 * @description The toolbar for the wave-optics app: tools, field view, colour
 * scale, optical parameters, grid resolution and the animation transport.
 */
import { computed, ref } from 'vue';
import { app } from '../services/waveApp.js';
import { useWaveStore } from '../store/wave.js';
import {
  listColormapsForView, colormapDisplayName, colormapCssGradient
} from '../../core/waveOptics/colormaps.js';
import { phaseWheelCssGradient } from '../../core/waveOptics/oklch.js';
import { GRID_RESOLUTIONS } from '../../core/waveOptics/conventions.js';

export default {
  name: 'WaveToolbar',
  setup() {
    const store = useWaveStore();
    const fileInput = ref(null);

    const view = store.view;

    /**
     * The colormap for the active view. Each view remembers its own choice, so
     * switching back and forth does not lose it.
     */
    const colormap = computed({
      get: () => (view.value === 'field'
        ? store.fieldColormap.value
        : store.intensityColormap.value),
      set: (value) => {
        if (view.value === 'field') {
          store.fieldColormap.value = value;
        } else {
          store.intensityColormap.value = value;
        }
      },
    });

    const colormapOptions = computed(() => listColormapsForView(view.value));
    const colormapGradient = computed(() => colormapCssGradient(colormap.value));
    const phaseWheel = computed(() => phaseWheelCssGradient(store.phaseChroma.value));

    // The intensity view is time-averaged; the other two show an instant.
    const isTimeResolved = computed(() => view.value !== 'intensity');

    // The field view shows one optical cycle; the scrubber spans exactly that.
    const timeFraction = computed(() => store.state.time - Math.floor(store.state.time));
    const timeLabel = computed(() => `${timeFraction.value.toFixed(2)} cycle`);

    const onScrubTime = (event) => {
      store.setTime(parseFloat(event.target.value));
    };

    return {
      store,
      fileInput,
      tool: store.tool,
      view,
      colormap,
      colormapOptions,
      colormapGradient,
      phaseWheel,
      isTimeResolved,
      phaseChroma: store.phaseChroma,
      wavelength: store.wavelength,
      refractiveIndex: store.refractiveIndex,
      gridResolution: store.gridResolution,
      sourceDensity: store.sourceDensity,
      upperCutoff: store.upperCutoff,
      lowerCutoff: store.lowerCutoff,
      logScale: store.logScale,
      dynamicRange: store.dynamicRange,
      scalePercentile: store.scalePercentile,
      showGrid: store.showGrid,
      snapToGrid: store.snapToGrid,
      isAnimating: computed(() => store.state.isAnimating),
      toggleAnimation: store.toggleAnimation,
      timeFraction,
      timeLabel,
      onScrubTime,
      resolutions: GRID_RESOLUTIONS,
      tools: [
        { type: '', label: 'Move view', hint: 'Drag to pan, scroll to zoom' },
        { type: 'WavePointSource', label: 'Point', hint: 'Click to place a time-harmonic point source' },
        { type: 'WaveLineSource', label: 'Line', hint: 'Drag to draw a line of point sources with A(u) and phi(u)' },
      ],
      views: [
        { value: 'intensity', label: 'Intensity', hint: 'The time-averaged intensity |U|²' },
        { value: 'field', label: 'Field', hint: 'The instantaneous field Re{U e^{-iωt}}' },
        { value: 'amplitudePhase', label: 'Amp+phase', hint: 'Amplitude and phase together, in Oklch' },
      ],
    };
  },
  methods: {
    colormapLabel(name) {
      return colormapDisplayName(name);
    },
    onNew() {
      app.clearScene();
    },
    onOpen() {
      this.fileInput.click();
    },
    onSave() {
      app.saveScene();
    },
    onFileChosen(event) {
      const file = event.target.files?.[0];
      if (file) app.openScene(file);
      event.target.value = '';
    },
  },
};
</script>

<style scoped>
.wave-toolbar {
  flex: 0 0 auto;
  width: 100%;
  background-color: rgba(20, 22, 26, 0.88);
  backdrop-filter: blur(4px);
  color: rgba(255, 255, 255, 0.85);
  border-bottom: 1px solid rgba(255, 255, 255, 0.12);
  font-size: 12px;
}

.wave-toolbar-row {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 14px;
  padding: 6px 12px;
}

.wave-toolbar-row-secondary {
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  padding-top: 4px;
}

.wave-group {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
}

.wave-group-wide {
  flex: 1;
  min-width: 320px;
}

.wave-group-body {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.wave-group-title {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.45);
  max-width: 460px;
  line-height: 1.3;
}

.wave-field {
  display: flex;
  align-items: center;
  gap: 4px;
  margin: 0;
  white-space: nowrap;
}

.wave-field-slider {
  gap: 6px;
}

.wave-field input[type="number"] {
  width: 72px;
}

.wave-field output {
  min-width: 56px;
  color: rgba(255, 255, 255, 0.6);
  font-variant-numeric: tabular-nums;
}

.wave-select {
  width: auto;
  min-width: 120px;
}

.wave-range {
  width: 120px;
  padding-top: 3px;
}

.wave-phase-wheel {
  display: inline-block;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.25);
}

.wave-colormap-preview {
  display: inline-block;
  width: 64px;
  height: 14px;
  border-radius: 2px;
  border: 1px solid rgba(255, 255, 255, 0.25);
}

.btn-sm {
  --bs-btn-padding-y: 0.15rem;
  --bs-btn-padding-x: 0.45rem;
  --bs-btn-font-size: 0.75rem;
}

.form-control-sm,
.form-select-sm {
  font-size: 0.75rem;
  padding: 0.15rem 0.4rem;
}
</style>
