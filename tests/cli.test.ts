import { describe, expect, it } from "vitest";
import { parseArgs, runCli, CliUsageError, type CliIO } from "../src/cli/index.js";

function makeIO(files: Record<string, string>): CliIO & { out: string; err: string } {
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
      if (content === undefined) {
        throw new Error(`ENOENT: no such file, open '${path}'`);
      }
      return content;
    },
  };
  return io;
}

describe("parseArgs", () => {
  it("parses two positional files with defaults", () => {
    const args = parseArgs(["old.json", "new.json"]);
    expect(args.oldFile).toBe("old.json");
    expect(args.newFile).toBe("new.json");
    expect(args.json).toBe(false);
    expect(args.failOn).toBe("changed");
    expect(args.minMatch).toBe(5);
    expect(args.color).toBe(true);
  });

  it("parses --json, --no-color, --fail-on, --min-match", () => {
    const args = parseArgs([
      "a.yaml",
      "b.yaml",
      "--json",
      "--no-color",
      "--fail-on",
      "removed",
      "--min-match",
      "3",
    ]);
    expect(args.json).toBe(true);
    expect(args.color).toBe(false);
    expect(args.failOn).toBe("removed");
    expect(args.minMatch).toBe(3);
  });

  it("rejects an unknown option", () => {
    expect(() => parseArgs(["--bogus", "a.json", "b.json"])).toThrow(CliUsageError);
  });

  it("rejects a bad --fail-on level", () => {
    expect(() => parseArgs(["a.json", "b.json", "--fail-on", "catastrophic"])).toThrow(
      CliUsageError,
    );
  });

  it("rejects a non-numeric --min-match", () => {
    expect(() => parseArgs(["a.json", "b.json", "--min-match", "abc"])).toThrow(CliUsageError);
  });

  it("rejects the wrong number of positional arguments", () => {
    expect(() => parseArgs(["only-one.json"])).toThrow(CliUsageError);
    expect(() => parseArgs(["a.json", "b.json", "c.json"])).toThrow(CliUsageError);
  });

  it("allows help/version with no positionals", () => {
    expect(parseArgs(["--help"]).help).toBe(true);
    expect(parseArgs(["-v"]).version).toBe(true);
  });
});

describe("runCli", () => {
  it("prints help and exits 0", () => {
    const io = makeIO({});
    const code = runCli(["--help"], io);
    expect(code).toBe(0);
    expect(io.out).toMatch(/Usage:/);
  });

  it("prints the version and exits 0", () => {
    const io = makeIO({});
    const code = runCli(["--version"], io);
    expect(code).toBe(0);
    expect(io.out.trim()).toBe("0.1.0");
  });

  it("prints a usage error to stderr and exits 2 on bad args", () => {
    const io = makeIO({});
    const code = runCli(["--bogus"], io);
    expect(code).toBe(2);
    expect(io.err).toMatch(/Unknown option/);
  });

  it("exits 2 with a clear message when a file cannot be read", () => {
    const io = makeIO({ "old.json": "{}" });
    const code = runCli(["old.json", "missing.json"], io);
    expect(code).toBe(2);
    expect(io.err).toMatch(/Could not read input file/);
  });

  it("exits 2 with a clear message on invalid JSON", () => {
    const io = makeIO({ "old.json": "{bad", "new.json": "{}" });
    const code = runCli(["old.json", "new.json"], io);
    expect(code).toBe(2);
    expect(io.err).toMatch(/Failed to parse JSON/);
  });

  it("prints 'No semantic differences.' and exits 0 for identical docs", () => {
    const io = makeIO({ "old.json": '{"a":1}', "new.json": '{"a":1}' });
    const code = runCli(["old.json", "new.json", "--no-color"], io);
    expect(code).toBe(0);
    expect(io.out).toMatch(/No semantic differences\./);
  });

  it("prints a human-readable diff and a summary line", () => {
    const io = makeIO({
      "old.json": '{"host":"a","timeout":30}',
      "new.json": '{"host":"b","timeout":30}',
    });
    const code = runCli(["old.json", "new.json", "--no-color"], io);
    expect(code).toBe(1); // changed => default --fail-on changed triggers
    expect(io.out).toMatch(/changed host: "a" -> "b"/);
    expect(io.out).toMatch(/0 added, 0 removed, 1 changed/);
  });

  it("colorizes output by default", () => {
    const io = makeIO({ "old.json": '{"a":1}', "new.json": '{"a":2}' });
    runCli(["old.json", "new.json"], io);
    expect(io.out).toContain("\u001b[");
  });

  it("prints JSON when --json is passed", () => {
    const io = makeIO({ "old.json": '{"a":1}', "new.json": '{"a":2}' });
    const code = runCli(["old.json", "new.json", "--json"], io);
    expect(code).toBe(1);
    const parsed = JSON.parse(io.out);
    expect(parsed.stats.changed).toBe(1);
  });

  it("exits 0 when only moves happen and --fail-on is changed (default)", () => {
    const io = makeIO({
      "old.yaml": "a:\n  timeout: thirty seconds of waiting\nb: {}\n",
      "new.yaml": "a: {}\nb:\n  timeout: thirty seconds of waiting\n",
    });
    const code = runCli(["old.yaml", "new.yaml", "--no-color"], io);
    expect(code).toBe(0);
    expect(io.out).toMatch(/moved a\.timeout -> b\.timeout/);
  });

  it("--fail-on moved makes a pure move exit 1", () => {
    const io = makeIO({
      "old.yaml": "a:\n  timeout: thirty seconds of waiting\nb: {}\n",
      "new.yaml": "a: {}\nb:\n  timeout: thirty seconds of waiting\n",
    });
    const code = runCli(["old.yaml", "new.yaml", "--fail-on", "moved"], io);
    expect(code).toBe(1);
  });

  it("describes renamed and moved-renamed ops in text output", () => {
    const io = makeIO({
      "old.json": JSON.stringify({ username: "long enough value to match" }),
      "new.json": JSON.stringify({ userName: "long enough value to match" }),
    });
    runCli(["old.json", "new.json", "--no-color"], io);
    expect(io.out).toMatch(/renamed username -> userName/);

    const io2 = makeIO({
      "old.json": JSON.stringify({ network: { retryLimit: "five retries with backoff" } }),
      "new.json": JSON.stringify({ http: { maxRetries: "five retries with backoff" } }),
    });
    runCli(["old.json", "new.json", "--no-color"], io2);
    expect(io2.out).toMatch(/moved\+renamed network\.retryLimit -> http\.maxRetries/);
  });

  it("respects --min-match to widen or narrow rename detection", () => {
    const io = makeIO({ "old.json": '{"a":"xy"}', "new.json": '{"z":"xy"}' });
    const strict = runCli(["old.json", "new.json", "--json", "--min-match", "10"], io);
    expect(strict).toBe(1);
    const parsedStrict = JSON.parse(io.out);
    expect(parsedStrict.stats.renamed).toBe(0);

    const io2 = makeIO({ "old.json": '{"a":"xy"}', "new.json": '{"z":"xy"}' });
    runCli(["old.json", "new.json", "--json", "--min-match", "1"], io2);
    const parsedLenient = JSON.parse(io2.out);
    expect(parsedLenient.stats.renamed).toBe(1);
  });
});
