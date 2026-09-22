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
 * @file The bivariate colour mapping for the amplitude-phase view, in Oklch.
 *
 * Phase becomes hue and amplitude drives lightness and chroma together. Driving
 * both matters: sRGB cannot hold much chroma near black or near white, so a
 * mapping that varied only lightness would either clip at the ends or have to
 * stay dull throughout. Tying chroma to an envelope that vanishes at both ends
 * follows the shape of the gamut, and the remaining excursions are handled by
 * the gamut search below.
 *
 * Oklch is used in place of CIE LCh for its better perceptual uniformity and
 * because its gamut boundary is smooth enough for a short binary search.
 *
 * As with {@link hankel.js}, the matrices here are the single source of truth:
 * the GLSL the display pass uses is generated from the same numbers.
 *
 * Conversion matrices from Björn Ottosson, "A perceptual color space for image
 * processing" (https://bottosson.github.io/posts/oklab/).
 */

/** Linear sRGB to the LMS cone responses. */
const LMS_FROM_LINEAR_SRGB = [
  [0.4122214708, 0.5363325363, 0.0514459929],
  [0.2119034982, 0.6806995451, 0.1073969566],
  [0.0883024619, 0.2817188376, 0.6299787005],
];

/** The cube roots of the LMS cone responses to Oklab. */
const OKLAB_FROM_LMS = [
  [0.2104542553, 0.7936177850, -0.0040720468],
  [1.9779984951, -2.4285922050, 0.4505937099],
  [0.0259040371, 0.7827717662, -0.8086757660],
];

/** Oklab to the cube roots of the LMS cone responses. */
const LMS_FROM_OKLAB = [
  [1, 0.3963377774, 0.2158037573],
  [1, -0.1055613458, -0.0638541728],
  [1, -0.0894841775, -1.2914855480],
];

/** LMS cone responses to linear sRGB. */
const LINEAR_SRGB_FROM_LMS = [
  [4.0767416621, -3.3077115913, 0.2309699292],
  [-1.2684380046, 2.6097574011, -0.3413193965],
  [-0.0041960863, -0.7034186147, 1.7076147010],
];

/** Iterations of the gamut binary search; 8 resolves chroma to better than 1/255. */
export const GAMUT_SEARCH_ITERATIONS = 8;

/** Default chroma strength for the amplitude-phase view. */
export const DEFAULT_PHASE_CHROMA = 0.18;

/**
 * Convert Oklab to linear sRGB. The result may fall outside [0, 1].
 * @param {number} L - Lightness, nominally 0 to 1.
 * @param {number} a - Green-red axis.
 * @param {number} b - Blue-yellow axis.
 * @returns {number[]} `[r, g, b]` in linear light.
 */
export function oklabToLinearSrgb(L, a, b) {
  const lms = LMS_FROM_OKLAB.map(([c0, c1, c2]) => {
    const root = c0 * L + c1 * a + c2 * b;
    return root * root * root;
  });
  return LINEAR_SRGB_FROM_LMS.map(
    ([c0, c1, c2]) => c0 * lms[0] + c1 * lms[1] + c2 * lms[2]
  );
}

/**
 * Convert linear sRGB to Oklab. The inverse of {@link oklabToLinearSrgb}.
 * @param {number[]} linear - `[r, g, b]` in linear light.
 * @returns {number[]} `[L, a, b]`.
 */
export function linearSrgbToOklab(linear) {
  const lms = LMS_FROM_LINEAR_SRGB.map(
    ([c0, c1, c2]) => Math.cbrt(c0 * linear[0] + c1 * linear[1] + c2 * linear[2])
  );
  return OKLAB_FROM_LMS.map(
    ([c0, c1, c2]) => c0 * lms[0] + c1 * lms[1] + c2 * lms[2]
  );
}

/**
 * The inverse sRGB transfer function, encoded value to linear light.
 * @param {number} value
 * @returns {number}
 */
export function srgbToLinear(value) {
  return value <= 0.04045
    ? value / 12.92
    : Math.pow((value + 0.055) / 1.055, 2.4);
}

/**
 * Convert an sRGB triple to Oklch.
 * @param {number[]} rgb - `[r, g, b]` in 0..1, sRGB encoded.
 * @returns {{L: number, chroma: number, hue: number}}
 */
export function srgbToOklch(rgb) {
  const [L, a, b] = linearSrgbToOklab(rgb.map(srgbToLinear));
  return { L, chroma: Math.hypot(a, b), hue: Math.atan2(b, a) };
}

/**
 * The sRGB transfer function, linear light to encoded value.
 * @param {number} value
 * @returns {number}
 */
export function linearToSrgb(value) {
  const clamped = Math.min(1, Math.max(0, value));
  return clamped <= 0.0031308
    ? clamped * 12.92
    : 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055;
}

/**
 * Whether a linear sRGB triple is representable, with a small tolerance for
 * the rounding in the conversion matrices.
 * @param {number[]} linear
 * @returns {boolean}
 */
export function isInGamut(linear) {
  return linear.every((channel) => channel >= -1e-4 && channel <= 1 + 1e-4);
}

/**
 * Convert Oklch to sRGB, reducing chroma until the colour is representable.
 *
 * Lightness and hue are preserved exactly; only chroma gives way. That keeps
 * the amplitude and phase readings faithful even where the requested chroma is
 * unavailable.
 *
 * @param {number} L - Lightness, 0 to 1.
 * @param {number} chroma - Requested chroma.
 * @param {number} hue - Hue angle in radians.
 * @returns {number[]} `[r, g, b]` in 0..1, sRGB encoded.
 */
