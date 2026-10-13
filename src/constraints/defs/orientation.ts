import type { ConstraintType } from "../types";
import { split, lineMid, P } from "../select";
import { mid } from "../../core/geom";
import type { Constraint, SketchDoc } from "../../core/model";

function axis(dir: "horizontal" | "vertical", shortcut: string, glyph: string): ConstraintType {
  return {
    id: dir,
    label: `c.${dir}`,
    glyph,
    shortcut,
    fromSelection(doc, sel) {
      const { points, lines, geoms } = split(doc, sel);
      if (lines.length > 0 && points.length === 0 && geoms.length === lines.length) {
        return lines.map((l) => ({ type: dir, refs: [l.id] }));
      }
      if (points.length === 2 && geoms.length === 0) return [{ type: dir, refs: points }];
      return "hint.selectLinesOr2Points";
    },
    toPrimitives(doc, c) {
      const id = `${c.id}#0`;
      if (c.refs.length === 1) return [{ id, type: `${dir}_l`, l_id: c.refs[0] }];
      return [{ id, type: `${dir}_pp`, p1_id: c.refs[0], p2_id: c.refs[1] }];
    },
    anchor(doc: SketchDoc, c: Constraint) {
      if (c.refs.length === 1) return lineMid(doc, doc.geoms[c.refs[0]] as never);
      return mid(P(doc, c.refs[0]), P(doc, c.refs[1]));
    },
  };
}

export const horizontal = axis("horizontal", "h", "H");
export const vertical = axis("vertical", "v", "V");
