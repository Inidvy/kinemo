import type { Driver, Id, Pose, SketchDoc, Vec } from "../core/model";
import { applyPose, IDENTITY, ownerMap } from "./bodies";
import { deriveJoints, jointKinds, type Joint, type JointContext } from "./joints";
import { rank, solveLinear } from "./linalg";

/** A body-fixed point the user is dragging, and where the cursor wants it. */
export interface MotionDrag {
  body: Id;
  /** The grabbed point in the body's sketch coordinates. */
  local: Vec;
  to: Vec;
}

export interface SolveOptions {
  /** Pull a body point towards the cursor. */
  drag?: MotionDrag;
  /** Hold these joints at these slider values. */
  drive?: { joint: Id; value: number }[];
  /** Where to start and what to stay close to (defaults to the current poses). */
  start?: number[];
  /** Largest rotation any body may make in one solve (radians), to stay on the same branch. */
  maxTurn?: number;
}

/** Weight of the pull keeping bodies where they are, relative to the drag. */
const HOLD = 0.01;

/**
 * Rigid-body solver for Motion mode. Each moving body has a pose (x, y,
 * rotation); joints are equations between bodies. A solve satisfies every
 * joint exactly while moving bodies as little as possible, plus pulling a
 * dragged point to the cursor or holding a slider at its value. Joints that
 * run past the end of their slot are clamped there.
 */
export class Mechanism {
  readonly owner: Map<Id, Id>;
  readonly joints: Joint[];
  /** Moving (non-ground) bodies, in variable order. */
  readonly moving: Id[];
  private index = new Map<Id, number>();
  /** Typical size of the mechanism, so rotations and shifts weigh alike. */
  readonly size: number;

