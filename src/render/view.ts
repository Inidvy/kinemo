import type { Vec } from "../core/model";

/** Screen <-> world transform. World is millimetres with y pointing up. */
export class View {
  /** Pixels per millimetre. */
  zoom = 3;
  /** Screen position of the world origin. */
  origin: Vec = { x: 400, y: 300 };

  toScreen(p: Vec): Vec {
    return { x: this.origin.x + p.x * this.zoom, y: this.origin.y - p.y * this.zoom };
  }

  toWorld(s: Vec): Vec {
    return { x: (s.x - this.origin.x) / this.zoom, y: (this.origin.y - s.y) / this.zoom };
  }

  /** Convert a screen distance to millimetres. */
  px(n: number): number {
    return n / this.zoom;
  }

  zoomAt(screen: Vec, factor: number): void {
    const before = this.toWorld(screen);
    this.zoom = Math.min(200, Math.max(0.05, this.zoom * factor));
    const after = this.toScreen(before);
    this.origin.x += screen.x - after.x;
    this.origin.y += screen.y - after.y;
  }

  pan(dx: number, dy: number): void {
    this.origin.x += dx;
    this.origin.y += dy;
  }

  fit(points: Vec[], width: number, height: number): void {
    if (points.length === 0) {
      this.zoom = 3;
      this.origin = { x: width / 2, y: height / 2 };
      return;
    }
    const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const w = Math.max(maxX - minX, 10), h = Math.max(maxY - minY, 10);
    this.zoom = Math.min(200, Math.min(width / (w * 1.4), height / (h * 1.4)));
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    this.origin = { x: width / 2 - cx * this.zoom, y: height / 2 + cy * this.zoom };
  }
}
