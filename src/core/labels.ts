import { newId, type Id, type Label, type SketchDoc, type Vec } from "./model";
import { applyPose, poseOf } from "../motion/bodies";

export const LABEL_SIZE = 13;

export function labelsOf(doc: SketchDoc): Label[] {
  return Object.values(doc.labels ?? {});
}

/** Add a label at sketch position `at`, or naming `point` (then `at` is the offset from it). */
export function addLabel(doc: SketchDoc, text: string, at: Vec, point?: Id): Id {
  const id = newId(doc, "t");
  doc.labels ??= {};
  doc.labels[id] = { id, text, x: at.x, y: at.y, ...(point ? { point } : {}) };
  return id;
}

/** Where a label sits in the sketch. */
export function labelAt(doc: SketchDoc, l: Label): Vec {
  const p = l.point ? doc.points[l.point] : undefined;
  return p ? { x: p.x + l.x, y: p.y + l.y } : { x: l.x, y: l.y };
}

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
