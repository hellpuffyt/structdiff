#!/usr/bin/env node
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  diffValues,
  formatFromFilename,
  formatPath,
  parseDocument,
  ParseError,
  type DiffOp,
} from "../core/index.js";

const VERSION = "0.1.0";

const HELP = `structdiff ${VERSION}
Semantic diff for JSON/YAML/config files: detects moved and renamed keys
instead of line noise.

Usage:
  structdiff <old-file> <new-file> [options]

Options:
  --json                Print the raw diff result as JSON.
  --fail-on <level>     Exit 1 if any op of this severity or higher exists.
                         Levels (low to high): moved, changed, removed.
                         Default: changed.
  --min-match <n>       Minimum content length for move/rename pairing
                         (default: 5).
  --no-color            Disable ANSI colors in text output.
  -h, --help            Show this help.
  -v, --version         Show the version number.
`;

const SEVERITY: Record<DiffOp["type"], number> = {
  unchanged: 0,
  moved: 1,
  renamed: 1,
  "moved-renamed": 1,
  changed: 2,
  added: 2,
  removed: 3,
};

const COLORS: Partial<Record<DiffOp["type"], string>> = {
  added: "32", // green
  removed: "31", // red
  changed: "33", // yellow
  moved: "36", // cyan
  renamed: "35", // magenta
  "moved-renamed": "35",
};

const SYMBOLS: Record<DiffOp["type"], string> = {
  unchanged: " ",
  added: "+",
  removed: "-",
  changed: "~",
  moved: "→",
  renamed: "→",
  "moved-renamed": "→",
};

function colorize(text: string, code: string | undefined, useColor: boolean): string {
  if (!useColor || !code) return text;
  return `[${code}m${text}[0m`;
}

function describeOp(op: DiffOp): string {
  switch (op.type) {
    case "added":
      return `added ${formatPath(op.newPath!)} = ${JSON.stringify(op.newValue)}`;
    case "removed":
      return `removed ${formatPath(op.oldPath!)} (was ${JSON.stringify(op.oldValue)})`;
    case "changed":
      return `changed ${formatPath(op.newPath!)}: ${JSON.stringify(op.oldValue)} -> ${JSON.stringify(op.newValue)}`;
    case "moved":
      return `moved ${formatPath(op.oldPath!)} -> ${formatPath(op.newPath!)}`;
    case "renamed":
      return `renamed ${formatPath(op.oldPath!)} -> ${formatPath(op.newPath!)}`;
    case "moved-renamed":
      return `moved+renamed ${formatPath(op.oldPath!)} -> ${formatPath(op.newPath!)}`;
    case "unchanged":
      return `unchanged ${formatPath(op.newPath ?? op.oldPath!)}`;
  }
}

interface ParsedArgs {
  oldFile: string;
  newFile: string;
  json: boolean;
  failOn: DiffOp["type"];
  minMatch: number;
  color: boolean;
  help: boolean;
  version: boolean;
}

export class CliUsageError extends Error {}

export function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  let json = false;
  let failOn: DiffOp["type"] = "changed";
  let minMatch = 5;
  let color = true;
  let help = false;
  let version = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    switch (arg) {
      case "--json":
        json = true;
        break;
      case "--no-color":
        color = false;
        break;
      case "-h":
      case "--help":
        help = true;
        break;
      case "-v":
      case "--version":
        version = true;
        break;
      case "--fail-on": {
        const val = argv[++i];
        // Own keys only: `in` also accepted "toString"/"constructor", which
        // compared as NaN and silently disabled the gate.
        if (!val || !Object.hasOwn(SEVERITY, val)) {
          throw new CliUsageError(`--fail-on requires one of: ${Object.keys(SEVERITY).join(", ")}`);
        }
        failOn = val as DiffOp["type"];
        break;
      }
      case "--min-match": {
        const val = argv[++i];
        const n = Number(val);
        if (!val || Number.isNaN(n) || n < 0) {
          throw new CliUsageError("--min-match requires a non-negative number");
        }
        minMatch = n;
        break;
      }
      default:
        if (arg.startsWith("--")) {
          throw new CliUsageError(`Unknown option: ${arg}`);
        }
        positionals.push(arg);
    }
  }

  if (help || version) {
    return { oldFile: "", newFile: "", json, failOn, minMatch, color, help, version };
  }

  if (positionals.length !== 2) {
    throw new CliUsageError("Expected exactly two file arguments: <old-file> <new-file>");
  }

  return {
    oldFile: positionals[0]!,
    newFile: positionals[1]!,
    json,
    failOn,
    minMatch,
    color,
    help,
    version,
  };
}

