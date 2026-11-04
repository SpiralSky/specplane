import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { CONFIG, makeRepo, spec } from "../test-repo.js";
import { acquireWriterLease } from "../core/writer-leases.js";

const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "cli.js");
const ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };

function repo() {
  const root = makeRepo({
    ".specplane/config.yaml": CONFIG,
    "specs/features/draft.md": spec({ id: "feature/draft", title: "Draft", status: "review", author: "user" }),
    "decisions/0001-example.md": "---\nid: decision/0001\ntitle: Example\ndate: 2026-01-01\nstatus: proposed\n---\n# Example\n",
  });
  for (const args of [["init", "-q", "-b", "main"], ["add", "-A"], ["commit", "-q", "-m", "init"]]) spawnSync("git", args, { cwd: root, env: ENV });
  return root;
}
const sp = (cwd: string, ...args: string[]) => spawnSync(process.execPath, [cli, ...args], { cwd, encoding: "utf8", env: ENV, input: "" });
const head = (cwd: string) => spawnSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).stdout.trim();

test("stateful spec and ADR commands refuse while another writer holds the checkout and succeed afterwards", () => {
  const root = repo();
  try {
    const before = head(root);
    const lease = acquireWriterLease({ repository: true, checkouts: [root], requestId: "other-writer" });
    const commands = [
      ["spec", "new", "feature", "held", "--title", "Held"],
      ["decision", "new", "Held decision"],
      ["spec", "approve", "feature/draft"],
      ["decision", "accept", "decision/0001"],
    ];
    for (const args of commands) {
      const r = sp(root, ...args);
      assert.notEqual(r.status, 0, `${args.join(" ")} ran under a held lease: ${r.stdout}`);
    }
    assert.equal(fs.existsSync(path.join(root, "specs/features/held.md")), false);
    assert.equal(head(root), before);
    assert.match(fs.readFileSync(path.join(root, "specs/features/draft.md"), "utf8"), /status: "?review"?/);
    lease.release();
    const ok = sp(root, "spec", "new", "feature", "held", "--title", "Held");
    assert.equal(ok.status, 0, ok.stderr);
    assert.equal(fs.existsSync(path.join(root, "specs/features/held.md")), true);
    assert.equal(sp(root, "spec", "approve", "feature/draft").status, 0);
    acquireWriterLease({ repository: true, checkouts: [root], requestId: "after" }).release();
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
