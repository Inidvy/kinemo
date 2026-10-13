import type { Driver, Id, Pose, SketchDoc, Vec } from "../core/model";
import { applyPose, IDENTITY, isGround, ownerMap } from "./bodies";
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
  private letters: Map<Id, string> | null = null;
  /** Typical size of the mechanism, so rotations and shifts weigh alike. */
  readonly size: number;

  constructor(readonly doc: SketchDoc) {
    this.owner = ownerMap(doc);
    this.joints = deriveJoints(doc, this.owner);
    this.moving = Object.values(doc.bodies)
      .filter((b) => !isGround(doc, b.id))
      .map((b) => b.id);
    this.moving.forEach((id, i) => this.index.set(id, i * 3));
    // Size of the parts that move, from their outline: an arc's centre can be
    // far away (a gentle curve) and would make the mechanism seem huge, so
    // the solver would take steps far too big for it.
    const outline = (ids: Id[]) =>
      ids.flatMap((id) => {
        const g = doc.geoms[id];
        if (!g) return doc.points[id] ? [doc.points[id]] : [];
        if (g.kind === "line") return [doc.points[g.p1], doc.points[g.p2]];
        if (g.kind === "arc") return [doc.points[g.s], doc.points[g.e]];
        const c = doc.points[g.c];
        return [{ x: c.x - g.r, y: c.y - g.r }, { x: c.x + g.r, y: c.y + g.r }];
      });
    const extent = (pts: Vec[]) => {
      if (pts.length < 2) return 0;
      const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
      return Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    };
    // Mostly the moving parts, but not much smaller than the whole drawing.
    const moving = extent(outline(this.moving.flatMap((id) => doc.bodies[id].members)));
    const all = extent(outline(Object.values(doc.bodies).flatMap((b) => b.members)));
    this.size = Math.max(10, moving, all / 3) || 100;
  }

  /**
   * The same mechanism for a document that differs from this one only in
   * where the bodies are, without working out the joints again.
   */
  at(doc: SketchDoc): Mechanism {
    return Object.assign(Object.create(Mechanism.prototype) as Mechanism, this, { doc });
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

  /** A short name for a joint: A, B, … Z, AA, AB, … in the order the joints were made. */
  letter(jointId: Id): string {
    if (!this.letters) {
      this.letters = new Map();
      this.joints.forEach((j, i) => {
        let n = i, s = "";
        do {
          s = String.fromCharCode(65 + (n % 26)) + s;
          n = Math.floor(n / 26) - 1;
        } while (n >= 0);
        this.letters!.set(j.id, s);
      });
    }
    return this.letters.get(jointId) ?? "?";
  }

  context(q: number[]): JointContext {
    return {
      doc: this.doc,
      w: (pid) => applyPose(this.pose(q, this.owner.get(pid)), this.doc.points[pid]),
      angle: (bid) => this.pose(q, bid).a,
    };
  }

  private byId: Map<Id, Joint> | null = null;

  joint(id: Id): Joint | undefined {
    if (!this.byId) this.byId = new Map(this.joints.map((j) => [j.id, j]));
    return this.byId.get(id);
  }

  measure(q: number[], jointId: Id): number {
    const j = this.joint(jointId);
    return j ? jointKinds.get(j.kind).measure(this.context(q), j) : 0;
  }

  /** Degrees of freedom left by the joints at this pose. */
  dof(q: number[] = this.current()): number {
    if (!this.moving.length) return 0;
    // Central differences: accurate enough that joints which repeat each
    // other (a gear pair on two fixed pins) don't count twice.
    const { J } = this.jacobian(this.blocks([], []), q, 1e-5, true);
    return q.length - (J.length ? rank(J, 1e-6) : 0);
  }

  /** The equations in groups (a joint, a slider, a clamp), each touching only a body or two. */
  private blocks(extra: ((k: JointContext) => number)[], drive: { joint: Id; value: number }[]): Block[] {
    const out: Block[] = [];
    for (const j of this.joints) {
      const kind = jointKinds.get(j.kind);
      out.push((k) => {
        const e = [...kind.equations(k, j)];
        if (j.noTurn !== undefined && kind.tangent) {
          const d = k.angle(j.b) - kind.tangent(k, j) - j.noTurn;
          e.push(Math.atan2(Math.sin(d), Math.cos(d)) * this.size);
        }
        return e;
      });
    }
    for (const d of drive) {
      const j = this.joint(d.joint);
      if (j) out.push((k) => [jointKinds.get(j.kind).drive(k, j, d.value)]);
    }
    for (const e of extra) out.push((k) => [e(k)]);
    return out;
  }

  /**
   * Values and finite-difference Jacobian of the equations. A body's
   * variables only feed the groups that read that body, so each column
   * re-evaluates just those groups; every other entry is exactly zero,
   * as re-evaluating them would give.
   */
  private jacobian(blocks: Block[], q: number[], h: number, central = false): { C: number[]; J: number[][] } {
    const touched: Set<number>[] = [];
    let seen = new Set<number>();
    const note = (bid: Id | undefined) => {
      const i = bid === undefined ? undefined : this.index.get(bid);
      if (i !== undefined) seen.add(i / 3);
    };
    const base = this.context(q);
    const k0: JointContext = {
      doc: base.doc,
      w: (pid) => (note(this.owner.get(pid)), base.w(pid)),
      angle: (bid) => (note(bid), base.angle(bid)),
    };
    const f0: number[][] = [];
    const offset: number[] = [];
    let m = 0;
    for (const b of blocks) {
      seen = new Set();
      f0.push(b(k0));
      touched.push(seen);
      offset.push(m);
      m += f0[f0.length - 1].length;
    }
    const readers: number[][] = this.moving.map(() => []);
    touched.forEach((set, bi) => set.forEach((body) => readers[body].push(bi)));
    const J = Array.from({ length: m }, () => new Array<number>(q.length).fill(0));
    const qq = [...q];
    for (let c = 0; c < q.length; c++) {
      const users = readers[Math.floor(c / 3)];
      if (!users.length) continue;
      qq[c] = q[c] + h;
      const ku = this.context(qq);
      const up = users.map((bi) => blocks[bi](ku));
      let down: number[][] | null = null;
      if (central) {
        qq[c] = q[c] - h;
        const kd = this.context(qq);
        down = users.map((bi) => blocks[bi](kd));
      }
      qq[c] = q[c];
      users.forEach((bi, u) => {
        const o = offset[bi];
        const a = up[u], b = down ? down[u] : f0[bi];
        for (let r = 0; r < a.length; r++) J[o + r][c] = down ? (a[r] - b[r]) / (2 * h) : (a[r] - b[r]) / h;
      });
    }
    return { C: f0.flat(), J };
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
          // Hold it at the end it ran past. As an equation rather than a
          // one-sided limit, so the solver can't flip-flop across the end.
          const [lo, hi] = kind.range(this.doc, j);
          const end = over > 0 ? hi : lo;
          clamps.push((kk) => kind.measure(kk, j) - end);
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
    const blocks = this.blocks(extra, drive);
    const cons = (q: number[]) => {
      const k = this.context(q);
      return blocks.flatMap((b) => b(k));
    };

    let q = [...start];
    for (let iter = 0; iter < 80; iter++) {
      const { C, J } = this.jacobian(blocks, q, 1e-7);
      const r = goals(q);
      const Jr = jacobian(goals, q);
      const m = C.length;
      // Gauss-Newton step on the goals, subject to the linearised joints:
      // [JrᵀJr  Jᵀ] [Δ]   [-Jrᵀr]
      // [J     -εI] [μ] = [-C   ]
      // Each goal touches one or three variables, so JrᵀJr and Jrᵀr are
      // summed over the non-zero entries only (same sums, same order).
      const JtJ = Array.from({ length: n }, () => new Array<number>(n).fill(0));
      const g = new Array<number>(n).fill(0);
      for (let i = 0; i < r.length; i++) {
        const row = Jr[i];
        const nz: number[] = [];
        for (let a = 0; a < n; a++) if (row[a] !== 0) nz.push(a);
        for (const a of nz) {
          for (const b of nz) JtJ[a][b] += row[a] * row[b];
          g[a] += row[a] * r[i];
        }
      }
      const K: number[][] = [];
      const rhs: number[] = [];
      for (let a = 0; a < n; a++) {
        const row = new Array<number>(n + m).fill(0);
        for (let b = 0; b < n; b++) row[b] = JtJ[a][b] + (a === b ? 1e-12 : 0);
        for (let i = 0; i < m; i++) row[n + i] = J[i][a];
        K.push(row);
        rhs.push(-g[a]);
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

  /**
   * Drag a point of a body towards a target in small steps from where it is
   * now, so the mechanism slides along the way it can move (round a track's
   * corners, say) instead of jumping to some other pose near the target.
   * Returns the last pose that worked, or null if none did.
   */
  dragTo(drag: MotionDrag): number[] | null {
    let q = this.current();
    if (!this.index.has(drag.body)) return null;
    const from = applyPose(this.pose(q, drag.body), drag.local);
    const gap = Math.hypot(drag.to.x - from.x, drag.to.y - from.y);
    const steps = Math.min(24, Math.max(1, Math.ceil(gap / (this.size / 40))));
    let ok = false;
    for (let s = 1; s <= steps; s++) {
      const to = { x: from.x + ((drag.to.x - from.x) * s) / steps, y: from.y + ((drag.to.y - from.y) * s) / steps };
      const next = this.solve({ start: q, drag: { ...drag, to }, maxTurn: 0.8 });
      if (!next) break;
      q = next;
      ok = true;
    }
    return ok ? q : null;
  }

  /**
   * Move several joints to slider values at once (a timeline frame), in
   * small steps so the mechanism follows the nearest pose. Joints that wrap
   * take the short way round. Stops at the last pose that works.
   */
  driveAll(targets: { joint: Id; value: number }[], start?: number[]): { q: number[]; reached: boolean } {
    let q = start ?? this.current();
    const moves = targets
      .map((t) => {
        const j = this.joint(t.joint);
        if (!j) return null;
        const kind = jointKinds.get(j.kind);
        const from = this.measure(q, t.joint);
        let delta = t.value - from;
        if (kind.wraps?.(j)) {
          const [lo, hi] = kind.range(this.doc, j);
          const p = hi - lo;
          delta = ((((delta + p / 2) % p) + p) % p) - p / 2;
        }
        const maxStep = kind.unit === "deg" ? 4 : this.size / 40;
        return { joint: t.joint, from, delta, steps: Math.ceil(Math.abs(delta) / maxStep) };
      })
      .filter((x) => x !== null);
    if (!moves.length) return { q, reached: false };
    const steps = Math.max(1, ...moves.map((m) => m.steps));
    for (let s = 1; s <= steps; s++) {
      const drive = moves.map((m) => ({ joint: m.joint, value: m.from + (m.delta * s) / steps }));
      const next = this.solve({ start: q, drive, maxTurn: 0.8 });
      if (!next) return { q, reached: false };
      q = next;
    }
    return { q, reached: true };
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
  driveTo(jointId: Id, value: number, hold: Id[] = [], start?: number[]): { q: number[]; reached: boolean } {
    let q = start ?? this.current();
    const j = this.joint(jointId);
    if (!j) return { q, reached: false };
    const kind = jointKinds.get(j.kind);
    const unit = kind.unit;
    const from = this.measure(q, jointId);
    let delta = value - from;
    // A joint that goes round takes the short way there.
    if (kind.wraps?.(j)) {
      const [lo, hi] = kind.range(this.doc, j);
      const p = hi - lo;
      delta = ((((delta + p / 2) % p) + p) % p) - p / 2;
    }
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
      const j = this.joints.find((j) => j.a === "" || isGround(this.doc, j.a) || isGround(this.doc, j.b)) ?? this.joints[0];
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

/** A group of equations that reads only some bodies. */
type Block = (k: JointContext) => number[];

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
