import type { Editor } from "../app/editor";
import type { Body, Driver, Id } from "../core/model";
import { bodyColor, fixedGround, isGround } from "../motion/bodies";
import { jointKinds, type Joint } from "../motion/joints";
import { t } from "../i18n";
import { icons } from "./icons";
import { addDriver, keyName } from "../motion/drivers";
import type { SliderMotion } from "./sliderMotion";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

const bodyName = (ed: Editor, id: Id) => ed.doc.bodies[id]?.name ?? "?";

export function jointName(ed: Editor, j: Joint): string {
  return `${t(jointKinds.get(j.kind).label)} · ${bodyName(ed, j.a)} – ${bodyName(ed, j.b)}`;
}

function driverName(ed: Editor, d: Driver): string {
  const j = ed.mech.joint(d.joint);
  return `${bodyName(ed, d.b)} / ${bodyName(ed, d.a)}${j ? ` · ${t(jointKinds.get(j.kind).label)}` : ""}`;
}

function swatch(ed: Editor, b: Body): string {
  return `<span class="swatch" style="background:${bodyColor(ed.doc, b)}"></span>`;
}

function row(ed: Editor, id: Id, label: string, cls = ""): string {
  const sel = ed.selection.has(id) ? " sel" : "";
  return `<div class="row ${cls}${sel}" data-id="${id}">${label}</div>`;
}

/** Bodies list, used in both modes. */
export function bodiesSection(ed: Editor): string {
  const bodies = Object.values(ed.doc.bodies);
  const rows = bodies.map((b) => row(ed, b.id, `${swatch(ed, b)}${esc(b.name)}${isGround(ed.doc, b.id) ? `<span class="tag">${t(fixedGround(ed.doc, b) ? "body.fixedTag" : "body.groundTag")}</span>` : ""}`)).join("");
  const empty = bodies.length ? "" : `<p class="muted small">${t("body.none")}</p>`;
  return `<details open><summary>${t("panel.bodies")} <span class="count">${bodies.length}</span></summary>${rows}${empty}</details>`;
}

/** Left panel in Motion mode. */
export function motionTree(ed: Editor): string {
  const m = ed.mech;
  const dof = ed.analysis.mechDof;
  const status = !Object.keys(ed.doc.bodies).length
    ? ""
    : dof === 0
      ? `<span class="status ok">${t("motion.locked")}</span>`
      : `<span class="status free">${t(dof === 1 ? "status.dof1" : "status.dof", { n: dof })}</span>`;
  const joints = m.joints.map((j) => row(ed, j.id, esc(jointName(ed, j)))).join("");
  const drivers = Object.values(ed.doc.motion.drivers);
  const sliders = drivers.map((d) => row(ed, d.joint, `${icons.drive}${esc(driverName(ed, d))}`)).join("");
  return `
    <div class="panel-title">${t("panel.features")}</div>
    <div class="feature">
      <div class="feature-head"><span class="sketch-icon">${icons.motion}</span>${t("panel.mechanism")}${status}</div>
      ${bodiesSection(ed)}
      <details open><summary>${t("panel.joints")} <span class="count">${m.joints.length}</span></summary>${joints}${
        m.joints.length ? "" : `<p class="muted small">${t("motion.noJoints")}</p>`
      }</details>
      <details open><summary>${t("panel.sliders")} <span class="count">${drivers.length}</span></summary>${sliders}</details>
    </div>`;
}

/** Name, ground switch and (in Sketch mode) ungroup for a selected body. */
export function bodyProps(ed: Editor, b: Body): string {
  return `<div class="prop-head">${swatch(ed, b)}${esc(b.name)}</div>
    <label class="field">${t("panel.name")}<input type="text" data-field="bodyName" data-id="${b.id}" value="${esc(b.name)}"></label>
    <label class="check"><input type="checkbox" data-field="ground" data-id="${b.id}" ${isGround(ed.doc, b.id) ? "checked" : ""} ${fixedGround(ed.doc, b) ? "disabled" : ""}> ${t(fixedGround(ed.doc, b) ? "body.groundFixed" : "body.ground")} (⇧G)</label>
    <div class="readout"><span>${t("body.members")}</span><b>${b.members.length}</b></div>
    ${ed.mode === "sketch" ? `<button class="btn danger" data-delete="1">${t("body.ungroup")}</button>` : ""}`;
}

