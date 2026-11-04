import { describe, it, expect } from "vitest";
import { addGeom, addPoint, deleteItems, emptyDoc, pruneBodies, type Line } from "../src/core/model";
import { addLabel, labelAt, labelMotionAt } from "../src/core/labels";
import { ownerMap } from "../src/motion/bodies";
import { copyItems, pasteClip } from "../src/core/clipboard";
import { parseDoc, serialiseDoc } from "../src/io/file";

function bar() {
  const doc = emptyDoc();
  const a = addPoint(doc, 0, 0), b = addPoint(doc, 10, 0);
  const l = addGeom<Line>(doc, { kind: "line", p1: a, p2: b });
  doc.bodies.b1 = { id: "b1", name: "Body 1", members: [l] };
  return { doc, a, b, l };
}

describe("text labels", () => {
  it("a point's name follows the point and its body", () => {
    const { doc, b } = bar();
    const id = addLabel(doc, "B", { x: 1, y: 1 }, b);
    expect(labelAt(doc, doc.labels[id])).toEqual({ x: 11, y: 1 });
    // Turn the body a quarter turn about the origin: the point goes to (0, 10), the name keeps its offset.
    doc.motion.poses.b1 = { x: 0, y: 0, a: Math.PI / 2 };
    const at = labelMotionAt(doc, ownerMap(doc), doc.labels[id]);
    expect(at.x).toBeCloseTo(1);
    expect(at.y).toBeCloseTo(11);
  });

  it("a free label moves with the body it is grouped into, and stays put otherwise", () => {
    const { doc } = bar();
    const inBody = addLabel(doc, "crank", { x: 5, y: 0 });
    const loose = addLabel(doc, "note", { x: 50, y: 50 });
    doc.bodies.b1.members.push(inBody);
    pruneBodies(doc);
    expect(doc.bodies.b1.members).toContain(inBody);
    doc.motion.poses.b1 = { x: 0, y: 0, a: Math.PI / 2 };
    const owner = ownerMap(doc);
    const a = labelMotionAt(doc, owner, doc.labels[inBody]);
    expect(a.x).toBeCloseTo(0);
    expect(a.y).toBeCloseTo(5);
    expect(labelMotionAt(doc, owner, doc.labels[loose])).toEqual({ x: 50, y: 50 });
  });

  it("deleting a named point leaves its name as a free label where it was", () => {
    const { doc, b, l } = bar();
    const id = addLabel(doc, "B", { x: 1, y: 1 }, b);
    deleteItems(doc, [l]);
    expect(doc.labels[id].point).toBeUndefined();
    expect(labelAt(doc, doc.labels[id])).toEqual({ x: 11, y: 1 });
    deleteItems(doc, [id]);
    expect(doc.labels[id]).toBeUndefined();
  });

  it("copies names with their points, and loads older files without labels", () => {
    const { doc, b, l } = bar();
    addLabel(doc, "B", { x: 1, y: 1 }, b);
    const clip = copyItems(doc, [l])!;
    expect(clip.labels).toHaveLength(1);
    const pasted = pasteClip(doc, clip, { x: 100, y: 0 }, (_d, n) => `${n} copy`);
    const copy = Object.values(doc.labels).find((x) => pasted.includes(x.id))!;
    expect(labelAt(doc, copy)).toEqual({ x: 111, y: 1 });

    const old = JSON.parse(serialiseDoc(doc));
    delete old.doc.labels;
    expect(parseDoc(JSON.stringify(old)).labels).toEqual({});
  });
});
