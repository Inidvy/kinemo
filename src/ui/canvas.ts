import type { Editor } from "../app/editor";
import { arcRadius, type Vec } from "../core/model";
import { add, norm, projectOnLine, scale, sub } from "../core/geom";
import { hitTest } from "../render/hit";
import { motionHit } from "../render/bars";
import { render } from "../render/renderer";
import { tools } from "../tools";
import type { Snap, ToolEvent } from "../tools/types";

/** Wires the canvas to the editor: pointer input, pan/zoom and redraws. */
export function mountCanvas(canvas: HTMLCanvasElement, ed: Editor): void {
  const ctx = canvas.getContext("2d")!;
  let frame = 0;
  const redraw = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      render(ctx, ed, w, h);
    });
  };
  ed.subscribe(redraw);
  ed.redraw = redraw;
  new ResizeObserver(redraw).observe(canvas);

  const screenOf = (e: PointerEvent | WheelEvent | MouseEvent): Vec => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  function snapAt(s: Vec): Snap {
    const world = ed.view.toWorld(s);
    const tool = tools.find(ed.tool);
    if (!tool?.snaps || ed.mode === "motion") return { kind: "none", at: world };
    const h = hitTest(ed.doc, ed.view, s, { icons: false, geometryOnly: true });
    if (h?.kind === "point") {
      const p = ed.doc.points[h.id];
      return { kind: "point", id: h.id, at: { x: p.x, y: p.y } };
    }
    if (h?.kind === "geom") {
      const g = ed.doc.geoms[h.id];
      if (g.kind === "line") {
        return { kind: "curve", id: g.id, at: projectOnLine(world, ed.doc.points[g.p1], ed.doc.points[g.p2]) };
      }
      const c = ed.doc.points[g.c];
      const r = g.kind === "circle" ? g.r : arcRadius(ed.doc, g);
      return { kind: "curve", id: g.id, at: add(c, scale(norm(sub(world, c)), r)) };
    }
    return { kind: "none", at: world };
  }

  let lastClick = 0;
  function event(e: PointerEvent, isDown = false): ToolEvent {
    const screen = screenOf(e);
    const now = performance.now();
    const double = isDown && now - lastClick < 350;
    if (isDown) lastClick = now;
    return {
      world: ed.view.toWorld(screen),
      screen,
      snap: snapAt(screen),
      hit: ed.mode === "motion" ? motionHit(ed, screen) : hitTest(ed.doc, ed.view, screen, { icons: ed.doc.settings.showConstraintIcons }),
      shift: e.shiftKey,
      ctrl: e.ctrlKey || e.metaKey,
      double,
    };
  }

  // Pan with the middle or right button; pinch and two-finger pan on touch.
  let panning: Vec | null = null;
  const touches = new Map<number, Vec>();
  let pinch: { d: number; mid: Vec } | null = null;

  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  // Keep focus where it is (for example the dimension value box).
  canvas.addEventListener("mousedown", (e) => e.preventDefault());

  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    if (e.pointerType === "touch") {
      touches.set(e.pointerId, screenOf(e));
      if (touches.size === 2) {
        const [a, b] = [...touches.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
        tools.find(ed.tool)?.up?.(ed, event(e));
        return;
      }
    }
    if (e.button === 1 || e.button === 2) {
      panning = screenOf(e);
      return;
    }
    tools.find(ed.tool)?.down?.(ed, event(e, true));
    ed.emit();
  });

  canvas.addEventListener("pointerleave", () => (ed.cursor = null));

  canvas.addEventListener("pointermove", (e) => {
    const s = screenOf(e);
    if (e.pointerType === "touch" && touches.has(e.pointerId)) {
      touches.set(e.pointerId, s);
      if (pinch && touches.size === 2) {
        const [a, b] = [...touches.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        ed.view.pan(mid.x - pinch.mid.x, mid.y - pinch.mid.y);
        ed.view.zoomAt(mid, d / pinch.d);
        pinch = { d, mid };
        ed.emit();
        return;
      }
    }
    if (panning) {
      ed.view.pan(s.x - panning.x, s.y - panning.y);
      panning = s;
      ed.emit();
      return;
    }
    const ev = event(e);
    ed.cursor = ev.world;
    const h = ev.hit;
    const hover = h?.id ?? null;
    if (hover !== ed.hover) ed.hover = hover;
    tools.find(ed.tool)?.move?.(ed, ev);
    redraw();
  });

  const end = (e: PointerEvent) => {
    if (e.pointerType === "touch") {
      touches.delete(e.pointerId);
      if (pinch) {
        if (touches.size === 0) pinch = null;
        return;
      }
    }
    if (panning) {
      panning = null;
      return;
    }
    tools.find(ed.tool)?.up?.(ed, event(e));
    ed.emit();
  };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);

  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      ed.view.zoomAt(screenOf(e), Math.exp(-e.deltaY * 0.0015));
      ed.emit();
    },
    { passive: false },
  );

}
