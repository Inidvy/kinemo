import { arcRadius, type Id, type SketchDoc, type Vec } from "../core/model";
import { angleInSweep, angleOf, dist, distToSegment } from "../core/geom";
import type { View } from "./view";
import { ICON, layoutDims, layoutIcons } from "./layout";

export type Hit =
  | { kind: "point"; id: Id }
  | { kind: "geom"; id: Id; part?: "rim" }
  | { kind: "constraint"; id: Id }
  | { kind: "dimension"; id: Id }
  | { kind: "body"; id: Id }
  | { kind: "joint"; id: Id };

export interface HitOptions {
  icons: boolean;
  /** Ids to ignore (for example the point being drawn). */
  exclude?: Set<Id>;
  /** Only look for points and geometry (used for snapping). */
  geometryOnly?: boolean;
}

const POINT_R = 7;
const GEOM_R = 6;

export function hitTest(doc: SketchDoc, view: View, s: Vec, opts: HitOptions): Hit | null {
  const ex = opts.exclude ?? new Set<Id>();
  if (!opts.geometryOnly) {
    for (const d of layoutDims(doc, view)) {
      const t = view.toScreen(d.text);
      const w = d.label.length * 7 + 8;
      if (Math.abs(s.x - t.x) < w / 2 && Math.abs(s.y - t.y) < 10) return { kind: "dimension", id: d.cid };
    }
    if (opts.icons) {
      for (const b of layoutIcons(doc, view)) {
        if (s.x >= b.x && s.x <= b.x + ICON && s.y >= b.y && s.y <= b.y + ICON) return { kind: "constraint", id: b.cid };
      }
    }
  }

  let best: Hit | null = null;
  let bestD = POINT_R;
  for (const p of Object.values(doc.points)) {
    if (ex.has(p.id)) continue;
    const d = dist(view.toScreen(p), s);
    if (d < bestD) {
      bestD = d;
      best = { kind: "point", id: p.id };
    }
  }
  if (best) return best;

  bestD = GEOM_R;
  for (const g of Object.values(doc.geoms)) {
    if (ex.has(g.id)) continue;
    let d = Infinity;
    if (g.kind === "line") {
      d = distToSegment(s, view.toScreen(doc.points[g.p1]), view.toScreen(doc.points[g.p2]));
    } else {
      const c = view.toScreen(doc.points[g.c]);
      const r = (g.kind === "circle" ? g.r : arcRadius(doc, g)) * view.zoom;
      d = Math.abs(dist(c, s) - r);
      if (g.kind === "arc") {
        const w = view.toWorld(s);
        const cw = doc.points[g.c];
        const a = angleOf({ x: w.x - cw.x, y: w.y - cw.y });
        const a0 = angleOf({ x: doc.points[g.s].x - cw.x, y: doc.points[g.s].y - cw.y });
        const a1 = angleOf({ x: doc.points[g.e].x - cw.x, y: doc.points[g.e].y - cw.y });
        if (!angleInSweep(a, a0, a1)) d = Infinity;
      }
    }
    if (d < bestD) {
      bestD = d;
      best = { kind: "geom", id: g.id, part: g.kind === "circle" ? "rim" : undefined };
    }
  }
  return best;
}

/** Ids of points and geometry fully inside a screen rectangle. */
export function boxSelect(doc: SketchDoc, view: View, a: Vec, b: Vec): Id[] {
  const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
  const inside = (id: Id) => {
    const s = view.toScreen(doc.points[id]);
    return s.x >= x0 && s.x <= x1 && s.y >= y0 && s.y <= y1;
  };
  const out: Id[] = [];
  for (const p of Object.values(doc.points)) if (inside(p.id)) out.push(p.id);
  for (const g of Object.values(doc.geoms)) {
    const pts = g.kind === "line" ? [g.p1, g.p2] : g.kind === "arc" ? [g.s, g.e, g.c] : [g.c];
    if (pts.every(inside)) out.push(g.id);
  }
  return out;
}
