# structdiff

A semantic diff for JSON, YAML, and config files. It parses both documents
into trees and diffs the trees, not the text, so a key that moved to a
different parent, or was renamed but kept the same value, shows up as
`moved` / `renamed` — not as a `-`/`+` pair that makes you read the whole
value again to notice it never actually changed.

Two ways to use it: a zero-dependency-at-runtime CLI for CI (`structdiff
a.yaml b.yaml`, exit code driven by `--fail-on`), and a real side-by-side
visual diff that runs entirely in the browser.

## Why this and not the 1,000 other diff tools

Line-based diff (`diff`, `git diff`, most "JSON diff" npm packages) compares
*text*. Reorder two keys in a YAML file, or rename `retryLimit` to
`maxRetries`, and a text diff shows the whole surrounding block as changed —
because textually, it did change — even though nothing about the
configuration's *meaning* changed. You end up scanning walls of red/green to
find the one real edit.

Most "structural" JSON diff tools (jsondiffpatch, deep-diff, and the dozens
of clones of both) fix the reordering problem — objects are compared by key,
not by line — but they still treat a rename or a move as a delete plus an
insert. Nothing pairs them back up.

structdiff does the pairing. It fingerprints every value in the document
(a canonical, key-order-independent content hash), and when a key
disappears from one place and an equal-content key appears somewhere else,
it reports that as one `moved` / `renamed` / `moved-renamed` operation
instead of two unrelated ones. It does the same for array elements — an
item that changed position, or a whole array that got reversed, is reported
as `moved`, not as an added/removed pair at every shifted index. That is the
part the 1,000 near-identical repos don't do, and it's the part that
actually matters when you're reviewing a Kubernetes manifest, a Terraform
`tfvars` export, or an app config after a refactor.

## How it works

1. **Parse** both documents (YAML is a JSON superset, so both formats share
   one code path — `src/core/parse.ts`).
2. **Walk both trees together** (`src/core/diff.ts`): keys present at the
   same path in both are compared recursively; primitives that differ are
   `changed`; a key present in only one document becomes a **candidate**
   (with its full subtree, recursively) rather than an immediate op.
3. **Fingerprint every candidate** with a canonical, key-order-independent
   content hash (`src/core/hash.ts`, FNV-1a over sorted-key JSON). A
   removed candidate and an added candidate that share a hash — and where
   that hash is *unique* on both sides, so two unrelated `true`s never
   pair up — are the same value that moved.
4. **Classify the pairing** by comparing the old and new parent path and
   key: same parent + different key = `renamed`; different parent + same
   key = `moved`; both different = `moved-renamed`.
5. **Prefer the biggest match.** Candidates are matched biggest-subtree
   first, so a whole renamed block (e.g. `database:` → `datastore:` with
   identical children) is reported once, not once per leaf inside it — but
   if only *part* of a container moved out, the container is *not* dumped
   as one misleading "removed" blob; its remaining, unexplained pieces are
   reported individually instead.
6. **Arrays** get their own pass: a longest-common-subsequence match finds
   elements that kept their relative order (any index shift there is a pure
   `moved`); an exact-content pass then catches values that survived but
   fell fully out of order (e.g. a reversed array, which defeats any
   single LCS alignment); whatever's left is diffed position-by-position so
   a one-field change inside an array element is a targeted `changed`, not
   a whole-element replacement.

### A known, deliberate limitation

The move/rename matcher requires a value to be "distinctive enough"
(`--min-match`, default: content length ≥ 5) before it will pair a removal
with an addition. Without that floor, two unrelated `true`s or two `1`s
anywhere in the document would get matched as a "move" — a false positive
that would be worse than no match at all. This means a renamed boolean or
short-number field is reported as remove+add rather than `renamed`; there
just isn't enough information in the value alone to know it's the same
field. Raise `--min-match` down if your documents are small and you want it
more aggressive; raise it up for stricter, higher-confidence pairing.

## Install

