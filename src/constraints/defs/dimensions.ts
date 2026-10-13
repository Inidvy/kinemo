import type { ConstraintType, DimensionShape } from "../types";
import { split, P, lineAngle } from "../select";
import { angleOf, dist, projectOnLine } from "../../core/geom";
import { arcRadius, type Arc, type Circle, type Constraint, type Line, type SketchDoc, type Vec } from "../../core/model";

const DEG = Math.PI / 180;

function linearEnds(doc: SketchDoc, c: Constraint): [Vec, Vec] {
  if (c.refs.length === 1) {
    const l = doc.geoms[c.refs[0]] as Line;
    return [P(doc, l.p1), P(doc, l.p2)];
  }
  const [a, b] = c.refs;
  if (b in doc.geoms) {
    const l = doc.geoms[b] as Line;
    const p = P(doc, a);
    return [p, projectOnLine(p, P(doc, l.p1), P(doc, l.p2))];
  }
  return [P(doc, a), P(doc, b)];
}

/** Distance between two points, a line's length, or point-to-line distance. */
export const distance: ConstraintType = {
  id: "distance",
  label: "c.distance",
  glyph: "↔",
  dimension: true,
  unit: "mm",
  fromSelection(doc, sel) {
    const { points, lines, geoms } = split(doc, sel);
    let refs: string[] | null = null;
    if (points.length === 2 && geoms.length === 0) refs = points;
    else if (points.length === 0 && lines.length === 1 && geoms.length === 1) refs = [lines[0].id];
    else if (points.length === 1 && lines.length === 1 && geoms.length === 1) refs = [points[0], lines[0].id];
    if (!refs) return "hint.selectDistance";
    const c = { id: "", type: "distance", refs };
    const [a, b] = linearEnds(doc, c);
    return [{ type: "distance", refs, value: round(dist(a, b)) }];
  },
  toPrimitives(doc, c) {
    const id = `${c.id}#0`;
    const d = c.value ?? 0;
    if (c.refs.length === 1) {
      const l = doc.geoms[c.refs[0]] as Line;
      return [{ id, type: "p2p_distance", p1_id: l.p1, p2_id: l.p2, distance: d }];
    }
    const [a, b] = c.refs;
    if (b in doc.geoms) return [{ id, type: "p2l_distance", p_id: a, l_id: b, distance: d }];
    return [{ id, type: "p2p_distance", p1_id: a, p2_id: b, distance: d }];
  },
  shape(doc, c): DimensionShape {
    const [a, b] = linearEnds(doc, c);
    return { kind: "linear", a, b };
  },
};

function intersection(doc: SketchDoc, l1: Line, l2: Line): Vec {
  const a = P(doc, l1.p1), b = P(doc, l1.p2), c = P(doc, l2.p1), d = P(doc, l2.p2);
  const den = (a.x - b.x) * (c.y - d.y) - (a.y - b.y) * (c.x - d.x);
  if (Math.abs(den) < 1e-9) return b;
  const t = ((a.x - c.x) * (c.y - d.y) - (a.y - c.y) * (c.x - d.x)) / den;
  return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
}

/**
 * Pick the line direction that points away from the intersection, so the
 * angle is measured between the drawn parts of the two lines.
 */
function armAngle(doc: SketchDoc, l: Line, at: Vec): number {
  const a = P(doc, l.p1), b = P(doc, l.p2);
  const far = dist(a, at) > dist(b, at) ? a : b;
  return angleOf({ x: far.x - at.x, y: far.y - at.y });
}

function signedSweep(a1: number, a2: number): number {
  let d = a2 - a1;
  while (d <= -Math.PI) d += 2 * Math.PI;
  while (d > Math.PI) d -= 2 * Math.PI;
  return d;
}

/** Angle between two lines, in degrees. */
export const angle: ConstraintType = {
  id: "angle",
  label: "c.angle",
  glyph: "∠",
  dimension: true,
  unit: "deg",
  fromSelection(doc, sel) {
    const { lines, geoms, points } = split(doc, sel);
    if (lines.length !== 2 || geoms.length !== 2 || points.length) return "hint.selectLines2";
    const [l1, l2] = lines;
    const at = intersection(doc, l1, l2);
    const sweep = signedSweep(armAngle(doc, l1, at), armAngle(doc, l2, at));
    // Store which way the lines point so the solver keeps the same arrangement.
    const flip1 = Math.abs(signedSweep(lineAngle(doc, l1), armAngle(doc, l1, at))) > Math.PI / 2 ? 1 : 0;
    const flip2 = Math.abs(signedSweep(lineAngle(doc, l2), armAngle(doc, l2, at))) > Math.PI / 2 ? 1 : 0;
    return [
      {
        type: "angle",
        refs: [l1.id, l2.id],
        value: round(Math.abs(sweep) / DEG),
        data: { sign: Math.sign(sweep) || 1, flip1, flip2 },
      },
    ];
  },
  toPrimitives(_doc, c) {
    const { sign = 1, flip1 = 0, flip2 = 0 } = c.data ?? {};
    // l2l_angle_ll measures from l1's direction to l2's; adjust for arms that
    // point against the line direction (each flip adds π).
    const rad = sign * (c.value ?? 0) * DEG + (flip1 - flip2) * Math.PI;
    return [{ id: `${c.id}#0`, type: "l2l_angle_ll", l1_id: c.refs[0], l2_id: c.refs[1], angle: rad }];
  },
  shape(doc, c): DimensionShape {
    const [l1, l2] = c.refs.map((id) => doc.geoms[id] as Line);
    const center = intersection(doc, l1, l2);
    return { kind: "angle", center, d1: armAngle(doc, l1, center), d2: armAngle(doc, l2, center) };
  },
};

export const diameter: ConstraintType = {
  id: "diameter",
  label: "c.diameter",
  glyph: "Ø",
  dimension: true,
  unit: "mm",
  fromSelection(doc, sel) {
    const { circles, geoms, points } = split(doc, sel);
    if (circles.length !== 1 || geoms.length !== 1 || points.length) return "hint.selectCircle";
    return [{ type: "diameter", refs: [circles[0].id], value: round(circles[0].r * 2) }];
  },
  toPrimitives: (_d, c) => [{ id: `${c.id}#0`, type: "circle_radius", c_id: c.refs[0], radius: (c.value ?? 0) / 2 }],
  shape(doc, c): DimensionShape {
    const g = doc.geoms[c.refs[0]] as Circle;
    return { kind: "radial", center: P(doc, g.c), r: g.r, diameter: true };
  },
};

export const radius: ConstraintType = {
  id: "radius",
  label: "c.radius",
  glyph: "R",
  dimension: true,
  unit: "mm",
  fromSelection(doc, sel) {
    const { arcs, geoms, points } = split(doc, sel);
    if (arcs.length !== 1 || geoms.length !== 1 || points.length) return "hint.selectArc";
    return [{ type: "radius", refs: [arcs[0].id], value: round(arcRadius(doc, arcs[0])) }];
  },
  toPrimitives: (_d, c) => [{ id: `${c.id}#0`, type: "arc_radius", a_id: c.refs[0], radius: c.value ?? 0 }],
  shape(doc, c): DimensionShape {
    const g = doc.geoms[c.refs[0]] as Arc;
    return { kind: "radial", center: P(doc, g.c), r: arcRadius(doc, g), diameter: false };
  },
};

function round(v: number): number {
  return Math.round(v * 100) / 100;
}
