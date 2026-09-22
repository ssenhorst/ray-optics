<!--
  Copyright 2026 The Wave Optics Simulation authors and contributors

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
  <div class="wave-sidebar" :class="{ 'wave-sidebar-open': open }">
    <button
      class="wave-sidebar-tab"
      :title="open ? 'Hide scene settings' : 'Show scene settings'"
      @click="$emit('toggle')"
    >
      <span>{{ open ? '›' : '‹' }}</span>
      <span class="wave-sidebar-tab-label">Scene</span>
    </button>

    <div class="wave-sidebar-body" v-show="open">
      <!-- Optics -->
      <section>
        <h2>Optics</h2>
        <label class="wave-row">
          <span>Wavelength &lambda;</span>
          <input type="number" class="form-control form-control-sm" min="0.1" step="1"
            v-model.number="wavelength">
          <WaveHelp label="About the wavelength">
            In scene length units, not nanometres: here the wavelength is a
            geometric quantity and has to live on the same ruler as the canvas.
            The grid spacing and every sampling warning are measured against it.
          </WaveHelp>
        </label>
        <label class="wave-row">
          <span>Background n</span>
          <input type="number" class="form-control form-control-sm" min="0.1" step="0.05"
            v-model.number="refractiveIndex">
          <WaveHelp label="About the background index">
            The index of the space the sources sit in. Each interface sets the
            index of the space after it, so this one is only the start of the
            stack.
          </WaveHelp>
        </label>
        <label class="wave-row wave-row-check">
          <input type="checkbox" class="form-check-input" v-model="reversed">
          <span>Right-to-left</span>
          <WaveHelp label="About the propagation direction">
            Reverses the optical axis. Surfaces then order right to left, each
            one transmits into the space on its left, and a plane wave at zero
            degrees points that way — angles are measured from the axis, not
            from the canvas, so nothing in an existing scene needs rewriting.
          </WaveHelp>
        </label>
      </section>

      <!-- Sampling -->
      <section>
        <h2>Sampling</h2>
        <label class="wave-row">
          <span>Field samples</span>
          <select class="form-select form-select-sm" v-model="resolutionChoice">
            <option value="auto">Auto</option>
            <option v-for="value in resolutions" :key="value" :value="String(value)">
              {{ value }}
            </option>
          </select>
          <WaveHelp label="About the field resolution">
            Samples across the longer side of the view. Auto climbs as far as
            this machine keeps up with, measuring the real cost of the scene on
            the way, and drops back while you drag so the picture stays
            responsive.
          </WaveHelp>
        </label>
        <label class="wave-row">
          <span>Source density</span>
          <input type="range" class="form-range wave-range" min="1" max="32" step="0.5"
            v-model.number="sourceDensity">
          <output>{{ sourceDensity }}/&lambda;</output>
          <WaveHelp label="About the source density">
            Samples per wavelength along extended sources and across interfaces.
            This is an accuracy control, not a physical one: the arc length each
            sample stands for is divided out, so raising it refines the answer
            rather than adding light. Below about four samples per wavelength a
            sampled surface starts behaving like a grating of its own.
          </WaveHelp>
        </label>
      </section>

      <!-- Colour scale -->
      <section>
        <h2>Colour scale</h2>
        <label class="wave-row">
          <span>Saturate at</span>
          <input type="range" class="form-range wave-range" min="0.02" max="3" step="0.01"
            v-model.number="upperCutoff">
          <output>{{ upperCutoff.toFixed(2) }}&times;</output>
          <WaveHelp label="About the colour scale">
            The reference amplitude is the given percentile of |U| over the grid,
            so the singularity at a point source cannot set the scale for the
            whole picture. This multiplies it: a smaller number saturates
            sooner, which is how faint structure away from a focus is brought
            out.
          </WaveHelp>
        </label>
        <label class="wave-row" v-if="view === 'intensity' && !logScale">
          <span>Floor</span>
          <input type="range" class="form-range wave-range" min="0" max="0.9" step="0.005"
            v-model.number="lowerCutoff">
          <output>{{ lowerCutoff.toFixed(3) }}</output>
        </label>
        <label class="wave-row wave-row-check" v-if="view === 'intensity'">
          <input type="checkbox" class="form-check-input" v-model="logScale">
          <span>Logarithmic</span>
          <WaveHelp label="About the log scale">
            Intensity spans many orders of magnitude between a focus and the
            structure around it. A log scale shows the whole range at once, at
            the cost of making everything look brighter than it is.
          </WaveHelp>
        </label>
        <label class="wave-row" v-if="view === 'intensity' && logScale">
          <span>Range</span>
          <input type="range" class="form-range wave-range" min="10" max="120" step="1"
            v-model.number="dynamicRange">
          <output>{{ dynamicRange }} dB</output>
        </label>
        <label class="wave-row">
          <span>Percentile</span>
          <input type="number" class="form-control form-control-sm" min="50" max="100" step="0.5"
            v-model.number="scalePercentile">
        </label>
        <label class="wave-row" v-if="view !== 'amplitudePhase'">
          <span>Colormap</span>
          <select class="form-select form-select-sm" v-model="colormap">
            <option v-for="name in colormapOptions" :key="name" :value="name">
              {{ colormapLabel(name) }}
            </option>
          </select>
          <span class="wave-colormap-preview" :style="{ background: colormapGradient }"></span>
        </label>
        <label class="wave-row" v-if="view === 'amplitudePhase'">
          <span>Chroma</span>
          <input type="range" class="form-range wave-range" min="0" max="0.35" step="0.005"
            v-model.number="phaseChroma">
          <span class="wave-phase-wheel" :style="{ background: phaseWheel }"></span>
          <WaveHelp label="About the amplitude-phase mapping">
            Hue is the phase &mdash; zero to the right, increasing anticlockwise
            &mdash; and lightness is the amplitude. Chroma is reduced wherever
            sRGB cannot hold it, so the lightness and the hue stay exact and only
            the saturation gives way.
          </WaveHelp>
        </label>
      </section>

      <!-- Layout -->
      <section>
        <h2>Layout</h2>
        <div class="wave-row">
          <div class="btn-group">
            <button class="btn btn-sm" :class="showGrid ? 'btn-primary' : 'btn-outline-light'"
              @click="showGrid = !showGrid">Grid</button>
            <button class="btn btn-sm" :class="snapToGrid ? 'btn-primary' : 'btn-outline-light'"
              @click="snapToGrid = !snapToGrid">Snap</button>
          </div>
          <WaveHelp label="About grouping">
            To move several objects together, hold Ctrl and click each of them,
            then click empty space to drop the handle. Dragging the handle moves
            everything bound to it; its object bar switches it between
            translation, rotation and scaling.
          </WaveHelp>
        </div>
        <label class="wave-row wave-row-check">
          <input type="checkbox" class="form-check-input" v-model="autoSyncUrl">
          <span>Auto sync URL</span>
          <WaveHelp label="About the shareable link">
            Writes the whole scene into the address bar as you edit, so the URL
            is always a link to what is on screen and there is nothing to save.
            A scene too large to fit in a link says so rather than producing one
            that will not load.
          </WaveHelp>
        </label>
      </section>
    </div>
  </div>
