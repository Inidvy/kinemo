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
  /** True when the joint goes round and round, so its range wraps (a full turn, a closed track). */
  wraps?(j: Joint): boolean;
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
  wraps: () => true,
  anchor: (k, j) => k.w(j.refs[0]),
});

/**
 * Fixed pivot: a body fixed at one point only turns about it. Made by a Fix
 * on the body's point, or by a body point coincident with a fixed loose point.
 * Its first body is the world ("").
 */
jointKinds.register({
  id: "anchor",
  label: "joint.anchor",
  unit: "deg",
  fromConstraint(doc, c, owner) {
    let p: Id | undefined;
    if (c.type === "fix") p = c.refs[0];
    else if (c.type === "coincident" && c.refs.length === 2) {
      const fixed = (id: Id) => !owner.has(id) && Object.values(doc.constraints).some((f) => f.type === "fix" && f.refs[0] === id);
      if (fixed(c.refs[0])) p = c.refs[1];
      else if (fixed(c.refs[1])) p = c.refs[0];
    }
    const b = p && owner.get(p);
    if (!p || !b || isGround(doc, b)) return null;
    const at = doc.points[p];
    return { id: c.id, kind: "anchor", a: "", b, refs: [p], data: [at.x, at.y, referenceAngle(doc, owner, b, at)] };
  },
  equations(k, j) {
    const w = k.w(j.refs[0]);
    return [w.x - j.data![0], w.y - j.data![1]];
  },
  measure(k, j) {
    return wrapPi(j.data![2] + k.angle(j.b)) * DEG;
  },
  drive(k, j, value) {
    return wrapPi((this.measure(k, j) - value) / DEG);
  },
  range: () => [-180, 180],
  wraps: () => true,
  anchor: (k, j) => k.w(j.refs[0]),
});

// ------------------------------------------------------------------ track

/** A piece of a track in world coordinates, walked from `from` to `to`. */
type Piece =
  | { kind: "line"; from: Vec; to: Vec; length: number }
  | { kind: "arc"; c: Vec; r: number; start: number; sweep: number; dir: number; length: number };

const TWO_PI = Math.PI * 2;
const wrap2 = (a: number) => ((a % TWO_PI) + TWO_PI) % TWO_PI;

/** The two end points of a line or arc, in its own order. */
function ends(doc: SketchDoc, gid: Id): [Id, Id] | null {
  const g = doc.geoms[gid];
  if (g?.kind === "line") return [g.p1, g.p2];
  if (g?.kind === "arc") return [g.s, g.e];
  return null;
}

/**
 * The chain of connected track lines and arcs of one body that a piece
 * belongs to, in walking order, with each piece's direction (+1 as drawn,
 * -1 reversed). Stops where the track ends or forks.
 */
function trackChain(doc: SketchDoc, owner: Map<Id, Id>, gid: Id): { ids: Id[]; dirs: number[]; closed: boolean } | null {
  const body = owner.get(gid);
  const key = (id: Id) => `${doc.points[id].x.toFixed(4)},${doc.points[id].y.toFixed(4)}`;
  const at = new Map<string, Id[]>();
  for (const g of Object.values(doc.geoms)) {
    const e = g.track && !g.construction && owner.get(g.id) === body ? ends(doc, g.id) : null;
    if (!e) continue;
    for (const p of e) at.set(key(p), [...(at.get(key(p)) ?? []), g.id]);
  }
  const first = ends(doc, gid);
  if (!first || !doc.geoms[gid].track) return null;
  const ids = [gid], dirs = [1];
  const used = new Set(ids);
  // Walk on from one end of the first piece, then back from the other.
  const walk = (from: string, push: (id: Id, dir: number) => void, outward: (dir: number) => 0 | 1) => {
    let v = from;
    for (;;) {
      const next = (at.get(v) ?? []).filter((id) => !used.has(id));
      if (next.length !== 1 || (at.get(v)?.length ?? 0) > 2) return;
      const id = next[0];
      const [s, e] = ends(doc, id)!;
      const dir = key(s) === v ? 1 : -1;
      used.add(id);
      push(id, dir);
      v = key(outward(dir) ? e : s);
    }
  };
  walk(key(first[1]), (id, dir) => (ids.push(id), dirs.push(dir)), (dir) => (dir > 0 ? 1 : 0));
  const tail = ids[ids.length - 1], tailDir = dirs[dirs.length - 1];
  const tailEnd = ends(doc, tail)![tailDir > 0 ? 1 : 0];
  const closed = ids.length > 1 && key(tailEnd) === key(first[0]);
  if (!closed) walk(key(first[0]), (id, dir) => (ids.unshift(id), dirs.unshift(-dir)), (dir) => (dir > 0 ? 1 : 0));
  return ids.length > 1 ? { ids, dirs, closed } : null;
}