```sh
npm install -g structdiff
```

or run it without installing:

```sh
npx structdiff old.yaml new.yaml
```

## CLI usage

Real output, run against the fixtures checked into [`examples/`](examples):

```console
$ structdiff examples/before.yaml examples/after.yaml --no-color
+ added database.maxConnections = 50
~ changed database.poolSize: 10 -> 20
→ moved featureFlags[2] -> featureFlags[0]
→ moved featureFlags[0] -> featureFlags[2]
+ added featureFlags[3] = "betaSearch"
→ moved+renamed network.retryLimit -> http.maxRetries
→ moved network.timeoutSeconds -> http.timeoutSeconds
→ renamed logging.format -> logging.layout
- removed tags.owner (was "payments-team")

2 added, 1 removed, 1 changed, 3 moved, 1 renamed, 1 moved+renamed, 6 unchanged
$ echo $?
1
```

`network.retryLimit` became `http.maxRetries` — a different parent *and* a
different key, same value — and it's reported as one `moved+renamed`
operation. `network.timeoutSeconds` moved to `http.timeoutSeconds` (same
key, different parent) as `moved`. `logging.format` became `logging.layout`
(same parent, different key) as `renamed`. None of those three show up as
a remove and an add.

The exit code is 1 by default whenever anything above a plain value
`changed` exists — see `--fail-on` for CI gating.

```
$ structdiff --help
structdiff 0.1.0
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
```

### CI gating

```sh
# Fail the build only when something was actually removed
# (moves, renames, and additions are allowed to pass silently):
structdiff prod.tfvars.json staged.tfvars.json --fail-on removed

# Fail on anything but pure reordering/renaming:
structdiff before.yaml after.yaml --fail-on changed
```

### JSON output

`--json` prints the full `DiffResult` (see [`src/core/types.ts`](src/core/types.ts))
for scripting — every op with its old/new path and value, plus a `stats`
summary. Real excerpt from the same example:

```console
$ structdiff examples/before.yaml examples/after.yaml --json | head -20
{
  "ops": [
    {
      "type": "unchanged",
      "oldPath": ["database", "host"],
      "newPath": ["database", "host"],
      "oldValue": "db.internal.example.com",
      "newValue": "db.internal.example.com"
    },
    {
      "type": "added",
      "newPath": ["database", "maxConnections"],
      "newValue": 50
    },
    {
      "type": "changed",
      "oldPath": ["database", "poolSize"],
      "newPath": ["database", "poolSize"],
      "oldValue": 10,
      "newValue": 20
    },
    ...
```

## Visual diff (web)

```sh
npm install
npm run dev:web
```

opens a local side-by-side viewer: paste or upload a Before/After document
(JSON or YAML), and it renders both trees with each line colored by what
happened to it — added, removed, changed, moved, renamed, or
moved+renamed — with a stats bar summarizing the whole diff. It runs
entirely client-side (no server, nothing uploaded) and supports light and
dark themes. `npm run build:web` produces a static `dist-web/` bundle you
can deploy anywhere.

## Library usage

```ts
import { diffValues, parseDocument, formatFromFilename } from "structdiff";

const oldVal = parseDocument(oldSource, formatFromFilename("before.yaml"));
const newVal = parseDocument(newSource, formatFromFilename("after.yaml"));
const result = diffValues(oldVal, newVal, { minMatchLength: 5 });

for (const op of result.ops) {
  if (op.type !== "unchanged") console.log(op.type, op.oldPath, op.newPath);
}
```

## Development

```sh
npm install
npm test              # vitest, deterministic, no network
npm run coverage       # vitest coverage (thresholds enforced in vitest.config.ts)
npm run typecheck      # tsc --noEmit, both the core/cli and web tsconfigs
npm run lint           # eslint, zero warnings allowed
npm run build           # compiles src/core + src/cli to dist/
npm run build:web       # builds the web viewer to dist-web/
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for more.

## License

MIT — see [LICENSE](LICENSE).
