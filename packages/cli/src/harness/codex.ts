import * as fs from "node:fs";
import * as path from "node:path";
import { type Harness, templatesDir } from "./index.js";

export const CODEX_SKILL = ".agents/skills/specplane/SKILL.md";
export const CODEX_WORKFLOWS_LINE = "use the CLI workflows in `.agents/skills/specplane/SKILL.md`; no Claude slash commands, permission grants, or background Codex adapter are installed.";

/** Opt-in Codex/Dot CLI integration; never writes settings, credentials, or permission files. */
export const codex: Harness = {
  name: "codex",
  detect: root => fs.existsSync(path.join(root, CODEX_SKILL)),
  install(root, report) {
    const file = path.join(root, CODEX_SKILL);
    const realRoot = fs.realpathSync(root);
    for (const rel of [".agents", ".agents/skills", ".agents/skills/specplane", CODEX_SKILL]) {
      const candidate = path.join(root, rel);
      if (!fs.existsSync(candidate)) continue;
      const resolved = fs.realpathSync(candidate);
      if (resolved !== realRoot && !resolved.startsWith(realRoot + path.sep)) {
        report.skipped(file, "skill path resolves outside the repository; no files written there");
        return;
      }
    }
    const content = fs.readFileSync(path.join(templatesDir("codex"), "skills", "specplane", "SKILL.md"), "utf8");
    if (fs.existsSync(file)) {
      report.skipped(file, fs.readFileSync(file, "utf8") === content ? "up to date" : "existing skill preserved; compare with bundled Codex template before updating");
      return;
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    report.created(file);
    report.add("Codex/Dot CLI workflow integration installed; no settings or persistent permissions changed.");
  },
  skillDirs: root => fs.existsSync(path.join(root, CODEX_SKILL)) ? [path.dirname(CODEX_SKILL).split(path.sep).join("/")] : [],
  rulesFile: CODEX_SKILL,
  rulesTemplate: "skills/specplane/SKILL.md",
  bundledContracts: { "architecture/codex-integration": "contracts/codex-integration.md" },
  workflowsLine: CODEX_WORKFLOWS_LINE,
};
