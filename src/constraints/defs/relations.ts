import type { ConstraintType, Primitive } from "../types";
import { split, geomAnchor, P } from "../select";
import type { Constraint } from "../../core/model";

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

export const tangent: ConstraintType = {
  id: "tangent",
  label: "c.tangent",
  glyph: "◡",
  shortcut: "t",
  fromSelection(doc, sel) {
    const { geoms, points, curves } = split(doc, sel);
    if (geoms.length !== 2 || points.length || curves.length < 1) return "hint.selectTangent";
    // Keep lines first so toPrimitives can rely on the order.
    const sorted = [...geoms].sort((a, b) => (a.kind === "line" ? -1 : b.kind === "line" ? 1 : 0));
    return [{ type: "tangent", refs: sorted.map((g) => g.id) }];
  },
  toPrimitives(doc, c) {
    const [a, b] = c.refs.map((id) => doc.geoms[id]);
    const id = `${c.id}#0`;
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
  anchor: anchorFirst,
};

export const equal: ConstraintType = {
  id: "equal",
  label: "c.equal",
  glyph: "=",
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

/** Lock points where they are now. */
export const fix: ConstraintType = {
  id: "fix",
  label: "c.fix",
  glyph: "⚓",
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
