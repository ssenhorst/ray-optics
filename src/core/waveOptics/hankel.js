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
 * @file Hankel functions of the first kind, `H0(x) = J0(x) + i Y0(x)` and
 * `H1(x) = J1(x) + i Y1(x)`, which are the 2D free-space Green's function and
 * its radial derivative.
 *
 * The approximations are the classic polynomial ones from Abramowitz & Stegun,
 * *Handbook of Mathematical Functions*, section 9.4, accurate to better than
 * 2e-7 everywhere. The coefficient tables below are the single source of truth:
 * the GLSL used by the GPU backend is generated from the very same arrays by
 * {@link buildHankelGlsl}, so the shader and the JS reference implementation
 * cannot drift apart.
 *
 * Conventions: the time dependence is `e^{-i w t}`, so an outgoing wave carries
 * `e^{+ikr}` and the outgoing Green's function is `(i/4) H0(kr)`.
 */

// --- Abramowitz & Stegun section 9.4 coefficients -------------------------
// The "small" tables are polynomials in u = t^2 with t = x/3 (|x| <= 3).
// The "large" tables are polynomials in t = 3/x (x >= 3).

/** 9.4.1: J0(x) for |x| <= 3. Error < 5e-8. */
const J0_SMALL = [1, -2.2499997, 1.2656208, -0.3163866, 0.0444479, -0.0039444, 0.0002100];

/** 9.4.3: Y0(x) for 0 < x <= 3, excluding the (2/pi) ln(x/2) J0(x) term. Error < 1.4e-8. */
const Y0_SMALL = [0.36746691, 0.60559366, -0.74350384, 0.25300117, -0.04261214, 0.00427916, -0.00024846];

/** 9.4.2: modulus f0 for x >= 3, where J0 = x^-0.5 f0 cos(theta0). Error < 1.6e-8. */
const F0_LARGE = [0.79788456, -0.00000077, -0.00552740, -0.00009512, 0.00137237, -0.00072805, 0.00014476];

/** 9.4.2: phase offset of theta0 for x >= 3, i.e. theta0 = x + poly(3/x). Error < 7e-8. */
const T0_LARGE = [-0.78539816, -0.04166397, -0.00003954, 0.00262573, -0.00054125, -0.00029333, 0.00013558];

/** 9.4.4: J1(x)/x for |x| <= 3. Error < 1.3e-8. */
const J1_SMALL = [0.5, -0.56249985, 0.21093573, -0.03954289, 0.00443319, -0.00031761, 0.00001109];

/** 9.4.6: x Y1(x) for 0 < x <= 3, excluding the (2/pi) x ln(x/2) J1(x) term. Error < 1.1e-7. */
const Y1_SMALL = [-0.6366198, 0.2212091, 2.1682709, -1.3164827, 0.3123951, -0.0400976, 0.0027873];

/** 9.4.5: modulus f1 for x >= 3, where J1 = x^-0.5 f1 cos(theta1). Error < 4e-8. */
const F1_LARGE = [0.79788456, 0.00000156, 0.01659667, 0.00017105, -0.00249511, 0.00113653, -0.00020033];

/** 9.4.5: phase offset of theta1 for x >= 3, i.e. theta1 = x + poly(3/x). Error < 9e-8. */
const T1_LARGE = [-2.35619449, 0.12499612, 0.00005650, -0.00637879, 0.00074348, 0.00079824, -0.00029166];

/** The argument at which the two branches of each approximation meet. */
export const HANKEL_BRANCH_X = 3;

const TWO_OVER_PI = 2 / Math.PI;
const TWO_PI = Math.PI * 2;

/**
 * Evaluate a polynomial by Horner's method.
 * @param {number[]} coeffs - Coefficients in increasing order of power.
 * @param {number} v - The variable.
 * @returns {number}
 */
function poly(coeffs, v) {
  let sum = coeffs[coeffs.length - 1];
  for (let i = coeffs.length - 2; i >= 0; i--) {
    sum = sum * v + coeffs[i];
  }
  return sum;
}

/**
 * Bessel function of the first kind, order 0.
 * @param {number} x - The argument, must be positive.
 * @returns {number}
 */
