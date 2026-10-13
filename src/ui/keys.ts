import type { Editor } from "../app/editor";
import { tools, toolInMode } from "../tools";
import { actions, actionInMode } from "./actions";
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
        const home = ed.mode === "motion" ? "move" : "select";
        if (ed.tool !== home) setTool(ed, home);
        else ed.select([]);
      }
      ed.emit();
      return;
    }

    if (!ctrl && !e.shiftKey && tools.find(ed.tool)?.key?.(ed, key)) {
      e.preventDefault();
      ed.emit();
      return;
    }
    if (!ctrl) {
      const tool = tools.all().find((t) => t.shortcut === key && !!t.shift === e.shiftKey && toolInMode(t, ed.mode));
      if (tool) {
        e.preventDefault();
        setTool(ed, tool.id);
        return;
      }
    }
    const action = actions
      .all()
      .find((a) => a.shortcut === key && !!a.ctrl === ctrl && (a.shift === undefined || a.shift === e.shiftKey) && actionInMode(a, ed.mode));
    if (action) {
      e.preventDefault();
      action.run(ed);
    }
  });
}
