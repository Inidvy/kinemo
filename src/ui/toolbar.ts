import type { Editor } from "../app/editor";
import { tools } from "../tools";
import { actions, type Action } from "./actions";
import { t } from "../i18n";

function keyLabel(k?: string, ctrl?: boolean, shift?: boolean): string {
  if (!k) return "";
  const name = k.length === 1 ? k.toUpperCase() : k[0].toUpperCase() + k.slice(1);
  return ` (${ctrl ? "Ctrl+" : ""}${shift ? "Shift+" : ""}${name})`;
}

function keyBadge(k?: string, ctrl?: boolean, shift?: boolean): string {
  if (!k || k.length > 1) return "";
  return `<kbd>${ctrl ? "^" : ""}${shift ? "⇧" : ""}${k.toUpperCase()}</kbd>`;
}

function button(icon: string, title: string, onClick: () => void, badge = ""): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = "tb";
  b.innerHTML = icon + badge;
  b.title = title;
  b.addEventListener("click", onClick);
  return b;
}

function sep(): HTMLElement {
  const s = document.createElement("span");
  s.className = "tb-sep";
  return s;
}

/** Top toolbar, built from the tool and action registries. */
export function mountToolbar(el: HTMLElement, ed: Editor): void {
  const toolButtons = new Map<string, HTMLButtonElement>();
  const toggles: [Action, HTMLButtonElement][] = [];

  const groupEl = (name: string) => {
    const g = document.createElement("div");
    g.className = "tb-group";
    g.dataset.group = name;
    el.appendChild(g);
    return g;
  };

  const fileG = groupEl("file");
  const toolsG = groupEl("tools");
  el.appendChild(sep());
  const editG = groupEl("edit");
  el.appendChild(sep());
  const consG = groupEl("constraint");
  el.appendChild(sep());
  const viewG = groupEl("view");

  for (const tool of tools.all()) {
    if (tool.hidden) continue;
    const b = button(tool.icon, t(tool.label) + keyLabel(tool.shortcut, false, tool.shift), () => setTool(ed, tool.id), keyBadge(tool.shortcut, false, tool.shift));
    toolButtons.set(tool.id, b);
    toolsG.appendChild(b);
  }
  const groups: Record<string, HTMLElement> = { file: fileG, edit: editG, constraint: consG, view: viewG };
  for (const a of actions.all()) {
    if (!a.group) continue;
    const b = button(a.icon, t(a.label) + keyLabel(a.shortcut, a.ctrl, a.shift), () => a.run(ed), keyBadge(a.shortcut, a.ctrl, a.shift));
    groups[a.group].appendChild(b);
    if (a.active) toggles.push([a, b]);
  }

  const update = () => {
    for (const [id, b] of toolButtons) b.classList.toggle("on", ed.tool === id);
    for (const [a, b] of toggles) b.classList.toggle("on", !!a.active?.(ed));
  };
  ed.subscribe(update);
  update();
}

export function setTool(ed: Editor, id: string): void {
  if (ed.tool === id) return;
  tools.find(ed.tool)?.deactivate?.(ed);
  ed.setTool(id);
  tools.get(id).activate?.(ed);
}
