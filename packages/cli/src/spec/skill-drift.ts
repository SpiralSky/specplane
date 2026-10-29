import * as fs from "node:fs";
import * as path from "node:path";
import { SpecplaneError } from "../errors.js";
import { readFrontmatter } from "../frontmatter.js";
import { finding } from "../report.js";
import type { Config, Finding } from "../types.js";
import { comparePin } from "./pins.js";
import { resolveSpecId } from "./resolve.js";
import { headingSlugs } from "./slug.js";

const CONTRACT = /<!--\s*specplane-contract:\s*(\S+?)#(\S+?)@([0-9a-fA-F]{7,40})\s*-->/;
const CONTRACT_ANY = /<!--\s*specplane-contract:/;

/**
 * Skill directories (repo-relative, POSIX) to check. Until harnesses are installable
 * (`init --harness`), these are the Specplane-owned skill locations of the Claude harness
 * overlay; replace this function when harness registration exists.
 */
export function skillDirs(_config: Config, root: string): string[] {
  const out: string[] = [];
  for (const base of [".claude/skills", "harnesses/claude/templates/skills"]) {
    const abs = path.join(root, base);
    if (!fs.existsSync(abs)) continue;
    for (const e of fs.readdirSync(abs, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.isDirectory() && fs.existsSync(path.join(abs, e.name, "SKILL.md"))) out.push(`${base}/${e.name}`);
    }
  }
  return out;
}

/** Contract drift findings (type `skill-drift`, warnings) for every skill. */
export function checkSkillDrift(config: Config, root: string): Finding[] {
  const out: Finding[] = [];
  for (const dir of skillDirs(config, root)) {
    const rel = `${dir}/SKILL.md`;
    const skill = path.basename(dir);
    const warn = (message: string) => out.push(finding("warning", "skill-drift", rel, message));
    const text = fs.readFileSync(path.join(root, rel), "utf8");
    const m = CONTRACT.exec(text);
    if (!m) {
      warn(
        CONTRACT_ANY.test(text)
          ? `Skill \`${skill}\` has a malformed \`specplane-contract\` comment (§1.6).`
          : `Skill \`${skill}\` has no \`specplane-contract\` comment (§1.6).`,
      );
      continue;
    }
    const [, specId, slug, pin] = m;
    const contract = `${specId}#${slug}`;
    let target;
    try {
      target = resolveSpecId(specId, config, undefined, root);
    } catch (e) {
      if (!(e instanceof SpecplaneError)) throw e;
      warn(`Skill \`${skill}\`: contract anchor \`${contract}\` does not match a heading (\`${specId}\` does not resolve).`);
      continue;
    }
    let body = "";
    try {
      body = readFrontmatter(target.path).body;
    } catch {
      /* unparsable target: no anchors */
    }
    if (!headingSlugs(body).includes(slug)) {
      warn(`Skill \`${skill}\`: contract anchor \`${contract}\` does not match a heading.`);
      continue;
    }
    const state = comparePin(pin.toLowerCase(), path.relative(root, target.path).split(path.sep).join("/"), root);
    if (state.status === "stale") {
      const unavailable = state.diffAvailable ? "" : ` (diff unavailable: \`${pin}\` is not in the local object store)`;
      warn(`Skill \`${skill}\` implements \`${contract}\` pinned at \`${pin}\`, which has changed; review \`git diff ${pin} ${state.current}\`, update the skill, then update its contract comment.${unavailable}`);
    }
  }
  return out;
}
