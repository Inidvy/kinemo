import { GcsWrapper, init_planegcs_module, SolveStatus, Algorithm, DebugMode } from "@salusoft89/planegcs";
import { arcRadius, cloneDoc, type Id, type SketchDoc, type Vec } from "../core/model";
import { angleOf } from "../core/geom";
import { constraintTypes } from "../constraints";
import type { Primitive } from "../constraints/types";

export interface SolveResult {
  ok: boolean;
  doc: SketchDoc;
  dof: number;
  /** Our constraint ids that conflict or are redundant. */
  conflicting: Id[];
  redundant: Id[];
}

/** A point the user is dragging, and where the cursor wants it. */
export interface DragTarget {
  point: Id;
  to: Vec;
}

/**
 * Adapter between the document and PlaneGCS. Nothing else in the app talks to
 * the solver directly, so it could be replaced without touching features.
 */
export class Solver {
  private constructor(private w: GcsWrapper) {}

  static async create(wasmUrl?: string): Promise<Solver> {
    const mod = await init_planegcs_module(wasmUrl ? { locateFile: () => wasmUrl } : undefined);
    const w = new GcsWrapper(new mod.GcsSystem());
    w.debug_mode = DebugMode.NoDebug;
    return new Solver(w);
  }

  /**
   * Solve the document. Returns a new document with updated positions; the
   * input is not changed. Drag targets are soft: they pull points as far as
   * the constraints allow.
   */
  solve(doc: SketchDoc, drag: DragTarget[] = [], extra: Primitive[] = []): SolveResult {
    const prims = toPrimitives(doc);
    drag.forEach((d, i) => {
      prims.push({ id: `drag#${i}x`, type: "coordinate_x", p_id: d.point, x: d.to.x, temporary: true });
      prims.push({ id: `drag#${i}y`, type: "coordinate_y", p_id: d.point, y: d.to.y, temporary: true });
    });
    if (drag.length || extra.length) {
      // Weakly hold every other point where it is, so a drag changes as
      // little as possible (dragging a corner resizes instead of moving all).
      const dragged = new Set(drag.map((d) => d.point));
      for (const p of Object.values(doc.points)) {
        if (dragged.has(p.id)) continue;
        prims.push({ id: `hold#${p.id}x`, type: "coordinate_x", p_id: p.id, x: p.x, temporary: true, scale: HOLD });
        prims.push({ id: `hold#${p.id}y`, type: "coordinate_y", p_id: p.id, y: p.y, temporary: true, scale: HOLD });
      }
    }
    prims.push(...extra);

    const w = this.w;
    w.clear_data();
    w.push_primitives_and_params(prims as never);
    const status = w.solve(Algorithm.DogLeg);
    const ok = status === SolveStatus.Success || status === SolveStatus.Converged;
    const out = cloneDoc(doc);
    if (ok) {
      w.apply_solution();
      readBack(out, w);
    } else if (drag.length || extra.length) {
      // Soft targets that can't all be met make the solver report failure
      // even when its answer is good. Accept the answer if it still satisfies
      // every real constraint.
      w.apply_solution();
      readBack(out, w);
      const check = this.solve(out);
      if (check.ok) return check;
    }
    const toOurs = (ids: string[]) => [...new Set(ids.map((s) => s.split("#")[0]).filter((s) => s in doc.constraints))];
    return {
      ok,
      doc: out,
      dof: w.gcs.dof(),
      conflicting: toOurs(w.get_gcs_conflicting_constraints()),
      redundant: toOurs(w.get_gcs_redundant_constraints()),
    };
  }

  /** True when the solve succeeded with no conflicting or redundant constraints. */
  static clean(r: SolveResult): boolean {
    return r.ok && r.conflicting.length === 0 && r.redundant.length === 0;
  }

  /** Solve as if some constraints weren't there, keeping them in the returned document. */
  solveWithout(doc: SketchDoc, ignore: Iterable<Id>, drag: DragTarget[] = []): SolveResult {
    const skip = new Set(ignore);
    if (skip.size === 0) return this.solve(doc, drag);
    const r = this.solve(without(doc, skip), drag);
    const out = cloneDoc(doc);
    out.points = r.doc.points;
    for (const g of Object.values(r.doc.geoms)) if (g.kind === "circle") (out.geoms[g.id] as typeof g).r = g.r;
    return { ...r, doc: out };
  }

  /**
   * For an over-constrained sketch: every constraint whose removal on its own
   * makes the sketch solve cleanly again.
   */
  fixes(doc: SketchDoc): Id[] {
    const ids = Object.keys(doc.constraints);
    if (ids.length > MAX_FIX_SCAN) {
      const r = this.solve(doc);
      return [...new Set([...r.conflicting, ...r.redundant])];
    }
    return ids.filter((id) => Solver.clean(this.solve(without(doc, new Set([id])))));
  }

  /**
   * Which points can still move. A point is free if a small soft pull in x or
   * y moves it. Used to colour under-defined geometry.
   */
  freePoints(doc: SketchDoc): Set<Id> {
    return finish(this.freePointSteps(doc));
  }

