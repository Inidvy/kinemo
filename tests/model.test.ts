import { describe, it, expect } from "vitest";
import { History } from "../src/core/history";
import { addConstraint, addGeom, addPoint, deleteItems, emptyDoc, type Line } from "../src/core/model";
import { parseDoc, serialiseDoc } from "../src/io/file";

describe("model", () => {
  it("deleting a point removes its line and the constraints on them", () => {
    const doc = emptyDoc();
    const a = addPoint(doc, 0, 0), b = addPoint(doc, 10, 0);
    const l = addGeom<Line>(doc, { kind: "line", p1: a, p2: b });
    addConstraint(doc, { type: "horizontal", refs: [l] });
    deleteItems(doc, [a]);
    expect(Object.keys(doc.geoms)).toEqual([]);
    expect(Object.keys(doc.points)).toEqual([]);
    expect(Object.keys(doc.constraints)).toEqual([]);
  });

  it("undo and redo restore earlier documents", () => {
    const h = new History(emptyDoc());
    h.commit((d) => void addPoint(d, 1, 2));
    h.commit((d) => void addPoint(d, 3, 4));
    expect(Object.keys(h.current.points).length).toBe(2);
    h.undo();
    expect(Object.keys(h.current.points).length).toBe(1);
    h.redo();
    expect(Object.keys(h.current.points).length).toBe(2);
  });

  it("round-trips through the file format", () => {
    const doc = emptyDoc();
    addPoint(doc, 5, 6);
    expect(parseDoc(serialiseDoc(doc))).toEqual(doc);
    expect(() => parseDoc("{}")).toThrow();
  });
});

describe("clipboard", () => {
  it("copies geometry with the constraints between it and pastes it with new ids", async () => {
    const { copyItems, pasteClip } = await import("../src/core/clipboard");
    const { addConstraint, addGeom, addPoint, emptyDoc } = await import("../src/core/model");
    const doc = emptyDoc();
    const a = addPoint(doc, 0, 0), b = addPoint(doc, 10, 0), c = addPoint(doc, 50, 0);
    const l = addGeom<Line>(doc, { kind: "line", p1: a, p2: b });
    const m = addGeom<Line>(doc, { kind: "line", p1: b, p2: c });
    addConstraint(doc, { type: "horizontal", refs: [l] });
    addConstraint(doc, { type: "fix", refs: [a], data: { x: 0, y: 0 } });
    addConstraint(doc, { type: "parallel", refs: [l, m] });
    doc.bodies.b1 = { id: "b1", name: "Body 1", members: [l] };
    const clip = copyItems(doc, [l])!;
    expect(clip.constraints.map((x) => x.type).sort()).toEqual(["fix", "horizontal"]);
    const ids = pasteClip(doc, clip, { x: 5, y: 5 }, (_d, name) => `${name} copy`);
    expect(ids).toHaveLength(1);
    const g = doc.geoms[ids[0]];
    expect(g.kind === "line" && doc.points[g.p1]).toMatchObject({ x: 5, y: 5 });
    expect(Object.values(doc.constraints).find((x) => x.type === "fix" && x.refs[0] !== a)!.data).toEqual({ x: 5, y: 5 });
    expect(Object.values(doc.bodies).map((x) => x.name)).toEqual(["Body 1", "Body 1 copy"]);
    expect(Object.keys(doc.geoms)).toHaveLength(3);
  });
});
