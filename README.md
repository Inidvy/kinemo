# Kinemo

A browser app for designing 2D mechanisms. Sketch with CAD-style constraints, group lines into rigid bodies, join them with joints, then drive the mechanism with sliders, by dragging, or with a keyframe timeline.

This is step 2 of 4: the constraint sketcher, bodies, joints and Motion mode. Tracks, gears and cams come in step 3; the timeline and path tracing in step 4.

## Run it

```sh
npm install
npm run dev      # http://localhost:5173
npm test         # solver and model tests
npm run build    # static site in dist/
```

Pushing to `main` deploys to GitHub Pages (Settings → Pages → Source: GitHub Actions).

## Sketching

| Key | Action |
| --- | --- |
| S | Select |
| L | Polyline: click points; M cycles line / tangent arc / normal arc / tangent line; starting on an existing end point continues from it; Esc ends the chain |
| A | Arc (centre, start, end; direction follows the cursor) |
| C | Circle |
| O | Point |
| R / Shift+R | Rectangle by two corners / by centre and corner |
| D | Dimension: click geometry (or select it first), a preview follows the cursor, click where the label goes, type a value |
| E | Coincident (two points), or point on curve (points and one line, circle or arc) |
| H V P T | Horizontal, vertical, parallel, tangent |
| N Q U Z Y W | Perpendicular, equal, midpoint, concentric, symmetric, fix |
| X | Toggle construction |
| K | Tag as track |
| I | Show or hide constraint icons |
| F | Zoom to fit |
| Del | Delete |
| Ctrl+Z / Ctrl+Y | Undo / redo |
| Ctrl+S / Ctrl+O | Save / open a `.kinemo.json` file |
| Shift+N | New sketch |
| G | Group the selected lines, arcs, circles and points into a body. With one part of an existing body (or the body) selected too, add the rest to that body. Each item is in one body only |
| Shift+G | Toggle ground on the selected body |
| Shift+I | Solid or see-through bars |
| Tab | Switch between Sketch and Motion |
| Esc | Cancel, then back to Select |

Constraint keys work both ways: select items first and press the key, or press the key first and then click the items (it stays active for the next ones until Esc). The right panel lists the constraints that fit the current selection, and every toolbar button shows its key. Middle- or right-drag pans, the wheel zooms, and two fingers pan and pinch on touch screens.

Line colour shows status: blue is still free to move, black is fully defined.

Over-constraining is allowed. The newest constraint that causes it is shown in dark red and isn't applied, so the rest of the sketch keeps working; every other constraint whose removal would also fix it is shown in light red. A banner explains it and offers to remove the newest one. Drag steps that would collapse geometry or leave the sketch over-constrained are skipped, so dragging never causes it.

## Bodies and Motion mode

Select geometry and press G to group it into one rigid body. A body fixed at one point (W) turns about it like a ground pivot; a body fixed at two or more points, or marked with Shift+G, is ground and drawn grey. Closed loops of lines in a body are drawn as see-through plates, lines a slider runs along get a slot with a dotted centre line, and each body's colour can be picked from eight in its properties. Joints come from the sketch: wherever geometry of two bodies is coincident (or concentric) they are pinned, and a point of one body on a line or arc of another slides along it. Lines that carry a slider are drawn as slots.

| Key (Motion) | Action |
| --- | --- |
| S | Move: drag any bar, the mechanism follows |
| D | Add slider: click the body it measures from, the body that moves, then the joint (or click a joint) |
| Shift+F | Flip to the other way the mechanism assembles |
| R | Reset every body to its sketched position |
| Shift+G | Toggle ground |
| ← → ↑ ↓ | Hold to move the first and second slider (each slider's keys can be changed in its panel, also to a combination like 1 + ←) |
| Del | Delete the selected joint's slider |

Sliders sit in the right panel, and you can drag them and the bars together. Dragging a joint moves its body, so a slider joint runs along its slot. A driven slider joint shows an arrow along its slot. Lines and arcs of one body tagged as track (K) that join end to end form one track: a pin put on any of them runs along the whole chain, round corners, and stops at its ends (or goes round and round if the track is closed). A slider joint turns on its pin as it slides; untick "Turns on its pin" in the joint's properties (Motion mode) to make it only slide, so the slider keeps lined up with its path.

Gears: make two circles (or arcs) in different bodies tangent (T) and they mesh as gears: they roll on each other, turning the other way by the ratio of their sizes, or the same way when one sits inside the other (a ring gear). Pin each gear's centre to put it on an axle. A line tangent to a circle of another body is a rack and pinion. Gears and racks are drawn with teeth.

Sliders ease smoothly to a new value. A slider for a joint that goes round (a crank, a full circle, a closed track) doesn't stop at its ends: dragging past the end of the bar carries on round by as far as you drag; hold ◀ ▶ or a slider's keys to keep it moving. When a slider or a drag asks for more than the mechanism can do, it stops at the last pose that works. The feature list shows the mechanism's degrees of freedom.

## Adding a feature

Every kind of feature lives in a registry, so a new one is a new file plus one registration line.

- **Constraint:** implement `ConstraintType` (`src/constraints/types.ts`) and add it to the list in `src/constraints/index.ts`. It gets a toolbar button, shortcut, right-panel chip, undo and saving automatically.
- **Tool:** implement `Tool` (`src/tools/types.ts`) and add it in `src/tools/index.ts`. Set `modes` to make it a Motion-mode tool.
- **Joint:** implement `JointKind` (`src/motion/joints.ts`): which sketch constraint makes it, its equations, its slider and its travel limits. The motion solver (`src/motion/kinematics.ts`) handles the rest.
- **Action:** add an entry in `src/ui/actions.ts`.
- **Text:** all interface strings are in `src/i18n/en.ts`.
- **File format:** bump `DOC_VERSION` in `src/core/model.ts` and add a migration in `src/io/file.ts`.

The document (`src/core/model.ts`) is plain data. All changes go through `Editor.change`, which records undo history and re-solves. Only `src/solver/solver.ts` talks to the solver ([PlaneGCS](https://github.com/Salusoft89/planegcs), FreeCAD's sketch solver compiled to WebAssembly).
