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

"""The anywidget classes.

Three widgets are offered because there are three things an author means: show a ray optics scene,
show a wave optics scene, or set an assignment. They share one front-end bundle, because the applet
already decides which simulator to run from the scene it is handed and shows an assignment panel
exactly when the scene carries a task. What the three classes differ in is what they check and what
they default to, which is where the difference actually lies.

Every widget works without a running kernel once it has been rendered, which is what makes the
output embeddable in a MyST build or in a learning platform that serves static HTML. With a kernel,
:attr:`progress`, :attr:`solved` and :attr:`goal_status` report back what the student has done.
"""

from __future__ import annotations

from typing import Any, Mapping, Optional

import anywidget
import traitlets

from ._assets import read_asset
from .scenes import SceneLike, is_wave_scene, load_scene


class RayOpticsWidget(anywidget.AnyWidget):
    """A ray optics scene, embedded.

    Args:
        scene: The scene to show, in any of the forms :func:`~wave_optics_widgets.load_scene`
            accepts. May also be given as the ``scene`` keyword.
        **kwargs: Any of the traits below.

    Example:
        >>> from wave_optics_widgets import RayOpticsWidget
        >>> RayOpticsWidget("collimate_the_beam", height=380)  # doctest: +SKIP
    """

    # The minified build: this string travels with every notebook the widget is saved into.
    _esm = read_asset("widget.min.js")
    _css = read_asset("widget.min.css")

    #: Which of the three widgets this is. Carried to the front end for its messages; it does not
    #: select code there, since the scene already says what has to run.
    variant = traitlets.Unicode("ray").tag(sync=True)

    #: The scene, in the simulator's JSON format.
    scene = traitlets.Dict(default_value={}).tag(sync=True)

    #: Interaction permissions laid over the scene's own. See `src/core/interaction.js`; the same
    #: keys work here, and only the keys given are overridden.
    interaction = traitlets.Dict(default_value={}).tag(sync=True)

    #: Interface options laid over the scene's own. See `src/core/uiOptions.js`.
    ui = traitlets.Dict(default_value={}).tag(sync=True)

    #: A task laid over the scene's own. See `data/taskScenes/README.md`.
    task = traitlets.Dict(default_value={}).tag(sync=True)

    #: The height of the applet in pixels. It has no content-driven height of its own, so a notebook
    #: output area or a page needs to be told one.
    height = traitlets.Int(420).tag(sync=True)

    #: Whether the applet handles keyboard shortcuts. Worth turning off where several widgets share
    #: a page and the keyboard should belong to the page.
    allow_keyboard = traitlets.Bool(True).tag(sync=True)

    #: How far the student has got, from 0 to 1. Written by the front end; ``0.0`` without a task.
    progress = traitlets.Float(0.0).tag(sync=True)

    #: Whether every goal is met. Written by the front end; ``False`` without a task.
    solved = traitlets.Bool(False).tag(sync=True)

    #: One entry per goal, each with ``id``, ``title``, ``detail``, ``progress`` and ``satisfied``.
    #: Written by the front end.
    goal_status = traitlets.List(traitlets.Dict(), default_value=[]).tag(sync=True)

    def __init__(self, scene: Optional[SceneLike] = None, **kwargs: Any) -> None:
        if scene is not None:
            if "scene" in kwargs:
                raise TypeError("scene was given both positionally and as a keyword")
            kwargs["scene"] = scene
        if "scene" in kwargs:
            kwargs["scene"] = load_scene(kwargs["scene"])
        kwargs.setdefault("variant", self._default_variant())
        super().__init__(**kwargs)
        self._check_scene(self.scene)

    @classmethod
    def _default_variant(cls) -> str:
        return "ray"

    def _check_scene(self, scene: Mapping[str, Any]) -> None:
        """Complain about a scene this widget cannot show, at the point it is given rather than as
        a blank output later on."""
        if scene and is_wave_scene(scene):
            raise ValueError(
                "This is a wave optics scene; show it with WaveOpticsWidget, which runs the field "
                "solver rather than the ray tracer."
            )

    @traitlets.observe("scene")
    def _on_scene(self, change: Any) -> None:
        self._check_scene(change["new"])


class WaveOpticsWidget(RayOpticsWidget):
    """A wave optics scene, embedded.

    The same applet, running the field solver rather than the ray tracer. Drawing the field needs
    WebGL2 in the viewer's browser; a task's *scoring* does not, since the goals evaluate the field
    on the CPU.

    Args:
        scene: The scene to show, in any of the forms :func:`~wave_optics_widgets.load_scene`
            accepts.
        **kwargs: Any of :class:`RayOpticsWidget`'s traits.
    """

    @classmethod
    def _default_variant(cls) -> str:
        return "wave"

    def _check_scene(self, scene: Mapping[str, Any]) -> None:
        if scene and not is_wave_scene(scene):
            raise ValueError(
                "This is not a wave optics scene: it holds no wave objects. Show it with "
                "RayOpticsWidget."
            )


class TaskWidget(RayOpticsWidget):
    """An assignment, embedded.

    The scene carries a ``task``: the goals to meet, the text describing them, and usually
    interaction permissions narrowing what the student may change. The panel showing the goals and
    the progress towards them appears because the task is there.

    Ray and wave scenes are both accepted, since an assignment is an assignment either way.

    Args:
        scene: The scene to show, in any of the forms :func:`~wave_optics_widgets.load_scene`
            accepts.
        **kwargs: Any of :class:`RayOpticsWidget`'s traits.

    Example:
        >>> from wave_optics_widgets import TaskWidget
        >>> widget = TaskWidget("wave_zone_plate")  # doctest: +SKIP
        >>> widget.solved  # doctest: +SKIP
        False
    """

    #: The task panel is the point of this widget, so it is a little taller by default.
    height = traitlets.Int(480).tag(sync=True)

    @classmethod
    def _default_variant(cls) -> str:
        return "task"

    def _check_scene(self, scene: Mapping[str, Any]) -> None:
        if not scene:
            return
        # The task may equally be supplied separately, which is how one scene serves both as a free
        # exploration and as an assignment.
        if not scene.get("task") and not self.task:
            raise ValueError(
                "This scene carries no task, so there would be nothing to solve. Give the widget a "
                "`task=...`, or show the scene with RayOpticsWidget or WaveOpticsWidget."
            )
