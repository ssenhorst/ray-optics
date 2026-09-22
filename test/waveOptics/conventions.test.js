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

import {
  wavenumber, wavelengthInMedium, minimumRadius, samplingDiagnostics,
  comfortablePixelsPerWavelength, MIN_PIXELS_PER_WAVELENGTH,
  COMFORTABLE_PIXELS_PER_WAVELENGTH, COMFORTABLE_PIXELS_PER_WAVELENGTH_PHASE,
  MAX_RELIABLE_PHASE
} from '../../src/core/waveOptics/conventions.js';

describe('derived optical quantities', () => {
  test('the wavenumber is 2 pi n / lambda', () => {
    expect(wavenumber(20, 1)).toBeCloseTo(Math.PI / 10, 12);
    expect(wavenumber(20, 1.5)).toBeCloseTo(1.5 * Math.PI / 10, 12);
  });

  test('the wavelength shortens in a denser medium', () => {
    expect(wavelengthInMedium(20, 2)).toBe(10);
  });

  test('the near-source clamp scales with the wavelength in the medium', () => {
    // The clamp is defined in wavelengths so that the clamped argument k*r is
    // the same number regardless of lambda or n.
    for (const [wavelength, index] of [[20, 1], [0.5, 1], [20, 2.5]]) {
      const kr = wavenumber(wavelength, index) * minimumRadius(wavelength, index);
      expect(kr).toBeCloseTo(2 * Math.PI / 100, 12);
    }
  });
});

describe('samplingDiagnostics', () => {
  const base = {
    gridSpacing: 5, wavelength: 20, refractiveIndex: 1, sceneExtent: 1000,
  };

  test('reports the grid density in samples per wavelength', () => {
    expect(samplingDiagnostics(base).pixelsPerWavelength).toBeCloseTo(4, 12);
  });

  test('flags aliasing below the Nyquist limit', () => {
    const aliased = samplingDiagnostics({ ...base, gridSpacing: 20 });
    expect(aliased.pixelsPerWavelength).toBeLessThan(MIN_PIXELS_PER_WAVELENGTH);
    expect(aliased.isAliasing).toBe(true);

    expect(samplingDiagnostics({ ...base, gridSpacing: 1 }).isAliasing).toBe(false);
  });

  test('the amplitude-phase view demands a finer grid than the others', () => {
    // Hue wraps once per wavelength, so it turns to noise well before a
    // twilight-mapped real field does.
    expect(comfortablePixelsPerWavelength('amplitudePhase'))
      .toBeGreaterThan(comfortablePixelsPerWavelength('field'));
    expect(comfortablePixelsPerWavelength('intensity'))
      .toBe(COMFORTABLE_PIXELS_PER_WAVELENGTH);
    expect(comfortablePixelsPerWavelength('amplitudePhase'))
      .toBe(COMFORTABLE_PIXELS_PER_WAVELENGTH_PHASE);

    // At six samples per wavelength the field view is content and the
    // amplitude-phase view is not.
    const atSix = { ...base, gridSpacing: 20 / 6 };
    expect(samplingDiagnostics({ ...atSix, view: 'field' }).isCoarse).toBe(false);
    expect(samplingDiagnostics({ ...atSix, view: 'amplitudePhase' }).isCoarse).toBe(true);
  });

  test('flags undersampled sources separately from the display grid', () => {
    const diagnostics = samplingDiagnostics({ ...base, samplesPerWavelength: 1 });
    expect(diagnostics.isSourceUndersampled).toBe(true);
    // The grid itself is fine here; the two warnings are independent.
    expect(diagnostics.isAliasing).toBe(false);

    expect(samplingDiagnostics({ ...base, samplesPerWavelength: 8 }).isSourceUndersampled)
      .toBe(false);
  });

  test('flags a scene too large for float32 to carry the phase', () => {
    expect(samplingDiagnostics(base).isPhaseUnreliable).toBe(false);

    const huge = samplingDiagnostics({ ...base, sceneExtent: 1e9 });
    expect(huge.maxPhase).toBeGreaterThan(MAX_RELIABLE_PHASE);
    expect(huge.isPhaseUnreliable).toBe(true);
  });
});
