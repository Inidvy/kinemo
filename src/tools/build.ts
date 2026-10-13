import { addConstraint, addPoint, type Id, type SketchDoc, type Vec } from "../core/model";
import type { Snap } from "./types";

/**
 * Create a point where the user clicked and tie it to whatever it snapped
 * to: coincident with an existing point, or on a curve.
 */
export function placePoint(doc: SketchDoc, snap: Snap): Id {
  const p = addPoint(doc, snap.at.x, snap.at.y);
  if (snap.kind === "point") addConstraint(doc, { type: "coincident", refs: [snap.id, p] });
  else if (snap.kind === "curve") addConstraint(doc, { type: "onCurve", refs: [p, snap.id] });
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