function pieces(k: JointContext, j: Joint): Piece[] {
  const n = j.refs.length - 1;
  const out: Piece[] = [];
  for (let i = 0; i < n; i++) {
    const g = k.doc.geoms[j.refs[i + 1]];
    const dir = j.data![i + 1];
    if (g.kind === "line") {
      const a = k.w(g.p1), b = k.w(g.p2);
      const [from, to] = dir > 0 ? [a, b] : [b, a];
      out.push({ kind: "line", from, to, length: dist(a, b) });
    } else if (g.kind === "arc") {
      const c = k.w(g.c), s = k.w(g.s), e = k.w(g.e);
      const r = dist(c, s);
      const a0 = angleOf(sub(s, c)), a1 = angleOf(sub(e, c));
      const sweep = wrap2(a1 - a0) || TWO_PI;
      // Walking reversed starts at the arc's end and turns clockwise.
      out.push({ kind: "arc", c, r, start: dir > 0 ? a0 : a1, sweep, dir, length: sweep * r });
    }
  }
  return out;
}

/** Start and end point and direction of travel of a piece. */
function pieceEnds(x: Piece): { from: Vec; to: Vec; tFrom: Vec; tTo: Vec } {
  if (x.kind === "line") {
    const l = x.length || 1;
    const u = { x: (x.to.x - x.from.x) / l, y: (x.to.y - x.from.y) / l };
    return { from: x.from, to: x.to, tFrom: u, tTo: u };
  }
  const at = (q: number) => ({ x: x.c.x + Math.cos(q) * x.r, y: x.c.y + Math.sin(q) * x.r });
  const tan = (q: number) => ({ x: -Math.sin(q) * x.dir, y: Math.cos(q) * x.dir });
  const e = x.start + x.dir * x.sweep;
  return { from: at(x.start), to: at(e), tFrom: tan(x.start), tTo: tan(e) };
}

/**
 * Where a point sits on a track: the piece it belongs to, the distance along
 * the track, and how far off the track it is. Each piece owns the region
 * between the lines that halve the turn at its two ends, and inside it the
 * piece runs on past its ends, so distance and offset change smoothly as the
 * point goes round a corner.
 */
