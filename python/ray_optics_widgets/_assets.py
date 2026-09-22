# Copyright 2026 The Wave Optics Simulation authors and contributors
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Locating the built front-end bundle.

The bundle is a build product: ``npm run build-anywidget`` writes it into ``static/`` next to this
file, and packaging picks it up from there. An installed wheel always has it; a checkout that has
never been built does not, so the failure is reported in terms of the command that fixes it rather
than as a missing file.
"""

from __future__ import annotations

from pathlib import Path

STATIC_DIR = Path(__file__).parent / "static"

_MISSING = (
    "The widget bundle has not been built. Run `npm run build-anywidget` in the repository root, "
    "which writes it to {path}."
)


def read_asset(name: str) -> str:
    """Return the contents of a built asset.

    Args:
        name: The file name inside ``static/``. The build writes a readable and a minified
            build of each: ``widget.js``, ``widget.min.js``, ``widget.css``, ``widget.min.css``.

    Returns:
        The file's contents.

    Raises:
        FileNotFoundError: If the bundle has not been built.
    """
    path = STATIC_DIR / name
    if not path.is_file():
        raise FileNotFoundError(_MISSING.format(path=path))
    return path.read_text(encoding="utf-8")
