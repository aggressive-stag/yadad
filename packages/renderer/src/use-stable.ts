import { useRef } from "react";

/**
 * Structural equality for documents and the maps, arrays and plain objects
 * built from them. Anything else (a function, a class instance such as a data
 * adapter) is equal only to itself.
 */
export function sameContent(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (a instanceof Date || b instanceof Date) return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => sameContent(v, b[i]));
  }
  if (a instanceof Map || b instanceof Map) {
    if (!(a instanceof Map) || !(b instanceof Map) || a.size !== b.size) return false;
    for (const [k, v] of a) if (!b.has(k) || !sameContent(v, b.get(k))) return false;
    return true;
  }
  if (a instanceof Set || b instanceof Set) {
    if (!(a instanceof Set) || !(b instanceof Set) || a.size !== b.size) return false;
    for (const v of a) if (!b.has(v)) return false;
    return true;
  }
  const pa = Object.getPrototypeOf(a);
  if ((pa !== Object.prototype && pa !== null) || pa !== Object.getPrototypeOf(b)) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  const ob = b as Record<string, unknown>;
  return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && sameContent((a as Record<string, unknown>)[k], ob[k]));
}

/**
 * The previous value while the new one has equal content. Data fetches and the
 * drill-level cache depend on what a prop contains, not on whether the host
 * rebuilt the object on this render.
 */
export function useContentStable<T>(value: T): T {
  const ref = useRef(value);
  if (ref.current !== value && !sameContent(ref.current, value)) ref.current = value;
  return ref.current;
}
