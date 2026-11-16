import type { Editor } from "../app/editor";
import { arcRadius, geomPoints, type Geometry, type Id } from "../core/model";
import { add, angleOf, norm, perp, scale, sub } from "../core/geom";
import { tools } from "../tools";
import { drawSnap } from "../tools/snap";
import { colors } from "./style";
import { ICON, isWatched, layoutDims, layoutIcons } from "./layout";
import { drawDimension, roundRect } from "./dimension";
import type { View } from "./view";
import { drawConstraintIcon } from "./icons";
import { drawBodies, drawBodyLines, drawJointLetters, drawJoints, drawLooseGeometry } from "./bars";
import { posedDoc } from "../motion/bodies";
import { drawTraces } from "./traces";
import { relationGroups, type GroupColors } from "./relations";
import { drawLabels, layoutLabels } from "./labels";
import { labelAt } from "../core/labels";
import { labelMotionAt } from "../motion/labels";
import { ownerMap } from "../motion/bodies";

/** Draws the sketch. Stateless: everything comes from the editor. */
export function render(ctx: CanvasRenderingContext2D, ed: Editor, w: number, h: number): void {
  const v = ed.view;
  ctx.save();
  ctx.fillStyle = colors.background;
  ctx.fillRect(0, 0, w, h);
  drawGrid(ctx, v, w, h);

  const doc = ed.doc;
  if (ed.mode === "motion") {
    // Motion mode: no constraints or dimensions, just bars, slots and joints.
    drawLooseGeometry(ctx, ed);
    drawBodies(ctx, ed, { posed: true, alpha: 1, hover: ed.hover });
    drawBodyLines(ctx, ed);
    drawTraces(ctx, ed);
    drawJoints(ctx, ed);
    drawJointLetters(ctx, ed);
    if (doc.settings.showLabels !== false) {
      const owner = ownerMap(doc);
      drawLabels(ctx, layoutLabels(doc, v, (l) => labelMotionAt(doc, owner, l)), () => false, () => false);
    }
    // Watched dimensions, measured where the bodies are now.
    const posed = posedDoc(doc);
    for (const d of layoutDims(posed, v, true)) drawDimension(ctx, v, d, ed.selection.has(d.cid), ed.hover === d.cid, null, colors.watch);
    tools.find(ed.tool)?.overlay?.({ ctx, ed });
    ctx.restore();
    return;
  }
  if (Object.keys(doc.bodies).length) {
    drawBodies(ctx, ed, { posed: false, alpha: doc.settings.solidBars ? 0.9 : 0.35, hover: ed.hover });
  }
  const hoverRefs = new Set<Id>();
  const selRefs = new Set<Id>();
  // Hovering or selecting a constraint highlights what it ties together.
  for (const [id, set] of [
    [ed.hover, hoverRefs],
    ...[...ed.selection].map((s) => [s, selRefs] as const),
  ] as [Id | null, Set<Id>][]) {
    const c = id ? doc.constraints[id] : undefined;
    if (c) c.refs.forEach((r) => set.add(r));
    const b = id ? doc.bodies[id] : undefined;
    if (b) b.members.forEach((r) => set.add(r));
  }
  // Over-constraint: the newest culprit and what it touches in dark red, the
  // other constraints that would also fix it in light red.
  const badRef = new Map<Id, string>();
  for (const cid of ed.analysis.fixes) doc.constraints[cid]?.refs.forEach((r) => badRef.set(r, colors.conflictSoft));
  for (const cid of ed.analysis.culprits) doc.constraints[cid]?.refs.forEach((r) => badRef.set(r, colors.conflict));
  const badCons = (cid: Id) => (ed.analysis.culprits.has(cid) ? colors.conflict : ed.analysis.fixes.has(cid) ? colors.conflictSoft : null);

  const equalColors = doc.settings.showRelations ? relationGroups(doc, "equal") : null;
  const parallelColors = doc.settings.showRelations ? relationGroups(doc, "parallel", 5) : null;
  for (const g of Object.values(doc.geoms)) {
    const isSel = ed.selection.has(g.id) || selRefs.has(g.id);
    const isHover = ed.hover === g.id || hoverRefs.has(g.id);
    drawGeom(ctx, ed, g, isSel, isHover, badRef.get(g.id) ?? null, equalColors?.get(g.id));
  }
  if (parallelColors) drawParallelMarks(ctx, ed, parallelColors);

  for (const p of Object.values(doc.points)) {
    const s = v.toScreen(p);
    const sel = ed.selection.has(p.id) || selRefs.has(p.id);
    const hov = ed.hover === p.id || hoverRefs.has(p.id);
    ctx.fillStyle = sel ? colors.selected : hov ? colors.hover : (badRef.get(p.id) ?? (ed.analysis.free.has(p.id) ? colors.free : colors.defined));
    ctx.beginPath();
    ctx.arc(s.x, s.y, sel || hov ? 4 : 2.6, 0, Math.PI * 2);
    ctx.fill();
  }

  if (doc.settings.showLabels !== false) {
    drawLabels(
      ctx,
      layoutLabels(doc, v, (l) => labelAt(doc, l)),
      (id) => ed.selection.has(id) || selRefs.has(id),
      (id) => ed.hover === id || hoverRefs.has(id),
    );
  }

  for (const d of layoutDims(doc, v)) {
    const c = doc.constraints[d.cid];
    drawDimension(ctx, v, d, ed.selection.has(c.id), ed.hover === c.id, badCons(c.id), isWatched(c) ? colors.watch : undefined);
  }

  if (doc.settings.showConstraintIcons) {
    for (const b of layoutIcons(doc, v)) {
      const sel = ed.selection.has(b.cid);
      const hov = ed.hover === b.cid;
      const bad = badCons(b.cid);
      ctx.fillStyle = sel ? colors.selected : hov ? colors.hover : colors.iconBg;
      ctx.strokeStyle = bad ?? colors.iconBorder;
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      roundRect(ctx, b.x, b.y, ICON, ICON, 3);
      ctx.fill();
      ctx.stroke();
      const ink = sel || hov ? "#fff" : (bad ?? colors.iconText);
      ctx.strokeStyle = ink;
      if (!drawConstraintIcon(ctx, b.type, b.x + 2, b.y + 2, ICON - 4)) {
        ctx.fillStyle = ink;
        ctx.font = "11px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(b.glyph, b.x + ICON / 2, b.y + ICON / 2 + 0.5);
      }
    }
  }

  tools.find(ed.tool)?.overlay?.({ ctx, ed });
  drawSnap(ctx, v, ed.snap);
  ctx.restore();
}

