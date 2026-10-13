import type { Id, Vec } from "../core/model";
import { applyPose, poseOf } from "../motion/bodies";
import { addDriver } from "../motion/drivers";
import { icons } from "../ui/icons";
import { t } from "../i18n";
import type { Editor } from "../app/editor";
import type { Tool } from "./types";

// ------------------------------------------------------------------ move

let grab: { body: Id; local: Vec } | null = null;

/** Into a body's sketch coordinates from world coordinates. */
function toLocal(ed: Editor, body: Id, w: Vec): Vec {
  const p = poseOf(ed.doc, body);
  const c = Math.cos(-p.a), s = Math.sin(-p.a);
  const x = w.x - p.x, y = w.y - p.y;
  return { x: c * x - s * y, y: s * x + c * y };
}

/** Motion mode: drag any point of a bar; the mechanism follows. Click to select a body or joint. */
export const moveTool: Tool = {
  id: "move",
  label: "tool.move",
  icon: icons.move,
  shortcut: "s",
  modes: ["motion"],
  hint: "hint.move",
  down(ed, e) {
    const h = e.hit;
    grab = null;
    if (!h) {
      ed.select([]);
      return;
    }
    ed.select([h.id]);
    if (h.kind === "body") {
      grab = { body: h.id, local: toLocal(ed, h.id, e.world) };
      ed.beginDrag();
    }
  },
  move(ed, e) {
    if (!grab) return;
    ed.motionDrag({ body: grab.body, local: grab.local, to: e.world });
  },
  up(ed) {
    if (!grab) return;
    grab = null;
    ed.endDrag();
  },
  cancel() {
    return false;
  },
  overlay({ ctx, ed }) {
    if (!grab) return;
    const at = ed.view.toScreen(applyPose(poseOf(ed.doc, grab.body), grab.local));
    ctx.fillStyle = "#f28c18";
    ctx.beginPath();
    ctx.arc(at.x, at.y, 3.5, 0, Math.PI * 2);
    ctx.fill();
  },
};

// ----------------------------------------------------------------- drive

let picks: Id[] = [];

function createDriver(ed: Editor, joint: Id, a: Id, b: Id) {
  if (Object.values(ed.doc.motion.drivers).some((d) => d.joint === joint)) {
    ed.flash(t("drive.exists"));
  } else {
    ed.change((doc) => addDriver(doc, joint, a, b));
    ed.flash(t("drive.added"));
  }
  picks = [];
  ed.select([joint]);
}

/**
 * Motion mode: add a slider. Click the body it measures from, then the body
 * that moves, then the joint between them (picked for you if there is only
 * one). Clicking a joint straight away works too.
 */
export const driveTool: Tool = {
  id: "drive",
  label: "tool.drive",
  icon: icons.drive,
  shortcut: "d",
  modes: ["motion"],
  hint: "hint.drive1",
  hintText(ed) {
    if (ed.message) return ed.message;
    return t(picks.length === 0 ? "hint.drive1" : picks.length === 1 ? "hint.drive2" : "hint.drive3");
  },
  activate(ed) {
    picks = [];
    ed.select([]);
  },
  cancel(ed) {
    if (!picks.length) return false;
    picks = [];
    ed.select([]);
    return true;
  },
  down(ed, e) {
    const h = e.hit;
    const m = ed.mech;
    if (h?.kind === "joint") {
      const j = m.joint(h.id)!;
      const [a, b] = picks.length === 2 && new Set(picks).has(j.a) && new Set(picks).has(j.b) ? picks : [j.a, j.b];
      createDriver(ed, j.id, a, b);
      return;
    }
    if (h?.kind !== "body") return;
    if (picks.length === 2 || picks[0] === h.id) picks = [];
    picks.push(h.id);
    ed.select(picks);
    if (picks.length === 2) {
      const between = m.joints.filter((j) => (j.a === picks[0] && j.b === picks[1]) || (j.a === picks[1] && j.b === picks[0]));
      if (between.length === 1) createDriver(ed, between[0].id, picks[0], picks[1]);
      else if (between.length === 0) {
        ed.flash(t("drive.notJoined"));
        picks = [picks[1]];
        ed.select(picks);
      }
    }
  },
};
