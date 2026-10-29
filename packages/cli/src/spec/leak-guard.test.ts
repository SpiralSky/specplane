import assert from "node:assert/strict";
import { test } from "node:test";
import { checkArchitectureLeak } from "./leak-guard.js";

const types = (body: string, allow: string[] = []) => checkArchitectureLeak(body, allow).map((w) => `${w.type}:${w.match}`);

test("flags file paths and directory paths", () => {
  assert.deepEqual(types("See src/foo.ts for it."), ["path:src/foo.ts"]);
  assert.deepEqual(types("Use ./a/b.py here"), ["path:./a/b.py"]);
  assert.deepEqual(types("Stored in `plans/archive/` always"), ["path:plans/archive/"]);
});

test("path inside a fenced code block, or in the allow list, is not flagged", () => {
  assert.deepEqual(types("```\nsrc/foo.ts\n```\n"), []);
  assert.deepEqual(types("~~~\nsrc/foo.ts\n~~~\n"), []);
  assert.deepEqual(types("See src/foo.ts", ["src/foo.ts"]), []);
});

test("link targets are ignored", () => {
  assert.deepEqual(types("[doc](docs/some/file.md)"), []);
});

test("flags technology names, case-insensitively and whole-word", () => {
  assert.deepEqual(types("Written in TypeScript."), ["tech_name:TypeScript"]);
  assert.deepEqual(types("uses typescript"), ["tech_name:typescript"]);
  assert.deepEqual(types("typescripts"), []);
  assert.deepEqual(types("we go ahead"), []);
});

test("config keys and built-in names are not flagged", () => {
  assert.deepEqual(types("Set `status_source` to git. See HANDOFF.md and .specplane/config.yaml."), []);
});

test("flags code identifiers of each shape", () => {
  assert.deepEqual(types("camelCase"), ["identifier:camelCase"]);
  assert.deepEqual(types("PascalCase"), ["identifier:PascalCase"]);
  assert.deepEqual(types("snake_case_name"), ["identifier:snake_case_name"]);
  assert.deepEqual(types("$HOME"), ["identifier:$HOME"]);
  assert.deepEqual(types("call run()"), ["identifier:run()"]);
});

test("flags schema syntax lines outside code blocks only", () => {
  assert.deepEqual(types("required: [a]"), ["schema_syntax:required:"]);
  assert.deepEqual(types("```yaml\nrequired: [a]\n```"), []);
});

test("reports body line numbers", () => {
  const w = checkArchitectureLeak("one\n\ntwo src/x.ts\n", []);
  assert.equal(w[0].line, 3);
});

test("configured allow terms are removed", () => {
  assert.deepEqual(types("Use Docker with Widget", ["Docker"]), []);
});
