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

import CanvasRenderer from '../CanvasRenderer.js';
import WaveFieldEngineWebGL2 from './WaveFieldEngineWebGL2.js';
import { buildWaveModel, resolveWaveSettings } from './waveSceneModel.js';
import { INTERACTIVE_GRID_RESOLUTION } from './conventions.js';

/**
 * How long after the last edit the field is recomputed at full resolution.
 * Long enough to coalesce a drag, short enough not to feel laggy.
 */
const REFINE_DELAY_MS = 150;

/**
 * If two light updates arrive closer together than this, the user is dragging
 * and the coarse grid is used.
 */
const INTERACTION_WINDOW_MS = 200;

/**
 * The wave-optics counterpart of {@link Simulator}: it presents the same
 * interface to {@link Editor} (`updateSimulation`, `dpr`, the event emitter)
 * but replaces ray tracing with a summation of point-source fields.
 *
 * Responsibilities are split the same way as in the ray simulator. The scene
 * objects draw themselves onto the 2D canvas layers; this class draws the grid,
 * drives the field engine, and owns the animation clock.
 *
 * @class
 */
class WaveSimulator {
  /**
   * @param {Object} options
   * @param {Scene} options.scene
   * @param {WebGL2RenderingContext} options.gl - Context of the field canvas.
   * @param {CanvasRenderingContext2D} options.ctxBelowLight
   * @param {CanvasRenderingContext2D} options.ctxAboveLight
   * @param {CanvasRenderingContext2D} options.ctxGrid
   */
  constructor({ scene, gl, ctxBelowLight, ctxAboveLight, ctxGrid }) {
    /** @property {Scene} scene - The scene being simulated. */
    this.scene = scene;
    this.scene.simulator = this;

    this.gl = gl;
    this.ctxBelowLight = ctxBelowLight;
    this.ctxAboveLight = ctxAboveLight;
    this.ctxGrid = ctxGrid;

    /** @property {number} dpr - Device pixel ratio of the canvas layers. */
    this.dpr = 1;

    /**
     * @property {WebGLRenderingContext|null} glMain - Always null. The ray
     * simulator exposes this for its image-export path; the wave app does not
     * use that path, and leaving it null makes the check there fail cleanly.
     */
    this.glMain = null;

    /** @property {Object} eventListeners - Registered event callbacks. */
    this.eventListeners = {};

    /** @property {number} time - Animation clock, in optical cycles. */
    this.time = 0;

    /** @property {boolean} isAnimating - Whether the animation loop is running. */
    this.isAnimating = false;

    /** @property {number} animationSpeed - Optical cycles per second of wall time. */
    this.animationSpeed = 0.5;

    /** @property {Object|null} lastModel - The model built by the last field computation. */
    this.lastModel = null;

    /** @property {number} lastComputeMs - Duration of the last field computation. */
    this.lastComputeMs = 0;

    /** @property {string|null} error - The current error message, if any. */
    this.error = null;

    this.engine = null;
    this.engineError = null;
    this.referenceAmplitude = 0;
    this.lastLightUpdateTime = -Infinity;
    this.refineTimerId = -1;
    this.animationFrameId = -1;
    this.animationLastTime = 0;

    try {
      this.engine = new WaveFieldEngineWebGL2(gl);
    } catch (e) {
      this.engineError = e.message;
      this.error = e.message;
    }
  }

  /**
   * Register an event listener.
   * @param {string} eventName
   * @param {function} callback
   */
  on(eventName, callback) {
    if (!this.eventListeners[eventName]) {
      this.eventListeners[eventName] = [];
    }
    this.eventListeners[eventName].push(callback);
  }

  /**
   * Emit an event to its listeners.
   * @param {string} eventName
   * @param {*} data
   */
  emit(eventName, data) {
    for (const callback of this.eventListeners[eventName] ?? []) {
      callback(data);
    }
  }

