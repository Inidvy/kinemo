import { Registry } from "../core/registry";
import type { ConstraintType } from "./types";
import { coincident, onCurve } from "./defs/coincident";
import { horizontal, vertical } from "./defs/orientation";
import { parallel, perpendicular, tangent, equal, concentric, midpoint, symmetric, fix, groundPoint } from "./defs/relations";
import { distance, angle, diameter, radius } from "./defs/dimensions";

export const constraintTypes = new Registry<ConstraintType>("constraints");

// Toolbar order follows registration order.
[
  coincident,
  onCurve,
  horizontal,
  vertical,
  parallel,
  perpendicular,
  tangent,
  equal,
  midpoint,
  concentric,
  symmetric,
  fix,
  groundPoint,
  distance,
  angle,
  diameter,
  radius,
].forEach((c) => constraintTypes.register(c));

export type { ConstraintType } from "./types";
