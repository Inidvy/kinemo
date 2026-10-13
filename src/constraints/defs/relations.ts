import type { ConstraintType, Primitive } from "../types";
import { split, geomAnchor, P } from "../select";
import type { Constraint, Geometry, Id, SketchDoc, Vec } from "../../core/model";
import { dot, perp, sub } from "../../core/geom";

const anchorFirst = (doc: Parameters<NonNullable<ConstraintType["anchor"]>>[0], c: Constraint) =>
  geomAnchor(doc, c.refs[0]);

/** Pairwise chain: [a,b,c] -> (a,b),(b,c). */
function chain(type: string, ids: string[]) {
  return ids.slice(1).map((id, i) => ({ type, refs: [ids[i], id] }));
}

export const parallel: ConstraintType = {
  id: "parallel",
  label: "c.parallel",
  glyph: "∥",
  shortcut: "p",
  fromSelection(doc, sel) {
    const { lines, geoms, points } = split(doc, sel);
    if (lines.length < 2 || geoms.length !== lines.length || points.length) return "hint.selectLines2";
    return chain("parallel", lines.map((l) => l.id));
  },
  toPrimitives: (_d, c) => [{ id: `${c.id}#0`, type: "parallel", l1_id: c.refs[0], l2_id: c.refs[1] }],
  anchor: anchorFirst,
};

export const perpendicular: ConstraintType = {
  id: "perpendicular",
  label: "c.perpendicular",
  glyph: "⊥",
  shortcut: "n",
  fromSelection(doc, sel) {
    const { lines, geoms, points } = split(doc, sel);
    if (lines.length !== 2 || geoms.length !== 2 || points.length) return "hint.selectLines2";
    return [{ type: "perpendicular", refs: lines.map((l) => l.id) }];
  },
  toPrimitives: (_d, c) => [
    { id: `${c.id}#0`, type: "perpendicular_ll", l1_id: c.refs[0], l2_id: c.refs[1] },
  ],
  anchor: anchorFirst,
};

/** Direction of a curve at one of its points (lines p1→p2, arcs counter-clockwise). */
function directionAt(doc: SketchDoc, g: Geometry, at: Id): Vec {
  if (g.kind === "line") return sub(doc.points[g.p2], doc.points[g.p1]);
  return perp(sub(doc.points[at], doc.points[g.c]));
}

function endpoints(g: Geometry): Id[] {
  return g.kind === "line" ? [g.p1, g.p2] : g.kind === "arc" ? [g.s, g.e] : [];
}

/** An end point of `a` that is the same as, or coincident with, an end point of `b`. */
function sharedEnd(doc: SketchDoc, a: Geometry, b: Geometry): Id | null {
  const eb = new Set(endpoints(b));
  for (const p of endpoints(a)) {
    if (eb.has(p)) return p;
    for (const c of Object.values(doc.constraints)) {
      if (c.type === "coincident" && c.refs.includes(p) && c.refs.some((r) => r !== p && eb.has(r))) return p;
    }
  }
  return null;
}

/**
 * Build a tangent constraint. When the two curves meet at an end point it
 * becomes tangency at that point (like FreeCAD), which the solver handles
 * far better than general tangency plus a coincident.
 */
export function makeTangent(doc: SketchDoc, a: Geometry, b: Geometry): Omit<Constraint, "id"> {
  const at = sharedEnd(doc, a, b);
  if (at) {
    const angle = dot(directionAt(doc, a, at), directionAt(doc, b, at)) >= 0 ? 0 : Math.PI;
    return { type: "tangent", refs: [a.id, b.id, at], data: { angle } };
  }
  // Keep lines first so toPrimitives can rely on the order.
  const sorted = [a, b].sort((x, y) => (x.kind === "line" ? -1 : y.kind === "line" ? 1 : 0));
  return { type: "tangent", refs: sorted.map((g) => g.id) };
}

export const tangent: ConstraintType = {
  id: "tangent",
  label: "c.tangent",
  glyph: "◡",
  shortcut: "t",
  fromSelection(doc, sel) {
    const { geoms, points, curves } = split(doc, sel);
    if (geoms.length !== 2 || points.length || curves.length < 1) return "hint.selectTangent";
    return [makeTangent(doc, geoms[0], geoms[1])];
  },
  toPrimitives(doc, c) {
    const id = `${c.id}#0`;
    if (c.refs.length === 3) {
      const [a, b, p] = c.refs;
      return [{ id, type: "angle_via_point", crv1_id: a, crv2_id: b, p_id: p, angle: c.data?.angle ?? 0 }];
    }
    const [a, b] = c.refs.map((id) => doc.geoms[id]);
    if (a.kind === "line") {
      return b.kind === "circle"
        ? [{ id, type: "tangent_lc", l_id: a.id, c_id: b.id }]
        : [{ id, type: "tangent_la", l_id: a.id, a_id: b.id }];
    }
    if (a.kind === "circle" && b.kind === "circle") return [{ id, type: "tangent_cc", c1_id: a.id, c2_id: b.id }];
    if (a.kind === "arc" && b.kind === "arc") return [{ id, type: "tangent_aa", a1_id: a.id, a2_id: b.id }];
    const circle = a.kind === "circle" ? a : b;
    const arc = a.kind === "arc" ? a : b;
    return [{ id, type: "tangent_ca", c_id: circle.id, a_id: arc.id }];
  },
  anchor: (doc, c) => (c.refs.length === 3 ? P(doc, c.refs[2]) : geomAnchor(doc, c.refs[0])),
};

