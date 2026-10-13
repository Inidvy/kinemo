import type { Editor } from "../app/editor";
import type { Id, SketchDoc, Vec } from "../core/model";
import { applyPose, ownerMap, poseOf } from "../motion/bodies";
import { sweepPaths } from "../motion/paths";
import { colors } from "./style";

/**
 * Paths of traced points. Working one out runs the whole cycle, so it is
 * done a moment after the mechanism last changed (not on every frame of a
 * drag or playback) and kept until the mechanism changes again.
 */
let cache: { key: string; paths: Map<Id, Vec[]> } | null = null;
let pending = "";
let timer = 0;

/** Everything a path depends on, apart from where the bodies are now. */
function keyOf(doc: SketchDoc): string {
  return JSON.stringify([doc.points, doc.geoms, doc.constraints, doc.bodies, doc.motion.drivers, doc.motion.timeline, doc.motion.traces]);
}

function pathsFor(ed: Editor): Map<Id, Vec[]> | null {
  const doc = ed.doc;
  if (!doc.motion.traces?.length) return null;
  const key = keyOf(doc);
  if (cache?.key === key) return cache.paths;
  if (pending !== key) {
    pending = key;
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      if (ed.mode !== "motion" || keyOf(ed.doc) !== key) return;
      cache = { key, paths: sweepPaths(ed.doc) };
      pending = "";
      ed.emit();
    }, cache ? 250 : 0);
  }
  return cache?.paths ?? null;
}

export function drawTraces(ctx: CanvasRenderingContext2D, ed: Editor): void {
  const doc = ed.doc;
  const traces = doc.motion.traces ?? [];
  if (!traces.length) return;
  const v = ed.view;
  const paths = pathsFor(ed);
  ctx.save();
  ctx.strokeStyle = colors.trace;
  ctx.fillStyle = colors.trace;
  ctx.lineWidth = 2;
  ctx.lineJoin = "round";
  if (paths) {
    for (const id of traces) {
      const pts = paths.get(id);
      if (!pts || pts.length < 2) continue;
      ctx.beginPath();
      pts.forEach((p, i) => {
        const s = v.toScreen(p);
        if (i) ctx.lineTo(s.x, s.y);
        else ctx.moveTo(s.x, s.y);
      });
      ctx.stroke();
    }
  }
  // Where each traced point is now.
  const owner = ownerMap(doc);
  for (const id of traces) {
    const p = doc.points[id];
    if (!p) continue;
    const s = v.toScreen(applyPose(poseOf(doc, owner.get(id)), p));
    ctx.beginPath();
    ctx.arc(s.x, s.y, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.strokeStyle = colors.trace;
    ctx.lineWidth = 2;
  }
  ctx.restore();
}