export interface CliIO {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
  readFile: (path: string) => string;
}

const defaultIO: CliIO = {
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
  readFile: (path) => readFileSync(path, "utf8"),
};

export function runCli(argv: string[], io: CliIO = defaultIO): number {
  let args: ParsedArgs;
  try {
    args = parseArgs(argv);
  } catch (err) {
    io.stderr(`${err instanceof Error ? err.message : String(err)}\n`);
    io.stderr(HELP);
    return 2;
  }

  if (args.help) {
    io.stdout(HELP);
    return 0;
  }
  if (args.version) {
    io.stdout(`${VERSION}\n`);
    return 0;
  }

  let oldSource: string;
  let newSource: string;
  try {
    oldSource = io.readFile(args.oldFile);
    newSource = io.readFile(args.newFile);
  } catch (err) {
    io.stderr(`Could not read input file: ${err instanceof Error ? err.message : String(err)}\n`);
    return 2;
  }

  let oldVal;
  let newVal;
  try {
    oldVal = parseDocument(oldSource, formatFromFilename(args.oldFile));
    newVal = parseDocument(newSource, formatFromFilename(args.newFile));
  } catch (err) {
    if (err instanceof ParseError) {
      io.stderr(`${err.message}\n`);
      return 2;
    }
    throw err;
  }

  let result;
  try {
    result = diffValues(oldVal, newVal, { minMatchLength: args.minMatch });
  } catch (err) {
    // Exit 1 means "differences found"; a crash must never look like that
    // (or, worse, like 0). Deep nesting exhausts the call stack.
    const tooDeep = err instanceof RangeError && /call stack/i.test(err.message);
    io.stderr(
      tooDeep
        ? "Input is too deeply nested to diff (call stack exhausted).\n"
        : `Internal error while diffing: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 2;
  }

  if (args.json) {
    io.stdout(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    const changedOps = result.ops.filter((op) => op.type !== "unchanged");
    if (changedOps.length === 0) {
      io.stdout(colorize("No semantic differences.\n", "32", args.color));
    } else {
      for (const op of changedOps) {
        const line = `${SYMBOLS[op.type]} ${describeOp(op)}\n`;
        io.stdout(colorize(line, COLORS[op.type], args.color));
      }
    }
    const s = result.stats;
    io.stdout(
      `\n${s.added} added, ${s.removed} removed, ${s.changed} changed, ` +
        `${s.moved} moved, ${s.renamed} renamed, ${s.movedRenamed} moved+renamed, ` +
        `${s.unchanged} unchanged\n`,
    );
  }

  const threshold = SEVERITY[args.failOn];
  const shouldFail = result.ops.some((op) => SEVERITY[op.type] >= threshold && op.type !== "unchanged");
  return shouldFail ? 1 : 0;
}

/**
 * True when this module is the process entry point. npm installs `bin`
 * entries as symlinks (node_modules/.bin, npx, npm link, global installs),
 * so both sides are compared after resolving symlinks; comparing the raw
 * argv[1] made the installed CLI exit 0 without doing anything.
 */
export function isEntryPoint(argv1: string | undefined, moduleUrl: string): boolean {
  if (!argv1) return false;
  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}

/* c8 ignore start */
if (isEntryPoint(process.argv[1], import.meta.url)) {
  process.exit(runCli(process.argv.slice(2)));
}
/* c8 ignore stop */
