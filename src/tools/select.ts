import { geomPoints, type Id, type SketchDoc, type Vec } from "../core/model";
import { dist, sub } from "../core/geom";
import { boxSelect } from "../render/hit";
import { colors } from "../render/style";
import { icons } from "../ui/icons";
import { dimAnchor } from "../render/layout";
import { constraintTypes } from "../constraints";
import type { DragTarget } from "../solver/solver";
import type { Tool, ToolEvent } from "./types";

type DragState =
  | { kind: "points"; start: Vec; from: Map<Id, Vec> }
  | { kind: "radius"; circle: Id }
  | { kind: "label"; cid: Id }
  | { kind: "box"; start: Vec; now: Vec; additive: boolean };

let drag: DragState | null = null;
let pressed: ToolEvent | null = null;
let moved = false;
let narrowTo: Id | null = null;

function pointsOf(doc: SketchDoc, id: Id): Id[] {
  if (id in doc.points) return [id];
  const g = doc.geoms[id];
  return g ? geomPoints(g) : [];
}

export const selectTool: Tool = {
  id: "select",
  label: "tool.select",
  icon: icons.select,
  shortcut: "s",
  hint: "hint.select",
  down(ed, e) {
    pressed = e;
    moved = false;
    narrowTo = null;
    const h = e.hit;
    if (!h) {
      drag = { kind: "box", start: e.screen, now: e.screen, additive: e.shift || e.ctrl };
      return;
    }
    if (e.double && h.kind === "dimension") {
      ed.onEditDimension?.(h.id);
      drag = null;
      return;
    }
    // Clicking an item that is already part of a group keeps the group for
    // dragging; a plain click without a drag narrows to that item on release.
    narrowTo = ed.selection.has(h.id) && !e.shift && !e.ctrl && ed.selection.size > 1 ? h.id : null;
    if (!ed.selection.has(h.id) || e.shift || e.ctrl) ed.select([h.id], e.shift || e.ctrl);

    if (h.kind === "dimension") {
      drag = { kind: "label", cid: h.id };
    } else if (h.kind === "geom" && h.part === "rim") {
      drag = { kind: "radius", circle: h.id };
    } else if (h.kind === "point" || h.kind === "geom") {
      // Move every selected point and geometry together.
      const from = new Map<Id, Vec>();
      for (const id of ed.selection) {
        for (const p of pointsOf(ed.doc, id)) from.set(p, { ...ed.doc.points[p] });
      }
      drag = { kind: "points", start: e.world, from };
    } else {
      drag = null;
    }
    if (drag) ed.beginDrag();
  },
  move(ed, e) {
    if (!drag || !pressed) return;
    if (!moved && dist(e.screen, pressed.screen) < 3) return;
    moved = true;
    if (drag.kind === "box") {
      drag.now = e.screen;
      ed.emit();
    } else if (drag.kind === "points") {
      const d = sub(e.world, drag.start);
      const targets: DragTarget[] = [];
      for (const [id, p] of drag.from) targets.push({ point: id, to: { x: p.x + d.x, y: p.y + d.y } });
      ed.drag(targets);
    } else if (drag.kind === "radius") {
      const g = ed.doc.geoms[drag.circle];
      if (g?.kind !== "circle") return;
      const c = ed.doc.points[g.c];
      // Pull the radius toward the cursor with a soft constraint.
      const r = ed.solver.solve(ed.doc, [], [
        { id: "drag#r", type: "circle_radius", c_id: g.id, radius: dist(c, e.world), temporary: true },
      ]);
      if (r.ok) ed.history.replace(r.doc);
      ed.emit();
    } else if (drag.kind === "label") {
      const c = ed.doc.constraints[drag.cid];
      const def = constraintTypes.get(c.type);
      if (!def.shape) return;
      const anchor = dimAnchor(def.shape(ed.doc, c));
      const cid = drag.cid;
      ed.live((doc) => {
        doc.constraints[cid].label = sub(e.world, anchor);
      });
    }
  },
  up(ed) {
    if (drag?.kind === "box") {
      if (moved) ed.select(boxSelect(ed.doc, ed.view, drag.start, drag.now), drag.additive);
      else if (!drag.additive) ed.select([]);
    } else if (drag) {
      ed.endDrag();
    }
    if (!moved && narrowTo) ed.select([narrowTo]);
    narrowTo = null;
    drag = null;
    pressed = null;
  },
  overlay({ ctx }) {
    if (drag?.kind !== "box" || !moved) return;
    const { start, now } = drag;
    ctx.fillStyle = colors.boxSelect;
    ctx.strokeStyle = colors.boxSelectBorder;
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.fillRect(start.x, start.y, now.x - start.x, now.y - start.y);
    ctx.strokeRect(start.x, start.y, now.x - start.x, now.y - start.y);
  },
};
