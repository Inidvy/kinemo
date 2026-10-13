import type { Constraint, Id, SketchDoc, Vec } from "../core/model";
import { constraintTypes } from "../constraints";
import type { DimensionShape } from "../constraints/types";
import { add, dot, mid, norm, perp, sub } from "../core/geom";
import type { View } from "./view";

export const ICON = 18;

export interface IconBox {
  cid: Id;
  x: number;
  y: number;
  glyph: string;
  type: string;
}

/**
 * Screen positions of constraint icons. Icons that share an anchor are lined
 * up next to each other so they never overlap. Used by both drawing and
 * hit-testing so they always agree.
 */
export function layoutIcons(doc: SketchDoc, view: View): IconBox[] {
  const groups = new Map<string, { at: Vec; items: Constraint[] }>();
  for (const c of Object.values(doc.constraints)) {
    const def = constraintTypes.find(c.type);
    if (!def?.anchor || def.dimension) continue;
    const at = view.toScreen(def.anchor(doc, c));
    const key = `${Math.round(at.x / 6)},${Math.round(at.y / 6)}`;
    const g = groups.get(key) ?? { at, items: [] };
    g.items.push(c);
    groups.set(key, g);
  }
  const out: IconBox[] = [];
  for (const { at, items } of groups.values()) {
    items.forEach((c, i) => {
      out.push({ cid: c.id, x: at.x + 8 + i * (ICON + 2), y: at.y - 8 - ICON, glyph: constraintTypes.get(c.type).glyph, type: c.type });
    });
  }
  return out;
}

export interface DimLayout {
  cid: Id;
  shape: DimensionShape;
  /** World anchor the label offset is measured from. */
  anchor: Vec;
  /** World position of the value text. */
  text: Vec;
  label: string;
}

/** Natural anchor of a dimension: label offsets are relative to it. */
export function dimAnchor(shape: DimensionShape): Vec {
  if (shape.kind === "linear") return mid(shape.a, shape.b);
  return shape.center;
}

/** Where a new dimension's label goes before the user moves it. */
export function defaultLabel(shape: DimensionShape, view: View): Vec {
  const d = view.px(28);
  if (shape.kind === "linear") {
    const n = perp(norm(sub(shape.b, shape.a)));
    return { x: n.x * d, y: n.y * d };
  }
  if (shape.kind === "angle") {
    let sweep = shape.d2 - shape.d1;
    while (sweep <= -Math.PI) sweep += 2 * Math.PI;
    while (sweep > Math.PI) sweep -= 2 * Math.PI;
    const a = shape.d1 + sweep / 2;
    const r = view.px(40);
    return { x: Math.cos(a) * r, y: Math.sin(a) * r };
  }
  const r = shape.r + d;
  return { x: r * Math.SQRT1_2, y: r * Math.SQRT1_2 };
}

/** A watched dimension only measures: it doesn't drive the sketch. */
export const isWatched = (c: Constraint): boolean => !!c.data?.watch;

/** What a dimension measures now, from its drawn shape (mm or degrees). */
export function measured(shape: DimensionShape): number {
  if (shape.kind === "linear") return Math.hypot(shape.b.x - shape.a.x, shape.b.y - shape.a.y);
  if (shape.kind === "radial") return shape.diameter ? shape.r * 2 : shape.r;
  let sweep = shape.d2 - shape.d1;
  while (sweep <= -Math.PI) sweep += 2 * Math.PI;
  while (sweep > Math.PI) sweep -= 2 * Math.PI;
  return (Math.abs(sweep) * 180) / Math.PI;
}

/** The value a dimension shows: its set value, or for a watched one what it measures, in brackets. */
export function dimText(doc: SketchDoc, c: Constraint): string {
  const def = constraintTypes.get(c.type);
  if (!isWatched(c) || !def.shape) return formatValue(c);
  return `(${formatValue(c, measured(def.shape(doc, c)))})`;
}

export function formatValue(c: Constraint, value = c.value ?? 0): string {
  const def = constraintTypes.get(c.type);
  const v = value.toFixed(2).replace(/\.?0+$/, "");
  if (def.unit === "deg") return `${v}°`;
  if (c.type === "diameter") return `Ø${v}`;
  if (c.type === "radius") return `R${v}`;
  return v;
}

export function layoutDims(doc: SketchDoc, view: View, onlyWatched = false): DimLayout[] {
  const out: DimLayout[] = [];
  for (const c of Object.values(doc.constraints)) {
    const def = constraintTypes.find(c.type);
    if (!def?.dimension || !def.shape) continue;
    if (onlyWatched && !isWatched(c)) continue;
    const shape = def.shape(doc, c);
    const anchor = dimAnchor(shape);
    const label = c.label ?? defaultLabel(shape, view);
    out.push({ cid: c.id, shape, anchor, text: add(anchor, label), label: dimText(doc, c) });
  }
  return out;
}

/** Signed offset of a linear dimension line from the measured segment. */
export function linearOffset(shape: Extract<DimensionShape, { kind: "linear" }>, text: Vec): number {
  const n = perp(norm(sub(shape.b, shape.a)));
  return dot(sub(text, mid(shape.a, shape.b)), n);
}
