import type { Editor } from "../app/editor";
import { arcRadius, deleteItems, type Geometry, type Id } from "../core/model";
import { LABEL_SIZE, labelBody, labelsOf } from "../core/labels";
import { ownerMap } from "../motion/bodies";
import { dist } from "../core/geom";
import { constraintTypes } from "../constraints";
import { fitSelection, stackOf } from "../constraints/select";
import { dimText, isWatched, measured } from "../render/layout";
import { t } from "../i18n";
import { actions } from "./actions";
import { constraintIcon, icons } from "./icons";
import type { SliderMotion } from "./sliderMotion";
import { toggleTrace } from "../tools/motion";
import { timelinePlayer } from "./timeline";
import { bodiesSection, bodyProps, motionProps, motionTree, patchSliders, wireMotionPanel } from "./motionPanels";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

function geomName(g: Geometry, index: number): string {
  return `${t(`geom.${g.kind}`)} ${index}`;
}

export function constraintName(ed: Editor, id: Id): string {
  const c = ed.doc.constraints[id];
  const def = constraintTypes.get(c.type);
  return def.dimension ? `${t(def.label)} ${dimText(ed.doc, c)}` : t(def.label);
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
        ${labelsOf(ed.doc).length ? `<details open><summary>${t("panel.labels")} <span class="count">${labelsOf(ed.doc).length}</span></summary>${labelsOf(ed.doc).map((l) => row(l.id, l.text, "kind-label")).join("")}</details>` : ""}
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
    const line = (e.target as HTMLElement).closest<HTMLElement>("[data-line-color]");
    if (line) {
      // "" is Auto: back to blue/black for free/defined.
      const color = line.dataset.lineColor || undefined;
      const ids = [...ed.selection].filter((id) => id in ed.doc.geoms);
      const labels = [...ed.selection].filter((id) => id in (ed.doc.labels ?? {}));
      if (ids.length || labels.length)
        ed.change((doc) => {
          ids.forEach((id) => (color ? (doc.geoms[id].color = color) : delete doc.geoms[id].color));
          labels.forEach((id) => (color ? (doc.labels[id].color = color) : delete doc.labels[id].color));
        });
      else ed.live((doc) => (doc.settings.pen = { ...doc.settings.pen, color }));
      return;
    }
    const detach = (e.target as HTMLElement).closest<HTMLElement>("[data-label-detach]");
    if (detach) {
      // Keep it where it is, as a free label.
      const id = detach.dataset.labelDetach!;
      ed.change((doc) => {
        const l = doc.labels[id];
        const p = l.point ? doc.points[l.point] : undefined;
        if (p) Object.assign(l, { x: p.x + l.x, y: p.y + l.y });
        delete l.point;
      });
      return;
    }
    const remove = (e.target as HTMLElement).closest<HTMLElement>("[data-remove]");
    if (remove) {
      const cid = remove.dataset.remove!;
      ed.change((doc) => delete doc.constraints[cid]);
      return;
    }
    const pick = (e.target as HTMLElement).closest<HTMLElement>("[data-color]");
    if (pick) {
      const id = pick.dataset.id!, color = pick.dataset.color!;
      ed.change((doc) => (doc.bodies[id].color = color));
      return;
    }
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
      // Every selected line, arc and circle, so several can be switched at once.
      const ids = [...ed.selection].filter((g) => g in ed.doc.geoms);
      ed.change((doc) => ids.forEach((g) => (doc.geoms[g][field] = input.checked)));
    } else if (field === "penConstruction") {
      ed.live((doc) => (doc.settings.pen = { ...doc.settings.pen, construction: input.checked }));
    } else if (field === "labelText") {
      const text = input.value.trim();
      ed.change((doc) => (text ? (doc.labels[id].text = text) : deleteItems(doc, [id])));
    } else if (field === "labelSize") {
      const v = parseFloat(input.value);
      if (Number.isFinite(v) && v >= 6 && v <= 200) ed.change((doc) => (v === LABEL_SIZE ? delete doc.labels[id].size : (doc.labels[id].size = v)));
    } else if (field === "bodyName") {
      const name = input.value.trim();
      if (name) ed.change((doc) => (doc.bodies[id].name = name));
    } else if (field === "watch") {
      // Watching turns a dimension into a measurement; unwatching keeps what it measures now.
      ed.change((doc) => {
        const c = doc.constraints[id];
        const def = constraintTypes.get(c.type);
        const data = { ...(c.data ?? {}) };
        if (input.checked) data.watch = 1;
        else {
          delete data.watch;
          if (def.shape) c.value = measured(def.shape(doc, c));
        }
        if (Object.keys(data).length) c.data = data;
        else delete c.data;
      });
    } else if (field === "mesh") {
      // Gears (or a rack) mesh and roll; untick for a cam that slides.
      ed.change((doc) => {
        const c = doc.constraints[id];
        const data = { ...(c.data ?? {}) };
        if (input.checked) delete data.cam;
        else data.cam = 1;
        if (Object.keys(data).length) c.data = data;
        else delete c.data;
      });
    } else if (field === "canTurn") {
      // A slider joint either turns on its pin as it slides, or only slides.
      ed.change((doc) => {
        const c = doc.constraints[id];
        const data = { ...(c.data ?? {}) };
        if (input.checked) delete data.noTurn;
        else data.noTurn = 1;
        c.data = Object.keys(data).length ? data : undefined;
        if (!c.data) delete c.data;
      });
    } else if (field === "cyclePath") {
      ed.change((doc) => (input.checked ? delete doc.motion.hideCycle : (doc.motion.hideCycle = true)));
    } else if (field === "trail") {
      const v = parseFloat(input.value);
      if (Number.isFinite(v) && v >= 0) ed.change((doc) => (doc.motion.trail = v));
      input.blur();
    } else if (field === "trace") {
      toggleTrace(ed, id);
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
      if (focused || sliders.active || timelinePlayer()?.playing) patchSliders(el, ed);
      else el.innerHTML = motionProps(ed);
      return;
    }
    if (focused) return;
    const doc = ed.doc;
    const sel = [...ed.selection];
    let html = `<div class="panel-title">${t("panel.properties")}</div>`;

    if (sel.length === 0) {
      const pen = doc.settings.pen ?? {};
      html += `<p class="muted">${t("panel.nothingSelected")}</p>
        <div class="panel-title">${t("panel.pen")}</div>
        ${check("", "penConstruction", !!pen.construction, t("panel.construction") + " (X)")}
        ${colorField(pen.color)}
        <div class="panel-title">${t("panel.settings")}</div>
        <label class="field">${t("panel.barWidth")}<input type="number" min="0.5" step="0.5" data-field="barWidth" data-id="" value="${doc.settings.barWidth}"></label>`;
    } else if (sel.length === 1 && doc.constraints[sel[0]]) {
      const c = doc.constraints[sel[0]];
      const def = constraintTypes.get(c.type);
      html += `<div class="prop-head">${constraintIcon(def.id, esc(def.glyph), 16)}${t(def.label)}</div>`;
      if (def.dimension) {
        if (!isWatched(c)) html += `<label class="field">${t("panel.value")} (${def.unit === "deg" ? "°" : "mm"})<input type="number" step="any" data-field="value" data-id="${c.id}" value="${c.value}"></label>`;
        else html += `<div class="readout"><span>${t("panel.value")}</span><b>${dimText(doc, c)}</b></div>`;
        html += check(c.id, "watch", isWatched(c), t("panel.watch"));
      }
      html += `<button class="btn danger" data-delete="1">${t("panel.delete")}</button>`;
    } else if (sel.length === 1 && doc.bodies[sel[0]]) {
      html += bodyProps(ed, doc.bodies[sel[0]]);
    } else if (sel.length === 1 && doc.labels?.[sel[0]]) {
      const l = doc.labels[sel[0]];
      const body = labelBody(ownerMap(doc), l);
      html += `<div class="prop-head">${t("panel.label")}</div>
        <label class="field">${t("panel.labelText")}<input type="text" data-field="labelText" data-id="${l.id}" value="${esc(l.text)}"></label>
        <label class="field">${t("panel.labelSize")}<input type="number" min="6" max="200" step="1" data-field="labelSize" data-id="${l.id}" value="${l.size ?? LABEL_SIZE}"></label>
        ${colorField(l.color)}
        <div class="readout"><span>${t("panel.labelBody")}</span><b>${body ? esc(doc.bodies[body].name) : t("panel.labelFree")}</b></div>`;
      if (l.point) html += `<div class="readout"><span>${t("panel.labelNames")}</span><b>${t("geom.point")}</b></div><button class="btn" data-label-detach="${l.id}">${t("panel.labelDetach")}</button>`;
      html += `<button class="btn danger" data-delete="1">${t("panel.delete")}</button>`;
    } else if (sel.length === 1 && doc.geoms[sel[0]]) {
      const g = doc.geoms[sel[0]];
      html += `<div class="prop-head">${t(`geom.${g.kind}`)}</div>`;
      if (g.kind === "line") html += readout(t("panel.length"), dist(doc.points[g.p1], doc.points[g.p2]));
      if (g.kind === "circle") html += readout(t("panel.radius"), g.r);
      if (g.kind === "arc") html += readout(t("panel.radius"), arcRadius(doc, g));
      html += geomFlags([g]);
    } else if (doc.points[sel[0]] && sel.every((id) => stackOf(doc, sel[0]).includes(id))) {
      // One point, or one stack of joined points where several lines meet.
      const p = doc.points[sel[0]];
      html += `<div class="prop-head">${t("geom.point")}${sel.length > 1 ? ` <span class="muted">${t("panel.joinedPoints", { n: sel.length })}</span>` : ""}</div>`;
      html += `<div class="readout"><span>${t("panel.position")}</span><b>${p.x.toFixed(2)}, ${p.y.toFixed(2)}</b></div>`;
    } else {
      html += `<div class="prop-head">${t("panel.selected", { n: sel.length })}</div>`;
      const gs = sel.map((id) => doc.geoms[id]).filter(Boolean);
      if (gs.length) html += geomFlags(gs);
    }

    // Constraints already on the selected items, each with its own delete button.
    const on = new Set(sel.filter((id) => id in doc.points || id in doc.geoms));
    const existing = Object.values(doc.constraints).filter((c) => c.refs.some((r) => on.has(r)));
    if (existing.length) {
      html += `<div class="panel-title">${t("panel.constraints")}</div><div class="cons-list">`;
      html += existing
        .map((c) => {
          const def = constraintTypes.get(c.type);
          return `<div class="cons-row${ed.analysis.conflicting.has(c.id) ? " bad" : ""}">${constraintIcon(def.id, esc(def.glyph), 14)}<span>${esc(constraintName(ed, c.id))}</span><button class="x" data-remove="${c.id}" title="${t("panel.delete")}">×</button></div>`;
        })
        .join("");
      html += `</div>`;
    }

    // Constraints that fit the current selection.
    const geomSel = sel.filter((id) => id in doc.points || id in doc.geoms);
    if (geomSel.length) {
      const fits = constraintTypes
        .all()
        .filter((c) => !c.dimension && !c.hidden && typeof fitSelection(c, doc, geomSel) !== "string");
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

/** Colours a line, arc or circle can be given; "" is Auto (blue while free, black once defined). */
const LINE_COLORS = ["", "#d93025", "#f28c18", "#2e9d4f", "#0b8a7a", "#2069e0", "#8e44ad", "#d81b60", "#5f6b7a"];

function colorField(current: string | undefined): string {
  const picks = LINE_COLORS.map((c) => {
    const on = (current ?? "") === c ? " on" : "";
    const style = c ? `background:${c}` : "";
    return `<button class="pick${c ? "" : " auto"}${on}" data-line-color="${c}" style="${style}" title="${c || t("panel.colorAuto")}"></button>`;
  }).join("");
  return `<div class="field">${t("panel.color")}<span class="palette">${picks}</span></div>`;
}

/** Construction, track and colour for one or more selected lines, arcs and circles. */
function geomFlags(gs: Geometry[]): string {
  const first = gs[0].id;
  const all = (f: "construction" | "track") => gs.every((g) => g[f]);
  const color = gs.every((g) => g.color === gs[0].color) ? gs[0].color : "mixed";
  return check(first, "construction", all("construction"), t("panel.construction") + " (X)") + check(first, "track", all("track"), t("panel.track") + " (K)") + colorField(color);
}

function readout(label: string, v: number): string {
  return `<div class="readout"><span>${label}</span><b>${v.toFixed(2)} mm</b></div>`;
}

function check(id: Id, field: string, on: boolean, label: string): string {
  return `<label class="check"><input type="checkbox" data-id="${id}" data-field="${field}" ${on ? "checked" : ""}> ${label}</label>`;
}
