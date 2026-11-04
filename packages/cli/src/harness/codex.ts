import * as fs from "node:fs";
import * as path from "node:path";
import { type Harness, templatesDir, withInstallTransaction } from "./index.js";
import { assertInstallDestination, InstallationPathError } from "./containment.js";

export const CODEX_SKILL = ".agents/skills/specplane/SKILL.md";
export const CODEX_WORKFLOWS_LINE = "use the CLI workflows in `.agents/skills/specplane/SKILL.md`; no Claude slash commands, permission grants, or background Codex adapter are installed.";

/** Opt-in Codex/Dot CLI integration; never writes settings, credentials, or permission files. */
export const codex: Harness = {
  name: "codex",
  detect: root => fs.existsSync(path.join(root, CODEX_SKILL)),
  install(root, report) {
    const file = path.join(root, CODEX_SKILL);
    try { assertInstallDestination(root, file); }
    catch (error) {
      if (!(error instanceof InstallationPathError)) throw error;
      report.skipped(file, error.message);
      return;
    }
    const content = fs.readFileSync(path.join(templatesDir("codex"), "skills", "specplane", "SKILL.md"), "utf8");
    withInstallTransaction(root, report, (tx) => {
      switch (tx.classify(file, Buffer.from(content))) {
        case "current":
          report.skipped(file, "up to date");
          return;
        case "customized":
          report.skipped(file, "existing skill preserved; compare with bundled Codex template before updating");
          return;
        case "owned-stale":
          tx.stage(file, content, { owned: true });
          report.updated(file);
          return;
        default:
          tx.stage(file, content, { owned: true });
          report.created(file);
          report.add("Codex/Dot CLI workflow integration installed; no settings or persistent permissions changed.");
      }
    });
  },
  skillDirs: root => fs.existsSync(path.join(root, CODEX_SKILL)) ? [path.dirname(CODEX_SKILL).split(path.sep).join("/")] : [],
  rulesFile: CODEX_SKILL,
  rulesTemplate: "skills/specplane/SKILL.md",
  bundledContracts: { "architecture/codex-integration": "contracts/codex-integration.md" },
  workflowsLine: CODEX_WORKFLOWS_LINE,
};
