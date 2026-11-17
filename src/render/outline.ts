import { arcRadius, geomPoints, type Id, type SketchDoc, type Vec } from "../core/model";
import { applyPose, ownerMap, poseOf } from "../motion/bodies";

/**
 * Points that show the drawing's extent: ends of lines, points along arcs,
 * the edges of circles, and loose points. Not arc centres, which can be far
 * away for a gentle curve. In Motion mode, where the bodies are now.
 */
export function outlinePoints(doc: SketchDoc, posed: boolean): Vec[] {
  const owner = ownerMap(doc);
  const at = (id: Id, p: Vec = doc.points[id]) => (posed && owner.has(id) ? applyPose(poseOf(doc, owner.get(id)!), p) : p);
  const out: Vec[] = [];
  const used = new Set<Id>();
  for (const g of Object.values(doc.geoms)) {
    geomPoints(g).forEach((id) => used.add(id));
    if (g.kind === "line") out.push(at(g.p1), at(g.p2));
    else {
      const c = doc.points[g.c];
      const r = g.kind === "circle" ? g.r : arcRadius(doc, g);
      const a0 = g.kind === "arc" ? Math.atan2(doc.points[g.s].y - c.y, doc.points[g.s].x - c.x) : 0;
      let sweep = Math.PI * 2;
      if (g.kind === "arc") {
        sweep = Math.atan2(doc.points[g.e].y - c.y, doc.points[g.e].x - c.x) - a0;
        while (sweep <= 0) sweep += Math.PI * 2;
      }
      for (let i = 0; i <= 16; i++) {
        const a = a0 + (sweep * i) / 16;
        out.push(at(g.c, { x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r }));
      }
    }
  }
  for (const id of Object.keys(doc.points)) if (!used.has(id)) out.push(at(id));
  return out.length ? out : Object.values(doc.points);
}
