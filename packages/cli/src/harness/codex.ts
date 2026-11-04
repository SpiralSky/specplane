import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { type Harness, withInstallTransaction } from "./index.js";
import { assembleCodexSkillPackage, packageFiles } from "./codex-package.js";
import { assertInstallDestination, InstallationPathError } from "./containment.js";
import { buildInstalledManifest, collisionFor, collisionLine, type ObservedFile, sha256, stageInstalledManifest } from "./rollout.js";

export const CODEX_SKILL = ".agents/skills/specplane/SKILL.md";
const CODEX_SKILL_DIR = ".agents/skills/specplane";
/** Entry points named in the installed manifest; `core/inventory.json` hashes everything else. */
const MANIFEST_FILES = ["SKILL.md", "scripts/workflow.mjs", "references/shared-procedure.md", "specplane-extension.json", "core/inventory.json"];

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
    const skillDir = path.dirname(file);
    const staging = fs.mkdtempSync(path.join(os.tmpdir(), "specplane-codex-package-"));
    try {
      const pkg = path.join(staging, "package");
      assembleCodexSkillPackage(pkg);
      withInstallTransaction(root, report, (tx) => {
        const counts = { created: 0, updated: 0, current: 0, preserved: 0 };
        const observed: ObservedFile[] = [];
        let skillKind = "absent";
        for (const rel of packageFiles(pkg)) {
          const dest = path.join(skillDir, ...rel.split("/"));
          const bytes = fs.readFileSync(path.join(pkg, ...rel.split("/")));
          const kind = tx.classify(dest, bytes);
          if (rel === "SKILL.md") skillKind = kind;
          const display = `${CODEX_SKILL_DIR}/${rel}`;
          const customized = kind === "customized";
          if (customized) counts.preserved++;
          else if (kind === "current") counts.current++;
          else { tx.stage(dest, bytes, { owned: true }); if (kind === "absent") counts.created++; else counts.updated++; }
          // The inventory vouches for the runtime tree; the manifest names the entry points and anything preserved.
          if (customized || MANIFEST_FILES.includes(rel)) {
            const outcome: ObservedFile["outcome"] = customized ? "customized" : "installed";
            const entry: ObservedFile = { path: display, outcome, sha256: sha256(customized ? tx.read(dest) ?? bytes : bytes) };
            observed.push(entry);
            if (customized) report.add(collisionLine(collisionFor(entry, "codex")));
          }
        }
        const skillFile = path.join(root, CODEX_SKILL);
        if (skillKind === "current") report.skipped(skillFile, "up to date");
        else if (skillKind === "customized") report.skipped(skillFile, "existing skill preserved; compare with bundled Codex template before updating");
        else if (skillKind === "owned-stale") report.updated(skillFile);
        else report.created(skillFile);
        const total = counts.created + counts.updated + counts.current + counts.preserved;
        report.add(`Codex workflow runner package: ${total} files (${counts.created} added, ${counts.updated} updated, ${counts.current} current, ${counts.preserved} preserved).`);
        if (counts.preserved) report.add("Preserved Codex package files no longer match the package inventory, so the persistent runner will refuse preparation until they are reconciled; the labeled manual CLI fallback remains available.");
        if (skillKind === "absent") report.add("Codex/Dot CLI workflow integration installed; no settings or persistent permissions changed.");
        // Staged last so the transaction writes it after every other file.
        stageInstalledManifest(root, tx, buildInstalledManifest("codex", observed));
      });
    } finally {
      fs.rmSync(staging, { recursive: true, force: true });
    }
  },
  skillDirs: root => fs.existsSync(path.join(root, CODEX_SKILL)) ? [path.dirname(CODEX_SKILL).split(path.sep).join("/")] : [],
  rulesFile: CODEX_SKILL,
  rulesTemplate: "skills/specplane/SKILL.md",
  bundledContracts: { "architecture/codex-integration": "contracts/codex-integration.md" },
};
