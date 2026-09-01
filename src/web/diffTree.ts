import type { DiffOp, JsonValue, PathSegment } from "../core/index.js";

export interface TreeLine {
  id: string;
  depth: number;
  /** Rendered text for this line, e.g. `name:`, `- item`, `port: 8080`. */
  text: string;
  path: PathSegment[];
  isContainerHeader: boolean;
}

function pathKey(path: PathSegment[]): string {
  return JSON.stringify(path);
}

function renderScalar(value: string | number | boolean | null): string {
  if (typeof value === "string") return JSON.stringify(value);
  return String(value);
}

/**
 * Flattens a parsed JSON/YAML value into one line per node, in the
 * document's own key/element order, for a readable indented rendering.
 */
export function buildTreeLines(value: JsonValue): TreeLine[] {
  const lines: TreeLine[] = [];
  walk(value, [], 0, null, lines);
  return lines;
}

function walk(
  value: JsonValue,
  path: PathSegment[],
  depth: number,
  label: string | null,
  out: TreeLine[],
): void {
  const prefix = label !== null ? `${label}: ` : "";

  if (Array.isArray(value)) {
    if (value.length === 0) {
      out.push({ id: pathKey(path), depth, text: `${prefix}[]`, path, isContainerHeader: false });
      return;
    }
    if (label !== null) {
      out.push({ id: pathKey(path), depth, text: `${label}:`, path, isContainerHeader: true });
    }
    value.forEach((item, i) => {
      const childPath = [...path, i];
      if (item !== null && typeof item === "object") {
        walk(item, childPath, depth + 1, "-", out);
      } else {
        out.push({
          id: pathKey(childPath),
          depth: depth + 1,
          text: `- ${renderScalar(item)}`,
          path: childPath,
          isContainerHeader: false,
        });
      }
    });
    return;
  }

  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value);
    if (keys.length === 0) {
      out.push({ id: pathKey(path), depth, text: `${prefix}{}`, path, isContainerHeader: false });
      return;
    }
    if (label !== null) {
      out.push({ id: pathKey(path), depth, text: `${label}:`, path, isContainerHeader: true });
    }
    for (const key of keys) {
      const childPath = [...path, key];
      const child = value[key] as JsonValue;
      if (child !== null && typeof child === "object") {
        walk(child, childPath, depth + 1, key, out);
      } else {
        out.push({
          id: pathKey(childPath),
          depth: depth + 1,
          text: `${key}: ${renderScalar(child)}`,
          path: childPath,
          isContainerHeader: false,
        });
      }
    }
    return;
  }

  out.push({ id: pathKey(path), depth, text: `${prefix}${renderScalar(value)}`, path, isContainerHeader: false });
}

/** Indexes diff ops by their old/new path so a rendered line can look up its own status in O(1). */
export function indexOpsByPath(ops: DiffOp[]): {
  oldIndex: Map<string, DiffOp>;
  newIndex: Map<string, DiffOp>;
} {
  const oldIndex = new Map<string, DiffOp>();
  const newIndex = new Map<string, DiffOp>();
  for (const op of ops) {
    if (op.oldPath) oldIndex.set(pathKey(op.oldPath), op);
    if (op.newPath) newIndex.set(pathKey(op.newPath), op);
  }
  return { oldIndex, newIndex };
}

export function classForOp(type: DiffOp["type"] | undefined): string {
  switch (type) {
    case "added":
      return "line-added";
    case "removed":
      return "line-removed";
    case "changed":
      return "line-changed";
    case "moved":
      return "line-moved";
    case "renamed":
      return "line-renamed";
    case "moved-renamed":
      return "line-moved-renamed";
    default:
      return "";
  }
}
