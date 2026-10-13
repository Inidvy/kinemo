import type { Editor } from "../app/editor";
import { t } from "../i18n";
import { icons } from "./icons";
import { constraintName } from "./panels";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * Banner over the canvas while the sketch is over-constrained. Names the
 * newest constraint that causes it and offers to remove that one.
 */
export function mountWarning(el: HTMLElement, ed: Editor): void {
  el.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest("[data-remove]")) ed.removeCulprits();
  });
  el.addEventListener("mousedown", (e) => e.preventDefault());

  let last = "";
  ed.subscribe(() => {
    const a = ed.analysis;
    let html = "";
    if (a.over) {
      const culprits = [...a.culprits].filter((id) => id in ed.doc.constraints);
      const name = culprits.map((id) => constraintName(ed, id)).join(", ");
      html = culprits.length
        ? `${icons.warning}<span>${esc(t("warn.culprit", { name }))}</span><button data-remove="1">${esc(t("warn.remove", { name }))}</button>`
        : `${icons.warning}<span>${esc(t("warn.noCulprit"))}</span>`;
    }
    if (html === last) return;
    last = html;
    el.innerHTML = html;
    el.hidden = !html;
  });
}
