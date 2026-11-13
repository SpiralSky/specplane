import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const script = fileURLToPath(new URL("../scripts/test.sh", import.meta.url));
const markers = [
  "SPECPLANE_ACTOR", "SPECPLANE_PROVIDER", "SPECPLANE_AGENT", "SPECPLANE_SESSION",
  "SPECPLANE_AGENT_TYPE", "SPECPLANE_SUBAGENT", "SPECPLANE_MODEL", "SPECPLANE_DELEGATED_BY",
  "SPECPLANE_ADAPTER", "SPECPLANE_CHECKOUT", "SPECPLANE_MEASURABLE_RESOURCES",
  "CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT",
];

for (const runner of ["bun", "node", "auto"]) {
  test(`test wrapper clears inherited identity for ${runner}, preserving runner settings and arguments`, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "specplane-runner-"));
    try {
      // Stub executables inspect the runner boundary without recursively running the suite.
      const probe = markers.map((key) => `test "\${${key}+set}" != set || exit 90`).join("\n");
      for (const name of ["bun", "node"]) {
        fs.writeFileSync(path.join(dir, name), `#!/bin/sh\n${probe}\n` +
          `test "$SPECPLANE_TEST_RUNNER" = '${runner}' || exit 91\n` +
          `test -d "$TMPDIR" || exit 92\n` +
          `printf '${name}:%s\\n' "$@"\n` +
          (runner === "auto" && name === "bun" ? "exit 124\n" : "exit 0\n"), { mode: 0o755 });
      }
      fs.writeFileSync(path.join(dir, "timeout"), '#!/bin/sh\nshift 2\nexec "$@"\n', { mode: 0o755 });
      const result = spawnSync("sh", [script, "selected test.js"], {
        encoding: "utf8",
        env: { ...process.env, ...Object.fromEntries(markers.map((key) => [key, key === "SPECPLANE_ACTOR" ? "llm" : "inherited"])),
          PATH: `${dir}:${process.env.PATH}`, SPECPLANE_TEST_RUNNER: runner },
      });
      assert.equal(result.status, 0, result.stderr + result.stdout);
      const expected = runner === "auto" ? ["bun", "node"] : [runner];
      for (const name of expected) assert.ok(result.stdout.includes(`${name}:selected test.js\n`), result.stdout);
      if (runner === "auto") assert.match(result.stderr, /rerunning the suite under Node/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
}
