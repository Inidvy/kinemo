import { describe, it, expect, beforeAll } from "vitest";
import { Solver } from "../src/solver/solver";
import { addConstraint, addGeom, addPoint, emptyDoc, type Line, type SketchDoc } from "../src/core/model";
import { constraintTypes } from "../src/constraints";
import { dist } from "../src/core/geom";
import { measured } from "../src/render/layout";

let solver: Solver;
beforeAll(async () => {
  solver = await Solver.create();
});

function line(doc: SketchDoc, x1: number, y1: number, x2: number, y2: number) {
  const p1 = addPoint(doc, x1, y1);
  const p2 = addPoint(doc, x2, y2);
  const id = addGeom<Line>(doc, { kind: "line", p1, p2 });
  return { id, p1, p2 };
}

function apply(doc: SketchDoc, type: string, sel: string[]) {
  const out = constraintTypes.get(type).fromSelection(doc, sel);
  if (typeof out === "string") throw new Error(out);
  out.forEach((c) => addConstraint(doc, c));
  return out;
}

describe("solver", () => {
  it("only measures a watched dimension", () => {
    const doc = emptyDoc();
    const l = line(doc, 0, 0, 40, 5);
    apply(doc, "distance", [l.id]);
    const c = Object.values(doc.constraints).find((x) => x.type === "distance")!;
    c.value = 100;
    c.data = { watch: 1 };
    const r = solver.solve(doc);
    expect(r.ok).toBe(true);
    expect(dist(r.doc.points[l.p1], r.doc.points[l.p2])).toBeCloseTo(dist({ x: 0, y: 0 }, { x: 40, y: 5 }), 6);
    expect(measured(constraintTypes.get("distance").shape!(r.doc, c))).toBeCloseTo(Math.hypot(40, 5), 6);
  });

  it("makes a line horizontal and sets its length", () => {
    const doc = emptyDoc();
    const l = line(doc, 0, 0, 40, 5);
    apply(doc, "horizontal", [l.id]);
    apply(doc, "distance", [l.id]);
    Object.values(doc.constraints).find((c) => c.type === "distance")!.value = 100;
    const r = solver.solve(doc);
    expect(r.ok).toBe(true);
    const a = r.doc.points[l.p1], b = r.doc.points[l.p2];
    expect(a.y).toBeCloseTo(b.y, 6);
    expect(dist(a, b)).toBeCloseTo(100, 6);
    expect(r.dof).toBe(2);
  });

  it("reports which points are still free", () => {
    const doc = emptyDoc();
    const l = line(doc, 0, 0, 40, 0);
    apply(doc, "fix", [l.p1]);
    expect(solver.freePoints(doc)).toEqual(new Set([l.p2]));
    apply(doc, "fix", [l.p2]);
    expect(solver.freePoints(doc).size).toBe(0);
  });

  it("keeps an angle dimension when edited", () => {
    const doc = emptyDoc();
    const a = line(doc, 0, 0, 50, 0);
    const b = line(doc, 0, 0, 30, 30);
    apply(doc, "coincident", [a.p1, b.p1]);
    apply(doc, "fix", [a.p1, a.p2]);
    const [ang] = apply(doc, "angle", [a.id, b.id]);
    expect(ang.value).toBeCloseTo(45, 3);
    Object.values(doc.constraints).find((c) => c.type === "angle")!.value = 60;
    const r = solver.solve(doc);
    expect(r.ok).toBe(true);
    const p = r.doc.points[b.p2];
    expect((Math.atan2(p.y, p.x) * 180) / Math.PI).toBeCloseTo(60, 4);
  });

  it("drags a point as far as constraints allow", () => {
    const doc = emptyDoc();
    const l = line(doc, 0, 0, 40, 0);
    apply(doc, "fix", [l.p1]);
    apply(doc, "distance", [l.id]);
    const r = solver.solve(doc, [{ point: l.p2, to: { x: 0, y: 80 } }]);
    expect(r.ok).toBe(true);
    const p = r.doc.points[l.p2];
    expect(p.x).toBeCloseTo(0, 3);
    expect(p.y).toBeCloseTo(40, 3);
  });

  it("flags conflicting constraints", () => {
    const doc = emptyDoc();
    const l = line(doc, 0, 0, 40, 3);
    apply(doc, "horizontal", [l.id]);
    apply(doc, "vertical", [l.id]);
    apply(doc, "distance", [l.id]);
    const r = solver.solve(doc);
    expect(r.conflicting.length + r.redundant.length).toBeGreaterThan(0);
  });
});

describe("dragging", () => {
  it("resizes a rectangle when a corner is dragged instead of moving it", () => {
    const doc = emptyDoc();
    const a = line(doc, 0, 0, 40, 0);
    const b = line(doc, 40, 0, 40, 20);
    apply(doc, "coincident", [a.p2, b.p1]);
    apply(doc, "horizontal", [a.id]);
    apply(doc, "vertical", [b.id]);
    const r = solver.solve(doc, [{ point: b.p2, to: { x: 60, y: 30 } }]);
    expect(r.ok).toBe(true);
    expect(r.doc.points[a.p1].x).toBeCloseTo(0, 1);
    expect(r.doc.points[b.p2].x).toBeCloseTo(60, 1);
    expect(r.doc.points[b.p2].y).toBeCloseTo(30, 1);
  });
});

describe("ground pivots", () => {
  it("don't hold a point in the sketch", () => {
    const doc = emptyDoc();
    const l = line(doc, 0, 0, 40, 0);
    addConstraint(doc, { type: "groundPoint", refs: [l.p1] });
    expect(solver.solve(doc).dof).toBe(4);
  });
});
