import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { SpecplaneError, UsageError } from "../errors.js";
import { checkoutRoot } from "../git/repo.js";
import { adapterNames, getAdapter, reportCapabilities } from "../harness/adapter.js";
import "../harness/adapters.js";
import { CODEX_WITHHELD } from "../harness/codex-skills.js";
import { CODEX_CONFIG, installHarness } from "../harness/install.js";
import { CONFIG_PATH } from "../config.js";
import { ensureNotesRefspecs } from "../spec/sync.js";

const DEFAULT_CONFIG = `# Specplane configuration (architecture/file-formats §6). Every key is optional; these are the defaults.
paths:
  requirements: docs/requirements
  features: docs/specifications/features
  architecture: docs/specifications/architecture
`;

/**
 * \`specplane init [--harness <name>]` (`architecture/reference-cli` §13.1): sets the notes fetch refspec for every remote
 * so approval records travel with fetches, then installs the named harness (`§12.6`) and says which capabilities it
 * lacks (`harness R35.1`). When no `.specplane/config.yaml` exists, writes a default one (never overwriting) so the installed hooks have a configuration to enforce.
 */
export function runInit(root: string, opts: { harness?: string } = {}): string[] {
  const name = opts.harness && opts.harness !== "none" ? opts.harness : null;
  const adapter = name ? getAdapter(name) : undefined;
  if (name && !adapter) throw new UsageError(`Unknown harness: ${name}. Supported: ${adapterNames().join(", ")}.`);
  const lines = ensureNotesRefspecs(root);
  const file = path.join(root, CONFIG_PATH);
  if (!existsSync(file)) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, DEFAULT_CONFIG, { flag: "wx" });
    lines.push(`Created ${CONFIG_PATH} with the default settings. Commit it: configuration is read from HEAD, so nothing is enforced until it is committed.`);
  }
  if (name && adapter) {
    const r = installHarness(root, name);
    for (const f of r.written) lines.push(`Installed ${f}`);
    for (const f of r.unchanged) lines.push(`Unchanged ${f}`);
    lines.push(...r.lines, ...reportCapabilities(adapter, root));
    if (name === "codex") {
      lines.push(`codex: the Specplane MCP server is registered in ${CODEX_CONFIG} (project configuration, which Codex reads only for a trusted project); whether this Codex surface loads it is not verified.`);
      lines.push(`codex: not offered, because Codex has no verified typed commands: ${CODEX_WITHHELD.join(", ")}. Run them in your own terminal.`);
    }
  }
  return lines.length ? lines : ["Nothing to do: every remote already fetches the notes."];
}

export function initCommand(opts: { harness?: string } = {}): void {
  try {
    process.stdout.write(runInit(checkoutRoot(), opts).join("\n") + "\n");
  } catch (e) {
    if (e instanceof SpecplaneError) {
      process.stderr.write(`${e.message}\n`);
      process.exitCode = e.exitCode;
      return;
    }
    throw e;
  }
}
