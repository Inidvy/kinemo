import { History } from "../core/history";
import { cloneDoc, emptyDoc, type Id, type SketchDoc } from "../core/model";
import { Mechanism, type MotionDrag } from "../motion/kinematics";
import { degenerate, Solver, type DragTarget } from "../solver/solver";
import { View } from "../render/view";
import { constraintTypes } from "../constraints";
import { t } from "../i18n";

export interface Analysis {
  dof: number;
  free: Set<Id>;
  freeRadii: Set<Id>;
  /** Every constraint drawn red: the culprits plus the other fixes. */
  conflicting: Set<Id>;
  /** The most recently added or edited constraints that cause the over-constraint (dark red). */
  culprits: Set<Id>;
  /** Other constraints whose removal would also fix it (light red). */
  fixes: Set<Id>;
  /** The sketch can't be solved with all its constraints. */
  over: boolean;
  /** Degrees of freedom of the mechanism (Motion mode). */
  mechDof: number;
}

const emptyAnalysis = (): Analysis => ({ dof: 0, free: new Set(), freeRadii: new Set(), conflicting: new Set(), culprits: new Set(), fixes: new Set(), over: false, mechDof: 0 });

export type Mode = "sketch" | "motion";

/**
 * Holds the app state and is the one place that changes the document.
 * UI parts subscribe and re-render on change.
 */
export class Editor {
  readonly history: History;
  readonly view = new View();
  selection = new Set<Id>();
  hover: Id | null = null;
  tool = "select";
  mode: Mode = "sketch";
  message = "";
  /** Set by the UI: open the value editor for a dimension. */
  onEditDimension?: (cid: Id) => void;
  analysis: Analysis = emptyAnalysis();
  /** Constraints added or edited by the latest change: the suspects when the sketch becomes over-constrained. */
  recent = new Set<Id>();

  private listeners = new Set<() => void>();
  private analysisTimer = 0;

  constructor(readonly solver: Solver, doc: SketchDoc = emptyDoc()) {
    this.history = new History(doc);
    this.reanalyse();
  }

  get doc(): SketchDoc {
    return this.history.current;
  }

  private mechCache: { doc: SketchDoc; mech: Mechanism } | null = null;

  /** The mechanism for the current document (bodies, joints, poses). */
  get mech(): Mechanism {
    if (this.mechCache?.doc !== this.doc) this.mechCache = { doc: this.doc, mech: new Mechanism(this.doc) };
    return this.mechCache.mech;
  }

  /** Switch between Sketch and Motion mode. */
  setMode(mode: Mode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.selection.clear();
    this.hover = null;
    if (mode === "motion") {
      // Put the mechanism together: the sketch may have changed since last time.
      const q = this.mech.assemble();
      const poses = this.mech.poses(q);
      this.live((doc) => (doc.motion.poses = poses));
    }
    this.reanalyse();
    this.emit();
  }

  /** Pull a body point towards the cursor (Motion mode). Stays put if the joints don't allow it. */
  motionDrag(drag: MotionDrag): void {
    const m = this.mech;
    const q = m.solve({ drag, maxTurn: 0.8 });
    if (q) this.live((doc) => (doc.motion.poses = m.poses(q)));
  }

  /** Move a slider; the mechanism follows as far as it can. */
  driveSlider(driverId: Id, value: number): void {
    const d = this.doc.motion.drivers[driverId];
    if (!d) return;
    const m = this.mech;
    const others = Object.values(this.doc.motion.drivers).map((x) => x.joint);
    const r = m.driveTo(d.joint, value, others);
    this.live((doc) => (doc.motion.poses = m.poses(r.q)));
  }

  /** Switch to the other way the mechanism can be assembled. */
  flip(): boolean {
    const m = this.mech;
    const q = m.flip(Object.values(this.doc.motion.drivers));
    if (!q) return false;
    this.change((doc) => (doc.motion.poses = m.poses(q)));
    return true;
  }

