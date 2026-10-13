import { constraintTypes } from "../constraints";
import { emptyDoc } from "../core/model";
import { t } from "../i18n";
import type { Editor } from "../app/editor";
import type { Tool } from "./types";

/**
 * Constraint-first workflow: press a constraint's key with nothing (or not
 * enough) selected, then click the items. The constraint is added as soon as
 * the picked items fit, and the tool stays active for the next pair until Esc.
 */
let pending: string | null = null;

export function pendingConstraint(): string | null {
  return pending;
}

export function startConstraintPick(ed: Editor, type: string, setTool: (id: string) => void): void {
  pending = type;
  // Keep a partial selection as the first picks.
  const keep = [...ed.selection].filter((id) => id in ed.doc.points || id in ed.doc.geoms);
  setTool("constraint");
  ed.select(keep);
}

export const constraintPickTool: Tool = {
  id: "constraint",
  label: "tool.constraint",
  icon: "",
  hidden: true,
  hint: "hint.select",
  hintText() {
    if (!pending) return "";
    const def = constraintTypes.get(pending);
    // With nothing selected, fromSelection returns the "what to select" hint.
    const what = def.fromSelection(emptyDoc(), []);
    return `${t(def.label)}: ${typeof what === "string" ? t(what) : ""} ${t("hint.escToFinish")}`;
  },
  deactivate(ed) {
    pending = null;
    ed.select([]);
  },
  cancel(ed) {
    if (ed.selection.size === 0) return false;
    ed.select([]);
    return true;
  },
  down(ed, e) {
    if (!pending) return;
    const h = e.hit;
    if (!h || (h.kind !== "point" && h.kind !== "geom")) return;
    ed.select([h.id], true);
    const sel = [...ed.selection];
    if (typeof constraintTypes.get(pending).fromSelection(ed.doc, sel) === "string") return;
    ed.applyConstraint(pending);
    ed.select([]);
  },
};
