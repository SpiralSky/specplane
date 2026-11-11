import { SpecplaneError, UsageError } from "../errors.js";
import { checkoutRoot } from "../git/repo.js";
import { ensureNotesRefspecs } from "../spec/sync.js";

/**
 * Interim `specplane init`: sets the notes fetch refspec for every remote so approval records travel with fetches.
 * Configuration is created on request through `config set`; harness installation is the installer's job
 * (`architecture/reference-cli` §12.6) and is not available through this command yet.
 */
export function runInit(root: string, opts: { harness?: string } = {}): string[] {
  if (opts.harness && opts.harness !== "none") throw new UsageError(`Harness installation is not available yet (requested: ${opts.harness}).`);
  const lines = ensureNotesRefspecs(root);
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
