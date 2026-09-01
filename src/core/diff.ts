import { canonicalStringify, hashValue } from "./hash.js";
import type { DiffOp, DiffOptions, DiffResult, JsonValue, PathSegment } from "./types.js";

const DEFAULT_MIN_MATCH_LENGTH = 5;

interface Candidate {
  path: PathSegment[];
  value: JsonValue;
  hash: string;
}

interface WalkState {
  removed: Candidate[];
  added: Candidate[];
  ops: DiffOp[];
  minMatchLength: number;
}

function isContainer(v: JsonValue): v is JsonValue[] | Record<string, JsonValue> {
  return typeof v === "object" && v !== null;
}

function isPlainObject(v: JsonValue): v is Record<string, JsonValue> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function deepEqual(a: JsonValue, b: JsonValue): boolean {
  return hashValue(a) === hashValue(b);
}

function pathsEqual(a: PathSegment[], b: PathSegment[]): boolean {
  return a.length === b.length && a.every((seg, i) => seg === b[i]);
}

/** Whether a value carries enough information to safely pair a removal with an addition. */
function isMatchable(value: JsonValue, minMatchLength: number): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (value !== null && typeof value === "object") return Object.keys(value).length > 0;
  if (typeof value === "boolean" || value === null) return false;
  if (typeof value === "string") return value.length >= minMatchLength;
  if (typeof value === "number") return String(value).length >= minMatchLength;
  return false;
}

/**
 * Registers a candidate for every node in `value`'s subtree (the node
 * itself, plus every descendant at every depth), not just its root. This
 * lets the matcher find a moved/renamed leaf even when the container it
 * lives in was also restructured, so a rename buried two levels down
 * under an otherwise-removed parent is still found.
 */
function collectCandidates(path: PathSegment[], value: JsonValue, out: Candidate[]): void {
  out.push({ path, value, hash: hashValue(value) });
  if (Array.isArray(value)) {
    value.forEach((item, i) => { collectCandidates([...path, i], item, out); });
  } else if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      collectCandidates([...path, key], child, out);
    }
  }
}

function registerRemoved(state: WalkState, path: PathSegment[], value: JsonValue): void {
  collectCandidates(path, value, state.removed);
}

function registerAdded(state: WalkState, path: PathSegment[], value: JsonValue): void {
  collectCandidates(path, value, state.added);
}

function diffNode(
  state: WalkState,
  oldVal: JsonValue,
  newVal: JsonValue,
  oldPath: PathSegment[],
  newPath: PathSegment[],
): void {
  const bothObjects = isPlainObject(oldVal) && isPlainObject(newVal);
  const bothArrays = Array.isArray(oldVal) && Array.isArray(newVal);

  if (bothObjects || bothArrays) {
    if (hashValue(oldVal) === hashValue(newVal)) {
      const type: DiffOp["type"] = pathsEqual(oldPath, newPath) ? "unchanged" : "moved";
      state.ops.push({ type, oldPath, newPath, oldValue: oldVal, newValue: newVal });
      return;
    }
    if (bothObjects) {
      diffObject(
        state,
        oldVal,
        newVal,
        oldPath,
        newPath,
      );
    } else {
      diffArray(state, oldVal as JsonValue[], newVal as JsonValue[], oldPath, newPath);
    }
    return;
  }

  if (isContainer(oldVal) || isContainer(newVal)) {
    // Type mismatch at the same location (e.g. a key changed from an
    // object to a scalar): treat as a full swap rather than a leaf change.
    registerRemoved(state, oldPath, oldVal);
    registerAdded(state, newPath, newVal);
    return;
  }

  if (deepEqual(oldVal, newVal)) {
    const type: DiffOp["type"] = pathsEqual(oldPath, newPath) ? "unchanged" : "moved";
    state.ops.push({ type, oldPath, newPath, oldValue: oldVal, newValue: newVal });
  } else {
    state.ops.push({ type: "changed", oldPath, newPath, oldValue: oldVal, newValue: newVal });
  }
}

