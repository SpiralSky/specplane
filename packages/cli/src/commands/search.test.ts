import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { CONFIG, makeRepo, spec } from "../test-repo.js";

const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "cli.js");
const fm = (id: string, status = "draft") => spec({ id, title: `T ${id}`, status, author: "user" }, "# T\nThe Architecture-Leak guard.\nother\n");
const many = (id: string) => spec({ id, title: `T ${id}`, status: "draft", author: "user" }, "# T\nmany\nmany\nmany\nmany\n");
const plan = (id: string, status: string) =>
  `---\nid: ${id}\ntitle: P\nstatus: ${status}\nspecs: []\ndepends_on: []\n---\n# P\nneedle-plan here\n`;
const step = (planId: string, n: number, title: string) =>
  `---\nplan: ${planId}\nstep: ${n}\ntitle: ${title}\nstatus: done\n---\n# ${title}\nneedle-step here\n`;

function repo(): string {
  const root = makeRepo({
    ".specplane/config.yaml": CONFIG,
    "specs/features/alpha.md": fm("feature/alpha"),
    "specs/features/gamma.md": many("feature/gamma"),
    "ext-specs/features/beta.md": fm("feature/beta", "approved"),
    "specs/features/broken.md": "---\n: [\n---\narchitecture-leak\n",
    "plans/p-one/PLAN.md": plan("p-one", "ready"),
    "plans/p-one/steps/01-first.md": step("p-one", 1, "First"),
    "plans/p-one/HANDOFF.md": "needle-plan again\n",
    "plans/archive/p-old/PLAN.md": plan("p-old", "done"),
  });
  spawnSync("git", ["init", "-q"], { cwd: root });
  return root;
}
const run = (root: string, ...args: string[]) => {
  const r = spawnSync(process.execPath, [cli, "search", ...args], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return { code: r.status, out: r.stdout, err: r.stderr };
};
interface File {
  id: string;
  kind: string;
  path: string;
  root: string | null;
  status: string | null;
  matches: { line: number; text: string }[];
}
const json = (root: string, ...args: string[]) => JSON.parse(run(root, ...args, "--json").out) as File[];

test("search is case-insensitive, prints one block per file, and skips broken files on stderr", () => {
  const r = run(repo(), "ARCHITECTURE-leak");
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^feature\/alpha {2}specs\/features\/alpha\.md\n {2}8: The Architecture-Leak guard\.$/m);
  assert.match(r.out, /^feature\/beta {2}ext-specs\/features\/beta\.md\n {2}8: The Architecture-Leak guard\.$/m);
  assert.match(r.err, /Skipped specs\/features\/broken\.md/);
});

test("search no match exits 0 with no output", () => {
  const r = run(repo(), "zzz-nothing");
  assert.equal(r.code, 0);
  assert.equal(r.out, "");
});

test("search --kind and --status and --root filters", () => {
  const root = repo();
  const plans = json(root, "needle-plan", "--kind", "plan");
  assert.deepEqual([...new Set(plans.map((f) => f.kind))], ["plan"]);
  assert.deepEqual(plans.map((f) => f.path), ["plans/archive/p-old/PLAN.md", "plans/p-one/PLAN.md"]);
  assert.equal(json(root, "needle-plan").some((f) => f.path.endsWith("HANDOFF.md")), false);
  assert.equal(json(root, "architecture-leak", "--kind", "plan").length, 0);
  assert.deepEqual(json(root, "architecture-leak", "--kind", "spec").map((f) => f.id).sort(), ["feature/alpha", "feature/beta"]);
  assert.deepEqual(json(root, "architecture-leak", "--status", "approved").map((f) => f.id), ["feature/beta"]);
  assert.deepEqual(json(root, "needle-plan", "--status", "done").map((f) => f.id), ["p-old"]);
  assert.deepEqual(json(root, "architecture-leak", "--root", "ext").map((f) => f.id), ["feature/beta"]);
  assert.equal(json(root, "needle-plan", "--root", "base").length, 0);
});

test("search --json fields, spec root, archived plans, deterministic path order", () => {
  const files = json(repo(), "needle-plan");
  assert.deepEqual(files.map((f) => `${f.path}:${f.matches[0].line}`), ["plans/archive/p-old/PLAN.md:9", "plans/p-one/PLAN.md:9"]);
  assert.deepEqual(Object.keys(files[0]).sort(), ["id", "kind", "matches", "path", "root", "status"]);
  assert.equal(files[0].status, "done");
  assert.equal(files[0].root, null);
  assert.deepEqual(files[0].matches, [{ line: 9, text: "needle-plan here" }]);
  const alpha = json(repo(), "architecture-leak", "--kind", "spec").find((f) => f.id === "feature/alpha")!;
  assert.equal(alpha.root, "base");
});

test("search groups step files under their plan and names the step in human output", () => {
  const files = json(repo(), "needle-step");
  assert.equal(files.length, 1);
  assert.equal(files[0].id, "p-one");
  assert.equal(files[0].kind, "plan");
  assert.equal(files[0].path, "plans/p-one/steps/01-first.md");
  assert.match(run(repo(), "needle-step").out, /^p-one \(step 01-first\) {2}plans\/p-one\/steps\/01-first\.md\n {2}8: needle-step here$/m);
});

test("search caps matches at three per file", () => {
  const files = json(repo(), "many");
  assert.equal(files.length, 1);
  assert.deepEqual(files[0].matches.map((m) => m.line), [8, 9, 10]);
});

test("search unknown kind and root exit 1", () => {
  assert.equal(run(repo(), "x", "--root", "nope").code, 1);
  assert.equal(run(repo(), "x", "--kind", "adr").code, 1);
});
