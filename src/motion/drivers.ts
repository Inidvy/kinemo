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

/** A key or key combination ("1 + arrowleft") as shown on a key button. */
export function keyName(k: string | undefined): string {
  if (!k) return "–";
  return k
    .split(" + ")
    .map((p) => NAMES[p] ?? (p.length === 1 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1)))
    .join(" + ");
}
