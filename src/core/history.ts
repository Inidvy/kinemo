import { cloneDoc, type SketchDoc } from "./model";

/**
 * Snapshot-based undo/redo. Every change is applied through `commit`, which
 * records the document as it was before. Features never implement undo
 * themselves.
 */
export class History {
  private past: string[] = [];
  private future: string[] = [];
  private readonly limit = 200;

  constructor(private doc: SketchDoc) {}

  get current(): SketchDoc {
    return this.doc;
  }

  /** Apply a change. `mutate` edits a copy; the copy becomes current. */
  commit(mutate: (doc: SketchDoc) => void): SketchDoc {
    const before = JSON.stringify(this.doc);
    const next = cloneDoc(this.doc);
    mutate(next);
    if (JSON.stringify(next) === before) return this.doc;
    this.pushPast(before);
    this.doc = next;
    return next;
  }

  /** Record a change that was already made live (for example a drag). */
  record(before: SketchDoc, after: SketchDoc): void {
    const b = JSON.stringify(before);
    if (b === JSON.stringify(after)) return;
    this.pushPast(b);
    this.doc = after;
  }

  /** Replace the document without recording history (live previews). */
  replace(doc: SketchDoc): void {
    this.doc = doc;
  }

  reset(doc: SketchDoc): void {
    this.doc = doc;
    this.past = [];
    this.future = [];
  }

  undo(): boolean {
    const prev = this.past.pop();
    if (prev === undefined) return false;
    this.future.push(JSON.stringify(this.doc));
    this.doc = JSON.parse(prev);
    return true;
  }

  redo(): boolean {
    const next = this.future.pop();
    if (next === undefined) return false;
    this.past.push(JSON.stringify(this.doc));
    this.doc = JSON.parse(next);
    return true;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  private pushPast(s: string): void {
    this.past.push(s);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  }
}
