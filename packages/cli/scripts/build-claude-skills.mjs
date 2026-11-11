// Regenerates harnesses/claude/templates/skills from the packaged command contracts. Run after `npm run build`
// whenever assets/commands changes; the test suite fails when the committed skills differ (claude-integration §9, T2).
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderSkill, skillPath, SKILL_COMMANDS } from "../dist/harness/claude-skills.js";

const templates = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../harnesses/claude/templates");
for (const command of SKILL_COMMANDS) {
  const file = path.join(templates, skillPath(command));
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, renderSkill(command));
}
console.log(`wrote ${SKILL_COMMANDS.length} skills`);
