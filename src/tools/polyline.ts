import { addConstraint, addGeom, addPoint, type Arc, type Id, type Line, type SketchDoc, type Vec } from "../core/model";
import { add, angleOf, dist, dot, norm, perp, scale, sub } from "../core/geom";
import { icons } from "../ui/icons";
import { t } from "../i18n";
import { inferAxis, placePoint } from "./build";
import { arcFromNormal, arcFromTangent, type ArcThrough } from "./polylineGeom";
import { axisLabel, previewStyle, strokeLine } from "./draw";
import type { Snap, Tool } from "./types";
import { makeTangent } from "../constraints/defs/relations";

/**
 * FreeCAD-style polyline: a chain of segments where each new segment can be a
 * straight line, an arc tangent to the previous segment, an arc that starts
 * at a right angle to it, or a line that carries on tangent to it. M cycles
 * the mode; arc → line goes through the tangent line first.
 */
type Mode = "line" | "tangentArc" | "normalArc" | "tangentLine";
const MODES: Mode[] = ["line", "tangentArc", "normalArc", "tangentLine"];

interface Chain {
  start: Snap;
  /** Direction of travel at the start point, from the previous segment. */
  tangent: Vec | null;
  /** The segment we continue from, for tangent/perpendicular constraints. */
  prev: Id | null;
}

let chain: Chain | null = null;
let cursor: Vec | null = null;
let mode: Mode = "line";

/** Direction of travel when leaving an existing segment through its end point. */
function exitTangent(doc: SketchDoc, pointId: Id): { tangent: Vec; geom: Id } | null {
  for (const g of Object.values(doc.geoms)) {
    if (g.kind === "line" && (g.p1 === pointId || g.p2 === pointId)) {
      const [from, to] = g.p2 === pointId ? [g.p1, g.p2] : [g.p2, g.p1];
      return { tangent: norm(sub(doc.points[to], doc.points[from])), geom: g.id };
    }
    if (g.kind === "arc" && (g.s === pointId || g.e === pointId)) {
      const c = doc.points[g.c];
      const radial = sub(doc.points[pointId], c);
      // Arcs run counter-clockwise from s to e: leaving through e goes on
      // counter-clockwise, leaving through s goes back clockwise.
      const ccw = norm(perp(radial));
      return { tangent: g.e === pointId ? ccw : scale(ccw, -1), geom: g.id };
    }
  }
  return null;
}

/** Find the segment a snapped start point belongs to (directly or via coincidence). */
function continueFrom(doc: SketchDoc, snap: Snap): { tangent: Vec; geom: Id } | null {
  if (snap.kind !== "point") return null;
  const direct = exitTangent(doc, snap.id);
  if (direct) return direct;
  for (const c of Object.values(doc.constraints)) {
    if (c.type !== "coincident" || !c.refs.includes(snap.id)) continue;
    const other = c.refs[0] === snap.id ? c.refs[1] : c.refs[0];
    const found = exitTangent(doc, other);
    if (found) return found;
  }
  return null;
}

function preview(from: Chain, to: Vec): { arc: ArcThrough | null; line: Vec } {
  if (mode === "tangentLine" && from.tangent) {
    // Slide the end point along the previous segment's direction.
    const along = Math.max(0, dot(sub(to, from.start.at), from.tangent));
    return { arc: null, line: add(from.start.at, scale(from.tangent, along)) };
  }
  if (mode === "line" || mode === "tangentLine" || !from.tangent) return { arc: null, line: inferAxis(from.start.at, to).at };
  const arc = mode === "tangentArc" ? arcFromTangent(from.start.at, from.tangent, to) : arcFromNormal(from.start.at, from.tangent, to);
  return { arc, line: to };
}

