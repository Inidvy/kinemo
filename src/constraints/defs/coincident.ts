import type { ConstraintType } from "../types";
import { split, P } from "../select";

/** Two or more points share a position. Chains when more than two are picked. */
export const coincident: ConstraintType = {
  id: "coincident",
  label: "c.coincident",
  glyph: "●",
  shortcut: "e",
  fromSelection(doc, sel) {
    const { points, geoms } = split(doc, sel);
    if (geoms.length > 0 || points.length < 2) return "hint.selectPoints2";
    return points.slice(1).map((p, i) => ({ type: "coincident", refs: [points[i], p] }));
  },
  toPrimitives(_doc, c) {
    return [{ id: `${c.id}#0`, type: "p2p_coincident", p1_id: c.refs[0], p2_id: c.refs[1] }];
  },
  // No canvas icon: joined end points are obvious, and icons at every corner
  // clutter the sketch (Onshape does the same). It is listed in the feature tree.
};

/** A point lies on a line, circle or arc. */
export const onCurve: ConstraintType = {
  id: "onCurve",
  label: "c.onCurve",
  glyph: "⊙",
  fromSelection(doc, sel) {
    const { points, geoms } = split(doc, sel);
    if (points.length < 1 || geoms.length !== 1) return "hint.selectPointAndCurve";
    return points.map((p) => ({ type: "onCurve", refs: [p, geoms[0].id] }));
  },
  toPrimitives(doc, c) {
    const [p, gid] = c.refs;
    const g = doc.geoms[gid];
    const id = `${c.id}#0`;
    if (g.kind === "line") return [{ id, type: "point_on_line_pl", p_id: p, l_id: gid }];
    if (g.kind === "circle") return [{ id, type: "point_on_circle", p_id: p, c_id: gid }];
    return [{ id, type: "point_on_arc", p_id: p, a_id: gid }];
  },
  anchor: (doc, c) => P(doc, c.refs[0]),
};
