import type { Id, Keyframe, SketchDoc, Timeline } from "../core/model";

export const DEFAULT_TIMELINE: Timeline = { length: 4, mode: "loop", keys: {} };

export function timelineOf(doc: SketchDoc): Timeline {
  return doc.motion.timeline ?? DEFAULT_TIMELINE;
}

/** Ease in and out: slow at each key, fastest in between. */
const ease = (u: number) => u * u * (3 - 2 * u);

/** A slider's value at time t from its keyframes (null without any). */
export function valueAt(keys: Keyframe[] | undefined, t: number): number | null {
  if (!keys?.length) return null;
  if (t <= keys[0].t) return keys[0].v;
  const last = keys[keys.length - 1];
  if (t >= last.t) return last.v;
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i], b = keys[i + 1];
    if (t > b.t) continue;
    const u = b.t > a.t ? (t - a.t) / (b.t - a.t) : 1;
    return a.v + (b.v - a.v) * (a.linear ? u : ease(u));
  }
  return last.v;
}

/** Every keyed slider's value at time t. */
export function valuesAt(tl: Timeline, t: number): { driver: Id; value: number }[] {
  const out: { driver: Id; value: number }[] = [];
  for (const [driver, keys] of Object.entries(tl.keys)) {
    const v = valueAt(keys, t);
    if (v !== null) out.push({ driver, value: v });
  }
  return out;
}

/**
 * Where playback is after running for `elapsed` seconds: once stops at the
 * end, loop starts over, ping-pong runs back and forth.
 */
export function clipTime(elapsed: number, tl: Timeline): { t: number; done: boolean } {
  const L = Math.max(0.01, tl.length);
  if (tl.mode === "once") return { t: Math.min(L, Math.max(0, elapsed)), done: elapsed >= L };
  if (tl.mode === "loop") return { t: ((elapsed % L) + L) % L, done: false };
  const p = ((elapsed % (2 * L)) + 2 * L) % (2 * L);
  return { t: p <= L ? p : 2 * L - p, done: false };
}

/** Put a keyframe for a slider at time t, replacing one already there. */
export function setKey(tl: Timeline, driver: Id, t: number, v: number): void {
  const keys = (tl.keys[driver] ??= []);
  const near = keys.find((k) => Math.abs(k.t - t) < 1e-3);
  if (near) near.v = v;
  else keys.push({ t, v });
  keys.sort((a, b) => a.t - b.t);
}
