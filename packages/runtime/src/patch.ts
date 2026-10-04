// JSON Patch (RFC 6902): add, remove, replace, move, copy and test, applied
// immutably. The editor writes documents only through patches, so every edit
// is data that can be logged, replayed and undone.

/** Any JSON value. */
export type Json = string | number | boolean | null | readonly Json[] | { readonly [key: string]: Json };

export type PatchOperation =
  | { readonly op: "add" | "replace" | "test"; readonly path: string; readonly value: Json }
  | { readonly op: "remove"; readonly path: string }
  | { readonly op: "move" | "copy"; readonly from: string; readonly path: string };

export type PatchResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string; readonly index: number };

/** Splits a JSON Pointer into unescaped segments. "" is the whole document. */
export function parsePointer(pointer: string): string[] {
  if (pointer === "") return [];
  if (!pointer.startsWith("/")) throw new Error(`"${pointer}" is not a JSON Pointer (it must start with "/").`);
  return pointer
    .slice(1)
    .split("/")
    .map((s) => s.replaceAll("~1", "/").replaceAll("~0", "~"));
}

const isObject = (v: Json): v is { readonly [key: string]: Json } => typeof v === "object" && v !== null && !Array.isArray(v);

function get(doc: Json, segments: readonly string[]): Json {
  let node = doc;
  for (const s of segments) {
    if (Array.isArray(node)) {
      const i = arrayIndex(s, node.length - 1);
      node = node[i] as Json;
    } else if (isObject(node) && Object.hasOwn(node, s)) {
      node = node[s] as Json;
    } else {
      throw new Error(`Nothing at "/${segments.join("/")}".`);
    }
  }
  return node;
}

function arrayIndex(segment: string, max: number): number {
  if (!/^(0|[1-9]\d*)$/.test(segment)) throw new Error(`"${segment}" is not an array index.`);
  const i = Number(segment);
  if (i > max) throw new Error(`Index ${i} is out of range.`);
  return i;
}

/** Returns a copy of `doc` with `fn` applied to the container at `segments`' parent. */
function update(doc: Json, segments: readonly string[], fn: (parent: Json, key: string) => Json): Json {
  if (segments.length === 0) throw new Error("This operation needs a path inside the document.");
  const [head, ...rest] = segments as [string, ...string[]];
  if (rest.length === 0) return fn(doc, head);
  if (Array.isArray(doc)) {
    const i = arrayIndex(head, doc.length - 1);
    const copy = [...doc];
    copy[i] = update(doc[i] as Json, rest, fn);
    return copy;
  }
  if (isObject(doc) && Object.hasOwn(doc, head)) return { ...doc, [head]: update(doc[head] as Json, rest, fn) };
  throw new Error(`Nothing at "${head}".`);
}

function add(doc: Json, segments: readonly string[], value: Json): Json {
  if (segments.length === 0) return value;
  return update(doc, segments, (parent, key) => {
    if (Array.isArray(parent)) {
      const i = key === "-" ? parent.length : arrayIndex(key, parent.length);
      return [...parent.slice(0, i), value, ...parent.slice(i)];
    }
    if (isObject(parent)) return { ...parent, [key]: value };
    throw new Error(`Cannot add "${key}" to a ${parent === null ? "null" : typeof parent}.`);
  });
}

function remove(doc: Json, segments: readonly string[]): Json {
  return update(doc, segments, (parent, key) => {
    if (Array.isArray(parent)) {
      const i = arrayIndex(key, parent.length - 1);
      return [...parent.slice(0, i), ...parent.slice(i + 1)];
    }
    if (isObject(parent) && Object.hasOwn(parent, key)) {
      const { [key]: _removed, ...rest } = parent;
      return rest;
    }
    throw new Error(`Nothing to remove at "${key}".`);
  });
}

const equal = (a: Json, b: Json): boolean => JSON.stringify(a) === JSON.stringify(b);

function applyOne(doc: Json, op: PatchOperation): Json {
  const path = parsePointer(op.path);
  switch (op.op) {
    case "add":
      return add(doc, path, op.value);
    case "remove":
      return remove(doc, path);
    case "replace":
      get(doc, path);
      return path.length === 0 ? op.value : add(remove(doc, path), path, op.value);
    case "test":
      if (!equal(get(doc, path), op.value)) throw new Error(`Test failed at "${op.path}".`);
      return doc;
    case "copy":
      return add(doc, path, get(doc, parsePointer(op.from)));
    case "move": {
      if (op.path.startsWith(`${op.from}/`)) throw new Error("Cannot move a value into itself.");
      const value = get(doc, parsePointer(op.from));
      return add(remove(doc, parsePointer(op.from)), path, value);
    }
  }
}

/** Applies a patch atomically: all operations succeed, or nothing changes and the failing index is reported. */
export function applyPatch<T>(doc: T, patch: readonly PatchOperation[]): PatchResult<T> {
  let current = doc as unknown as Json;
  for (const [index, op] of patch.entries()) {
    try {
      current = applyOne(current, op);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e), index };
    }
  }
  return { ok: true, value: current as unknown as T };
}
