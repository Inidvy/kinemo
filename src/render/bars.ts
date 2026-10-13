import type { Editor } from "../app/editor";
import { arcRadius, type Body, type Geometry, type Id, type Pose, type SketchDoc, type Vec } from "../core/model";
import { angleInSweep, angleOf, dist, distToSegment, sub } from "../core/geom";
import { applyPose, bodyColor, bodyGeoms, groundBodies, IDENTITY, isGround, poseOf } from "../motion/bodies";
import { jointKinds, type Joint } from "../motion/joints";
import { colors } from "./style";
import type { View } from "./view";

// Bars, plates, slots and joints. Each body is one light shape with a
// coloured outline: lines become rounded bars, closed loops of lines become
// filled plates, and lines a slider runs along get a slot cut into the bar.
// Joints are small pins; ground pins are dark.

export interface BarStyle {
  /** Draw bodies where they are in Motion mode (otherwise as sketched). */
  posed: boolean;
  alpha: number;
  hover: Id | null;
}

/** Geometry that a slider runs along: drawn with a slot cut into it. */
function slotGeoms(doc: SketchDoc, joints: Joint[]): Set<Id> {
  const out = new Set<Id>();
  for (const j of joints) {
    if (j.kind === "slot") out.add(j.refs[3]);
    if (j.kind === "curveSlot") out.add(j.refs[2]);
  }
  for (const g of Object.values(doc.geoms)) if (g.track) out.add(g.id);
  return out;
}

/** Trace a body's geometry as a path in screen space, optionally trimmed at both ends (px). */
function tracePath(ctx: CanvasRenderingContext2D, doc: SketchDoc, v: View, pose: Pose, g: Geometry, trim = 0) {
  const P = (id: Id) => v.toScreen(applyPose(pose, doc.points[id]));
  ctx.beginPath();
  if (g.kind === "line") {
    let a = P(g.p1), b = P(g.p2);
    const l = dist(a, b);
    if (trim > 0 && l > 2 * trim + 2) {
      const u = { x: (b.x - a.x) / l, y: (b.y - a.y) / l };
      a = { x: a.x + u.x * trim, y: a.y + u.y * trim };
      b = { x: b.x - u.x * trim, y: b.y - u.y * trim };
    }
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
  } else if (g.kind === "circle") {
    const c = P(g.c);
    ctx.arc(c.x, c.y, g.r * v.zoom, 0, Math.PI * 2);
  } else {
    const c = P(g.c);
    const r = arcRadius(doc, g) * v.zoom;
    const cut = trim > 0 ? trim / r : 0;
    const a0 = angleOf(sub(doc.points[g.s], doc.points[g.c])) + pose.a + cut;
    const a1 = angleOf(sub(doc.points[g.e], doc.points[g.c])) + pose.a - cut;
    ctx.arc(c.x, c.y, r, -a0, -a1, true);
  }
}

/** Closed loops of lines in a body (a triangle, a quad...), as polygons in sketch coordinates. */
export function bodyLoops(doc: SketchDoc, b: Body): Vec[][] {
  const key = (p: Vec) => `${p.x.toFixed(4)},${p.y.toFixed(4)}`;
  const pos = new Map<string, Vec>();
  const adj = new Map<string, string[]>();
  const edges: [string, string][] = [];
  for (const g of bodyGeoms(doc, b)) {
    if (g.kind !== "line" || g.construction) continue;
    const a = doc.points[g.p1], c = doc.points[g.p2];
    const ka = key(a), kc = key(c);
    if (ka === kc) continue;
    pos.set(ka, a);
    pos.set(kc, c);
    edges.push([ka, kc]);
    adj.set(ka, [...(adj.get(ka) ?? []), kc]);
    adj.set(kc, [...(adj.get(kc) ?? []), ka]);
  }
  // Each edge left out of a spanning tree closes one loop.
  const parent = new Map<string, string | null>();
  const depth = new Map<string, number>();
  const treeEdges = new Set<string>();
  for (const root of adj.keys()) {
    if (parent.has(root)) continue;
    parent.set(root, null);
    depth.set(root, 0);
    const queue = [root];
    while (queue.length) {
      const u = queue.shift()!;
      for (const w of adj.get(u)!) {
        if (parent.has(w)) continue;
        parent.set(w, u);
        depth.set(w, depth.get(u)! + 1);
        treeEdges.add(`${u}|${w}`);
        queue.push(w);
      }
    }
  }
  const loops: Vec[][] = [];
  const seen = new Set<string>();
  for (const [a, c] of edges) {
    if (treeEdges.has(`${a}|${c}`) || treeEdges.has(`${c}|${a}`)) {
      // A tree edge, unless it's a duplicate we've already used once.
      const k = a < c ? `${a}|${c}` : `${c}|${a}`;
      if (!seen.has(k)) {
        seen.add(k);
        continue;
      }
    }
    let x: string = a, y: string = c;
    const left: string[] = [], right: string[] = [];
    while (x !== y) {
      if (depth.get(x)! >= depth.get(y)!) {
        left.push(x);
        x = parent.get(x)!;
      } else {
        right.push(y);
        y = parent.get(y)!;
      }
    }
    const cycle = [...left, x, ...right.reverse()];
    if (cycle.length >= 3) loops.push(cycle.map((k) => pos.get(k)!));
  }
  return loops;
}

function mix(hex: string, k: number, to = 255): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => Math.round(c + (to - c) * k);
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

let layer: HTMLCanvasElement | null = null;

