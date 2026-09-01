import { describe, expect, it } from "vitest";
import { canonicalStringify, fnv1a, hashValue } from "../src/core/hash.js";

describe("canonicalStringify", () => {
  it("sorts object keys so insertion order does not matter", () => {
    const a = { b: 1, a: 2 };
    const b = { a: 2, b: 1 };
    expect(canonicalStringify(a)).toBe(canonicalStringify(b));
  });

  it("preserves array order (arrays are positional)", () => {
    expect(canonicalStringify([1, 2, 3])).not.toBe(canonicalStringify([3, 2, 1]));
  });

  it("distinguishes primitive types with equal textual form", () => {
    expect(canonicalStringify("1")).not.toBe(canonicalStringify(1));
  });

  it("renders null and nested structures", () => {
    expect(canonicalStringify(null)).toBe("null");
    expect(canonicalStringify({ x: [1, { y: null }] })).toBe('{"x":[1,{"y":null}]}');
  });

  it("escapes strings via JSON.stringify", () => {
    expect(canonicalStringify('a"b')).toBe('"a\\"b"');
  });
});

describe("fnv1a", () => {
  it("is deterministic", () => {
    expect(fnv1a("hello")).toBe(fnv1a("hello"));
  });

  it("returns an 8-character lowercase hex string", () => {
    expect(fnv1a("hello")).toMatch(/^[0-9a-f]{8}$/);
    expect(fnv1a("")).toMatch(/^[0-9a-f]{8}$/);
  });

  it("differs for different input", () => {
    expect(fnv1a("hello")).not.toBe(fnv1a("hellp"));
  });
});

describe("hashValue", () => {
  it("is stable across key reordering", () => {
    expect(hashValue({ a: 1, b: 2 })).toBe(hashValue({ b: 2, a: 1 }));
  });

  it("differs when a value differs", () => {
    expect(hashValue({ a: 1 })).not.toBe(hashValue({ a: 2 }));
  });
});