  /** Put every body back where it was sketched. */
  resetPose(): void {
    this.change((doc) => (doc.motion.poses = {}));
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(): void {
    for (const fn of this.listeners) fn();
  }

  /** Make an undoable change, then solve. */
  change(mutate: (doc: SketchDoc) => void): void {
    const before = this.doc;
    const next = cloneDoc(before);
    mutate(next);
    const touched = changedConstraints(before, next);
    if (touched.size) this.recent = touched;
    else for (const id of [...this.recent]) if (!(id in next.constraints)) this.recent.delete(id);
    const r = this.solver.solve(next);
    let result = next;
    if (Solver.clean(r)) result = r.doc;
    else {
      // Over-constrained is allowed: solve everything except the newest
      // constraints so the rest of the sketch keeps behaving, and show the
      // problem in red. If that doesn't help, keep the geometry as drawn
      // rather than accept a degenerate answer (a line collapsed to a point).
      const rest = this.solver.solveWithout(next, this.ignored(next));
      if (Solver.clean(rest)) result = rest.doc;
    }
    this.history.record(before, result);
    this.pruneSelection();
    this.reanalyse();
    this.emit();
  }

  /** Constraints left out of solving while the sketch is over-constrained. */
  private ignored(doc: SketchDoc): Id[] {
    const rec = [...this.recent].filter((id) => id in doc.constraints);
    if (rec.length) return rec;
    return [...this.analysis.conflicting].filter((id) => id in doc.constraints);
  }

  /** Live preview during a drag; call `endDrag` to make it undoable. */
  private dragStart: SketchDoc | null = null;

  beginDrag(): void {
    this.dragStart = this.doc;
  }

  drag(targets: DragTarget[]): void {
    const doc = this.doc;
    const r = this.analysis.over ? this.solver.solveWithout(doc, this.ignored(doc), targets) : this.solver.solve(doc, targets);
    // Skip steps where the solver escapes into a collapsed or exploded
    // answer, or into a pose where constraints become dependent: the sketch
    // stays at its last good pose instead of turning red.
    if (r.ok && !degenerate(doc, r.doc) && (this.analysis.over || Solver.clean(this.solver.solve(r.doc)))) this.history.replace(r.doc);
    this.emit();
  }

  /** Change the live document without solving (for example moving a label). */
  live(mutate: (doc: SketchDoc) => void): void {
    const next = cloneDoc(this.doc);
    mutate(next);
    this.history.replace(next);
    this.emit();
  }

  endDrag(): void {
    if (this.dragStart) this.history.record(this.dragStart, this.doc);
    this.dragStart = null;
    this.reanalyse();
    this.emit();
  }

  get dragging(): boolean {
    return this.dragStart !== null;
  }

  undo(): void {
    if (this.history.undo()) this.afterLoad();
  }

  redo(): void {
    if (this.history.redo()) this.afterLoad();
  }

  load(doc: SketchDoc): void {
    this.history.reset(doc);
    this.recent.clear();
    this.selection.clear();
    this.afterLoad();
  }

  private afterLoad(): void {
    this.pruneSelection();
    this.reanalyse();
    this.emit();
  }

  setTool(id: string): void {
    this.tool = id;
    this.emit();
  }

  select(ids: Id[], additive = false): void {
    if (!additive) this.selection.clear();
    for (const id of ids) {
      if (additive && this.selection.has(id)) this.selection.delete(id);
      else this.selection.add(id);
    }
    this.emit();
  }

  /** Apply a constraint type to the current selection. */
  applyConstraint(type: string, quiet = false): boolean {
    const def = constraintTypes.get(type);
    const sel = [...this.selection].filter((id) => id in this.doc.points || id in this.doc.geoms);
    const out = def.fromSelection(this.doc, sel);
    if (typeof out === "string") {
      if (!quiet) this.flash(t(out));
      return false;
    }
    this.change((doc) => {
      for (const c of out) {
        const id = `c${doc.nextId++}`;
        doc.constraints[id] = { ...c, id };
      }
    });
    return true;
  }

  flash(msg: string): void {
    this.message = msg;
    this.emit();
    window.setTimeout(() => {
      if (this.message === msg) {
        this.message = "";
        this.emit();
      }
    }, 3500);
  }

  private pruneSelection(): void {
    const d = this.doc;
    for (const id of [...this.selection]) {
      if (!(id in d.points || id in d.geoms || id in d.constraints || id in d.bodies || id in d.motion.drivers)) this.selection.delete(id);
    }
  }

  /** Work out which geometry is still free; runs after the UI has updated. */
  private reanalyse(): void {
    clearTimeout(this.analysisTimer);
    this.analysisTimer = window.setTimeout(() => {
      const doc = this.doc;
      const r = this.solver.solve(doc);
      const over = !Solver.clean(r);
      let culprits = new Set<Id>();
      let fixes = new Set<Id>();
      let solvable = doc;
      if (over) {
        const all = this.solver.fixes(doc);
        const flagged = all.length ? all : [...new Set([...r.conflicting, ...r.redundant])];
        culprits = new Set(flagged.filter((id) => this.recent.has(id)));
        fixes = new Set(flagged.filter((id) => !culprits.has(id)));
        const skip = culprits.size ? culprits : fixes;
        solvable = { ...doc, constraints: Object.fromEntries(Object.entries(doc.constraints).filter(([id]) => !skip.has(id))) };
      }
      this.analysis = {
        mechDof: this.mode === "motion" ? this.mech.dof() : 0,
        dof: this.solver.solve(solvable).dof,
        free: this.solver.freePoints(solvable),
        freeRadii: this.solver.freeRadii(solvable),
        conflicting: new Set([...culprits, ...fixes]),
        culprits,
        fixes,
        over,
      };
      this.emit();
    }, 30);
  }

  /** Remove the constraints that make the sketch over-constrained (the culprits). */
  removeCulprits(): void {
    const ids = [...this.analysis.culprits];
    if (!ids.length) return;
    this.change((doc) => ids.forEach((id) => delete doc.constraints[id]));
  }
}

/** Constraints that are new in `after` or whose value changed. */
function changedConstraints(before: SketchDoc, after: SketchDoc): Set<Id> {
  const out = new Set<Id>();
  for (const c of Object.values(after.constraints)) {
    const old = before.constraints[c.id];
    if (!old || old.value !== c.value) out.add(c.id);
  }
  return out;
}
