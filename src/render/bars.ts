import type { Editor } from "../app/editor";
import { arcRadius, type Body, type Geometry, type Id, type Pose, type SketchDoc, type Vec } from "../core/model";
import { angleInSweep, angleOf, dist, distToSegment, sub } from "../core/geom";
import { applyPose, bodyColor, bodyGeoms, groundBodies, IDENTITY, isGround, poseOf } from "../motion/bodies";
import { jointKinds, trackDirection, type Joint } from "../motion/joints";
import { colors } from "./style";
import type { View } from "./view";

// Bars, plates, slots and joints. Each body is one light shape with a
// coloured outline: lines become rounded bars, closed loops of lines become
// filled plates, and lines a slider runs along get a slot cut into the bar.
// Joints are small pins; ground pins are dark.

export interface BarStyle {
  /** Draw bodies where they are in Motion mode (otherwise as sketched). */
  posed: boolean;
  alpha: number;
  hover: Id | null;
}

/** Geometry that a slider runs along: drawn with a slot cut into it. */
function slotGeoms(doc: SketchDoc, joints: Joint[]): Set<Id> {
  const out = new Set<Id>();
  for (const j of joints) {
    if (j.kind === "slot") out.add(j.refs[3]);
    if (j.kind === "curveSlot") out.add(j.refs[2]);
    if (j.kind === "track") for (const id of j.refs.slice(1)) out.add(id);
  }
  for (const g of Object.values(doc.geoms)) if (g.track) out.add(g.id);
  return out;
}

/** Trace a body's geometry as a path in screen space, optionally trimmed at both ends (px). */
function tracePath(ctx: CanvasRenderingContext2D, doc: SketchDoc, v: View, pose: Pose, g: Geometry, trim = 0) {
  const P = (id: Id) => v.toScreen(applyPose(pose, doc.points[id]));
  ctx.beginPath();
  if (g.kind === "line") {
    let a = P(g.p1), b = P(g.p2);
    const l = dist(a, b);
    if (trim > 0 && l > 2 * trim + 2) {
      const u = { x: (b.x - a.x) / l, y: (b.y - a.y) / l };
      a = { x: a.x + u.x * trim, y: a.y + u.y * trim };
      b = { x: b.x - u.x * trim, y: b.y - u.y * trim };
    }
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
  } else if (g.kind === "circle") {
    const c = P(g.c);
    ctx.arc(c.x, c.y, g.r * v.zoom, 0, Math.PI * 2);
  } else {
    const c = P(g.c);
    const r = arcRadius(doc, g) * v.zoom;
    const cut = trim > 0 ? trim / r : 0;
    const a0 = angleOf(sub(doc.points[g.s], doc.points[g.c])) + pose.a + cut;
    const a1 = angleOf(sub(doc.points[g.e], doc.points[g.c])) + pose.a - cut;
    ctx.arc(c.x, c.y, r, -a0, -a1, true);
  }
}

/** Closed loops of lines in a body (a triangle, a quad...), as polygons in sketch coordinates. */
export function bodyLoops(doc: SketchDoc, b: Body): Vec[][] {
  const key = (p: Vec) => `${p.x.toFixed(4)},${p.y.toFixed(4)}`;
  const pos = new Map<string, Vec>();
  const adj = new Map<string, string[]>();
  const edges: [string, string][] = [];
  for (const g of bodyGeoms(doc, b)) {
    if (g.kind !== "line" || g.construction) continue;
    const a = doc.points[g.p1], c = doc.points[g.p2];
    const ka = key(a), kc = key(c);
    if (ka === kc) continue;
    pos.set(ka, a);
    pos.set(kc, c);
    edges.push([ka, kc]);
    adj.set(ka, [...(adj.get(ka) ?? []), kc]);
    adj.set(kc, [...(adj.get(kc) ?? []), ka]);
  }
  // Each edge left out of a spanning tree closes one loop.
  const parent = new Map<string, string | null>();
  const depth = new Map<string, number>();
  const treeEdges = new Set<string>();
  for (const root of adj.keys()) {
    if (parent.has(root)) continue;
    parent.set(root, null);
    depth.set(root, 0);
    const queue = [root];
    while (queue.length) {
      const u = queue.shift()!;
      for (const w of adj.get(u)!) {
        if (parent.has(w)) continue;
        parent.set(w, u);
        depth.set(w, depth.get(u)! + 1);
        treeEdges.add(`${u}|${w}`);
        queue.push(w);
      }
    }
  }
  const loops: Vec[][] = [];
  const seen = new Set<string>();
  for (const [a, c] of edges) {
    if (treeEdges.has(`${a}|${c}`) || treeEdges.has(`${c}|${a}`)) {
      // A tree edge, unless it's a duplicate we've already used once.
      const k = a < c ? `${a}|${c}` : `${c}|${a}`;
      if (!seen.has(k)) {
        seen.add(k);
        continue;
      }
    }
    let x: string = a, y: string = c;
    const left: string[] = [], right: string[] = [];
    while (x !== y) {
      if (depth.get(x)! >= depth.get(y)!) {
        left.push(x);
        x = parent.get(x)!;
      } else {
        right.push(y);
        y = parent.get(y)!;
      }
    }
    const cycle = [...left, x, ...right.reverse()];
    if (cycle.length >= 3) loops.push(cycle.map((k) => pos.get(k)!));
  }
  return loops;
}

