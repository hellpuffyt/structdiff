import { useCallback, useMemo, useState } from "react";
import {
  diffValues,
  formatFromFilename,
  formatPath,
  parseDocument,
  ParseError,
  type DiffOp,
  type DiffResult,
  type InputFormat,
  type JsonValue,
} from "../core/index.js";
import { buildTreeLines, classForOp, indexOpsByPath, type TreeLine } from "./diffTree.js";
import exampleBefore from "../../examples/before.yaml?raw";
import exampleAfter from "../../examples/after.yaml?raw";

interface SideState {
  text: string;
  filename: string;
  loading: boolean;
}

const STAT_META: { key: keyof DiffResult["stats"]; label: string; cls: string }[] = [
  { key: "added", label: "added", cls: "line-added" },
  { key: "removed", label: "removed", cls: "line-removed" },
  { key: "changed", label: "changed", cls: "line-changed" },
  { key: "moved", label: "moved", cls: "line-moved" },
  { key: "renamed", label: "renamed", cls: "line-renamed" },
  { key: "movedRenamed", label: "moved+renamed", cls: "line-moved-renamed" },
  { key: "unchanged", label: "unchanged", cls: "" },
];

function useParsed(state: SideState): { value: JsonValue | null; error: string | null } {
  return useMemo(() => {
    if (state.text.trim() === "") return { value: null, error: null };
    const format: InputFormat = formatFromFilename(state.filename);
    try {
      return { value: parseDocument(state.text, format), error: null };
    } catch (err) {
      const message = err instanceof ParseError ? err.message : "Failed to parse input.";
      return { value: null, error: message };
    }
  }, [state.text, state.filename]);
}

function opTooltip(op: DiffOp): string {
  switch (op.type) {
    case "moved":
      return `moved from ${formatPath(op.oldPath!)} to ${formatPath(op.newPath!)}`;
    case "renamed":
      return `renamed from ${formatPath(op.oldPath!)} to ${formatPath(op.newPath!)}`;
    case "moved-renamed":
      return `moved and renamed: ${formatPath(op.oldPath!)} -> ${formatPath(op.newPath!)}`;
    case "changed":
      return `changed value at ${formatPath(op.newPath!)}`;
    case "added":
      return `added at ${formatPath(op.newPath!)}`;
    case "removed":
      return `removed from ${formatPath(op.oldPath!)}`;
    default:
      return "unchanged";
  }
}

function TreePane({
  lines,
  index,
  side,
}: {
  lines: TreeLine[];
  index: Map<string, DiffOp>;
  side: "old" | "new";
}): React.JSX.Element {
  return (
    <pre className="tree-pane" aria-label={side === "old" ? "before" : "after"}>
      {lines.map((line) => {
        const op = index.get(line.id);
        const cls = classForOp(op?.type);
        return (
          <div
            key={line.id}
            className={`tree-line ${cls}`}
            style={{ paddingLeft: `${line.depth * 1.25}em` }}
            title={op ? opTooltip(op) : undefined}
          >
            <span className="gutter">{cls ? gutterSymbol(op?.type) : " "}</span>
            <span className="text">{line.text}</span>
          </div>
        );
      })}
      {lines.length === 0 && <div className="tree-empty">(empty document)</div>}
    </pre>
  );
}

function gutterSymbol(type: DiffOp["type"] | undefined): string {
  switch (type) {
    case "added":
      return "+";
    case "removed":
      return "-";
    case "changed":
      return "~";
    case "moved":
    case "renamed":
    case "moved-renamed":
      return "→";
    default:
      return " ";
  }
}

function SideInput({
  label,
  state,
  onChange,
  onFile,
}: {
  label: string;
  state: SideState;
  onChange: (text: string) => void;
  onFile: (file: File) => void;
}): React.JSX.Element {
  const inputId = `file-${label}`;
  return (
    <div className="side-input">
      <div className="side-input-header">
        <span className="side-label">{label}</span>
        <span className="format-badge">{formatFromFilename(state.filename)}</span>
        <label className="file-button" htmlFor={inputId}>
          {state.loading ? "reading…" : "browse file"}
        </label>
        <input
          id={inputId}
          type="file"
          accept=".json,.yaml,.yml,application/json,text/yaml"
          className="visually-hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onFile(file);
            e.target.value = "";
          }}
        />
      </div>
      <textarea
        className="side-textarea"
        spellCheck={false}
        placeholder={`Paste ${label.toLowerCase()} JSON or YAML here…`}
        value={state.text}
        onChange={(e) => {
          onChange(e.target.value);
        }}
      />
    </div>
  );
}