</template>

<script>
/**
 * @module WaveSidebar
 * @description The scene-level settings, in a panel that folds away.
 *
 * These are the settings that are set once and then left: the wavelength, the
 * sampling, the colour scale. Along the top they crowded out the controls that
 * are actually reached for while working — the tools and the view — so they
 * live here instead, leaving the toolbar to the things used every minute.
 */
import { computed } from 'vue';
import { app } from '../services/waveApp.js';
import { useWaveStore } from '../store/wave.js';
import WaveHelp from './WaveHelp.vue';
import {
  listColormapsForView, colormapDisplayName, colormapCssGradient
} from '../../core/waveOptics/colormaps.js';
import { phaseWheelCssGradient } from '../../core/waveOptics/oklch.js';
import { RESOLUTION_LADDER } from '../../core/waveOptics/adaptiveResolution.js';

export default {
  name: 'WaveSidebar',
  components: { WaveHelp },
  props: {
    open: { type: Boolean, default: false },
  },
  emits: ['toggle'],
  setup() {
    const store = useWaveStore();
    const view = store.view;

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

    const resolutionChoice = computed({
      get: () => (store.autoResolution.value ? 'auto' : String(store.gridResolution.value)),
      set: (value) => {
        if (value === 'auto') {
          store.autoResolution.value = true;
        } else {
          store.gridResolution.value = Number(value);
          store.autoResolution.value = false;
        }
      },
    });

    const autoSyncUrl = computed({
      get: () => store.state.autoSyncUrl,
      set: (value) => {
        store.state.autoSyncUrl = value;
        app.autoSyncUrl = value;
        // Turning it on should produce a link immediately rather than waiting
        // for the next edit, which is what the user just asked for.
        if (value) app.syncUrl();
      },
    });

    return {
      view,
      colormap,
      colormapOptions: computed(() => listColormapsForView(view.value)),
      colormapGradient: computed(() => colormapCssGradient(colormap.value)),
      phaseWheel: computed(() => phaseWheelCssGradient(store.phaseChroma.value)),
      resolutionChoice,
      resolutions: RESOLUTION_LADDER,
      autoSyncUrl,
      wavelength: store.wavelength,
      refractiveIndex: store.refractiveIndex,
      reversed: store.reversed,
      sourceDensity: store.sourceDensity,
      upperCutoff: store.upperCutoff,
      lowerCutoff: store.lowerCutoff,
      logScale: store.logScale,
      dynamicRange: store.dynamicRange,
      scalePercentile: store.scalePercentile,
      phaseChroma: store.phaseChroma,
      showGrid: store.showGrid,
      snapToGrid: store.snapToGrid,
    };
  },
  methods: {
    colormapLabel(name) {
      return colormapDisplayName(name);
    },
  },
};
</script>

