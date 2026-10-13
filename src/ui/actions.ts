import { Registry } from "../core/registry";
import { addConstraint, addPoint, deleteItems, emptyDoc, geomPoints, type Id } from "../core/model";
import type { Editor, Mode } from "../app/editor";
import { nextBodyName, ownerMap } from "../motion/bodies";
import { t } from "../i18n";
import { constraintTypes } from "../constraints";
import { downloadDoc, pickFile } from "../io/file";
import { icons, constraintIcon } from "./icons";
import { pendingConstraint, startConstraintPick } from "../tools/constraintPick";
import { setTool, switchMode } from "./toolbar";

export interface Action {
  id: string;
  /** i18n key. */
  label: string;
  icon: string;
  shortcut?: string;
  ctrl?: boolean;
  shift?: boolean;
  /** Toolbar group; actions without one only have a shortcut. */
  group?: "edit" | "constraint" | "view" | "file" | "body" | "motion";
  /** Modes the action works in (default: both). */
  modes?: Mode[];
  run(ed: Editor): void;
  /** Toggle actions show as pressed when this returns true. */
  active?(ed: Editor): boolean;
}

export const actions = new Registry<Action>("actions");

function toggleFlag(ed: Editor, flag: "construction" | "track") {
  const ids = [...ed.selection].filter((id) => id in ed.doc.geoms);
  if (!ids.length) return;
  const on = !ids.every((id) => ed.doc.geoms[id][flag]);
  ed.change((doc) => ids.forEach((id) => (doc.geoms[id][flag] = on)));
}

export function actionInMode(a: Action, mode: Mode): boolean {
  return (a.modes ?? ["sketch", "motion"]).includes(mode);
}

/** Bodies the selection points at: selected bodies, or the bodies of selected geometry. */
function selectedBodies(ed: Editor): Id[] {
  const own = ownerMap(ed.doc);
  const out = new Set<Id>();
  for (const id of ed.selection) {
    if (ed.doc.bodies[id]) out.add(id);
    else if (own.has(id)) out.add(own.get(id)!);
  }
  return [...out];
}

const SKETCH: Mode[] = ["sketch"];
const MOTION: Mode[] = ["motion"];

