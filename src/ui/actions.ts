import { Registry } from "../core/registry";
import { clipCenter, copyItems, pasteClip, type Clip } from "../core/clipboard";
import { addConstraint, addPoint, arcRadius, deleteItems, emptyDoc, geomPoints, type Id, type SketchDoc, type Vec } from "../core/model";
import type { Editor, Mode } from "../app/editor";
import { applyPose, nextBodyName, ownerMap, poseOf } from "../motion/bodies";
import { t } from "../i18n";
import { constraintTypes } from "../constraints";
import { downloadDoc, pickFile } from "../io/file";
import { icons, constraintIcon } from "./icons";
import { pendingConstraint, startConstraintPick } from "../tools/constraintPick";
import { setTool, switchMode } from "./toolbar";
import { timelinePlayer } from "./timeline";

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

/** What Ctrl+C copied, and how often it has been pasted since (each paste lands a bit further along). */
let clip: { items: Clip; pasted: number } | null = null;
const CLIP_KEY = "kinemo.clipboard";

/** Keys and playing belong to the Animation tab: open it first. */
function openAnimation(ed: Editor): boolean {
  if (!ed.animation) {
    ed.animation = true;
    ed.emit();
  }
  return true;
}

function copy(ed: Editor): boolean {
  const items = copyItems(ed.doc, [...ed.selection]);
  if (!items) {
    ed.flash(t("clip.nothing"));
    return false;
  }
  clip = { items, pasted: 0 };
  // Other tabs of the app can paste it too.
  try {
    localStorage.setItem(CLIP_KEY, JSON.stringify(items));
  } catch {
    /* storage full or blocked: this tab still has it */
  }
  ed.flash(t("clip.copied", { n: items.geoms.length + items.points.filter((p) => !items.geoms.some((g) => geomPoints(g).includes(p.id))).length }));
  return true;
}

