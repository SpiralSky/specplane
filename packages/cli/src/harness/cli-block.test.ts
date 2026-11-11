import assert from "node:assert/strict";
import { test } from "node:test";
import { isSpecplaneCommand } from "./cli-block.js";

const blocked = [
  "specplane validate", "  specplane", "ls; specplane validate", "true && specplane spec list", "false || specplane x",
  "cat x | specplane x", "echo hi & specplane x", "(specplane validate)", "( cd x && specplane validate )", "{ specplane x; }",
  "env specplane validate", "env -i FOO=bar specplane validate", "FOO=1 specplane x", "env -u HOME specplane x", "command specplane x",
  "sh -c 'specplane validate'", 'bash -c "cd x; specplane validate"', "bash -lc 'specplane x'", "sh -c \"sh -c 'specplane x'\"",
  "npx specplane validate", "npx -y specplane validate", "bunx specplane x", "npx specplane@latest x", "pnpm dlx specplane x", "npm exec specplane x",
  "./node_modules/.bin/specplane x", "/usr/local/bin/specplane x", "node_modules/.bin/specplane.js x",
  "echo $(specplane x)", "echo `specplane x`", 'echo "$(specplane x)"', "x=$(sh -c 'specplane y')",
  "cat <<'EOF'\nx\nEOF\nspecplane validate", "cat <<'EOF' | specplane x\nbody\nEOF", "cat <<EOF\n$(specplane x)\nEOF",
  "if true; then specplane x; fi", "xargs specplane x", "git status\nspecplane validate", "time specplane x", "nohup specplane x &",
];
const allowed = [
  "", "ls -la", "echo specplane", "git commit -m 'run specplane validate'", "grep specplane README.md", "cat specplane.md",
  "npx prettier specplane.md", "bunx eslint .", "sh -c 'echo hi'", "bash script.sh specplane", "echo 'a; specplane x'",
  "git commit -F - <<'EOF'\nroute\n\`specplane mcp\` is run by the adapter\nspecplane validate\nEOF", "cat <<-\"EOF\"\n\tspecplane x\n\tEOF",
  "cd specplane && ls", "make specplane-docs", "node tool.js specplane", "env FOO=bar ls", "npm run build", "echo $(date)",
];

test("isSpecplaneCommand blocks every shell form of the CLI", () => {
  for (const text of blocked) assert.equal(isSpecplaneCommand(text), true, text);
});

test("isSpecplaneCommand allows commands that only mention specplane", () => {
  for (const text of allowed) assert.equal(isSpecplaneCommand(text), false, text);
});

test("isSpecplaneCommand refuses text nested too deeply to judge", () => {
  let text = "specplane x";
  for (let i = 0; i < 12; i++) text = `sh -c '$(${text})'`.replace(/'/g, "");
  assert.equal(isSpecplaneCommand(text), true);
});
