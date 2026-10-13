// The document is plain data: no UI code, no solver objects. Everything that
// changes it goes through commands (see history.ts) so undo and autosave work
// for every feature automatically.

export type Id = string;

export interface Vec {
  x: number;
  y: number;
}

export interface Point extends Vec {
  id: Id;
}

interface GeomBase {
  id: Id;
  /** Construction geometry: drawn dashed, never becomes a bar. */
  construction?: boolean;
  /** Track geometry: a path a slider may run along (used in Motion mode). */
  track?: boolean;
}

export interface Line extends GeomBase {
  kind: "line";
  p1: Id;
  p2: Id;
}

export interface Circle extends GeomBase {
  kind: "circle";
  c: Id;
  r: number;
}

/** Counter-clockwise arc from s to e around c. Radius follows |s - c|. */
export interface Arc extends GeomBase {
  kind: "arc";
  c: Id;
  s: Id;
  e: Id;
}

export type Geometry = Line | Circle | Arc;
export type GeomKind = Geometry["kind"];

export interface Constraint {
  id: Id;
  /** Key into the constraint registry. */
  type: string;
  /** Referenced point or geometry ids; meaning depends on the type. */
  refs: Id[];
  /** Dimension value (mm, or degrees for angles). */
  value?: number;
  /** Where a dimension label sits, as an offset from its natural anchor. */
  label?: Vec;
  /** Extra numbers a constraint type needs (for example a fixed position). */
  data?: Record<string, number>;
}

export interface Settings {
  barWidth: number;
  showConstraintIcons: boolean;
  /** Draw bars solid instead of see-through in Sketch mode. */
  solidBars: boolean;
}

/** A rigid group of sketch geometry. In Motion mode it moves as one bar. */
export interface Body {
  id: Id;
  name: string;
  /** Geometry (and loose point) ids that belong to the body. */
  members: Id[];
  /** Ground bodies never move. */
  ground?: boolean;
  /** Bar colour (hex); picked from the palette by default. */
  color?: string;
}

/** Where a body is in Motion mode: rotation `a` (radians) about the origin, then shift by (x, y). */
export interface Pose {
  x: number;
  y: number;
  a: number;
}

/** A slider the user drives: the motion of body `b` relative to body `a` at a joint. */
export interface Driver {
  id: Id;
  /** The joint, which is the id of the sketch constraint that makes it. */
  joint: Id;
  a: Id;
  b: Id;
  /** Keys that move the slider down and up while held (KeyboardEvent.key, lower case). */
  keys?: [string, string];
}

/** A slider value at a time on the timeline. */
export interface Keyframe {
  /** Seconds from the start of the clip. */
  t: number;
  v: number;
  /** The segment from this key to the next runs at a steady speed instead of easing. */
  linear?: boolean;
}

export interface Timeline {
  /** Clip length in seconds. */
  length: number;
  mode: "once" | "loop" | "pingpong";
  /** Keyframes per slider, in time order. */
  keys: Record<Id, Keyframe[]>;
}

export interface MotionState {
  /** Missing bodies sit where they were sketched. */
  poses: Record<Id, Pose>;
  drivers: Record<Id, Driver>;
  /** Points whose path is drawn in Motion mode. */
  traces?: Id[];
  timeline?: Timeline;
}

export interface SketchDoc {
  version: number;
  points: Record<Id, Point>;
  geoms: Record<Id, Geometry>;
  constraints: Record<Id, Constraint>;
  nextId: number;
  settings: Settings;
  bodies: Record<Id, Body>;
  motion: MotionState;
}

export const DOC_VERSION = 2;

export function emptyDoc(): SketchDoc {
  return {
    version: DOC_VERSION,
    points: {},
    geoms: {},
    constraints: {},
    nextId: 1,
    settings: { barWidth: 8, showConstraintIcons: true, solidBars: false },
    bodies: {},
    motion: { poses: {}, drivers: {} },
  };
}