<style scoped>
.wave-sidebar {
  /* Laid out by the chrome column above, so it starts below whatever bars are
     showing rather than at a hard-coded offset that the object bar can grow
     past. */
  max-height: 100%;
  display: flex;
  align-items: flex-start;
  pointer-events: none;
}

.wave-sidebar-tab {
  /* Twice the size of the original: this is the only way in to every scene
     setting, and on a large screen it read as an easy-to-miss sliver. */
  pointer-events: auto;
  align-self: flex-start;
  margin-top: 16px;
  padding: 20px 6px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  background-color: rgba(20, 22, 26, 0.88);
  backdrop-filter: blur(4px);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-right: none;
  border-radius: 8px 0 0 8px;
  color: rgba(255, 255, 255, 0.75);
  font-size: 26px;
  line-height: 1;
}

.wave-sidebar-tab:hover {
  color: #fff;
}

.wave-sidebar-tab-label {
  writing-mode: vertical-rl;
  font-size: 20px;
  letter-spacing: 0.05em;
}

.wave-sidebar-body {
  pointer-events: auto;
  width: 300px;
  max-height: 100%;
  overflow-y: auto;
  padding: 10px 12px 18px;
  background-color: rgba(20, 22, 26, 0.94);
  backdrop-filter: blur(4px);
  border-left: 1px solid rgba(255, 255, 255, 0.12);
  color: rgba(255, 255, 255, 0.85);
  font-size: 12px;
}

section {
  padding-bottom: 10px;
  margin-bottom: 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

section:last-child {
  border-bottom: none;
}

h2 {
  margin: 4px 0 8px;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: rgba(255, 255, 255, 0.45);
}

.wave-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 7px;
  white-space: nowrap;
}

.wave-row > span:first-child {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.wave-row-check > span {
  flex: 1 1 auto;
}

.wave-row input[type="number"] {
  width: 74px;
}

.wave-row select {
  width: auto;
  min-width: 84px;
}

.wave-row output {
  min-width: 48px;
  text-align: right;
  color: rgba(255, 255, 255, 0.6);
  font-variant-numeric: tabular-nums;
}

.wave-range {
  width: 84px;
  padding-top: 3px;
}

.wave-phase-wheel {
  display: inline-block;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.25);
  flex: 0 0 auto;
}

.wave-colormap-preview {
  display: inline-block;
  width: 46px;
  height: 13px;
  border-radius: 2px;
  border: 1px solid rgba(255, 255, 255, 0.25);
  flex: 0 0 auto;
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
