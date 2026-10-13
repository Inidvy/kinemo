import { Registry } from "../core/registry";
import type { Constraint, Id, SketchDoc, Vec } from "../core/model";
import { isGround } from "./bodies";
import { angleInSweep, angleOf, cross, dist, dot, sub } from "../core/geom";

/**
 * A joint between two bodies. Joints are not drawn by hand: any sketch
 * constraint that ties geometry of two different bodies becomes one. Its id
 * is the id of that constraint.
 */
export interface Joint {
  id: Id;
  kind: string;
  /** The body that carries the slot or curve, or the first body of a pin. */
  a: Id;
  /** The body that moves along it. */
  b: Id;
  /** Point and geometry ids the joint works with; meaning depends on the kind. */
  refs: Id[];
  /** Numbers a kind works out once from the sketch. */
  data?: number[];
}

/** What a joint kind can ask of the current poses. */
export interface JointContext {
  doc: SketchDoc;
  /** World position of a sketch point at the current poses. */
  w(pointId: Id): Vec;
  /** Rotation of a body (radians). */
  angle(bodyId: Id): number;
}

export interface JointKind {
  id: string;
  /** i18n key. */
  label: string;
  /** Unit of the slider that drives this joint. */
  unit: "deg" | "mm";
  /** Make a joint from a sketch constraint, if it ties two different bodies. */
  fromConstraint(doc: SketchDoc, c: Constraint, owner: Map<Id, Id>): Joint | null;
  /** Residuals that are zero when the joint holds. */
  equations(k: JointContext, j: Joint): number[];
  /** When the joint has run past the end of its travel, the residual that clamps it there. */
  overLimit?(k: JointContext, j: Joint): number | null;
  /** Current slider value (degrees or mm). */
  measure(k: JointContext, j: Joint): number;
  /** Residual for driving the joint to a slider value. */
  drive(k: JointContext, j: Joint, value: number): number;
  /** Slider range, if the joint has one. */
  range(doc: SketchDoc, j: Joint): [number, number];
  /** Where the joint is drawn. */
  anchor(k: JointContext, j: Joint): Vec;
}

export const jointKinds = new Registry<JointKind>("joints");

const wrapPi = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const DEG = 180 / Math.PI;

/** Direction from a joint point to the far end of a body, in sketch coordinates. */
function referenceAngle(doc: SketchDoc, owner: Map<Id, Id>, body: Id, at: Vec): number {
  let best = 0, bestD = -1;
  for (const p of Object.values(doc.points)) {
    if (owner.get(p.id) !== body) continue;
    const d = dist(p, at);
    if (d > bestD + 1e-9) {
      bestD = d;
      best = angleOf(sub(p, at));
    }
  }
  return best;
}

function twoBodies(owner: Map<Id, Id>, x: Id, y: Id, doc: SketchDoc): [Id, Id] | null {
  const a = owner.get(x), b = owner.get(y);
  if (!a || !b || a === b) return null;
  // Measure against ground where there is one, so a crank reads its own angle.
  if (isGround(doc, b) && !isGround(doc, a)) return [b, a];
  return [a, b];
}

/** Pin: two points of different bodies held together; the bodies turn about it. */
jointKinds.register({
  id: "pin",
  label: "joint.pin",
  unit: "deg",
  fromConstraint(doc, c, owner) {
    let pts: [Id, Id] | null = null;
    if (c.type === "coincident" && c.refs.length === 2) pts = [c.refs[0], c.refs[1]];
    if (c.type === "concentric") {
      const [g1, g2] = c.refs.map((id) => doc.geoms[id]);
      if (g1 && g2 && g1.kind !== "line" && g2.kind !== "line") pts = [g1.c, g2.c];
    }
    if (!pts) return null;
    const ab = twoBodies(owner, pts[0], pts[1], doc);
    if (!ab) return null;
    const [pa, pb] = owner.get(pts[0]) === ab[0] ? pts : [pts[1], pts[0]];
    const at = doc.points[pa];
    return {
      id: c.id,
      kind: "pin",
      a: ab[0],
      b: ab[1],
      refs: [pa, pb],
      // The sketched direction of each body away from the pin, so the slider reads the angle between them.
      data: [referenceAngle(doc, owner, ab[0], at), referenceAngle(doc, owner, ab[1], at)],
    };
  },
  equations(k, j) {
    const p = k.w(j.refs[0]), q = k.w(j.refs[1]);
    return [p.x - q.x, p.y - q.y];
  },
  measure(k, j) {
    const [ra, rb] = j.data!;
    return wrapPi(rb + k.angle(j.b) - ra - k.angle(j.a)) * DEG;
  },
  drive(k, j, value) {
    return wrapPi((this.measure(k, j) - value) / DEG);
  },
  range: () => [-180, 180],
  anchor: (k, j) => k.w(j.refs[0]),
});

