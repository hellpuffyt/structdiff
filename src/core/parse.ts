import { parse as parseYaml } from "yaml";
import type { JsonValue } from "./types.js";

export type InputFormat = "json" | "yaml";

export class ParseError extends Error {
  constructor(
    message: string,
    public readonly format: InputFormat,
  ) {
    super(message);
    this.name = "ParseError";
  }
}

/** Guess the format from a file extension. Defaults to "yaml" (a superset of JSON). */
export function formatFromFilename(filename: string): InputFormat {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".yaml") || lower.endsWith(".yml")) return "yaml";
  return "yaml";
}

/** Parse a JSON or YAML source string into a plain JS value tree. */
export function parseDocument(source: string, format: InputFormat): JsonValue {
  try {
    if (format === "json") {
      return JSON.parse(source) as JsonValue;
    }
    const value = parseYaml(source) as JsonValue | undefined;
    return value === undefined ? null : value;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ParseError(`Failed to parse ${format.toUpperCase()}: ${message}`, format);
  }
}
