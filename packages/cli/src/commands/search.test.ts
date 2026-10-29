import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { CONFIG, makeRepo, spec } from "../test-repo.js";

const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "cli.js");
const fm = (id: string, status = "draft") => spec({ id, title: `T ${id}`, status, author: "user" }, "# T\nThe Architecture-Leak guard.\nother\n");
const plan = (id: string, status: string) =>
  `---\nid: ${id}\ntitle: P\nstatus: ${status}\nspecs: []\ndepends_on: []\n---\n# P\nneedle-plan here\n`;

function repo(): string {
  const root = makeRepo({
    ".specplane/config.yaml": CONFIG,
    "specs/features/alpha.md": fm("feature/alpha"),
    "ext-specs/features/beta.md": fm("feature/beta", "approved"),
    "specs/features/broken.md": "---\n: [\n---\narchitecture-leak\n",
    "plans/p-one/PLAN.md": plan("p-one", "ready"),
    "plans/archive/p-old/PLAN.md": plan("p-old", "done"),
    "plans/p-one/HANDOFF.md": "needle-plan again\n",
  });
  spawnSync("git", ["init", "-q"], { cwd: root });
  return root;
}
const run = (root: string, ...args: string[]) => {
  const r = spawnSync(process.execPath, [cli, "search", ...args], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return { code: r.status, out: r.stdout, err: r.stderr };
};
const json = (root: string, ...args: string[]) => JSON.parse(run(root, ...args, "--json").out) as { path: string; id: string; type: string; status: string; line: number; snippet: string }[];

test("search matches case-insensitively, shows id and snippet, skips broken files on stderr", () => {
  const r = run(repo(), "architecture-leak");
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^feature\/alpha {2}specs\/features\/alpha\.md:8 {2}The Architecture-Leak guard\.$/m);
  assert.match(r.out, /^feature\/beta /m);
  assert.match(r.err, /Skipped specs\/features\/broken\.md/);
});

test("search no match exits 0 with no output", () => {
  const r = run(repo(), "zzz-nothing");
  assert.equal(r.code, 0);
  assert.equal(r.out, "");
});

test("search --kind and --status and --root filters", () => {
  const root = repo();
  assert.deepEqual([...new Set(json(root, "needle-plan", "--kind", "plan").map((h) => h.type))], ["plan"]);
  assert.equal(json(root, "architecture-leak", "--kind", "plan").length, 0);
  assert.deepEqual([...new Set(json(root, "architecture-leak", "--kind", "spec").map((h) => h.id))], ["feature/beta", "feature/alpha"]);
  assert.deepEqual(json(root, "architecture-leak", "--status", "approved").map((h) => h.id), ["feature/beta"]);
  assert.deepEqual(json(root, "needle-plan", "--status", "done").map((h) => h.id), ["p-old"]);
  assert.deepEqual(json(root, "architecture-leak", "--root", "ext").map((h) => h.id), ["feature/beta"]);
  assert.equal(json(root, "needle-plan", "--root", "base").length, 0);
});

test("search --json fields, archived plans, deterministic order", () => {
  const hits = json(repo(), "needle-plan");
  assert.deepEqual(hits.map((h) => `${h.path}:${h.line}`), ["plans/archive/p-old/PLAN.md:9", "plans/p-one/HANDOFF.md:1", "plans/p-one/PLAN.md:9"]);
  assert.deepEqual(Object.keys(hits[0]).sort(), ["id", "line", "path", "snippet", "status", "type"]);
  assert.equal(hits[0].status, "done");
});

test("search unknown kind and root exit 1", () => {
  assert.equal(run(repo(), "x", "--root", "nope").code, 1);
  assert.equal(run(repo(), "x", "--kind", "adr").code, 1);
});
