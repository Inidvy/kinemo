import { t } from "../i18n";

export type SaveChoice = "save" | "discard" | "cancel";

/** Ask whether to save the open sketch before it is replaced. Esc or a click outside cancels. */
export function askSave(): Promise<SaveChoice> {
  return new Promise((resolve) => {
    const back = document.createElement("div");
    back.className = "modal-back";
    back.innerHTML = `<div class="modal" role="dialog" aria-modal="true">
        <h3>${t("askSave.title")}</h3>
        <p>${t("askSave.text")}</p>
        <div class="modal-btns">
          <button class="btn" data-choice="cancel">${t("askSave.cancel")}</button>
          <button class="btn" data-choice="discard">${t("askSave.discard")}</button>
          <button class="btn primary" data-choice="save">${t("askSave.save")}</button>
        </div>
      </div>`;
    const done = (c: SaveChoice) => {
      window.removeEventListener("keydown", onKey, true);
      back.remove();
      resolve(c);
    };
    const onKey = (e: KeyboardEvent) => {
      // Keep shortcuts from reaching the sketch while the question is open.
      e.stopPropagation();
      if (e.key === "Escape") done("cancel");
      if (e.key === "Enter") (e.preventDefault(), done("save"));
    };
    back.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>("[data-choice]");
      if (b) done(b.dataset.choice as SaveChoice);
      else if (e.target === back) done("cancel");
    });
    window.addEventListener("keydown", onKey, true);
    document.body.append(back);
    back.querySelector<HTMLButtonElement>(".primary")!.focus();
  });
}
