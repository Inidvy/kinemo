import type { Editor } from "../app/editor";
import { arcRadius, geomPoints, type Geometry, type Id, type Vec } from "../core/model";
import { add, angleOf, norm, perp, scale, sub } from "../core/geom";
import { tools } from "../tools";
import { colors } from "./style";
import { ICON, layoutDims, layoutIcons, linearOffset, type DimLayout } from "./layout";
import type { View } from "./view";
import { drawConstraintIcon } from "../ui/icons";
import { drawBodies, drawJoints, drawLooseGeometry } from "./bars";

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
    drawJoints(ctx, ed);
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

  for (const g of Object.values(doc.geoms)) {
    const isSel = ed.selection.has(g.id) || selRefs.has(g.id);
    const isHover = ed.hover === g.id || hoverRefs.has(g.id);
    drawGeom(ctx, ed, g, isSel, isHover, badRef.get(g.id) ?? null);
  }

  for (const p of Object.values(doc.points)) {
    const s = v.toScreen(p);
    const sel = ed.selection.has(p.id) || selRefs.has(p.id);
    const hov = ed.hover === p.id || hoverRefs.has(p.id);
    ctx.fillStyle = sel ? colors.selected : hov ? colors.hover : (badRef.get(p.id) ?? (ed.analysis.free.has(p.id) ? colors.free : colors.defined));
    ctx.beginPath();
    ctx.arc(s.x, s.y, sel || hov ? 4 : 2.6, 0, Math.PI * 2);
    ctx.fill();
  }

  for (const d of layoutDims(doc, v)) {
    const c = doc.constraints[d.cid];
    drawDimension(ctx, v, d, ed.selection.has(c.id), ed.hover === c.id, badCons(c.id));
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
  if (g.track) return colors.track;
  const free = geomPoints(g).some((p) => ed.analysis.free.has(p)) || ed.analysis.freeRadii.has(g.id);
  return free ? colors.free : colors.defined;
}

function drawGeom(ctx: CanvasRenderingContext2D, ed: Editor, g: Geometry, sel: boolean, hover: boolean, bad: string | null) {
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
  ctx.strokeStyle = sel ? colors.selected : geomColor(ed, g, bad);
  ctx.lineWidth = g.track ? 2.5 : g.construction ? 1.2 : 1.6;
  path();
  ctx.stroke();
  ctx.setLineDash([]);
}

function arrow(ctx: CanvasRenderingContext2D, at: Vec, dir: Vec) {
  const d = norm(dir), n = perp(d);
  const back = sub(at, scale(d, 8));
  ctx.beginPath();
  ctx.moveTo(at.x, at.y);
  ctx.lineTo(back.x + n.x * 3, back.y + n.y * 3);
  ctx.lineTo(back.x - n.x * 3, back.y - n.y * 3);
  ctx.closePath();
  ctx.fill();
}

export function drawDimension(
  ctx: CanvasRenderingContext2D,
  v: View,
  d: DimLayout,
  sel: boolean,
  hover: boolean,
  bad: string | null,
  ink: string = colors.dimension,
) {
  const color = bad ?? (sel ? colors.selected : hover ? colors.hover : ink);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  const text = v.toScreen(d.text);
  const sh = d.shape;

  if (sh.kind === "linear") {
    const off = linearOffset(sh, d.text);
    const n = perp(norm(sub(sh.b, sh.a)));
    const a2 = add(sh.a, scale(n, off)), b2 = add(sh.b, scale(n, off));
    const [sa, sb, sa2, sb2] = [sh.a, sh.b, a2, b2].map((p) => v.toScreen(p));
    const ext = scale(norm(sub(sa2, sa)), 4);
    ctx.beginPath();
    ctx.moveTo(sa.x, sa.y);
    ctx.lineTo(sa2.x + ext.x, sa2.y + ext.y);
    ctx.moveTo(sb.x, sb.y);
    ctx.lineTo(sb2.x + ext.x, sb2.y + ext.y);
    ctx.moveTo(sa2.x, sa2.y);
    ctx.lineTo(sb2.x, sb2.y);
    ctx.stroke();
    arrow(ctx, sa2, sub(sa2, sb2));
    arrow(ctx, sb2, sub(sb2, sa2));
  } else if (sh.kind === "angle") {
    const cs = v.toScreen(sh.center);
    const r = Math.hypot(text.x - cs.x, text.y - cs.y);
    let sweep = sh.d2 - sh.d1;
    while (sweep <= -Math.PI) sweep += 2 * Math.PI;
    while (sweep > Math.PI) sweep -= 2 * Math.PI;
    ctx.beginPath();
    ctx.arc(cs.x, cs.y, r, -sh.d1, -(sh.d1 + sweep), sweep > 0);
    ctx.stroke();
  } else {
    const cs = v.toScreen(sh.center);
    const dir = norm(sub(text, cs));
    const rim = add(cs, scale(dir, sh.r * v.zoom));
    const from = sh.diameter ? sub(cs, scale(dir, sh.r * v.zoom)) : cs;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(text.x, text.y);
    ctx.stroke();
    arrow(ctx, rim, dir);
    if (sh.diameter) arrow(ctx, from, scale(dir, -1));
  }

  // Value label on a white pill so it reads over lines.
  ctx.font = "12px system-ui, sans-serif";
  const label = d.label;
  const tw = ctx.measureText(label).width + 8;
  ctx.fillStyle = colors.background;
  roundRect(ctx, text.x - tw / 2, text.y - 9, tw, 18, 4);
  ctx.fill();
  if (sel || hover) {
    ctx.strokeStyle = color;
    ctx.stroke();
  }
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, text.x, text.y + 0.5);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
