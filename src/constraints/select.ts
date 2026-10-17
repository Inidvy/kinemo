import { arcRadius, geomPoints, type Arc, type Circle, type Geometry, type Id, type Line, type SketchDoc, type Vec } from "../core/model";
import { angleOf, mid } from "../core/geom";
import type { ConstraintType } from "./types";

/** Helpers for reading a selection by kind. */
export function split(doc: SketchDoc, sel: Id[]) {
  const points = sel.filter((id) => id in doc.points);
  const geoms = sel.map((id) => doc.geoms[id]).filter(Boolean) as Geometry[];
  return {
    points,
    geoms,
    lines: geoms.filter((g): g is Line => g.kind === "line"),
    circles: geoms.filter((g): g is Circle => g.kind === "circle"),
    arcs: geoms.filter((g): g is Arc => g.kind === "arc"),
    curves: geoms.filter((g): g is Circle | Arc => g.kind !== "line"),
  };
}

/**
 * Build a constraint from a selection. A box selection or Ctrl+A picks up
 * the end points of the lines it catches too, which no line constraint
 * wants: if the selection doesn't fit as it is, try again without the
 * points that belong to selected geometry.
 */
export function fitSelection(def: ConstraintType, doc: SketchDoc, sel: Id[]): ReturnType<ConstraintType["fromSelection"]> {
  const out = def.fromSelection(doc, sel);
  if (typeof out !== "string") return out;
  const owned = new Set(split(doc, sel).geoms.flatMap((g) => geomPoints(g)));
  const trimmed = sel.filter((id) => !owned.has(id));
  if (trimmed.length === sel.length || !trimmed.length) return out;
  const again = def.fromSelection(doc, trimmed);
  return typeof again === "string" ? out : again;
}

export const P = (doc: SketchDoc, id: Id): Vec => doc.points[id];

export function lineMid(doc: SketchDoc, l: Line): Vec {
  return mid(P(doc, l.p1), P(doc, l.p2));
}

export function lineAngle(doc: SketchDoc, l: Line): number {
  const a = P(doc, l.p1);
  const b = P(doc, l.p2);
  return angleOf({ x: b.x - a.x, y: b.y - a.y });
}

/** A point on a curve's rim, used to anchor icons. */
export function curveAnchor(doc: SketchDoc, g: Circle | Arc): Vec {
  const c = P(doc, g.c);
  if (g.kind === "circle") return { x: c.x + g.r * Math.SQRT1_2, y: c.y + g.r * Math.SQRT1_2 };
  const s = P(doc, g.s);
  const e = P(doc, g.e);
  const r = arcRadius(doc, g);
  const a0 = angleOf({ x: s.x - c.x, y: s.y - c.y });
  let a1 = angleOf({ x: e.x - c.x, y: e.y - c.y });
  if (a1 < a0) a1 += 2 * Math.PI;
  const am = (a0 + a1) / 2;
  return { x: c.x + r * Math.cos(am), y: c.y + r * Math.sin(am) };
}

export function geomAnchor(doc: SketchDoc, id: Id): Vec {
  if (id in doc.points) return doc.points[id];
  const g = doc.geoms[id];
  if (g.kind === "line") return lineMid(doc, g);
  return curveAnchor(doc, g);
}

/** Planegcs needs separate primitive types per geometry kind. */
export function curveSuffix(g: Geometry): "c" | "a" {
  return g.kind === "circle" ? "c" : "a";
}