  /**
   * Redraw the scene, and recompute the field unless told to skip it.
   *
   * The signature matches {@link Simulator#updateSimulation} because
   * {@link Editor} calls it directly.
   *
   * @param {boolean} [skipLight=false] - Skip recomputing the field.
   * @param {boolean} [skipGrid=false] - Skip redrawing the background grid.
   * @param {boolean} [forceRedraw=false] - Unused; accepted for interface parity.
   */
  updateSimulation(skipLight = false, skipGrid = false, forceRedraw = false) {
    this.emit('update', { skipLight, skipGrid, forceRedraw });

    this.drawGrid(skipGrid);
    this.drawObjects();

    if (!skipLight) {
      this.scheduleFieldUpdate();
    }

    this.emit('requestUpdateErrorAndWarning');
  }

  /**
   * Recompute the field, coarsely while the user is interacting and at full
   * resolution once they stop.
   * @private
   */
  scheduleFieldUpdate() {
    if (!this.engine) return;

    const settings = resolveWaveSettings(this.scene);
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const isInteracting = now - this.lastLightUpdateTime < INTERACTION_WINDOW_MS;
    this.lastLightUpdateTime = now;

    const resolution = isInteracting
      ? Math.min(INTERACTIVE_GRID_RESOLUTION, settings.gridResolution)
      : settings.gridResolution;

    this.computeField(resolution);

    if (this.refineTimerId !== -1) {
      clearTimeout(this.refineTimerId);
      this.refineTimerId = -1;
    }
    if (resolution < settings.gridResolution) {
      this.refineTimerId = setTimeout(() => {
        this.refineTimerId = -1;
        this.computeField(settings.gridResolution);
        this.render();
      }, REFINE_DELAY_MS);
    }

    this.render();
  }

  /**
   * Compute the field at a given grid resolution and update the colour scale.
   * @param {number} resolution
   * @private
   */
  computeField(resolution) {
    if (!this.engine) return;

    const startTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const model = buildWaveModel(this.scene, { resolution });
    this.lastModel = model;

    try {
      this.engine.computeField(model);

      // The percentile readback stalls the pipeline, so it is done only on the
      // full-resolution pass. During a drag the previous scale is reused, which
      // keeps the colours stable while the geometry moves.
      if (resolution >= model.settings.gridResolution || this.referenceAmplitude === 0) {
        const stats = this.engine.readFieldStats(model.settings.scalePercentile);
        this.referenceAmplitude = stats.referenceAmplitude;
      }
      this.error = null;
    } catch (e) {
      this.error = e.message;
    }

    const endTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
    this.lastComputeMs = endTime - startTime;

    this.emit('fieldComputed', {
      diagnostics: model.diagnostics,
      warnings: model.warnings,
      resolution,
      gridWidth: model.grid.width,
      gridHeight: model.grid.height,
      computeMs: this.lastComputeMs,
      referenceAmplitude: this.referenceAmplitude,
    });
  }

  /**
   * Colour the cached field onto the canvas. This is the only work an
   * animation frame does.
   */
  render() {
    if (!this.engine) return;
    const settings = resolveWaveSettings(this.scene);

    if (!this.lastModel || this.lastModel.diagnostics.sourceCount === 0) {
      this.engine.clear();
      return;
    }

    this.engine.render({
      view: settings.view,
      colormap: settings.view === 'field'
        ? settings.fieldColormap
        : settings.intensityColormap,
      chroma: settings.phaseChroma,
      referenceAmplitude: this.referenceAmplitude,
      upperCutoff: settings.upperCutoff,
      lowerCutoff: settings.lowerCutoff,
      phase: this.time * Math.PI * 2,
      logScale: settings.logScale,
      dynamicRange: settings.dynamicRange,
    });
  }

