import type { Id, Label, SketchDoc, Vec } from "../core/model";
import { LABEL_SIZE, labelsOf } from "../core/labels";
import type { View } from "./view";
import { colors } from "./style";

export const LABEL_FONT = (size: number) => `${size}px system-ui, -apple-system, "Segoe UI", sans-serif`;

/** A label laid out on screen: (x, y) is the top-left of its text box. */
export interface LabelBox {
  id: Id;
  label: Label;
  x: number;
  y: number;
  w: number;
  h: number;
  size: number;
}

let measureCtx: CanvasRenderingContext2D | null | undefined;

/** Text width in pixels; a fair estimate where there's no canvas (tests). */
function textWidth(text: string, size: number): number {
  if (measureCtx === undefined) {
    try {
      measureCtx = typeof document !== "undefined" ? document.createElement("canvas").getContext("2d") : null;
    } catch {
      measureCtx = null;
    }
  }
  if (!measureCtx) return text.length * size * 0.58;
  measureCtx.font = LABEL_FONT(size);
  return measureCtx.measureText(text).width;
}

/** Screen boxes of the labels, placed by `at` (sketch or Motion position). Shared by drawing and hit-testing. */
export function layoutLabels(doc: SketchDoc, view: View, at: (l: Label) => Vec): LabelBox[] {
  return labelsOf(doc)
    .filter((l) => l.text)
    .map((l) => {
      const size = l.size ?? LABEL_SIZE;
      const s = view.toScreen(at(l));
      const h = Math.round(size * 1.25);
      // The label's position is the bottom-left corner of its text.
      return { id: l.id, label: l, x: s.x, y: s.y - h, w: textWidth(l.text, size), h, size };
    });
}

export function labelHit(boxes: LabelBox[], s: Vec): Id | null {
  for (const b of [...boxes].reverse()) {
    if (s.x >= b.x - 3 && s.x <= b.x + b.w + 3 && s.y >= b.y - 2 && s.y <= b.y + b.h + 2) return b.id;
  }
  return null;
}

export function drawLabels(ctx: CanvasRenderingContext2D, boxes: LabelBox[], sel: (id: Id) => boolean, hover: (id: Id) => boolean): void {
  ctx.save();
  ctx.textAlign = "left";
  ctx.textBaseline = "bottom";
  ctx.setLineDash([]);
  for (const b of boxes) {
    const on = sel(b.id), hov = hover(b.id);
    if (on || hov) {
      ctx.strokeStyle = on ? colors.selected : colors.hover;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 2]);
      ctx.strokeRect(b.x - 3, b.y - 1, b.w + 6, b.h + 2);
      ctx.setLineDash([]);
    }
    ctx.font = LABEL_FONT(b.size);
    // A halo in the background colour keeps text readable over lines and bars.
    ctx.lineJoin = "round";
    ctx.strokeStyle = colors.background;
    ctx.lineWidth = 3;
    ctx.strokeText(b.label.text, b.x, b.y + b.h);
    ctx.fillStyle = on ? colors.selected : hov ? colors.hover : (b.label.color ?? colors.label);
    ctx.fillText(b.label.text, b.x, b.y + b.h);
  }
  ctx.restore();
}
