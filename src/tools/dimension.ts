import { add, sub } from "../core/geom";
import type { Constraint, Id, SketchDoc, Vec } from "../core/model";
import { constraintTypes } from "../constraints";
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

/** The dimension the picked items would get, or null if they don't make one. */
function dimensionFor(doc: SketchDoc, sel: Id[]): { def: ConstraintType; c: Omit<Constraint, "id"> } | null {
  if (!sel.length) return null;
  for (const type of ORDER) {
    const def = constraintTypes.get(type);
    const out = def.fromSelection(doc, sel);
    if (typeof out !== "string" && def.shape) return { def, c: out[0] };
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
export const dimensionTool: Tool = {
  id: "dimension",
  label: "tool.dimension",
  icon: icons.dimension,
  shortcut: "d",
  hint: "hint.dimension",
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
    if (h && (h.kind === "point" || h.kind === "geom")) {
      if (ed.selection.size >= 2) ed.select([]);
      ed.select([h.id], true);
      return;
    }
    if (ed.selection.size === 0) return;
    const found = dimensionFor(ed.doc, geometryOnly(ed.doc, ed.selection));
    if (!found) {
      ed.flash(t("hint.selectDistance"));
      ed.select([]);
      return;
    }
    let created: Id = "";
    ed.change((doc) => {
      const id = `c${doc.nextId++}`;
      const c = { ...found.c, id };
      c.label = sub(e.world, dimAnchor(found.def.shape!(doc, c)));
      doc.constraints[id] = c;
      created = id;
    });
    ed.select([]);
    ed.onEditDimension?.(created);
  },
  overlay({ ctx, ed }) {
    if (!cursor) return;
    const items = previewItems(ed.doc, ed.selection, ed.hover);
    const found = dimensionFor(ed.doc, items);
    if (!found) return;
    const c = { ...found.c, id: "preview" } as Constraint;
    const shape = found.def.shape!(ed.doc, c);
    const anchor = dimAnchor(shape);
    // Over an item the label goes to its usual spot so it doesn't sit on the item.
    const text = ed.hover ? add(anchor, defaultLabel(shape, ed.view)) : cursor;
    ctx.save();
    ctx.globalAlpha = 0.75;
    drawDimension(ctx, ed.view, { cid: "preview", shape, anchor, text, label: formatValue(c) }, false, false, null, colors.preview);
    ctx.restore();
  },
};
