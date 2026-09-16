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

/**
 * @file The GPU backend: sums the contribution of every source at every grid
 * sample, then colours the result.
 *
 * The work is split into two passes for a reason that matters for performance.
 * The field `U(r)` of a time-harmonic source does not depend on time, so it is
 * computed once into a floating-point texture and cached there. Animation
 * re-runs only the cheap display pass, which means the frame rate is
 * independent of the number of sources.
 *
 * WebGL2 rather than WebGL1: rendering *into* a float texture needs
 * `EXT_color_buffer_float`, and indexing the source table needs `texelFetch`.
 */

import { buildHankelGlsl } from './hankel.js';
import { wavenumber, minimumRadius } from './conventions.js';
import { getColormapTableRGBA, COLORMAP_SIZE } from './colormaps.js';

/** Width of the source table texture; the table wraps onto further rows. */
const SOURCE_TEXTURE_WIDTH = 1024;

const FULLSCREEN_VERTEX_SHADER = `#version 300 es
// A single oversized triangle covering the viewport; no vertex buffer needed.
void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}
`;

const FIELD_FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp sampler2D;

uniform sampler2D uSources;
uniform int uSourceCount;
uniform vec2 uGridOrigin;
uniform vec2 uGridStep;
uniform float uWavenumber;
uniform float uMinRadius;

out vec4 fragColor;

${buildHankelGlsl()}

void main() {
  // uGridStep.y is negative: framebuffer row 0 is the bottom of the screen,
  // which is the largest scene y.
  vec2 p = uGridOrigin + uGridStep * (gl_FragCoord.xy - 0.5);

  vec2 total = vec2(0.0);
  for (int i = 0; i < uSourceCount; i++) {
    vec4 source = texelFetch(uSources, ivec2(i % ${SOURCE_TEXTURE_WIDTH}, i / ${SOURCE_TEXTURE_WIDTH}), 0);
    float r = max(distance(p, source.xy), uMinRadius);
    vec2 g = greensFunction(uWavenumber * r);
    // Complex multiply of the Green's function by the source weight.
    total += vec2(g.x * source.z - g.y * source.w,
                  g.x * source.w + g.y * source.z);
  }

  // The amplitude is stored alongside the complex field. The display pass
  // magnifies this texture with linear filtering, and interpolating a rapidly
  // oscillating Re/Im pair and *then* taking its magnitude loses amplitude
  // between samples, which shows up as false rings at the grid pitch. |U| is
  // smooth, so interpolating it directly is well behaved.
  fragColor = vec4(total, length(total), 1.0);
}
`;

const DISPLAY_FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp sampler2D;

uniform sampler2D uField;
uniform sampler2D uColormap;
uniform vec2 uResolution;
uniform int uView;          // 0 = intensity, 1 = instantaneous field
uniform float uScale;       // reference amplitude the colour scale saturates at
uniform float uLowerCutoff; // intensity floor, as a fraction of full scale
uniform float uPhase;       // w t
uniform int uLogScale;
uniform float uDynamicRange; // decibels, when uLogScale is set

out vec4 fragColor;

const float LN10 = 2.302585092994046;

// Sample the colormap at texel centres so the ends are not half-clipped.
vec3 applyColormap(float t) {
  float u = mix(0.5 / ${COLORMAP_SIZE}.0, (${COLORMAP_SIZE}.0 - 0.5) / ${COLORMAP_SIZE}.0, clamp(t, 0.0, 1.0));
  return texture(uColormap, vec2(u, 0.5)).rgb;
}

void main() {
  vec4 fieldSample = texture(uField, gl_FragCoord.xy / uResolution);
  float scale = max(uScale, 1e-30);
  float t;

  if (uView == 1) {
    // Re{ U e^{-i w t} }, mapped symmetrically about the middle of the map.
    float value = fieldSample.x * cos(uPhase) + fieldSample.y * sin(uPhase);
    t = 0.5 + 0.5 * clamp(value / scale, -1.0, 1.0);
  } else {
    // fieldSample.z is |U|, interpolated directly rather than recomputed from the
    // interpolated Re/Im, which would ripple at the grid pitch.
    float intensity = fieldSample.z * fieldSample.z;
    float reference = scale * scale;
    if (uLogScale == 1) {
      float decibels = 10.0 * log(max(intensity, 1e-30) / reference) / LN10;
      t = (decibels + uDynamicRange) / uDynamicRange;
    } else {
      t = (intensity / reference - uLowerCutoff) / max(1.0 - uLowerCutoff, 1e-6);
    }
  }

  fragColor = vec4(applyColormap(t), 1.0);
}
`;