function diffObject(
  state: WalkState,
  oldObj: Record<string, JsonValue>,
  newObj: Record<string, JsonValue>,
  oldParentPath: PathSegment[],
  newParentPath: PathSegment[],
): void {
  const keys = new Set([...Object.keys(oldObj), ...Object.keys(newObj)]);
  for (const key of keys) {
    const inOld = Object.hasOwn(oldObj, key);
    const inNew = Object.hasOwn(newObj, key);
    if (inOld && inNew) {
      diffNode(
        state,
        oldObj[key] as JsonValue,
        newObj[key] as JsonValue,
        [...oldParentPath, key],
        [...newParentPath, key],
      );
    } else if (inOld) {
      registerRemoved(state, [...oldParentPath, key], oldObj[key] as JsonValue);
    } else {
      registerAdded(state, [...newParentPath, key], newObj[key] as JsonValue);
    }
  }
}

/** Longest common subsequence of two hash arrays; returns matched index pairs in order. */
function lcsMatch(oldHashes: string[], newHashes: string[]): [number, number][] {
  const n = oldHashes.length;
  const m = newHashes.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      const rowI = dp[i]!;
      const rowI1 = dp[i + 1];
      const rowIj1 = rowI[j + 1];
      if (oldHashes[i] === newHashes[j]) {
        rowI[j] = (rowI1?.[j + 1] ?? 0) + 1;
      } else {
        rowI[j] = Math.max(rowI1?.[j] ?? 0, rowIj1 ?? 0);
      }
    }
  }
  const pairs: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (oldHashes[i] === newHashes[j]) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if ((dp[i + 1]?.[j] ?? 0) >= (dp[i]?.[j + 1] ?? 0)) {
      i++;
    } else {
      j++;
    }
  }
  return pairs;
}

function diffArray(
  state: WalkState,
  oldArr: JsonValue[],
  newArr: JsonValue[],
  oldParentPath: PathSegment[],
  newParentPath: PathSegment[],
): void {
  const oldHashes = oldArr.map((v) => hashValue(v));
  const newHashes = newArr.map((v) => hashValue(v));
  const matched = lcsMatch(oldHashes, newHashes);

  const matchedOld = new Set(matched.map(([i]) => i));
  const matchedNew = new Set(matched.map(([, j]) => j));

  for (const [oldIdx, newIdx] of matched) {
    const oldPath = [...oldParentPath, oldIdx];
    const newPath = [...newParentPath, newIdx];
    // Elements that survive the LCS have identical content by
    // construction (that is what makes them "common"), so any index
    // difference is purely a position change.
    const type: DiffOp["type"] = oldIdx === newIdx ? "unchanged" : "moved";
    state.ops.push({ type, oldPath, newPath, oldValue: oldArr[oldIdx]!, newValue: newArr[newIdx]! });
  }

  let unmatchedOld = oldArr.map((_, i) => i).filter((i) => !matchedOld.has(i));
  let unmatchedNew = newArr.map((_, j) => j).filter((j) => !matchedNew.has(j));

  // The LCS only captures one order-preserving alignment: elements whose
  // relative order was fully reversed (a swap, or an array reversed) fall
  // out of it even though the exact same values are still present on both
  // sides. Before falling back to positional pairing, greedily match any
  // remaining old/new elements with identical content (regardless of
  // order) so a pure reorder is still reported as `moved`, not as two
  // unrelated elements that happen to sit at the same index.
  const remainingNewByHash = new Map<string, number[]>();
  for (const j of unmatchedNew) {
    const h = newHashes[j]!;
    const queue = remainingNewByHash.get(h) ?? [];
    queue.push(j);
    remainingNewByHash.set(h, queue);
  }
  const stillUnmatchedOld: number[] = [];
  const consumedNew = new Set<number>();
  for (const i of unmatchedOld) {
    const queue = remainingNewByHash.get(oldHashes[i]!);
    const j = queue?.shift();
    if (j === undefined) {
      stillUnmatchedOld.push(i);
      continue;
    }
    consumedNew.add(j);
    const oldPath = [...oldParentPath, i];
    const newPath = [...newParentPath, j];
    state.ops.push({
      type: i === j ? "unchanged" : "moved",
      oldPath,
      newPath,
      oldValue: oldArr[i]!,
      newValue: newArr[j]!,
    });
  }
  unmatchedOld = stillUnmatchedOld;
  unmatchedNew = unmatchedNew.filter((j) => !consumedNew.has(j));

  // Elements outside the LCS are aligned positionally (first-remaining to
  // first-remaining) and diffed recursively, so a modified array element
  // (e.g. one field changed inside an object element) is reported as a
  // targeted change rather than a whole-element remove+add. Any surplus
  // on either side, once the shorter side is exhausted, is a genuine
  // addition or removal.
  const pairCount = Math.min(unmatchedOld.length, unmatchedNew.length);
  for (let k = 0; k < pairCount; k++) {
    const oldIdx = unmatchedOld[k]!;
    const newIdx = unmatchedNew[k]!;
    diffNode(
      state,
      oldArr[oldIdx] as JsonValue,
      newArr[newIdx] as JsonValue,
      [...oldParentPath, oldIdx],
      [...newParentPath, newIdx],
    );
  }
  for (let k = pairCount; k < unmatchedOld.length; k++) {
    const oldIdx = unmatchedOld[k]!;
    registerRemoved(state, [...oldParentPath, oldIdx], oldArr[oldIdx] as JsonValue);
  }
  for (let k = pairCount; k < unmatchedNew.length; k++) {
    const newIdx = unmatchedNew[k]!;
    registerAdded(state, [...newParentPath, newIdx], newArr[newIdx] as JsonValue);
  }
}

