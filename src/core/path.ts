import type { PathSegment } from "./types.js";

/** Renders a path as a dotted/bracket string, e.g. `server.ports[0]`. Empty path renders as `$`. */
export function formatPath(path: PathSegment[]): string {
  if (path.length === 0) return "$";
  let out = "";
  for (const seg of path) {
    if (typeof seg === "number") {
      out += `[${seg}]`;
    } else if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(seg)) {
      out += out === "" ? seg : `.${seg}`;
    } else {
      out += `[${JSON.stringify(seg)}]`;
    }
  }
  return out;
}
