import type { Editor } from "../app/editor";
import { arcRadius, type Geometry, type Id } from "../core/model";
import { dist } from "../core/geom";
import { constraintTypes } from "../constraints";
import { formatValue } from "../render/layout";
import { t } from "../i18n";
import { actions } from "./actions";
import { constraintIcon, icons } from "./icons";
import type { SliderMotion } from "./sliderMotion";
import { bodiesSection, bodyProps, motionProps, motionTree, patchSliders, wireMotionPanel } from "./motionPanels";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

function geomName(g: Geometry, index: number): string {
  return `${t(`geom.${g.kind}`)} ${index}`;
}

export function constraintName(ed: Editor, id: Id): string {
  const c = ed.doc.constraints[id];
  const def = constraintTypes.get(c.type);
  return def.dimension ? `${t(def.label)} ${formatValue(c)}` : t(def.label);
}

/** Left panel: feature tree in the style of Onshape's feature list. */
export function mountFeatureTree(el: HTMLElement, ed: Editor): void {
  el.addEventListener("click", (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>("[data-id]");
    if (row) ed.select([row.dataset.id!], e.shiftKey || e.ctrlKey || e.metaKey);
  });
  el.addEventListener("mouseover", (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>("[data-id]");
    const id = row?.dataset.id ?? null;
    if (id !== ed.hover) {
      ed.hover = id;
      ed.emit();
    }
  });

  const update = () => {
    if (ed.mode === "motion") {
      el.innerHTML = motionTree(ed);
      return;
    }
    const a = ed.analysis;
    const status =
      a.over
        ? `<span class="status bad">${t("status.conflict")}</span>`
        : a.dof === 0
          ? `<span class="status ok">${t("status.fullyDefined")}</span>`
          : `<span class="status free">${t(a.dof === 1 ? "status.dof1" : "status.dof", { n: a.dof })}</span>`;
    const counts: Record<string, number> = {};
    const geoms = Object.values(ed.doc.geoms)
      .map((g) => {
        counts[g.kind] = (counts[g.kind] ?? 0) + 1;
        const flags = [g.construction ? "construction" : "", g.track ? "track" : ""].filter(Boolean).join(" ");
        return row(g.id, geomName(g, counts[g.kind]), `kind-${g.kind} ${flags}`);
      })
      .join("");
    const cons = Object.values(ed.doc.constraints)
      .map((c) => {
        const def = constraintTypes.get(c.type);
        const bad = a.culprits.has(c.id) ? " bad" : a.fixes.has(c.id) ? " bad-soft" : "";
        return row(c.id, `${constraintIcon(def.id, esc(def.glyph), 14)}${esc(constraintName(ed, c.id))}`, bad, true);
      })
      .join("");
    el.innerHTML = `
      <div class="panel-title">${t("panel.features")}</div>
      <div class="feature">
        <div class="feature-head"><span class="sketch-icon">${icons.sketch}</span>${t("panel.sketch")}${status}</div>
        <details open><summary>${t("panel.geometry")} <span class="count">${Object.keys(ed.doc.geoms).length}</span></summary>${geoms}</details>
        <details open><summary>${t("panel.constraints")} <span class="count">${Object.keys(ed.doc.constraints).length}</span></summary>${cons}</details>
        ${bodiesSection(ed)}
      </div>`;
  };

  function row(id: Id, label: string, cls = "", raw = false): string {
    const sel = ed.selection.has(id) ? " sel" : "";
    return `<div class="row ${cls}${sel}" data-id="${id}">${raw ? label : esc(label)}</div>`;
  }

  ed.subscribe(update);
  update();
}