/** Fill opacity of a body: see-through, so overlapping bodies stay readable. */
const FILL_ALPHA = 0.32;

/** Width of a slot, which is also the size of a pin. */
function slotWidth(doc: SketchDoc, v: View): number {
  return Math.max(5, doc.settings.barWidth * v.zoom * 0.45);
}

// Bodies are drawn as filled outlines rather than strokes, so all parts of a
// body can be filled in one go: one fill of many same-way-round shapes is
// their union, so overlaps don't darken. Everything stays on the main canvas.

type Poly = Vec[];
/** One part of a body's shape: a bar, a band, a plate. A ring is two polygons. */
type Part = Poly[];

const signedArea = (p: Poly) => {
  let s = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) s += (p[j].x - p[i].x) * (p[j].y + p[i].y);
  return s;
};
const orient = (p: Poly, sign = 1): Poly => (signedArea(p) * sign < 0 ? p.reverse() : p);

/** Points along an arc from angle a0 to a1 (screen angles), appended to out. */
function arcPts(out: Poly, c: Vec, r: number, a0: number, a1: number) {
  const n = Math.max(2, Math.min(96, Math.ceil((Math.abs(a1 - a0) * Math.max(r, 1)) / 3)));
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    out.push({ x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r });
  }
}

const disc = (c: Vec, h: number): Part => {
  const p: Poly = [];
  arcPts(p, c, h, 0, Math.PI * 2);
  p.pop();
  return [orient(p)];
};

/** The outline of a geometry drawn at a given width, in screen coordinates. */
function geomPart(doc: SketchDoc, v: View, pose: Pose, g: Geometry, width: number): Part {
  const h = width / 2;
  const P = (id: Id) => v.toScreen(applyPose(pose, doc.points[id]));
  if (g.kind === "line") {
    const a = P(g.p1), b = P(g.p2);
    if (dist(a, b) < 1e-6) return disc(a, h);
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const p: Poly = [];
    arcPts(p, b, h, ang - Math.PI / 2, ang + Math.PI / 2);
    arcPts(p, a, h, ang + Math.PI / 2, ang + (3 * Math.PI) / 2);
    return [orient(p)];
  }
  const c = P(g.c);
  if (g.kind === "circle") {
    const r = g.r * v.zoom;
    const outer: Poly = [];
    arcPts(outer, c, r + h, 0, Math.PI * 2);
    outer.pop();
    if (r - h <= 0) return [orient(outer)];
    const inner: Poly = [];
    arcPts(inner, c, r - h, 0, Math.PI * 2);
    inner.pop();
    return [orient(outer), orient(inner, -1)];
  }
  // An arc: a band with round ends. The sketch angle a is screen angle -a.
  const r = arcRadius(doc, g) * v.zoom;
  const s = -(angleOf(sub(doc.points[g.e], doc.points[g.c])) + pose.a);
  let e = -(angleOf(sub(doc.points[g.s], doc.points[g.c])) + pose.a);
  while (e <= s) e += Math.PI * 2;
  const end = { x: c.x + Math.cos(e) * r, y: c.y + Math.sin(e) * r };
  const start = { x: c.x + Math.cos(s) * r, y: c.y + Math.sin(s) * r };
  const p: Poly = [];
  arcPts(p, c, r + h, s, e);
  arcPts(p, end, h, e, e + Math.PI);
  if (r - h > 0) arcPts(p, c, r - h, e, s);
  else p.push(c);
  arcPts(p, start, h, s + Math.PI, s + Math.PI * 2);
  return [orient(p)];
}

