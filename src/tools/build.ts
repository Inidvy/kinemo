import { addConstraintSmart } from "../constraints/select";
import { addPoint, type Id, type SketchDoc, type Vec } from "../core/model";
import { snapConstraint } from "./snap";
import type { Snap } from "./types";

/**
 * The point for where the user clicked. On an existing point that point is
 * used again, so lines that end at the same place share one point instead of
 * stacking coincident copies. Otherwise a new point is made and tied to what
 * it snapped to: the midpoint of a line, or on a curve. `share: false` always
 * makes a new point (coincident with the one it snapped to).
 */
export function placePoint(doc: SketchDoc, snap: Snap, share = true): Id {
  if (share && snap.kind === "point" && doc.points[snap.id]) return snap.id;
  const p = addPoint(doc, snap.at.x, snap.at.y);
  const c = snapConstraint(doc, p, snap);
  if (c) addConstraintSmart(doc, c);
  return p;
}

const AXIS_TOL = (3 * Math.PI) / 180;

/**
 * If the segment from a to b is within a few degrees of horizontal or
 * vertical, return that axis and the snapped end point.
 */
export function inferAxis(a: Vec, b: Vec): { axis: "horizontal" | "vertical" | null; at: Vec } {
  const dx = b.x - a.x, dy = b.y - a.y;
  if (Math.hypot(dx, dy) < 1e-6) return { axis: null, at: b };
  const ang = Math.atan2(dy, dx);
  const nearH = Math.abs(Math.sin(ang)) < Math.sin(AXIS_TOL);
  const nearV = Math.abs(Math.cos(ang)) < Math.sin(AXIS_TOL);
  if (nearH) return { axis: "horizontal", at: { x: b.x, y: a.y } };
  if (nearV) return { axis: "vertical", at: { x: a.x, y: b.y } };
  return { axis: null, at: b };
}