const builtins: Action[] = [
  { id: "construction", label: "action.construction", icon: icons.construction, shortcut: "x", group: "edit", modes: SKETCH, run: (ed) => toggleFlag(ed, "construction") },
  { id: "track", label: "action.track", icon: icons.track, shortcut: "k", group: "edit", modes: SKETCH, run: (ed) => toggleFlag(ed, "track") },
  {
    id: "delete",
    label: "action.delete",
    icon: icons.delete,
    shortcut: "delete",
    group: "edit",
    run(ed) {
      const ids = [...ed.selection];
      if (!ids.length) return;
      if (ed.mode === "motion") {
        // In Motion mode only sliders can be deleted; the sketch stays as it is.
        const drivers = Object.values(ed.doc.motion.drivers).filter((d) => ids.includes(d.id) || ids.includes(d.joint));
        if (drivers.length) ed.change((doc) => drivers.forEach((d) => delete doc.motion.drivers[d.id]));
        return;
      }
      ed.change((doc) => deleteItems(doc, ids));
    },
  },
  { id: "backspace", label: "action.delete", icon: icons.delete, shortcut: "backspace", run: (ed) => actions.get("delete").run(ed) },
  { id: "undo", label: "action.undo", icon: icons.undo, shortcut: "z", ctrl: true, shift: false, group: "edit", run: (ed) => ed.undo() },
  { id: "redo", label: "action.redo", icon: icons.redo, shortcut: "y", ctrl: true, group: "edit", run: (ed) => ed.redo() },
  { id: "redo2", label: "action.redo", icon: icons.redo, shortcut: "z", ctrl: true, shift: true, run: (ed) => ed.redo() },
  {
    id: "icons",
    label: "action.icons",
    icon: icons.icons,
    shortcut: "i",
    group: "view",
    modes: SKETCH,
    run: (ed) => ed.live((doc) => (doc.settings.showConstraintIcons = !doc.settings.showConstraintIcons)),
    active: (ed) => ed.doc.settings.showConstraintIcons,
  },
  {
    id: "fit",
    label: "action.fit",
    icon: icons.fit,
    shortcut: "f",
    shift: false,
    group: "view",
    run(ed) {
      const canvas = document.querySelector("canvas")!;
      ed.view.fit(Object.values(ed.doc.points), canvas.clientWidth, canvas.clientHeight);
      ed.emit();
    },
  },
  {
    id: "new",
    label: "action.new",
    icon: icons.new,
    shortcut: "n",
    shift: true,
    group: "file",
    run: (ed) => ed.change((doc) => Object.assign(doc, emptyDoc(), { settings: doc.settings })),
  },
  {
    id: "open",
    label: "action.open",
    icon: icons.open,
    shortcut: "o",
    ctrl: true,
    group: "file",
    run: (ed) =>
      pickFile()
        .then((doc) => {
          ed.load(doc);
          actions.get("fit").run(ed);
        })
        .catch((e: Error) => ed.flash(e.message)),
  },
  { id: "save", label: "action.save", icon: icons.save, shortcut: "s", ctrl: true, group: "file", run: (ed) => downloadDoc(ed.doc) },
  {
    id: "makeBody",
    label: "action.makeBody",
    icon: icons.body,
    shortcut: "b",
    shift: false,
    group: "body",
    modes: SKETCH,
    run(ed) {
      const ids = [...ed.selection].filter((id) => ed.doc.geoms[id] || ed.doc.points[id]);
      if (!ids.length) return ed.flash(t("hint.makeBody"));
      let created: Id = "";
      ed.change((doc) => {
        // A selected end point of geometry outside the selection becomes a
        // new point pinned to it, so the two bodies join there.
        const used = new Set(Object.values(doc.geoms).filter((g) => !ids.includes(g.id)).flatMap((g) => geomPoints(g)));
        ids.forEach((id, i) => {
          if (!doc.points[id] || !used.has(id)) return;
          const p = addPoint(doc, doc.points[id].x, doc.points[id].y);
          addConstraint(doc, { type: "coincident", refs: [id, p] });
          ids[i] = p;
        });
        // An item belongs to one body only.
        for (const b of Object.values(doc.bodies)) b.members = b.members.filter((m) => !ids.includes(m));
        for (const b of Object.values(doc.bodies)) if (!b.members.length) delete doc.bodies[b.id];
        created = `b${doc.nextId++}`;
        doc.bodies[created] = { id: created, name: nextBodyName(doc, t("body.name")), members: ids };
      });
      ed.select([created]);
    },
  },
  {
    id: "ground",
    label: "action.ground",
    icon: icons.ground,
    shortcut: "g",
    group: "body",
    run(ed) {
      const ids = selectedBodies(ed);
      if (!ids.length) return ed.flash(t("hint.ground"));
      const on = !ids.every((id) => ed.doc.bodies[id].ground);
      ed.change((doc) => ids.forEach((id) => (doc.bodies[id].ground = on)));
    },
    active: (ed) => {
      const ids = selectedBodies(ed);
      return ids.length > 0 && ids.every((id) => ed.doc.bodies[id].ground);
    },
  },
  {
    id: "bars",
    label: "action.bars",
    icon: icons.bars,
    shortcut: "b",
    shift: true,
    group: "view",
    modes: SKETCH,
    run: (ed) => ed.live((doc) => (doc.settings.solidBars = !doc.settings.solidBars)),
    active: (ed) => ed.doc.settings.solidBars,
  },
  {
    id: "flip",
    label: "action.flip",
    icon: icons.flip,
    shortcut: "f",
    shift: true,
    group: "motion",
    modes: MOTION,
    run: (ed) => {
      if (!ed.flip()) ed.flash(t("motion.noFlip"));
    },
  },
  { id: "resetPose", label: "action.resetPose", icon: icons.reset, shortcut: "r", shift: false, group: "motion", modes: MOTION, run: (ed) => ed.resetPose() },
  { id: "mode", label: "action.mode", icon: icons.motion, shortcut: "tab", run: (ed) => switchMode(ed, ed.mode === "sketch" ? "motion" : "sketch") },
];
builtins.forEach((a) => actions.register(a));

// Every non-dimension constraint type becomes an action automatically.
for (const c of constraintTypes.all()) {
  if (c.dimension || c.hidden) continue;
  actions.register({
    id: `constraint:${c.id}`,
    label: c.label,
    icon: constraintIcon(c.id, c.glyph),
    shortcut: c.shortcut,
    group: "constraint",
    modes: SKETCH,
    // Apply to the selection if it fits; otherwise pick the items next.
    run: (ed) => {
      if (!ed.applyConstraint(c.id, true)) startConstraintPick(ed, c.id, (id) => setTool(ed, id));
    },
    active: (ed) => ed.tool === "constraint" && pendingConstraint() === c.id,
  });
}
