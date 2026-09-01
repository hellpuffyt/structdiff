/** A JSON-compatible value as parsed from JSON or YAML input. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/** A path segment: an object key or an array index. */
export type PathSegment = string | number;

/** The kind of change a single diff operation represents. */
export type DiffOpType =
  | "unchanged"
  | "added"
  | "removed"
  | "changed"
  | "moved"
  | "renamed"
  | "moved-renamed";

export interface DiffOp {
  type: DiffOpType;
  /** Path in the old document, absent for pure "added" ops. */
  oldPath?: PathSegment[];
  /** Path in the new document, absent for pure "removed" ops. */
  newPath?: PathSegment[];
  oldValue?: JsonValue;
  newValue?: JsonValue;
}

export interface DiffResult {
  ops: DiffOp[];
  stats: {
    unchanged: number;
    added: number;
    removed: number;
    changed: number;
    moved: number;
    renamed: number;
    movedRenamed: number;
  };
}

export interface DiffOptions {
  /**
   * Minimum canonical-JSON string length for a primitive value to be
   * eligible for move/rename matching. Short, common primitives (small
   * numbers, booleans, short strings) are excluded to avoid coincidental
   * matches. Objects and arrays with at least one member are always
   * eligible. Default: 5.
   */
  minMatchLength?: number;
}
