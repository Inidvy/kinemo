import { type Vec } from "../core/model";
import { add, norm, perp, scale, sub } from "../core/geom";
import { colors } from "./style";
import { linearOffset, type DimLayout } from "./layout";
import type { View } from "./view";

function arrow(ctx: CanvasRenderingContext2D, at: Vec, dir: Vec) {
  const d = norm(dir), n = perp(d);
  const back = sub(at, scale(d, 8));
  ctx.beginPath();
  ctx.moveTo(at.x, at.y);
  ctx.lineTo(back.x + n.x * 3, back.y + n.y * 3);
  ctx.lineTo(back.x - n.x * 3, back.y - n.y * 3);
  ctx.closePath();
  ctx.fill();
}

export function drawDimension(
  ctx: CanvasRenderingContext2D,
  v: View,
  d: DimLayout,
  sel: boolean,
  hover: boolean,
  bad: string | null,
  ink: string = colors.dimension,
) {
  const color = bad ?? (sel ? colors.selected : hover ? colors.hover : ink);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  const text = v.toScreen(d.text);
  const sh = d.shape;

  if (sh.kind === "linear") {
    // Where the dimension line's ends sit: level with the label for a horizontal
    // or vertical distance, otherwise offset alongside the measured segment.
    let a2: Vec, b2: Vec;
    if (sh.axis === "x") [a2, b2] = [{ x: sh.a.x, y: d.text.y }, { x: sh.b.x, y: d.text.y }];
    else if (sh.axis === "y") [a2, b2] = [{ x: d.text.x, y: sh.a.y }, { x: d.text.x, y: sh.b.y }];
    else {
      const off = linearOffset(sh, d.text);
      const n = perp(norm(sub(sh.b, sh.a)));
      [a2, b2] = [add(sh.a, scale(n, off)), add(sh.b, scale(n, off))];
    }
    const [sa, sb, sa2, sb2] = [sh.a, sh.b, a2, b2].map((p) => v.toScreen(p));
    const ext = scale(norm(sub(sa2, sa)), 4);
    ctx.beginPath();
    ctx.moveTo(sa.x, sa.y);
    ctx.lineTo(sa2.x + ext.x, sa2.y + ext.y);
    ctx.moveTo(sb.x, sb.y);
    ctx.lineTo(sb2.x + ext.x, sb2.y + ext.y);
    ctx.moveTo(sa2.x, sa2.y);
    ctx.lineTo(sb2.x, sb2.y);
    ctx.stroke();
    arrow(ctx, sa2, sub(sa2, sb2));
    arrow(ctx, sb2, sub(sb2, sa2));
  } else if (sh.kind === "angle") {
    const cs = v.toScreen(sh.center);
    const r = Math.hypot(text.x - cs.x, text.y - cs.y);
    let sweep = sh.d2 - sh.d1;
    while (sweep <= -Math.PI) sweep += 2 * Math.PI;
    while (sweep > Math.PI) sweep -= 2 * Math.PI;
    ctx.beginPath();
    ctx.arc(cs.x, cs.y, r, -sh.d1, -(sh.d1 + sweep), sweep > 0);
    ctx.stroke();
  } else {
    const cs = v.toScreen(sh.center);
    const dir = norm(sub(text, cs));
    const rim = add(cs, scale(dir, sh.r * v.zoom));
    const from = sh.diameter ? sub(cs, scale(dir, sh.r * v.zoom)) : cs;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(text.x, text.y);
    ctx.stroke();
    arrow(ctx, rim, dir);
    if (sh.diameter) arrow(ctx, from, scale(dir, -1));
  }

  // Value label on a white pill so it reads over lines.
  ctx.font = "12px system-ui, sans-serif";
  const label = d.label;
  const tw = ctx.measureText(label).width + 8;
  ctx.fillStyle = colors.background;
  roundRect(ctx, text.x - tw / 2, text.y - 9, tw, 18, 4);
  ctx.fill();
  if (sel || hover) {
    ctx.strokeStyle = color;
    ctx.stroke();
  }
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, text.x, text.y + 0.5);
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