/** Slot: a point of one body slides along a line of another. */
jointKinds.register({
  id: "slot",
  label: "joint.slot",
  unit: "mm",
  fromConstraint(doc, c, owner) {
    if (c.type !== "onCurve") return null;
    const [p, gid] = c.refs;
    const g = doc.geoms[gid];
    if (g?.kind !== "line") return null;
    const a = owner.get(gid), b = owner.get(p);
    if (!a || !b || a === b) return null;
    return { id: c.id, kind: "slot", a, b, refs: [p, g.p1, g.p2, gid] };
  },
  equations(k, j) {
    const [p, l1, l2] = j.refs.slice(0, 3).map((id) => k.w(id));
    const d = sub(l2, l1);
    return [cross(sub(p, l1), d) / (Math.hypot(d.x, d.y) || 1)];
  },
  overLimit(k, j) {
    const s = this.measure(k, j);
    const [, hi] = this.range(k.doc, j);
    if (s < 0) return s;
    if (s > hi) return s - hi;
    return null;
  },
  measure(k, j) {
    const [p, l1, l2] = j.refs.slice(0, 3).map((id) => k.w(id));
    const d = sub(l2, l1);
    return dot(sub(p, l1), d) / (Math.hypot(d.x, d.y) || 1);
  },
  drive(k, j, value) {
    return this.measure(k, j) - value;
  },
  range: (doc, j) => [0, dist(doc.points[j.refs[1]], doc.points[j.refs[2]])],
  anchor: (k, j) => k.w(j.refs[0]),
});

/** Curved slot: a point of one body runs along an arc or circle of another. */
jointKinds.register({
  id: "curveSlot",
  label: "joint.curveSlot",
  unit: "deg",
  fromConstraint(doc, c, owner) {
    if (c.type !== "onCurve") return null;
    const [p, gid] = c.refs;
    const g = doc.geoms[gid];
    if (!g || g.kind === "line") return null;
    const a = owner.get(gid), b = owner.get(p);
    if (!a || !b || a === b) return null;
    return { id: c.id, kind: "curveSlot", a, b, refs: g.kind === "arc" ? [p, g.c, gid, g.s, g.e] : [p, g.c, gid] };
  },
  equations(k, j) {
    const p = k.w(j.refs[0]), c = k.w(j.refs[1]);
    return [dist(p, c) - radius(k.doc, j)];
  },
  overLimit(k, j) {
    if (j.refs.length < 5) return null;
    const local = localAngle(k, j);
    const s = sketchAngle(k.doc, j, 3), e = sketchAngle(k.doc, j, 4);
    if (angleInSweep(local, s, e)) return null;
    // Clamp to whichever end is nearer.
    const ds = wrapPi(local - s), de = wrapPi(local - e);
    return (Math.abs(ds) < Math.abs(de) ? ds : de) * radius(k.doc, j);
  },
  measure(k, j) {
    const local = localAngle(k, j);
    if (j.refs.length < 5) return wrapPi(local) * DEG;
    const s = sketchAngle(k.doc, j, 3);
    let d = wrapPi(local - s);
    if (d < -0.5) d += 2 * Math.PI;
    return d * DEG;
  },
  drive(k, j, value) {
    return wrapPi((this.measure(k, j) - value) / DEG) * radius(k.doc, j);
  },
  range(doc, j) {
    if (j.refs.length < 5) return [-180, 180];
    const s = sketchAngle(doc, j, 3), e = sketchAngle(doc, j, 4);
    let sweep = e - s;
    while (sweep <= 0) sweep += 2 * Math.PI;
    return [0, sweep * DEG];
  },
  anchor: (k, j) => k.w(j.refs[0]),
});

function radius(doc: SketchDoc, j: Joint): number {
  const g = doc.geoms[j.refs[2]];
  if (g.kind === "circle") return g.r;
  return dist(doc.points[j.refs[1]], doc.points[j.refs[3]]);
}

/** Angle of a sketch point around the curve's centre, in the curve body's own frame. */
function sketchAngle(doc: SketchDoc, j: Joint, refIndex: number): number {
  return angleOf(sub(doc.points[j.refs[refIndex]], doc.points[j.refs[1]]));
}

/** Angle of the sliding point around the centre, in the curve body's frame. */
function localAngle(k: JointContext, j: Joint): number {
  return angleOf(sub(k.w(j.refs[0]), k.w(j.refs[1]))) - k.angle(j.a);
}

/** Every joint in the document. */
export function deriveJoints(doc: SketchDoc, owner: Map<Id, Id>): Joint[] {
  const out: Joint[] = [];
  for (const c of Object.values(doc.constraints)) {
    for (const kind of jointKinds.all()) {
      const j = kind.fromConstraint(doc, c, owner);
      if (j) {
        out.push(j);
        break;
      }
    }
  }
  return out;
}