/**
 * Compile one shader stage, reporting the driver's log on failure.
 * @param {WebGL2RenderingContext} gl
 * @param {number} type
 * @param {string} source
 * @returns {WebGLShader}
 */
function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Wave field shader failed to compile: ${log}`);
  }
  return shader;
}

/**
 * Link a program from the shared full-screen vertex shader and a fragment shader.
 * @param {WebGL2RenderingContext} gl
 * @param {string} fragmentSource
 * @returns {WebGLProgram}
 */
function linkProgram(gl, fragmentSource) {
  const program = gl.createProgram();
  const vertex = compileShader(gl, gl.VERTEX_SHADER, FULLSCREEN_VERTEX_SHADER);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`Wave field program failed to link: ${log}`);
  }
  return program;
}

/**
 * Obtain a WebGL2 context suitable for the wave renderer.
 * @param {HTMLCanvasElement} canvas
 * @returns {WebGL2RenderingContext}
 * @throws If WebGL2 or float render targets are unavailable.
 */
export function createWaveRenderingContext(canvas) {
  const gl = canvas.getContext('webgl2', {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    // The field is drawn on demand, not once per frame, so the drawing buffer
    // must survive compositing. Without this the canvas can come back blank
    // after the compositor re-rasterises it with nothing having changed.
    preserveDrawingBuffer: true,
  });
  if (!gl) {
    throw new Error('WebGL2 is not available in this browser.');
  }
  if (!gl.getExtension('EXT_color_buffer_float')) {
    throw new Error('EXT_color_buffer_float is not supported, so the field cannot be computed at floating point precision.');
  }
  return gl;
}

/**
 * The GPU field engine.
 * @class
 */
class WaveFieldEngineWebGL2 {
  /**
   * @param {WebGL2RenderingContext} gl
   */
  constructor(gl) {
    this.gl = gl;

    // Linear filtering of float textures is a separate extension. Without it
    // the field is still correct, just blocky when magnified.
    this.hasLinearFloat = Boolean(gl.getExtension('OES_texture_float_linear'));

    this.fieldProgram = linkProgram(gl, FIELD_FRAGMENT_SHADER);
    this.displayProgram = linkProgram(gl, DISPLAY_FRAGMENT_SHADER);
    this.fieldUniforms = collectUniforms(gl, this.fieldProgram, [
      'uSources', 'uSourceCount', 'uGridOrigin', 'uGridStep', 'uWavenumber', 'uMinRadius'
    ]);
    this.displayUniforms = collectUniforms(gl, this.displayProgram, [
      'uField', 'uColormap', 'uResolution', 'uView', 'uScale',
      'uLowerCutoff', 'uPhase', 'uLogScale', 'uDynamicRange'
    ]);

    // WebGL requires a bound vertex array even when the shader uses gl_VertexID.
    this.vertexArray = gl.createVertexArray();

    this.sourceTexture = gl.createTexture();
    this.fieldTexture = gl.createTexture();
    this.framebuffer = gl.createFramebuffer();
    this.colormapTextures = new Map();

    this.fieldWidth = 0;
    this.fieldHeight = 0;
    this.sourceRows = 0;
    this.sourceBuffer = null;
    this.readbackBuffer = null;

    /** @property {Object|null} lastStats - Amplitude statistics of the last computed field. */
    this.lastStats = null;
  }

  /**
   * Upload the source table.
   * @param {import('./waveSceneModel.js').WaveSource[]} sources
   * @private
   */
  uploadSources(sources) {
    const gl = this.gl;
    const rows = Math.max(1, Math.ceil(sources.length / SOURCE_TEXTURE_WIDTH));
    const needed = SOURCE_TEXTURE_WIDTH * rows * 4;

    if (!this.sourceBuffer || this.sourceBuffer.length < needed) {
      this.sourceBuffer = new Float32Array(needed);
    }
    const buffer = this.sourceBuffer;
    buffer.fill(0, 0, needed);

    for (let i = 0; i < sources.length; i++) {
      const source = sources[i];
      buffer[i * 4] = source.x;
      buffer[i * 4 + 1] = source.y;
      buffer[i * 4 + 2] = source.re;
      buffer[i * 4 + 3] = source.im;
    }

    gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture);
    if (this.sourceRows !== rows) {
      gl.texImage2D(
        gl.TEXTURE_2D, 0, gl.RGBA32F, SOURCE_TEXTURE_WIDTH, rows, 0,
        gl.RGBA, gl.FLOAT, null
      );
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.sourceRows = rows;
    }
    gl.texSubImage2D(
      gl.TEXTURE_2D, 0, 0, 0, SOURCE_TEXTURE_WIDTH, rows,
      gl.RGBA, gl.FLOAT, buffer, 0
    );
  }

  /**
   * Allocate (or reallocate) the float texture the field is computed into.
   * @param {number} width
   * @param {number} height
   * @private
   */
  resizeField(width, height) {
    const gl = this.gl;
    if (this.fieldWidth === width && this.fieldHeight === height) return;

    const filter = this.hasLinearFloat ? gl.LINEAR : gl.NEAREST;
    gl.bindTexture(gl.TEXTURE_2D, this.fieldTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, width, height, 0, gl.RGBA, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.fieldTexture, 0
    );
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error(`Wave field framebuffer is incomplete (status 0x${status.toString(16)}).`);
    }

    this.fieldWidth = width;
    this.fieldHeight = height;
    this.readbackBuffer = null;
  }

  /**
   * Compute the complex field over the grid and cache it in the float texture.
   *
   * @param {Object} options
   * @param {import('./waveSceneModel.js').WaveSource[]} options.sources
   * @param {import('./waveSceneModel.js').FieldGrid} options.grid
   * @param {number} options.wavelength - Vacuum wavelength in scene units.
   * @param {number} options.refractiveIndex
   */
  computeField({ sources, grid, wavelength, refractiveIndex = 1 }) {
    const gl = this.gl;
    this.resizeField(grid.width, grid.height);
    this.uploadSources(sources);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.viewport(0, 0, grid.width, grid.height);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);

    gl.useProgram(this.fieldProgram);
    gl.bindVertexArray(this.vertexArray);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture);
    gl.uniform1i(this.fieldUniforms.uSources, 0);
    gl.uniform1i(this.fieldUniforms.uSourceCount, sources.length);
    gl.uniform2f(this.fieldUniforms.uGridOrigin, grid.originX, grid.originY);
    gl.uniform2f(this.fieldUniforms.uGridStep, grid.stepX, grid.stepY);
    gl.uniform1f(this.fieldUniforms.uWavenumber, wavenumber(wavelength, refractiveIndex));
    gl.uniform1f(this.fieldUniforms.uMinRadius, minimumRadius(wavelength, refractiveIndex));

    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    // The statistics belong to this field; force them to be recomputed.
    this.lastStats = null;
  }

  /**
   * Read the computed field back and summarise its amplitude distribution.
   *
   * The colour scale is taken from a high percentile rather than the maximum,
   * because the maximum sits at the logarithmic singularity of the Green's
   * function right at a source and would compress everything else to black.
   *
   * This is a GPU-to-CPU synchronisation point, so callers should do it only
   * on the final full-resolution pass, not while the user is dragging.
   *
   * @param {number} percentile - Between 0 and 100.
   * @returns {{referenceAmplitude: number, maxAmplitude: number, sampleCount: number}}
   */
  readFieldStats(percentile = 99) {
    const gl = this.gl;
    const count = this.fieldWidth * this.fieldHeight;
    if (count === 0) {
      return { referenceAmplitude: 0, maxAmplitude: 0, sampleCount: 0 };
    }

    if (!this.readbackBuffer) {
      this.readbackBuffer = new Float32Array(count * 4);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.readPixels(
      0, 0, this.fieldWidth, this.fieldHeight, gl.RGBA, gl.FLOAT, this.readbackBuffer
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    const amplitudes = new Float32Array(count);
    let maxAmplitude = 0;
    for (let i = 0; i < count; i++) {
      // Channel 2 is |U|, written by the field pass.
      const amplitude = this.readbackBuffer[i * 4 + 2];
      amplitudes[i] = amplitude;
      if (amplitude > maxAmplitude) maxAmplitude = amplitude;
    }

    amplitudes.sort();
    const index = Math.min(
      count - 1,
      Math.max(0, Math.round((percentile / 100) * (count - 1)))
    );

    this.lastStats = {
      referenceAmplitude: amplitudes[index] || maxAmplitude,
      maxAmplitude,
      sampleCount: count,
    };
    return this.lastStats;
  }

  /**
   * Colour the cached field onto the canvas.
   *
   * @param {Object} options
   * @param {string} options.view - 'intensity' or 'field'.
   * @param {string} options.colormap - Colormap identifier.
   * @param {number} options.referenceAmplitude - Amplitude the scale saturates at.
   * @param {number} [options.upperCutoff=1] - Multiplies the reference amplitude.
   * @param {number} [options.lowerCutoff=0] - Intensity floor, as a fraction of full scale.
   * @param {number} [options.phase=0] - The quantity `w t`, for the field view.
   * @param {boolean} [options.logScale=false]
   * @param {number} [options.dynamicRange=40] - Decibels shown when `logScale` is set.
   */
  render({
    view, colormap, referenceAmplitude, upperCutoff = 1, lowerCutoff = 0,
    phase = 0, logScale = false, dynamicRange = 40,
  }) {
    const gl = this.gl;
    const canvas = gl.canvas;

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);

    gl.useProgram(this.displayProgram);
    gl.bindVertexArray(this.vertexArray);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.fieldTexture);
    gl.uniform1i(this.displayUniforms.uField, 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.getColormapTexture(colormap));
    gl.uniform1i(this.displayUniforms.uColormap, 1);

    gl.uniform2f(this.displayUniforms.uResolution, canvas.width, canvas.height);
    gl.uniform1i(this.displayUniforms.uView, view === 'field' ? 1 : 0);
    gl.uniform1f(this.displayUniforms.uScale, referenceAmplitude * upperCutoff);
    gl.uniform1f(this.displayUniforms.uLowerCutoff, lowerCutoff);
    gl.uniform1f(this.displayUniforms.uPhase, phase);
    gl.uniform1i(this.displayUniforms.uLogScale, logScale ? 1 : 0);
    gl.uniform1f(this.displayUniforms.uDynamicRange, dynamicRange);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  /** Clear the canvas without drawing a field. */
  clear() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  /**
   * The colormap lookup texture, uploaded on first use and then cached.
   * @param {string} name
   * @returns {WebGLTexture}
   * @private
   */
  getColormapTexture(name) {
    let texture = this.colormapTextures.get(name);
    if (texture) return texture;

    const gl = this.gl;
    texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.RGBA, COLORMAP_SIZE, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
      getColormapTableRGBA(name)
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.colormapTextures.set(name, texture);
    return texture;
  }

  /** Release every GL object this engine owns. */
  destroy() {
    const gl = this.gl;
    gl.deleteProgram(this.fieldProgram);
    gl.deleteProgram(this.displayProgram);
    gl.deleteTexture(this.sourceTexture);
    gl.deleteTexture(this.fieldTexture);
    gl.deleteFramebuffer(this.framebuffer);
    gl.deleteVertexArray(this.vertexArray);
    for (const texture of this.colormapTextures.values()) {
      gl.deleteTexture(texture);
    }
    this.colormapTextures.clear();
  }
}

/**
 * Look up several uniform locations at once.
 * @param {WebGL2RenderingContext} gl
 * @param {WebGLProgram} program
 * @param {string[]} names
 * @returns {Object<string, WebGLUniformLocation>}
 */
function collectUniforms(gl, program, names) {
  const uniforms = {};
  for (const name of names) {
    uniforms[name] = gl.getUniformLocation(program, name);
  }
  return uniforms;
}

export default WaveFieldEngineWebGL2;
