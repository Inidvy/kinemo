import type { Constraint, Id, SketchDoc, Vec } from "../core/model";

/** A planegcs primitive (constraint). Kept loose: the solver adapter checks it. */
export type Primitive = Record<string, unknown> & { id: string; type: string };

export type DimensionShape =
  /** Linear distance between two world points, drawn offset along `normal`. */
  | { kind: "linear"; a: Vec; b: Vec }
  /** Angle at `center` from direction d1 to d2 (radians). */
  | { kind: "angle"; center: Vec; d1: number; d2: number }
  /** Radius or diameter of a circle around `center`. */
  | { kind: "radial"; center: Vec; r: number; diameter: boolean };

export interface ConstraintType {
  id: string;
  /** i18n key for the label. */
  label: string;
  /** Glyph shown on the canvas icon and the toolbar. */
  glyph: string;
  /** Keyboard shortcut (single key, lowercase). */
  shortcut?: string;
  /** Created only by other constraints or tools; no button of its own. */
  hidden?: boolean;
  /** Dimensions show as arrows with a value instead of an icon. */
  dimension?: boolean;
  /** Unit for dimension values. */
  unit?: "mm" | "deg";

  /**
   * Build constraints from the selected points/geometry. Returns the new
   * constraints, or an i18n key explaining what to select.
   */
  fromSelection(doc: SketchDoc, sel: Id[]): Omit<Constraint, "id">[] | string;

  /** Translate to planegcs primitives. Ids must start with `${c.id}#`. */
  toPrimitives(doc: SketchDoc, c: Constraint): Primitive[];

  /** World position for the canvas icon (non-dimension constraints). */
  anchor?(doc: SketchDoc, c: Constraint): Vec;

  /** Shape for drawing a dimension. */
  shape?(doc: SketchDoc, c: Constraint): DimensionShape;
}
