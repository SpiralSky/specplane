import { SpecplaneError, UsageError } from "../errors.js";
import { checkoutRoot } from "../git/repo.js";
import { adapterNames, getAdapter, reportCapabilities } from "../harness/adapter.js";
import "../harness/adapters.js";
import { installHarness } from "../harness/install.js";
import { ensureNotesRefspecs } from "../spec/sync.js";

/**
 * `specplane init [--harness <name>]` (`architecture/reference-cli` §13.1): sets the notes fetch refspec for every remote
 * so approval records travel with fetches, then installs the named harness (`§12.6`) and says which capabilities it
 * lacks (`harness R35.1`). Configuration is created on request through `config set`.
 */
export function runInit(root: string, opts: { harness?: string } = {}): string[] {
  const name = opts.harness && opts.harness !== "none" ? opts.harness : null;
  const adapter = name ? getAdapter(name) : undefined;
  if (name && !adapter) throw new UsageError(`Unknown harness: ${name}. Supported: ${adapterNames().join(", ")}.`);
  const lines = ensureNotesRefspecs(root);
  if (name && adapter) {
    const r = installHarness(root, name);
    for (const f of r.written) lines.push(`Installed ${f}`);
    for (const f of r.unchanged) lines.push(`Unchanged ${f}`);
    lines.push(...r.lines, ...reportCapabilities(adapter, root));
    if (name === "codex") lines.push("codex: the Specplane MCP server is not registered in Codex configuration by this release; the Codex integration adds that entry.");
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