export function besselJ0(x) {
  if (x < HANKEL_BRANCH_X) {
    const t = x / 3;
    return poly(J0_SMALL, t * t);
  }
  const t = 3 / x;
  return poly(F0_LARGE, t) * Math.cos(x + poly(T0_LARGE, t)) / Math.sqrt(x);
}

/**
 * Bessel function of the second kind, order 0.
 * @param {number} x - The argument, must be positive.
 * @returns {number}
 */
export function besselY0(x) {
  if (x < HANKEL_BRANCH_X) {
    const t = x / 3;
    return TWO_OVER_PI * Math.log(x / 2) * besselJ0(x) + poly(Y0_SMALL, t * t);
  }
  const t = 3 / x;
  return poly(F0_LARGE, t) * Math.sin(x + poly(T0_LARGE, t)) / Math.sqrt(x);
}

/**
 * Bessel function of the first kind, order 1.
 * @param {number} x - The argument, must be positive.
 * @returns {number}
 */
export function besselJ1(x) {
  if (x < HANKEL_BRANCH_X) {
    const t = x / 3;
    return x * poly(J1_SMALL, t * t);
  }
  const t = 3 / x;
  return poly(F1_LARGE, t) * Math.cos(x + poly(T1_LARGE, t)) / Math.sqrt(x);
}

/**
 * Bessel function of the second kind, order 1.
 * @param {number} x - The argument, must be positive.
 * @returns {number}
 */
export function besselY1(x) {
  if (x < HANKEL_BRANCH_X) {
    const t = x / 3;
    return (TWO_OVER_PI * x * Math.log(x / 2) * besselJ1(x) + poly(Y1_SMALL, t * t)) / x;
  }
  const t = 3 / x;
  return poly(F1_LARGE, t) * Math.sin(x + poly(T1_LARGE, t)) / Math.sqrt(x);
}

/**
 * Hankel function of the first kind, order 0: `H0(x) = J0(x) + i Y0(x)`.
 * @param {number} x - The argument, must be positive.
 * @returns {{re: number, im: number}}
 */
export function hankel0(x) {
  return { re: besselJ0(x), im: besselY0(x) };
}

/**
 * Hankel function of the first kind, order 1: `H1(x) = J1(x) + i Y1(x)`.
 * @param {number} x - The argument, must be positive.
 * @returns {{re: number, im: number}}
 */
export function hankel1(x) {
  return { re: besselJ1(x), im: besselY1(x) };
}

/**
 * The outgoing 2D free-space Green's function `(i/4) H0(kr)`, which is the
 * field of a unit-amplitude point source.
 * @param {number} kr - The argument `k r`, must be positive.
 * @returns {{re: number, im: number}}
 */
export function greensFunction(kr) {
  const h = hankel0(kr);
  // Multiplying by i/4 rotates by a quarter turn and scales: (i/4)(a + ib) = (-b + ia)/4.
  return { re: -h.im / 4, im: h.re / 4 };
}

/**
 * The 2D Rayleigh-Sommerfeld kernel of the first kind,
 * `K = (i k / 2) H1(k r) cos(theta)`, which is what a point on an illuminated
 * surface re-radiates.
 *
 * Its far-field limit is `sqrt(k / 2 pi i) e^{ikr} / sqrt(r) cos(theta)`, the
 * standard 2D Fresnel kernel. That normalisation is what makes a fully
 * transparent, index-matched surface reproduce the incident field exactly
 * instead of rescaling it, provided the caller also weights each sample by the
 * arc length it stands for.
 *
 * `cos(theta)` is clamped at zero: Rayleigh-Sommerfeld assumes the observer is
 * in the forward half space, and without the clamp a point that ends up behind
 * a curved surface would receive a spurious negative contribution.
 *
 * @param {number} kr - The argument `k r`, must be positive.
 * @param {number} cosTheta - The cosine of the angle between the surface
 *   normal and the direction to the observation point.
 * @param {number} k - The wavenumber in the medium being radiated into.
 * @returns {{re: number, im: number}}
 */
