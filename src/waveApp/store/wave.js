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

import { reactive, computed } from 'vue';
import Scene from '../../core/Scene.js';
import { app } from '../services/waveApp.js';

/**
 * Settings that change the physics or the sampling, and so require the field
 * to be recomputed. Everything else only re-colours the cached field, which is
 * essentially free.
 */
const RECOMPUTE_KEYS = new Set([
  'wavelength', 'refractiveIndex', 'gridResolution', 'autoResolution',
  'scalePercentile', 'sourceDensity', 'reversed',
]);

let storeInstance = null;

/**
 * A Vue store over `scene.waveOptics`, plus the transient view state (time,
 * animation, tool selection) that is intentionally not part of the saved
 * scene.
 *
 * @returns {Object}
 */
export const useWaveStore = () => {
  if (storeInstance) return storeInstance;

  const defaults = Scene.serializableDefaults.waveOptics;

  const state = reactive({
    ...defaults,
    tool: '',
    selectedIndex: -1,
    time: 0,
    isAnimating: false,
    animationSpeed: 0.5,
    showGrid: false,
    snapToGrid: false,
    status: {
      error: null,
      sourceCount: 0,
      pixelsPerWavelength: 0,
      samplesPerWavelength: 0,
      comfortablePixels: 4,
      isAliasing: false,
      isCoarse: false,
      isSourceUndersampled: false,
      isSourceCoarse: false,
      isDensityReduced: false,
      isPhaseUnreliable: false,
      interfaceCount: 0,
      warnings: [],
      gridWidth: 0,
      gridHeight: 0,
      computeMs: 0,
      mousePos: null,
    },
  });

  /** Copy the scene's stored settings into the reactive state. */
  const syncFromScene = () => {
    const stored = app.scene?.waveOptics;
    if (!stored) return;
    for (const key of Object.keys(defaults)) {
      state[key] = stored[key] ?? defaults[key];
    }
    state.showGrid = app.scene.showGrid;
    state.snapToGrid = app.scene.snapToGrid;
  };

  const settingProps = Object.fromEntries(
    Object.keys(defaults).map((key) => [
      key,
      computed({
        get: () => state[key],
        set: (value) => {
          state[key] = value;
          if (app.scene) app.scene.waveOptics[key] = value;
          app.refresh({ recomputeField: RECOMPUTE_KEYS.has(key) });
          app.editor?.onActionComplete();
        },
      }),
    ])
  );

  const tool = computed({
    get: () => state.tool,
    set: (value) => {
      state.tool = value;
      app.setTool(value);
    },
  });

  const showGrid = computed({
    get: () => state.showGrid,
    set: (value) => {
      state.showGrid = value;
      if (app.scene) app.scene.showGrid = value;
      app.simulator?.updateSimulation(true, false);
      app.editor?.onActionComplete();
    },
  });

  const snapToGrid = computed({
    get: () => state.snapToGrid,
    set: (value) => {
      state.snapToGrid = value;
      if (app.scene) app.scene.snapToGrid = value;
    },
  });

  const animationSpeed = computed({
    get: () => state.animationSpeed,
    set: (value) => {
      state.animationSpeed = value;
      if (app.simulator) app.simulator.animationSpeed = value;
    },
  });

  const toggleAnimation = () => {
    if (!app.simulator) return;
    if (app.simulator.isAnimating) {
      app.simulator.stopAnimation();
    } else {
      app.simulator.startAnimation();
    }
  };

  const setTime = (value) => {
    app.simulator?.setTime(value);
  };

  app.on('statusChange', (detail) => {
    if (detail.diagnostics) {
      state.status.sourceCount = detail.diagnostics.sourceCount;
      state.status.pixelsPerWavelength = detail.diagnostics.pixelsPerWavelength;
      state.status.samplesPerWavelength = detail.diagnostics.samplesPerWavelength;
      state.status.comfortablePixels = detail.diagnostics.comfortablePixels;
      state.status.isAliasing = detail.diagnostics.isAliasing;
      state.status.isCoarse = detail.diagnostics.isCoarse;
      state.status.isSourceUndersampled = detail.diagnostics.isSourceUndersampled;
      state.status.isSourceCoarse = detail.diagnostics.isSourceCoarse;
      state.status.isDensityReduced = detail.diagnostics.isDensityReduced;
      state.status.isPhaseUnreliable = detail.diagnostics.isPhaseUnreliable;
      state.status.interfaceCount = detail.diagnostics.interfaceCount ?? 0;
    }
    if (detail.gridWidth !== undefined) {
      state.status.gridWidth = detail.gridWidth;
      state.status.gridHeight = detail.gridHeight;
      state.status.computeMs = detail.computeMs;
    }
    if (detail.warnings !== undefined) state.status.warnings = detail.warnings;
    if (detail.mousePos !== undefined) state.status.mousePos = detail.mousePos;
    if (detail.error !== undefined) state.status.error = detail.error;
  });

  app.on('timeChange', (detail) => { state.time = detail.time; });
  app.on('animationChange', (detail) => { state.isAnimating = detail.isAnimating; });
  app.on('selectionChange', (detail) => { state.selectedIndex = detail.index; });
  app.on('sceneChange', syncFromScene);
  app.on('toolChange', (detail) => { state.tool = detail.tool; });

  storeInstance = {
    ...settingProps,
    tool,
    showGrid,
    snapToGrid,
    animationSpeed,
    toggleAnimation,
    setTime,
    syncFromScene,
    state,
  };
  return storeInstance;
};
