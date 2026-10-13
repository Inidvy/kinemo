import type { Vec } from "./model";

export const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
export const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
export const scale = (a: Vec, k: number): Vec => ({ x: a.x * k, y: a.y * k });
export const len = (a: Vec): number => Math.hypot(a.x, a.y);
export const dist = (a: Vec, b: Vec): number => Math.hypot(a.x - b.x, a.y - b.y);
export const mid = (a: Vec, b: Vec): Vec => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
export const dot = (a: Vec, b: Vec): number => a.x * b.x + a.y * b.y;
export const cross = (a: Vec, b: Vec): number => a.x * b.y - a.y * b.x;

export function norm(a: Vec): Vec {
  const l = len(a) || 1;
  return { x: a.x / l, y: a.y / l };
}

/** Left-hand perpendicular. */
export const perp = (a: Vec): Vec => ({ x: -a.y, y: a.x });

export function distToSegment(p: Vec, a: Vec, b: Vec): number {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  if (l2 === 0) return dist(p, a);
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
  return dist(p, add(a, scale(ab, t)));
}

/** Closest point on the infinite line through a and b. */
export function projectOnLine(p: Vec, a: Vec, b: Vec): Vec {
  const ab = sub(b, a);
  const l2 = dot(ab, ab) || 1;
  const t = dot(sub(p, a), ab) / l2;
  return add(a, scale(ab, t));
}

export function angleOf(v: Vec): number {
  return Math.atan2(v.y, v.x);
}

/** Normalise an angle to [0, 2π). */
export function wrap2pi(a: number): number {
  const t = a % (2 * Math.PI);
  return t < 0 ? t + 2 * Math.PI : t;
}

/** Is angle `a` inside the counter-clockwise sweep from `start` to `end`? */
export function angleInSweep(a: number, start: number, end: number): boolean {
  const sweep = wrap2pi(end - start);
  return wrap2pi(a - start) <= sweep;
}
