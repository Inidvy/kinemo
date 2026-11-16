import { describe, it, expect, beforeAll } from "vitest";
import { addGeom, addPoint, emptyDoc, type Circle } from "../src/core/model";
import { addLabel } from "../src/core/labels";
import { clipCenter, copyItems, pasteClip } from "../src/core/clipboard";
import { constraintTypes } from "../src/constraints";
import { hasUnsavedWork, markSaved } from "../src/io/file";
import { Solver } from "../src/solver/solver";

// The editor only needs timers from the page.
(globalThis as { window?: unknown }).window ??= globalThis;

let solver: Solver;
beforeAll(async () => {
  solver = await Solver.create();
});

describe("editor selection", () => {
  it("keeps a selected label selected through an edit", async () => {
    const { Editor } = await import("../src/app/editor");
    const ed = new Editor(solver);
    let label = "";
    ed.change((doc) => {
      addPoint(doc, 0, 0);
      label = addLabel(doc, "note", { x: 5, y: 5 });
    });
    ed.select([label]);
    ed.change((doc) => (doc.labels[label].text = "changed"));
    expect([...ed.selection]).toEqual([label]);
    ed.change((doc) => void delete doc.labels[label]);
    expect(ed.selection.size).toBe(0);
  });
});

describe("copying a label on its own", () => {
  it("copies and pastes with nothing else selected", () => {
    const doc = emptyDoc();
    const id = addLabel(doc, "note", { x: 5, y: 5 });
    const clip = copyItems(doc, [id])!;
    expect(clip.points).toHaveLength(0);
    expect(clip.labels).toHaveLength(1);
    expect(clipCenter(clip)).toEqual({ x: 5, y: 5 });
    const [pasted] = pasteClip(doc, clip, { x: 10, y: 0 }, (_d, n) => n);
    expect(doc.labels[pasted]).toMatchObject({ text: "note", x: 15, y: 5 });
  });
});

describe("concentric", () => {
  it("does not tie circles together twice", () => {
    const doc = emptyDoc();
    const circle = () => addGeom<Circle>(doc, { kind: "circle", c: addPoint(doc, 0, 0), r: 5 });
    const [a, b, c] = [circle(), circle(), circle()];
    const type = constraintTypes.get("concentric");
    const first = type.fromSelection(doc, [a, b, c]) as { type: string; refs: string[] }[];
    expect(first).toHaveLength(2);
    first.forEach((k, i) => (doc.constraints[`c${i}`] = { id: `c${i}`, ...k }));
    expect(type.fromSelection(doc, [c, a])).toBe("hint.alreadyConcentric");
  });
});

describe("unsaved work", () => {
  it("asks for a sketch that holds only labels", () => {
    const doc = emptyDoc();
    markSaved(doc);
    addLabel(doc, "note", { x: 0, y: 0 });
    expect(hasUnsavedWork(doc)).toBe(true);
  });

  it("does not ask because the mechanism moved", () => {
    const doc = emptyDoc();
    addPoint(doc, 0, 0);
    markSaved(doc);
    doc.motion.poses.b1 = { x: 1, y: 2, a: 0.3 };
    expect(hasUnsavedWork(doc)).toBe(false);
  });
});

describe("document name", () => {
  it("names saved files after the document, and a document after its file", async () => {
    const { fileStem, nameFromFile, parseDoc, serialiseDoc } = await import("../src/io/file");
    const doc = emptyDoc();
    expect(fileStem(doc)).toBe("mechanism");
    doc.name = "Four-bar: v2 / test";
    expect(fileStem(doc)).toBe("Four-bar v2 test");
    expect(parseDoc(serialiseDoc(doc)).name).toBe("Four-bar: v2 / test");
    expect(nameFromFile("Walker (2).kinemo.json")).toBe("Walker");
  });
});

describe("groups", () => {
  it("joins ids through others and keeps lone ids apart", async () => {
    const { Groups } = await import("../src/core/groups");
    const g = new Groups();
    g.join("a", "b");
    g.join("c", "b");
    g.join("x", "y");
    expect(g.find("a")).toBe(g.find("c"));
    expect(g.find("a")).not.toBe(g.find("x"));
    expect(g.all(["z"]).map((m) => m.sort().join("")).sort()).toEqual(["abc", "xy", "z"]);
  });
});
