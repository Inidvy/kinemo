import type { Editor } from "../app/editor";
import { deleteItems, type Id, type Vec } from "../core/model";
import { addLabel, labelAt } from "../core/labels";

/** Inline text box for writing a label, over the canvas where the label goes. */
export function mountLabelEditor(wrap: HTMLElement, ed: Editor): void {
  const input = document.createElement("input");
  input.className = "label-input";
  input.type = "text";
  input.hidden = true;
  wrap.appendChild(input);
  let target: { id: Id } | { at: Vec; point?: Id } | null = null;

  const close = (commit: boolean) => {
    if (!target) return;
    const tg = target;
    target = null;
    input.hidden = true;
    if (!commit) return;
    const text = input.value.trim();
    if ("id" in tg) {
      const l = ed.doc.labels?.[tg.id];
      if (!l || l.text === text) return;
      // Clearing the text deletes the label.
      ed.change((doc) => (text ? (doc.labels[tg.id].text = text) : deleteItems(doc, [tg.id])));
    } else if (text) {
      let id = "";
      ed.change((doc) => (id = addLabel(doc, text, tg.at, tg.point)));
      ed.select([id]);
    }
  };

  ed.onEditLabel = (tg) => {
    close(true);
    const at = "id" in tg ? (ed.doc.labels?.[tg.id] ? labelAt(ed.doc, ed.doc.labels[tg.id]) : null) : tg.point ? add(ed.doc.points[tg.point], tg.at) : tg.at;
    if (!at) return;
    target = tg;
    const s = ed.view.toScreen(at);
    input.style.left = `${s.x}px`;
    input.style.top = `${s.y}px`;
    input.value = "id" in tg ? (ed.doc.labels[tg.id].text ?? "") : "";
    input.hidden = false;
    // Focus after the click that opened it has finished, so it doesn't steal focus back.
    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
  };

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") close(true);
    else if (e.key === "Escape") close(false);
    e.stopPropagation();
  });
  input.addEventListener("blur", () => close(true));
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (target && e.target !== input) close(true);
    },
    true,
  );
}

const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
