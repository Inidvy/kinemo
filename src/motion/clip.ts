import type { SketchDoc } from "../core/model";
import { jointKinds } from "./joints";
import { Mechanism } from "./kinematics";
import { timelineOf, valuesAt } from "./timeline";

/** What each keyed slider's joint should be at a time in the clip. */
export function clipTargets(doc: SketchDoc, mech: Mechanism, time: number): { joint: string; value: number }[] {
  const per = (driver: string) => {
    const j = mech.joint(doc.motion.drivers[driver]?.joint);
    if (!j) return undefined;
    const kind = jointKinds.get(j.kind);
    if (!kind.wraps?.(j)) return undefined;
    const [lo, hi] = kind.range(doc, j);
    return hi - lo;
  };
  return valuesAt(timelineOf(doc), time, per).flatMap(({ driver, value }) => (doc.motion.drivers[driver] ? [{ joint: doc.motion.drivers[driver].joint, value }] : []));
}

/** The mechanism's pose at evenly spaced times through the timeline clip. */
export interface ClipSamples {
  times: number[];
  qs: number[][];
  mech: Mechanism;
}

/** Whether the timeline has any keys to play. */
export function hasKeys(doc: SketchDoc): boolean {
  return Object.entries(timelineOf(doc).keys).some(([d, k]) => k.length && doc.motion.drivers[d]);
}

/**
 * Run the clip from its start, beginning at the current pose so it follows
 * the branch the mechanism is on. Stops early where the mechanism can't follow.
 */
export function sampleClip(doc: SketchDoc, n = 120): ClipSamples | null {
  if (!hasKeys(doc)) return null;
  const tl = timelineOf(doc);
  const mech = new Mechanism(doc);
  const times: number[] = [];
  const qs: number[][] = [];
  let q = mech.current();
  for (let i = 0; i <= n; i++) {
    const time = (tl.length * i) / n;
    const targets = clipTargets(doc, mech, time);
    const r = mech.driveAll(targets, q);
    if (!r.reached && i > 0) break;
    q = r.q;
    times.push(time);
    qs.push(q);
  }
  return { times, qs, mech };
}