function drawGrid(ctx: CanvasRenderingContext2D, v: View, w: number, h: number) {
  // Pick a grid step that stays 8-80 px apart on screen.
  const steps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];
  const step = steps.find((s) => s * v.zoom >= 8) ?? 5000;
  const major = step * 5;
  const tl = v.toWorld({ x: 0, y: 0 });
  const br = v.toWorld({ x: w, y: h });
  ctx.lineWidth = 1;
  for (const [s, color] of [
    [step, colors.gridMinor],
    [major, colors.gridMajor],
  ] as const) {
    ctx.strokeStyle = color;
    ctx.beginPath();
    for (let x = Math.floor(tl.x / s) * s; x <= br.x; x += s) {
      const sx = Math.round(v.toScreen({ x, y: 0 }).x) + 0.5;
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, h);
    }
    for (let y = Math.floor(br.y / s) * s; y <= tl.y; y += s) {
      const sy = Math.round(v.toScreen({ x: 0, y }).y) + 0.5;
      ctx.moveTo(0, sy);
      ctx.lineTo(w, sy);
    }
    ctx.stroke();
  }
  const o = v.toScreen({ x: 0, y: 0 });
  ctx.strokeStyle = colors.axis;
  ctx.beginPath();
  ctx.moveTo(o.x + 0.5, 0);
  ctx.lineTo(o.x + 0.5, h);
  ctx.moveTo(0, o.y + 0.5);
  ctx.lineTo(w, o.y + 0.5);
  ctx.stroke();
}

function geomColor(ed: Editor, g: Geometry, bad: string | null): string {
  if (bad) return bad;
  if (g.color) return g.color;
  if (g.track) return colors.track;
  const free = geomPoints(g).some((p) => ed.analysis.free.has(p)) || ed.analysis.freeRadii.has(g.id);
  return free ? colors.free : colors.defined;
}

function drawGeom(ctx: CanvasRenderingContext2D, ed: Editor, g: Geometry, sel: boolean, hover: boolean, bad: string | null, group?: string) {
  const v = ed.view;
  const doc = ed.doc;
  ctx.setLineDash(g.construction ? [6, 4] : []);
  const path = () => {
    ctx.beginPath();
    if (g.kind === "line") {
      const a = v.toScreen(doc.points[g.p1]), b = v.toScreen(doc.points[g.p2]);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    } else if (g.kind === "circle") {
      const c = v.toScreen(doc.points[g.c]);
      ctx.arc(c.x, c.y, g.r * v.zoom, 0, Math.PI * 2);
    } else {
      const cw = doc.points[g.c], s = doc.points[g.s], e = doc.points[g.e];
      const c = v.toScreen(cw);
      const a0 = angleOf(sub(s, cw)), a1 = angleOf(sub(e, cw));
      ctx.arc(c.x, c.y, arcRadius(doc, g) * v.zoom, -a0, -a1, true);
    }
  };
  if (sel || hover) {
    ctx.strokeStyle = sel ? colors.selected : colors.hover;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 7;
    path();
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  ctx.strokeStyle = sel ? colors.selected : (bad ?? group ?? geomColor(ed, g, bad));
  ctx.lineWidth = group ? 3 : g.track ? 2.5 : g.construction ? 1.2 : 1.6;
  path();
  ctx.stroke();
  ctx.setLineDash([]);
}

/** Two short ticks across the middle of each parallel line, in its group's colour. */
function drawParallelMarks(ctx: CanvasRenderingContext2D, ed: Editor, groups: GroupColors) {
  const v = ed.view;
  ctx.save();
  ctx.setLineDash([]);
  ctx.lineWidth = 2.2;
  ctx.lineCap = "round";
  for (const [id, color] of groups) {
    const g = ed.doc.geoms[id];
    if (g?.kind !== "line") continue;
    const a = v.toScreen(ed.doc.points[g.p1]), b = v.toScreen(ed.doc.points[g.p2]);
    const d = norm(sub(b, a)), n = perp(d);
    const m = scale(add(a, b), 0.5);
    ctx.strokeStyle = color;
    ctx.beginPath();
    for (const k of [-3, 3]) {
      const c = add(m, scale(d, k));
      // Slanted like the ∥ glyph.
      ctx.moveTo(c.x + n.x * 6 + d.x * 2, c.y + n.y * 6 + d.y * 2);
      ctx.lineTo(c.x - n.x * 6 - d.x * 2, c.y - n.y * 6 - d.y * 2);
    }
    ctx.stroke();
  }
  ctx.restore();
}
