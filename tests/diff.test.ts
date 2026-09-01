import { describe, expect, it } from "vitest";
import { diffValues } from "../src/core/diff.js";
import { formatPath } from "../src/core/path.js";
import type { DiffOp } from "../src/core/types.js";

function opsOfType(ops: DiffOp[], type: DiffOp["type"]): DiffOp[] {
  return ops.filter((op) => op.type === type);
}

describe("diffValues: identical documents", () => {
  it("reports everything unchanged and no other ops", () => {
    const doc = { name: "svc", port: 8080, tags: ["a", "b"] };
    const result = diffValues(doc, structuredClone(doc));
    expect(result.stats.unchanged).toBe(1); // whole subtree identical => single unchanged op
    expect(result.ops).toHaveLength(1);
    expect(result.ops[0]!.type).toBe("unchanged");
  });

  it("handles two empty objects", () => {
    const result = diffValues({}, {});
    expect(result.ops).toHaveLength(1);
    expect(result.ops[0]!.type).toBe("unchanged");
  });
});

describe("diffValues: plain add/remove/change", () => {
  it("detects an added key", () => {
    const result = diffValues({ a: 1 }, { a: 1, b: 2 });
    expect(result.stats.added).toBe(1);
    const op = opsOfType(result.ops, "added")[0]!;
    expect(formatPath(op.newPath!)).toBe("b");
    expect(op.newValue).toBe(2);
  });

  it("detects a removed key", () => {
    const result = diffValues({ a: 1, b: 2 }, { a: 1 });
    expect(result.stats.removed).toBe(1);
    const op = opsOfType(result.ops, "removed")[0]!;
    expect(formatPath(op.oldPath!)).toBe("b");
    expect(op.oldValue).toBe(2);
  });

  it("detects a changed primitive value at the same path", () => {
    const result = diffValues({ port: 8080 }, { port: 9090 });
    expect(result.stats.changed).toBe(1);
    const op = opsOfType(result.ops, "changed")[0]!;
    expect(formatPath(op.newPath!)).toBe("port");
    expect(op.oldValue).toBe(8080);
    expect(op.newValue).toBe(9090);
  });

  it("treats a type change (object -> primitive) at the same key as remove+add", () => {
    const result = diffValues({ db: { host: "localhost" } }, { db: "sqlite" });
    expect(result.stats.removed).toBe(1);
    expect(result.stats.added).toBe(1);
    expect(result.stats.changed).toBe(0);
  });
});

describe("diffValues: renamed keys", () => {
  it("detects a key renamed in place (same parent, equal value)", () => {
    const oldDoc = { username: "long enough value to match" };
    const newDoc = { userName: "long enough value to match" };
    const result = diffValues(oldDoc, newDoc);
    expect(result.stats.renamed).toBe(1);
    expect(result.stats.added).toBe(0);
    expect(result.stats.removed).toBe(0);
    const op = opsOfType(result.ops, "renamed")[0]!;
    expect(formatPath(op.oldPath!)).toBe("username");
    expect(formatPath(op.newPath!)).toBe("userName");
  });

  it("detects a whole object subtree renamed", () => {
    const oldDoc = { database: { host: "db.internal", port: 5432, name: "prod" } };
    const newDoc = { datastore: { host: "db.internal", port: 5432, name: "prod" } };
    const result = diffValues(oldDoc, newDoc);
    expect(result.stats.renamed).toBe(1);
    const op = opsOfType(result.ops, "renamed")[0]!;
    expect(formatPath(op.oldPath!)).toBe("database");
    expect(formatPath(op.newPath!)).toBe("datastore");
  });
});

describe("diffValues: moved keys", () => {
  it("detects a key moved to a different parent, same key name", () => {
    const oldDoc = { a: { timeout: "thirty seconds exactly" }, b: {} };
    const newDoc = { a: {}, b: { timeout: "thirty seconds exactly" } };
    const result = diffValues(oldDoc, newDoc);
    expect(result.stats.moved).toBe(1);
    const op = opsOfType(result.ops, "moved")[0]!;
    expect(formatPath(op.oldPath!)).toBe("a.timeout");
    expect(formatPath(op.newPath!)).toBe("b.timeout");
  });

  it("detects a key both moved and renamed", () => {
    const oldDoc = { network: { retryLimit: "five retries with backoff" } };
    const newDoc = { http: { maxRetries: "five retries with backoff" } };
    const result = diffValues(oldDoc, newDoc);
    expect(result.stats.movedRenamed).toBe(1);
    const op = opsOfType(result.ops, "moved-renamed")[0]!;
    expect(formatPath(op.oldPath!)).toBe("network.retryLimit");
    expect(formatPath(op.newPath!)).toBe("http.maxRetries");
  });
});

