import type { Id, SketchDoc } from "../core/model";

/** Default key pairs for new sliders, in order. */
const DEFAULT_KEYS: [string, string][] = [
  ["arrowleft", "arrowright"],
  ["arrowdown", "arrowup"],
];

/** Add a slider on a joint, with the next free default keys. */
export function addDriver(doc: SketchDoc, joint: Id, a: Id, b: Id): Id {
  const id = `d${doc.nextId++}`;
  const used = new Set(Object.values(doc.motion.drivers).flatMap((d) => d.keys ?? []));
  const keys = DEFAULT_KEYS.find(([lo, hi]) => !used.has(lo) && !used.has(hi));
  doc.motion.drivers[id] = { id, joint, a, b, ...(keys ? { keys: [...keys] as [string, string] } : {}) };
  return id;
}

const NAMES: Record<string, string> = { arrowleft: "←", arrowright: "→", arrowup: "↑", arrowdown: "↓", " ": "Space" };

export function keyName(k: string | undefined): string {
  if (!k) return "–";
  return NAMES[k] ?? (k.length === 1 ? k.toUpperCase() : k[0].toUpperCase() + k.slice(1));
}
