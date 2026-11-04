import { icons } from "../ui/icons";
import type { Tool } from "./types";

/**
 * Text: click to write a label there. Clicking a point names it: the label
 * sits beside the point and follows it, also in Motion. Clicking a label edits it.
 */
export const textTool: Tool = {
  id: "text",
  label: "tool.text",
  icon: icons.text,
  shortcut: "t",
  shift: true,
  hint: "hint.text",
  snaps: true,
  down(ed, e) {
    if (e.hit?.kind === "label") return ed.onEditLabel?.({ id: e.hit.id });
    if (e.snap.kind === "point") return ed.onEditLabel?.({ point: e.snap.id, at: { x: ed.view.px(6), y: ed.view.px(6) } });
    ed.onEditLabel?.({ at: e.world });
  },
};
