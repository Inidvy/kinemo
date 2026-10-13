import { addConstraint, addGeom, addPoint, type Arc, type Circle, type Id, type Line, type Vec } from "../core/model";
import { angleOf, dist } from "../core/geom";
import { colors } from "../render/style";
import type { View } from "../render/view";
import type { Editor } from "../app/editor";
import { icons } from "../ui/icons";
import { inferAxis, placePoint } from "./build";
import type { Snap, Tool } from "./types";

function previewStyle(ctx: CanvasRenderingContext2D) {
  ctx.strokeStyle = colors.preview;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([]);
}

function strokeLine(ctx: CanvasRenderingContext2D, v: View, a: Vec, b: Vec) {
  const sa = v.toScreen(a), sb = v.toScreen(b);
  ctx.beginPath();
  ctx.moveTo(sa.x, sa.y);
  ctx.lineTo(sb.x, sb.y);
  ctx.stroke();
}

function axisLabel(ctx: CanvasRenderingContext2D, v: View, at: Vec, text: string) {
  const s = v.toScreen(at);
  ctx.fillStyle = colors.preview;
  ctx.font = "11px system-ui, sans-serif";
  ctx.fillText(text, s.x + 10, s.y + 16);
}

// ---------------------------------------------------------------- line

let lineStart: Snap | null = null;
let lineCursor: Vec | null = null;

export const lineTool: Tool = {
  id: "line",
  label: "tool.line",
  icon: icons.line,
  shortcut: "l",
  hint: "hint.line",
  snaps: true,
  activate() {
    lineStart = null;
  },
  cancel() {
    if (!lineStart) return false;
    lineStart = null;
    return true;
  },
  move(_ed, e) {
    lineCursor = e.snap.at;
  },
  down(ed, e) {
    if (!lineStart) {
      lineStart = e.snap;
      return;
    }
    const start = lineStart;
    let end: Snap = e.snap;
    const inf = end.kind === "none" ? inferAxis(start.at, end.at) : { axis: null, at: end.at };
    if (end.kind === "none") end = { kind: "none", at: inf.at };
    if (dist(start.at, end.at) < ed.view.px(3)) return;
    let endId: Id = "";
    ed.change((doc) => {
      const p1 = placePoint(doc, start);
      const p2 = placePoint(doc, end);
      const l = addGeom<Line>(doc, { kind: "line", p1, p2 });
      if (inf.axis) addConstraint(doc, { type: inf.axis, refs: [l] });
      endId = p2;
    });
    // Continue the chain from the new end point.
    const p = ed.doc.points[endId];
    lineStart = p ? { kind: "point", id: endId, at: { x: p.x, y: p.y } } : null;
  },
  overlay({ ctx, ed }) {
    if (!lineStart || !lineCursor) return;
    const inf = inferAxis(lineStart.at, lineCursor);
    previewStyle(ctx);
    strokeLine(ctx, ed.view, lineStart.at, inf.at);
    const len = dist(lineStart.at, inf.at).toFixed(1);
    axisLabel(ctx, ed.view, inf.at, inf.axis ? `${len}  ${inf.axis === "horizontal" ? "H" : "V"}` : len);
  },
};

// ---------------------------------------------------------------- circle

let circleCenter: Snap | null = null;
let circleCursor: Vec | null = null;

export const circleTool: Tool = {
  id: "circle",
  label: "tool.circle",
  icon: icons.circle,
  shortcut: "c",
  hint: "hint.circle",
  snaps: true,
  activate() {
    circleCenter = null;
  },
  cancel() {
    if (!circleCenter) return false;
    circleCenter = null;
    return true;
  },
  move(_ed, e) {
    circleCursor = e.snap.at;
  },
  down(ed, e) {
    if (!circleCenter) {
      circleCenter = e.snap;
      return;
    }
    const center = circleCenter;
    const r = dist(center.at, e.snap.at);
    if (r < ed.view.px(3)) return;
    ed.change((doc) => {
      const c = placePoint(doc, center);
      const g = addGeom<Circle>(doc, { kind: "circle", c, r });
      if (e.snap.kind === "point") addConstraint(doc, { type: "onCurve", refs: [e.snap.id, g] });
    });
    circleCenter = null;
  },
  overlay({ ctx, ed }) {
    if (!circleCenter || !circleCursor) return;
    previewStyle(ctx);
    const c = ed.view.toScreen(circleCenter.at);
    const r = dist(circleCenter.at, circleCursor);
    ctx.beginPath();
    ctx.arc(c.x, c.y, r * ed.view.zoom, 0, Math.PI * 2);
    ctx.stroke();
    axisLabel(ctx, ed.view, circleCursor, `Ø${(r * 2).toFixed(1)}`);
  },
};

