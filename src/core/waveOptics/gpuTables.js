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
 * @file Small helpers for the float textures the wave renderer indexes with
 * `texelFetch`: tables of sources, and one-dimensional lookup tables.
 */

/** Table rows wrap at this width; the shader is told the width it must use. */
export const TABLE_WIDTH = 1024;

/** Samples in each interface's z(y) lookup table. */
export const BOUNDARY_LUT_WIDTH = 1024;

/**
 * The texture dimensions holding `count` entries, one texel each.
 * @param {number} count
 * @returns {{width: number, height: number}}
 */
export function tableShape(count) {
  const entries = Math.max(1, count);
  const width = Math.min(entries, TABLE_WIDTH);
  return { width, height: Math.ceil(entries / width) };
}

/**
 * An RGBA32F texture used as an indexable table of four-float records.
 *
 * It can be uploaded from the CPU or rendered into, which is what lets the
 * propagation chain write one interface's secondary-source weights directly
 * into the table the next pass reads.
 * @class
 */
export class FloatTable {
  /**
   * @param {WebGL2RenderingContext} gl
   * @param {boolean} [renderable=false] - Whether it needs a framebuffer.
   */
  constructor(gl, renderable = false) {
    this.gl = gl;
    this.texture = gl.createTexture();
    this.framebuffer = renderable ? gl.createFramebuffer() : null;
    this.width = 0;
    this.height = 0;
    this.count = 0;
    this.buffer = null;
  }

  /**
   * Make sure the texture can hold `count` entries.
   * @param {number} count
   */
  allocate(count) {
    const gl = this.gl;
    const { width, height } = tableShape(count);
    this.count = count;

    if (this.width === width && this.height === height) return;
    this.width = width;
    this.height = height;

    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, width, height, 0, gl.RGBA, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.buffer = null;

    if (this.framebuffer) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texture, 0
      );
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
  }

  /**
   * Fill the table from records.
   *
   * Entries past `count` are zeroed rather than left stale. That matters for
   * the interface tables: the chain pass runs over the whole texture, and a
   * zeroed transmission makes the padding contribute nothing.
   *
   * @param {number} count
   * @param {function(number, Float32Array, number): void} write - Called per
   *   entry with the index, the buffer and the offset to write four floats at.
   */
  fill(count, write) {
    this.allocate(count);
    const needed = this.width * this.height * 4;
    if (!this.buffer || this.buffer.length !== needed) {
      this.buffer = new Float32Array(needed);
    }
    this.buffer.fill(0);
    for (let i = 0; i < count; i++) write(i, this.buffer, i * 4);

    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texSubImage2D(
      gl.TEXTURE_2D, 0, 0, 0, this.width, this.height, gl.RGBA, gl.FLOAT, this.buffer, 0
    );
  }

  /** Release the GL objects. */
  destroy() {
    this.gl.deleteTexture(this.texture);
    if (this.framebuffer) this.gl.deleteFramebuffer(this.framebuffer);
  }
}

/**
 * A one-dimensional R32F lookup table of an interface's `z(y)`.
 *
 * Sampling it with linear filtering gives the field pass a smooth boundary to
 * compare against, at one texture lookup per interface per pixel.
 * @class
 */
export class BoundaryLut {
  /**
   * @param {WebGL2RenderingContext} gl
   * @param {boolean} linearFiltering - Whether float textures can be filtered.
   */
  constructor(gl, linearFiltering) {
    this.gl = gl;
    this.texture = gl.createTexture();
    this.linearFiltering = linearFiltering;
    this.buffer = new Float32Array(BOUNDARY_LUT_WIDTH);
    this.allocated = false;
    /** @property {number[]} range - `(yMin, yMax, zAtYMin, zAtYMax)`. */
    this.range = [0, 0, 0, 0];
  }

  /**
   * Rasterise an interface's profile into the table.
   * @param {Object} surface - A `WaveInterface`.
   */
  update(surface) {
    const gl = this.gl;
    const extent = surface.getExtent();
    const span = extent.yMax - extent.yMin;

    for (let i = 0; i < BOUNDARY_LUT_WIDTH; i++) {
      const y = extent.yMin + span * (i + 0.5) / BOUNDARY_LUT_WIDTH;
      this.buffer[i] = surface.zAt(y);
    }
    this.range = [extent.yMin, extent.yMax, extent.zAtYMin, extent.zAtYMax];

    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    if (!this.allocated) {
      gl.texImage2D(
        gl.TEXTURE_2D, 0, gl.R32F, BOUNDARY_LUT_WIDTH, 1, 0, gl.RED, gl.FLOAT, null
      );
      const filter = this.linearFiltering ? gl.LINEAR : gl.NEAREST;
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.allocated = true;
    }
    gl.texSubImage2D(
      gl.TEXTURE_2D, 0, 0, 0, BOUNDARY_LUT_WIDTH, 1, gl.RED, gl.FLOAT, this.buffer, 0
    );
  }

  /** Release the GL objects. */
  destroy() {
    this.gl.deleteTexture(this.texture);
  }
}
