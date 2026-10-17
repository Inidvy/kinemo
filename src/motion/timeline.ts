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
    if (a.smooth) {
      // A curve through the neighbouring keys too, so recorded motion flows through each key without stopping.
      const prev = keys[i - 1] ?? a, next = keys[i + 2] ?? b;
      const h = b.t - a.t;
      const slope = (p: Keyframe, q: Keyframe) => (q.t > p.t ? (q.v - p.v) / (q.t - p.t) : 0);
      const ma = slope(prev, b) * h, mb = slope(a, next) * h;
      const u2 = u * u, u3 = u2 * u;
      return (2 * u3 - 3 * u2 + 1) * a.v + (u3 - 2 * u2 + u) * ma + (-2 * u3 + 3 * u2) * b.v + (u3 - u2) * mb;
    }
    return a.v + (b.v - a.v) * (a.linear ? u : ease(u));
  }
  return last.v;
}

/**
 * A looping clip's keys with the loop closed: after the last key the slider
 * goes back to where the first key has it, arriving as the clip starts over
 * (and before the first key it comes from the last). A slider that goes
 * round (`per`, a full turn) comes back to the nearest reading of the first
 * key, so a whole turn keeps turning. A key at the very end is left alone.
 */
export function loopedKeys(keys: Keyframe[], length: number, per?: number): Keyframe[] {
  if (!keys.length) return keys;
  const first = keys[0], last = keys[keys.length - 1];
  if (last.t >= length - 1e-6) return keys;
  const shift = per ? Math.round((last.v - first.v) / per) * per : 0;
  return [{ ...last, t: last.t - length, v: last.v - shift }, ...keys, { ...first, t: first.t + length, v: first.v + shift }];
}

/** Every keyed slider's value at time t. `per` gives a full turn for sliders that go round. */
export function valuesAt(tl: Timeline, t: number, per?: (driver: Id) => number | undefined): { driver: Id; value: number }[] {
  const out: { driver: Id; value: number }[] = [];
  for (const [driver, keys] of Object.entries(tl.keys)) {
    const v = valueAt(tl.mode === "loop" ? loopedKeys(keys, tl.length, per?.(driver)) : keys, t);
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

/** Average over a window of samples either side, to take the shake out of a hand-made movement. */
function smoothSamples(ts: number[], vs: number[], window: number): number[] {
  const end = ts[ts.length - 1];
  return vs.map((_, i) => {
    // The same width either side, so the start and end don't get pulled inwards.
    const w = Math.min(window, ts[i] - ts[0], end - ts[i]);
    let sum = 0, n = 0;
    for (let j = i; j >= 0 && ts[i] - ts[j] <= w; j--) (sum += vs[j]), n++;
    for (let j = i + 1; j < vs.length && ts[j] - ts[i] <= w; j++) (sum += vs[j]), n++;
    return sum / n;
  });
}

/** The fewest samples that keep the curve within `tol` of every sample (Ramer–Douglas–Peucker). */
function simplify(ts: number[], vs: number[], tol: number): number[] {
  const keep = new Set([0, ts.length - 1]);
  const walk = (a: number, b: number) => {
    let worst = -1, far = tol;
    for (let i = a + 1; i < b; i++) {
      const u = (ts[i] - ts[a]) / (ts[b] - ts[a] || 1);
      const d = Math.abs(vs[i] - (vs[a] + (vs[b] - vs[a]) * u));
      if (d > far) [worst, far] = [i, d];
    }
    if (worst < 0) return;
    keep.add(worst);
    walk(a, worst);
    walk(worst, b);
  };
  if (ts.length > 2) walk(0, ts.length - 1);
  return [...keep].sort((x, y) => x - y);
}

/**
 * Keys from a recorded movement: smoothed, then cut down to the keys a
 * smooth curve needs to follow it closely. Times start at 0.
 */
export function keysFromRecording(ts: number[], vs: number[]): Keyframe[] {
  if (!ts.length) return [];
  const t0 = ts[0];
  const times = ts.map((t) => t - t0);
  const smooth = smoothSamples(times, vs, 0.08);
  const span = Math.max(...smooth) - Math.min(...smooth);
  const idx = simplify(times, smooth, Math.max(span * 0.01, 1e-6));
  return idx.map((i) => ({ t: Math.round(times[i] * 1000) / 1000, v: smooth[i], smooth: true }));
}

/** A key on the timeline: its slider and its index in that slider's keys. */
export type KeyRef = { driver: Id; i: number };

/** Remove keys, and drop any slider left without keys. */
export function deleteKeys(tl: Timeline, refs: KeyRef[]): void {
  for (const driver of new Set(refs.map((r) => r.driver))) {
    const keys = tl.keys[driver];
    if (!keys) continue;
    const gone = new Set(refs.filter((r) => r.driver === driver).map((r) => r.i));
    tl.keys[driver] = keys.filter((_, i) => !gone.has(i));
    if (!tl.keys[driver].length) delete tl.keys[driver];
  }
}

/**
 * Move keys together by dt seconds, kept within the clip. A key left at the
 * same time as a moved one gives way to it. Returns where the moved keys are now.
 */
export function shiftKeys(tl: Timeline, refs: KeyRef[], dt: number): KeyRef[] {
  const moved = refs.flatMap((r) => (tl.keys[r.driver]?.[r.i] ? [{ driver: r.driver, k: tl.keys[r.driver][r.i] }] : []));
  if (!moved.length) return [];
  const lo = Math.min(...moved.map((m) => m.k.t)), hi = Math.max(...moved.map((m) => m.k.t));
  const d = Math.min(Math.max(dt, -lo), Math.max(0, tl.length - hi));
  for (const m of moved) m.k.t = Math.round((m.k.t + d) * 1000) / 1000;
  const mine = new Set(moved.map((m) => m.k));
  for (const driver of new Set(moved.map((m) => m.driver))) {
    const keys = tl.keys[driver];
    const at = keys.filter((k) => mine.has(k)).map((k) => k.t);
    tl.keys[driver] = keys.filter((k) => mine.has(k) || !at.some((t) => Math.abs(t - k.t) < 1e-6)).sort((a, b) => a.t - b.t);
  }
  return moved.map((m) => ({ driver: m.driver, i: tl.keys[m.driver].indexOf(m.k) }));
}

/**
 * Keys for one whole turn over the clip: from `from` at the start to a full
 * turn (`per`) further at the end, at a steady speed, so a looping clip turns
 * round and round without a hitch. Replaces the slider's keys.
 */
export function setFullTurn(tl: Timeline, driver: Id, from: number, per: number, reverse = false): void {
  tl.keys[driver] = [
    { t: 0, v: from, linear: true },
    { t: Math.round(tl.length * 1000) / 1000, v: from + (reverse ? -per : per) },
  ];
}
