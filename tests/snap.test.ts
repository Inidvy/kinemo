import { describe, it, expect } from "vitest";
import { addConstraint, addGeom, addPoint, emptyDoc, type Line } from "../src/core/model";
import { constraintTypes } from "../src/constraints";
import { fitSelection } from "../src/constraints/select";
import { findSnap, snapConstraint, snapExclusions } from "../src/tools/snap";
import { View } from "../src/render/view";

function twoLines() {
  const doc = emptyDoc();
  const a1 = addPoint(doc, 0, 0), a2 = addPoint(doc, 40, 2);
  const b1 = addPoint(doc, 0, 20), b2 = addPoint(doc, 40, 25);
  const l1 = addGeom<Line>(doc, { kind: "line", p1: a1, p2: a2 });
  const l2 = addGeom<Line>(doc, { kind: "line", p1: b1, p2: b2 });
  return { doc, a1, a2, b1, b2, l1, l2 };
}

describe("constraints from a box selection", () => {
  it("ignores the end points a box picks up with its lines", () => {
    const { doc, a1, a2, b1, b2, l1, l2 } = twoLines();
    const out = fitSelection(constraintTypes.get("parallel"), doc, [a1, a2, l1, b1, b2, l2]);
    expect(out).toEqual([{ type: "parallel", refs: [l1, l2] }]);
    expect(fitSelection(constraintTypes.get("horizontal"), doc, [a1, a2, l1])).toEqual([{ type: "horizontal", refs: [l1] }]);
  });

  it("keeps a selection that already fits as it is", () => {
    const { doc, a1, a2 } = twoLines();
    expect(fitSelection(constraintTypes.get("horizontal"), doc, [a1, a2])).toEqual([{ type: "horizontal", refs: [a1, a2] }]);
  });

  it("keeps loose points that aren't part of a selected line", () => {
    const { doc, b1, l1 } = twoLines();
    expect(fitSelection(constraintTypes.get("midpoint"), doc, [b1, l1])).toEqual([{ type: "midpoint", refs: [b1, l1] }]);
  });
});

describe("snapping", () => {
  const view = new View();
  it("snaps to the middle of a line before the line itself", () => {
    const { doc, l1 } = twoLines();
    const m = view.toScreen({ x: 20, y: 1 });
    expect(findSnap(doc, view, { x: m.x + 3, y: m.y }).kind).toBe("midpoint");
    const off = view.toScreen({ x: 30, y: 1.5 });
    expect(findSnap(doc, view, off)).toMatchObject({ kind: "curve", id: l1 });
  });

  it("prefers points, and skips what the dragged point is part of", () => {
    const { doc, a1, a2, l1 } = twoLines();
    expect(findSnap(doc, view, view.toScreen({ x: 40, y: 2 }))).toMatchObject({ kind: "point", id: a2 });
    const ex = snapExclusions(doc, a1);
    expect(ex.has(l1) && ex.has(a2)).toBe(true);
    expect(findSnap(doc, view, view.toScreen({ x: 20, y: 1 }), ex).kind).toBe("none");
  });

  it("turns a snap into the matching constraint once", () => {
    const { doc, b1, l1, a2 } = twoLines();
    expect(snapConstraint(doc, b1, { kind: "midpoint", id: l1, at: { x: 20, y: 1 } })).toEqual({ type: "midpoint", refs: [b1, l1] });
    expect(snapConstraint(doc, b1, { kind: "curve", id: l1, at: { x: 10, y: 0.5 } })).toEqual({ type: "onCurve", refs: [b1, l1] });
    addConstraint(doc, { type: "coincident", refs: [a2, b1] });
    expect(snapConstraint(doc, b1, { kind: "point", id: a2, at: { x: 40, y: 2 } })).toBeNull();
  });
});
