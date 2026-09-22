# wave-optics-widgets

Embeddable ray optics, wave optics and assignment widgets, as
[anywidgets](https://anywidget.dev).

The simulator itself is the JavaScript in this repository. This package is its Python side: three
widget classes that render a scene anywhere anywidget is understood — a Jupyter notebook, a
[MyST](https://mystmd.org) Markdown build, or a static page.

```python
from wave_optics_widgets import RayOpticsWidget, WaveOpticsWidget, TaskWidget

RayOpticsWidget("collimate_the_beam")
WaveOpticsWidget("wave_zone_plate", height=520)
TaskWidget("wave_diffraction_orders")
```

A scene may be a bundled example's name, a path to a `.json` file, the JSON itself, or a dictionary
you built. The format is the simulator's own, documented in `data/taskScenes/README.md`.

It may also be a link shared from the simulator — what its **File → Copy link** button writes, and
what the address bar holds with **Auto sync URL** on. The hash carries the whole scene compressed, so
a scene goes from the simulator into a notebook by pasting, with no file in between:

```python
WaveOpticsWidget("https://phydemo.app/ray-optics/simulator/#XQAAgAD...")
```

The link is carried to the browser as a link and decompressed there, which is where the codec that
wrote it already lives; it therefore arrives on the `link` trait rather than on `scene`, and which
simulator it needs is decided once it has been read.

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
| `link` | A scene given as a shared link instead; set for you when one is passed as the scene. |
| `interaction` | Interaction permissions laid over the scene's own. |
| `ui` | Interface options laid over the scene's own. |
| `task` | A task laid over the scene's own. |
| `wave_optics` | Wave display settings laid over the scene's own: `view`, `animated`, colormaps. |
| `height` | The applet's height in pixels; it has no height of its own. |
| `allow_keyboard` | Whether the applet handles keyboard shortcuts. |
| `progress`, `solved`, `goal_status` | Written by the front end as the student works. |

`interaction`, `ui`, `task` and `wave_optics` are merged into the scene key by key rather than
replacing it wholesale, so naming one option leaves the rest as the scene had them. Where none is
given, the scene's own `interaction` and `ui` are what decide what the student may change and which
controls appear — a scene that freezes everything but one lens arrives frozen. A key the front end
does not know is refused here rather than ignored there. That is what lets one scene
file be a free exploration in one place and a graded assignment in another:

```python
scene = load_scene("two_lens_imaging")

WaveOpticsWidget(scene, ui={"taskPanel": False})      # explore it
TaskWidget(scene, task={...}, interaction={"move": False})  # or set it
```

A wave scene carries two controls of its own: a selector for how the field is shown, and, in the two
views that show an instant rather than a time average, a play button for its clock. Both are shown
by default and are turned off with `ui={"viewSelector": False, "playButton": False}`. Which view a
scene opens in and whether it is already moving are scene properties, so a figure can be authored as
a moving one:

```python
WaveOpticsWidget("wave_zone_plate", wave_optics={"view": "field", "animated": True})
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
npm run build-anywidget     # writes python/wave_optics_widgets/static/widget.{js,css}
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
from wave_optics_widgets import TaskWidget
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
