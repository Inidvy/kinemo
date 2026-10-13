import type { Editor } from "../app/editor";
import type { Id, SketchDoc } from "../core/model";
import { constraintTypes } from "../constraints";
import { sampleClip } from "../motion/clip";
import { jointKinds } from "../motion/joints";
import { posedDoc } from "../motion/bodies";
import { isWatched, measured } from "../render/layout";
import { t } from "../i18n";
import { driverName } from "./motionPanels";

/** One value plotted over the clip: a slider, or a watched dimension. */
export interface Series {
  id: Id;
  label: string;
  unit: "mm" | "deg";
  times: number[];
  values: number[];
}

/** Take out the jumps where an angle goes round past ±180°, so a turning crank plots as a ramp. */
function unwrap(values: number[], period: number): number[] {
  const out: number[] = [];
  for (const v of values) {
    if (!out.length) out.push(v);
    else {
      const prev = out[out.length - 1];
      out.push(prev + ((((v - prev + period / 2) % period) + period) % period) - period / 2);
    }
  }
  return out;
}

/** Every slider and watched dimension, measured through the clip. */
export function clipSeries(doc: SketchDoc): Series[] {
  const clip = sampleClip(doc);
  if (!clip) return [];
  const { mech: m, qs, times } = clip;
  const out: Series[] = [];
  for (const d of Object.values(doc.motion.drivers)) {
    const j = m.joint(d.joint);
    if (!j) continue;
    const kind = jointKinds.get(j.kind);
    let values = qs.map((q) => m.measure(q, d.joint));
    if (kind.wraps?.(j)) {
      const [lo, hi] = kind.range(doc, j);
      values = unwrap(values, hi - lo);
    }
    out.push({ id: d.id, label: "", unit: kind.unit === "deg" ? "deg" : "mm", times, values });
  }
  const watched = Object.values(doc.constraints).filter((c) => isWatched(c) && constraintTypes.get(c.type).shape);
  if (watched.length) {
    const posed = qs.map((q) => posedDoc({ ...doc, motion: { ...doc.motion, poses: m.poses(q) } }));
    for (const c of watched) {
      const def = constraintTypes.get(c.type);
      const deg = def.unit === "deg";
      let values = posed.map((p) => measured(def.shape!(p, c)));
      if (deg) values = unwrap(values, 360);
      out.push({ id: c.id, label: "", unit: deg ? "deg" : "mm", times, values });
    }
  }
  return out;
}

/** Working the series out runs the whole clip, so it is done once the document settles and kept until it changes. */
let cache: { key: string; series: Series[] } | null = null;
let pending = "";
let timer = 0;

function keyOf(doc: SketchDoc): string {
  return JSON.stringify([doc.points, doc.geoms, doc.constraints, doc.bodies, doc.motion.drivers, doc.motion.timeline]);
}

/** The chart's series for the current document, with labels; null while they are being worked out. */
export function chartSeries(ed: Editor): Series[] | null {
  const doc = ed.doc;
  const key = keyOf(doc);
  if (cache?.key !== key && pending !== key) {
    pending = key;
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      if (keyOf(ed.doc) !== key) return;
      cache = { key, series: clipSeries(ed.doc) };
      pending = "";
      ed.emit();
    }, cache ? 250 : 0);
  }
  if (!cache) return null;
  return cache.series.flatMap((s) => {
    const d = doc.motion.drivers[s.id];
    const c = doc.constraints[s.id];
    const label = d ? driverName(ed, d) : c ? `${t("panel.watched")} · ${t(constraintTypes.get(c.type).label)}` : "";
    return label ? [{ ...s, label }] : [];
  });
}

/** A series' value at a time, read off the samples. */
export function valueOn(s: Series, time: number): number {
  const { times, values } = s;
  if (!times.length) return NaN;
  if (time <= times[0]) return values[0];
  for (let i = 1; i < times.length; i++) {
    if (time <= times[i]) {
      const u = (time - times[i - 1]) / (times[i] - times[i - 1] || 1);
      return values[i - 1] + (values[i] - values[i - 1]) * u;
    }
  }
  return values[values.length - 1];
}

export const fmtValue = (s: Series, v: number) => `${v.toFixed(s.unit === "deg" ? 1 : 2)} ${s.unit === "deg" ? "°" : "mm"}`;

/** Plot a series across the clip's length, with its lowest and highest values marked. */
export function drawSeries(canvas: HTMLCanvasElement, s: Series, length: number, color: string): void {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  let lo = Math.min(...s.values), hi = Math.max(...s.values);
  if (hi - lo < 1e-9) [lo, hi] = [lo - 1, hi + 1];
  const pad = 6;
  const x = (time: number) => (time / length) * w;
  const y = (v: number) => pad + (1 - (v - lo) / (hi - lo)) * (h - 2 * pad);
  ctx.strokeStyle = "#e3e6eb";
  ctx.lineWidth = 1;
  for (const v of [lo, hi]) {
    ctx.beginPath();
    ctx.moveTo(0, Math.round(y(v)) + 0.5);
    ctx.lineTo(w, Math.round(y(v)) + 0.5);
    ctx.stroke();
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.lineJoin = "round";
  ctx.beginPath();
  s.times.forEach((time, i) => (i ? ctx.lineTo(x(time), y(s.values[i])) : ctx.moveTo(x(time), y(s.values[i]))));
  ctx.stroke();
  ctx.font = "10px system-ui, sans-serif";
  const label = (text: string, top: boolean) => {
    const tw = ctx.measureText(text).width;
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fillRect(1, top ? 0 : h - 12, tw + 5, 12);
    ctx.fillStyle = "#6b7380";
    ctx.textBaseline = top ? "top" : "bottom";
    ctx.fillText(text, 3, top ? 1 : h - 1);
  };
  label(fmtValue(s, hi), true);
  label(fmtValue(s, lo), false);
}
