# Kinemo

A browser app for designing 2D mechanisms. Sketch with CAD-style constraints, group lines into rigid bodies, join them with joints, then drive the mechanism with sliders, by dragging, or with a keyframe timeline.

This is step 1 of 4: the constraint sketcher. Bodies and Motion mode come in step 2.

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
| L | Line (click points; Esc ends the chain) |
| A | Arc (centre, start, end; direction follows the cursor) |
| C | Circle |
| R / Shift+R | Rectangle by two corners / by centre and corner |
| D | Dimension: click geometry, then click where the label goes, type a value |
| E H V P T | Coincident, horizontal, vertical, parallel, tangent |
| X | Toggle construction |
| K | Tag as track |
| I | Show or hide constraint icons |
| F | Zoom to fit |
| Del | Delete |
| Ctrl+Z / Ctrl+Y | Undo / redo |
| Ctrl+S / Ctrl+O | Save / open a `.kinemo.json` file |
| Esc | Cancel, then back to Select |

Other constraints (point on curve, perpendicular, equal, midpoint, concentric, symmetric, fix) are on the toolbar and in the right panel, which lists only the constraints that fit the current selection. Middle- or right-drag pans, the wheel zooms, and two fingers pan and pinch on touch screens.

Line colour shows status: blue is still free to move, black is fully defined, red is a conflicting constraint.

## Adding a feature

Every kind of feature lives in a registry, so a new one is a new file plus one registration line.

- **Constraint:** implement `ConstraintType` (`src/constraints/types.ts`) and add it to the list in `src/constraints/index.ts`. It gets a toolbar button, shortcut, right-panel chip, undo and saving automatically.
- **Tool:** implement `Tool` (`src/tools/types.ts`) and add it in `src/tools/index.ts`.
- **Action:** add an entry in `src/ui/actions.ts`.
- **Text:** all interface strings are in `src/i18n/en.ts`.
- **File format:** bump `DOC_VERSION` in `src/core/model.ts` and add a migration in `src/io/file.ts`.

The document (`src/core/model.ts`) is plain data. All changes go through `Editor.change`, which records undo history and re-solves. Only `src/solver/solver.ts` talks to the solver ([PlaneGCS](https://github.com/Salusoft89/planegcs), FreeCAD's sketch solver compiled to WebAssembly).
