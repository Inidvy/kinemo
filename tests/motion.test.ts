import { describe, it, expect } from "vitest";
import { addConstraint, addGeom, addPoint, emptyDoc, type Id, type Line, type SketchDoc } from "../src/core/model";
import { Mechanism } from "../src/motion/kinematics";
import { applyPose } from "../src/motion/bodies";

function bar(doc: SketchDoc, x1: number, y1: number, x2: number, y2: number) {
  const p1 = addPoint(doc, x1, y1), p2 = addPoint(doc, x2, y2);
  return { id: addGeom<Line>(doc, { kind: "line", p1, p2 }), p1, p2 };
}
function body(doc: SketchDoc, id: string, members: Id[], ground = false) {
  doc.bodies[id] = { id, name: id, members, ground };
}
function apply(doc: SketchDoc, m: Mechanism, q: number[]) {
  doc.motion.poses = m.poses(q);
}

/** Ground 0-40 on the x axis, crank up from 0, coupler, rocker up from 40. */
function fourBar() {
  const doc = emptyDoc();
  const g = bar(doc, 0, 0, 40, 0);
  const crank = bar(doc, 0, 0, 0, 20);
  const coupler = bar(doc, 0, 20, 40, 30);
  const rocker = bar(doc, 40, 0, 40, 30);
  const pins = [
    addConstraint(doc, { type: "coincident", refs: [g.p1, crank.p1] }),
    addConstraint(doc, { type: "coincident", refs: [crank.p2, coupler.p1] }),
    addConstraint(doc, { type: "coincident", refs: [coupler.p2, rocker.p2] }),
    addConstraint(doc, { type: "coincident", refs: [rocker.p1, g.p2] }),
  ];
  body(doc, "ground", [g.id], true);
  body(doc, "crank", [crank.id]);
  body(doc, "coupler", [coupler.id]);
  body(doc, "rocker", [rocker.id]);
  return { doc, crank, coupler, rocker, pins };
}

function jointsHold(m: Mechanism, q: number[]) {
  const k = m.context(q);
  for (const j of m.joints) {
    if (j.kind === "pin") {
      const a = k.w(j.refs[0]), b = k.w(j.refs[1]);
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(1e-6);
    }
  }
}

describe("motion", () => {
  it("finds pins between bodies and counts one degree of freedom for a four-bar", () => {
    const { doc } = fourBar();
    const m = new Mechanism(doc);
    expect(m.joints.map((j) => j.kind)).toEqual(["pin", "pin", "pin", "pin"]);
    expect(m.dof()).toBe(1);
  });

  it("drives the crank angle with a slider", () => {
    const { doc, pins } = fourBar();
    const m = new Mechanism(doc);
    expect(m.measure(m.current(), pins[0])).toBeCloseTo(90, 6);
    const r = m.driveTo(pins[0], 60);
    expect(r.reached).toBe(true);
    expect(m.measure(r.q, pins[0])).toBeCloseTo(60, 5);
    jointsHold(m, r.q);
  });

  it("drags a point and keeps the joints together", () => {
    const { doc, coupler } = fourBar();
    const m = new Mechanism(doc);
    let q = m.current();
    for (let i = 1; i <= 10; i++) {
      apply(doc, m, q);
      q = m.solve({ drag: { body: "coupler", local: doc.points[coupler.p1], to: { x: -i, y: 20 } } }) ?? q;
    }
    jointsHold(m, q);
    const p = applyPose(m.pose(q, "coupler"), doc.points[coupler.p1]);
    expect(p.x).toBeLessThan(-5);
  });

  it("stops at the last valid pose when a slider asks too much", () => {
    // With a short rocker the crank can't swing down to horizontal.
    const doc = emptyDoc();
    const g = bar(doc, 0, 0, 40, 0);
    const crank = bar(doc, 0, 0, 0, 20);
    const coupler = bar(doc, 0, 20, 40, 5);
    const rocker = bar(doc, 40, 0, 40, 5);
    const pin = addConstraint(doc, { type: "coincident", refs: [g.p1, crank.p1] });
    addConstraint(doc, { type: "coincident", refs: [crank.p2, coupler.p1] });
    addConstraint(doc, { type: "coincident", refs: [coupler.p2, rocker.p2] });
    addConstraint(doc, { type: "coincident", refs: [rocker.p1, g.p2] });
    body(doc, "ground", [g.id], true);
    body(doc, "crank", [crank.id]);
    body(doc, "coupler", [coupler.id]);
    body(doc, "rocker", [rocker.id]);
    const m = new Mechanism(doc);
    const r = m.driveTo(pin, 0);
    expect(r.reached).toBe(false);
    jointsHold(m, r.q);
    const stopped = m.measure(r.q, pin);
    expect(stopped).toBeLessThan(90);
    expect(stopped).toBeGreaterThan(0);
  });

  it("flips a four-bar to its other assembly", () => {
    const { doc, pins } = fourBar();
    const m = new Mechanism(doc);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const q = m.flip([{ id: "d", joint: pins[0], a: "ground", b: "crank" }], rnd);
    expect(q).not.toBeNull();
    jointsHold(m, q!);
    expect(m.measure(q!, pins[0])).toBeCloseTo(90, 4);
    expect(m.distance(q!, m.current())).toBeGreaterThan(1);
  });

  it("clamps a slider block at the end of its slot", () => {
    const doc = emptyDoc();
    const rail = bar(doc, 0, 0, 50, 0);
    const block = bar(doc, 10, 0, 10, 5);
    const slot = addConstraint(doc, { type: "onCurve", refs: [block.p1, rail.id] });
    addConstraint(doc, { type: "vertical", refs: [block.id] });
    body(doc, "rail", [rail.id], true);
    body(doc, "block", [block.id]);
    const m = new Mechanism(doc);
    expect(m.joints[0].kind).toBe("slot");
    // Block has 2 DOF (slide and turn).
    expect(m.dof()).toBe(2);
    const q = m.solve({ drag: { body: "block", local: doc.points[block.p1], to: { x: 80, y: 0 } } })!;
    expect(m.measure(q, slot)).toBeCloseTo(50, 4);
  });
});
