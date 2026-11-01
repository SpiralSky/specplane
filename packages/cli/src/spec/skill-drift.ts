import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { SpecplaneError, SpecNotFoundError } from "../errors.js";
import { type Harness, HARNESSES, skillDirsIn, templatesDir } from "../harness/index.js";
import { readFrontmatter } from "../frontmatter.js";
import { finding } from "../report.js";
import type { Config, Finding } from "../types.js";
import { comparePin } from "./pins.js";
import { resolveSpecId } from "./resolve.js";
import { headingSlugs } from "./slug.js";

const CONTRACT = /<!--\s*specplane-contract:\s*(\S+?)#(\S+?)@([0-9a-fA-F]{7,40})\s*-->/;
const CONTRACT_ANY = /<!--\s*specplane-contract:/;

/**
 * Skill directories (repo-relative, POSIX): those of every installed harness (registry `skillDirs`)
 * and, in a repository that ships harnesses, `harnesses/<name>/templates/skills/*`.
 */
export function skillDirs(root: string, registry: Harness[] = HARNESSES): string[] {
  const out = new Set<string>();
  for (const h of registry) if (h.detect(root)) for (const d of h.skillDirs(root)) out.add(d);
  const hroot = path.join(root, "harnesses");
  if (fs.existsSync(hroot)) {
    for (const e of fs.readdirSync(hroot, { withFileTypes: true })) {
      if (e.isDirectory()) for (const d of skillDirsIn(root, `harnesses/${e.name}/templates/skills`)) out.add(d);
    }
  }
  return [...out].sort((a, b) => a.localeCompare(b));
}

/** Contract drift findings (type `skill-drift`, warnings) for every skill. */
export function checkSkillDrift(config: Config, root: string, registry: Harness[] = HARNESSES): Finding[] {
  const out: Finding[] = [];
  for (const dir of skillDirs(root, registry)) {
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
      // Only a registered harness may supply its own installed skill's upstream contract.
      // Local project contracts take precedence; no generic unresolved-reference exemption.
      const owner = e instanceof SpecNotFoundError ? registry.find(h => h.detect(root) && h.skillDirs(root).includes(dir) && h.bundledContracts?.[specId]) : undefined;
      const bundled = owner?.bundledContracts?.[specId];
      if (owner && bundled) {
        try {
          const file = path.join(templatesDir(owner.name), bundled);
          const bytes = fs.readFileSync(file);
          if (!headingSlugs(readFrontmatter(file).body).includes(slug)) {
            warn(`Skill \`${skill}\`: bundled contract anchor \`${contract}\` does not match a heading.`);
          } else {
            const hash = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
            if (!hash.startsWith(pin.toLowerCase())) warn(`Skill \`${skill}\`: bundled contract \`${contract}\` differs from pin \`${pin}\`; review the installed template and upstream contract.`);
          }
        } catch {
          warn(`Skill \`${skill}\`: bundled contract \`${contract}\` is unavailable or invalid.`);
        }
      } else {
        warn(`Skill \`${skill}\`: contract anchor \`${contract}\` does not match a heading (\`${specId}\` does not resolve).`);
      }
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
