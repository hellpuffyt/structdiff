# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