  /**
   * Draw the background grid, mirroring the ray simulator's grid so the two
   * apps look and snap the same.
   * @param {boolean} skipGrid
   * @private
   */
  drawGrid(skipGrid) {
    if (skipGrid || !this.ctxGrid) return;

    const ctx = this.ctxGrid;
    const scale = this.scene.scale * this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    if (!this.scene.showGrid) return;

    ctx.save();
    ctx.setTransform(scale, 0, 0, scale, 0, 0);

    let dashPattern = this.scene.theme.grid.dash.map((value) => value * this.scene.lengthScale);
    const dashPeriod = dashPattern.reduce((a, b) => a + b, 0);
    if (dashPeriod * this.scene.scale <= 2) dashPattern = [];

    const color = this.scene.theme.grid.color;
    ctx.strokeStyle = `rgba(${Math.round(color.r * 255)},${Math.round(color.g * 255)},${Math.round(color.b * 255)},${color.a})`;
    ctx.lineWidth = this.scene.theme.grid.width * this.scene.lengthScale;
    ctx.setLineDash(dashPattern);

    const gridSize = this.scene.gridSize;
    const viewWidth = ctx.canvas.width / scale;
    const viewHeight = ctx.canvas.height / scale;

    ctx.beginPath();
    for (let x = this.scene.origin.x / this.scene.scale % gridSize; x <= viewWidth; x += gridSize) {
      ctx.moveTo(x, this.scene.origin.y / this.scene.scale % gridSize - gridSize);
      ctx.lineTo(x, viewHeight);
    }
    ctx.stroke();

    ctx.beginPath();
    for (let y = this.scene.origin.y / this.scene.scale % gridSize; y <= viewHeight; y += gridSize) {
      ctx.moveTo(this.scene.origin.x / this.scene.scale % gridSize - gridSize, y);
      ctx.lineTo(viewWidth, y);
    }
    ctx.stroke();

    ctx.setLineDash([]);
    ctx.restore();
  }

  /**
   * Draw the scene objects onto the 2D layers.
   *
   * Wave objects draw themselves on the "above light" layer, since the field
   * is an opaque image covering the whole canvas.
   * @private
   */
  drawObjects() {
    if (!this.ctxBelowLight || !this.ctxAboveLight) return;

    const origin = { x: this.scene.origin.x * this.dpr, y: this.scene.origin.y * this.dpr };
    const scale = this.scene.scale * this.dpr;

    const below = new CanvasRenderer(
      this.ctxBelowLight, origin, scale, this.scene.lengthScale, this.scene.backgroundImage
    );
    const above = new CanvasRenderer(
      this.ctxAboveLight, origin, scale, this.scene.lengthScale
    );

    const order = this.scene.objs
      .map((obj, index) => ({ index, zIndex: obj.getZIndex() }))
      .sort((a, b) => a.zIndex - b.zIndex);

    for (const { index } of order) {
      const isHighlighted = this.scene.editor
        ? this.scene.editor.isObjHighlighted(index)
        : false;
      this.scene.objs[index].draw(below, false, isHighlighted);
    }
    for (const { index } of order) {
      const isHighlighted = this.scene.editor
        ? this.scene.editor.isObjHighlighted(index)
        : false;
      this.scene.objs[index].draw(above, true, isHighlighted);
    }
  }

  /**
   * Start animating the instantaneous-field view.
   *
   * Only {@link WaveSimulator#render} runs per frame: the complex field is
   * time-independent and stays cached in its texture, so the frame rate does
   * not depend on how many sources there are.
   */
  startAnimation() {
    if (this.isAnimating || typeof requestAnimationFrame === 'undefined') return;
    this.isAnimating = true;
    this.animationLastTime = performance.now();

    const step = () => {
      if (!this.isAnimating) return;
      const now = performance.now();
      const elapsed = (now - this.animationLastTime) / 1000;
      this.animationLastTime = now;
      this.time += elapsed * this.animationSpeed;
      this.render();
      this.emit('timeChange', { time: this.time });
      this.animationFrameId = requestAnimationFrame(step);
    };
    this.animationFrameId = requestAnimationFrame(step);
    this.emit('animationChange', { isAnimating: true });
  }

  /** Stop the animation loop. */
  stopAnimation() {
    if (!this.isAnimating) return;
    this.isAnimating = false;
    if (this.animationFrameId !== -1) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = -1;
    }
    this.emit('animationChange', { isAnimating: false });
  }

  /**
   * Set the animation clock and redraw.
   * @param {number} time - In optical cycles.
   */
  setTime(time) {
    this.time = time;
    this.render();
    this.emit('timeChange', { time: this.time });
  }

  /** The current error message, for the status area. */
  getError() {
    return this.error;
  }

  /** Release the GPU resources and stop all timers. */
  destroy() {
    this.stopAnimation();
    if (this.refineTimerId !== -1) {
      clearTimeout(this.refineTimerId);
      this.refineTimerId = -1;
    }
    this.engine?.destroy();
    this.engine = null;
    this.eventListeners = {};
  }
}

export default WaveSimulator;