export const lineTool: Tool = {
  id: "line",
  label: "tool.line",
  icon: icons.line,
  shortcut: "l",
  hint: "hint.line",
  snaps: true,
  activate() {
    chain = null;
    mode = "line";
  },
  cancel() {
    if (!chain) return false;
    chain = null;
    mode = "line";
    return true;
  },
  key(_ed, key) {
    if (key !== "m") return false;
    mode = MODES[(MODES.indexOf(mode) + 1) % MODES.length];
    return true;
  },
  move(_ed, e) {
    cursor = e.snap.at;
  },
  down(ed, e) {
    if (!chain) {
      const cont = continueFrom(ed.doc, e.snap);
      chain = { start: e.snap, tangent: cont?.tangent ?? null, prev: cont?.geom ?? null };
      return;
    }
    const from = chain;
    if (dist(from.start.at, e.snap.at) < ed.view.px(3)) return;
    const { arc, line: lineEnd } = preview(from, e.snap.at);
    const useArc = arc && (mode === "tangentArc" || mode === "normalArc");
    const tangentLine = mode === "tangentLine" && !!from.tangent && !!from.prev;

    let endId: Id = "";
    let newGeom: Id = "";
    let nextTangent: Vec | null = null;

    if (useArc && arc) {
      const end = e.snap;
      const curMode = mode;
      ed.change((doc) => {
        const p = placePoint(doc, from.start);
        const q = placePoint(doc, end);
        const c = addPoint(doc, arc.center.x, arc.center.y);
        // Arcs are stored counter-clockwise; a right turn swaps the ends.
        newGeom = addGeom<Arc>(doc, arc.r > 0 ? { kind: "arc", c, s: p, e: q } : { kind: "arc", c, s: q, e: p });
        if (from.prev) {
          const prev = doc.geoms[from.prev];
          if (curMode === "tangentArc") {
            addConstraint(doc, makeTangent(doc, prev, doc.geoms[newGeom]));
          } else if (prev.kind === "line") {
            // Leaving a line at a right angle puts the arc's centre on that line.
            addConstraint(doc, { type: "onCurve", refs: [c, prev.id] });
          }
        }
        endId = q;
      });
      nextTangent = arc.endTangent;
    } else if (tangentLine) {
      if (dist(from.start.at, lineEnd) < ed.view.px(3)) return;
      const prevId = from.prev!;
      ed.change((doc) => {
        const p1 = placePoint(doc, from.start);
        const p2 = addPoint(doc, lineEnd.x, lineEnd.y);
        newGeom = addGeom<Line>(doc, { kind: "line", p1, p2 });
        const prev = doc.geoms[prevId];
        if (prev.kind === "line") addConstraint(doc, { type: "parallel", refs: [prev.id, newGeom] });
        else addConstraint(doc, makeTangent(doc, prev, doc.geoms[newGeom]));
        endId = p2;
      });
      nextTangent = from.tangent;
    } else {
      const inf = e.snap.kind === "none" ? inferAxis(from.start.at, e.snap.at) : { axis: null, at: e.snap.at };
      const end: Snap = e.snap.kind === "none" ? { kind: "none", at: inf.at } : e.snap;
      ed.change((doc) => {
        const p1 = placePoint(doc, from.start);
        const p2 = placePoint(doc, end);
        newGeom = addGeom<Line>(doc, { kind: "line", p1, p2 });
        if (inf.axis) addConstraint(doc, { type: inf.axis, refs: [newGeom] });
        endId = p2;
      });
      nextTangent = norm(sub(end.at, from.start.at));
    }

    const p = ed.doc.points[endId];
    chain = p ? { start: { kind: "point", id: endId, at: { x: p.x, y: p.y } }, tangent: nextTangent, prev: newGeom } : null;
  },
  overlay({ ctx, ed }) {
    if (!chain || !cursor) return;
    const v = ed.view;
    previewStyle(ctx);
    const { arc, line } = preview(chain, cursor);
    let label: string;
    if ((mode === "tangentArc" || mode === "normalArc") && chain.tangent && arc) {
      const c = v.toScreen(arc.center);
      const s = chain.start.at;
      const a0 = angleOf(sub(s, arc.center));
      const a1 = angleOf(sub(cursor, arc.center));
      ctx.beginPath();
      ctx.arc(c.x, c.y, Math.abs(arc.r) * v.zoom, -a0, -a1, arc.r > 0);
      ctx.stroke();
      label = `R${Math.abs(arc.r).toFixed(1)}`;
    } else {
      strokeLine(ctx, v, chain.start.at, line);
      const inf = mode === "line" ? inferAxis(chain.start.at, cursor) : { axis: null };
      label = dist(chain.start.at, line).toFixed(1) + (inf.axis ? `  ${inf.axis === "horizontal" ? "H" : "V"}` : "");
    }
    const modeName = mode === "line" || !chain.tangent ? t("poly.line") : t(`poly.${mode}`);
    axisLabel(ctx, v, cursor, `${label}   ${modeName} · M`);
  },
};
