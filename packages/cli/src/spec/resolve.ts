import * as path from "node:path";
import * as fs from "node:fs";
import { AmbiguousIdError, SpecNotFoundError, UnknownRootError } from "../errors.js";
import { checkoutRoot } from "../git/repo.js";
import { ID_PATTERN } from "../schemas.js";
import type { Config, SpecRootConfig } from "../types.js";

export interface ResolvedSpec {
  /** Name of the root that holds the spec. */
  root: string;
  /** Unqualified spec ID without anchor (`<type>/<slug>`). */
  id: string;
  /** Absolute path of the spec file. */
  path: string;
}

/** Type directory mapping; never computed by pluralising. */
export const TYPE_DIRS: Record<string, string> = { feature: "features", architecture: "architecture" };
const ID_RE = new RegExp(ID_PATTERN);

/**
 * Resolve a spec ID to a file. `repoRoot` is the checkout root that `spec_roots` paths are
 * relative to (defaults to the current checkout).
 */
export function resolveSpecId(
  rawId: string,
  config: Config,
  fromRoot?: string,
  repoRoot?: string,
  exists: (file: string) => boolean = fs.existsSync,
): ResolvedSpec {
  const base = repoRoot ?? checkoutRoot();
  const roots = new Map(config.spec_roots.map((r) => [r.name, r]));

  let id = rawId.split("#")[0];
  let qualified: string | undefined;
  const colon = id.indexOf(":");
  if (colon !== -1) {
    qualified = id.slice(0, colon);
    id = id.slice(colon + 1);
    if (!roots.has(qualified)) throw new UnknownRootError(qualified);
  }
  if (!ID_RE.test(id)) throw new SpecNotFoundError(rawId.split("#")[0]);

  const [type, ...rest] = id.split(path.posix.sep);
  const file = (r: SpecRootConfig) =>
    path.join(base, r.path, TYPE_DIRS[type], ...`${rest.join("/")}.md`.split("/"));
  const hit = (r: SpecRootConfig): ResolvedSpec | null =>
    exists(file(r)) ? { root: r.name, id, path: file(r) } : null;

  if (qualified !== undefined) {
    const found = hit(roots.get(qualified)!);
    if (!found) throw new SpecNotFoundError(`${qualified}:${id}`);
    return found;
  }

  if (fromRoot !== undefined) {
    if (!roots.has(fromRoot)) throw new UnknownRootError(fromRoot);
    const seen = new Set<string>();
    for (let r: SpecRootConfig | undefined = roots.get(fromRoot); r && !seen.has(r.name); r = r.extends ? roots.get(r.extends) : undefined) {
      seen.add(r.name);
      const found = hit(r);
      if (found) return found;
    }
    throw new SpecNotFoundError(id);
  }

  const hits = config.spec_roots.map(hit).filter((h): h is ResolvedSpec => h !== null);
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) throw new AmbiguousIdError(id, hits.map((h) => h.root));
  throw new SpecNotFoundError(id);
}
