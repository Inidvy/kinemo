import { newId, type Id, type Label, type SketchDoc, type Vec } from "./model";

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
