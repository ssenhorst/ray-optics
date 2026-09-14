# Task scenes

A *task scene* is an ordinary Ray Optics scene with three extra properties:

| Property      | What it does                                                                    |
|---------------|---------------------------------------------------------------------------------|
| `interaction` | decides what the student is allowed to change, scene-wide and per object         |
| `ui`          | decides which parts of the interface are shown                                   |
| `task`        | states the assignment and the goals that are scored against the simulation       |

They work in the full web app and in the standalone widget. The widget is what you embed in a
course: `npm run build-tasks` turns each scene in this directory into one self-contained HTML file
in `dist/tasks/` with no external references at all, which is what platforms such as edX require.

## Building and previewing

```bash
npm run build-tasks          # dist/tasks/<scene>.html, one self-contained file per scene
npm run start                # then open /widget/index.html?scene=<name> to iterate on a scene
```

The dev page reads the scene list from `index.json` in this directory, so add new scenes there.

## `interaction` — what the student may change

Categories, all booleans:

| Key         | Level        | Meaning                                                              |
|-------------|--------------|----------------------------------------------------------------------|
| `enabled`   | scene+object | Wildcard standing for every key the same level does not mention.      |
| `select`    | scene+object | The object can be selected and highlighted.                           |
| `move`      | scene+object | The object can be dragged as a whole.                                 |
| `reshape`   | scene+object | Its defining points (endpoints, vertices, arc points) can be dragged. |
| `edit`      | scene+object | Its numeric and boolean properties can be edited.                     |
| `remove`    | scene+object | It can be deleted.                                                    |
| `properties`| scene+object | Per-property overrides, see below.                                    |
| `create`    | scene        | New objects can be added.                                             |
| `pan`       | scene        | The view can be panned.                                               |
| `zoom`      | scene        | The view can be zoomed.                                               |
| `keyboard`  | scene        | Keyboard editing shortcuts are active.                                |

A setting is looked up most-specific first: the object's `properties[<name>]`, the object's category
key, the object's `enabled`, then the same three on the scene, and finally the default, which allows
everything. So the usual pattern is to freeze the scene and open up only what the exercise is about:

```json
"interaction": { "enabled": false, "pan": true, "zoom": true }
```

```json
{ "type": "Mirror", "name": "Segment 1", "interaction": { "move": false, "reshape": true } }
```

`properties` gives the finest control. The name is a serialized property of the object
(`focalLength`, `p1`, `brightness`, …), or `part<n>` for a draggable part with no named point. The
same name governs both ways of changing the property: dragging its handle on the canvas and typing
its value in the property panel.

```json
"interaction": { "reshape": false, "properties": { "p2": true } }
```

means only the second endpoint may be dragged, and

```json
"interaction": { "edit": true, "properties": { "focalLength": false } }
```

means everything but the focal length may be edited. An object is selectable whenever it allows
anything else, unless some level states `select` explicitly.

Two things follow from a pinned point that are worth knowing when authoring:

- A control point the student may not move never shows a drag cursor. If the object itself can be
  moved, grabbing that point moves the whole object instead, so the most obvious place to grab an
  object is never dead.
- The ideal lens and the ideal curved mirror put their focal points on the canvas as drag handles
  under the name `focalLength`, so an exercise about focal length needs no number box:

  ```json
  { "type": "IdealLens", "name": "Relay",
    "interaction": { "move": true, "reshape": false, "properties": { "focalLength": true } } }
  ```

## `ui` — what is shown

All booleans, all default to `true`. `toolbar`, `objectBar`, `sidebar`, `statusBar`, `footer` and
`welcomeMessage` are honoured by the full web app; `taskPanel`, `resetButton`, `zoomButtons`,
`showTargets`, `showAffordances` and `celebrate` by the widget.

`showAffordances` is what makes a restricted scene readable: the widget marks every place the
permissions let the student grab, with a ring on each draggable control point and a four-way arrow
at the centre of each object that can be moved. Turn `objectBar` off to make an exercise purely
direct-manipulation, with no number boxes at all. A minimal applet is usually:

```json
"ui": { "toolbar": false, "objectBar": false, "sidebar": false, "statusBar": false }
```

Objects draw their own markers regardless of whether they are interactive — a light source's
direction point, for example. When such a marker would be misleading in a restricted scene, hide it
through the scene's `theme`, which already accepts per-scene overrides:

```json
"theme": { "directionPoint": { "color": { "r": 1, "g": 0, "b": 0, "a": 0 } } }
```

## `task` — the assignment

```json
"task": {
  "title": "Collimate the lamp",
  "description": "Shown under the title.",
  "hint": "Revealed by a button, so it costs the student something to look.",
  "successMessage": "Shown when every goal is met.",
  "requireAll": true,
  "goals": [ ... ]
}
```

Every goal is scored after each simulation run and reports both whether it is met and how close the
student is, so the panel shows a progress bar that keeps moving while they adjust things. Common
keys on any goal: `id`, `title`, `description`, `weight`, `showTarget`, `targetLabel`, and `source`
(the `name` of a light source, to score only the light from that one).

### `raysThroughPoint`

Rays must pass within `radius` of `point`.

```json
{ "type": "raysThroughPoint", "point": { "x": 420, "y": 560 }, "radius": 25, "count": 6, "minDepth": 1 }
```

`count` defaults to every ray the relevant sources emit. `minDepth` is the number of interactions a
ray must already have had to count, so `1` means "only reflected or refracted light".

### `raysAvoidPoint`

The mirror image: no ray may come within `radius` of `point`. Drawn as a dashed red region.

### `raysConverge`

The rays must come to a focus of at most `radius` across, optionally at a given `point`. Unlike
`raysThroughPoint` this measures the sharpness of the spot, which suits tasks about aberration and
about image position. The measured focus is drawn on the canvas as a cross.

```json
{ "type": "raysConverge", "source": "Tip", "point": { "x": 1240, "y": 270 }, "radius": 20, "minDepth": 2 }
```

### `collimated`

The outgoing light must be parallel to a direction, given as `angle` in degrees or as a `direction`
vector, within `tolerance` degrees.

```json
{ "type": "collimated", "angle": 0, "tolerance": 1.2 }
```

### `detectorPower`

A named `Detector` in the scene must read at least `min`, or `target` within `tolerance`.

```json
{ "type": "detectorPower", "detector": "Screen", "min": 0.8 }
```

### `objectProperty`

A numeric property of a named object must reach `target` within `tolerance`.

```json
{ "type": "objectProperty", "object": "Relay", "property": "focalLength", "target": 108.75, "tolerance": 2 }
```

## Embedding

Each file in `dist/tasks/` is a complete page. Upload it as a static asset and point an `<iframe>`
at it, which is the most robust route on a platform that sanitises pasted HTML:

```html
<iframe src="/static/parabolic_by_parts.html" width="100%" height="560" style="border:0"></iframe>
```

To put several applets on a page you control, include the bundle once and mark up each container:

```html
<div data-ray-optics style="height: 520px">
  <script type="application/json"> ... the scene ... </script>
</div>
<script src="ray-optics-widget.js"></script>
```

or create them from code with `RayOptics.createWidget(element, sceneJson, options)`. The options are
`onTaskStatus(status)`, called after every run with the score of each goal, and `onComplete(status)`,
called the first time the task is solved — use them to report progress back to the host page.
