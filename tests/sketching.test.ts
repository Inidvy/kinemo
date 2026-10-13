import { describe, it, expect, beforeAll } from "vitest";
import { Solver, degenerate } from "../src/solver/solver";
import { addConstraint, addGeom, addPoint, emptyDoc, type Line, type Arc, type SketchDoc } from "../src/core/model";
import { constraintTypes } from "../src/constraints";
import { makeTangent } from "../src/constraints/defs/relations";

let solver: Solver;
beforeAll(async () => { solver = await Solver.create(); });

function rect(doc: SketchDoc, x: number, y: number, w: number, h: number) {
  const cs = [{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}];
  const ids: string[] = [], lines: string[] = [];
  for (let i=0;i<4;i++){ const a=cs[i],b=cs[(i+1)%4]; const p1=addPoint(doc,a.x,a.y),p2=addPoint(doc,b.x,b.y); ids.push(p1,p2); lines.push(addGeom<Line>(doc,{kind:"line",p1,p2})); }
  for (let i=0;i<4;i++) addConstraint(doc,{type:"coincident",refs:[ids[i*2+1],ids[((i+1)%4)*2]]});
  addConstraint(doc,{type:"horizontal",refs:[lines[0]]});addConstraint(doc,{type:"vertical",refs:[lines[1]]});
  addConstraint(doc,{type:"horizontal",refs:[lines[2]]});addConstraint(doc,{type:"vertical",refs:[lines[3]]});
  return lines;
}
function apply(doc: SketchDoc, type: string, sel: string[]) {
  const out = constraintTypes.get(type).fromSelection(doc, sel);
  if (typeof out === "string") throw new Error(out);
  out.forEach((c) => addConstraint(doc, c));
}
let seed = 1; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

function sketches(): [string, SketchDoc][] {
  const out: [string, SketchDoc][] = [];
  { const d = emptyDoc(); rect(d,0,0,60,40); out.push(["rect", d]); }
  { const d = emptyDoc(); const ls = rect(d,0,0,60,40); apply(d,"distance",[ls[0]]); out.push(["rect+dim", d]); }
  { const d = emptyDoc(); const ls = rect(d,0,0,60,40); apply(d,"distance",[ls[0]]); apply(d,"distance",[ls[1]]); out.push(["rect+2dim", d]); }
  { // line + tangent arc + tangent line
    const d = emptyDoc();
    const a=addPoint(d,0,0), b=addPoint(d,40,0); const l1=addGeom<Line>(d,{kind:"line",p1:a,p2:b});
    const b2=addPoint(d,40,0), c=addPoint(d,40,20), e=addPoint(d,60,20); const arc=addGeom<Arc>(d,{kind:"arc",c,s:b2,e});
    addConstraint(d,{type:"coincident",refs:[b,b2]}); addConstraint(d, makeTangent(d,d.geoms[l1],d.geoms[arc]));
    const e2=addPoint(d,60,20), f=addPoint(d,60,60); const l2=addGeom<Line>(d,{kind:"line",p1:e2,p2:f});
    addConstraint(d,{type:"coincident",refs:[e,e2]}); addConstraint(d, makeTangent(d,d.geoms[arc],d.geoms[l2]));
    out.push(["poly", d]);
  }
  { // triangle with angle
    const d = emptyDoc();
    const P=[{x:0,y:0},{x:50,y:0},{x:20,y:30}]; const ids:string[]=[], ls:string[]=[];
    for(let i=0;i<3;i++){const p1=addPoint(d,P[i].x,P[i].y),p2=addPoint(d,P[(i+1)%3].x,P[(i+1)%3].y);ids.push(p1,p2);ls.push(addGeom<Line>(d,{kind:"line",p1,p2}));}
    for(let i=0;i<3;i++) addConstraint(d,{type:"coincident",refs:[ids[i*2+1],ids[((i+1)%3)*2]]});
    apply(d,"horizontal",[ls[0]]); apply(d,"angle",[ls[0],ls[2]]); apply(d,"distance",[ls[0]]);
    out.push(["tri", d]);
  }
  return out;
}

describe("dragging", () => {
  it("never leaves a sketch over-constrained", () => {
    for (const [name, d0] of sketches()) {
      let bad = 0;
      for (let trial = 0; trial < 10; trial++) {
        let doc = d0;
        for (let k = 0; k < 4; k++) {
          const pts = Object.values(doc.points);
          const p = pts[Math.floor(rnd() * pts.length)];
          const tx = p.x + (rnd() - 0.5) * 120, ty = p.y + (rnd() - 0.5) * 120;
          // Same acceptance rule as Editor.drag.
          for (let s = 1; s <= 10; s++) {
            const r = solver.solve(doc, [{ point: p.id, to: { x: p.x + ((tx - p.x) * s) / 10, y: p.y + ((ty - p.y) * s) / 10 } }]);
            if (r.ok && !degenerate(doc, r.doc) && Solver.clean(solver.solve(r.doc))) doc = r.doc;
          }
          if (!Solver.clean(solver.solve(doc))) bad++;
        }
      }
      expect(bad, name).toBe(0);
    }
  });
});

describe("over-constraint", () => {
  it("lists every constraint whose removal fixes a redundancy", () => {
    const d = emptyDoc();
    const ls = rect(d, 0, 0, 60, 40);
    apply(d, "parallel", [ls[0], ls[2]]);
    const par = Object.values(d.constraints).find((c) => c.type === "parallel")!.id;
    expect(Solver.clean(solver.solve(d))).toBe(false);
    const fixes = new Set(solver.fixes(d));
    const h = Object.values(d.constraints).filter((c) => c.type === "horizontal").map((c) => c.id);
    expect(fixes).toEqual(new Set([par, ...h]));
  });

  it("solves the rest of the sketch without the culprit", () => {
    const d = emptyDoc();
    const ls = rect(d, 0, 0, 60, 40);
    apply(d, "distance", [ls[0]]);
    apply(d, "distance", [ls[2]]);
    const dims = Object.values(d.constraints).filter((c) => c.type === "distance");
    dims[0].value = 80;
    dims[1].value = 50;
    expect(Solver.clean(solver.solve(d))).toBe(false);
    const r = solver.solveWithout(d, [dims[1].id]);
    expect(Solver.clean(r)).toBe(true);
    const top = d.geoms[ls[0]] as Line;
    expect(Math.hypot(r.doc.points[top.p1].x - r.doc.points[top.p2].x, r.doc.points[top.p1].y - r.doc.points[top.p2].y)).toBeCloseTo(80, 4);
    expect(r.doc.constraints[dims[1].id]).toBeDefined();
  });
});