function sliderRow(ed: Editor, d: Driver): string {
  const m = ed.mech;
  const j = m.joint(d.joint);
  if (!j) return "";
  const kind = jointKinds.get(j.kind);
  const [lo, hi] = kind.range(ed.doc, j);
  const v = m.measure(m.current(), j.id);
  const unit = kind.unit === "deg" ? "°" : "mm";
  const step = kind.unit === "deg" ? 0.1 : Math.max(0.01, (hi - lo) / 1000);
  const keyBtn = (i: number) =>
    `<button class="keycap${capturing?.driver === d.id && capturing.index === i ? " capturing" : ""}" data-keycap="${d.id}" data-index="${i}" title="${t("slider.setKey")}">${
      capturing?.driver === d.id && capturing.index === i ? t("slider.pressKey") : esc(keyName(d.keys?.[i]))
    }</button>`;
  return `<div class="slider" data-driver="${d.id}">
      <div class="slider-head"><span>${esc(driverName(ed, d))}</span><button class="icon-btn" data-remove-driver="${d.id}" title="${t("panel.delete")}">${icons.delete}</button></div>
      <div class="slider-body">
        <button class="hold" data-hold="${d.id}" data-dir="-1" title="${t("slider.hold")}">◀</button>
        <input type="range" min="${lo}" max="${hi}" step="${step}" value="${v}" data-drive="${d.id}">
        <button class="hold" data-hold="${d.id}" data-dir="1" title="${t("slider.hold")}">▶</button>
      </div>
      <div class="slider-foot">
        <span class="keys">${t("slider.keys")} ${keyBtn(0)} ${keyBtn(1)}</span>
        <span><input type="number" step="any" value="${v.toFixed(2)}" data-drive-num="${d.id}"><span class="unit">${unit}</span></span>
      </div>
    </div>`;
}

/** The key button waiting for a key press, if any. */
let capturing: { driver: Id; index: number } | null = null;

/** Right panel in Motion mode: mechanism controls, sliders and the selection. */
export function motionProps(ed: Editor): string {
  const doc = ed.doc;
  const m = ed.mech;
  let html = `<div class="panel-title">${t("panel.mechanism")}</div>`;
  const bodies = Object.values(doc.bodies);
  if (!bodies.length) return html + `<p class="muted">${t("motion.noBodies")}</p>`;
  if (!bodies.some((b) => isGround(doc, b.id))) html += `<p class="muted note">${t("motion.noGround")}</p>`;
  html += `<div class="btn-row">
      <button class="btn" data-run="flip">${icons.flip}${t("action.flip")} <kbd>⇧F</kbd></button>
      <button class="btn" data-run="resetPose">${icons.reset}${t("action.resetPose")} <kbd>R</kbd></button>
    </div>`;

  const drivers = Object.values(doc.motion.drivers);
  html += `<div class="panel-title">${t("panel.sliders")}</div>`;
  html += drivers.length ? drivers.map((d) => sliderRow(ed, d)).join("") : `<p class="muted">${t("motion.noSliders")}</p>`;

  const sel = [...ed.selection];
  if (sel.length === 1 && doc.bodies[sel[0]]) {
    html += `<div class="panel-title">${t("panel.properties")}</div>` + bodyProps(ed, doc.bodies[sel[0]]);
  } else if (sel.length === 1 && m.joint(sel[0])) {
    const j = m.joint(sel[0])!;
    const kind = jointKinds.get(j.kind);
    const v = m.measure(m.current(), j.id);
    const driven = drivers.some((d) => d.joint === j.id);
    html += `<div class="panel-title">${t("panel.properties")}</div>
      <div class="prop-head">${esc(jointName(ed, j))}</div>
      <div class="readout"><span>${t(kind.unit === "deg" ? "panel.angle" : "panel.position")}</span><b>${v.toFixed(2)} ${kind.unit === "deg" ? "°" : "mm"}</b></div>
      ${driven ? "" : `<button class="btn" data-add-driver="${j.id}">${icons.drive}${t("drive.add")}</button>`}`;
  }
  return html;
}