// ---------------------------------------------------------------- arc

let arcPts: Snap[] = [];
let arcCursor: Vec | null = null;
/** Signed angle the cursor has swept since the start point; picks the arc's direction. */
let arcSwept = 0;
let arcLastAngle = 0;

function arcEnd(c: Vec, s: Vec, cursor: Vec): Vec {
  const r = dist(c, s);
  const a = angleOf({ x: cursor.x - c.x, y: cursor.y - c.y });
  return { x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) };
}

export const arcTool: Tool = {
  id: "arc",
  label: "tool.arc",
  icon: icons.arc,
  shortcut: "a",
  hint: "hint.arc",
  snaps: true,
  activate() {
    arcPts = [];
  },
  cancel() {
    if (!arcPts.length) return false;
    arcPts = [];
    return true;
  },
  move(_ed, e) {
    arcCursor = e.snap.at;
    if (arcPts.length === 2) {
      const c = arcPts[0].at;
      const a = angleOf({ x: arcCursor.x - c.x, y: arcCursor.y - c.y });
      let d = a - arcLastAngle;
      if (d > Math.PI) d -= 2 * Math.PI;
      if (d < -Math.PI) d += 2 * Math.PI;
      arcSwept += d;
      arcLastAngle = a;
    }
  },
  down(ed, e) {
    arcPts.push(e.snap);
    if (arcPts.length === 2) {
      const c = arcPts[0].at, s = arcPts[1].at;
      arcLastAngle = angleOf({ x: s.x - c.x, y: s.y - c.y });
      arcSwept = 0;
    }
    if (arcPts.length < 3) return;
    const [cs, ss, es] = arcPts;
    arcPts = [];
    if (dist(cs.at, ss.at) < ed.view.px(3)) return;
    const endAt = arcEnd(cs.at, ss.at, es.at);
    const ccw = arcSwept >= 0;
    ed.change((doc) => {
      const c = placePoint(doc, cs);
      const s = placePoint(doc, ss);
      const ePt = es.kind === "point" ? placePoint(doc, { ...es, at: endAt }) : addPoint(doc, endAt.x, endAt.y);
      // Arcs are stored counter-clockwise, so a clockwise sweep swaps the ends.
      addGeom<Arc>(doc, ccw ? { kind: "arc", c, s, e: ePt } : { kind: "arc", c, s: ePt, e: s });
    });
  },
  overlay({ ctx, ed }) {
    if (!arcCursor || arcPts.length === 0) return;
    previewStyle(ctx);
    const v = ed.view;
    const c = arcPts[0].at;
    if (arcPts.length === 1) {
      ctx.setLineDash([4, 4]);
      strokeLine(ctx, v, c, arcCursor);
      return;
    }
    const s = arcPts[1].at;
    const e = arcEnd(c, s, arcCursor);
    const sc = v.toScreen(c);
    const a0 = angleOf({ x: s.x - c.x, y: s.y - c.y });
    const a1 = angleOf({ x: e.x - c.x, y: e.y - c.y });
    ctx.beginPath();
    // Canvas y points down, so a counter-clockwise world arc is "anticlockwise" in canvas terms.
    ctx.arc(sc.x, sc.y, dist(c, s) * v.zoom, -a0, -a1, arcSwept >= 0);
    ctx.stroke();
  },
};

// ---------------------------------------------------------------- rectangles

let rectFirst: Snap | null = null;
let rectCursor: Vec | null = null;

