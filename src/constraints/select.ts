import { addConstraint, arcRadius, geomPoints, type Arc, type Constraint, type Circle, type Geometry, type Id, type Line, type SketchDoc, type Vec } from "../core/model";
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
  // Labels never take constraints; a whole stack of joined points counts as one point.
  const seen = new Set<Id>();
  sel = sel.filter((id) => {
    if (doc.labels?.[id]) return false;
    if (!(id in doc.points)) return true;
    if (seen.has(id)) return false;
    stackOf(doc, id).forEach((p) => seen.add(p));
    return true;
  });
  const out = def.fromSelection(doc, sel);
  if (typeof out !== "string") return out;
  const owned = new Set(split(doc, sel).geoms.flatMap((g) => geomPoints(g)));
  const trimmed = sel.filter((id) => !owned.has(id));
  if (trimmed.length === sel.length || !trimmed.length) return out;
  const again = def.fromSelection(doc, trimmed);
  return typeof again === "string" ? out : again;
}

/**
 * The stack of points at one spot: `p` and every point joined to it by
 * coincident constraints, directly or through others. Where several lines
 * meet, each brings its own end point, so this is what "the corner" means.
 */
export function stackOf(doc: SketchDoc, p: Id): Id[] {
  const out = new Set([p]);
  const cons = Object.values(doc.constraints).filter((c) => c.type === "coincident");
  for (let grew = true; grew; ) {
    grew = false;
    for (const c of cons) {
      if (!c.refs.some((r) => out.has(r)) || c.refs.every((r) => out.has(r))) continue;
      c.refs.forEach((r) => out.add(r));
      grew = true;
    }
  }
  return [...out];
}

const joined = (doc: SketchDoc, p: Id) => new Set(stackOf(doc, p));

/**
 * Add a constraint, upgrading what is already there: a midpoint replaces the
 * "point on line" it makes redundant (so pressing U on a point that already
 * sits on the line just works), and a "point on line" that a midpoint already
 * covers isn't added again. Returns false when nothing was added.
 */
export function addConstraintSmart(doc: SketchDoc, c: Omit<Constraint, "id">): boolean {
  const all = Object.values(doc.constraints);
  if (c.type === "onCurve") {
    const pts = joined(doc, c.refs[0]);
    if (all.some((x) => x.type === "midpoint" && x.refs[1] === c.refs[1] && pts.has(x.refs[0]))) return false;
  }
  if (c.type === "midpoint") {
    const pts = joined(doc, c.refs[0]);
    for (const x of all) if (x.type === "onCurve" && x.refs[1] === c.refs[1] && pts.has(x.refs[0])) delete doc.constraints[x.id];
  }
  addConstraint(doc, c);
  return true;
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
