import type { Editor } from "../app/editor";
import type { Body, Driver, Id } from "../core/model";
import { bodyColor } from "../motion/bodies";
import { jointKinds, type Joint } from "../motion/joints";
import { t } from "../i18n";
import { icons } from "./icons";

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
  const rows = bodies.map((b) => row(ed, b.id, `${swatch(ed, b)}${esc(b.name)}${b.ground ? `<span class="tag">${t("body.groundTag")}</span>` : ""}`)).join("");
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
    <label class="check"><input type="checkbox" data-field="ground" data-id="${b.id}" ${b.ground ? "checked" : ""}> ${t("body.ground")} (G)</label>
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
  const step = kind.unit === "deg" ? 0.5 : Math.max(0.01, (hi - lo) / 400);
  return `<div class="slider" data-driver="${d.id}">
      <div class="slider-head"><span>${esc(driverName(ed, d))}</span><button class="icon-btn" data-remove-driver="${d.id}" title="${t("panel.delete")}">${icons.delete}</button></div>
      <div class="slider-body">
        <input type="range" min="${lo}" max="${hi}" step="${step}" value="${v}" data-drive="${d.id}">
        <input type="number" step="any" value="${v.toFixed(2)}" data-drive-num="${d.id}"><span class="unit">${unit}</span>
      </div>
    </div>`;
}

/** Right panel in Motion mode: mechanism controls, sliders and the selection. */
export function motionProps(ed: Editor): string {
  const doc = ed.doc;
  const m = ed.mech;
  let html = `<div class="panel-title">${t("panel.mechanism")}</div>`;
  const bodies = Object.values(doc.bodies);
  if (!bodies.length) return html + `<p class="muted">${t("motion.noBodies")}</p>`;
  if (!bodies.some((b) => b.ground)) html += `<p class="muted note">${t("motion.noGround")}</p>`;
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
export function wireMotionPanel(el: HTMLElement, ed: Editor, run: (action: string) => void): void {
  el.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const r = target.closest<HTMLElement>("[data-run]");
    if (r) run(r.dataset.run!);
    const rm = target.closest<HTMLElement>("[data-remove-driver]");
    if (rm) ed.change((doc) => delete doc.motion.drivers[rm.dataset.removeDriver!]);
    const add = target.closest<HTMLElement>("[data-add-driver]");
    if (add) {
      const j = ed.mech.joint(add.dataset.addDriver!);
      if (j)
        ed.change((doc) => {
          const id = `d${doc.nextId++}`;
          doc.motion.drivers[id] = { id, joint: j.id, a: j.a, b: j.b };
        });
    }
  });
  el.addEventListener("input", (e) => {
    const input = e.target as HTMLInputElement;
    const id = input.dataset.drive;
    if (!id) return;
    if (!ed.dragging) ed.beginDrag();
    ed.driveSlider(id, parseFloat(input.value));
  });
  el.addEventListener("change", (e) => {
    const input = e.target as HTMLInputElement;
    if (input.dataset.drive) {
      ed.endDrag();
      // Let go of the slider so the panel follows canvas drags again.
      input.blur();
    } else if (input.dataset.driveNum) {
      const v = parseFloat(input.value);
      if (!Number.isFinite(v)) return;
      ed.beginDrag();
      ed.driveSlider(input.dataset.driveNum, v);
      ed.endDrag();
      input.blur();
    }
  });
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
