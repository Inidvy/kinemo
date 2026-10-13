import { sub } from "../core/geom";
import type { Id } from "../core/model";
import { constraintTypes } from "../constraints";
import { dimAnchor } from "../render/layout";
import { icons } from "../ui/icons";
import { t } from "../i18n";
import type { Tool } from "./types";

/** Dimension types the tool tries, in order, for the picked geometry. */
const ORDER = ["distance", "angle", "diameter", "radius"];

/**
 * Click one or two items, then click empty space to place the dimension.
 * The tool picks the dimension type from what was clicked.
 */
export const dimensionTool: Tool = {
  id: "dimension",
  label: "tool.dimension",
  icon: icons.dimension,
  shortcut: "d",
  hint: "hint.dimension",
  activate(ed) {
    ed.select([]);
  },
  cancel(ed) {
    if (ed.selection.size === 0) return false;
    ed.select([]);
    return true;
  },
  down(ed, e) {
    const h = e.hit;
    if (h && (h.kind === "point" || h.kind === "geom")) {
      if (ed.selection.size >= 2) ed.select([]);
      ed.select([h.id], true);
      return;
    }
    if (ed.selection.size === 0) return;
    const sel = [...ed.selection].filter((id) => id in ed.doc.points || id in ed.doc.geoms);
    for (const type of ORDER) {
      const def = constraintTypes.get(type);
      const out = def.fromSelection(ed.doc, sel);
      if (typeof out === "string" || !def.shape) continue;
      let created: Id = "";
      ed.change((doc) => {
        const id = `c${doc.nextId++}`;
        const c = { ...out[0], id };
        const anchor = dimAnchor(def.shape!(doc, c));
        c.label = sub(e.world, anchor);
        doc.constraints[id] = c;
        created = id;
      });
      ed.select([]);
      ed.onEditDimension?.(created);
      return;
    }
    ed.flash(t("hint.selectDistance"));
    ed.select([]);
  },
};
