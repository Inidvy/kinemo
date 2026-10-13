import { describe, it, expect } from "vitest";
import { addConstraint, addGeom, addPoint, emptyDoc, type Arc, type Circle, type Id, type Line, type SketchDoc } from "../src/core/model";
import { Mechanism } from "../src/motion/kinematics";
import { applyPose } from "../src/motion/bodies";
import { jointKinds } from "../src/motion/joints";

function bar(doc: SketchDoc, x1: number, y1: number, x2: number, y2: number) {
  const p1 = addPoint(doc, x1, y1), p2 = addPoint(doc, x2, y2);
  return { id: addGeom<Line>(doc, { kind: "line", p1, p2 }), p1, p2 };
}
function body(doc: SketchDoc, id: string, members: Id[], ground = false) {
  doc.bodies[id] = { id, name: id, members, ground };
}
function jointRange(m: Mechanism, id: Id) {
  return jointKinds.get(m.joint(id)!.kind).range(m.doc, m.joint(id)!)[1];
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

describe("tracks", () => {
  /** An L-shaped ground track (0,0)-(50,0)-(50,40) of two track lines, with a block on the first line. */
  function lTrack() {
    const doc = emptyDoc();
    const a = bar(doc, 0, 0, 50, 0), b = bar(doc, 50, 40, 50, 0);
    doc.geoms[a.id].track = true;
    doc.geoms[b.id].track = true;
    addConstraint(doc, { type: "coincident", refs: [a.p2, b.p2] });
    const block = bar(doc, 10, 0, 10, 5);
    const joint = addConstraint(doc, { type: "onCurve", refs: [block.p1, a.id] });
    body(doc, "rail", [a.id, b.id], true);
    body(doc, "block", [block.id]);
    return { doc, block, joint };
  }

  it("runs a pin across connected track pieces", () => {
    const { doc, block, joint } = lTrack();
    const m = new Mechanism(doc);
    expect(m.joints[0].kind).toBe("track");
    expect(m.dof()).toBe(2);
    expect(m.measure(m.current(), joint)).toBeCloseTo(10, 6);
    // Drive round the corner and up the second line.
    const r = m.driveTo(joint, 70);
    expect(r.reached).toBe(true);
    const p = applyPose(m.pose(r.q, "block"), doc.points[block.p1]);
    expect(p.x).toBeCloseTo(50, 4);
    expect(p.y).toBeCloseTo(20, 4);
    // Dragging round the corner and past the far end stops at the end.
    const back = structuredClone(doc);
    let mm = new Mechanism(back);
    for (let i = 1; i <= 30; i++) {
      const to = i <= 15 ? { x: 10 + (40 * i) / 15, y: 0 } : { x: 50, y: (90 * (i - 15)) / 15 };
      const q = mm.solve({ drag: { body: "block", local: doc.points[block.p1], to }, maxTurn: 0.8 });
      if (q) apply(back, mm, q);
      mm = new Mechanism(structuredClone(back));
    }
    expect(mm.measure(mm.current(), joint)).toBeCloseTo(90, 3);
  });

  it("goes round a closed track of a line and an arc", () => {
    const doc = emptyDoc();
    // A D shape: a line from (0,-10) to (0,10) and an arc back round to (0,-10).
    const line = bar(doc, 0, -10, 0, 10);
    const c = addPoint(doc, 0, 0), s = addPoint(doc, 0, 10), e = addPoint(doc, 0, -10);
    const arc = addGeom<Arc>(doc, { kind: "arc", c, s, e });
    doc.geoms[line.id].track = true;
    doc.geoms[arc].track = true;
    const block = bar(doc, 0, 0, 3, 0);
    const joint = addConstraint(doc, { type: "onCurve", refs: [block.p1, line.id] });
    body(doc, "rail", [line.id, arc], true);
    body(doc, "block", [block.id]);
    const m = new Mechanism(doc);
    expect(m.joints[0].kind).toBe("track");
    const total = 20 + Math.PI * 10;
    expect(m.context(m.current()) && jointRange(m, joint)).toBeCloseTo(total, 6);
    // Round the arc to its far side, (-10, 0).
    const r = m.driveTo(joint, 20 + (Math.PI * 10) / 2);
    expect(r.reached).toBe(true);
    const p = applyPose(m.pose(r.q, "block"), doc.points[block.p1]);
    expect(p.x).toBeCloseTo(-10, 3);
    expect(p.y).toBeCloseTo(0, 3);
  });

  it("lets a slider only slide when it is set not to turn", () => {
    // A rounded corner: the block turns with the track as it goes round.
    const doc = emptyDoc();
    const a = bar(doc, 0, 0, 30, 0), b = bar(doc, 40, 10, 40, 40);
    const c = addPoint(doc, 30, 10), s0 = addPoint(doc, 30, 0), e0 = addPoint(doc, 40, 10);
    const arc = addGeom<Arc>(doc, { kind: "arc", c, s: s0, e: e0 });
    for (const id of [a.id, b.id, arc]) doc.geoms[id].track = true;
    addConstraint(doc, { type: "coincident", refs: [a.p2, s0] });
    addConstraint(doc, { type: "coincident", refs: [e0, b.p1] });
    const block = bar(doc, 10, 0, 10, 5);
    const joint = addConstraint(doc, { type: "onCurve", refs: [block.p1, a.id] });
    doc.constraints[joint].data = { noTurn: 1 };
    body(doc, "rail", [a.id, arc, b.id], true);
    body(doc, "block", [block.id]);
    const m = new Mechanism(doc);
    expect(m.dof()).toBe(1);
    const r = m.driveTo(joint, 50);
    expect(r.reached).toBe(true);
    expect(m.pose(r.q, "block").a).toBeCloseTo(Math.PI / 2, 4);
    // A block that can't turn stops at a sharp corner.
    const l = lTrack();
    l.doc.constraints[l.joint].data = { noTurn: 1 };
    const ml = new Mechanism(l.doc);
    expect(ml.driveTo(l.joint, 70).reached).toBe(false);
  });

  it("keeps a single track line as a plain slot", () => {
    const doc = emptyDoc();
    const a = bar(doc, 0, 0, 50, 0);
    doc.geoms[a.id].track = true;
    const block = bar(doc, 10, 0, 10, 5);
    addConstraint(doc, { type: "onCurve", refs: [block.p1, a.id] });
    body(doc, "rail", [a.id], true);
    body(doc, "block", [block.id]);
    expect(new Mechanism(doc).joints[0].kind).toBe("slot");
  });
});

describe("gears", () => {
  function circle(doc: SketchDoc, x: number, y: number, r: number) {
    const c = addPoint(doc, x, y);
    return { id: addGeom<Circle>(doc, { kind: "circle", c, r }), c };
  }

  it("turns a meshed gear the other way by the ratio of their sizes", () => {
    const doc = emptyDoc();
    const ground = bar(doc, 0, 0, 30, 0);
    const small = circle(doc, 0, 0, 10), big = circle(doc, 30, 0, 20);
    const pin = addConstraint(doc, { type: "coincident", refs: [ground.p1, small.c] });
    addConstraint(doc, { type: "coincident", refs: [ground.p2, big.c] });
    const mesh = addConstraint(doc, { type: "tangent", refs: [small.id, big.id] });
    body(doc, "ground", [ground.id], true);
    body(doc, "small", [small.id]);
    body(doc, "big", [big.id]);
    const m = new Mechanism(doc);
    expect(m.joint(mesh)!.kind).toBe("gear");
    expect(m.dof()).toBe(1);
    const r = m.driveTo(pin, 90);
    expect(r.reached).toBe(true);
    expect(m.pose(r.q, "big").a).toBeCloseTo(-Math.PI / 4, 5);
  });

  it("turns a gear inside a ring gear the same way", () => {
    const doc = emptyDoc();
    const ground = bar(doc, 0, 0, 10, 0);
    const ring = circle(doc, 0, 0, 30), small = circle(doc, 20, 0, 10);
    const pin = addConstraint(doc, { type: "coincident", refs: [ground.p1, ring.c] });
    addConstraint(doc, { type: "coincident", refs: [ground.p2, small.c] });
    // Ground point at (10,0) is moved onto the small gear's centre by the sketch; here put it there.
    doc.points[ground.p2] = { ...doc.points[ground.p2], x: 20 };
    addConstraint(doc, { type: "tangent", refs: [ring.id, small.id] });
    body(doc, "ground", [ground.id], true);
    body(doc, "ring", [ring.id]);
    body(doc, "small", [small.id]);
    const m = new Mechanism(doc);
    expect(m.joints.map((j) => j.kind)).toContain("gear");
    const r = m.driveTo(pin, 30);
    expect(r.reached).toBe(true);
    expect(m.pose(r.q, "small").a).toBeCloseTo((Math.PI / 6) * 3, 5);
  });

  it("rolls a pinion along a rack", () => {
    const doc = emptyDoc();
    const rack = bar(doc, 0, 0, 100, 0);
    const pinion = circle(doc, 20, 10, 10);
    const mesh = addConstraint(doc, { type: "tangent", refs: [rack.id, pinion.id] });
    body(doc, "rack", [rack.id], true);
    body(doc, "pinion", [pinion.id]);
    const m = new Mechanism(doc);
    expect(m.joint(mesh)!.kind).toBe("rack");
    expect(m.dof()).toBe(1);
    const r = m.driveTo(mesh, 20 + Math.PI * 10);
    expect(r.reached).toBe(true);
    // Half a circumference to the right is half a turn clockwise.
    const p = m.pose(r.q, "pinion");
    expect(p.a).toBeCloseTo(-Math.PI, 4);
    expect(applyPose(p, doc.points[pinion.c]).y).toBeCloseTo(10, 6);
  });
});

describe("bodies", () => {
  it("turns a body fixed at one point about it, and holds one fixed at two", async () => {
    const { groundBodies } = await import("../src/motion/bodies");
    const doc = emptyDoc();
    const a = bar(doc, 0, 0, 10, 0);
    const fix = addConstraint(doc, { type: "fix", refs: [a.p1], data: { x: 0, y: 0 } });
    body(doc, "a", [a.id]);
    expect(groundBodies(doc).has("a")).toBe(false);
    const m = new Mechanism(doc);
    expect(m.joints.map((j) => j.kind)).toEqual(["anchor"]);
    expect(m.dof()).toBe(1);
    const r = m.driveTo(fix, 90);
    expect(r.reached).toBe(true);
    const tip = applyPose(m.pose(r.q, "a"), doc.points[a.p2]);
    expect(tip.x).toBeCloseTo(0, 5);
    expect(tip.y).toBeCloseTo(10, 5);
    // Documents are immutable snapshots in the app, so change a copy.
    const doc2 = structuredClone(doc);
    addConstraint(doc2, { type: "fix", refs: [a.p2], data: { x: 10, y: 0 } });
    expect(groundBodies(doc2).has("a")).toBe(true);
    expect(new Mechanism(doc2).moving).toEqual([]);
  });

  it("finds a triangle plate even when an edge is split into three lines", async () => {
    const { bodyLoops } = await import("../src/render/bars");
    const doc = emptyDoc();
    const ids = [bar(doc, 0, 0, 10, 0), bar(doc, 10, 0, 20, 0), bar(doc, 20, 0, 30, 0), bar(doc, 30, 0, 15, 20), bar(doc, 15, 20, 0, 0)].map((l) => l.id);
    body(doc, "tri", ids);
    const loops = bodyLoops(doc, doc.bodies.tri);
    expect(loops.length).toBe(1);
    expect(loops[0].length).toBe(5);
    // Three lines in a row make no plate.
    const doc2 = emptyDoc();
    body(doc2, "row", [bar(doc2, 0, 0, 10, 0), bar(doc2, 10, 0, 20, 0), bar(doc2, 20, 0, 30, 0)].map((l) => l.id));
    expect(bodyLoops(doc2, doc2.bodies.row).length).toBe(0);
  });
});
