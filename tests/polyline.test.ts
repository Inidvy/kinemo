import { describe, it, expect } from "vitest";
import { arcFromNormal, arcFromTangent } from "../src/tools/polylineGeom";
import { dist } from "../src/core/geom";
import { constraintTypes } from "../src/constraints";
import { addGeom, addPoint, emptyDoc, type Line } from "../src/core/model";

describe("polyline arcs", () => {
  it("tangent arc leaves along the previous direction and ends at the cursor", () => {
    const p = { x: 0, y: 0 }, q = { x: 10, y: 10 };
    const a = arcFromTangent(p, { x: 1, y: 0 }, q)!;
    expect(a.r).toBeCloseTo(10);
    expect(a.center).toEqual({ x: 0, y: 10 });
    expect(dist(a.center, q)).toBeCloseTo(Math.abs(a.r));
    expect(a.endTangent.x).toBeCloseTo(0);
    expect(a.endTangent.y).toBeCloseTo(1);
  });

  it("turns right when the cursor is to the right", () => {
    const a = arcFromTangent({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 10, y: -10 })!;
    expect(a.r).toBeLessThan(0);
    expect(a.endTangent.y).toBeCloseTo(-1);
  });

  it("normal arc puts its centre on the previous line", () => {
    const a = arcFromNormal({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: -5, y: 5 })!;
    expect(a.center.y).toBeCloseTo(0);
    expect(dist(a.center, { x: 0, y: 0 })).toBeCloseTo(Math.abs(a.r));
  });

  it("returns null when the cursor is straight ahead", () => {
    expect(arcFromTangent({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 5, y: 0 })).toBeNull();
  });
});

describe("coincident", () => {
  it("becomes point-on-curve when a point and a line are selected", () => {
    const doc = emptyDoc();
    const a = addPoint(doc, 0, 0), b = addPoint(doc, 10, 0), p = addPoint(doc, 5, 3);
    const l = addGeom<Line>(doc, { kind: "line", p1: a, p2: b });
    const out = constraintTypes.get("coincident").fromSelection(doc, [p, l]);
    expect(out).toEqual([{ type: "onCurve", refs: [p, l] }]);
  });
});

describe("tangent at a shared end point", () => {
  it("is not reported redundant and holds tangency", async () => {
    const { Solver } = await import("../src/solver/solver");
    const { makeTangent } = await import("../src/constraints/defs/relations");
    const { addConstraint } = await import("../src/core/model");
    const s = await Solver.create();
    const doc = emptyDoc();
    const a = addPoint(doc, 0, 0), b = addPoint(doc, 50, 0);
    const l = addGeom<Line>(doc, { kind: "line", p1: a, p2: b });
    const p = addPoint(doc, 50, 0), q = addPoint(doc, 80, 30), c = addPoint(doc, 50, 30);
    const arc = addGeom(doc, { kind: "arc", c, s: p, e: q } as never);
    addConstraint(doc, { type: "coincident", refs: [b, p] });
    addConstraint(doc, makeTangent(doc, doc.geoms[l], doc.geoms[arc]));
    const r = s.solve(doc);
    expect(r.ok).toBe(true);
    expect(r.redundant).toEqual([]);
    expect(r.dof).toBe(6);
  });
});