export function rayleighSommerfeldKernel(kr, cosTheta, k) {
  const h = hankel1(kr);
  const factor = k * Math.max(cosTheta, 0) / 2;
  // (i/2) k cos(theta) (J1 + i Y1) = (k cos(theta) / 2) (-Y1 + i J1).
  return { re: -factor * h.im, im: factor * h.re };
}

// --- GLSL generation ------------------------------------------------------

/**
 * Format a number as a GLSL float literal (GLSL requires the decimal point).
 * @param {number} value
 * @returns {string}
 */
function glslFloat(value) {
  const text = String(value);
  return /[.e]/.test(text) ? text : text + '.0';
}

/**
 * Emit a Horner-form GLSL expression for a polynomial.
 * @param {number[]} coeffs - Coefficients in increasing order of power.
 * @param {string} variable - The GLSL variable holding the polynomial argument.
 * @returns {string}
 */
function glslPoly(coeffs, variable) {
  let expr = glslFloat(coeffs[coeffs.length - 1]);
  for (let i = coeffs.length - 2; i >= 0; i--) {
    expr = `(${expr} * ${variable} + ${glslFloat(coeffs[i])})`;
  }
  return expr;
}

/**
 * Build the GLSL implementation of the Hankel functions from the same
 * coefficient tables used by the JS implementation above.
 *
 * The large-argument branch reduces the argument modulo 2*pi before taking the
 * sine and cosine. The reduction is exact (the functions are 2*pi periodic) and
 * protects against drivers whose built-in range reduction degrades for large
 * arguments, which is exactly the regime this simulator runs in.
 *
 * @returns {string} GLSL ES 3.00 source defining `hankel0` and `hankel1`,
 *   each returning `vec2(real, imaginary)`.
 */
export function buildHankelGlsl() {
  return `
// Generated from the Abramowitz & Stegun 9.4 tables in hankel.js.
const float HANKEL_BRANCH_X = ${glslFloat(HANKEL_BRANCH_X)};
const float TWO_OVER_PI = ${glslFloat(TWO_OVER_PI)};
const float TWO_PI = ${glslFloat(TWO_PI)};

vec2 hankel0(float x) {
  if (x < HANKEL_BRANCH_X) {
    float t = x / 3.0;
    float u = t * t;
    float j0 = ${glslPoly(J0_SMALL, 'u')};
    float y0 = TWO_OVER_PI * log(x * 0.5) * j0 + ${glslPoly(Y0_SMALL, 'u')};
    return vec2(j0, y0);
  }
  float t = 3.0 / x;
  float theta = mod(x, TWO_PI) + ${glslPoly(T0_LARGE, 't')};
  float f = ${glslPoly(F0_LARGE, 't')} * inversesqrt(x);
  return vec2(f * cos(theta), f * sin(theta));
}

vec2 hankel1(float x) {
  if (x < HANKEL_BRANCH_X) {
    float t = x / 3.0;
    float u = t * t;
    float j1 = x * ${glslPoly(J1_SMALL, 'u')};
    float y1 = (TWO_OVER_PI * x * log(x * 0.5) * j1 + ${glslPoly(Y1_SMALL, 'u')}) / x;
    return vec2(j1, y1);
  }
  float t = 3.0 / x;
  float theta = mod(x, TWO_PI) + ${glslPoly(T1_LARGE, 't')};
  float f = ${glslPoly(F1_LARGE, 't')} * inversesqrt(x);
  return vec2(f * cos(theta), f * sin(theta));
}

// The outgoing 2D Green's function (i/4) H0(kr).
vec2 greensFunction(float kr) {
  vec2 h = hankel0(kr);
  return vec2(-h.y, h.x) * 0.25;
}

// The 2D Rayleigh-Sommerfeld kernel (i k / 2) H1(kr) cos(theta). The cosine is
// clamped at zero because the formula assumes a forward-half-space observer.
vec2 rayleighSommerfeldKernel(float kr, float cosTheta, float k) {
  vec2 h = hankel1(kr);
  float f = k * max(cosTheta, 0.0) * 0.5;
  return vec2(-h.y, h.x) * f;
}
`;
}
