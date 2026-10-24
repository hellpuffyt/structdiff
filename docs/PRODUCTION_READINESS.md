# Production readiness — structdiff

Audit of the `audit/production-readiness` branch. This document records evidence; it does not
award a production-ready label.

## Scope and architecture

Semantic JSON/YAML diff: `src/core` (parse, canonical form, tree diff with move/rename pairing,
array LCS), `src/cli` (text/JSON output, `--fail-on` gate), `src/web` (Vite + React side-by-side
viewer, client-side only). Runtime dependency: `yaml`.

## Platforms and prerequisites

Node.js >= 18. Verified on macOS (Apple Silicon): full gate on Node 24.19.0, tests on Node 18, 20,
22. CI matrix (default branch): ubuntu / windows / macOS x Node 18 / 20 / 22; Windows not run
locally. The web viewer was built (`npm run build:web`), not exercised in a browser.

## Clean-clone setup (README "Install")

`git clone`, `npm ci && npm run build`, `npm link` (into a throwaway npm prefix): all exit 0; the
linked `structdiff examples/before.yaml examples/after.yaml` printed the README output and exited 1
as documented; 81 tests passed; typecheck, lint, coverage and `build:web` exit 0; tree clean.

Baseline README said `npm install -g structdiff` / `npx structdiff`. The `structdiff` package on
npm is a **different author's project**, so following the README installed unrelated third-party
code. The README now installs from source and warns about this.

## Commands executed (CI-equivalent, local)

| Command | Baseline (main @ 32306d8) | Audit branch |
|---|---|---|
| `npm ci` | 0 | 0 |
| `npm test` | 0 — 66 passed, 0 failed, 0 skipped | 0 — 81 passed, 0 failed, 0 skipped (Node 24, 18, 20, 22); 1 test skipped on Windows only (symlink) |
| `npm run typecheck` / `npm run lint` | 0 / 0 | 0 / 0 |
| `npm run coverage` | 0 — 98.57 / 91.91 / 91.42 / 98.57 | 0 — 98.53 / 92.28 / 91.89 / 98.53 |
| `npm run build && npm run build:web` | 0 | 0 |
| CI dogfood (exact output, exit 1; self-diff exit 0) | pass | pass (output byte-identical) |
| `npm audit --omit=dev` | 0 | 0 |
| `npm audit` (dev) | 9 (3 critical, 3 high, 3 moderate) | 7 (3 critical, 1 high, 3 moderate) — vitest 2 / vite 5 chains need semver-major upgrades; the vite/esbuild dev-server advisory affects `npm run dev:web` |

## Bugs fixed (regression tests: `tests/audit-regressions.test.ts`; 10 of 15 fail on baseline, and one more — the 30k-array test — crashes the baseline worker with a heap OOM)

| Bug | Impact | Fix |
|---|---|---|
| Equality by 32-bit FNV-1a hash | `{password:"v16pwu"}` vs `{password:"v1d5fa"}` reported **unchanged**, CLI exit 0; collisions are trivial to construct | exact canonical-form comparison (memoised) |
| YAML 1.1 tags resolved to Date/Set/Map/Uint8Array | all compared as `{}`: changed timestamps/sets reported unchanged | `resolveKnownTags: false` |
| Quadratic move reconciliation | 20k renamed subtrees: ~112 s | pre-order subtree ranges: ~0.65 s |
| Unbounded LCS table | 30k x 30k arrays: out-of-memory crash | prefix/suffix trim + 4M-cell cap, content matching still exact |
| Deep nesting | RangeError crash with exit 1 (= "differences found") | exit 2 with message |
| `--fail-on toString` | gate silently disabled | own-key check |
| Entry-point check without realpath | `npm link` / `.bin` CLI exited 0 doing nothing | `isEntryPoint` |

## Security review

| Area | Finding | Severity | Status |
|---|---|---|---|
| Integrity of the CI gate | hash collisions and resolved YAML tags hid real changes | High (silent false "unchanged") | Fixed |
| YAML parsing | alias bombs rejected by `yaml` (maxAliasCount); `!!js/*` never executed; `__proto__` stays data | Info | Verified by tests |
| Resource exhaustion | quadratic reconcile, OOM LCS, stack overflow | Medium | Fixed / clean error |
| Supply chain (docs) | README installed an unrelated npm package | High (docs) | Fixed |
| Web viewer | React rendering, no `dangerouslySetInnerHTML`, no network | Info | Reviewed |
| Workflow permissions | already `contents: read` | Info | none |
| Secrets in tree/history | 3 commits, no hits | Info | none |

## Acceptance checklist

| Item | Expected | Test | Result |
|---|---|---|---|
| moved / renamed / moved+renamed detection | single op per relocation | `tests/diff.test.ts`, CI dogfood | pass |
| Exact change detection | no false "unchanged" | audit "equality is exact" | pass |
| YAML + JSON parsing, safe | plain JSON values only | `tests/parse.test.ts`, audit tests | pass |
| Large / deep input | bounded time, clean errors | audit "scales", "hostile" | pass |
| CLI gate + exit codes 0/1/2 | as documented | `tests/cli.test.ts`, audit CLI | pass |
| Installed bin works | runs via symlink | audit test, clean clone | pass |
| Web viewer builds | `dist-web/` produced | `npm run build:web` | pass (not browser-tested) |

## CI status

Default branch (`main` @ 32306d8): last run `success`. Audit branch: pending until pushed.

## Limitations

`--min-match` floor means short primitives renamed show as remove+add (documented); array LCS
capped for huge arrays (documented); multi-document YAML unsupported; web viewer not browser-tested
here.

## Tested commit

`126a60ef02270dd81a817c37716ceaf11cfd97f6` (clean clone), 2026-10-22.

## Classification proposal

**Partially Verified** — CLI/core verified locally on Node 18–24 and from a clean clone; audit-branch
CI (incl. Windows) and an interactive browser check of the web viewer are outstanding.