function addPolys(path: Path2D, polys: Poly[]) {
  for (const p of polys) {
    path.moveTo(p[0].x, p[0].y);
    for (let i = 1; i < p.length; i++) path.lineTo(p[i].x, p[i].y);
    path.closePath();
  }
}

/** Limit drawing to outside a part: a clip of the whole canvas with the part cut out. */
function clipOutside(ctx: CanvasRenderingContext2D, part: Part) {
  const path = new Path2D();
  path.rect(-1e5, -1e5, 2e5, 2e5);
  addPolys(path, part);
  ctx.clip(path, "evenodd");
}

// ------------------------------------------------------------------ gears

/** How a gear or rack is drawn, in its body's sketch frame. */
interface Teeth {
  /** Tooth size (module): teeth stick out this far past the pitch circle or line. */
  m: number;
  /** Gear: number of teeth and the angle of one tooth. Rack: distance along the line of one tooth. */
  n: number;
  phase: number;
  /** Ring gear (teeth inward), or for a rack which side the teeth are on (+1 left of the line). */
  internal?: boolean;
  side?: number;
}

/** Teeth for every circle that meshes as a gear and every line that is a rack. */
function teethFor(doc: SketchDoc, joints: Joint[]): Map<Id, Teeth> {
  const out = new Map<Id, Teeth>();
  const m0 = Math.max(0.5, doc.settings.barWidth * 0.25);
  // The first mesh a gear is in sets where its teeth are; `toothAt` gets the
  // angle between two teeth.
  const gear = (gid: Id, r: number, toothAt: (tau: number) => number, internal = false) => {
    if (out.has(gid)) return out.get(gid)!;
    const n = Math.max(6, Math.round((2 * r) / m0));
    const t: Teeth = { m: (2 * r) / n, n, phase: toothAt((Math.PI * 2) / n), internal };
    out.set(gid, t);
    return t;
  };
  for (const j of joints) {
    if (j.kind === "gear") {
      const [ra, rb, internal, , phi] = j.data!;
      const [ga, gb] = j.refs;
      if (!internal) {
        // A tooth of one faces a gap of the other along the line of centres.
        gear(ga, ra, () => phi);
        gear(gb, rb, (tau) => phi + Math.PI + tau / 2);
      } else {
        const ringA = ra > rb;
        const contact = ringA ? phi : phi + Math.PI;
        gear(ringA ? ga : gb, ringA ? ra : rb, (tau) => contact + tau / 2, true);
        gear(ringA ? gb : ga, ringA ? rb : ra, () => contact);
      }
    } else if (j.kind === "rack") {
      const [r, side, s0] = j.data!;
      const [lid, cid] = j.refs;
      const l = doc.geoms[lid];
      if (l?.kind !== "line") continue;
      const u = sub(doc.points[l.p2], doc.points[l.p1]);
      // The pinion's tooth points at the rack; the rack has a gap there.
      const down = angleOf({ x: u.y * side, y: -u.x * side });
      const pinion = gear(cid, r, () => down);
      const pitch = Math.PI * pinion.m;
      if (!out.has(lid)) out.set(lid, { m: pinion.m, n: pitch, phase: s0 + pitch / 2, side });
    }
  }
  return out;
}

