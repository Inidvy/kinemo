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

/** Where each traced point has been lately, for the fading trail. */
const trails = new Map<Id, { t: number; p: Vec }[]>();
let fadeFrame = 0;

/** Record where traced points are now and drop what is older than the trail lasts. */
function updateTrails(ed: Editor, now: number): number {
  const doc = ed.doc;
  const keep = (doc.motion.trail ?? 2) * 1000;
  const owner = ownerMap(doc);
  const traces = new Set(doc.motion.traces ?? []);
  for (const id of trails.keys()) if (!traces.has(id) || !keep) trails.delete(id);
  if (!keep) return 0;
  for (const id of traces) {
    const pt = doc.points[id];
    if (!pt) continue;
    const p = applyPose(poseOf(doc, owner.get(id)), pt);
    const list = trails.get(id) ?? [];
    const last = list[list.length - 1];
    const moved = last ? Math.hypot(last.p.x - p.x, last.p.y - p.y) : 0;
    // A jump (undo, reset, going back to the start of the clip) starts a new trail instead of drawing a line across.
    if (last && moved > ed.mech.size * 0.5) list.length = 0;
    if (!last || moved > 1e-9) list.push({ t: now, p });
    while (list.length > 1 && now - list[0].t > keep) list.shift();
    trails.set(id, list);
  }
  return keep;
}

function drawTrails(ctx: CanvasRenderingContext2D, ed: Editor, now: number, keep: number) {
  const v = ed.view;
  let fading = false;
  ctx.save();
  ctx.strokeStyle = colors.trace;
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  for (const list of trails.values()) {
    for (let i = 1; i < list.length; i++) {
      // Fades out over the trail's lifetime, measured from when the point was there.
      const age = (now - list[i].t) / keep;
      if (age >= 1) continue;
      fading = true;
      ctx.globalAlpha = 0.85 * (1 - age);
      const a = v.toScreen(list[i - 1].p), b = v.toScreen(list[i].p);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  }
  ctx.restore();
  // Keep redrawing until the trail has faded away.
  if (fading && !fadeFrame) {
    fadeFrame = requestAnimationFrame(() => {
      fadeFrame = 0;
      ed.redraw();
    });
  }
}

export function drawTraces(ctx: CanvasRenderingContext2D, ed: Editor): void {
  const doc = ed.doc;
  const traces = doc.motion.traces ?? [];
  if (!traces.length) {
    trails.clear();
    return;
  }
  const v = ed.view;
  const now = performance.now();
  const keep = ed.exporting ? 0 : updateTrails(ed, now);
  if (keep) drawTrails(ctx, ed, now, keep);
  const paths = doc.motion.hideCycle ? null : pathsFor(ed);
  ctx.save();
  ctx.strokeStyle = colors.trace;
  ctx.fillStyle = colors.trace;
  ctx.lineWidth = 1.5;
  ctx.lineJoin = "round";
  // The whole-cycle path is a thin guide under the live trail.
  ctx.globalAlpha = 0.55;
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
  ctx.globalAlpha = 1;
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
