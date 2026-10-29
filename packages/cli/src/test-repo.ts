import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/** Create a temporary repository tree from a map of relative path -> content. */
export function makeRepo(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "specplane-test-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
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