  /** `freePoints` one point at a time: yields after each, so a caller can spread the work out. */
  *freePointSteps(doc: SketchDoc): Generator<void, Set<Id>> {
    const free = new Set<Id>();
    const eps = 0.01;
    for (const p of Object.values(doc.points)) {
      for (const [dx, dy] of [
        [eps, 0],
        [0, eps],
      ]) {
        const r = this.solve(doc, [{ point: p.id, to: { x: p.x + dx, y: p.y + dy } }]);
        const q = r.doc.points[p.id];
        if (r.ok && Math.hypot(q.x - p.x, q.y - p.y) > eps * 0.1) {
          free.add(p.id);
          break;
        }
      }
      yield;
    }
    return free;
  }

  /** Circles whose radius is not fixed by constraints. */
  freeRadii(doc: SketchDoc): Set<Id> {
    return finish(this.freeRadiusSteps(doc));
  }

  /** `freeRadii` one circle at a time, like `freePointSteps`. */
  *freeRadiusSteps(doc: SketchDoc): Generator<void, Set<Id>> {
    const free = new Set<Id>();
    for (const g of Object.values(doc.geoms)) {
      if (g.kind !== "circle") continue;
      const r = this.solve(doc, [], [{ id: "probe#0", type: "circle_radius", c_id: g.id, radius: g.r + 0.01, temporary: true }]);
      const g2 = r.doc.geoms[g.id];
      if (r.ok && g2.kind === "circle" && Math.abs(g2.r - g.r) > 0.001) free.add(g.id);
      yield;
    }
    return free;
  }

  destroy(): void {
    this.w.destroy_gcs_module();
  }
}

/** Weight of the soft hold on points that are not being dragged. */
const HOLD = 0.01;
/** Above this many constraints, trust the solver's own list instead of testing each removal. */
const MAX_FIX_SCAN = 400;

/** Run a stepwise computation to the end. */
function finish<T>(steps: Generator<void, T>): T {
  for (;;) {
    const r = steps.next();
    if (r.done) return r.value;
  }
}

function without(doc: SketchDoc, skip: Set<Id>): SketchDoc {
  const d = cloneDoc(doc);
  for (const id of skip) delete d.constraints[id];
  return d;
}

/**
 * A drag step that collapses a line, circle or arc to nothing, or throws
 * points far away, is the solver escaping into a degenerate answer rather
 * than a pose the user wants. Such steps are skipped.
 */
export function degenerate(before: SketchDoc, after: SketchDoc): boolean {
  const len = (d: SketchDoc, a: Id, b: Id) => Math.hypot(d.points[a].x - d.points[b].x, d.points[a].y - d.points[b].y);
  for (const p of Object.values(after.points)) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || Math.abs(p.x) > 1e6 || Math.abs(p.y) > 1e6) return true;
  }
  const tiny = 1e-4;
  for (const g of Object.values(after.geoms)) {
    const g0 = before.geoms[g.id];
    if (!g0) continue;
    if (g.kind === "line" && g0.kind === "line" && len(after, g.p1, g.p2) < tiny && len(before, g.p1, g.p2) >= tiny) return true;
    if (g.kind === "circle" && g0.kind === "circle" && Math.abs(g.r) < tiny && Math.abs(g0.r) >= tiny) return true;
    if (g.kind === "arc" && g0.kind === "arc" && len(after, g.c, g.s) < tiny && len(before, g.c, g.s) >= tiny) return true;
  }
  return false;
}

export function toPrimitives(doc: SketchDoc): Primitive[] {
  const prims: Primitive[] = [];
  for (const p of Object.values(doc.points)) {
    prims.push({ id: p.id, type: "point", x: p.x, y: p.y, fixed: false });
  }
  for (const g of Object.values(doc.geoms)) {
    if (g.kind === "line") prims.push({ id: g.id, type: "line", p1_id: g.p1, p2_id: g.p2 });
    else if (g.kind === "circle") prims.push({ id: g.id, type: "circle", c_id: g.c, radius: g.r });
    else {
      const c = doc.points[g.c], s = doc.points[g.s], e = doc.points[g.e];
      let a0 = angleOf({ x: s.x - c.x, y: s.y - c.y });
      let a1 = angleOf({ x: e.x - c.x, y: e.y - c.y });
      if (a1 <= a0) a1 += 2 * Math.PI;
      prims.push({
        id: g.id,
        type: "arc",
        c_id: g.c,
        start_id: g.s,
        end_id: g.e,
        radius: arcRadius(doc, g),
        start_angle: a0,
        end_angle: a1,
      });
      prims.push({ id: `${g.id}#rules`, type: "arc_rules", a_id: g.id });
    }
  }
  for (const c of Object.values(doc.constraints)) {
    const def = constraintTypes.find(c.type);
    // A watched dimension only measures.
    if (def && !c.data?.watch) prims.push(...def.toPrimitives(doc, c));
  }
  return prims;
}

function readBack(doc: SketchDoc, w: GcsWrapper): void {
  for (const prim of w.sketch_index.get_primitives() as unknown as Primitive[]) {
    if (prim.type === "point") {
      const p = doc.points[prim.id];
      if (p) {
        p.x = prim.x as number;
        p.y = prim.y as number;
      }
    } else if (prim.type === "circle") {
      const g = doc.geoms[prim.id];
      if (g?.kind === "circle") g.r = prim.radius as number;
    }
  }
}