export function drawBodies(ctx: CanvasRenderingContext2D, ed: Editor, style: BarStyle): void {
  if (style.alpha >= 1) return paintBodies(ctx, ed, style);
  // See-through bars: paint them solid on a layer, then lay the layer down
  // faded, so overlapping parts of a body don't show darker.
  layer ??= document.createElement("canvas");
  if (layer.width !== ctx.canvas.width || layer.height !== ctx.canvas.height) {
    layer.width = ctx.canvas.width;
    layer.height = ctx.canvas.height;
  }
  const lc = layer.getContext("2d")!;
  lc.setTransform(1, 0, 0, 1, 0, 0);
  lc.clearRect(0, 0, layer.width, layer.height);
  lc.setTransform(ctx.getTransform());
  paintBodies(lc, ed, { ...style, alpha: 1 });
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = style.alpha;
  ctx.drawImage(layer, 0, 0);
  ctx.restore();
}

function paintBodies(ctx: CanvasRenderingContext2D, ed: Editor, style: BarStyle): void {
  const doc = ed.doc;
  const v = ed.view;
  const w = Math.max(3, doc.settings.barWidth * v.zoom);
  const slots = slotGeoms(doc, ed.mech.joints);
  const ground = groundBodies(doc);
  ctx.save();
  ctx.globalAlpha = style.alpha;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.setLineDash([]);
  // Ground first so moving bodies sit on top of it.
  const bodies = Object.values(doc.bodies).sort((a, b) => Number(ground.has(b.id)) - Number(ground.has(a.id)));
  for (const b of bodies) {
    const pose = style.posed ? poseOf(doc, b.id) : IDENTITY;
    const color = bodyColor(doc, b);
    const fill = mix(color, 0.62);
    const edge = ed.selection.has(b.id) ? colors.selected : style.hover === b.id ? colors.hover : mix(color, 0.2, 0);
    const geoms = bodyGeoms(doc, b).filter((g) => !g.construction);
    const loops = bodyLoops(doc, b).map((loop) => loop.map((p) => v.toScreen(applyPose(pose, p))));
    const loose = b.members.filter((id) => doc.points[id]).map((id) => v.toScreen(applyPose(pose, doc.points[id])));
    const plate = (p: Vec[]) => {
      ctx.beginPath();
      p.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
      ctx.closePath();
    };

    // Outline pass, then fill pass, so the body reads as one merged shape.
    for (const [ink, width] of [
      [edge, w + 4],
      [fill, w],
    ] as const) {
      ctx.strokeStyle = ink;
      ctx.fillStyle = ink;
      ctx.lineWidth = width;
      for (const p of loops) {
        plate(p);
        ctx.fill();
        ctx.stroke();
      }
      for (const g of geoms) {
        tracePath(ctx, doc, v, pose, g);
        ctx.stroke();
      }
      for (const p of loose) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, width / 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // Slots: a hole cut along the line, inset from its ends.
    const hole = Math.max(3, w * 0.42);
    for (const g of geoms.filter((g) => slots.has(g.id))) {
      tracePath(ctx, doc, v, pose, g, w * 0.55);
      ctx.strokeStyle = g.track ? colors.track : edge;
      ctx.lineWidth = hole + 3;
      ctx.stroke();
      tracePath(ctx, doc, v, pose, g, w * 0.55);
      ctx.strokeStyle = colors.background;
      ctx.lineWidth = hole;
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** Joints as small pins; ground pins are dark. Driven joints get an arrow. */
export function drawJoints(ctx: CanvasRenderingContext2D, ed: Editor): void {
  const doc = ed.doc;
  const v = ed.view;
  const m = ed.mech;
  const k = m.context(m.current());
  const r = Math.max(4, doc.settings.barWidth * v.zoom * 0.3);
  const driven = new Set(Object.values(doc.motion.drivers).map((d) => d.joint));
  ctx.save();
  ctx.setLineDash([]);
  for (const j of m.joints) {
    const at = v.toScreen(jointKinds.get(j.kind).anchor(k, j));
    const ground = j.kind === "pin" && (isGround(doc, j.a) || isGround(doc, j.b));
    const sel = ed.selection.has(j.id), hov = ed.hover === j.id;
    ctx.beginPath();
    ctx.arc(at.x, at.y, r, 0, Math.PI * 2);
    ctx.fillStyle = ground ? colors.groundPin : "#ffffff";
    ctx.fill();
    ctx.lineWidth = sel || hov ? 2.5 : 1.6;
    ctx.strokeStyle = sel ? colors.selected : hov ? colors.hover : colors.pinEdge;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(at.x, at.y, r * 0.42, 0, Math.PI * 2);
    ctx.fillStyle = ground ? "#ffffff" : colors.pinDot;
    ctx.fill();
    if (driven.has(j.id)) motorArrow(ctx, at, r + 5);
  }
  ctx.restore();
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
  const bodies = Object.values(doc.bodies).sort((a, b) => Number(isGround(doc, a.id)) - Number(isGround(doc, b.id)));
  for (const b of bodies) if (bodyDistance(doc, v, b, s) <= half) return { kind: "body", id: b.id };
  return null;
}

function bodyDistance(doc: SketchDoc, v: View, b: Body, s: Vec): number {
  const pose = poseOf(doc, b.id);
  const P = (id: Id) => v.toScreen(applyPose(pose, doc.points[id]));
  // Inside a plate counts as on it.
  for (const loop of bodyLoops(doc, b)) {
    const pts = loop.map((p) => v.toScreen(applyPose(pose, p)));
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i], c = pts[j];
      if (a.y > s.y !== c.y > s.y && s.x < ((c.x - a.x) * (s.y - a.y)) / (c.y - a.y) + a.x) inside = !inside;
    }
    if (inside) return 0;
  }
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
