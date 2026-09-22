/*
 * Copyright 2026 The Wave Optics Simulation authors and contributors
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
 * @file The GPU backend.
 *
 * Three kinds of pass run here:
 *
 * 1. **Chain passes**, one per interface in order along the optical axis. Each
 *    evaluates the field arriving at that interface's sample sites from the
 *    subspace before it, multiplies by the transmission and the arc length, and
 *    leaves the result as the secondary-source weights radiating into the
 *    subspace beyond. These run sequentially because each depends on the last.
 * 2. **Field passes**, one per subspace, each drawing a full-screen quad that
 *    discards the pixels belonging to other subspaces. They share one float
 *    texture, which ends up holding the complex field over the whole view.
 * 3. **The display pass**, which colours that texture.
 *
 * The split matters for performance: a time-harmonic field does not depend on
 * time, so the first two run only when the scene changes, and animation re-runs
 * the third alone.
 *
 * WebGL2 rather than WebGL1: rendering into a float texture needs
 * `EXT_color_buffer_float`, and indexing the source tables needs `texelFetch`.
 */

import { buildHankelGlsl } from './hankel.js';
import { wavenumber, minimumRadius } from './conventions.js';
import { getColormapTableRGBA, COLORMAP_SIZE } from './colormaps.js';
import { buildOklchGlsl, DEFAULT_PHASE_CHROMA } from './oklch.js';
import { FloatTable, BoundaryLut, BOUNDARY_LUT_WIDTH } from './gpuTables.js';

/** Texture units, fixed so the two summation programs bind identically. */
const UNIT_DIRECTIONAL_GEOMETRY = 0;
const UNIT_DIRECTIONAL_WEIGHTS = 1;
const UNIT_ISOTROPIC_GEOMETRY = 2;
const UNIT_ISOTROPIC_WEIGHTS = 3;
const UNIT_PLANE_GEOMETRY = 4;
const UNIT_PLANE_WEIGHTS = 5;
const UNIT_EXTRA_A = 6;
const UNIT_EXTRA_B = 7;

const FULLSCREEN_VERTEX_SHADER = `#version 300 es
// A single oversized triangle covering the viewport; no vertex buffer needed.
void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}
`;

/**
 * The summation both the chain and the field passes perform.
 *
 * Sources are ordered directional-first, matching the CPU reference, so no
 * per-source kind flag is needed: the first `uDirCount` entries came from an
 * interface and re-radiate through the Rayleigh-Sommerfeld kernel, and the
 * rest are isotropic point sources.
 */
const SUMMATION_GLSL = `
precision highp float;
precision highp int;
precision highp sampler2D;

uniform sampler2D uDirGeometry;   // (x, y, nx, ny)
uniform sampler2D uDirWeights;    // (Re, Im, -, -)
uniform sampler2D uIsoGeometry;   // (x, y, -, -)
uniform sampler2D uIsoWeights;    // (Re, Im, -, -)
uniform sampler2D uPlaneGeometry; // (dir x, dir y, anchor x, anchor y)
uniform sampler2D uPlaneWeights;  // (Re, Im, -, -)
uniform int uDirCount;
uniform int uDirWidth;
uniform int uIsoCount;
uniform int uIsoWidth;
uniform int uPlaneCount;
uniform int uPlaneWidth;
uniform float uWavenumber;
uniform float uMinRadius;

${buildHankelGlsl()}

vec2 cmul(vec2 a, vec2 b) {
  return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);
}

vec2 sumField(vec2 p) {
  vec2 total = vec2(0.0);

  for (int i = 0; i < uDirCount; i++) {
    ivec2 uv = ivec2(i % uDirWidth, i / uDirWidth);
    vec4 site = texelFetch(uDirGeometry, uv, 0);
    vec2 weight = texelFetch(uDirWeights, uv, 0).xy;
    vec2 offset = p - site.xy;
    float r = max(length(offset), uMinRadius);
    float cosTheta = dot(site.zw, offset) / r;
    total += cmul(rayleighSommerfeldKernel(uWavenumber * r, cosTheta, uWavenumber), weight);
  }

  for (int i = 0; i < uIsoCount; i++) {
    ivec2 uv = ivec2(i % uIsoWidth, i / uIsoWidth);
    vec2 position = texelFetch(uIsoGeometry, uv, 0).xy;
    vec2 weight = texelFetch(uIsoWeights, uv, 0).xy;
    float r = max(distance(p, position), uMinRadius);
    total += cmul(greensFunction(uWavenumber * r), weight);
  }

  // Plane waves are evaluated in closed form. They are not built from point
  // sources, so they carry no aperture diffraction of their own.
  for (int i = 0; i < uPlaneCount; i++) {
    ivec2 uv = ivec2(i % uPlaneWidth, i / uPlaneWidth);
    vec4 wave = texelFetch(uPlaneGeometry, uv, 0);
    vec2 weight = texelFetch(uPlaneWeights, uv, 0).xy;
    float phase = uWavenumber * dot(wave.xy, p - wave.zw);
    total += cmul(vec2(cos(phase), sin(phase)), weight);
  }

  return total;
}
`;

