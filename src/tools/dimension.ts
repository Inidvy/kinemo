import { add, sub } from "../core/geom";
import type { Constraint, Id, SketchDoc, Vec } from "../core/model";
import { constraintTypes } from "../constraints";
import { fitSelection } from "../constraints/select";
import type { ConstraintType } from "../constraints/types";
import { defaultLabel, dimAnchor, formatValue } from "../render/layout";
import { drawDimension } from "../render/renderer";
import { colors } from "../render/style";
import { icons } from "../ui/icons";
import { t } from "../i18n";
import type { Tool } from "./types";

/** Dimension types the tool tries, in order, for the picked geometry. */
const ORDER = ["distance", "angle", "diameter", "radius"];

let cursor: Vec | null = null;

const geometryOnly = (doc: SketchDoc, ids: Iterable<Id>) => [...ids].filter((id) => id in doc.points || id in doc.geoms);

/**
 * A distance between two points (or a line's ends) measures along the line
 * when the label sits beside it, the horizontal part when the label is above
 * or below the points, and the vertical part when it is to their left or right.
 */
function distanceKind(doc: SketchDoc, c: Omit<Constraint, "id">, at: Vec | null): string {
  if (!at || c.refs.some((id) => doc.geoms[id] && c.refs.length > 1)) return "distance";
  const shape = constraintTypes.get("distance").shape!(doc, { ...c, id: "" });
  if (shape.kind !== "linear") return "distance";
  const { a, b } = shape;
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const flat = (d: number) => Math.abs(d) < len * 0.02;
  const besideX = at.x < Math.min(a.x, b.x) || at.x > Math.max(a.x, b.x);
  const besideY = at.y < Math.min(a.y, b.y) || at.y > Math.max(a.y, b.y);
  // A line that already lies flat measures its length whichever side the label is on.
  if (besideY && !besideX && !flat(b.y - a.y)) return "distanceX";
  if (besideX && !besideY && !flat(b.x - a.x)) return "distanceY";
  return "distance";
}

/** The dimension the picked items would get, or null if they don't make one. `at` is where its label would go. */
function dimensionFor(doc: SketchDoc, sel: Id[], at: Vec | null = null): { def: ConstraintType; c: Omit<Constraint, "id"> } | null {
  if (!sel.length) return null;
  for (const type of ORDER) {
    let def = constraintTypes.get(type);
    let out = fitSelection(def, doc, sel);
    if (typeof out === "string" || !def.shape) continue;
    if (type === "distance") {
      const kind = distanceKind(doc, out[0], at);
      if (kind !== "distance") {
        def = constraintTypes.get(kind);
        out = fitSelection(def, doc, sel);
        if (typeof out === "string") continue;
      }
    }
    return { def, c: out[0] };
  }
  return null;
}

/**
 * What to preview: the selection plus the item under the cursor if that makes
 * a dimension, otherwise the selection alone.
 */
function previewItems(doc: SketchDoc, selection: Set<Id>, hover: Id | null): Id[] {
  const sel = geometryOnly(doc, selection);
  if (hover && !selection.has(hover) && geometryOnly(doc, [hover]).length && sel.length < 2) {
    const withHover = [...sel, hover];
    if (dimensionFor(doc, withHover)) return withHover;
  }
  return sel;
}

/**
 * Click one or two items, then click empty space to place the dimension.
 * The tool picks the dimension type from what was clicked, and shows the
 * dimension it would make under the cursor before you click.
 */
function makeDimensionTool(o: { id: string; label: string; icon: string; shortcut: string; hint: string; measure: boolean }): Tool {
  return {
    id: o.id,
    label: o.label,
    icon: o.icon,
    shortcut: o.shortcut,
    hint: o.hint,
    activate(ed) {
      // Keep a selection made before pressing D: it is what gets dimensioned.
      const sel = geometryOnly(ed.doc, ed.selection);
      ed.select(dimensionFor(ed.doc, sel) ? sel : []);
      cursor = null;
    },
    cancel(ed) {
      if (ed.selection.size === 0) return false;
      ed.select([]);
      return true;
    },
    move(_ed, e) {
      cursor = e.world;
    },
    down(ed, e) {
      const h = e.hit;
      // Clicking a dimension that is already there changes its value.
      if (h?.kind === "dimension") {
        ed.select([]);
        if (!ed.doc.constraints[h.id]?.data?.watch) ed.onEditDimension?.(h.id);
        return;
      }
      if (h && (h.kind === "point" || h.kind === "geom")) {
        if (ed.selection.size >= 2) ed.select([]);
        ed.select([h.id], true);
        return;
      }
      if (ed.selection.size === 0) return;
      const found = dimensionFor(ed.doc, geometryOnly(ed.doc, ed.selection), e.world);
      if (!found) {
        ed.flash(t("hint.selectDistance"));
        ed.select([]);
        return;
      }
      let created: Id = "";
      ed.change((doc) => {
        const id = `c${doc.nextId++}`;
        const c: Constraint = { ...found.c, id };
        c.label = sub(e.world, dimAnchor(found.def.shape!(doc, c)));
        // A measurement only reads the value: it never moves the sketch.
        if (o.measure) c.data = { ...(c.data ?? {}), watch: 1 };
        doc.constraints[id] = c;
        created = id;
      });
      ed.select([]);
      if (!o.measure) ed.onEditDimension?.(created);
    },
    overlay({ ctx, ed }) {
      if (!cursor) return;
      const items = previewItems(ed.doc, ed.selection, ed.hover);
      // Over an item the label goes to its usual spot, so the cursor doesn't pick the direction.
      const found = dimensionFor(ed.doc, items, ed.hover ? null : cursor);
      if (!found) return;
      const c = { ...found.c, id: "preview" } as Constraint;
      const shape = found.def.shape!(ed.doc, c);
      const anchor = dimAnchor(shape);
      // Over an item the label goes to its usual spot so it doesn't sit on the item.
      const text = ed.hover ? add(anchor, defaultLabel(shape, ed.view)) : cursor;
      ctx.save();
      ctx.globalAlpha = 0.75;
      const label = o.measure ? `(${formatValue(c)})` : formatValue(c);
      drawDimension(ctx, ed.view, { cid: "preview", shape, anchor, text, label }, false, false, null, o.measure ? colors.watch : colors.preview);
      ctx.restore();
    },
  };
}

export const dimensionTool = makeDimensionTool({ id: "dimension", label: "tool.dimension", icon: icons.dimension, shortcut: "d", hint: "hint.dimension", measure: false });

/** Like Dimension, but makes a measurement (a watched dimension) that shows the length without fixing it. */
export const measureTool = makeDimensionTool({ id: "measure", label: "tool.measure", icon: icons.measure, shortcut: "m", hint: "hint.measure", measure: true });
