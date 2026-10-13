// Timings for small to large mechanisms: `npm run bench`.
import { Solver } from "../src/solver/solver";
import { Mechanism } from "../src/motion/kinematics";
import { sweepPaths } from "../src/motion/paths";
import { cloneDoc } from "../src/core/model";
import { ladder } from "./ladder";

/** Average time of `f`, after one warm-up call. */
function time(label: string, f: () => unknown, reps = 3): void {
  f();
  const t0 = performance.now();
  for (let i = 0; i < reps; i++) f();
  console.log(`${label.padEnd(36)} ${((performance.now() - t0) / reps).toFixed(1).padStart(8)} ms`);
}

const solver = await Solver.create();
for (const k of [4, 12, 34]) {
  const { doc, crank } = ladder(k);
  const m = new Mechanism(doc);
  console.log(`\nchain of ${k} rockers: ${Object.keys(doc.points).length} points, ${m.joints.length} joints, ${m.moving.length} moving bodies`);
  const p = Object.values(doc.points)[5];
  time("sketch: solve", () => solver.solve(doc));
  time("sketch: one drag step", () => solver.solve(doc, [{ point: p.id, to: { x: p.x + 1, y: p.y } }]));
  time("sketch: free points (2 solves each)", () => solver.freePoints(doc), 1);
  time("motion: build mechanism", () => new Mechanism(doc));
  time("motion: degrees of freedom", () => m.dof());
  time("motion: assemble", () => m.assemble());
  time("motion: drag a rocker 2 mm", () => m.dragTo({ body: "r0", local: { x: 4, y: 30 }, to: { x: 6, y: 30 } }));
  time("motion: slider tick (4°)", () => m.driveTo(crank, m.measure(m.current(), crank) - 4));
  const traced = cloneDoc(doc);
  traced.motion.drivers.d1 = { id: "d1", joint: crank, a: "ground", b: "r0" };
  traced.motion.traces = [Object.values(traced.points)[10].id];
  time("motion: trace a whole cycle", () => sweepPaths(traced), 1);
}
