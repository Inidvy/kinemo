import type { Editor } from "../app/editor";
import type { Id, Vec } from "../core/model";
import type { Hit } from "../render/hit";

/** What the cursor is snapped to. */
export type Snap =
  | { kind: "point"; id: Id; at: Vec }
  | { kind: "curve"; id: Id; at: Vec }
  | { kind: "none"; at: Vec };

export interface ToolEvent {
  world: Vec;
  screen: Vec;
  /** Snap target for drawing tools (points, then curves). */
  snap: Snap;
  /** Anything under the cursor, including icons and dimension labels. */
  hit: Hit | null;
  shift: boolean;
  ctrl: boolean;
  double: boolean;
}

export interface Overlay {
  ctx: CanvasRenderingContext2D;
  ed: Editor;
}

export interface Tool {
  id: string;
  /** i18n key. */
  label: string;
  /** Inline SVG markup for the toolbar. */
  icon: string;
  shortcut?: string;
  /** Shortcut needs Shift. */
  shift?: boolean;
  /** i18n key for the status-bar hint. */
  hint: string;
  /** Status-bar text that depends on state; overrides `hint`. */
  hintText?(ed: Editor): string;
  /** Not shown on the toolbar (entered some other way). */
  hidden?: boolean;
  /** Snap to existing points and curves while this tool is active. */
  snaps?: boolean;
  activate?(ed: Editor): void;
  deactivate?(ed: Editor): void;
  down?(ed: Editor, e: ToolEvent): void;
  move?(ed: Editor, e: ToolEvent): void;
  up?(ed: Editor, e: ToolEvent): void;
  /** Esc pressed. Return true if handled (otherwise the editor goes back to Select). */
  cancel?(ed: Editor): boolean;
  overlay?(o: Overlay): void;
  /** A key pressed while this tool is active. Return true if handled. */
  key?(ed: Editor, key: string): boolean;
}
