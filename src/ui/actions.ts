import { Registry } from "../core/registry";
import { deleteItems, emptyDoc } from "../core/model";
import type { Editor } from "../app/editor";
import { constraintTypes } from "../constraints";
import { downloadDoc, pickFile } from "../io/file";
import { icons, glyphIcon } from "./icons";

export interface Action {
  id: string;
  /** i18n key. */
  label: string;
  icon: string;
  shortcut?: string;
  ctrl?: boolean;
  shift?: boolean;
  /** Toolbar group; actions without one only have a shortcut. */
  group?: "edit" | "constraint" | "view" | "file";
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

const builtins: Action[] = [
  { id: "construction", label: "action.construction", icon: icons.construction, shortcut: "x", group: "edit", run: (ed) => toggleFlag(ed, "construction") },
  { id: "track", label: "action.track", icon: icons.track, shortcut: "k", group: "edit", run: (ed) => toggleFlag(ed, "track") },
  {
    id: "delete",
    label: "action.delete",
    icon: icons.delete,
    shortcut: "delete",
    group: "edit",
    run(ed) {
      const ids = [...ed.selection];
      if (ids.length) ed.change((doc) => deleteItems(doc, ids));
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
    run: (ed) => ed.live((doc) => (doc.settings.showConstraintIcons = !doc.settings.showConstraintIcons)),
    active: (ed) => ed.doc.settings.showConstraintIcons,
  },
  {
    id: "fit",
    label: "action.fit",
    icon: icons.fit,
    shortcut: "f",
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
];
builtins.forEach((a) => actions.register(a));

// Every non-dimension constraint type becomes an action automatically.
for (const c of constraintTypes.all()) {
  if (c.dimension) continue;
  actions.register({
    id: `constraint:${c.id}`,
    label: c.label,
    icon: glyphIcon(c.glyph),
    shortcut: c.shortcut,
    group: "constraint",
    run: (ed) => ed.applyConstraint(c.id),
  });
}
