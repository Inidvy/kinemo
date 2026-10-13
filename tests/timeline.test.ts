import { describe, it, expect } from "vitest";
import { addConstraint, addGeom, addPoint, emptyDoc, type Line, type SketchDoc, type Timeline } from "../src/core/model";
import { clipTime, setKey, valueAt } from "../src/motion/timeline";
import { sweepPaths } from "../src/motion/paths";
import { Mechanism } from "../src/motion/kinematics";
import { addDriver } from "../src/motion/drivers";

describe("timeline", () => {
  it("eases between keys unless a stretch is steady", () => {
    const keys = [{ t: 0, v: 0 }, { t: 2, v: 10 }];
    expect(valueAt(keys, -1)).toBe(0);
    expect(valueAt(keys, 1)).toBeCloseTo(5);
    expect(valueAt(keys, 0.5)).toBeLessThan(2.5);
    expect(valueAt(keys, 3)).toBe(10);
    expect(valueAt([{ t: 0, v: 0, linear: true }, { t: 2, v: 10 }], 0.5)).toBeCloseTo(2.5);
    expect(valueAt([], 1)).toBeNull();
  });

  it("plays once, loops and ping-pongs", () => {
    const tl = (mode: Timeline["mode"]): Timeline => ({ length: 4, mode, keys: {} });
    expect(clipTime(5, tl("once"))).toEqual({ t: 4, done: true });
    expect(clipTime(5, tl("loop")).t).toBeCloseTo(1);
    expect(clipTime(5, tl("pingpong")).t).toBeCloseTo(3);
    expect(clipTime(9, tl("pingpong")).t).toBeCloseTo(1);
  });

  it("keeps keys in time order and replaces a key at the same time", () => {
    const tl: Timeline = { length: 4, mode: "loop", keys: {} };
    setKey(tl, "d", 2, 5);
    setKey(tl, "d", 0, 1);
    setKey(tl, "d", 2, 7);
    expect(tl.keys.d).toEqual([{ t: 0, v: 1 }, { t: 2, v: 7 }]);
  });
});

/** A crank of length 20 turning about the origin, driven by a slider. */
function crank(): { doc: SketchDoc; tip: string; joint: string } {
  const doc = emptyDoc();
  const g1 = addPoint(doc, -10, 0), g2 = addPoint(doc, 0, 0);
  const ground = addGeom<Line>(doc, { kind: "line", p1: g1, p2: g2 });
  const c1 = addPoint(doc, 0, 0), tip = addPoint(doc, 20, 0);
  const arm = addGeom<Line>(doc, { kind: "line", p1: c1, p2: tip });
  const joint = addConstraint(doc, { type: "coincident", refs: [g2, c1] });
  doc.bodies.g = { id: "g", name: "g", members: [ground], ground: true };
  doc.bodies.c = { id: "c", name: "c", members: [arm] };
  addDriver(doc, joint, "g", "c");
  return { doc, tip, joint };
}

describe("path tracing", () => {
  it("traces a full circle for a crank", () => {
    const { doc, tip } = crank();
    doc.motion.traces = [tip];
    const path = sweepPaths(doc).get(tip)!;
    expect(path.length).toBeGreaterThan(100);
    for (const p of path) expect(Math.hypot(p.x, p.y)).toBeCloseTo(20, 3);
    const angles = path.map((p) => Math.atan2(p.y, p.x));
    expect(Math.max(...angles) - Math.min(...angles)).toBeGreaterThan(6);
  });

  it("follows the timeline when it has keys", () => {
    const { doc, tip } = crank();
    const d = Object.keys(doc.motion.drivers)[0];
    doc.motion.traces = [tip];
    const m = new Mechanism(doc);
    const v0 = m.measure(m.current(), doc.motion.drivers[d].joint);
    doc.motion.timeline = { length: 2, mode: "loop", keys: { [d]: [{ t: 0, v: v0 }, { t: 2, v: v0 + 90 }] } };
    const path = sweepPaths(doc).get(tip)!;
    const a = (p: { x: number; y: number }) => Math.atan2(p.y, p.x);
    // A quarter turn one way or the other, not the whole way round.
    expect(Math.abs(a(path[path.length - 1]) - a(path[0]))).toBeCloseTo(Math.PI / 2, 3);
    const swept = path.map((p) => Math.abs(Math.atan2(Math.sin(a(p) - a(path[0])), Math.cos(a(p) - a(path[0])))));
    expect(Math.max(...swept)).toBeLessThan(Math.PI / 2 + 1e-3);
  });

  it("drives several sliders together", () => {
    const { doc, joint } = crank();
    const m = new Mechanism(doc);
    const r = m.driveAll([{ joint, value: 120 }]);
    expect(r.reached).toBe(true);
    expect(m.measure(r.q, joint)).toBeCloseTo(120, 3);
  });
});

describe("recording", () => {
  it("turns a shaky recorded movement into a few smooth keys that follow it", async () => {
    const { keysFromRecording } = await import("../src/motion/timeline");
    const ts: number[] = [], vs: number[] = [];
    for (let i = 0; i <= 180; i++) {
      const t = 10 + i / 60;
      ts.push(t);
      vs.push(90 * Math.sin((Math.PI * (t - 10)) / 3) + (i % 2 ? 0.4 : -0.4));
    }
    const keys = keysFromRecording(ts, vs);
    expect(keys[0].t).toBe(0);
    expect(keys[keys.length - 1].t).toBeCloseTo(3, 2);
    expect(keys.length).toBeLessThan(20);
    for (let i = 0; i <= 180; i += 7) expect(Math.abs(valueAt(keys, i / 60)! - 90 * Math.sin((Math.PI * i) / 180))).toBeLessThan(3);
  });
});