function locate(k: JointContext, j: Joint): { piece: Piece; s: number; off: number; total: number } {
  const p = k.w(j.refs[0]);
  const list = pieces(k, j);
  const closed = j.data![0] > 0;
  const n = list.length;
  const geo = list.map(pieceEnds);
  const total = list.reduce((s, x) => s + x.length, 0);
  const norm = (v: Vec) => {
    const l = Math.hypot(v.x, v.y) || 1;
    return { x: v.x / l, y: v.y / l };
  };
  // Is p on the far side of the corner after piece i (between i and i+1)?
  const past = (i: number) => {
    const g = geo[i], h = geo[(i + 1) % n];
    const m = norm({ x: g.tTo.x + h.tFrom.x, y: g.tTo.y + h.tFrom.y });
    return dot(sub(p, g.to), m) > 0;
  };
  // Each piece's distance along the track and offset, running on past its
  // ends, plus how far the point is from the piece itself.
  const starts: number[] = [];
  const at = list.map((x, i) => {
    starts.push(i ? starts[i - 1] + list[i - 1].length : 0);
    if (x.kind === "line") {
      const u = sub(x.to, x.from);
      const l2 = dot(u, u) || 1;
      const tt = dot(sub(p, x.from), u) / l2;
      const tc = Math.min(1, Math.max(0, tt));
      const d = dist(p, { x: x.from.x + u.x * tc, y: x.from.y + u.y * tc });
      return { t: tt * x.length, off: cross(sub(p, x.from), u) / Math.sqrt(l2), d, end: tt > 1 ? 1 : tt < 0 ? -1 : 0 };
    }
    const ang = angleOf(sub(p, x.c));
    let u = wrap2(x.dir > 0 ? ang - x.start : x.start - ang);
    // Past either end, measure from whichever end is nearer.
    if (u > x.sweep + (TWO_PI - x.sweep) / 2) u -= TWO_PI;
    const uc = Math.min(x.sweep, Math.max(0, u));
    const q = x.start + x.dir * uc;
    const d = dist(p, { x: x.c.x + Math.cos(q) * x.r, y: x.c.y + Math.sin(q) * x.r });
    return { t: u * x.r, off: dist(p, x.c) - x.r, d, end: u > x.sweep ? 1 : u < 0 ? -1 : 0 };
  });
  let i = 0;
  at.forEach((x, k) => {
    if (x.d < at[i].d - 1e-12) i = k;
  });
  // Near a corner, the line that halves the turn decides which piece the point is on.
  if (at[i].end > 0 && (i < n - 1 || closed) && past(i)) i = (i + 1) % n;
  else if (at[i].end < 0 && (i > 0 || closed) && !past((i - 1 + n) % n)) i = (i - 1 + n) % n;
  return { piece: list[i], s: starts[i] + at[i].t, off: at[i].off, total };
}

/** Which way a track runs at the joint: along a line, or round an arc's centre. */
export function trackDirection(k: JointContext, j: Joint): { kind: "line"; from: Vec; to: Vec } | { kind: "arc"; c: Vec } {
  const { piece } = locate(k, j);
  return piece.kind === "line" ? { kind: "line", from: piece.from, to: piece.to } : { kind: "arc", c: piece.c };
}

/** Track: a point of one body runs along a chain of connected track lines and arcs of another. */
jointKinds.register({
  id: "track",
  label: "joint.track",
  unit: "mm",
  fromConstraint(doc, c, owner) {
    if (c.type !== "onCurve") return null;
    const [p, gid] = c.refs;
    const a = owner.get(gid), b = owner.get(p);
    if (!a || !b || a === b) return null;
    const chain = trackChain(doc, owner, gid);
    if (!chain) return null;
    return { id: c.id, kind: "track", a, b, refs: [p, ...chain.ids], data: [chain.closed ? 1 : 0, ...chain.dirs] };
  },
  equations(k, j) {
    return [locate(k, j).off];
  },
  overLimit(k, j) {
    if (j.data![0] > 0) return null;
    const { s, total } = locate(k, j);
    if (s < 0) return s;
    if (s > total) return s - total;
    return null;
  },
  measure(k, j) {
    const { s, total } = locate(k, j);
    return j.data![0] > 0 ? ((s % total) + total) % total : s;
  },
  wraps: (j) => j.data![0] > 0,
  drive(k, j, value) {
    const { s, total } = locate(k, j);
    const d = s - value;
    // Round a closed track, go the short way.
    return j.data![0] > 0 ? d - total * Math.round(d / total) : d;
  },
  range(doc, j) {
    let total = 0;
    for (const gid of j.refs.slice(1)) {
      const g = doc.geoms[gid];
      if (g.kind === "line") total += dist(doc.points[g.p1], doc.points[g.p2]);
      else if (g.kind === "arc") {
        const r = dist(doc.points[g.c], doc.points[g.s]);
        total += (wrap2(angleOf(sub(doc.points[g.e], doc.points[g.c])) - angleOf(sub(doc.points[g.s], doc.points[g.c]))) || TWO_PI) * r;
      }
    }
    return [0, total];
  },
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
  wraps: (j) => j.refs.length < 5,
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
