import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as yaml from "js-yaml";

/**
 * Create a temporary repository tree from a map of relative path -> content.
 *
 * Unless `createSpecRoots: false`, the directories declared by `spec_roots` (or the default
 * `docs/specifications` when there is no config) are created, because config loading rejects
 * missing spec roots. Pass the option to test that rejection itself.
 */
export function makeRepo(files: Record<string, string>, opts: { createSpecRoots?: boolean } = {}): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "specplane-test-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  if (opts.createSpecRoots !== false) {
    let roots: { path?: unknown }[] = [{ path: "docs/specifications" }];
    const text = files[".specplane/config.yaml"];
    if (text) {
      try {
        const parsed = yaml.load(text, { schema: yaml.JSON_SCHEMA }) as { spec_roots?: { path?: unknown }[] } | undefined;
        if (Array.isArray(parsed?.spec_roots)) roots = parsed.spec_roots;
      } catch {
        // malformed config: leave the default root
      }
    }
    for (const r of roots) {
      if (typeof r?.path !== "string" || path.isAbsolute(r.path)) continue;
      const abs = path.resolve(root, r.path);
      const rel = path.relative(root, abs);
      if (rel === ".." || rel.startsWith(`..${path.sep}`)) continue;
      if (!fs.existsSync(abs)) fs.mkdirSync(abs, { recursive: true });
    }
  }
  return root;
}

export const CONFIG = `spec_roots:
  - name: base
    path: specs
  - name: ext
    path: ext-specs
    extends: base
decisions:
  dir: decisions
specs:
  feature:
    leak_guard_allow: [Widget]
`;

export function spec(fm: Record<string, unknown>, body = "# T\n"): string {
  const lines = Object.entries(fm).map(([k, v]) => `${k}: ${JSON.stringify(v)}`);
  return `---\n${lines.join("\n")}\n---\n${body}`;
}
