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

"""Getting hold of a scene.

A scene is a plain dictionary in the simulator's own JSON format, so a scene can come from anywhere:
written out by hand, produced by a script, saved from the task designer, or taken from the examples
shipped with this package. :func:`load_scene` accepts all of those spellings so that the widgets
themselves only ever see a dictionary.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Mapping, Union

def _scenes_dir() -> Path:
    """Where the bundled example scenes are.

    ``npm run build-anywidget`` copies ``data/taskScenes`` in beside the bundle, and that copy is
    what an installed package carries. A checkout that has not been built yet has no copy, so the
    repository's own directory is used instead and the examples still resolve.
    """
    packaged = Path(__file__).parent / "scenes"
    if packaged.is_dir():
        return packaged
    return Path(__file__).resolve().parents[2] / "data" / "taskScenes"


SCENES_DIR = _scenes_dir()

SceneLike = Union[Mapping[str, Any], str, Path]


def list_scenes() -> list[str]:
    """Return the names of the example scenes bundled with this package.

    These are the scenes in the repository's ``data/taskScenes``: the assignments the task designer
    writes and the standalone pages are built from.

    Returns:
        The scene names, without the ``.json`` suffix, sorted.
    """
    if not SCENES_DIR.is_dir():
        return []
    return sorted(
        path.stem
        for path in SCENES_DIR.glob("*.json")
        # `index.json` is the launcher's list rather than a scene, and a leading dot marks the
        # stray files some file systems leave behind next to the real ones.
        if path.stem != "index" and not path.name.startswith(".")
    )


def load_scene(source: SceneLike) -> dict[str, Any]:
    """Return a scene as a dictionary.

    Args:
        source: One of

            * a dictionary, returned as a plain ``dict``;
            * a path to a ``.json`` file;
            * the name of a bundled example, as listed by :func:`list_scenes`;
            * a string holding the scene JSON itself.

    Returns:
        The scene.

    Raises:
        FileNotFoundError: If a name or path names nothing that exists.
        ValueError: If a string is neither a known name nor readable JSON.
    """
    if isinstance(source, Mapping):
        return dict(source)

    if isinstance(source, Path):
        return json.loads(source.read_text(encoding="utf-8"))

    text = str(source)

    # A scene written out rather than named. Checked first only when it looks like JSON, so that a
    # name is never mistaken for a malformed document.
    if text.lstrip().startswith("{"):
        return json.loads(text)

    path = Path(text)
    if path.suffix == ".json" or path.exists():
        if not path.is_file():
            raise FileNotFoundError(f"No such scene file: {path}")
        return json.loads(path.read_text(encoding="utf-8"))

    bundled = SCENES_DIR / f"{text}.json"
    if bundled.is_file():
        return json.loads(bundled.read_text(encoding="utf-8"))

    known = ", ".join(list_scenes()) or "none are bundled"
    raise FileNotFoundError(f"No scene named {text!r}. Bundled scenes: {known}.")


def is_wave_scene(scene: Mapping[str, Any]) -> bool:
    """Whether a scene is a wave optics scene.

    Decided the same way the front end decides it, by the objects the scene holds, since that is
    what settles which simulator can run it.

    Args:
        scene: The scene.

    Returns:
        Whether any object in it is a wave optics object.
    """
    return any(
        isinstance(obj, Mapping) and str(obj.get("type", "")).startswith("Wave")
        for obj in scene.get("objs", []) or []
    )
