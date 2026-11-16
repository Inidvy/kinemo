import type { Editor, Mode } from "./editor";
import { tools } from "../tools";

export function setTool(ed: Editor, id: string): void {
  if (ed.tool === id) return;
  tools.find(ed.tool)?.deactivate?.(ed);
  ed.setTool(id);
  tools.get(id).activate?.(ed);
}

/** Switch mode and pick the mode's default tool. */
export function switchMode(ed: Editor, mode: Mode): void {
  if (ed.mode === mode) return;
  tools.find(ed.tool)?.deactivate?.(ed);
  ed.setMode(mode);
  const id = mode === "motion" ? "move" : "select";
  ed.setTool(id);
  tools.get(id).activate?.(ed);
}
