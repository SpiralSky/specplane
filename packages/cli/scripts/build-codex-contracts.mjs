// Regenerates harnesses/codex/templates/{skills,contracts} from the packaged command contracts. Run after `npm run build`
// whenever assets/commands changes; the test suite fails when the committed files differ (codex-integration §7, T3).
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CODEX_CONTRACTS, contractPath, renderCodexContract, renderCodexSkill, SKILL_FILE } from "../dist/harness/codex-skills.js";

const templates = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../harnesses/codex/templates");
const out = (rel, text) => { const f = path.join(templates, rel); mkdirSync(path.dirname(f), { recursive: true }); writeFileSync(f, text); };
out(SKILL_FILE, renderCodexSkill());
for (const command of CODEX_CONTRACTS) out(contractPath(command), renderCodexContract(command));
console.log(`wrote the skill and ${CODEX_CONTRACTS.length} contracts`);