export const equal: ConstraintType = {
  id: "equal",
  label: "c.equal",
  glyph: "=",
  shortcut: "e",
  fromSelection(doc, sel) {
    const { geoms, lines, curves, points } = split(doc, sel);
    if (points.length || geoms.length < 2) return "hint.selectEqual";
    if (lines.length === geoms.length) return chain("equal", lines.map((l) => l.id));
    if (curves.length === geoms.length) return chain("equal", curves.map((g) => g.id));
    return "hint.selectEqual";
  },
  toPrimitives(doc, c) {
    const [a, b] = c.refs.map((id) => doc.geoms[id]);
    const id = `${c.id}#0`;
    if (a.kind === "line") return [{ id, type: "equal_length", l1_id: a.id, l2_id: b.id }];
    if (a.kind === "circle" && b.kind === "circle") return [{ id, type: "equal_radius_cc", c1_id: a.id, c2_id: b.id }];
    if (a.kind === "arc" && b.kind === "arc") return [{ id, type: "equal_radius_aa", a1_id: a.id, a2_id: b.id }];
    const circle = a.kind === "circle" ? a : b;
    const arc = a.kind === "arc" ? a : b;
    return [{ id, type: "equal_radius_ca", c1_id: circle.id, a2_id: arc.id }];
  },
  anchor: anchorFirst,
};

export const concentric: ConstraintType = {
  id: "concentric",
  label: "c.concentric",
  glyph: "◎",
  shortcut: "z",
  fromSelection(doc, sel) {
    const { curves, geoms, points } = split(doc, sel);
    if (curves.length < 2 || geoms.length !== curves.length || points.length) return "hint.selectCurves2";
    return chain("concentric", curves.map((g) => g.id));
  },
  toPrimitives(doc, c) {
    const [a, b] = c.refs.map((id) => doc.geoms[id]) as { c: string }[];
    return [{ id: `${c.id}#0`, type: "p2p_coincident", p1_id: a.c, p2_id: b.c }];
  },
  anchor: (doc, c) => P(doc, (doc.geoms[c.refs[0]] as { c: string }).c),
};

export const midpoint: ConstraintType = {
  id: "midpoint",
  label: "c.midpoint",
  glyph: "⋈",
  shortcut: "u",
  fromSelection(doc, sel) {
    const { points, lines, geoms } = split(doc, sel);
    if (points.length !== 1 || lines.length !== 1 || geoms.length !== 1) return "hint.selectPointAndLine";
    return [{ type: "midpoint", refs: [points[0], lines[0].id] }];
  },
  toPrimitives(_d, c): Primitive[] {
    const [p, l] = c.refs;
    return [
      { id: `${c.id}#0`, type: "point_on_line_pl", p_id: p, l_id: l },
      { id: `${c.id}#1`, type: "point_on_perp_bisector_pl", p_id: p, l_id: l },
    ];
  },
  anchor: (doc, c) => P(doc, c.refs[0]),
};

export const symmetric: ConstraintType = {
  id: "symmetric",
  label: "c.symmetric",
  glyph: "⇄",
  shortcut: "y",
  fromSelection(doc, sel) {
    const { points, lines, geoms } = split(doc, sel);
    if (points.length === 2 && lines.length === 1 && geoms.length === 1) {
      return [{ type: "symmetric", refs: [points[0], points[1], lines[0].id] }];
    }
    if (points.length === 3 && geoms.length === 0) return [{ type: "symmetric", refs: points }];
    return "hint.selectSymmetric";
  },
  toPrimitives(doc, c) {
    const [p1, p2, m] = c.refs;
    const id = `${c.id}#0`;
    if (m in doc.geoms) return [{ id, type: "p2p_symmetric_ppl", p1_id: p1, p2_id: p2, l_id: m }];
    return [{ id, type: "p2p_symmetric_ppp", p1_id: p1, p2_id: p2, p_id: m }];
  },
  anchor: (doc, c) => geomAnchor(doc, c.refs[2]),
};

/**
 * A ground pivot: the point is fixed in the sketch, and in Motion mode its
 * body turns about it. Made with Shift+G on a point.
 */
export const groundPoint: ConstraintType = {
  id: "groundPoint",
  label: "c.groundPoint",
  glyph: "⏚",
  hidden: true,
  fromSelection(doc, sel) {
    const { points } = split(doc, sel);
    if (!points.length) return "hint.ground";
    return points.map((p) => ({ type: "groundPoint", refs: [p] }));
  },
  // Only Motion mode uses it: in the sketch the point stays free to move.
  toPrimitives: () => [],
  anchor: (doc, c) => P(doc, c.refs[0]),
};

/** Lock points or lines where they are now, in the sketch only (Motion mode ignores it). */
export const fix: ConstraintType = {
  id: "fix",
  label: "c.fix",
  glyph: "⚓",
  shortcut: "w",
  fromSelection(doc, sel) {
    const { points, geoms } = split(doc, sel);
    const ids = new Set(points);
    for (const g of geoms) {
      if (g.kind === "line") [g.p1, g.p2].forEach((p) => ids.add(p));
      else ids.add(g.c);
    }
    if (ids.size === 0) return "hint.selectAnything";
    return [...ids].map((p) => ({ type: "fix", refs: [p], data: { x: doc.points[p].x, y: doc.points[p].y } }));
  },
  toPrimitives(doc, c) {
    const p = c.refs[0];
    const at = c.data ?? doc.points[p];
    return [
      { id: `${c.id}#0`, type: "coordinate_x", p_id: p, x: at.x },
      { id: `${c.id}#1`, type: "coordinate_y", p_id: p, y: at.y },
    ];
  },
  anchor: (doc, c) => P(doc, c.refs[0]),
};
