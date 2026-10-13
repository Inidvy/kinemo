import { GIFEncoder, applyPalette, quantize } from "gifenc";
import type { Editor } from "../app/editor";
import { clipTime, timelineOf } from "../motion/timeline";
import { render } from "../render/renderer";
import { t } from "../i18n";
import type { Player } from "./timeline";
import type { Vec } from "../core/model";
import { outlinePoints } from "./actions";
import { setMinPixelRatio } from "./canvas";

/** How many times their layout size exports are drawn at: more is sharper but slower and bigger. */
export const EXPORT_SCALES = [1, 2, 3, 4] as const;
const SCALE_KEY = "kinemo.exportScale";

/** The chosen export scale, remembered in this browser (2 unless changed). */
export function exportScale(): number {
  try {
    const n = Number(localStorage.getItem(SCALE_KEY));
    return (EXPORT_SCALES as readonly number[]).includes(n) ? n : 2;
  } catch {
    return 2;
  }
}

export function setExportScale(n: number): void {
  try {
    localStorage.setItem(SCALE_KEY, String(n));
  } catch {
    // Not remembered, but nothing else depends on it.
  }
}

export function download(blob: Blob, name: string): void {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** How long one whole cycle of the clip runs: there and back for ping-pong. */
export function cycleLength(ed: Editor): number {
  const tl = timelineOf(ed.doc);
  return tl.mode === "pingpong" ? 2 * tl.length : tl.length;
}

/**
 * Render one whole cycle frame by frame into a looping GIF of what the
 * mechanism, framed around everything it sweeps through (laid out at 640 px on
 * the long side and drawn at the export scale). Frames are posed one after another (not
 * in real time), so the GIF plays evenly however slow the solve is.
 */
export async function exportGif(ed: Editor, player: Player, progress: (done: number) => void): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>("#canvas");
  if (!canvas) return;
  const tl = timelineOf(ed.doc);
  const fps = 20;
  const frames = Math.max(2, Math.round(cycleLength(ed) * fps));
  const gif = GIFEncoder();
  if (player.playing) player.stop();
  ed.select([]);
  ed.hover = null;
  const tool = ed.tool;
  const before = ed.doc.motion.poses;
  const time0 = player.time;
  const view = { zoom: ed.view.zoom, origin: { ...ed.view.origin } };
  ed.beginDrag();
  ed.exporting = true;
  try {
    // First run the cycle to see how much room the moving mechanism needs, then frame the GIF around it.
    const pts: Vec[] = [];
    for (let i = 0; i < frames; i += 2) {
      player.pose(clipTime(i / fps, tl).t);
      pts.push(...outlinePoints(ed.doc, true));
    }
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const bw = Math.max(10, Math.max(...xs) - Math.min(...xs)), bh = Math.max(10, Math.max(...ys) - Math.min(...ys));
    const long = 640;
    const W = bw >= bh ? long : Math.max(240, Math.round((long * bw) / bh));
    const H = bw >= bh ? Math.max(240, Math.round((long * bh) / bw)) : long;
    ed.view.fit(pts, W, H);
    const off = document.createElement("canvas");
    const scale = exportScale();
    const PW = W * scale, PH = H * scale;
    off.width = PW;
    off.height = PH;
    const ctx = off.getContext("2d", { willReadFrequently: true })!;
    for (let i = 0; i < frames; i++) {
      player.pose(clipTime(i / fps, tl).t);
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      render(ctx, ed, W, H);
      const { data } = ctx.getImageData(0, 0, PW, PH);
      const palette = quantize(data, 256);
      gif.writeFrame(applyPalette(data, palette), PW, PH, { palette, delay: Math.round(1000 / fps) });
      if (i % 4 === 0) {
        progress(i / frames);
        // Let the page update between frames.
        await new Promise((r) => setTimeout(r));
      }
    }
    gif.finish();
    download(new Blob([gif.bytes()], { type: "image/gif" }), "mechanism.gif");
  } finally {
    ed.exporting = false;
    ed.view.zoom = view.zoom;
    ed.view.origin = view.origin;
    // Put the mechanism back as it was: making the GIF isn't an edit.
    ed.live((d) => (d.motion.poses = before));
    ed.endDrag();
    player.time = time0;
    ed.setTool(tool);
    progress(1);
  }
}

/** Record one whole cycle of the canvas as it plays, as a video. */
export function recordVideo(ed: Editor, player: Player, onEnd: () => void): MediaRecorder | null {
  const canvas = document.querySelector<HTMLCanvasElement>("#canvas");
  const type =
    typeof MediaRecorder !== "undefined" && canvas?.captureStream
      ? ["video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9", "video/webm"].find((x) => MediaRecorder.isTypeSupported(x))
      : undefined;
  if (!canvas || !type) {
    ed.flash(t("export.noVideo"));
    return null;
  }
  ed.select([]);
  // Draw the canvas at the export scale while recording, so the video is sharp even from a low-resolution screen,
  // but no bigger than 4K, which video encoders can't go past.
  const scale = Math.min(exportScale(), 3840 / Math.max(1, canvas.clientWidth), 2160 / Math.max(1, canvas.clientHeight));
  setMinPixelRatio(scale);
  const rec = new MediaRecorder(canvas.captureStream(60), { mimeType: type, videoBitsPerSecond: Math.round(8_000_000 * Math.max(1, scale)) });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  rec.onstop = () => {
    setMinPixelRatio(1);
    download(new Blob(chunks, { type }), `mechanism.${type.startsWith("video/mp4") ? "mp4" : "webm"}`);
    onEnd();
  };
  rec.start();
  // Hold the last pose a moment so the video doesn't stop mid-movement.
  if (!player.playCycle(() => setTimeout(() => rec.state !== "inactive" && rec.stop(), 300))) {
    rec.stop();
    setMinPixelRatio(1);
    return null;
  }
  return rec;
}
