/**
 * A named collection of feature definitions. Tools, constraint types and
 * (later) joints, sliders and renderers each have one. Adding a feature means
 * writing one module and registering it; the core never needs editing.
 */
export class Registry<T extends { id: string }> {
  private items = new Map<string, T>();

  constructor(readonly name: string) {}

  register(item: T): T {
    if (this.items.has(item.id)) throw new Error(`${this.name}: duplicate id "${item.id}"`);
    this.items.set(item.id, item);
    return item;
  }

  get(id: string): T {
    const item = this.items.get(id);
    if (!item) throw new Error(`${this.name}: unknown id "${id}"`);
    return item;
  }

  find(id: string): T | undefined {
    return this.items.get(id);
  }

  all(): T[] {
    return [...this.items.values()];
  }
}