export default function App(): React.JSX.Element {
  const [oldState, setOldState] = useState<SideState>({ text: "", filename: "old.yaml", loading: false });
  const [newState, setNewState] = useState<SideState>({ text: "", filename: "new.yaml", loading: false });
  const [minMatch, setMinMatch] = useState(5);

  const oldParsed = useParsed(oldState);
  const newParsed = useParsed(newState);

  const result = useMemo<DiffResult | null>(() => {
    if (oldParsed.value === null || newParsed.value === null) return null;
    if (oldParsed.error || newParsed.error) return null;
    return diffValues(oldParsed.value, newParsed.value, { minMatchLength: minMatch });
  }, [oldParsed, newParsed, minMatch]);

  const oldLines = useMemo(() => (oldParsed.value !== null ? buildTreeLines(oldParsed.value) : []), [oldParsed.value]);
  const newLines = useMemo(() => (newParsed.value !== null ? buildTreeLines(newParsed.value) : []), [newParsed.value]);

  const { oldIndex, newIndex } = useMemo(
    () => indexOpsByPath(result?.ops ?? []),
    [result],
  );

  const readFile = useCallback((file: File, setState: (s: SideState) => void) => {
    setState({ text: "", filename: file.name, loading: true });
    const reader = new FileReader();
    reader.onload = () => {
      setState({ text: typeof reader.result === "string" ? reader.result : "", filename: file.name, loading: false });
    };
    reader.onerror = () => {
      setState({ text: "", filename: file.name, loading: false });
    };
    reader.readAsText(file);
  }, []);

  const loadExample = useCallback(() => {
    setOldState({ text: exampleBefore, filename: "before.yaml", loading: false });
    setNewState({ text: exampleAfter, filename: "after.yaml", loading: false });
  }, []);

  const isEmpty = oldState.text.trim() === "" && newState.text.trim() === "";
  const hasParseError = Boolean(oldParsed.error ?? newParsed.error);

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>structdiff</h1>
          <p className="tagline">
            Semantic diff for JSON / YAML / config: moved and renamed keys are detected instead of
            shown as line noise.
          </p>
        </div>
        <div className="header-controls">
          <label className="min-match-control">
            min match length
            <input
              type="number"
              min={0}
              max={50}
              value={minMatch}
              onChange={(e) => {
                setMinMatch(Number(e.target.value));
              }}
            />
          </label>
          <button type="button" className="example-button" onClick={loadExample}>
            Load example
          </button>
        </div>
      </header>

      <div className="input-grid">
        <SideInput
          label="Before"
          state={oldState}
          onChange={(text) => {
            setOldState((s) => ({ ...s, text }));
          }}
          onFile={(f) => {
            readFile(f, setOldState);
          }}
        />
        <SideInput
          label="After"
          state={newState}
          onChange={(text) => {
            setNewState((s) => ({ ...s, text }));
          }}
          onFile={(f) => {
            readFile(f, setNewState);
          }}
        />
      </div>

      {isEmpty && (
        <div className="empty-state">
          <p>Paste or upload a Before and After document, or</p>
          <button type="button" className="example-button" onClick={loadExample}>
            load the bundled example
          </button>
        </div>
      )}

      {!isEmpty && hasParseError && (
        <div className="error-state">
          {oldParsed.error && (
            <p>
              <strong>Before:</strong> {oldParsed.error}
            </p>
          )}
          {newParsed.error && (
            <p>
              <strong>After:</strong> {newParsed.error}
            </p>
          )}
        </div>
      )}

      {!isEmpty && !hasParseError && result && (
        <>
          <div className="stats-bar" role="list">
            {STAT_META.map(({ key, label, cls }) => (
              <span className={`stat-chip ${cls}`} key={key} role="listitem">
                <strong>{result.stats[key]}</strong> {label}
              </span>
            ))}
          </div>
          <div className="tree-grid">
            <TreePane lines={oldLines} index={oldIndex} side="old" />
            <TreePane lines={newLines} index={newIndex} side="new" />
          </div>
        </>
      )}

      <footer className="app-footer">
        <a href="https://github.com/hellpuffyt/structdiff" target="_blank" rel="noreferrer">
          structdiff on GitHub
        </a>
        <span>·</span>
        <span>Runs entirely in your browser — nothing is uploaded.</span>
      </footer>
    </div>
  );
}
