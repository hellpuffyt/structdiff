# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- Equality used a 32-bit FNV-1a hash, so two different values with
  colliding hashes (easy to construct) were reported as `unchanged` and the
  CLI exited 0. Values are now compared by their exact canonical form.
- YAML 1.1 tags (`!!timestamp`, `!!binary`, `!!set`, `!!omap`) were resolved
  into `Date`/`Uint8Array`/`Set`/`Map` objects that all compared equal to
  `{}`; they are now kept in plain JSON form, so changes inside them are seen.
- Large inputs: move/rename reconciliation scanned every candidate per match
  (20k renamed subtrees took ~2 minutes; now well under a second), and two
  large arrays allocated an n*m LCS table (30k x 30k exhausted the heap).
  The common prefix/suffix is trimmed first and the table is capped.
- Deeply nested input crashed the CLI with exit code 1 — the same code as
  "differences found"; it is now a clean error with exit 2.
- `--fail-on toString` (or any `Object.prototype` name) was accepted and
  silently disabled the gate.
- The CLI did nothing when run through a symlinked npm bin (`npm link`,
  `node_modules/.bin`).

### Documentation

- The README no longer tells users to `npm install -g structdiff` / `npx
  structdiff`: that npm package is an unrelated project.

## [0.1.0] - 2026-09-01

### Added

- Core semantic diff engine (`src/core/diff.ts`): tree-walking diff over
  parsed JSON/YAML values with content-hash-based matching to detect moved,
  renamed, and moved+renamed keys instead of reporting them as a remove and
  an add.
- Array diffing: an LCS pass for order-preserving matches, a follow-up
  exact-content pass for elements that survived a full reorder (e.g. a
  reversed array), and positional pairing for the remainder so a modified
  field inside an array element is a targeted `changed`, not a whole-element
  replacement.
- CLI (`structdiff <old> <new>`) with human-readable and `--json` output,
  `--fail-on` severity gating for CI, and `--min-match` to tune the
  move/rename matcher's confidence floor.
- Browser-based side-by-side visual diff (React + Vite, `src/web/`) with
  file upload, paste, a bundled example, live stats, and light/dark themes.
- `examples/before.yaml` / `examples/after.yaml`: a realistic config diff
  used by the CLI's own README examples, the web viewer's "load example"
  button, and the CI dogfood job.
