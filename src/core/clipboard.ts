import { geomPoints, newId, type Body, type Constraint, type Geometry, type Id, type Label, type Point, type SketchDoc, type Vec } from "./model";
import { labelAt } from "./labels";

/** Copied sketch items, with their own ids, ready to paste into any document. */
export interface Clip {
  points: Point[];
  geoms: Geometry[];
  constraints: Constraint[];
  bodies: Body[];
  /** Text labels (older clips have none). */
  labels?: Label[];
}

/**
 * Copy the selection: geometry with its points, loose points, the members of
 * selected bodies, every constraint that only ties copied items together, and
 * bodies whose members are all copied.
 */
export function copyItems(doc: SketchDoc, ids: Id[]): Clip | null {
  const geoms = new Set<Id>();
  const points = new Set<Id>();
  const labels = new Set<Id>();
  const take = (id: Id) => {
    const g = doc.geoms[id];
    if (g) {
      geoms.add(id);
      geomPoints(g).forEach((p) => points.add(p));
    } else if (doc.points[id]) points.add(id);
    else if (doc.labels?.[id]) labels.add(id);
  };
  for (const id of ids) {
    take(id);
    doc.bodies[id]?.members.forEach(take);
    // A selected constraint brings what it ties together.
    doc.constraints[id]?.refs.forEach(take);
  }
  // Names of copied points come along too.
  for (const l of Object.values(doc.labels ?? {})) if (l.point && points.has(l.point)) labels.add(l.id);
  if (!geoms.size && !points.size && !labels.size) return null;
  const inside = (r: Id) => geoms.has(r) || points.has(r) || labels.has(r);
  // A copied name whose point isn't copied becomes a free label where it is.
  const copiedLabels = [...labels].map((id) => {
    const l = doc.labels[id];
    if (!l.point || points.has(l.point)) return l;
    const { point: _p, ...rest } = l;
    return { ...rest, ...labelAt(doc, l) };
  });
  return structuredClone({
    labels: copiedLabels,
    points: [...points].map((id) => doc.points[id]),
    geoms: [...geoms].map((id) => doc.geoms[id]),
    constraints: Object.values(doc.constraints).filter((c) => c.refs.every(inside)),
    bodies: Object.values(doc.bodies).filter((b) => b.members.length && b.members.every(inside)),
  });
}

/** The middle of the copied points. */
export function clipCenter(clip: Clip): Vec {
  const at = [...clip.points, ...(clip.labels ?? []).filter((l) => !l.point)];
  const xs = at.map((p) => p.x), ys = at.map((p) => p.y);
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
    if ((c.type === "fix" || c.type === "groundPoint") && copy.data) copy.data = { ...copy.data, x: copy.data.x + offset.x, y: copy.data.y + offset.y };
    doc.constraints[n] = copy;
  }
  const newLabels: Id[] = [];
  doc.labels ??= {};
  for (const l of clip.labels ?? []) {
    const n = id(l.id, "t");
    const copy: Label = { ...structuredClone(l), id: n };
    if (copy.point) copy.point = ref(copy.point);
    else Object.assign(copy, { x: l.x + offset.x, y: l.y + offset.y });
    doc.labels[n] = copy;
    newLabels.push(n);
  }
  for (const b of clip.bodies) {
    const n = id(b.id, "b");
    doc.bodies[n] = { ...structuredClone(b), id: n, name: bodyName(doc, b.name), members: b.members.map(ref) };
  }
  const usedPoints = new Set(clip.geoms.flatMap((g) => geomPoints(g)));
  return [...clip.geoms.map((g) => map.get(g.id)!), ...clip.points.filter((p) => !usedPoints.has(p.id)).map((p) => map.get(p.id)!), ...newLabels];
}
