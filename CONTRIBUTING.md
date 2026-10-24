# Contributing to structdiff

## Setup

```sh
git clone https://github.com/hellpuffyt/structdiff.git
cd structdiff
npm install
```

Node 20+ is required (see `engines` in `package.json`).

## Project layout

```
src/core/   diff engine, hashing, parsing, path formatting — no DOM, no Node-only APIs
src/cli/    the `structdiff` binary, built on src/core
src/web/    the browser visual diff (React + Vite), built on src/core
tests/      vitest, one file per src/core and src/cli module
examples/   the before.yaml/after.yaml fixture used by the README, the web
            viewer's "load example" button, and the CI dogfood job
```

`src/core` has one runtime dependency (`yaml`, for YAML parsing) and is
otherwise dependency-free and environment-agnostic — it must keep working
identically in Node (the CLI) and the browser (the web viewer). Don't import
`node:*` modules into `src/core`; that's what keeps `src/cli/index.ts` as
the only file that touches the filesystem or `process`.

## Ground rules

- **No fabricated example output.** If the README shows console output, it
  was copy-pasted from actually running the command. If you change the
  diff algorithm, re-run the README's examples and update them.
- **Tests are deterministic.** No wall-clock time, no network, no random
  seeds without a fixed value. `npm test` must produce the same result on
  every run and every OS.
- **A behavior change to the matching algorithm needs a test that would
  fail without it.** The matcher has real edge cases (ambiguous duplicate
  values, arrays that fully reverse, containers that are only partially
  moved) — see `tests/diff.test.ts` for the pattern each one follows: build
  the smallest before/after pair that isolates the behavior, assert on
  `result.stats` and the specific op's `oldPath`/`newPath`.

## Before opening a PR

```sh
npm test              # vitest
npm run coverage       # thresholds are enforced (see vitest.config.ts)
npm run typecheck      # tsc --noEmit, both tsconfig.json and tsconfig.web.json
npm run lint           # eslint --max-warnings=0
npm run build && npm run build:web   # both build targets must compile
```

All of the above run in CI (`.github/workflows/ci.yml`) on Linux, macOS,
and Windows; the `dogfood` job also runs the built CLI against
`examples/before.yaml` / `examples/after.yaml` and asserts the exact output,
not just a zero exit code.

## Reporting a matching bug

The most useful bug report for this project is a minimal `before`/`after`
pair (inline in the issue, a few lines) plus the actual vs. expected op —
e.g. "field X should be `renamed`, but I get a `removed` + `added`
instead." That maps directly onto a new `tests/diff.test.ts` case.
