import { geomPoints, newId, type Body, type Constraint, type Geometry, type Id, type Point, type SketchDoc, type Vec } from "./model";

/** Copied sketch items, with their own ids, ready to paste into any document. */
export interface Clip {
  points: Point[];
  geoms: Geometry[];
  constraints: Constraint[];
  bodies: Body[];
}

/**
 * Copy the selection: geometry with its points, loose points, the members of
 * selected bodies, every constraint that only ties copied items together, and
 * bodies whose members are all copied.
 */
export function copyItems(doc: SketchDoc, ids: Id[]): Clip | null {
  const geoms = new Set<Id>();
  const points = new Set<Id>();
  const take = (id: Id) => {
    const g = doc.geoms[id];
    if (g) {
      geoms.add(id);
      geomPoints(g).forEach((p) => points.add(p));
    } else if (doc.points[id]) points.add(id);
  };
  for (const id of ids) {
    take(id);
    doc.bodies[id]?.members.forEach(take);
    // A selected constraint brings what it ties together.
    doc.constraints[id]?.refs.forEach(take);
  }
  if (!geoms.size && !points.size) return null;
  const inside = (r: Id) => geoms.has(r) || points.has(r);
  return structuredClone({
    points: [...points].map((id) => doc.points[id]),
    geoms: [...geoms].map((id) => doc.geoms[id]),
    constraints: Object.values(doc.constraints).filter((c) => c.refs.every(inside)),
    bodies: Object.values(doc.bodies).filter((b) => b.members.length && b.members.every(inside)),
  });
}

/** The middle of the copied points. */
export function clipCenter(clip: Clip): Vec {
  const xs = clip.points.map((p) => p.x), ys = clip.points.map((p) => p.y);
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
}

/** Paste a clip shifted by `offset`, with fresh ids. Returns the new geometry and loose point ids. */
export function pasteClip(doc: SketchDoc, clip: Clip, offset: Vec, bodyName: (doc: SketchDoc, copyOf: string) => string): Id[] {
  const map = new Map<Id, Id>();
  const id = (old: Id, prefix: string) => {
    if (!map.has(old)) map.set(old, newId(doc, prefix));
    return map.get(old)!;
  };
  for (const p of clip.points) {
    const n = id(p.id, "p");
    doc.points[n] = { id: n, x: p.x + offset.x, y: p.y + offset.y };
  }
  const ref = (r: Id) => map.get(r) ?? r;
  for (const g of clip.geoms) {
    const n = id(g.id, "g");
    const copy = { ...structuredClone(g), id: n } as Geometry;
    if (copy.kind === "line") [copy.p1, copy.p2] = [ref(copy.p1), ref(copy.p2)];
    else if (copy.kind === "circle") copy.c = ref(copy.c);
    else [copy.c, copy.s, copy.e] = [ref(copy.c), ref(copy.s), ref(copy.e)];
    doc.geoms[n] = copy;
  }
  for (const c of clip.constraints) {
    const n = id(c.id, "c");
    const copy: Constraint = { ...structuredClone(c), id: n, refs: c.refs.map(ref) };
    // A fixed point stays fixed where it was pasted.
    if (c.type === "fix" && copy.data) copy.data = { ...copy.data, x: copy.data.x + offset.x, y: copy.data.y + offset.y };
    doc.constraints[n] = copy;
  }
  for (const b of clip.bodies) {
    const n = id(b.id, "b");
    doc.bodies[n] = { ...structuredClone(b), id: n, name: bodyName(doc, b.name), members: b.members.map(ref) };
  }
  const usedPoints = new Set(clip.geoms.flatMap((g) => geomPoints(g)));
  return [...clip.geoms.map((g) => map.get(g.id)!), ...clip.points.filter((p) => !usedPoints.has(p.id)).map((p) => map.get(p.id)!)];
}
