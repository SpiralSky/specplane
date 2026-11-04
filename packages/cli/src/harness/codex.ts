import * as fs from "node:fs";
import * as path from "node:path";
import { type Harness, templatesDir, withInstallTransaction } from "./index.js";
import { assertInstallDestination, InstallationPathError } from "./containment.js";
import { buildInstalledManifest, collisionFor, collisionLine, type ObservedFile, sha256, stageInstalledManifest } from "./rollout.js";

export const CODEX_SKILL = ".agents/skills/specplane/SKILL.md";

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
      const kind = tx.classify(file, Buffer.from(content));
      const observed: ObservedFile = {
        path: CODEX_SKILL,
        outcome: kind === "customized" ? "customized" : "installed",
        sha256: sha256(kind === "customized" ? tx.read(file) ?? content : content),
      };
      if (kind === "customized") report.add(collisionLine(collisionFor(observed, "codex")));
      // Staged after the skill so it is written last; it also records an up-to-date or preserved skill.
      const manifest = () => stageInstalledManifest(root, tx, buildInstalledManifest("codex", [observed]));
      switch (kind) {
        case "current":
          report.skipped(file, "up to date");
          manifest();
          return;
        case "customized":
          report.skipped(file, "existing skill preserved; compare with bundled Codex template before updating");
          manifest();
          return;
        case "owned-stale":
          tx.stage(file, content, { owned: true });
          manifest();
          report.updated(file);
          return;
        default:
          tx.stage(file, content, { owned: true });
          manifest();
          report.created(file);
          report.add("Codex/Dot CLI workflow integration installed; no settings or persistent permissions changed.");
      }
    });
  },
  skillDirs: root => fs.existsSync(path.join(root, CODEX_SKILL)) ? [path.dirname(CODEX_SKILL).split(path.sep).join("/")] : [],
  rulesFile: CODEX_SKILL,
  rulesTemplate: "skills/specplane/SKILL.md",
  bundledContracts: { "architecture/codex-integration": "contracts/codex-integration.md" },
};
