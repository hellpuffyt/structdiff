import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { diffValues } from "../src/core/diff.js";
import { fnv1a } from "../src/core/hash.js";
import { parseDocument } from "../src/core/parse.js";
import { isEntryPoint, parseArgs, runCli, CliUsageError, type CliIO } from "../src/cli/index.js";
import type { JsonValue } from "../src/core/types.js";

function memoryIO(files: Record<string, string>): CliIO & { out: string; err: string } {
  const io = {
    out: "",
    err: "",
    stdout(s: string) {
      io.out += s;
    },
    stderr(s: string) {
      io.err += s;
    },
    readFile(path: string) {
      const content = files[path];
      if (content === undefined) throw new Error(`ENOENT: ${path}`);
      return content;
    },
  };
  return io;
}

/** Two different strings whose JSON forms collide under 32-bit FNV-1a (found by brute force). */
function collidingStrings(): [string, string] {
  const seen = new Map<string, string>();
  for (let i = 0; ; i++) {
    const s = `v${i.toString(36)}`;
    const h = fnv1a(JSON.stringify(s));
    const other = seen.get(h);
    if (other !== undefined) return [other, s];
    seen.set(h, s);
  }
}

describe("equality is exact, not a 32-bit hash", () => {
  const [a, b] = collidingStrings();

  it("the two strings really collide under the hash", () => {
    expect(a).not.toBe(b);
    expect(fnv1a(JSON.stringify(a))).toBe(fnv1a(JSON.stringify(b)));
  });

  it("a changed value with a colliding hash is reported as changed", () => {
    const result = diffValues({ password: a }, { password: b });
    expect(result.ops.map((op) => op.type)).toEqual(["changed"]);
  });

  it("colliding containers are not short-circuited as unchanged", () => {
    const result = diffValues({ cfg: { k: a, n: 1 } }, { cfg: { k: b, n: 1 } });
    expect(result.stats.changed).toBe(1);
  });

  it("colliding array elements are not aligned as the same element", () => {
    const result = diffValues([a, "same-value"], [b, "same-value"]);
    expect(result.stats.changed).toBe(1);
    expect(result.stats.unchanged).toBe(1);
  });

  it("the CLI gate fails on such a change", () => {
    const io = memoryIO({ "old.json": JSON.stringify({ token: a }), "new.json": JSON.stringify({ token: b }) });
    expect(runCli(["old.json", "new.json", "--no-color"], io)).toBe(1);
  });
});

describe("scales to large documents", () => {
  it("20k renamed subtrees finish quickly (was ~2 minutes: quadratic candidate scans)", () => {
    const before: Record<string, JsonValue> = {};
    const after: Record<string, JsonValue> = {};
    for (let i = 0; i < 20_000; i++) {
      before[`key${i}`] = { v: `value-${i}`, w: [i, i + 1] };
      after[`renamed${i}`] = { v: `value-${i}`, w: [i, i + 1] };
    }
    const started = performance.now();
    const result = diffValues(before, after);
    expect(performance.now() - started).toBeLessThan(10_000);
    expect(result.stats.renamed).toBe(20_000);
    expect(result.stats.added + result.stats.removed).toBe(0);
  });

  it("two 30k-element arrays do not allocate an n*m LCS table", () => {
    const before = Array.from({ length: 30_000 }, (_, i) => `item-${i}`);
    const after = [...before];
    after.splice(15_000, 1, "inserted-a", "inserted-b"); // middle edit
    after.reverse(); // and a full reversal, which defeats prefix/suffix trimming
    const result = diffValues(before, after);
    // Leftovers are paired positionally: one replaced element is "changed",
    // the surplus insertion is "added".
    expect(result.stats.changed).toBe(1);
    expect(result.stats.added).toBe(1);
    expect(result.stats.removed).toBe(0);
    expect(result.stats.moved + result.stats.unchanged).toBe(29_999);
  });

  it("prefix/suffix trimming keeps ordinary array edits exact", () => {
    const before = Array.from({ length: 10_000 }, (_, i) => `item-${i}`);
    const after = [...before];
    after.splice(5_000, 0, "new-item");
    const result = diffValues(before, after);
    expect(result.stats.added).toBe(1);
    expect(result.stats.removed).toBe(0);
  });
});

describe("hostile and malformed input", () => {
  it("deep nesting is a clean exit 2, never exit 1 ('differences') or a crash", () => {
    let deep = "1";
    for (let i = 0; i < 100_000; i++) deep = `{"x":${deep}}`;
    const io = memoryIO({ "a.json": deep, "b.json": '{"y":1}' });
    const code = runCli(["a.json", "b.json", "--no-color"], io);
    expect(code).toBe(2);
    expect(io.err).toMatch(/too deeply nested|Failed to parse/);
  });

  it("YAML alias bombs are refused by the parser", () => {
    let yaml = "a0: &a0 [x,x,x,x,x,x,x,x,x,x]\n";
    for (let i = 1; i < 9; i++) yaml += `a${i}: &a${i} [${Array(10).fill(`*a${i - 1}`).join(",")}]\n`;
    expect(() => parseDocument(yaml, "yaml")).toThrow(/alias/i);
  });

  it("YAML tags never produce functions or non-JSON objects", () => {
    const value = parseDocument(
      "a: !!js/function 'function(){ return 1 }'\nb: !!binary aGk=\nc: !!timestamp 2024-01-01\nd: !!set {x, y}\n",
      "yaml",
    ) as Record<string, unknown>;
    expect(value).toEqual({ a: "function(){ return 1 }", b: "aGk=", c: "2024-01-01", d: { x: null, y: null } });
  });

  it("different YAML timestamps / sets are reported as changed (were equal empty objects)", () => {
    const oldVal = parseDocument("expires: !!timestamp 2024-01-01\nroles: !!set {admin}\n", "yaml");
    const newVal = parseDocument("expires: !!timestamp 2030-01-01\nroles: !!set {admin, root}\n", "yaml");
    const result = diffValues(oldVal, newVal);
    expect(result.stats.unchanged).toBe(1); // roles.admin
    expect(result.stats.changed).toBe(1); // expires
    expect(result.stats.added).toBe(1); // roles.root
  });

  it("a __proto__ key stays data and does not pollute prototypes", () => {
    const value = parseDocument("__proto__: {polluted: yes}\nb: 1\n", "yaml");
    const result = diffValues(value, { b: 1 });
    expect(result.stats.removed).toBe(1);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe("CLI", () => {
  it("--fail-on rejects Object.prototype names instead of disabling the gate", () => {
    expect(() => parseArgs(["a", "b", "--fail-on", "toString"])).toThrow(CliUsageError);
    expect(() => parseArgs(["a", "b", "--fail-on", "constructor"])).toThrow(CliUsageError);
  });

  it.skipIf(process.platform === "win32")("treats a symlinked bin (how npm installs it) as the entry point", () => {
    const cli = fileURLToPath(new URL("../src/cli/index.ts", import.meta.url));
    const dir = mkdtempSync(join(tmpdir(), "structdiff-bin-"));
    try {
      const link = join(dir, "structdiff");
      symlinkSync(cli, link);
      const url = pathToFileURL(cli).href;
      expect(isEntryPoint(link, url)).toBe(true);
      expect(isEntryPoint(cli, url)).toBe(true);
      expect(isEntryPoint(join(dir, "missing"), url)).toBe(false);
      expect(isEntryPoint(undefined, url)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
