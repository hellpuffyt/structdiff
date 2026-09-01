import { describe, expect, it } from "vitest";
import { formatPath } from "../src/core/path.js";

describe("formatPath", () => {
  it("renders the root path as $", () => {
    expect(formatPath([])).toBe("$");
  });

  it("joins plain identifier keys with dots", () => {
    expect(formatPath(["server", "port"])).toBe("server.port");
  });

  it("renders array indices with brackets", () => {
    expect(formatPath(["ports", 0, "value"])).toBe("ports[0].value");
  });

  it("quotes keys that are not valid identifiers", () => {
    expect(formatPath(["a-b", "c d"])).toBe('["a-b"]["c d"]');
  });

  it("does not prefix the first identifier segment with a dot", () => {
    expect(formatPath(["a"])).toBe("a");
  });
});
