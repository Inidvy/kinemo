import { History } from "../core/history";
import { cloneDoc, emptyDoc, type Id, type SketchDoc } from "../core/model";
import type { DragTarget, Solver } from "../solver/solver";
import { View } from "../render/view";
import { constraintTypes } from "../constraints";
import { t } from "../i18n";

export interface Analysis {
  dof: number;
  free: Set<Id>;
  freeRadii: Set<Id>;
  conflicting: Set<Id>;
}

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
  analysis: Analysis = { dof: 0, free: new Set(), freeRadii: new Set(), conflicting: new Set() };

  private listeners = new Set<() => void>();
  private analysisTimer = 0;

  constructor(readonly solver: Solver, doc: SketchDoc = emptyDoc()) {
    this.history = new History(doc);
    this.reanalyse();
  }

  get doc(): SketchDoc {
    return this.history.current;
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
    const r = this.solver.solve(next);
    // With conflicting constraints the solver may find a degenerate answer
    // (a line collapsed to a point). Keep the geometry as drawn and show the
    // conflict in red instead, like Onshape.
    const clean = r.ok && r.conflicting.length === 0 && r.redundant.length === 0;
    this.history.record(before, clean ? r.doc : next);
    this.pruneSelection();
    this.reanalyse();
    this.emit();
  }

  /** Live preview during a drag; call `endDrag` to make it undoable. */
  private dragStart: SketchDoc | null = null;

  beginDrag(): void {
    this.dragStart = this.doc;
  }

  drag(targets: DragTarget[]): void {
    const r = this.solver.solve(this.doc, targets);
    if (r.ok) this.history.replace(r.doc);
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
      if (!(id in d.points || id in d.geoms || id in d.constraints)) this.selection.delete(id);
    }
  }

  /** Work out which geometry is still free; runs after the UI has updated. */
  private reanalyse(): void {
    clearTimeout(this.analysisTimer);
    this.analysisTimer = window.setTimeout(() => {
      const doc = this.doc;
      const r = this.solver.solve(doc);
      this.analysis = {
        dof: r.dof,
        free: this.solver.freePoints(doc),
        freeRadii: this.solver.freeRadii(doc),
        conflicting: new Set([...r.conflicting, ...r.redundant]),
      };
      this.emit();
    }, 30);
  }
}
