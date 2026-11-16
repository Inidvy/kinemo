/**
 * Remember the last answer of `f` for as long as every part is the very same
 * object as last time. Parts of a document keep their identity until they
 * are edited, so this skips work on frames where only something else changed.
 */
export function sameParts<T>(f: (parts: readonly unknown[]) => T): (parts: readonly unknown[]) => T {
  let last: { parts: readonly unknown[]; value: T } | null = null;
  return (parts) => {
    if (last && parts.length === last.parts.length && parts.every((p, i) => p === last!.parts[i])) return last.value;
    last = { parts, value: f(parts) };
    return last.value;
  };
}