const CHAIN_FRAGMENT_SHADER = `#version 300 es
${SUMMATION_GLSL}

uniform sampler2D uSiteGeometry;      // (x, y, nx, ny) of this interface
uniform sampler2D uSiteTransmission;  // (Re t, Im t, ds, -)

out vec4 fragColor;

void main() {
  ivec2 uv = ivec2(gl_FragCoord.xy);
  vec4 site = texelFetch(uSiteGeometry, uv, 0);
  vec4 transmission = texelFetch(uSiteTransmission, uv, 0);

  // Padding entries carry a zero transmission, so they contribute nothing.
  vec2 incident = sumField(site.xy);
  fragColor = vec4(cmul(transmission.xy, incident) * transmission.z, 0.0, 1.0);
}
`;

const FIELD_FRAGMENT_SHADER = `#version 300 es
${SUMMATION_GLSL}

uniform vec2 uGridOrigin;
uniform vec2 uGridStep;
uniform sampler2D uLowerLut;
uniform sampler2D uUpperLut;
uniform vec4 uLowerRange;   // (yMin, yMax, z below yMin, z above yMax)
uniform vec4 uUpperRange;
uniform int uHasLower;
uniform int uHasUpper;
// +1 when light travels towards +x, -1 when it travels the other way. Every
// subspace test is the same comparison with this factor on both sides.
uniform float uAxisSign;

out vec4 fragColor;

// Where an interface sits at a given transverse position. Past the ends it
// holds the axial position of the nearer end, which is what makes a short
// interface behave as an opaque screen continuing to the edges of the view.
float boundaryZ(sampler2D lut, vec4 range, float y) {
  if (y <= range.x) return range.z;
  if (y >= range.y) return range.w;
  float t = (y - range.x) / (range.y - range.x);
  float u = mix(0.5 / ${BOUNDARY_LUT_WIDTH}.0, (${BOUNDARY_LUT_WIDTH}.0 - 0.5) / ${BOUNDARY_LUT_WIDTH}.0, t);
  return texture(lut, vec2(u, 0.5)).r;
}

void main() {
  // uGridStep.y is negative: framebuffer row 0 is the bottom of the screen,
  // which is the largest scene y.
  vec2 p = uGridOrigin + uGridStep * (gl_FragCoord.xy - 0.5);

  float axial = uAxisSign * p.x;
  if (uHasLower == 1 && axial < uAxisSign * boundaryZ(uLowerLut, uLowerRange, p.y)) discard;
  if (uHasUpper == 1 && axial >= uAxisSign * boundaryZ(uUpperLut, uUpperRange, p.y)) discard;

  vec2 total = sumField(p);
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
uniform int uView;          // 0 = intensity, 1 = field, 2 = amplitude/phase
uniform float uScale;       // reference amplitude the colour scale saturates at
uniform float uLowerCutoff; // intensity floor, as a fraction of full scale
uniform float uPhase;       // w t
uniform int uLogScale;
uniform float uDynamicRange; // decibels, when uLogScale is set
uniform float uChroma;       // peak chroma of the amplitude/phase view

out vec4 fragColor;

const float LN10 = 2.302585092994046;

${buildOklchGlsl()}

// Sample the colormap at texel centres so the ends are not half-clipped.
vec3 applyColormap(float t) {
  float u = mix(0.5 / ${COLORMAP_SIZE}.0, (${COLORMAP_SIZE}.0 - 0.5) / ${COLORMAP_SIZE}.0, clamp(t, 0.0, 1.0));
  return texture(uColormap, vec2(u, 0.5)).rgb;
}

void main() {
  vec4 fieldSample = texture(uField, gl_FragCoord.xy / uResolution);
  float scale = max(uScale, 1e-30);

  if (uView == 2) {
    // Amplitude and phase at once: |U| drives lightness, arg(U) becomes hue.
    // The time factor e^{-i w t} rotates the phase, so Play turns this into a
    // travelling-wave animation that still shows the amplitude envelope.
    float amplitude = clamp(fieldSample.z / scale, 0.0, 1.0);
    float phase = atan(fieldSample.y, fieldSample.x) - uPhase;
    fragColor = vec4(amplitudePhaseColor(amplitude, phase, uChroma), 1.0);
    return;
  }

  float t;

  if (uView == 1) {
    // Re{ U e^{-i w t} }, mapped symmetrically about the middle of the map.
    float value = fieldSample.x * cos(uPhase) + fieldSample.y * sin(uPhase);
    t = 0.5 + 0.5 * clamp(value / scale, -1.0, 1.0);
  } else {
    // fieldSample.z is |U|, interpolated directly rather than recomputed from
    // the interpolated Re/Im, which would ripple at the grid pitch.
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
 * Look up several uniform locations at once.
 * @param {WebGL2RenderingContext} gl
 * @param {WebGLProgram} program
 * @param {string[]} names
 * @returns {Object<string, WebGLUniformLocation>}
 */
function collectUniforms(gl, program, names) {
  const uniforms = {};
  for (const name of names) uniforms[name] = gl.getUniformLocation(program, name);
  return uniforms;
}

const SUMMATION_UNIFORMS = [
  'uDirGeometry', 'uDirWeights', 'uIsoGeometry', 'uIsoWeights',
  'uPlaneGeometry', 'uPlaneWeights',
  'uDirCount', 'uDirWidth', 'uIsoCount', 'uIsoWidth',
  'uPlaneCount', 'uPlaneWidth',
  'uWavenumber', 'uMinRadius',
];

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

    this.chainProgram = linkProgram(gl, CHAIN_FRAGMENT_SHADER);
    this.fieldProgram = linkProgram(gl, FIELD_FRAGMENT_SHADER);
    this.displayProgram = linkProgram(gl, DISPLAY_FRAGMENT_SHADER);

    this.chainUniforms = collectUniforms(gl, this.chainProgram, [
      ...SUMMATION_UNIFORMS, 'uSiteGeometry', 'uSiteTransmission',
    ]);
    this.fieldUniforms = collectUniforms(gl, this.fieldProgram, [
      ...SUMMATION_UNIFORMS, 'uGridOrigin', 'uGridStep',
      'uLowerLut', 'uUpperLut', 'uLowerRange', 'uUpperRange',
      'uHasLower', 'uHasUpper', 'uAxisSign',
    ]);
    this.displayUniforms = collectUniforms(gl, this.displayProgram, [
      'uField', 'uColormap', 'uResolution', 'uView', 'uScale',
      'uLowerCutoff', 'uPhase', 'uLogScale', 'uDynamicRange', 'uChroma',
    ]);

    // WebGL requires a bound vertex array even when the shader uses gl_VertexID.
    this.vertexArray = gl.createVertexArray();

    this.fieldTexture = gl.createTexture();
    this.framebuffer = gl.createFramebuffer();
    this.colormapTextures = new Map();

    /** Per-subspace source tables, grown as scenes need them. */
    this.subspaceTables = [];
    /** Per-interface boundary lookup tables. */
    this.boundaryLuts = [];

    this.fieldWidth = 0;
    this.fieldHeight = 0;
    this.readbackBuffer = null;

    /** @property {Object|null} lastStats - Amplitude statistics of the last computed field. */
    this.lastStats = null;
  }

  /**
   * The table set for one subspace, created on first use.
   * @param {number} index
   * @returns {Object}
   * @private
   */
  tablesFor(index) {
    while (this.subspaceTables.length <= index) {
      const gl = this.gl;
      this.subspaceTables.push({
        siteGeometry: new FloatTable(gl),
        siteTransmission: new FloatTable(gl),
        // The chain pass renders into this one.
        siteWeights: new FloatTable(gl, true),
        primaryGeometry: new FloatTable(gl),
        primaryWeights: new FloatTable(gl),
        planeGeometry: new FloatTable(gl),
        planeWeights: new FloatTable(gl),
      });
    }
    return this.subspaceTables[index];
  }

  /**
   * The lookup table for one interface, created on first use.
   * @param {number} index
   * @returns {BoundaryLut}
   * @private
   */
  boundaryLutFor(index) {
    while (this.boundaryLuts.length <= index) {
      this.boundaryLuts.push(new BoundaryLut(this.gl, this.hasLinearFloat));
    }
    return this.boundaryLuts[index];
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
   * Upload one subspace's sources.
   * @param {number} index
   * @param {Object} subspace
   * @private
   */
  uploadSubspace(index, subspace) {
    const tables = this.tablesFor(index);
    const sites = subspace.surfaceSamples;
    const primaries = subspace.primaries;

    tables.siteGeometry.fill(sites.length, (i, buffer, at) => {
      buffer[at] = sites[i].x;
      buffer[at + 1] = sites[i].y;
      buffer[at + 2] = sites[i].nx;
      buffer[at + 3] = sites[i].ny;
    });
    tables.siteTransmission.fill(sites.length, (i, buffer, at) => {
      buffer[at] = sites[i].tRe;
      buffer[at + 1] = sites[i].tIm;
      buffer[at + 2] = sites[i].ds;
    });
    tables.siteWeights.allocate(sites.length);

    tables.primaryGeometry.fill(primaries.length, (i, buffer, at) => {
      buffer[at] = primaries[i].x;
      buffer[at + 1] = primaries[i].y;
    });
    tables.primaryWeights.fill(primaries.length, (i, buffer, at) => {
      buffer[at] = primaries[i].re;
      buffer[at + 1] = primaries[i].im;
    });

    const planeWaves = subspace.planeWaves ?? [];
    tables.planeGeometry.fill(planeWaves.length, (i, buffer, at) => {
      buffer[at] = planeWaves[i].dirX;
      buffer[at + 1] = planeWaves[i].dirY;
      buffer[at + 2] = planeWaves[i].x;
      buffer[at + 3] = planeWaves[i].y;
    });
    tables.planeWeights.fill(planeWaves.length, (i, buffer, at) => {
      buffer[at] = planeWaves[i].re;
      buffer[at + 1] = planeWaves[i].im;
    });
  }

  /**
   * Bind one subspace's tables as the sources to sum over.
   * @param {Object} uniforms
   * @param {number} index
   * @param {number} wavelength
   * @param {number} refractiveIndex
   * @private
   */
  bindSources(uniforms, index, wavelength, refractiveIndex) {
    const gl = this.gl;
    const tables = this.tablesFor(index);

    const bind = (unit, table, location) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, table.texture);
      gl.uniform1i(location, unit);
    };
    bind(UNIT_DIRECTIONAL_GEOMETRY, tables.siteGeometry, uniforms.uDirGeometry);
    bind(UNIT_DIRECTIONAL_WEIGHTS, tables.siteWeights, uniforms.uDirWeights);
    bind(UNIT_ISOTROPIC_GEOMETRY, tables.primaryGeometry, uniforms.uIsoGeometry);
    bind(UNIT_ISOTROPIC_WEIGHTS, tables.primaryWeights, uniforms.uIsoWeights);
    bind(UNIT_PLANE_GEOMETRY, tables.planeGeometry, uniforms.uPlaneGeometry);
    bind(UNIT_PLANE_WEIGHTS, tables.planeWeights, uniforms.uPlaneWeights);

    gl.uniform1i(uniforms.uDirCount, tables.siteGeometry.count);
    gl.uniform1i(uniforms.uDirWidth, tables.siteGeometry.width);
    gl.uniform1i(uniforms.uIsoCount, tables.primaryGeometry.count);
    gl.uniform1i(uniforms.uIsoWidth, tables.primaryGeometry.width);
    gl.uniform1i(uniforms.uPlaneCount, tables.planeGeometry.count);
    gl.uniform1i(uniforms.uPlaneWidth, tables.planeGeometry.width);
    gl.uniform1f(uniforms.uWavenumber, wavenumber(wavelength, refractiveIndex));
    gl.uniform1f(uniforms.uMinRadius, minimumRadius(wavelength, refractiveIndex));
  }

  /**
   * Run the whole computation: the propagation chain, then the field.
   *
   * @param {Object} model - As built by `buildWaveModel`.
   */
  computeField(model) {
    const gl = this.gl;
    const { subspaces, interfaces, grid, settings } = model;

    this.resizeField(grid.width, grid.height);
    for (let j = 0; j < subspaces.length; j++) this.uploadSubspace(j, subspaces[j]);
    for (let i = 0; i < interfaces.length; i++) {
      this.boundaryLutFor(i).update(interfaces[i]);
    }

    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.bindVertexArray(this.vertexArray);

    this.runChainPasses(model);
    this.runFieldPasses(model);

    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    // Block until the GPU has actually finished. Draw calls only queue work, so
    // without this the caller would time the submission rather than the
    // computation, and the resolution ladder would conclude that every grid is
    // free and climb to the top whatever the machine can do.
    gl.finish();

    this.lastStats = null;
  }

  /**
   * Carry the field across each interface in turn.
   * @param {Object} model
   * @private
   */
  runChainPasses({ subspaces, settings }) {
    const gl = this.gl;
    gl.useProgram(this.chainProgram);

    for (let j = 1; j < subspaces.length; j++) {
      const tables = this.tablesFor(j);
      if (tables.siteGeometry.count === 0) continue;

      // Sum over the subspace before this interface, in its medium.
      this.bindSources(
        this.chainUniforms, j - 1, settings.wavelength, subspaces[j - 1].refractiveIndex
      );

      gl.activeTexture(gl.TEXTURE0 + UNIT_EXTRA_A);
      gl.bindTexture(gl.TEXTURE_2D, tables.siteGeometry.texture);
      gl.uniform1i(this.chainUniforms.uSiteGeometry, UNIT_EXTRA_A);
      gl.activeTexture(gl.TEXTURE0 + UNIT_EXTRA_B);
      gl.bindTexture(gl.TEXTURE_2D, tables.siteTransmission.texture);
      gl.uniform1i(this.chainUniforms.uSiteTransmission, UNIT_EXTRA_B);

      gl.bindFramebuffer(gl.FRAMEBUFFER, tables.siteWeights.framebuffer);
      gl.viewport(0, 0, tables.siteWeights.width, tables.siteWeights.height);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
  }

  /**
   * Draw each subspace's field into the shared float texture.
   * @param {Object} model
   * @private
   */
  runFieldPasses({ subspaces, interfaces, grid, settings }) {
    const gl = this.gl;

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.viewport(0, 0, grid.width, grid.height);
    // Any pixel no subspace claims stays zero, which is the honest result for a
    // scene whose interfaces cross and so have no consistent ordering.
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(this.fieldProgram);
    gl.uniform2f(this.fieldUniforms.uGridOrigin, grid.originX, grid.originY);
    gl.uniform2f(this.fieldUniforms.uGridStep, grid.stepX, grid.stepY);
    gl.uniform1f(this.fieldUniforms.uAxisSign, settings.axisSign ?? 1);

    for (let j = 0; j < subspaces.length; j++) {
      this.bindSources(
        this.fieldUniforms, j, settings.wavelength, subspaces[j].refractiveIndex
      );
      this.bindBoundary(UNIT_EXTRA_A, j - 1, interfaces, 'uLowerLut', 'uLowerRange', 'uHasLower');
      this.bindBoundary(UNIT_EXTRA_B, j, interfaces, 'uUpperLut', 'uUpperRange', 'uHasUpper');
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
  }

  /**
   * Bind one of the two interfaces bounding the subspace being drawn.
   * @private
   */
  bindBoundary(unit, interfaceIndex, interfaces, lutName, rangeName, flagName) {
    const gl = this.gl;
    const present = interfaceIndex >= 0 && interfaceIndex < interfaces.length;
    gl.uniform1i(this.fieldUniforms[flagName], present ? 1 : 0);

    // A sampler must still be bound to something valid even when unused.
    const lut = this.boundaryLutFor(Math.max(0, Math.min(
      interfaceIndex, Math.max(0, interfaces.length - 1)
    )));
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, lut.texture);
    gl.uniform1i(this.fieldUniforms[lutName], unit);
    if (present) gl.uniform4fv(this.fieldUniforms[rangeName], lut.range);
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
  /**
   * Bring the computed field back from the GPU.
   *
   * Four floats per sample, in the field pass's layout: real part, imaginary
   * part, `|U|`, and a one. Rows run bottom to top, matching the grid built by
   * {@link computeFieldGrid}.
   *
   * This is the only way anything outside the shaders can look at the field, so
   * it is what the colour-scale statistics and the measurement objects both go
   * through. It is also not cheap — a full framebuffer transfer that stalls the
   * pipeline — so it is done once per change rather than per frame.
   *
   * @returns {Float32Array|null}
   */
  readField() {
    const gl = this.gl;
    const count = this.fieldWidth * this.fieldHeight;
    if (count === 0) return null;

    if (!this.readbackBuffer || this.readbackBuffer.length < count * 4) {
      this.readbackBuffer = new Float32Array(count * 4);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.readPixels(
      0, 0, this.fieldWidth, this.fieldHeight, gl.RGBA, gl.FLOAT, this.readbackBuffer
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return this.readbackBuffer;
  }

  readFieldStats(percentile = 99) {
    const count = this.fieldWidth * this.fieldHeight;
    if (count === 0) {
      return { referenceAmplitude: 0, maxAmplitude: 0, sampleCount: 0 };
    }

    this.readField();

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
      count - 1, Math.max(0, Math.round((percentile / 100) * (count - 1)))
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
   * @param {string} options.view - 'intensity', 'field' or 'amplitudePhase'.
   * @param {string} options.colormap - Colormap identifier; unused by the
   *   amplitude-phase view, which has its own fixed bivariate mapping.
   * @param {number} options.referenceAmplitude - Amplitude the scale saturates at.
   * @param {number} [options.upperCutoff=1] - Multiplies the reference amplitude.
   * @param {number} [options.lowerCutoff=0] - Intensity floor, as a fraction of full scale.
   * @param {number} [options.phase=0] - The quantity `w t`.
   * @param {boolean} [options.logScale=false]
   * @param {number} [options.dynamicRange=40] - Decibels shown when `logScale` is set.
   * @param {number} [options.chroma] - Peak chroma of the amplitude-phase view.
   */
  render({
    view, colormap, referenceAmplitude, upperCutoff = 1, lowerCutoff = 0,
    phase = 0, logScale = false, dynamicRange = 40, chroma = DEFAULT_PHASE_CHROMA,
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

    const viewIndex = view === 'field' ? 1 : (view === 'amplitudePhase' ? 2 : 0);
    gl.uniform2f(this.displayUniforms.uResolution, canvas.width, canvas.height);
    gl.uniform1i(this.displayUniforms.uView, viewIndex);
    gl.uniform1f(this.displayUniforms.uChroma, chroma);
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
    gl.deleteProgram(this.chainProgram);
    gl.deleteProgram(this.fieldProgram);
    gl.deleteProgram(this.displayProgram);
    gl.deleteTexture(this.fieldTexture);
    gl.deleteFramebuffer(this.framebuffer);
    gl.deleteVertexArray(this.vertexArray);
    for (const tables of this.subspaceTables) {
      for (const table of Object.values(tables)) table.destroy();
    }
    this.subspaceTables = [];
    for (const lut of this.boundaryLuts) lut.destroy();
    this.boundaryLuts = [];
    for (const texture of this.colormapTextures.values()) gl.deleteTexture(texture);
    this.colormapTextures.clear();
  }
}

export default WaveFieldEngineWebGL2;
