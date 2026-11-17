import type { Id, Label, SketchDoc, Vec } from "../core/model";
import { applyPose, poseOf } from "./bodies";

/** The body a label moves with: its point's body, or the body it was grouped into. */
export function labelBody(owner: Map<Id, Id>, l: Label): Id | undefined {
  return l.point ? owner.get(l.point) : owner.get(l.id);
}

/**
 * Where a label sits in Motion mode. A free label turns about its body with
 * it; a point's name stays the same offset from where its point has moved.
 * Labels outside any body stay where they are in the sketch.
 */
export function labelMotionAt(doc: SketchDoc, owner: Map<Id, Id>, l: Label): Vec {
  const pose = poseOf(doc, labelBody(owner, l));
  if (l.point && doc.points[l.point]) {
    const p = applyPose(pose, doc.points[l.point]);
    return { x: p.x + l.x, y: p.y + l.y };
  }
  return applyPose(pose, { x: l.x, y: l.y });
}
