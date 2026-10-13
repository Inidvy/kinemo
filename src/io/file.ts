import { DOC_VERSION, emptyDoc, type SketchDoc } from "../core/model";
import { t } from "../i18n";

const AUTOSAVE_KEY = "kinemo.autosave";

/**
 * Upgrade older files step by step. Each entry upgrades from version `from`
 * to `from + 1`. Add one when a feature changes the format.
 */
const migrations: Record<number, (d: Record<string, unknown>) => void> = {};

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
