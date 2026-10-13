// Toolbar icons as inline SVG (20x20, stroke uses currentColor).
const svg = (body: string) =>
  `<svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const icons = {
  select: svg(`<path d="M5 3l10 6-4.5 1.2L13 16l-2 1-2.5-5.6L5 14z" fill="currentColor" stroke="none"/>`),
  line: svg(`<path d="M4 16L16 4"/><circle cx="4" cy="16" r="1.6" fill="currentColor"/><circle cx="16" cy="4" r="1.6" fill="currentColor"/>`),
  arc: svg(`<path d="M4 15a9 9 0 0 1 12-10"/><circle cx="4" cy="15" r="1.4" fill="currentColor"/><circle cx="16" cy="5" r="1.4" fill="currentColor"/>`),
  circle: svg(`<circle cx="10" cy="10" r="6.5"/><circle cx="10" cy="10" r="1.2" fill="currentColor"/>`),
  rect: svg(`<rect x="3.5" y="5" width="13" height="10"/>`),
  rectCenter: svg(`<rect x="3.5" y="5" width="13" height="10"/><circle cx="10" cy="10" r="1.2" fill="currentColor"/>`),
  point: svg(`<circle cx="10" cy="10" r="2.5" fill="currentColor"/>`),
  dimension: svg(`<path d="M3 13h14M3 10v6M17 10v6"/><path d="M5 13l2-1.5v3zM15 13l-2-1.5v3z" fill="currentColor"/><path d="M7 7h6" stroke-width="1.2"/>`),
  construction: svg(`<path d="M4 16L16 4" stroke-dasharray="2.5 2.5"/>`),
  track: svg(`<path d="M3 15h7a5 5 0 0 0 5-5V4" stroke-width="3" stroke-opacity=".35"/><path d="M3 15h7a5 5 0 0 0 5-5V4"/>`),
  undo: svg(`<path d="M7 5L3 9l4 4"/><path d="M3 9h9a5 5 0 0 1 0 10h-2"/>`),
  redo: svg(`<path d="M13 5l4 4-4 4"/><path d="M17 9H8a5 5 0 0 0 0 10h2"/>`),
  delete: svg(`<path d="M4 6h12M8 6V4h4v2M6 6l1 11h6l1-11"/>`),
  icons: svg(`<rect x="3" y="3" width="6" height="6" rx="1"/><rect x="11" y="11" width="6" height="6" rx="1"/><path d="M12 6h4M4 14h4"/>`),
  fit: svg(`<path d="M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4"/>`),
  new: svg(`<path d="M5 3h7l3 3v11H5z"/><path d="M12 3v3h3"/>`),
  open: svg(`<path d="M3 6h5l2 2h7v8H3z"/>`),
  save: svg(`<path d="M4 4h10l2 2v10H4z"/><path d="M7 4v4h6V4M7 16v-5h6v5"/>`),
};

/** Toolbar icon for a constraint: its glyph in a small box. */
export function glyphIcon(glyph: string): string {
  return `<span class="glyph">${glyph}</span>`;
}
