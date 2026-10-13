import type { Vec } from "../core/model";
import { add, dot, norm, perp, scale, sub } from "../core/geom";

export interface ArcThrough {
  center: Vec;
  /** Positive: turns left (counter-clockwise). Negative: turns right. */
  r: number;
  /** Direction of travel at the end point. */
  endTangent: Vec;
}

/**
 * The arc that leaves `p` in direction `t` and passes through `q`.
 * Returns null when q lies straight ahead (the arc would be a line).
 */
export function arcFromTangent(p: Vec, t: Vec, q: Vec): ArcThrough | null {
  const d = sub(q, p);
  const n = perp(norm(t));
  const h = dot(d, n);
  if (Math.abs(h) < 1e-9) return null;
  const r = dot(d, d) / (2 * h);
  const center = add(p, scale(n, r));
  const radial = sub(q, center);
  // Counter-clockwise travel follows the left-hand normal of the radius.
  const endTangent = norm(r > 0 ? perp(radial) : scale(perp(radial), -1));
  return { center, r, endTangent };
}

/**
 * The arc that leaves `p` at a right angle to direction `t`, turning toward
 * whichever side `q` is on.
 */
export function arcFromNormal(p: Vec, t: Vec, q: Vec): ArcThrough | null {
  const n = perp(norm(t));
  const side = dot(sub(q, p), n) >= 0 ? n : scale(n, -1);
  return arcFromTangent(p, side, q);
}
