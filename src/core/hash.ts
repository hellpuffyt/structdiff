import type { JsonValue } from "./types.js";

/**
 * Produces a canonical JSON string for a value: object keys are sorted
 * so that two structurally-equal values always serialize identically
 * regardless of key insertion order. This is the basis for content
 * hashing used to detect moved/renamed subtrees.
 */
export function canonicalStringify(value: JsonValue): string {
  return stringify(value);
}

function stringify(value: JsonValue): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return `[${value.map(stringify).join(",")}]`;
  }
  const obj = value as Record<string, JsonValue>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stringify(obj[k] as JsonValue)}`).join(",")}}`;
}

/**
 * A small, fast, deterministic non-cryptographic hash (FNV-1a, 32-bit,
 * returned as an 8-hex-char string). This is used only for content
 * fingerprinting to pair up moved/renamed nodes, never for security
 * purposes, so a fast pure-JS hash keeps structdiff dependency-free and
 * usable identically in Node and the browser.
 */
export function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  // Unsigned, zero-padded hex.
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Content hash of a JSON value, stable across key order. */
export function hashValue(value: JsonValue): string {
  return fnv1a(canonicalStringify(value));
}
