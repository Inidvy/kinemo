import type { Editor } from "../app/editor";
import { constraintTypes } from "../constraints";
import { layoutDims } from "../render/layout";

/** Inline number box over a dimension label, like Onshape's dimension edit. */
export function mountDimEditor(wrap: HTMLElement, ed: Editor): void {
  const input = document.createElement("input");
  input.className = "dim-input";
  input.type = "text";
  input.inputMode = "decimal";
  input.hidden = true;
  wrap.appendChild(input);
  let cid: string | null = null;

  const close = (commit: boolean) => {
    if (!cid) return;
    const id = cid;
    cid = null;
    input.hidden = true;
    if (!commit) return;
    // Allow simple maths like "40/2" or "10+5".
    const expr = input.value.replace(/,/g, ".").replace(/[^0-9+\-*/(). ]/g, "");
    let v = NaN;
    try {
      v = Number(Function(`"use strict";return (${expr || "NaN"})`)());
    } catch {
      v = NaN;
    }
    if (Number.isFinite(v) && v > 0 && ed.doc.constraints[id]) ed.change((doc) => (doc.constraints[id].value = v));
  };

  ed.onEditDimension = (id) => {
    const c = ed.doc.constraints[id];
    if (!c || !constraintTypes.get(c.type).dimension) return;
    const d = layoutDims(ed.doc, ed.view).find((x) => x.cid === id);
    if (!d) return;
    cid = id;
    const s = ed.view.toScreen(d.text);
    input.style.left = `${s.x}px`;
    input.style.top = `${s.y}px`;
    input.value = String(c.value ?? "");
    input.hidden = false;
    input.focus();
    input.select();
  };

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") close(true);
    else if (e.key === "Escape") close(false);
    e.stopPropagation();
  });
  input.addEventListener("blur", () => close(true));
  // The canvas keeps focus on mousedown, so the box never blurs from a canvas
  // click. Commit on any press outside it, then let that press carry on as
  // the next step (pick, draw, select).
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (cid && e.target !== input) close(true);
    },
    true,
  );
}