describe("diffValues: matchability heuristics", () => {
  it("does not treat two unrelated short/common values as a move", () => {
    // "true" and small numbers are common enough that pairing them as a
    // rename/move would be a false positive rather than a real signal.
    const oldDoc = { debug: true, retries: 1 };
    const newDoc = { verbose: true, attempts: 1 };
    const result = diffValues(oldDoc, newDoc);
    expect(result.stats.renamed).toBe(0);
    expect(result.stats.moved).toBe(0);
    expect(result.stats.added).toBe(2);
    expect(result.stats.removed).toBe(2);
  });

  it("does not match empty objects/arrays against each other", () => {
    const oldDoc = { a: {}, b: [] };
    const newDoc = { c: {}, d: [] };
    const result = diffValues(oldDoc, newDoc);
    expect(result.stats.renamed).toBe(0);
    expect(result.stats.added).toBe(2);
    expect(result.stats.removed).toBe(2);
  });

  it("respects a custom minMatchLength option", () => {
    const oldDoc = { a: "abc" };
    const newDoc = { z: "abc" };
    const strict = diffValues(oldDoc, newDoc, { minMatchLength: 10 });
    expect(strict.stats.renamed).toBe(0);
    const lenient = diffValues(oldDoc, newDoc, { minMatchLength: 2 });
    expect(lenient.stats.renamed).toBe(1);
  });

  it("does not pair ambiguous duplicate values (non-unique hash on either side)", () => {
    const oldDoc = { a: "distinctive value one", b: "distinctive value one" };
    const newDoc = { c: "distinctive value one" };
    const result = diffValues(oldDoc, newDoc);
    // Two old candidates share a hash with only one new candidate: ambiguous, no match.
    expect(result.stats.renamed).toBe(0);
    expect(result.stats.moved).toBe(0);
    expect(result.stats.removed).toBe(2);
    expect(result.stats.added).toBe(1);
  });
});

describe("diffValues: arrays", () => {
  it("reports unchanged for identical arrays", () => {
    const result = diffValues({ list: [1, 2, 3] }, { list: [1, 2, 3] });
    expect(result.ops).toHaveLength(1);
    expect(result.ops[0]!.type).toBe("unchanged");
  });

  it("detects an item moved within an array by position", () => {
    const result = diffValues({ list: ["a", "b", "c"] }, { list: ["b", "c", "a"] });
    // All three items survive by content (LCS keeps the longest run:
    // "b","c" in place, "a" moves from index 0 to index 2).
    expect(result.stats.moved).toBeGreaterThanOrEqual(1);
    expect(result.stats.added).toBe(0);
    expect(result.stats.removed).toBe(0);
  });

  it("detects an appended array item as added, not a rewrite of every index", () => {
    const result = diffValues({ list: ["a", "b"] }, { list: ["a", "b", "c"] });
    expect(result.stats.added).toBe(1);
    expect(result.stats.removed).toBe(0);
    const op = opsOfType(result.ops, "added")[0]!;
    expect(formatPath(op.newPath!)).toBe("list[2]");
  });

  it("detects a removed array item", () => {
    const result = diffValues({ list: ["a", "b", "c"] }, { list: ["a", "c"] });
    expect(result.stats.removed).toBe(1);
    const op = opsOfType(result.ops, "removed")[0]!;
    expect(formatPath(op.oldPath!)).toBe("list[1]");
  });

  it("diffs objects nested inside array elements", () => {
    const oldDoc = { items: [{ id: 1, name: "one" }] };
    const newDoc = { items: [{ id: 1, name: "uno" }] };
    const result = diffValues(oldDoc, newDoc);
    expect(result.stats.changed).toBe(1);
    const op = opsOfType(result.ops, "changed")[0]!;
    expect(formatPath(op.newPath!)).toBe("items[0].name");
  });

  it("recognizes a fully reversed array as pure reordering, not paired replacements", () => {
    // A full reversal is the worst case for a plain LCS: no order-preserving
    // subsequence longer than 1 element exists, even though every value is
    // still present on both sides. Each element should still be "moved".
    const result = diffValues(
      { list: ["alpha-value", "bravo-value", "charlie-value"] },
      { list: ["charlie-value", "bravo-value", "alpha-value"] },
    );
    expect(result.stats.moved).toBeGreaterThanOrEqual(2);
    expect(result.stats.moved + result.stats.unchanged).toBe(3);
    expect(result.stats.changed).toBe(0);
    expect(result.stats.added).toBe(0);
    expect(result.stats.removed).toBe(0);
  });

  it("treats an array replaced by an object at the same key as remove+add", () => {
    const result = diffValues({ x: [1, 2] }, { x: { a: 1 } });
    expect(result.stats.removed).toBe(1);
    expect(result.stats.added).toBe(1);
  });
});

describe("diffValues: nested realistic config", () => {
  it("finds a rename buried under an unchanged sibling tree", () => {
    const oldDoc = {
      server: { host: "0.0.0.0", port: 8080 },
      logging: { level: "info", format: "json output structured" },
    };
    const newDoc = {
      server: { host: "0.0.0.0", port: 8080 },
      logging: { level: "info", layout: "json output structured" },
    };
    const result = diffValues(oldDoc, newDoc);
    expect(result.stats.renamed).toBe(1);
    const op = opsOfType(result.ops, "renamed")[0]!;
    expect(formatPath(op.oldPath!)).toBe("logging.format");
    expect(formatPath(op.newPath!)).toBe("logging.layout");
  });
});

describe("diffValues: stats add up", () => {
  it("counts every op exactly once across categories", () => {
    const oldDoc = { a: 1, b: 2, keep: { x: 1 } };
    const newDoc = { a: 1, c: 2, keep: { x: 1 } };
    const result = diffValues(oldDoc, newDoc);
    const total =
      result.stats.unchanged +
      result.stats.added +
      result.stats.removed +
      result.stats.changed +
      result.stats.moved +
      result.stats.renamed +
      result.stats.movedRenamed;
    expect(total).toBe(result.ops.length);
  });
});