/** The outline of a gear or rack, grown by `grow` (sketch units), as polygons in sketch coordinates. */
function teethPolys(doc: SketchDoc, g: Geometry, t: Teeth, grow: number, back: number): Vec[][] {
  const pt = (c: Vec, a: number, r: number) => ({ x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r });
  if (g.kind === "line") {
    const a = doc.points[g.p1], b = doc.points[g.p2];
    const len = dist(a, b) || 1;
    const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    const nrm = { x: -u.y * t.side!, y: u.x * t.side! };
    const at = (s: number, o: number) => ({ x: a.x + u.x * s + nrm.x * o, y: a.y + u.y * s + nrm.y * o });
    const tip = t.m + grow, root = -1.25 * t.m + grow, base = -1.25 * t.m - back - grow;
    const p = t.n;
    const out: Vec[] = [at(-grow, base), at(-grow, root)];
    let k = Math.ceil((0 - t.phase) / p - 0.5);
    for (let s = t.phase + k * p; s - 0.3 * p < len; s = t.phase + ++k * p) {
      for (const [ds, o] of [[-0.28, root], [-0.12, tip], [0.12, tip], [0.28, root]] as const) {
        const x = s + ds * p;
        if (x > 0 && x < len) out.push(at(x, o));
      }
    }
    out.push(at(len + grow, root), at(len + grow, base));
    return [out];
  }
  if (g.kind !== "circle" && g.kind !== "arc") return [];
  const c = doc.points[g.c];
  const r = g.kind === "circle" ? g.r : arcRadius(doc, g);
  const tau = (Math.PI * 2) / t.n;
  const ring: Vec[] = [];
  const tip = t.internal ? r - t.m - grow : r + t.m + grow;
  const root = t.internal ? r + 1.25 * t.m - grow : r - 1.25 * t.m + grow;
  for (let i = 0; i < t.n; i++) {
    const a = t.phase + i * tau;
    ring.push(pt(c, a - 0.5 * tau, root), pt(c, a - 0.28 * tau, root), pt(c, a - 0.12 * tau, tip), pt(c, a + 0.12 * tau, tip), pt(c, a + 0.28 * tau, root));
  }
  if (!t.internal) return [ring];
  // A ring gear: a band round the outside, teeth pointing in.
  const outer: Vec[] = [];
  for (let i = 0; i < 96; i++) outer.push(pt(c, (i / 96) * Math.PI * 2, r + 1.25 * t.m + back + grow));
  return [outer, ring];
}

/**
 * Bodies as see-through shapes with a solid outline. All parts of a body are
 * filled together, so they merge into one shape instead of darkening where
 * they overlap, and slots are cut clean through it.
 */
