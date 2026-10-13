import type { Editor } from "../app/editor";
import { arcRadius, type Body, type Geometry, type Id, type Pose, type SketchDoc, type Vec } from "../core/model";
import { angleInSweep, angleOf, dist, distToSegment, sub } from "../core/geom";
import { applyPose, bodyColor, bodyGeoms, IDENTITY, poseOf } from "../motion/bodies";
import { jointKinds, type Joint } from "../motion/joints";
import { colors } from "./style";
import type { View } from "./view";

// Bars, slots and joints, drawn in the MotionGen style: rounded bars with a
// dark outline, slots as a very light channel, joints as small white circles.

export interface BarStyle {
  /** Draw bodies where they are in Motion mode (otherwise as sketched). */
  posed: boolean;
  alpha: number;
  selected: Set<Id>;
  hover: Id | null;
}

/** Lines that a slot joint runs along are drawn as slots, not bars. */
function slotGeoms(joints: Joint[]): Set<Id> {
  const out = new Set<Id>();
  for (const j of joints) {
    if (j.kind === "slot") out.add(j.refs[3]);
    if (j.kind === "curveSlot") out.add(j.refs[2]);
  }
  return out;
}

const isSlot = (slots: Set<Id>, g: Geometry) => slots.has(g.id);

/** Trace a body's geometry as a path in screen space. */
function tracePath(ctx: CanvasRenderingContext2D, doc: SketchDoc, v: View, pose: Pose, g: Geometry) {
  const P = (id: Id) => v.toScreen(applyPose(pose, doc.points[id]));
  ctx.beginPath();
  if (g.kind === "line") {
    const a = P(g.p1), b = P(g.p2);
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
  } else if (g.kind === "circle") {
    const c = P(g.c);
    ctx.arc(c.x, c.y, g.r * v.zoom, 0, Math.PI * 2);
  } else {
    const c = P(g.c);
    const a0 = angleOf(sub(doc.points[g.s], doc.points[g.c])) + pose.a;
    const a1 = angleOf(sub(doc.points[g.e], doc.points[g.c])) + pose.a;
    ctx.arc(c.x, c.y, arcRadius(doc, g) * v.zoom, -a0, -a1, true);
  }
}

function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => Math.round(Math.max(0, Math.min(255, c * k)));
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

