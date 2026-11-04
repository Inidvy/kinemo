import { DOC_VERSION, emptyDoc, geomPoints, type SketchDoc } from "../core/model";
import { t } from "../i18n";

const AUTOSAVE_KEY = "kinemo.autosave";

/**
 * Upgrade older files step by step. Each entry upgrades from version `from`
 * to `from + 1`. Add one when a feature changes the format.
 */
const migrations: Record<number, (d: Record<string, unknown>) => void> = {
  // Version 2 added bodies and motion state; empty ones are filled in below.
  1: () => {},
  // Version 3 split Fix (sketch only) from ground points (fixed pivots in
  // Motion mode). A Fix that made a fixed pivot before becomes a ground point.
  2: (d) => {
    const doc = d as unknown as SketchDoc;
    const owned = new Set<string>();
    for (const b of Object.values(doc.bodies ?? {}))
      for (const m of b.members) {
        owned.add(m);
        const g = doc.geoms?.[m];
        if (g) geomPoints(g).forEach((p) => owned.add(p));
      }
    const cons = Object.values(doc.constraints ?? {});
    const nearBody = (p: string) => owned.has(p) || cons.some((c) => c.type === "coincident" && c.refs.includes(p) && c.refs.some((r) => owned.has(r)));
    for (const c of cons)
      if (c.type === "fix" && nearBody(c.refs[0])) {
        c.type = "groundPoint";
        delete c.data;
      }
  },
};

export function parseDoc(text: string): SketchDoc {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error(t("file.badFile"));
  }
  if (raw?.kinemo !== true || typeof raw.doc !== "object") throw new Error(t("file.badFile"));
  const doc = raw.doc as Record<string, unknown>;
  let v = Number(doc.version ?? 1);
  if (v > DOC_VERSION) throw new Error(t("file.tooNew"));
  while (v < DOC_VERSION) {
    migrations[v]?.(doc);
    v += 1;
  }
  doc.version = DOC_VERSION;
  const base = emptyDoc();
  return { ...base, ...(doc as object), settings: { ...base.settings, ...((doc.settings as object) ?? {}) } } as SketchDoc;
}

export function serialiseDoc(doc: SketchDoc): string {
  return JSON.stringify({ kinemo: true, doc }, null, 1);
}

export function autosave(doc: SketchDoc): void {
  try {
    localStorage.setItem(AUTOSAVE_KEY, serialiseDoc(doc));
  } catch {
    // Storage may be unavailable (private mode); autosave is best effort.
  }
}

export function loadAutosave(): SketchDoc | null {
  try {
    const s = localStorage.getItem(AUTOSAVE_KEY);
    return s ? parseDoc(s) : null;
  } catch {
    return null;
  }
}

export function downloadDoc(doc: SketchDoc, name = "mechanism"): void {
  const blob = new Blob([serialiseDoc(doc)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${name}.kinemo.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function pickFile(): Promise<SketchDoc> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      try {
        resolve(parseDoc(await f.text()));
      } catch (e) {
        reject(e);
      }
    };
    input.click();
  });
}

const SAVED_KEY = "kinemo.savedHash";
let savedHash: string | null = null;
try {
  savedHash = localStorage.getItem(SAVED_KEY);
} catch {
  // No storage: then only this visit's saves count.
}

/** A short fingerprint of a document (FNV-1a), to tell whether it changed since it was last saved. */
function fingerprint(doc: SketchDoc): string {
  const s = JSON.stringify(doc);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return `${s.length}:${(h >>> 0).toString(36)}`;
}

/** Remember `doc` as saved (downloaded, opened from a file, or a new empty sketch). */
export function markSaved(doc: SketchDoc): void {
  savedHash = fingerprint(doc);
  try {
    localStorage.setItem(SAVED_KEY, savedHash);
  } catch {
    // Best effort, like autosave.
  }
}

/** True when the sketch has something in it that hasn't been saved to a file. */
export function hasUnsavedWork(doc: SketchDoc): boolean {
  if (!Object.keys(doc.points).length && !Object.keys(doc.geoms).length) return false;
  return fingerprint(doc) !== savedHash;
}