export function oklchToSrgb(L, chroma, hue) {
  const cos = Math.cos(hue);
  const sin = Math.sin(hue);
  const at = (scale) => oklabToLinearSrgb(L, chroma * scale * cos, chroma * scale * sin);

  let linear = at(1);
  if (!isInGamut(linear)) {
    // Chroma zero is always in gamut for L in [0, 1], so this always converges.
    let low = 0;
    let high = 1;
    for (let i = 0; i < GAMUT_SEARCH_ITERATIONS; i++) {
      const mid = (low + high) / 2;
      if (isInGamut(at(mid))) low = mid; else high = mid;
    }
    linear = at(low);
  }
  return linear.map(linearToSrgb);
}

/**
 * The amplitude-phase mapping.
 *
 * @param {number} amplitude - Normalised amplitude, clamped to [0, 1].
 * @param {number} phase - Phase in radians; becomes hue.
 * @param {number} [chroma] - Peak chroma.
 * @returns {number[]} `[r, g, b]` in 0..1, sRGB encoded.
 */
export function amplitudePhaseColor(amplitude, phase, chroma = DEFAULT_PHASE_CHROMA) {
  const t = Math.min(1, Math.max(0, amplitude));
  // Lightness carries the amplitude; chroma follows an envelope that vanishes
  // at both ends, where sRGB has no room for it. Zero amplitude is therefore
  // black and full amplitude white, with the most colourful band in between.
  return oklchToSrgb(t, chroma * Math.sin(Math.PI * t), phase);
}

/**
 * A CSS conic gradient showing the hue for each phase, for the legend wheel.
 *
 * Phase zero points right and increases anticlockwise, the usual convention for
 * an angle. CSS conic gradients start at the top and run clockwise, so the
 * angles are mapped accordingly.
 *
 * @param {number} [chroma] - Peak chroma, matching the rendered view.
 * @param {number} [amplitude=0.65] - Where on the amplitude axis to sample.
 * @param {number} [steps=36]
 * @returns {string} A CSS `conic-gradient(...)` value.
 */
export function phaseWheelCssGradient(
  chroma = DEFAULT_PHASE_CHROMA, amplitude = 0.65, steps = 36
) {
  const parts = [];
  for (let i = 0; i <= steps; i++) {
    const cssDegrees = (i / steps) * 360;
    const phase = (90 - cssDegrees) * Math.PI / 180;
    const [r, g, b] = amplitudePhaseColor(amplitude, phase, chroma);
    parts.push(
      `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)}) ${cssDegrees.toFixed(1)}deg`
    );
  }
  return `conic-gradient(${parts.join(', ')})`;
}

// --- GLSL generation ------------------------------------------------------

function glslFloat(value) {
  const text = String(value);
  return /[.e]/.test(text) ? text : text + '.0';
}

function glslMatrixRow(row) {
  return row.map(glslFloat).join(', ');
}

/**
 * Build the GLSL implementation of the amplitude-phase mapping from the same
 * matrices and the same envelope used above.
 * @returns {string} GLSL ES 3.00 source defining `amplitudePhaseColor`.
 */
export function buildOklchGlsl() {
  return `
// Generated from the Oklab matrices in oklch.js.
vec3 oklabToLinearSrgb(float L, float a, float b) {
  vec3 root = vec3(
    ${glslMatrixRow(LMS_FROM_OKLAB[0])}
  ) * vec3(L, a, b);
  vec3 root2 = vec3(
    ${glslMatrixRow(LMS_FROM_OKLAB[1])}
  ) * vec3(L, a, b);
  vec3 root3 = vec3(
    ${glslMatrixRow(LMS_FROM_OKLAB[2])}
  ) * vec3(L, a, b);
  vec3 lms = vec3(
    root.x + root.y + root.z,
    root2.x + root2.y + root2.z,
    root3.x + root3.y + root3.z
  );
  lms = lms * lms * lms;
  return vec3(
    dot(vec3(${glslMatrixRow(LINEAR_SRGB_FROM_LMS[0])}), lms),
    dot(vec3(${glslMatrixRow(LINEAR_SRGB_FROM_LMS[1])}), lms),
    dot(vec3(${glslMatrixRow(LINEAR_SRGB_FROM_LMS[2])}), lms)
  );
}

bool oklabInGamut(vec3 linear) {
  return all(greaterThanEqual(linear, vec3(-1e-4))) &&
         all(lessThanEqual(linear, vec3(1.0 + 1e-4)));
}

vec3 linearToSrgb(vec3 linear) {
  vec3 c = clamp(linear, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055,
             step(vec3(0.0031308), c));
}

// Phase becomes hue; amplitude drives lightness, with chroma following an
// envelope that vanishes where sRGB has no room for it. Chroma is then reduced
// until the colour is representable, so lightness and hue stay exact.
vec3 amplitudePhaseColor(float amplitude, float phase, float chroma) {
  float t = clamp(amplitude, 0.0, 1.0);
  float c = chroma * sin(3.14159265358979 * t);
  float cosHue = cos(phase);
  float sinHue = sin(phase);

  vec3 linear = oklabToLinearSrgb(t, c * cosHue, c * sinHue);
  if (!oklabInGamut(linear)) {
    float low = 0.0;
    float high = 1.0;
    for (int i = 0; i < ${GAMUT_SEARCH_ITERATIONS}; i++) {
      float mid = 0.5 * (low + high);
      if (oklabInGamut(oklabToLinearSrgb(t, c * mid * cosHue, c * mid * sinHue))) {
        low = mid;
      } else {
        high = mid;
      }
    }
    linear = oklabToLinearSrgb(t, c * low * cosHue, c * low * sinHue);
  }
  return linearToSrgb(linear);
}
`;
}
