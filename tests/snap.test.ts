import { describe, it, expect, beforeAll } from "vitest";
import { Solver } from "../src/solver/solver";
import { addConstraint, addGeom, addPoint, emptyDoc, type Line } from "../src/core/model";
import { constraintTypes } from "../src/constraints";
import { addConstraintSmart, fitSelection } from "../src/constraints/select";
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

describe("smarter constraints", () => {
  it("a midpoint replaces the point-on-line it makes redundant", () => {
    const { doc, b1, l1 } = twoLines();
    addConstraint(doc, { type: "onCurve", refs: [b1, l1] });
    expect(addConstraintSmart(doc, { type: "midpoint", refs: [b1, l1] })).toBe(true);
    expect(Object.values(doc.constraints).map((c) => c.type)).toEqual(["midpoint"]);
    expect(addConstraintSmart(doc, { type: "onCurve", refs: [b1, l1] })).toBe(false);
  });

  it("shows equal on both lines, whichever was picked first", () => {
    const { doc, l1, l2 } = twoLines();
    const [c] = constraintTypes.get("equal").fromSelection(doc, [l2, l1]) as { type: string; refs: string[] }[];
    expect(constraintTypes.get("equal").anchors!(doc, { ...c, id: "c" })).toHaveLength(2);
  });
});

describe("horizontal and vertical distances", () => {
  let solver: Solver;
  beforeAll(async () => { solver = await Solver.create(); });
  it("set only the x or y part of a line, keeping its direction", () => {
    const { doc, l1, a1, a2 } = twoLines();
    const fix = constraintTypes.get("fix").fromSelection(doc, [a1]) as never[];
    fix.forEach((c) => addConstraint(doc, c));
    const [dx] = constraintTypes.get("distanceX").fromSelection(doc, [l1]) as { type: string; refs: string[]; value: number }[];
    expect(dx.value).toBe(40);
    addConstraint(doc, { ...dx, value: 25 });
    const [dy] = constraintTypes.get("distanceY").fromSelection(doc, [a2, a1]) as { type: string; refs: string[]; value: number }[];
    addConstraint(doc, { ...dy, value: 10 });
    const r = solver.solve(doc);
    expect(Solver.clean(r)).toBe(true);
    expect(r.doc.points[a2].x - r.doc.points[a1].x).toBeCloseTo(25);
    expect(r.doc.points[a2].y - r.doc.points[a1].y).toBeCloseTo(10);
  });
});

describe("equal in a busy sketch", () => {
  it("doesn't link lines that are already equal through others, in either order", () => {
    const { doc, l1, l2 } = twoLines();
    const a = addPoint(doc, 0, 50), b = addPoint(doc, 30, 50);
    const l3 = addGeom<Line>(doc, { kind: "line", p1: a, p2: b });
    addConstraint(doc, { type: "equal", refs: [l1, l3] });
    addConstraint(doc, { type: "equal", refs: [l3, l2] });
    const eq = constraintTypes.get("equal");
    expect(eq.fromSelection(doc, [l1, l2])).toBe("hint.alreadyEqual");
    expect(eq.fromSelection(doc, [l2, l1])).toBe("hint.alreadyEqual");
  });
});
