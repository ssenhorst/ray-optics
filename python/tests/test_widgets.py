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

"""What the Python side is responsible for: reading a scene, laying overrides over it, and refusing
a scene the widget cannot show. What the front end does with the result is checked in the browser,
not here."""

from __future__ import annotations

import json

import pytest

from wave_optics_widgets import (
    RayOpticsWidget,
    TaskWidget,
    WaveOpticsWidget,
    is_wave_scene,
    list_scenes,
    load_scene,
)

RAY_SCENE = "collimate_the_beam"
WAVE_SCENE = "wave_zone_plate"


def test_bundled_scenes_are_listed():
    names = list_scenes()
    assert RAY_SCENE in names
    assert WAVE_SCENE in names
    # The launcher's index and the stray files some file systems leave behind are not scenes.
    assert "index" not in names
    assert all(not name.startswith(".") for name in names)


@pytest.mark.parametrize("name", list_scenes())
def test_every_bundled_scene_loads(name):
    scene = load_scene(name)
    assert isinstance(scene.get("objs"), list)


def test_load_scene_accepts_a_dict_a_path_and_json_text():
    from wave_optics_widgets import SCENES_DIR

    path = SCENES_DIR / f"{RAY_SCENE}.json"
    by_name = load_scene(RAY_SCENE)
    assert load_scene(path) == by_name
    assert load_scene(str(path)) == by_name
    assert load_scene(json.dumps(by_name)) == by_name
    assert load_scene(by_name) == by_name
    # A dict is copied, so a widget cannot write back into the caller's scene.
    assert load_scene(by_name) is not by_name


def test_an_unknown_name_says_what_is_available():
    with pytest.raises(FileNotFoundError) as excinfo:
        load_scene("no_such_scene")
    assert RAY_SCENE in str(excinfo.value)


def test_wave_scenes_are_told_apart():
    assert is_wave_scene(load_scene(WAVE_SCENE))
    assert not is_wave_scene(load_scene(RAY_SCENE))


def test_each_widget_carries_its_variant_and_the_built_bundle():
    widget = RayOpticsWidget(RAY_SCENE)
    assert widget.variant == "ray"
    assert WaveOpticsWidget(WAVE_SCENE).variant == "wave"
    assert TaskWidget(WAVE_SCENE).variant == "task"
    # The front-end contract: an ES module with a default export, and a stylesheet.
    assert "export" in widget._esm
    assert ".ro-widget" in widget._css


def test_a_scene_may_be_named_positionally_or_by_keyword_but_not_both():
    assert RayOpticsWidget(RAY_SCENE).scene == RayOpticsWidget(scene=RAY_SCENE).scene
    with pytest.raises(TypeError):
        RayOpticsWidget(RAY_SCENE, scene=RAY_SCENE)


def test_overrides_are_carried_as_their_own_traits():
    # They are laid over the scene in the front end, so that one scene file can be shown with
    # different permissions in different places without being copied.
    widget = RayOpticsWidget(RAY_SCENE, ui={"toolbar": False}, interaction={"move": False})
    assert widget.ui == {"toolbar": False}
    assert widget.interaction == {"move": False}
    assert "ui" not in widget.scene or widget.scene["ui"] != {"toolbar": False}


def test_a_widget_refuses_a_scene_its_engine_cannot_run():
    with pytest.raises(ValueError, match="wave optics scene"):
        RayOpticsWidget(WAVE_SCENE)
    with pytest.raises(ValueError, match="not a wave optics scene"):
        WaveOpticsWidget(RAY_SCENE)


def test_a_task_widget_needs_a_task_from_somewhere():
    scene = load_scene(RAY_SCENE)
    scene.pop("task", None)
    with pytest.raises(ValueError, match="no task"):
        TaskWidget(scene)
    # Supplying the task separately is the other half of that: the same scene, set as an assignment.
    TaskWidget(scene, task={"title": "Try it", "goals": []})


def test_the_student_facing_results_start_empty():
    widget = TaskWidget(WAVE_SCENE)
    assert widget.progress == 0.0
    assert widget.solved is False
    assert widget.goal_status == []