/** Four separate lines joined by coincident constraints, two H and two V. */
function buildRect(ed: Editor, corners: Vec[], firstSnap: Snap | null, center?: Snap) {
  ed.change((doc) => {
    const ids: Id[] = [];
    const lines: Id[] = [];
    for (let i = 0; i < 4; i++) {
      const a = corners[i], b = corners[(i + 1) % 4];
      const p1 = i === 0 && firstSnap ? placePoint(doc, { ...firstSnap, at: a } as Snap) : addPoint(doc, a.x, a.y);
      const p2 = addPoint(doc, b.x, b.y);
      ids.push(p1, p2);
      lines.push(addGeom<Line>(doc, { kind: "line", p1, p2 }));
    }
    for (let i = 0; i < 4; i++) {
      addConstraint(doc, { type: "coincident", refs: [ids[i * 2 + 1], ids[((i + 1) % 4) * 2]] });
    }
    addConstraint(doc, { type: "horizontal", refs: [lines[0]] });
    addConstraint(doc, { type: "vertical", refs: [lines[1]] });
    addConstraint(doc, { type: "horizontal", refs: [lines[2]] });
    addConstraint(doc, { type: "vertical", refs: [lines[3]] });
    if (center) {
      const c = placePoint(doc, center);
      addConstraint(doc, { type: "symmetric", refs: [ids[0], ids[4], c] });
    }
  });
}

function corners(a: Vec, b: Vec): Vec[] {
  return [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }];
}

function rectOverlay(ctx: CanvasRenderingContext2D, v: View, cs: Vec[]) {
  previewStyle(ctx);
  ctx.beginPath();
  cs.forEach((p, i) => {
    const s = v.toScreen(p);
    if (i === 0) ctx.moveTo(s.x, s.y);
    else ctx.lineTo(s.x, s.y);
  });
  ctx.closePath();
  ctx.stroke();
}

export const rectTool: Tool = {
  id: "rect",
  label: "tool.rect",
  icon: icons.rect,
  shortcut: "r",
  hint: "hint.rect",
  snaps: true,
  activate() {
    rectFirst = null;
  },
  cancel() {
    if (!rectFirst) return false;
    rectFirst = null;
    return true;
  },
  move(_ed, e) {
    rectCursor = e.snap.at;
  },
  down(ed, e) {
    if (!rectFirst) {
      rectFirst = e.snap;
      return;
    }
    const a = rectFirst.at, b = e.snap.at;
    const first = rectFirst;
    rectFirst = null;
    if (Math.abs(a.x - b.x) < ed.view.px(3) || Math.abs(a.y - b.y) < ed.view.px(3)) return;
    buildRect(ed, corners(a, b), first);
  },
  overlay({ ctx, ed }) {
    if (rectFirst && rectCursor) rectOverlay(ctx, ed.view, corners(rectFirst.at, rectCursor));
  },
};

export const rectCenterTool: Tool = {
  id: "rectCenter",
  label: "tool.rectCenter",
  icon: icons.rectCenter,
  shortcut: "r",
  shift: true,
  hint: "hint.rectCenter",
  snaps: true,
  activate() {
    rectFirst = null;
  },
  cancel: rectTool.cancel,
  move: rectTool.move,
  down(ed, e) {
    if (!rectFirst) {
      rectFirst = e.snap;
      return;
    }
    const c = rectFirst.at, b = e.snap.at;
    const center = rectFirst;
    rectFirst = null;
    const a = { x: 2 * c.x - b.x, y: 2 * c.y - b.y };
    if (Math.abs(a.x - b.x) < ed.view.px(3) || Math.abs(a.y - b.y) < ed.view.px(3)) return;
    buildRect(ed, corners(a, b), null, center);
  },
  overlay({ ctx, ed }) {
    if (!rectFirst || !rectCursor) return;
    const c = rectFirst.at, b = rectCursor;
    rectOverlay(ctx, ed.view, corners({ x: 2 * c.x - b.x, y: 2 * c.y - b.y }, b));
  },
};

// ---------------------------------------------------------------- point

export const pointTool: Tool = {
  id: "point",
  label: "tool.point",
  icon: icons.point,
  hint: "hint.point",
  snaps: true,
  down(ed, e) {
    ed.change((doc) => {
      placePoint(doc, e.snap);
    });
  },
};
