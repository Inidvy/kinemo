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
const PALETTE = ["#7fb3e8", "#f2b36b", "#8fd19e", "#e79ac0", "#b9a5e6", "#7fd3d1", "#e8d27f", "#f0937f"];
export const GROUND_COLOR = "#b7bcc5";

export function bodyColor(doc: SketchDoc, b: Body): string {
  if (b.ground) return GROUND_COLOR;
  const i = Object.keys(doc.bodies).indexOf(b.id);
  return PALETTE[i % PALETTE.length];
}

/** A body name that isn't taken yet: "Body 1", "Body 2", ... */
export function nextBodyName(doc: SketchDoc, base: string): string {
  const used = new Set(Object.values(doc.bodies).map((b) => b.name));
  for (let i = 1; ; i++) if (!used.has(`${base} ${i}`)) return `${base} ${i}`;
}
