import wasmUrl from "@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm?url";
import "./style.css";
import { Editor } from "./app/editor";
import { Solver } from "./solver/solver";
import { autosave, loadAutosave } from "./io/file";
import { mountCanvas } from "./ui/canvas";
import { mountToolbar, switchMode } from "./ui/toolbar";
import { mountKeys } from "./ui/keys";
import { mountFeatureTree, mountProperties } from "./ui/panels";
import { mountDimEditor } from "./ui/dimEditor";
import { mountWarning } from "./ui/warning";
import { tools } from "./tools";
import { t } from "./i18n";
import { svgIcon, iconPaths } from "./ui/icons";

async function main() {
  const solver = await Solver.create(wasmUrl);
  const ed = new Editor(solver, loadAutosave() ?? undefined);

  const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
  $("#brand").textContent = t("app.name");
  $("#doc-name").textContent = t("doc.untitled");

  const canvas = $<HTMLCanvasElement>("#canvas");
  mountCanvas(canvas, ed);
  mountToolbar($("#toolbar"), ed);
  mountFeatureTree($("#left"), ed);
  mountProperties($("#right"), ed);
  mountDimEditor($("#canvas-wrap"), ed);
  mountWarning($("#warning"), ed);
  mountKeys(ed);

  // Bottom tabs, like Onshape's Part Studio / Assembly tabs.
  const tabs = $("#tabs");
  tabs.innerHTML = `
    <button class="tab on" data-mode="sketch" title="Tab">${svgIcon(iconPaths.sketch, 14)} ${t("tab.sketch")}</button>
    <button class="tab" data-mode="motion" title="Tab">${svgIcon(iconPaths.motion, 14)} ${t("tab.motion")}</button>`;
  tabs.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-mode]");
    if (b) switchMode(ed, b.dataset.mode as "sketch" | "motion");
  });

  const status = $("#status");
  let saveTimer = 0;
  ed.subscribe(() => {
    const tool = tools.find(ed.tool);
    status.textContent = ed.message || tool?.hintText?.(ed) || t(tool?.hint ?? "");
    status.classList.toggle("flash", !!ed.message);
    for (const b of tabs.querySelectorAll<HTMLElement>("[data-mode]")) b.classList.toggle("on", b.dataset.mode === ed.mode);
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => autosave(ed.doc), 400);
  });

  requestAnimationFrame(() => {
    ed.view.fit(Object.values(ed.doc.points), canvas.clientWidth, canvas.clientHeight);
    ed.emit();
  });
  (window as unknown as { kinemo: Editor }).kinemo = ed;
}

main();
