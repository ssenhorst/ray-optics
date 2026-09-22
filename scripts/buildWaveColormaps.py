#!/usr/bin/env python3
"""
Generates `src/core/waveOptics/colormapData.js` from matplotlib's colormaps.

The wave-optics renderer needs the *same* colormap values in GLSL and in the JS
reference implementation, so the tables are baked out once here rather than
approximated separately on each side.

Usage (requires matplotlib):
    python3 scripts/buildWaveColormaps.py
"""

import matplotlib
from matplotlib import colormaps

N = 256

# kind: 'sequential' for magnitude-like data, 'cyclic'/'diverging' for signed data.
MAPS = [
    ('magma', 'sequential'),
    ('inferno', 'sequential'),
    ('plasma', 'sequential'),
    ('viridis', 'sequential'),
    ('cividis', 'sequential'),
    ('gray', 'sequential'),
    ('twilight', 'cyclic'),
    ('twilight_shifted', 'cyclic'),
    ('hsv', 'cyclic'),
    ('coolwarm', 'diverging'),
    ('bwr', 'diverging'),
    ('seismic', 'diverging'),
    ('RdBu', 'diverging'),
]


def table(name):
    cmap = colormaps[name]
    out = []
    for i in range(N):
        r, g, b, _ = cmap(i / (N - 1))
        out.extend(
            max(0, min(255, int(round(c * 255)))) for c in (r, g, b)
        )
    return bytes(out)


def main():
    parts = []
    for name, kind in MAPS:
        parts.append(
            "  %s: { name: '%s', kind: '%s', hex: '%s' },"
            % (
                name.replace('_', '') if name != 'RdBu' else 'RdBu',
                name,
                kind,
                table(name).hex(),
            )
        )

    body = '\n'.join(parts)
    js = f'''/*
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
 * @file GENERATED FILE - DO NOT EDIT BY HAND.
 *
 * Baked {N}-entry sRGB lookup tables for the colormaps used by the wave-optics
 * renderer, produced from matplotlib {matplotlib.__version__} by
 * `scripts/buildWaveColormaps.py`. Baking them means the GLSL display pass and
 * the JS reference implementation cannot drift apart.
 *
 * Each entry stores {N} RGB triples as a hex string (one byte per channel).
 */

/** The number of entries in each lookup table. */
export const COLORMAP_SIZE = {N};

/**
 * Raw colormap definitions, keyed by the identifier used in the scene data.
 * `kind` describes what the map is suited to: 'sequential' for magnitudes,
 * 'cyclic' and 'diverging' for signed values.
 * @type {{Object<string, {{name: string, kind: string, hex: string}}>}}
 */
export const COLORMAP_DATA = {{
{body}
}};
'''

    with open('src/core/waveOptics/colormapData.js', 'w') as f:
        f.write(js)
    print('wrote src/core/waveOptics/colormapData.js (%d maps)' % len(MAPS))


if __name__ == '__main__':
    main()
