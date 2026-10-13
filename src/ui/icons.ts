// Icons in the Lucide style: 24×24 grid, 2px round strokes, no fills.
// Each icon is a list of SVG path strings, so the same data draws in the
// toolbar (as SVG) and on the canvas (as Path2D).

/** A circle as a path, since Path2D only takes path data. */
const circ = (cx: number, cy: number, r: number) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;
/** A dot: a zero-length stroke that the round cap turns into a disc. */
const dot = (x: number, y: number) => `M${x} ${y}h.01`;

export type IconPaths = string[];

const paths = {
  select: ["M4 4l7.07 17 2.51-7.39L21 11.07z"],
  line: [circ(5, 19, 2), circ(19, 5, 2), "M6.5 17.5l4-4", "M10.5 13.5a6 6 0 0 1 7-7"],
  arc: [circ(5, 19, 2), circ(19, 5, 2), "M5 17A12 12 0 0 1 17 5", dot(19, 19)],
  circle: [circ(12, 12, 9), dot(12, 12)],
  rect: ["M3 6h18v12H3z", dot(3, 6), dot(21, 18)],
  rectCenter: ["M3 6h18v12H3z", "M10 12h4", "M12 10v4"],
  point: [circ(12, 12, 3), "M12 3v4", "M12 17v4", "M3 12h4", "M17 12h4"],
  dimension: [
    "M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.41 2.41 0 0 1 0-3.4l2.6-2.6a2.41 2.41 0 0 1 3.4 0Z",
    "M14.5 12.5l2-2",
    "M11.5 9.5l2-2",
    "M8.5 6.5l2-2",
    "M17.5 15.5l2-2",
  ],
  construction: ["M4 20l2.5-2.5", "M10.75 13.25l2.5-2.5", "M17.5 6.5L20 4"],
  track: ["M3 18h7a7 7 0 0 0 7-7V3", "M7 15h5v6H7z"],
  undo: ["M9 14L4 9l5-5", "M4 9h10.5a5.5 5.5 0 0 1 0 11H11"],
  redo: ["M15 14l5-5-5-5", "M20 9H9.5a5.5 5.5 0 0 0 0 11H13"],
  delete: ["M3 6h18", "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6", "M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2", "M10 11v6", "M14 11v6"],
  icons: [
    "M12.59 2.59A2 2 0 0 0 11.17 2H4a2 2 0 0 0-2 2v7.17a2 2 0 0 0 .59 1.42l8.7 8.7a2.43 2.43 0 0 0 3.42 0l6.58-6.58a2.43 2.43 0 0 0 0-3.42z",
    dot(7.5, 7.5),
  ],
  fit: ["M8 3H5a2 2 0 0 0-2 2v3", "M21 8V5a2 2 0 0 0-2-2h-3", "M3 16v3a2 2 0 0 0 2 2h3", "M16 21h3a2 2 0 0 0 2-2v-3"],
  new: ["M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z", "M14 2v4a2 2 0 0 0 2 2h4", "M9 15h6", "M12 12v6"],
  open: [
    "M6 14l1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2",
  ],
  save: [
    "M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z",
    "M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7",
    "M7 3v4a1 1 0 0 0 1 1h7",
  ],
  sketch: [
    "M12 20h9",
    "M16.38 3.62a2.12 2.12 0 0 1 3 3L7.37 18.64a2 2 0 0 1-.86.5l-2.87.84a.5.5 0 0 1-.62-.62l.84-2.87a2 2 0 0 1 .5-.86z",
  ],
  motion: ["M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8", "M21 3v5h-5"],
  warning: [
    "M21.73 18l-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3",
    "M12 9v4",
    dot(12, 17),
  ],
} satisfies Record<string, IconPaths>;

/** Constraint icons by constraint type id. Types without one fall back to their glyph. */
export const constraintIconPaths: Record<string, IconPaths> = {
  coincident: ["M3 21l6.5-6.5", "M14.5 9.5L21 3", circ(12, 12, 3)],
  onCurve: ["M3 20Q12 0 21 20", circ(12, 10, 3)],
  horizontal: [circ(4, 12, 2), circ(20, 12, 2), "M6 12h12"],
  vertical: [circ(12, 4, 2), circ(12, 20, 2), "M12 6v12"],
  parallel: ["M3 20L13 4", "M11 20L21 4"],
  perpendicular: ["M3 20h18", "M9 20V4", "M9 15h5v5"],
  tangent: [circ(12, 14, 7), "M3 7h18"],
  equal: ["M5 9h14", "M5 15h14"],
  concentric: [circ(12, 12, 9), circ(12, 12, 4), dot(12, 12)],
  midpoint: ["M3 18l6.5-4.33", "M14.5 10.33L21 6", circ(12, 12, 3)],
  symmetric: ["M12 3v3", "M12 10v4", "M12 18v3", circ(5, 12, 2), circ(19, 12, 2)],
  fix: [circ(12, 7, 3), "M12 10v5", "M4 15h16", "M7 15l-2 4", "M11 15l-2 4", "M15 15l-2 4", "M19 15l-2 4"],
  distance: ["M3 5v14", "M21 5v14", "M3 12h18", "M7 8l-4 4 4 4", "M17 8l4 4-4 4"],
  angle: ["M3 20h18", "M3 20L16 5", "M12 20a9 9 0 0 0-3.1-6.8"],
  diameter: [circ(12, 12, 8), "M4 20L20 4"],
  radius: [circ(12, 12, 9), "M12 12l6.4-6.4", dot(12, 12)],
};

export function svgIcon(p: IconPaths, size = 20): string {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p
    .map((d) => `<path d="${d}"/>`)
    .join("")}</svg>`;
}

export const iconPaths: Record<keyof typeof paths, IconPaths> = paths;

export const icons = Object.fromEntries(Object.entries(paths).map(([k, p]) => [k, svgIcon(p)])) as Record<keyof typeof paths, string>;

/** Icon for a constraint type: its Lucide-style SVG, or its glyph in a small box. */
export function constraintIcon(typeId: string, glyph: string, size = 20): string {
  const p = constraintIconPaths[typeId];
  return p ? svgIcon(p, size) : `<span class="glyph">${glyph}</span>`;
}

const path2d = new Map<string, Path2D[]>();

/** Draw a constraint icon on the canvas into a size×size box at (x, y). Returns false if it has none. */
export function drawConstraintIcon(ctx: CanvasRenderingContext2D, typeId: string, x: number, y: number, size: number): boolean {
  const p = constraintIconPaths[typeId];
  if (!p) return false;
  let list = path2d.get(typeId);
  if (!list) path2d.set(typeId, (list = p.map((d) => new Path2D(d))));
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 24, size / 24);
  ctx.lineWidth = 2.2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.setLineDash([]);
  for (const path of list) ctx.stroke(path);
  ctx.restore();
  return true;
}
