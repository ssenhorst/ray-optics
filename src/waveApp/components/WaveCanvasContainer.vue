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
  <canvas id="waveCanvasBelow"></canvas>
  <canvas id="waveCanvasGrid"></canvas>
  <canvas id="waveCanvasField"></canvas>
  <canvas id="waveCanvasAbove"></canvas>

  <div id="wave-xybox-container" style="display:none;">
    <input type="text" id="wave-xybox" value="">
  </div>
</template>

<script>
/**
 * @module WaveCanvasContainer
 * @description The stack of canvas layers for the wave-optics app.
 *
 * Bottom to top: the background, the grid, the computed field (WebGL2), and
 * the object layer. Mouse and touch events are captured only by the topmost
 * canvas and handled by the Editor, exactly as in the ray app.
 *
 * The field layer is opaque wherever a field has been computed, so scene
 * objects draw themselves onto the layer above it rather than below.
 */
export default {
  name: 'WaveCanvasContainer',
};
</script>

<style scoped>
#waveCanvasBelow {
  background-color: #000;
  position: absolute;
  width: 100%;
  height: 100%;
  margin: 0;
  z-index: -7;
}

#waveCanvasGrid {
  background-color: transparent;
  position: absolute;
  width: 100%;
  height: 100%;
  margin: 0;
  z-index: -6;
}

#waveCanvasField {
  background-color: transparent;
  position: absolute;
  width: 100%;
  height: 100%;
  margin: 0;
  z-index: -5;
}

#waveCanvasAbove {
  background-color: transparent;
  position: absolute;
  width: 100%;
  height: 100%;
  margin: 0;
  z-index: -4;
}

#wave-xybox-container {
  position: absolute;
}

#wave-xybox {
  background-color: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(2px);
  color: white;
  border: none;
}
</style>
