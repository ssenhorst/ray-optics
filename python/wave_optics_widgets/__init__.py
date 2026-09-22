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

"""Embeddable ray optics, wave optics and assignment widgets.

The simulator itself is JavaScript, under ``src/`` in this repository. This package is the Python
side of it: three `anywidget <https://anywidget.dev>`_ classes that render a scene wherever
anywidget is understood — a Jupyter notebook, a MyST Markdown build, or a static page.

    >>> from wave_optics_widgets import TaskWidget, list_scenes
    >>> "wave_zone_plate" in list_scenes()
    True
"""

from .scenes import SCENES_DIR, is_scene_link, is_wave_scene, list_scenes, load_scene
from .widgets import RayOpticsWidget, TaskWidget, WaveOpticsWidget

try:  # pragma: no cover - only absent when running from a source tree with no metadata
    from importlib.metadata import PackageNotFoundError, version

    __version__ = version("wave-optics-widgets")
except (ImportError, PackageNotFoundError):  # pragma: no cover
    __version__ = "0.0.0.dev0"

__all__ = [
    "RayOpticsWidget",
    "WaveOpticsWidget",
    "TaskWidget",
    "load_scene",
    "list_scenes",
    "is_wave_scene",
    "is_scene_link",
    "SCENES_DIR",
    "__version__",
]
