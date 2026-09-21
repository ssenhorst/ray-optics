# ray-optics-widgets

Embeddable ray optics, wave optics and assignment widgets, as
[anywidgets](https://anywidget.dev).

The simulator itself is the JavaScript in this repository. This package is its Python side: three
widget classes that render a scene anywhere anywidget is understood — a Jupyter notebook, a
[MyST](https://mystmd.org) Markdown build, or a static page.

```python
from ray_optics_widgets import RayOpticsWidget, WaveOpticsWidget, TaskWidget

RayOpticsWidget("collimate_the_beam")
WaveOpticsWidget("wave_zone_plate", height=520)
TaskWidget("wave_diffraction_orders")
```

A scene may be a bundled example's name, a path to a `.json` file, the JSON itself, or a dictionary
you built. The format is the simulator's own, documented in `data/taskScenes/README.md`.

## The three widgets

They share one front-end bundle, because the applet decides which simulator to run from the scene it
is handed and shows an assignment panel exactly when the scene carries a task. The classes differ in
what they accept:

| Class | Shows | Refuses |
| --- | --- | --- |
| `RayOpticsWidget` | a ray optics scene | a scene holding wave objects |
| `WaveOpticsWidget` | a wave optics scene | a scene holding none |
| `TaskWidget` | either, with its assignment panel | a scene with no task and no `task=` |

The refusals are there to turn a blank output into a sentence, at the point the scene is given.

## Traits

| Trait | Meaning |
| --- | --- |
| `scene` | The scene, as a dictionary. |
| `interaction` | Interaction permissions laid over the scene's own. |
| `ui` | Interface options laid over the scene's own. |
| `task` | A task laid over the scene's own. |
| `height` | The applet's height in pixels; it has no height of its own. |
| `allow_keyboard` | Whether the applet handles keyboard shortcuts. |
| `progress`, `solved`, `goal_status` | Written by the front end as the student works. |

`interaction`, `ui` and `task` are merged into the scene key by key rather than replacing it
wholesale, so naming one option leaves the rest as the scene had them. That is what lets one scene
file be a free exploration in one place and a graded assignment in another:

```python
scene = load_scene("two_lens_imaging")

WaveOpticsWidget(scene, ui={"taskPanel": False})      # explore it
TaskWidget(scene, task={...}, interaction={"move": False})  # or set it
```

With a kernel attached, `progress`, `solved` and `goal_status` report back what the student has
done. Without one — a published MyST page, a static export — the widget still works; it just has
nowhere to report to.

## Requirements

Drawing a wave optics field needs WebGL2 in the viewer's browser. Scoring a wave task does not: the
goals evaluate the field on the CPU, so a task is scored correctly whatever the display can manage.

## Building

The front-end bundle is a build product and is not in version control:

```bash
npm install
npm run build-anywidget     # writes python/ray_optics_widgets/static/widget.{js,css}
pip install .               # from the repository root
```

`pip install .` from an unbuilt checkout will install, but constructing a widget then raises a
`FileNotFoundError` naming the command above.

## Tests

```bash
pip install -e ".[dev]"
pytest
```

## In MyST

MyST renders an anywidget from an executed code cell, so a scene goes into a document as the cell's
value:

````markdown
```{code-cell} python
:tags: [remove-input]
from ray_optics_widgets import TaskWidget
TaskWidget("wave_diffraction_orders", height=520)
```
````

with execution turned on for the page:

```yaml
# myst.yml
project:
  jupyter: true
```

The widget's front end and the scene both travel with the output, so the built page is interactive
without a kernel behind it. What it does still need is the Jupyter widget manager that renders any
anywidget, which the MyST theme supplies.

For a platform that allows no outside requests at all — EdX, say — use the standalone pages from
`npm run build-tasks` instead. Those are one HTML file with everything compiled in — no widget
protocol at all, the applet built directly — and they show the same applet from the same scene file.
