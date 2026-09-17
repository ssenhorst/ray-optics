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
  <!--
    The bars stack from the top and the sidebar takes the space left under
    them, so it never covers the object bar however many rows that wraps to.
    The column itself is transparent to the pointer; only the chrome inside it
    takes clicks, leaving the canvas underneath draggable everywhere else.
  -->
  <div class="wave-chrome">
    <WaveToolbar />
    <WaveObjBar />
    <div class="wave-chrome-rest">
      <WaveSidebar :open="sidebarOpen" @toggle="sidebarOpen = !sidebarOpen" />
    </div>
  </div>
  <WaveStatusArea />
</template>

<script>
/**
 * @module WaveApp
 * @description The root component of the wave-optics app.
 */
import { ref } from 'vue';
import WaveCanvasContainer from './WaveCanvasContainer.vue';
import WaveToolbar from './WaveToolbar.vue';
import WaveSidebar from './WaveSidebar.vue';
import WaveObjBar from './WaveObjBar.vue';
import WaveStatusArea from './WaveStatusArea.vue';

export default {
  name: 'WaveApp',
  components: {
    WaveCanvasContainer,
    WaveToolbar,
    WaveSidebar,
    WaveObjBar,
    WaveStatusArea,
  },
  setup() {
    // Closed to start with: the settings inside are ones a scene is set up with
    // rather than ones worked with, so the canvas gets the room by default.
    return { sidebarOpen: ref(false) };
  },
};
</script>

<style>
body {
  background-color: #000;
  margin: 0;
  font-family: system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
}

.wave-chrome {
  position: fixed;
  inset: 0;
  z-index: 20;
  display: flex;
  flex-direction: column;
  pointer-events: none;
}

.wave-chrome > * {
  pointer-events: auto;
}

.wave-chrome-rest {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  justify-content: flex-end;
  pointer-events: none;
}
</style>