function parentOf(path: PathSegment[]): PathSegment[] {
  return path.slice(0, -1);
}

/** True when `path` is `ancestor` or lies underneath it. */
function isWithin(path: PathSegment[], ancestor: PathSegment[]): boolean {
  if (path.length < ancestor.length) return false;
  return ancestor.every((seg, i) => path[i] === seg);
}

/** A non-empty object or array: has descendant candidates of its own. */
function hasChildren(value: JsonValue): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (value !== null && typeof value === "object") return Object.keys(value).length > 0;
  return false;
}

interface MatchPair {
  oldC: Candidate;
  newC: Candidate;
  size: number;
}

function reconcileMoves(state: WalkState): void {
  const eligibleRemoved = state.removed.filter((c) => isMatchable(c.value, state.minMatchLength));
  const eligibleAdded = state.added.filter((c) => isMatchable(c.value, state.minMatchLength));

  const removedByHash = new Map<string, Candidate[]>();
  for (const c of eligibleRemoved) {
    const list = removedByHash.get(c.hash) ?? [];
    list.push(c);
    removedByHash.set(c.hash, list);
  }
  const addedByHash = new Map<string, Candidate[]>();
  for (const c of eligibleAdded) {
    const list = addedByHash.get(c.hash) ?? [];
    list.push(c);
    addedByHash.set(c.hash, list);
  }

  // Every hash that is unique on both sides is an unambiguous move/rename
  // candidate pair. Resolve the biggest (most specific, most confident)
  // matches first, so that once a whole subtree is paired, its
  // descendants are pruned instead of separately re-matched.
  const matchPairs: MatchPair[] = [];
  for (const [hash, removedList] of removedByHash) {
    const addedList = addedByHash.get(hash);
    if (!addedList || removedList.length !== 1 || addedList.length !== 1) continue;
    const oldC = removedList[0]!;
    const newC = addedList[0]!;
    if (pathsEqual(oldC.path, newC.path)) continue; // unreachable: would be "unchanged".
    matchPairs.push({ oldC, newC, size: canonicalStringify(oldC.value).length });
  }
  matchPairs.sort((a, b) => b.size - a.size);

  const consumedRemoved = new Set<Candidate>();
  const consumedAdded = new Set<Candidate>();

  for (const { oldC, newC } of matchPairs) {
    if (consumedRemoved.has(oldC) || consumedAdded.has(newC)) continue; // pruned by a bigger match

    const oldParent = parentOf(oldC.path);
    const newParent = parentOf(newC.path);
    const oldKey = oldC.path.at(-1);
    const newKey = newC.path.at(-1);
    const sameParent = pathsEqual(oldParent, newParent);
    const sameKey = oldKey === newKey;
    // A differing array index is a position change, not a "rename": only
    // a differing string key (an object key) counts as a rename.
    const isRenameableKey = typeof oldKey === "string" || typeof newKey === "string";

    let type: DiffOp["type"];
    if (sameParent && !sameKey) type = isRenameableKey ? "renamed" : "moved";
    else if (!sameParent && sameKey) type = "moved";
    else type = isRenameableKey ? "moved-renamed" : "moved";

    state.ops.push({
      type,
      oldPath: oldC.path,
      newPath: newC.path,
      oldValue: oldC.value,
      newValue: newC.value,
    });
    consumedRemoved.add(oldC);
    consumedAdded.add(newC);

    for (const c of state.removed) {
      if (c !== oldC && isWithin(c.path, oldC.path)) consumedRemoved.add(c);
    }
    for (const c of state.added) {
      if (c !== newC && isWithin(c.path, newC.path)) consumedAdded.add(c);
    }
  }

  emitLeftovers(state.removed, consumedRemoved, "removed", state.ops);
  emitLeftovers(state.added, consumedAdded, "added", state.ops);
}

