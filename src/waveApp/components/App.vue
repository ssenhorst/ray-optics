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
  <WaveCanvasContainer />
  <WaveToolbar />
  <WaveObjBar />
  <WaveStatusArea />
</template>

<script>
/**
 * @module WaveApp
 * @description The root component of the wave-optics app.
 */
import WaveCanvasContainer from './WaveCanvasContainer.vue';
import WaveToolbar from './WaveToolbar.vue';
import WaveObjBar from './WaveObjBar.vue';
import WaveStatusArea from './WaveStatusArea.vue';

export default {
  name: 'WaveApp',
  components: {
    WaveCanvasContainer,
    WaveToolbar,
    WaveObjBar,
    WaveStatusArea,
  },
};
</script>

<style>
body {
  background-color: #000;
  margin: 0;
  font-family: system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
}
</style>