export function drawBodies(ctx: CanvasRenderingContext2D, ed: Editor, style: BarStyle): void {
  const doc = ed.doc;
  const v = ed.view;
  const w = Math.max(3, doc.settings.barWidth * v.zoom);
  const hole = slotWidth(doc, v);
  const slots = slotGeoms(doc, ed.mech.joints);
  const ground = groundBodies(doc);
  const teeth = teethFor(doc, ed.mech.joints);
  const discs = discCircles(ed.mech.joints);

  // Ground first so moving bodies sit on top of it.
  const bodies = Object.values(doc.bodies).sort((a, b) => Number(ground.has(b.id)) - Number(ground.has(a.id)));
  ctx.save();
  ctx.setLineDash([]);
  for (const b of bodies) {
    const pose = style.posed ? poseOf(doc, b.id) : IDENTITY;
    const color = bodyColor(doc, b);
    const edge = ed.selection.has(b.id) ? colors.selected : style.hover === b.id ? colors.hover : color;
    const geoms = bodyGeoms(doc, b).filter((g) => !g.construction);
    const slotted = geoms.filter((g) => slots.has(g.id));
    const loops = bodyLoops(doc, b).map((loop) => orient(loop.map((p) => v.toScreen(applyPose(pose, p)))));
    const loose = b.members.filter((id) => doc.points[id]).map((id) => v.toScreen(applyPose(pose, doc.points[id])));
    const toScreen = (p: Vec) => v.toScreen(applyPose(pose, p));
    const parts = (width: number): Part[] => [
      ...loops.map((p) => [p]),
      ...geoms.map((g) => {
        const tt = teeth.get(g.id);
        // A cam or roller is a solid disc.
        if (!tt && g.kind === "circle" && discs.has(g.id)) return disc(v.toScreen(applyPose(pose, doc.points[g.c])), g.r * v.zoom + width / 2);
        if (!tt) return geomPart(doc, v, pose, g, width);
        // Gears and racks: their toothed outline (stroked for the outline ring).
        const polys = teethPolys(doc, g, tt, 0, doc.settings.barWidth * 0.8);
        return polys.map((p, i) => orient(p.map(toScreen), i === 1 ? -1 : 1));
      }),
      ...loose.map((p) => disc(p, width / 2)),
    ];
    const union = (list: Part[]) => {
      const path = new Path2D();
      for (const part of list) addPolys(path, part);
      return path;
    };
    const inner = parts(w);
    if (!inner.length) continue;
    const holes = slotted.map((g) => geomPart(doc, v, pose, g, hole));

    // Fill: the shape with the slots cut out, laid down see-through.
    ctx.save();
    for (const h of holes) clipOutside(ctx, h);
    ctx.globalAlpha = style.alpha * FILL_ALPHA;
    ctx.fillStyle = color;
    ctx.fill(union(inner));
    ctx.restore();

    // Outline: a ring around the shape...
    ctx.globalAlpha = style.alpha;
    ctx.fillStyle = edge;
    ctx.save();
    for (const part of inner) clipOutside(ctx, part);
    ctx.fill(union(parts(w + 4)));
    // Toothed edges are stroked: growing a tooth outline evenly is fiddly.
    const toothed = geoms.filter((g) => teeth.has(g.id));
    if (toothed.length) {
      ctx.strokeStyle = edge;
      ctx.lineWidth = 4;
      ctx.lineJoin = "round";
      ctx.stroke(union(toothed.map((g) => teethPolys(doc, g, teeth.get(g.id)!, 0, doc.settings.barWidth * 0.8).map((p) => p.map(toScreen)))));
    }
    ctx.restore();
    // ...and around each slot.
    if (holes.length) {
      ctx.save();
      for (const h of holes) clipOutside(ctx, h);
      ctx.fill(union(slotted.map((g) => geomPart(doc, v, pose, g, hole + 3))));
      ctx.restore();

      // A dotted line along the middle of each slot: the path the pin follows.
      ctx.strokeStyle = edge;
      ctx.lineWidth = 1.2;
      ctx.setLineDash([4, 4]);
      for (const g of slotted) {
        tracePath(ctx, doc, v, pose, g);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }
  }
  ctx.restore();
}

/** Pins as yellow discs the width of a slot; fixed and ground pivots are grey. Driven joints get an arrow. */
/** Each joint's letter beside it, so sliders and timeline rows can be matched to joints. */
export function drawJointLetters(ctx: CanvasRenderingContext2D, ed: Editor): void {
  const m = ed.mech;
  const k = m.context(m.current());
  const v = ed.view;
  const r = slotWidth(ed.doc, v) / 2;
  ctx.save();
  ctx.font = "600 11px system-ui, sans-serif";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  for (const j of m.joints) {
    const at = v.toScreen(jointKinds.get(j.kind).anchor(k, j));
    const text = m.letter(j.id);
    const x = at.x + r + 4, y = at.y - r - 4;
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.strokeText(text, x, y);
    ctx.fillStyle = ed.selection.has(j.id) ? colors.selected : "#4a5160";
    ctx.fillText(text, x, y);
  }
  ctx.restore();
}

export function drawJoints(ctx: CanvasRenderingContext2D, ed: Editor): void {
  const doc = ed.doc;
  const v = ed.view;
  const m = ed.mech;
  const k = m.context(m.current());
  const r = slotWidth(doc, v) / 2;
  const driven = new Set(Object.values(doc.motion.drivers).map((d) => d.joint));
  ctx.save();
  ctx.setLineDash([]);
  for (const j of m.joints) {
    const at = v.toScreen(jointKinds.get(j.kind).anchor(k, j));
    const fixed = j.kind === "anchor" || (j.kind === "pin" && (isGround(doc, j.a) || isGround(doc, j.b)));
    const sel = ed.selection.has(j.id), hov = ed.hover === j.id;
    if (j.kind === "gear" || j.kind === "rack" || j.kind === "cam") {
      // Where gears mesh: no pin, just a mark when it is picked or pointed at.
      if (sel || hov) {
        ctx.beginPath();
        ctx.arc(at.x, at.y, r * 0.8, 0, Math.PI * 2);
        ctx.lineWidth = 2;
        ctx.strokeStyle = sel ? colors.selected : colors.hover;
        ctx.stroke();
      }
      if (driven.has(j.id)) motorArrow(ctx, at, r + 6);
      continue;
    }
    ctx.beginPath();
    const kind = jointKinds.get(j.kind);
    if (j.noTurn !== undefined && kind.tangent) {
      // A slider that only slides: a square block lined up with its path.
      const a = -kind.tangent(k, j);
      const c = Math.cos(a) * r, s = Math.sin(a) * r;
      ctx.moveTo(at.x + c - s, at.y + s + c);
      ctx.lineTo(at.x - c - s, at.y - s + c);
      ctx.lineTo(at.x - c + s, at.y - s - c);
      ctx.lineTo(at.x + c + s, at.y + s - c);
      ctx.closePath();
    } else ctx.arc(at.x, at.y, r, 0, Math.PI * 2);
    ctx.fillStyle = fixed ? colors.groundPin : colors.pin;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = fixed ? colors.groundPinEdge : colors.pinEdge;
    ctx.stroke();
    if (sel || hov) {
      ctx.beginPath();
      ctx.arc(at.x, at.y, r + 2.5, 0, Math.PI * 2);
      ctx.lineWidth = 2;
      ctx.strokeStyle = sel ? colors.selected : colors.hover;
      ctx.stroke();
    }
    if (driven.has(j.id)) {
      if (j.kind === "slot") slideArrow(ctx, at, v.toScreen(k.w(j.refs[1])), v.toScreen(k.w(j.refs[2])), r);
      else if (j.kind === "curveSlot") curveArrow(ctx, at, v.toScreen(k.w(j.refs[1])), r);
      else if (j.kind === "track") {
        const t = trackDirection(k, j);
        if (t.kind === "line") slideArrow(ctx, at, v.toScreen(t.from), v.toScreen(t.to), r);
        else curveArrow(ctx, at, v.toScreen(t.c), r);
      }
      else motorArrow(ctx, at, r + 6);
    }
  }
  ctx.restore();
}

function arrowHead(ctx: CanvasRenderingContext2D, tip: Vec, u: Vec) {
  ctx.beginPath();
  ctx.moveTo(tip.x + u.x * 5, tip.y + u.y * 5);
  ctx.lineTo(tip.x - u.y * 4, tip.y + u.x * 4);
  ctx.lineTo(tip.x + u.y * 4, tip.y - u.x * 4);
  ctx.closePath();
  ctx.fill();
}

/** A driven slider: a double arrow along its slot, either side of the pin. */
function slideArrow(ctx: CanvasRenderingContext2D, at: Vec, l1: Vec, l2: Vec, r: number) {
  const l = dist(l1, l2) || 1;
  const u = { x: (l2.x - l1.x) / l, y: (l2.y - l1.y) / l };
  ctx.strokeStyle = colors.free;
  ctx.fillStyle = colors.free;
  ctx.lineWidth = 1.8;
  for (const s of [1, -1]) {
    const v = { x: u.x * s, y: u.y * s };
    const tip = { x: at.x + v.x * (r + 14), y: at.y + v.y * (r + 14) };
    ctx.beginPath();
    ctx.moveTo(at.x + v.x * (r + 3), at.y + v.y * (r + 3));
    ctx.lineTo(tip.x, tip.y);
    ctx.stroke();
    arrowHead(ctx, tip, v);
  }
}

/** A driven curved slider: a double arrow along the curve, either side of the pin. */
function curveArrow(ctx: CanvasRenderingContext2D, at: Vec, c: Vec, r: number) {
  const R = dist(at, c);
  if (R < 1) return motorArrow(ctx, at, r + 6);
  const a = Math.atan2(at.y - c.y, at.x - c.x);
  const gap = (r + 3) / R, reach = (r + 14) / R;
  ctx.strokeStyle = colors.free;
  ctx.fillStyle = colors.free;
  ctx.lineWidth = 1.8;
  for (const s of [1, -1]) {
    ctx.beginPath();
    ctx.arc(c.x, c.y, R, a + s * gap, a + s * reach, s < 0);
    ctx.stroke();
    const e = a + s * reach;
    const tip = { x: c.x + Math.cos(e) * R, y: c.y + Math.sin(e) * R };
    arrowHead(ctx, tip, { x: -Math.sin(e) * s, y: Math.cos(e) * s });
  }
}

function motorArrow(ctx: CanvasRenderingContext2D, at: Vec, r: number) {
  ctx.strokeStyle = colors.free;
  ctx.fillStyle = colors.free;
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.arc(at.x, at.y, r, -Math.PI * 0.9, Math.PI * 0.35);
  ctx.stroke();
  const a = Math.PI * 0.35;
  const tip = { x: at.x + Math.cos(a) * r, y: at.y + Math.sin(a) * r };
  const t = { x: -Math.sin(a), y: Math.cos(a) };
  ctx.beginPath();
  ctx.moveTo(tip.x + t.x * 5, tip.y + t.y * 5);
  ctx.lineTo(tip.x - t.y * 4, tip.y + t.x * 4);
  ctx.lineTo(tip.x + t.y * 4, tip.y - t.x * 4);
  ctx.closePath();
  ctx.fill();
}

/** Circles drawn and picked as solid discs: gears, pinions, cams and rollers. */
function discCircles(joints: Joint[]): Set<Id> {
  return new Set(joints.flatMap((j) => (j.kind === "gear" ? j.refs.slice(0, 2) : j.kind === "rack" ? [j.refs[1]] : j.kind === "cam" ? j.refs.slice(0, 2) : [])));
}

/** What is under the cursor in Motion mode: a joint, then the top-most body. */
export function motionHit(ed: Editor, s: Vec): { kind: "joint"; id: Id } | { kind: "body"; id: Id } | null {
  const doc = ed.doc;
  const v = ed.view;
  const m = ed.mech;
  const k = m.context(m.current());
  const r = Math.max(8, doc.settings.barWidth * v.zoom * 0.35);
  for (const j of m.joints) {
    if (dist(v.toScreen(jointKinds.get(j.kind).anchor(k, j)), s) <= r) return { kind: "joint", id: j.id };
  }
  const half = Math.max(6, (doc.settings.barWidth * v.zoom) / 2 + 2);
  const bodies = Object.values(doc.bodies).sort((a, b) => Number(isGround(doc, a.id)) - Number(isGround(doc, b.id)));
  const discs = discCircles(m.joints);
  for (const b of bodies) if (bodyDistance(doc, v, b, s, discs) <= half) return { kind: "body", id: b.id };
  return null;
}

function bodyDistance(doc: SketchDoc, v: View, b: Body, s: Vec, discs: Set<Id>): number {
  const pose = poseOf(doc, b.id);
  const P = (id: Id) => v.toScreen(applyPose(pose, doc.points[id]));
  // Inside a plate counts as on it.
  for (const loop of bodyLoops(doc, b)) {
    const pts = loop.map((p) => v.toScreen(applyPose(pose, p)));
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i], c = pts[j];
      if (a.y > s.y !== c.y > s.y && s.x < ((c.x - a.x) * (s.y - a.y)) / (c.y - a.y) + a.x) inside = !inside;
    }
    if (inside) return 0;
  }
  let best = Infinity;
  for (const id of b.members) {
    const g = doc.geoms[id];
    if (!g) {
      if (doc.points[id]) best = Math.min(best, dist(P(id), s));
      continue;
    }
    if (g.kind === "line") best = Math.min(best, distToSegment(s, P(g.p1), P(g.p2)));
    else {
      const c = P(g.c);
      const rr = (g.kind === "circle" ? g.r : arcRadius(doc, g)) * v.zoom;
      // A gear is a solid disc.
      let d = discs.has(g.id) ? Math.max(0, dist(c, s) - rr) : Math.abs(dist(c, s) - rr);
      if (g.kind === "arc") {
        const a = angleOf({ x: s.x - c.x, y: c.y - s.y }) - pose.a;
        const a0 = angleOf(sub(doc.points[g.s], doc.points[g.c])), a1 = angleOf(sub(doc.points[g.e], doc.points[g.c]));
        if (!angleInSweep(a, a0, a1)) d = Infinity;
      }
      best = Math.min(best, d);
    }
  }
  return best;
}

/** Sketch geometry that isn't in any body, drawn faintly in Motion mode. */
export function drawLooseGeometry(ctx: CanvasRenderingContext2D, ed: Editor): void {
  const doc = ed.doc;
  const own = ed.mech.owner;
  ctx.save();
  ctx.strokeStyle = "#c3c8d1";
  ctx.lineWidth = 1;
  for (const g of Object.values(doc.geoms)) {
    if (own.has(g.id)) continue;
    ctx.setLineDash(g.construction ? [5, 4] : []);
    tracePath(ctx, doc, ed.view, IDENTITY, g);
    ctx.stroke();
  }
  ctx.restore();
}