/** Hook the Motion-mode controls of the right panel to the editor. */
export function wireMotionPanel(el: HTMLElement, ed: Editor, sliders: SliderMotion, run: (action: string) => void): void {
  el.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const r = target.closest<HTMLElement>("[data-run]");
    if (r) run(r.dataset.run!);
    const rm = target.closest<HTMLElement>("[data-remove-driver]");
    if (rm) ed.change((doc) => delete doc.motion.drivers[rm.dataset.removeDriver!]);
    const add = target.closest<HTMLElement>("[data-add-driver]");
    if (add) {
      const j = ed.mech.joint(add.dataset.addDriver!);
      if (j) ed.change((doc) => addDriver(doc, j.id, j.a, j.b));
    }
    const cap = target.closest<HTMLElement>("[data-keycap]");
    if (cap) {
      capturing = { driver: cap.dataset.keycap!, index: Number(cap.dataset.index) };
      cap.blur();
      ed.emit();
    }
  });
  // Press and hold ◀ ▶ to keep the slider moving.
  el.addEventListener("pointerdown", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-hold]");
    if (!b) return;
    e.preventDefault();
    b.setPointerCapture(e.pointerId);
    sliders.hold(b.dataset.hold!, Number(b.dataset.dir));
  });
  const letGo = (e: PointerEvent) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-hold]");
    if (b) sliders.release(b.dataset.hold!);
  };
  el.addEventListener("pointerup", letGo);
  el.addEventListener("pointercancel", letGo);
  el.addEventListener("input", (e) => {
    const input = e.target as HTMLInputElement;
    if (input.dataset.drive) sliders.setTarget(input.dataset.drive, parseFloat(input.value));
  });
  el.addEventListener("change", (e) => {
    const input = e.target as HTMLInputElement;
    if (input.dataset.drive) {
      // Let go of the slider so the panel follows canvas drags again.
      input.blur();
    } else if (input.dataset.driveNum) {
      const v = parseFloat(input.value);
      if (Number.isFinite(v)) sliders.setTarget(input.dataset.driveNum, v);
      input.blur();
    }
  });

  // Keyboard: assign a key to a slider, or hold a slider's key to move it.
  window.addEventListener(
    "keydown",
    (e) => {
      if (ed.mode !== "motion") return;
      const key = e.key.toLowerCase();
      if (capturing) {
        e.preventDefault();
        e.stopImmediatePropagation();
        const { driver, index } = capturing;
        capturing = null;
        if (key !== "escape" && ed.doc.motion.drivers[driver]) {
          ed.change((doc) => {
            const d = doc.motion.drivers[driver];
            const keys: [string, string] = d.keys ? [...d.keys] : ["", ""];
            keys[index] = key === "backspace" || key === "delete" ? "" : key;
            // A key moves one slider only.
            for (const o of Object.values(doc.motion.drivers)) if (o.id !== driver && o.keys) o.keys = o.keys.map((k) => (k === keys[index] ? "" : k)) as [string, string];
            d.keys = keys;
          });
        } else ed.emit();
        return;
      }
      if ((e.target as HTMLElement).closest("input[type=text], input[type=number], textarea")) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      for (const d of Object.values(ed.doc.motion.drivers)) {
        const i = d.keys?.indexOf(key) ?? -1;
        if (i < 0 || !key) continue;
        e.preventDefault();
        e.stopImmediatePropagation();
        if (!e.repeat) sliders.hold(d.id, i === 0 ? -1 : 1);
        return;
      }
    },
    true,
  );
  window.addEventListener(
    "keyup",
    (e) => {
      const key = e.key.toLowerCase();
      for (const d of Object.values(ed.doc.motion.drivers)) if (d.keys?.includes(key)) sliders.release(d.id);
    },
    true,
  );
  window.addEventListener("blur", () => sliders.release());
}

/** While a slider has focus, keep the other sliders' values current without rebuilding the panel. */
export function patchSliders(el: HTMLElement, ed: Editor): void {
  const m = ed.mech;
  const q = m.current();
  for (const box of el.querySelectorAll<HTMLElement>("[data-driver]")) {
    const d = ed.doc.motion.drivers[box.dataset.driver!];
    if (!d) continue;
    const v = m.measure(q, d.joint);
    for (const input of box.querySelectorAll<HTMLInputElement>("input")) {
      if (input === document.activeElement) continue;
      input.value = input.type === "number" ? v.toFixed(2) : String(v);
    }
  }
}
