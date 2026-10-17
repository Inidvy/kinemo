import { arcRadius, geomPoints, type Id, type SketchDoc, type Vec } from "../core/model";
import { add, dist, mid, norm, projectOnLine, scale, sub } from "../core/geom";
import { hitTest } from "../render/hit";
import type { View } from "../render/view";
import { colors } from "../render/style";
import { t } from "../i18n";
import type { Snap } from "./types";

/** How close (screen px) the cursor must come to a line's middle to snap to it. */
const MID_R = 9;

/**
 * What a point placed or dropped at screen position `s` should attach to:
 * an existing point (coincident), the middle of a line (midpoint), or a
 * line, circle or arc (on curve). Points win, then midpoints, then curves.
 */
export function findSnap(doc: SketchDoc, view: View, s: Vec, exclude?: Set<Id>): Snap {
  const world = view.toWorld(s);
  const h = hitTest(doc, view, s, { icons: false, geometryOnly: true, exclude });
  if (h?.kind === "point") {
    const p = doc.points[h.id];
    return { kind: "point", id: h.id, at: { x: p.x, y: p.y } };
  }
  let best: Snap | null = null;
  let bestD = MID_R;
  for (const g of Object.values(doc.geoms)) {
    if (g.kind !== "line" || exclude?.has(g.id)) continue;
    const m = mid(doc.points[g.p1], doc.points[g.p2]);
    const d = dist(view.toScreen(m), s);
    if (d < bestD) {
      bestD = d;
      best = { kind: "midpoint", id: g.id, at: m };
    }
  }
  if (best) return best;
  if (h?.kind === "geom") {
    const g = doc.geoms[h.id];
    if (g.kind === "line") return { kind: "curve", id: g.id, at: projectOnLine(world, doc.points[g.p1], doc.points[g.p2]) };
    const c = doc.points[g.c];
    const r = g.kind === "circle" ? g.r : arcRadius(doc, g);
    return { kind: "curve", id: g.id, at: add(c, scale(norm(sub(world, c)), r)) };
  }
  return { kind: "none", at: world };
}

/**
 * Things a dragged point must not snap to: itself, the points it is already
 * joined to, and the geometry those points belong to (so a line's end can't
 * land on its own line or its other end).
 */
export function snapExclusions(doc: SketchDoc, point: Id): Set<Id> {
  const joined = new Set<Id>([point]);
  for (const c of Object.values(doc.constraints)) {
    if (c.type === "coincident" && c.refs.includes(point)) c.refs.forEach((r) => joined.add(r));
  }
  const out = new Set(joined);
  for (const g of Object.values(doc.geoms)) {
    const pts = geomPoints(g);
    if (!pts.some((p) => joined.has(p))) continue;
    out.add(g.id);
    pts.forEach((p) => out.add(p));
  }
  return out;
}

/** The constraint that ties point `p` to a snap target, if it isn't there already. */
export function snapConstraint(doc: SketchDoc, p: Id, snap: Snap): { type: string; refs: Id[] } | null {
  if (snap.kind === "none") return null;
  const c =
    snap.kind === "point"
      ? { type: "coincident", refs: [snap.id, p] }
      : snap.kind === "midpoint"
        ? { type: "midpoint", refs: [p, snap.id] }
        : { type: "onCurve", refs: [p, snap.id] };
  const same = (a: Id[], b: Id[]) => a.length === b.length && a.every((r) => b.includes(r));
  if (Object.values(doc.constraints).some((x) => x.type === c.type && same(x.refs, c.refs))) return null;
  return c;
}

const SNAP_LABEL: Record<Exclude<Snap["kind"], "none">, string> = { point: "c.coincident", midpoint: "c.midpoint", curve: "c.onCurve" };

/** Mark the snap target on the canvas and name the constraint it will make. */
export function drawSnap(ctx: CanvasRenderingContext2D, view: View, snap: Snap | null): void {
  if (!snap || snap.kind === "none") return;
  const s = view.toScreen(snap.at);
  ctx.save();
  ctx.strokeStyle = colors.preview;
  ctx.fillStyle = colors.preview;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([]);
  ctx.beginPath();
  if (snap.kind === "midpoint") {
    // A diamond, like the midpoint marker in most CAD sketchers.
    ctx.moveTo(s.x, s.y - 6);
    ctx.lineTo(s.x + 6, s.y);
    ctx.lineTo(s.x, s.y + 6);
    ctx.lineTo(s.x - 6, s.y);
    ctx.closePath();
  } else {
    ctx.arc(s.x, s.y, snap.kind === "point" ? 7 : 5, 0, Math.PI * 2);
  }
  ctx.stroke();
  ctx.font = "11px system-ui, sans-serif";
  ctx.fillText(t(SNAP_LABEL[snap.kind]), s.x + 10, s.y - 8);
  ctx.restore();
}
