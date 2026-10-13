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