/** Right panel: properties of the selection and the constraints it allows. */
export function mountProperties(el: HTMLElement, ed: Editor, sliders: SliderMotion): void {
  el.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-apply],[data-delete]");
    if (!b) return;
    if (b.dataset.apply) ed.applyConstraint(b.dataset.apply);
    if (b.dataset.delete) actions.get("delete").run(ed);
  });
  el.addEventListener("change", (e) => {
    const input = e.target as HTMLInputElement;
    const id = input.dataset.id!;
    const field = input.dataset.field!;
    if (field === "value") {
      const v = parseFloat(input.value);
      if (Number.isFinite(v) && v > 0) ed.change((doc) => (doc.constraints[id].value = v));
    } else if (field === "construction" || field === "track") {
      ed.change((doc) => (doc.geoms[id][field] = input.checked));
    } else if (field === "bodyName") {
      const name = input.value.trim();
      if (name) ed.change((doc) => (doc.bodies[id].name = name));
    } else if (field === "ground") {
      ed.change((doc) => (doc.bodies[id].ground = input.checked));
    } else if (field === "barWidth") {
      const v = parseFloat(input.value);
      if (Number.isFinite(v) && v > 0) ed.change((doc) => (doc.settings.barWidth = v));
    }
  });

  wireMotionPanel(el, ed, sliders, (id) => actions.get(id).run(ed));

  const update = () => {
    // Only an input being typed in or dragged holds off a rebuild; a clicked button doesn't.
    const active = document.activeElement;
    const focused = !!active && el.contains(active) && active.matches("input, select, textarea");
    if (ed.mode === "motion") {
      // Rebuilding mid-movement would drop a held button; just refresh the values.
      if (focused || sliders.active) patchSliders(el, ed);
      else el.innerHTML = motionProps(ed);
      return;
    }
    if (focused) return;
    const doc = ed.doc;
    const sel = [...ed.selection];
    let html = `<div class="panel-title">${t("panel.properties")}</div>`;

    if (sel.length === 0) {
      html += `<p class="muted">${t("panel.nothingSelected")}</p>
        <div class="panel-title">${t("panel.settings")}</div>
        <label class="field">${t("panel.barWidth")}<input type="number" min="0.5" step="0.5" data-field="barWidth" data-id="" value="${doc.settings.barWidth}"></label>`;
    } else if (sel.length === 1 && doc.constraints[sel[0]]) {
      const c = doc.constraints[sel[0]];
      const def = constraintTypes.get(c.type);
      html += `<div class="prop-head">${constraintIcon(def.id, esc(def.glyph), 16)}${t(def.label)}</div>`;
      if (def.dimension) {
        html += `<label class="field">${t("panel.value")} (${def.unit === "deg" ? "°" : "mm"})<input type="number" step="any" data-field="value" data-id="${c.id}" value="${c.value}"></label>`;
      }
      html += `<button class="btn danger" data-delete="1">${t("panel.delete")}</button>`;
    } else if (sel.length === 1 && doc.bodies[sel[0]]) {
      html += bodyProps(ed, doc.bodies[sel[0]]);
    } else if (sel.length === 1 && doc.geoms[sel[0]]) {
      const g = doc.geoms[sel[0]];
      html += `<div class="prop-head">${t(`geom.${g.kind}`)}</div>`;
      if (g.kind === "line") html += readout(t("panel.length"), dist(doc.points[g.p1], doc.points[g.p2]));
      if (g.kind === "circle") html += readout(t("panel.radius"), g.r);
      if (g.kind === "arc") html += readout(t("panel.radius"), arcRadius(doc, g));
      html += check(g.id, "construction", !!g.construction, t("panel.construction") + " (X)");
      html += check(g.id, "track", !!g.track, t("panel.track") + " (K)");
    } else if (sel.length === 1 && doc.points[sel[0]]) {
      const p = doc.points[sel[0]];
      html += `<div class="prop-head">${t("geom.point")}</div>`;
      html += `<div class="readout"><span>${t("panel.position")}</span><b>${p.x.toFixed(2)}, ${p.y.toFixed(2)}</b></div>`;
    } else {
      html += `<div class="prop-head">${t("panel.selected", { n: sel.length })}</div>`;
    }

    // Constraints that fit the current selection.
    const geomSel = sel.filter((id) => id in doc.points || id in doc.geoms);
    if (geomSel.length) {
      const fits = constraintTypes
        .all()
        .filter((c) => !c.dimension && !c.hidden && typeof c.fromSelection(doc, geomSel) !== "string");
      if (fits.length) {
        html += `<div class="panel-title">${t("panel.addConstraint")}</div><div class="chips">`;
        html += fits
          .map((c) => `<button class="chip" data-apply="${c.id}">${constraintIcon(c.id, esc(c.glyph), 14)}${t(c.label)}${c.shortcut ? `<kbd>${c.shortcut.toUpperCase()}</kbd>` : ""}</button>`)
          .join("");
        html += `</div>`;
      }
    }
    el.innerHTML = html;
  };

  ed.subscribe(update);
  update();
}

function readout(label: string, v: number): string {
  return `<div class="readout"><span>${label}</span><b>${v.toFixed(2)} mm</b></div>`;
}

function check(id: Id, field: string, on: boolean, label: string): string {
  return `<label class="check"><input type="checkbox" data-id="${id}" data-field="${field}" ${on ? "checked" : ""}> ${label}</label>`;
}
