import type { Id, SketchDoc, Vec } from "../core/model";
import { applyPose, ownerMap } from "./bodies";
import { jointKinds } from "./joints";
import { Mechanism } from "./kinematics";
import { sampleClip } from "./clip";

/**
 * The paths traced points follow over a whole cycle of the mechanism: the
 * timeline clip if it has keyframes, otherwise the first slider over its
 * range (a full turn for a crank). Each run starts from the current pose,
 * so it follows the branch the mechanism is on.
 */
export function sweepPaths(doc: SketchDoc): Map<Id, Vec[]> {
  const out = new Map<Id, Vec[]>();
  const traces = (doc.motion.traces ?? []).filter((id) => doc.points[id]);
  if (!traces.length) return out;
  const m = new Mechanism(doc);
  const owner = ownerMap(doc);
  const where = (q: number[]) => traces.map((id) => applyPose(m.pose(q, owner.get(id) ?? ""), doc.points[id]));
  const runs: number[][][] = [];

  const drivers = Object.values(doc.motion.drivers);
  const clip = sampleClip(doc);
  if (clip) {
    runs.push(clip.qs);
  } else if (drivers.length) {
    const d = drivers[0];
    const j = m.joint(d.joint);
    if (!j) return out;
    const kind = jointKinds.get(j.kind);
    const [lo, hi] = kind.range(doc, j);
    const start = m.current();
    const v0 = m.measure(start, j.id);
    const others = drivers.slice(1).map((x) => x.joint);
    const walk = (to: number, n: number) => {
      const qs: number[][] = [start];
      let q = start;
      for (let i = 1; i <= n; i++) {
        const r = m.driveTo(j.id, v0 + ((to - v0) * i) / n, others, q);
        if (!r.reached) break;
        q = r.q;
        qs.push(q);
      }
      return qs;
    };
    if (kind.wraps?.(j)) runs.push(walk(v0 + (hi - lo), 120));
    else {
      const up = walk(hi, 60), down = walk(lo, 60);
      runs.push([...down.reverse(), ...up.slice(1)]);
    }
  }
  traces.forEach((id, i) => out.set(id, runs.flatMap((qs) => qs.map((q) => where(q)[i]))));
  return out;
}