/**
 * Emits ops for whatever removed/added candidates a match pass left
 * untouched. A container is reported as one whole-value op UNLESS part of
 * it was pulled out by a match elsewhere (a real move/rename) — in that
 * case the container itself would misrepresent what happened, so its
 * remaining, still-unconsumed descendants are reported individually
 * instead, in path order (shallowest first, so a parent that turns out to
 * fully explain its children is emitted before they would otherwise be).
 */
function emitLeftovers(
  candidates: Candidate[],
  consumed: Set<Candidate>,
  type: "removed" | "added",
  ops: DiffOp[],
): void {
  const absorbed = new Set<Candidate>();
  const ordered = [...candidates].sort((a, b) => a.path.length - b.path.length);

  for (const c of ordered) {
    if (consumed.has(c) || absorbed.has(c)) continue;

    if (hasChildren(c.value)) {
      const partiallyMoved = candidates.some(
        (o) => o !== c && isWithin(o.path, c.path) && consumed.has(o),
      );
      if (!partiallyMoved) {
        ops.push(
          type === "removed"
            ? { type, oldPath: c.path, oldValue: c.value }
            : { type, newPath: c.path, newValue: c.value },
        );
        for (const o of candidates) {
          if (o !== c && isWithin(o.path, c.path)) absorbed.add(o);
        }
        continue;
      }
      // Part of this container moved elsewhere: fall through without
      // emitting it, so its remaining descendants get their own ops.
      continue;
    }

    ops.push(
      type === "removed"
        ? { type, oldPath: c.path, oldValue: c.value }
        : { type, newPath: c.path, newValue: c.value },
    );
  }
}

function comparePaths(a: PathSegment[] | undefined, b: PathSegment[] | undefined): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (x === y) continue;
    if (typeof x === "number" && typeof y === "number") return x - y;
    return String(x) < String(y) ? -1 : 1;
  }
  return a.length - b.length;
}

/**
 * Computes a semantic diff between two JSON-compatible values: keys that
 * moved to a different parent, or were renamed but kept an equal value,
 * are reported as `moved` / `renamed` / `moved-renamed` instead of a
 * remove+add pair, and array elements that only changed position are
 * reported as `moved` instead of line noise.
 */
export function diffValues(
  oldVal: JsonValue,
  newVal: JsonValue,
  options: DiffOptions = {},
): DiffResult {
  const state: WalkState = {
    removed: [],
    added: [],
    ops: [],
    minMatchLength: options.minMatchLength ?? DEFAULT_MIN_MATCH_LENGTH,
  };

  diffNode(state, oldVal, newVal, [], []);
  reconcileMoves(state);

  state.ops.sort((a, b) => {
    const primary = comparePaths(a.newPath ?? a.oldPath, b.newPath ?? b.oldPath);
    if (primary !== 0) return primary;
    return comparePaths(a.oldPath, b.oldPath);
  });

  const stats = {
    unchanged: 0,
    added: 0,
    removed: 0,
    changed: 0,
    moved: 0,
    renamed: 0,
    movedRenamed: 0,
  };
  for (const op of state.ops) {
    switch (op.type) {
      case "unchanged":
        stats.unchanged++;
        break;
      case "added":
        stats.added++;
        break;
      case "removed":
        stats.removed++;
        break;
      case "changed":
        stats.changed++;
        break;
      case "moved":
        stats.moved++;
        break;
      case "renamed":
        stats.renamed++;
        break;
      case "moved-renamed":
        stats.movedRenamed++;
        break;
    }
  }

  return { ops: state.ops, stats };
}
