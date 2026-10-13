import { en } from "./en";

let dict: Record<string, string> = en;

export function setLanguage(d: Record<string, string>): void {
  dict = d;
}

/** Translate a key, filling {placeholders}. Unknown keys show as-is. */
export function t(key: string, vars: Record<string, string | number> = {}): string {
  const s = dict[key] ?? en[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ""));
}
