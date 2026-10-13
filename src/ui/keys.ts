import type { Editor } from "../app/editor";
import { tools } from "../tools";
import { actions } from "./actions";
import { setTool } from "./toolbar";

/** Global keyboard shortcuts, read from the tool and action registries. */
export function mountKeys(ed: Editor): void {
  window.addEventListener("keydown", (e) => {
    const target = e.target as HTMLElement;
    if (target.closest("input, textarea, select")) return;
    const key = e.key.toLowerCase();
    const ctrl = e.ctrlKey || e.metaKey;

    if (key === "escape") {
      const tool = tools.find(ed.tool);
      if (!tool?.cancel?.(ed)) {
        if (ed.tool !== "select") setTool(ed, "select");
        else ed.select([]);
      }
      ed.emit();
      return;
    }

    if (!ctrl) {
      const tool = tools.all().find((t) => t.shortcut === key && !!t.shift === e.shiftKey);
      if (tool) {
        e.preventDefault();
        setTool(ed, tool.id);
        return;
      }
    }
    const action = actions
      .all()
      .find((a) => a.shortcut === key && !!a.ctrl === ctrl && (a.shift === undefined || a.shift === e.shiftKey));
    if (action) {
      e.preventDefault();
      action.run(ed);
    }
  });
}