export function newId(doc: SketchDoc, prefix: string): Id {
  return `${prefix}${doc.nextId++}`;
}

export function addPoint(doc: SketchDoc, x: number, y: number): Id {
  const id = newId(doc, "p");
  doc.points[id] = { id, x, y };
  return id;
}

export function addGeom<G extends Geometry>(doc: SketchDoc, g: Omit<G, "id">): Id {
  const id = newId(doc, "g");
  doc.geoms[id] = { ...g, id } as G;
  return id;
}

export function addConstraint(doc: SketchDoc, c: Omit<Constraint, "id">): Id {
  const id = newId(doc, "c");
  doc.constraints[id] = { ...c, id };
  return id;
}

/** Point ids a geometry is built from. */
export function geomPoints(g: Geometry): Id[] {
  switch (g.kind) {
    case "line":
      return [g.p1, g.p2];
    case "circle":
      return [g.c];
    case "arc":
      return [g.c, g.s, g.e];
  }
}

export function arcRadius(doc: SketchDoc, a: Arc): number {
  const c = doc.points[a.c];
  const s = doc.points[a.s];
  return Math.hypot(s.x - c.x, s.y - c.y);
}

export function isPoint(doc: SketchDoc, id: Id): boolean {
  return id in doc.points;
}

export function kindOf(doc: SketchDoc, id: Id): "point" | GeomKind | undefined {
  if (id in doc.points) return "point";
  return doc.geoms[id]?.kind;
}

/**
 * Delete points, geometry or constraints, cascading to everything that
 * depends on them (a point takes its geometry, geometry takes its constraints).
 */
export function deleteItems(doc: SketchDoc, ids: Id[]): void {
  const pointIds = new Set(ids.filter((id) => id in doc.points));
  const geomIds = new Set(ids.filter((id) => id in doc.geoms));
  for (const id of ids) delete doc.constraints[id];

  for (const g of Object.values(doc.geoms)) {
    if (geomPoints(g).some((p) => pointIds.has(p))) geomIds.add(g.id);
  }
  // Points used only by removed geometry go too.
  const stillUsed = new Set<Id>();
  for (const g of Object.values(doc.geoms)) {
    if (!geomIds.has(g.id)) geomPoints(g).forEach((p) => stillUsed.add(p));
  }
  for (const gid of geomIds) {
    const g = doc.geoms[gid];
    if (!g) continue;
    for (const p of geomPoints(g)) if (!stillUsed.has(p)) pointIds.add(p);
    delete doc.geoms[gid];
  }
  for (const pid of pointIds) delete doc.points[pid];

  const gone = new Set([...pointIds, ...geomIds]);
  for (const c of Object.values(doc.constraints)) {
    if (c.refs.some((r) => gone.has(r))) delete doc.constraints[c.id];
  }
  for (const id of ids) delete doc.bodies[id];
  for (const id of ids) delete doc.motion.drivers[id];
  pruneBodies(doc);
}

/** Drop body members, empty bodies, poses and drivers that point at things that are gone. */
export function pruneBodies(doc: SketchDoc): void {
  for (const b of Object.values(doc.bodies)) {
    b.members = b.members.filter((id) => id in doc.geoms || id in doc.points);
    if (!b.members.length) delete doc.bodies[b.id];
  }
  for (const id of Object.keys(doc.motion.poses)) if (!doc.bodies[id]) delete doc.motion.poses[id];
  for (const d of Object.values(doc.motion.drivers)) {
    if (!doc.constraints[d.joint] || !doc.bodies[d.a] || !doc.bodies[d.b]) delete doc.motion.drivers[d.id];
  }
  const keys = doc.motion.timeline?.keys;
  if (keys) for (const id of Object.keys(keys)) if (!doc.motion.drivers[id]) delete keys[id];
  if (doc.motion.traces) doc.motion.traces = doc.motion.traces.filter((id) => id in doc.points);
}

export function cloneDoc(doc: SketchDoc): SketchDoc {
  return structuredClone(doc);
}
