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

/**
 * Ground bodies never move: the ones marked as ground, and any body with a
 * fixed point or line in the sketch.
 */
export function groundBodies(doc: SketchDoc): Set<Id> {
  let set = groundCache.get(doc);
  if (set) return set;
  set = new Set(Object.values(doc.bodies).filter((b) => b.ground).map((b) => b.id));
  const own = ownerMap(doc);
  for (const c of Object.values(doc.constraints)) {
    if (c.type !== "fix") continue;
    for (const r of c.refs) if (own.has(r)) set.add(own.get(r)!);
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

/** Where a sketch point is in Motion mode. Points outside bodies stay put. */
export function motionPoint(doc: SketchDoc, owner: Map<Id, Id>, pointId: Id): Vec {
  return applyPose(poseOf(doc, owner.get(pointId)), doc.points[pointId]);
}

/** Bar colours, picked by body order. Ground is always grey. */
const PALETTE = ["#5aa9f0", "#f5a54a", "#4cc788", "#ef7fb4", "#9f86f0", "#3fc9c4", "#e6c13d", "#f27a64"];
export const GROUND_COLOR = "#9aa1ad";

export function bodyColor(doc: SketchDoc, b: Body): string {
  if (isGround(doc, b.id)) return GROUND_COLOR;
  const i = Object.keys(doc.bodies).indexOf(b.id);
  return PALETTE[i % PALETTE.length];
}

/** A body name that isn't taken yet: "Body 1", "Body 2", ... */
export function nextBodyName(doc: SketchDoc, base: string): string {
  const used = new Set(Object.values(doc.bodies).map((b) => b.name));
  for (let i = 1; ; i++) if (!used.has(`${base} ${i}`)) return `${base} ${i}`;
}
