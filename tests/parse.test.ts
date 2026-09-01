import { describe, expect, it } from "vitest";
import { ParseError, formatFromFilename, parseDocument } from "../src/core/parse.js";

describe("formatFromFilename", () => {
  it("recognizes .json", () => {
    expect(formatFromFilename("config.json")).toBe("json");
    expect(formatFromFilename("CONFIG.JSON")).toBe("json");
  });

  it("recognizes .yaml and .yml", () => {
    expect(formatFromFilename("config.yaml")).toBe("yaml");
    expect(formatFromFilename("config.yml")).toBe("yaml");
  });

  it("defaults to yaml for unknown extensions", () => {
    expect(formatFromFilename("config.txt")).toBe("yaml");
    expect(formatFromFilename("config")).toBe("yaml");
  });
});

describe("parseDocument", () => {
  it("parses JSON", () => {
    expect(parseDocument('{"a": [1, 2, true, null]}', "json")).toEqual({ a: [1, 2, true, null] });
  });

  it("parses YAML, including a JSON document since YAML is a superset", () => {
    expect(parseDocument("a:\n  b: 1\n  c: [1, 2]\n", "yaml")).toEqual({ a: { b: 1, c: [1, 2] } });
    expect(parseDocument('{"a": 1}', "yaml")).toEqual({ a: 1 });
  });

  it("treats an empty YAML document as null", () => {
    expect(parseDocument("", "yaml")).toBeNull();
    expect(parseDocument("   \n", "yaml")).toBeNull();
  });

  it("throws a ParseError with the format on invalid JSON", () => {
    expect(() => parseDocument("{not json", "json")).toThrow(ParseError);
    try {
      parseDocument("{not json", "json");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ParseError);
      expect((err as ParseError).format).toBe("json");
      expect((err as ParseError).message).toMatch(/Failed to parse JSON/);
    }
  });

  it("throws a ParseError on invalid YAML", () => {
    expect(() => parseDocument("a: [1, 2\nb: broken", "yaml")).toThrow(ParseError);
  });
});
