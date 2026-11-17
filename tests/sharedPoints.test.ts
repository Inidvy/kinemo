import { describe, it, expect, beforeAll } from "vitest";
import { addConstraint, addGeom, addPoint, deleteItems, emptyDoc, mergePoints, pruneBodies, type Line, type SketchDoc } from "../src/core/model";
import { placePoint } from "../src/tools/build";
import { Solver } from "../src/solver/solver";
import { Mechanism } from "../src/motion/kinematics";
import { addDriver } from "../src/motion/drivers";

// The editor only needs timers from the page.
(globalThis as { window?: unknown }).window ??= globalThis;

let solver: Solver;
beforeAll(async () => {
  solver = await Solver.create();
});

const line = (doc: SketchDoc, p1: string, p2: string) => addGeom<Line>(doc, { kind: "line", p1, p2 });

describe("lines that end at one place share one point", () => {
  it("a line drawn from an existing point uses that point", () => {
    const doc = emptyDoc();
    const a = addPoint(doc, 0, 0), b = addPoint(doc, 10, 0);
    line(doc, a, b);
    const p = placePoint(doc, { kind: "point", id: b, at: { x: 10, y: 0 } });
    expect(p).toBe(b);
    expect(Object.keys(doc.points)).toHaveLength(2);
    expect(Object.keys(doc.constraints)).toHaveLength(0);
  });

  it("the point tool can still put a separate point on top of one", () => {
    const doc = emptyDoc();
    const a = addPoint(doc, 0, 0);
    const p = placePoint(doc, { kind: "point", id: a, at: { x: 0, y: 0 } }, false);
    expect(p).not.toBe(a);
    expect(Object.values(doc.constraints).map((c) => c.type)).toEqual(["coincident"]);
  });

  it("a rectangle of shared corners solves cleanly", () => {
    const doc = emptyDoc();
    const ps = [addPoint(doc, 0, 0), addPoint(doc, 60, 0), addPoint(doc, 60, 40), addPoint(doc, 0, 40)];
    const ls = ps.map((p, i) => line(doc, p, ps[(i + 1) % 4]));
    addConstraint(doc, { type: "horizontal", refs: [ls[0]] });
    addConstraint(doc, { type: "vertical", refs: [ls[1]] });
    addConstraint(doc, { type: "horizontal", refs: [ls[2]] });
    addConstraint(doc, { type: "vertical", refs: [ls[3]] });
    expect(Solver.clean(solver.solve(doc))).toBe(true);
  });

  it("merging two points moves everything onto one and drops the coincident between them", () => {
    const doc = emptyDoc();
    const a = addPoint(doc, 0, 0), b = addPoint(doc, 10, 0), c = addPoint(doc, 10, 0), d = addPoint(doc, 10, 10);
    const l1 = line(doc, a, b), l2 = line(doc, c, d);
    addConstraint(doc, { type: "coincident", refs: [b, c] });
    addConstraint(doc, { type: "groundPoint", refs: [b] });
    addConstraint(doc, { type: "groundPoint", refs: [c] });
    mergePoints(doc, b, c);
    expect(doc.points[c]).toBeUndefined();
    expect((doc.geoms[l2] as Line).p1).toBe(b);
    expect((doc.geoms[l1] as Line).p2).toBe(b);
    expect(Object.values(doc.constraints).map((x) => x.type)).toEqual(["groundPoint"]);
  });
});

describe("making bodies from lines that share a point", () => {
  it("gives the new body its own point there, pinned to the other body", async () => {
    const { Editor } = await import("../src/app/editor");
    const { actions } = await import("../src/ui/actions");
    const ed = new Editor(solver);
    let l1 = "", l2 = "", shared = "";
    ed.change((doc) => {
      const a = addPoint(doc, 0, 0);
      shared = addPoint(doc, 20, 0);
      const c = addPoint(doc, 20, 20);
      l1 = line(doc, a, shared);
      l2 = line(doc, shared, c);
    });
    ed.select([l1]);
    actions.get("makeBody").run(ed);
    // The first body keeps the shared point: nothing else is a body yet.
    expect(Object.values(ed.doc.constraints)).toHaveLength(0);
    ed.select([l2]);
    actions.get("makeBody").run(ed);
    const g2 = ed.doc.geoms[l2] as Line;
    expect(g2.p1).not.toBe(shared);
    const pins = Object.values(ed.doc.constraints).filter((c) => c.type === "coincident");
    expect(pins).toHaveLength(1);
    expect(new Set(pins[0].refs)).toEqual(new Set([shared, g2.p1]));
    // That coincident is a pin joint between the two bodies.
    expect(new Mechanism(ed.doc).joint(pins[0].id)?.kind).toBe("pin");
  });
});

describe("sliders", () => {
  function crank() {
    const doc = emptyDoc();
    const a = addPoint(doc, 0, 0), b = addPoint(doc, 20, 0);
    const l = line(doc, a, b);
    doc.bodies.crank = { id: "crank", name: "Crank", members: [l] };
    const pivot = addConstraint(doc, { type: "groundPoint", refs: [a] });
    const stray = line(doc, addPoint(doc, 50, 50), addPoint(doc, 60, 50));
    return { doc, pivot, stray };
  }

  it("a fixed pivot's slider survives deleting something else in the sketch", () => {
    const { doc, pivot, stray } = crank();
    const j = new Mechanism(doc).joint(pivot)!;
    expect(j.kind).toBe("anchor");
    const d = addDriver(doc, j.id, j.a, j.b);
    deleteItems(doc, [stray]);
    pruneBodies(doc);
    expect(doc.motion.drivers[d]).toBeDefined();
  });

  it("stays through switching between Sketch and Motion with edits in between", async () => {
    const { Editor } = await import("../src/app/editor");
    const { actions } = await import("../src/ui/actions");
    const { doc, pivot, stray } = crank();
    const ed = new Editor(solver);
    ed.load(doc);
    ed.setMode("motion");
    const j = ed.mech.joint(pivot)!;
    ed.change((d) => void addDriver(d, j.id, j.a, j.b));
    ed.setMode("sketch");
    ed.select([stray]);
    actions.get("delete").run(ed);
    ed.setMode("motion");
    expect(Object.values(ed.doc.motion.drivers).map((x) => x.joint)).toEqual([pivot]);
  });
});
