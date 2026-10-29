import * as fs from "node:fs";
import * as path from "node:path";
import { loadConfig } from "../config.js";
import { SpecplaneError } from "../errors.js";
import { generatePlansMd, plansMdPath } from "../generate/plans-md.js";
import { checkoutRoot } from "../git/repo.js";

export function generateCommand(opts: { print?: boolean; live?: boolean }): void {
  try {
    const root = checkoutRoot();
    const { config } = loadConfig(root);
    if (opts.live && !opts.print) {
      process.stderr.write("--live requires --print: the committed PLANS.md never contains live statuses.\n");
      process.exitCode = 1;
      return;
    }
    const content = generatePlansMd(config, root, { live: opts.live });
    if (opts.print) {
      process.stdout.write(content);
      return;
    }
    const file = plansMdPath(config, root);
    const rel = path.relative(root, file);
    if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === content) {
      process.stdout.write(`Unchanged ${rel}\n`);
      return;
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    process.stdout.write(`Wrote ${rel}\n`);
  } catch (e) {
    if (e instanceof SpecplaneError) {
      process.stderr.write(`${e.message}\n`);
      process.exitCode = e.exitCode;
      return;
    }
    throw e;
  }
}
