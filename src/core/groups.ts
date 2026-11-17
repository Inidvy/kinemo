import type { Id } from "./model";

/** Ids joined into groups, directly or through others (a with b, b with c: one group). */
export class Groups {
  private root = new Map<Id, Id>();
  private seen = new Set<Id>();

  /** The id that stands for x's group: the same for every member. */
  find(x: Id): Id {
    const r = this.root.get(x) ?? x;
    if (r === x) return x;
    const top = this.find(r);
    this.root.set(x, top);
    return top;
  }

  join(a: Id, b: Id): void {
    this.seen.add(a).add(b);
    const x = this.find(a), y = this.find(b);
    if (x !== y) this.root.set(x, y);
  }

  /** Every group among the joined ids and `also`; an id joined to nothing is a group of its own. */
  all(also: Iterable<Id> = []): Id[][] {
    const groups = new Map<Id, Id[]>();
    for (const id of new Set([...this.seen, ...also])) {
      const r = this.find(id);
      const g = groups.get(r);
      if (g) g.push(id);
      else groups.set(r, [id]);
    }
    return [...groups.values()];
  }
}