  constructor(readonly doc: SketchDoc) {
    this.owner = ownerMap(doc);
    this.joints = deriveJoints(doc, this.owner);
    this.moving = Object.values(doc.bodies)
      .filter((b) => !b.ground)
      .map((b) => b.id);
    this.moving.forEach((id, i) => this.index.set(id, i * 3));
    const pts = Object.values(doc.points);
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    this.size = pts.length ? Math.max(10, Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))) : 100;
  }

  /** Current poses as a variable vector. */
  current(): number[] {
    const q: number[] = [];
    for (const id of this.moving) {
      const p = this.doc.motion.poses[id] ?? IDENTITY;
      q.push(p.x, p.y, p.a);
    }
    return q;
  }

  pose(q: number[], body: Id | undefined): Pose {
    if (!body) return IDENTITY;
    const i = this.index.get(body);
    if (i === undefined) return this.doc.motion.poses[body] ?? IDENTITY;
    return { x: q[i], y: q[i + 1], a: q[i + 2] };
  }

  poses(q: number[]): Record<Id, Pose> {
    const out: Record<Id, Pose> = {};
    for (const id of Object.keys(this.doc.bodies)) out[id] = this.pose(q, id);
    return out;
  }

  context(q: number[]): JointContext {
    return {
      doc: this.doc,
      w: (pid) => applyPose(this.pose(q, this.owner.get(pid)), this.doc.points[pid]),
      angle: (bid) => this.pose(q, bid).a,
    };
  }

  joint(id: Id): Joint | undefined {
    return this.joints.find((j) => j.id === id);
  }

  measure(q: number[], jointId: Id): number {
    const j = this.joint(jointId);
    return j ? jointKinds.get(j.kind).measure(this.context(q), j) : 0;
  }

  /** Degrees of freedom left by the joints at this pose. */
  dof(q: number[] = this.current()): number {
    if (!this.moving.length) return 0;
    const f = (x: number[]) => this.equations(x, [], []);
    const J = jacobian(f, q);
    return q.length - (J.length ? rank(J, 1e-7) : 0);
  }

  private equations(q: number[], extra: ((k: JointContext) => number)[], drive: { joint: Id; value: number }[]): number[] {
    const k = this.context(q);
    const out: number[] = [];
    for (const j of this.joints) out.push(...jointKinds.get(j.kind).equations(k, j));
    for (const d of drive) {
      const j = this.joint(d.joint);
      if (j) out.push(jointKinds.get(j.kind).drive(k, j, d.value));
    }
    for (const e of extra) out.push(e(k));
    return out;
  }

  /** Solve for new poses. Returns null when no pose meets the joints (the caller keeps the last good one). */
  solve(opts: SolveOptions = {}): number[] | null {
    const start = opts.start ?? this.current();
    const clamps: ((k: JointContext) => number)[] = [];
    const clamped = new Set<Id>();
    for (let round = 0; round < 4; round++) {
      const q = this.solveOnce(start, opts, clamps);
      if (!q) return null;
      // Joints past the end of their travel get clamped there, then solve again.
      const k = this.context(q);
      let added = false;
      for (const j of this.joints) {
        const kind = jointKinds.get(j.kind);
        if (!kind.overLimit || clamped.has(j.id)) continue;
        const over = kind.overLimit(k, j);
        if (over !== null && Math.abs(over) > 1e-7) {
          // Clamp to the end it ran past, measured fresh at each iterate.
          const sign = Math.sign(over);
          clamps.push((kk) => {
            const o = kind.overLimit!(kk, j);
            return o === null ? 0 : Math.sign(o) === sign ? o : 0;
          });
          clamped.add(j.id);
          added = true;
        }
      }
      if (!added) {
        if (opts.maxTurn !== undefined) {
          for (let i = 2; i < q.length; i += 3) if (Math.abs(q[i] - start[i]) > opts.maxTurn) return null;
        }
        return q;
      }
    }
    return null;
  }

  private solveOnce(start: number[], opts: SolveOptions, extra: ((k: JointContext) => number)[]): number[] | null {
    const n = start.length;
    if (n === 0) return [];
    const L = this.size;
    const drive = opts.drive ?? [];
    const hold = Math.sqrt(HOLD);
    // Soft goals: stay close to the start, and pull the dragged point.
    const goals = (q: number[]): number[] => {
      const r: number[] = [];
      for (let i = 0; i < n; i += 3) r.push(hold * (q[i] - start[i]), hold * (q[i + 1] - start[i + 1]), hold * L * (q[i + 2] - start[i + 2]));
      const d = opts.drag;
      if (d && this.index.has(d.body)) {
        const w = applyPose(this.pose(q, d.body), d.local);
        r.push(w.x - d.to.x, w.y - d.to.y);
      }
      return r;
    };
    const cons = (q: number[]) => this.equations(q, extra, drive);

    let q = [...start];
    for (let iter = 0; iter < 80; iter++) {
      const C = cons(q);
      const J = jacobian(cons, q);
      const r = goals(q);
      const Jr = jacobian(goals, q);
      const m = C.length;
      // Gauss-Newton step on the goals, subject to the linearised joints:
      // [JrᵀJr  Jᵀ] [Δ]   [-Jrᵀr]
      // [J     -εI] [μ] = [-C   ]
      const K: number[][] = [];
      const rhs: number[] = [];
      for (let a = 0; a < n; a++) {
        const row = new Array<number>(n + m).fill(0);
        for (let b = 0; b < n; b++) {
          let s = 0;
          for (let i = 0; i < r.length; i++) s += Jr[i][a] * Jr[i][b];
          row[b] = s + (a === b ? 1e-12 : 0);
        }
        for (let i = 0; i < m; i++) row[n + i] = J[i][a];
        K.push(row);
        let g = 0;
        for (let i = 0; i < r.length; i++) g += Jr[i][a] * r[i];
        rhs.push(-g);
      }
      for (let i = 0; i < m; i++) {
        const row = new Array<number>(n + m).fill(0);
        for (let b = 0; b < n; b++) row[b] = J[i][b];
        // A tiny negative diagonal keeps dependent (redundant) joints solvable.
        row[n + i] = -1e-10;
        K.push(row);
        rhs.push(-C[i]);
      }
      const sol = solveLinear(K, rhs);
      if (!sol) return null;
      let step = sol.slice(0, n);
      // Keep each step modest so the solver follows the nearest pose.
      let maxRot = 0, maxMove = 0;
      for (let i = 0; i < n; i += 3) {
        maxMove = Math.max(maxMove, Math.abs(step[i]), Math.abs(step[i + 1]));
        maxRot = Math.max(maxRot, Math.abs(step[i + 2]));
      }
      const f = Math.min(1, 0.4 / (maxRot || 1e-30), (0.4 * L) / (maxMove || 1e-30));
      if (f < 1) step = step.map((v) => v * f);
      q = q.map((v, i) => v + step[i]);
      const err = Math.max(0, ...cons(q).map(Math.abs));
      const moved = Math.max(...step.map(Math.abs));
      if (err < 1e-8 * L && moved < 1e-7 * L) return q;
      if (!Number.isFinite(err)) return null;
    }
    const err = Math.max(0, ...cons(q).map(Math.abs));
    return err < 1e-6 * L ? q : null;
  }

  /** Measured slider values for the given drivers. */
  driverValues(q: number[], drivers: Driver[]): Record<Id, number> {
    const out: Record<Id, number> = {};
    for (const d of drivers) out[d.id] = this.measure(q, d.joint);
    return out;
  }

  /**
   * Move a joint to a slider value in small steps, so the mechanism follows
   * the nearest pose. Stops at the last pose that works.
   */
  driveTo(jointId: Id, value: number, hold: Id[] = []): { q: number[]; reached: boolean } {
    let q = this.current();
    const j = this.joint(jointId);
    if (!j) return { q, reached: false };
    const unit = jointKinds.get(j.kind).unit;
    const from = this.measure(q, jointId);
    let delta = value - from;
    if (unit === "deg") delta = ((((delta + 180) % 360) + 360) % 360) - 180;
    const maxStep = unit === "deg" ? 4 : this.size / 40;
    const steps = Math.max(1, Math.ceil(Math.abs(delta) / maxStep));
    const others = hold.filter((id) => id !== jointId).map((id) => ({ joint: id, value: this.measure(q, id) }));
    for (let s = 1; s <= steps; s++) {
      const target = from + (delta * s) / steps;
      const next = this.solve({ start: q, drive: [...others, { joint: jointId, value: target }], maxTurn: 0.8 });
      if (!next) {
        // Try with the other sliders let go before giving up.
        const loose = others.length ? this.solve({ start: q, drive: [{ joint: jointId, value: target }], maxTurn: 0.8 }) : null;
        if (!loose) return { q, reached: false };
        q = loose;
        continue;
      }
      q = next;
    }
    return { q, reached: true };
  }

  /**
   * The other way the mechanism can be put together with the same slider
   * values (for example a four-bar's crossed form). Returns the nearest
   * different pose, or null if there is none.
   */
  flip(drivers: Driver[], random: () => number = Math.random): number[] | null {
    const q0 = this.current();
    if (!this.moving.length) return null;
    let locks = drivers.map((d) => ({ joint: d.joint, value: this.measure(q0, d.joint) }));
    if (!locks.length) {
      // No sliders: keep the first joint to ground where it is.
      const j = this.joints.find((j) => this.doc.bodies[j.a]?.ground || this.doc.bodies[j.b]?.ground) ?? this.joints[0];
      if (j) locks = [{ joint: j.id, value: this.measure(q0, j.id) }];
    }
    const found: number[][] = [];
    const L = this.size;
    for (let tries = 0; tries < 60; tries++) {
      const start = [...q0];
      for (let i = 0; i < start.length; i += 3) {
        // Turn each body about its own centre by a random angle.
        const body = this.moving[i / 3];
        const c = this.centre(body);
        const before = applyPose(this.pose(q0, body), c);
        const a = q0[i + 2] + (random() - 0.5) * 2 * Math.PI;
        const turned = applyPose({ x: 0, y: 0, a }, c);
        start[i] = before.x - turned.x + (random() - 0.5) * 0.3 * L;
        start[i + 1] = before.y - turned.y + (random() - 0.5) * 0.3 * L;
        start[i + 2] = a;
      }
      const q = this.solve({ start, drive: locks });
      if (!q) continue;
      if (this.distance(q, q0) < 1e-3 * L) continue;
      if (found.some((f) => this.distance(f, q) < 1e-3 * L)) continue;
      found.push(q);
    }
    if (!found.length) return null;
    found.sort((a, b) => this.distance(a, q0) - this.distance(b, q0));
    return found[0];
  }

  /** Largest distance any body point moves between two poses. */
  distance(qa: number[], qb: number[]): number {
    let d = 0;
    for (const [pid, bid] of this.owner) {
      const p = this.doc.points[pid];
      if (!p) continue;
      const a = applyPose(this.pose(qa, bid), p), b = applyPose(this.pose(qb, bid), p);
      d = Math.max(d, Math.hypot(a.x - b.x, a.y - b.y));
    }
    return d;
  }

  private centre(body: Id): Vec {
    let x = 0, y = 0, n = 0;
    for (const [pid, bid] of this.owner) {
      if (bid !== body || !this.doc.points[pid]) continue;
      x += this.doc.points[pid].x;
      y += this.doc.points[pid].y;
      n++;
    }
    return n ? { x: x / n, y: y / n } : { x: 0, y: 0 };
  }

  /** Put the mechanism together from its saved poses, or from the sketch if that fails. */
  assemble(): number[] {
    const q = this.current();
    const ok = this.solve({ start: q });
    if (ok) return ok;
    const sketch = this.moving.flatMap(() => [0, 0, 0]);
    return this.solve({ start: sketch }) ?? sketch;
  }
}

/** Forward-difference Jacobian of f at q. */
function jacobian(f: (q: number[]) => number[], q: number[]): number[][] {
  const f0 = f(q);
  const J = f0.map(() => new Array<number>(q.length).fill(0));
  const h = 1e-7;
  for (let j = 0; j < q.length; j++) {
    const qq = [...q];
    qq[j] += h;
    const f1 = f(qq);
    for (let i = 0; i < f0.length; i++) J[i][j] = (f1[i] - f0[i]) / h;
  }
  return J;
}