function paste(ed: Editor): void {
  try {
    const stored = localStorage.getItem(CLIP_KEY);
    if (stored && stored !== JSON.stringify(clip?.items)) clip = { items: JSON.parse(stored) as Clip, pasted: 0 };
  } catch {
    /* use what this tab has */
  }
  if (!clip?.items.points.length) return ed.flash(t("clip.empty"));
  const c = clip;
  const center = clipCenter(c.items);
  c.pasted++;
  // At the pointer when it is over the canvas, otherwise a step down and right of the original.
  const step = ed.view.px(24) * c.pasted;
  const offset = ed.cursor ? { x: ed.cursor.x - center.x, y: ed.cursor.y - center.y } : { x: step, y: -step };
  let ids: Id[] = [];
  ed.change((doc) => (ids = pasteClip(doc, c.items, offset, (d, name) => nextBodyName(d, name))));
  ed.select(ids);
}
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
  { id: "copy", label: "action.copy", icon: icons.new, shortcut: "c", ctrl: true, modes: SKETCH, run: copy },
  { id: "cut", label: "action.cut", icon: icons.delete, shortcut: "x", ctrl: true, modes: SKETCH, run: (ed) => copy(ed) && actions.get("delete").run(ed) },
  { id: "paste", label: "action.paste", icon: icons.new, shortcut: "v", ctrl: true, modes: SKETCH, run: paste },
  { id: "duplicate", label: "action.duplicate", icon: icons.new, shortcut: "d", ctrl: true, modes: SKETCH, run: (ed) => copy(ed) && paste(ed) },
  { id: "redo2", label: "action.redo", icon: icons.redo, shortcut: "z", ctrl: true, shift: true, run: (ed) => ed.redo() },
  {
    id: "icons",
    label: "action.icons",
    icon: icons.icons,
    shortcut: "i",
    shift: false,
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
      ed.view.fit(outlinePoints(ed.doc, ed.mode === "motion"), canvas.clientWidth, canvas.clientHeight);
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
    shortcut: "g",
    shift: false,
    group: "body",
    modes: SKETCH,
    run(ed) {
      const doc0 = ed.doc;
      // The bodies the selection already touches: selected bodies, and bodies
      // a selected line, arc, circle or lone point belongs to.
      const targets = new Set<Id>();
      for (const id of ed.selection) {
        if (doc0.bodies[id]) targets.add(id);
        for (const b of Object.values(doc0.bodies)) if (b.members.includes(id)) targets.add(b.id);
      }
      if (targets.size > 1) return ed.flash(t("body.twoBodies"));
      const target = [...targets][0] as Id | undefined;
      const inTarget = new Set(target ? doc0.bodies[target].members : []);
      const owner = ownerMap(doc0);
      const ids = [...ed.selection].filter((id) => (doc0.geoms[id] || doc0.points[id]) && !(target && owner.get(id) === target));
      if (!ids.length) return ed.flash(t(target ? "body.nothingToAdd" : "hint.makeBody"));
      let created: Id = target ?? "";
      ed.change((doc) => {
        // A selected end point of geometry outside the body becomes a new
        // point pinned to it, so the two bodies join there.
        const keep = new Set([...ids, ...inTarget]);
        const used = new Set(Object.values(doc.geoms).filter((g) => !keep.has(g.id)).flatMap((g) => geomPoints(g)));
        ids.forEach((id, i) => {
          if (!doc.points[id] || !used.has(id)) return;
          const p = addPoint(doc, doc.points[id].x, doc.points[id].y);
          addConstraint(doc, { type: "coincident", refs: [id, p] });
          ids[i] = p;
        });
        // Selecting new parts with part of a body adds them to that body.
        if (target) {
          doc.bodies[target].members.push(...ids);
          return;
        }
        created = `b${doc.nextId++}`;
        doc.bodies[created] = { id: created, name: nextBodyName(doc, t("body.name")), members: ids };
      });
      ed.select([created]);
      if (target) ed.flash(t("body.added", { name: ed.doc.bodies[target].name }));
    },
  },
  {
    id: "ground",
    label: "action.ground",
    icon: icons.ground,
    shortcut: "g",
    shift: true,
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
    shortcut: "i",
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
  { id: "keyframe", label: "timeline.key", icon: icons.key, shortcut: "k", modes: MOTION, run: (ed) => openAnimation(ed) && timelinePlayer()?.key() },
  { id: "play", label: "timeline.play", icon: icons.play, shortcut: " ", modes: MOTION, run: (ed) => openAnimation(ed) && timelinePlayer()?.toggle() },
  { id: "resetPose", label: "action.resetPose", icon: icons.reset, shortcut: "r", shift: false, group: "motion", modes: MOTION, run: (ed) => ed.resetPose() },
  { id: "mode", label: "action.mode", icon: icons.motion, shortcut: "tab", run: (ed) => ((ed.animation = false), switchMode(ed, ed.mode === "sketch" ? "motion" : "sketch")) },
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

/**
 * Points that show the drawing's extent: ends of lines, points along arcs,
 * the edges of circles, and loose points. Not arc centres, which can be far
 * away for a gentle curve. In Motion mode, where the bodies are now.
 */
function outlinePoints(doc: SketchDoc, posed: boolean): Vec[] {
  const owner = ownerMap(doc);
  const at = (id: Id, p: Vec = doc.points[id]) => (posed && owner.has(id) ? applyPose(poseOf(doc, owner.get(id)!), p) : p);
  const out: Vec[] = [];
  const used = new Set<Id>();
  for (const g of Object.values(doc.geoms)) {
    geomPoints(g).forEach((id) => used.add(id));
    if (g.kind === "line") out.push(at(g.p1), at(g.p2));
    else {
      const c = doc.points[g.c];
      const r = g.kind === "circle" ? g.r : arcRadius(doc, g);
      const a0 = g.kind === "arc" ? Math.atan2(doc.points[g.s].y - c.y, doc.points[g.s].x - c.x) : 0;
      let sweep = Math.PI * 2;
      if (g.kind === "arc") {
        sweep = Math.atan2(doc.points[g.e].y - c.y, doc.points[g.e].x - c.x) - a0;
        while (sweep <= 0) sweep += Math.PI * 2;
      }
      for (let i = 0; i <= 16; i++) {
        const a = a0 + (sweep * i) / 16;
        out.push(at(g.c, { x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r }));
      }
    }
  }
  for (const id of Object.keys(doc.points)) if (!used.has(id)) out.push(at(id));
  return out.length ? out : Object.values(doc.points);
}
