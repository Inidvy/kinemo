import { addConstraint, addGeom, addPoint, emptyDoc, type Line, type SketchDoc } from "../src/core/model";

/**
 * A chain of four-bars: k rockers pinned to ground, tops linked by couplers.
 * Joint count = k + 2(k-1); one degree of freedom. k = 34 gives 100 joints.
 */
export function ladder(k: number): { doc: SketchDoc; crank: string } {
  const doc = emptyDoc();
  const bar = (x1: number, y1: number, x2: number, y2: number) => {
    const p1 = addPoint(doc, x1, y1), p2 = addPoint(doc, x2, y2);
    return { id: addGeom<Line>(doc, { kind: "line", p1, p2 }), p1, p2 };
  };
  const gx = (i: number) => i * 40;
  const h = (i: number) => 30 + (i % 3) * 6;
  const ground = bar(gx(0), 0, gx(k - 1), 0);
  const groundPts: string[] = [ground.p1];
  for (let i = 1; i < k - 1; i++) groundPts.push(addPoint(doc, gx(i), 0));
  groundPts.push(ground.p2);
  doc.bodies.ground = { id: "ground", name: "ground", members: [ground.id, ...groundPts.slice(1, -1)], ground: true };
  const rockers: { id: string; p1: string; p2: string }[] = [];
  let crank = "";
  for (let i = 0; i < k; i++) {
    const r = bar(gx(i), 0, gx(i) + 4, h(i));
    rockers.push(r);
    const pin = addConstraint(doc, { type: "coincident", refs: [groundPts[i], r.p1] });
    if (i === 0) crank = pin;
    doc.bodies[`r${i}`] = { id: `r${i}`, name: `r${i}`, members: [r.id] };
  }
  for (let i = 0; i < k - 1; i++) {
    const a = rockers[i], b = rockers[i + 1];
    const c = bar(gx(i) + 4, h(i), gx(i + 1) + 4, h(i + 1));
    addConstraint(doc, { type: "coincident", refs: [a.p2, c.p1] });
    addConstraint(doc, { type: "coincident", refs: [b.p2, c.p2] });
    doc.bodies[`c${i}`] = { id: `c${i}`, name: `c${i}`, members: [c.id] };
  }
  return { doc, crank };
}