export function drawBodies(ctx: CanvasRenderingContext2D, ed: Editor, style: BarStyle): void {
  const doc = ed.doc;
  const v = ed.view;
  const w = Math.max(3, doc.settings.barWidth * v.zoom);
  const slots = slotGeoms(ed.mech.joints);
  ctx.save();
  ctx.globalAlpha = style.alpha;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.setLineDash([]);
  // Ground first so moving bars sit on top of it.
  const bodies = Object.values(doc.bodies).sort((a, b) => Number(!!b.ground) - Number(!!a.ground));
  for (const b of bodies) {
    const pose = style.posed ? poseOf(doc, b.id) : IDENTITY;
    const color = bodyColor(doc, b);
    const geoms = bodyGeoms(doc, b).filter((g) => !g.construction);
    const outline = ed.selection.has(b.id) || style.selected.has(b.id) ? colors.selected : style.hover === b.id ? colors.hover : shade(color, 0.55);

    // Slots: a light channel with a thin edge.
    for (const g of geoms.filter((g) => g.track || isSlot(slots, g))) {
      tracePath(ctx, doc, v, pose, g);
      ctx.strokeStyle = shade(color, 0.7);
      ctx.lineWidth = w * 1.15 + 2;
      ctx.stroke();
      tracePath(ctx, doc, v, pose, g);
      ctx.strokeStyle = g.track ? "#f6effa" : "#f7f9fb";
      ctx.lineWidth = w * 1.15;
      ctx.stroke();
      tracePath(ctx, doc, v, pose, g);
      ctx.strokeStyle = g.track ? colors.track : shade(color, 0.7);
      ctx.lineWidth = 1;
      ctx.globalAlpha = style.alpha * 0.5;
      ctx.stroke();
      ctx.globalAlpha = style.alpha;
    }
    // Bars: outline pass, then fill pass, so overlapping bars of one body merge.
    const bars = geoms.filter((g) => !g.track && !isSlot(slots, g));
    const loose = b.members.filter((id) => doc.points[id]).map((id) => v.toScreen(applyPose(pose, doc.points[id])));
    for (const [stroke, width] of [
      [outline, w + 3],
      [color, w],
    ] as const) {
      ctx.strokeStyle = stroke;
      ctx.fillStyle = stroke;
      ctx.lineWidth = width;
      for (const g of bars) {
        tracePath(ctx, doc, v, pose, g);
        ctx.stroke();
      }
      for (const p of loose) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, width / 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  ctx.restore();
}

/** Joints as small white circles, ground pivots with a hatched base, driven joints with an arrow. */
export function drawJoints(ctx: CanvasRenderingContext2D, ed: Editor): void {
  const doc = ed.doc;
  const v = ed.view;
  const m = ed.mech;
  const k = m.context(m.current());
  const r = Math.max(3.5, doc.settings.barWidth * v.zoom * 0.28);
  const driven = new Set(Object.values(doc.motion.drivers).map((d) => d.joint));
  ctx.save();
  ctx.setLineDash([]);
  for (const j of m.joints) {
    const at = v.toScreen(jointKinds.get(j.kind).anchor(k, j));
    const ground = doc.bodies[j.a]?.ground || doc.bodies[j.b]?.ground;
    if (ground && j.kind === "pin") groundSymbol(ctx, at, r);
    const sel = ed.selection.has(j.id), hov = ed.hover === j.id;
    ctx.beginPath();
    ctx.arc(at.x, at.y, r, 0, Math.PI * 2);
    ctx.fillStyle = "#fff";
    ctx.fill();
    ctx.lineWidth = sel || hov ? 2.5 : 1.6;
    ctx.strokeStyle = sel ? colors.selected : hov ? colors.hover : "#2b2f36";
    ctx.stroke();
    if (driven.has(j.id)) motorArrow(ctx, at, r + 5);
  }
  ctx.restore();
}

function groundSymbol(ctx: CanvasRenderingContext2D, at: Vec, r: number) {
  const h = r * 2.6;
  ctx.beginPath();
  ctx.moveTo(at.x, at.y);
  ctx.lineTo(at.x - h * 0.7, at.y + h);
  ctx.lineTo(at.x + h * 0.7, at.y + h);
  ctx.closePath();
  ctx.fillStyle = "#e3e6eb";
  ctx.fill();
  ctx.strokeStyle = "#5b6270";
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.beginPath();
  const y = at.y + h;
  ctx.moveTo(at.x - h, y);
  ctx.lineTo(at.x + h, y);
  for (let x = at.x - h + 3; x <= at.x + h; x += 5) {
    ctx.moveTo(x, y);
    ctx.lineTo(x - 4, y + 5);
  }
  ctx.stroke();
}

function motorArrow(ctx: CanvasRenderingContext2D, at: Vec, r: number) {
  ctx.strokeStyle = colors.free;
  ctx.fillStyle = colors.free;
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.arc(at.x, at.y, r, -Math.PI * 0.9, Math.PI * 0.35);
  ctx.stroke();
  const a = Math.PI * 0.35;
  const tip = { x: at.x + Math.cos(a) * r, y: at.y + Math.sin(a) * r };
  const t = { x: -Math.sin(a), y: Math.cos(a) };
  ctx.beginPath();
  ctx.moveTo(tip.x + t.x * 5, tip.y + t.y * 5);
  ctx.lineTo(tip.x - t.y * 4, tip.y + t.x * 4);
  ctx.lineTo(tip.x + t.y * 4, tip.y - t.x * 4);
  ctx.closePath();
  ctx.fill();
}

/** What is under the cursor in Motion mode: a joint, then the top-most body. */
export function motionHit(ed: Editor, s: Vec): { kind: "joint"; id: Id } | { kind: "body"; id: Id } | null {
  const doc = ed.doc;
  const v = ed.view;
  const m = ed.mech;
  const k = m.context(m.current());
  const r = Math.max(8, doc.settings.barWidth * v.zoom * 0.35);
  for (const j of m.joints) {
    if (dist(v.toScreen(jointKinds.get(j.kind).anchor(k, j)), s) <= r) return { kind: "joint", id: j.id };
  }
  const half = Math.max(6, (doc.settings.barWidth * v.zoom) / 2 + 2);
  const bodies = Object.values(doc.bodies).sort((a, b) => Number(!!a.ground) - Number(!!b.ground));
  for (const b of bodies) if (bodyDistance(doc, v, b, s) <= half) return { kind: "body", id: b.id };
  return null;
}

function bodyDistance(doc: SketchDoc, v: View, b: Body, s: Vec): number {
  const pose = poseOf(doc, b.id);
  const P = (id: Id) => v.toScreen(applyPose(pose, doc.points[id]));
  let best = Infinity;
  for (const id of b.members) {
    const g = doc.geoms[id];
    if (!g) {
      if (doc.points[id]) best = Math.min(best, dist(P(id), s));
      continue;
    }
    if (g.kind === "line") best = Math.min(best, distToSegment(s, P(g.p1), P(g.p2)));
    else {
      const c = P(g.c);
      const rr = (g.kind === "circle" ? g.r : arcRadius(doc, g)) * v.zoom;
      let d = Math.abs(dist(c, s) - rr);
      if (g.kind === "arc") {
        const a = angleOf({ x: s.x - c.x, y: c.y - s.y }) - pose.a;
        const a0 = angleOf(sub(doc.points[g.s], doc.points[g.c])), a1 = angleOf(sub(doc.points[g.e], doc.points[g.c]));
        if (!angleInSweep(a, a0, a1)) d = Infinity;
      }
      best = Math.min(best, d);
    }
  }
  return best;
}

/** Sketch geometry that isn't in any body, drawn faintly in Motion mode. */
export function drawLooseGeometry(ctx: CanvasRenderingContext2D, ed: Editor): void {
  const doc = ed.doc;
  const own = ed.mech.owner;
  ctx.save();
  ctx.strokeStyle = "#c3c8d1";
  ctx.lineWidth = 1;
  for (const g of Object.values(doc.geoms)) {
    if (own.has(g.id)) continue;
    ctx.setLineDash(g.construction ? [5, 4] : []);
    tracePath(ctx, doc, ed.view, IDENTITY, g);
    ctx.stroke();
  }
  ctx.restore();
}
