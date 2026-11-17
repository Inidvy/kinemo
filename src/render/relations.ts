import type { Id, SketchDoc } from "../core/model";
import { Groups } from "../core/groups";

/** Colours for relation groups: distinct from free blue, selection orange and conflict red. */
const PALETTE = ["#2e9d4f", "#8e44ad", "#d81b60", "#0b8a7a", "#b8860b", "#6b4fd8", "#00838f", "#c2185b", "#558b2f", "#795548"];

/** Each geometry's group colour, for one relation type such as equal or parallel. */
export type GroupColors = Map<Id, string>;

/**
 * Groups of geometry tied together, directly or through others, by one
 * relation (equal or parallel), each group in its own colour. Lines in no
 * group are left out.
 */
export function relationGroups(doc: SketchDoc, type: string, offset = 0): GroupColors {
  const tied = new Groups();
  for (const c of Object.values(doc.constraints)) {
    if (c.type !== type || c.refs.length < 2) continue;
    for (const r of c.refs.slice(1)) tied.join(c.refs[0], r);
  }
  // Order groups by their first geometry so colours stay put while you edit.
  const sorted = tied.all().map((m) => m.sort()).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const out: GroupColors = new Map();
  sorted.forEach((members, i) => members.forEach((id) => doc.geoms[id] && out.set(id, PALETTE[(i + offset) % PALETTE.length])));
  return out;
}
