import type { Body, Geometry, Id, Pose, SketchDoc, Vec } from "../core/model";
import { geomPoints } from "../core/model";

export const IDENTITY: Pose = { x: 0, y: 0, a: 0 };

/** Which body each point and geometry belongs to. */
export function ownerMap(doc: SketchDoc): Map<Id, Id> {
  const own = new Map<Id, Id>();
  for (const b of Object.values(doc.bodies)) {
    for (const m of b.members) {
      own.set(m, b.id);
      const g = doc.geoms[m];
      if (g) geomPoints(g).forEach((p) => own.set(p, b.id));
    }
  }
  return own;
}

const groundCache = new WeakMap<SketchDoc, Set<Id>>();
const fixedCache = new WeakMap<SketchDoc, Map<Id, Id[]>>();

/**
 * For each body, its points that are fixed in the sketch: fixed directly, or
 * coincident with a fixed point that belongs to no body.
 */
export function bodyFixedPoints(doc: SketchDoc): Map<Id, Id[]> {
  let out = fixedCache.get(doc);
  if (out) return out;
  out = new Map();
  const own = ownerMap(doc);
  const fixed = new Set(Object.values(doc.constraints).filter((c) => c.type === "groundPoint").map((c) => c.refs[0]));
  const add = (p: Id) => {
    const b = own.get(p);
    if (!b) return;
    const list = out!.get(b) ?? [];
    if (!list.includes(p)) list.push(p);
    out!.set(b, list);
  };
  fixed.forEach(add);
  for (const c of Object.values(doc.constraints)) {
    if (c.type !== "coincident" || c.refs.length !== 2) continue;
    const [x, y] = c.refs;
    if (fixed.has(x) && !own.has(x)) add(y);
    if (fixed.has(y) && !own.has(y)) add(x);
  }
  fixedCache.set(doc, out);
  return out;
}

/**
 * Ground bodies never move: the ones marked as ground, and any body fixed at
 * two or more places. A body fixed at one point only turns about it instead.
 */
export function groundBodies(doc: SketchDoc): Set<Id> {
  let set = groundCache.get(doc);
  if (set) return set;
  set = new Set(Object.values(doc.bodies).filter((b) => b.ground).map((b) => b.id));
  for (const [b, pts] of bodyFixedPoints(doc)) {
    const spots = new Set(pts.map((p) => `${doc.points[p].x.toFixed(6)},${doc.points[p].y.toFixed(6)}`));
    if (spots.size >= 2) set.add(b);
  }
  groundCache.set(doc, set);
  return set;
}

export const isGround = (doc: SketchDoc, bodyId: Id | undefined): boolean => !!bodyId && groundBodies(doc).has(bodyId);

/** Ground because of a Fix constraint rather than the ground switch. */
export const fixedGround = (doc: SketchDoc, b: Body): boolean => !b.ground && isGround(doc, b.id);

export function bodyGeoms(doc: SketchDoc, b: Body): Geometry[] {
  return b.members.map((id) => doc.geoms[id]).filter(Boolean);
}

export function bodyPointIds(doc: SketchDoc, b: Body): Id[] {
  const out = new Set<Id>();
  for (const m of b.members) {
    if (doc.points[m]) out.add(m);
    const g = doc.geoms[m];
    if (g) geomPoints(g).forEach((p) => out.add(p));
  }
  return [...out];
}

export function applyPose(p: Pose, v: Vec): Vec {
  const c = Math.cos(p.a), s = Math.sin(p.a);
  return { x: c * v.x - s * v.y + p.x, y: s * v.x + c * v.y + p.y };
}

export function poseOf(doc: SketchDoc, bodyId: Id | undefined): Pose {
  return (bodyId && doc.motion.poses[bodyId]) || IDENTITY;
}

/** The document with every body's points moved to where the body is now (for measuring). */
export function posedDoc(doc: SketchDoc): SketchDoc {
  const owner = ownerMap(doc);
  const points: SketchDoc["points"] = {};
  for (const p of Object.values(doc.points)) points[p.id] = { ...p, ...applyPose(poseOf(doc, owner.get(p.id)), p) };
  return { ...doc, points };
}

/** Where a sketch point is in Motion mode. Points outside bodies stay put. */
export function motionPoint(doc: SketchDoc, owner: Map<Id, Id>, pointId: Id): Vec {
  return applyPose(poseOf(doc, owner.get(pointId)), doc.points[pointId]);
}

/** Body colours to pick from: strong, so they read through the see-through fill. */
export const PALETTE = ["#e53935", "#fb8c00", "#fdd835", "#43a047", "#00acc1", "#1e88e5", "#8e24aa", "#d81b60"];
export const GROUND_COLOR = "#78808c";

export function bodyColor(doc: SketchDoc, b: Body): string {
  if (isGround(doc, b.id)) return GROUND_COLOR;
  if (b.color) return b.color;
  const i = Object.keys(doc.bodies).indexOf(b.id);
  return PALETTE[i % PALETTE.length];
}

/** A body name that isn't taken yet: "Body 1", "Body 2", ... */
export function nextBodyName(doc: SketchDoc, base: string): string {
  const used = new Set(Object.values(doc.bodies).map((b) => b.name));
  for (let i = 1; ; i++) if (!used.has(`${base} ${i}`)) return `${base} ${i}`;
}
