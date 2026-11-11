import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { SETTINGS } from "../config.js";
import { CATALOG } from "../perm/permissions.js";
import { CAPABILITY_LABELS, adapterNames } from "../harness/adapter.js";
import "../harness/adapters.js";
import { MANDATORY_NOTES, REQUIRED_TOPIC_IDS } from "./required-topics.js";

/**
 * The topics and facts the user documentation must contain (`architecture/reference-cli` §12.5, `steering` R22): the
 * specification, plan and configuration formats, every command, every configuration key with its default, every
 * permission, and five mandatory notes. The build fails when one is missing.
 */

export { MANDATORY_NOTES, REQUIRED_TOPIC_IDS };

export interface RequiredInputs {
  permissions: string[];
  commands: string[];
  settings: string[];
  harnesses: string[];
  capabilities: string[];
}

export interface RequiredFacts { commands: string[]; config_keys: string[]; permissions: string[]; notes: string[] }

const cliPath = fileURLToPath(new URL("../cli.js", import.meta.url));

/** Every runnable command path, found by walking the `--help` output of the built CLI. */
export function collectCommands(): string[] {
  const out: string[] = [];
  const walk = (path: string[]): void => {
    const help = spawnSync(process.execPath, [cliPath, ...path, "--help"], { encoding: "utf8" }).stdout ?? "";
    const usage = /^Usage: (.*)$/m.exec(help)?.[1] ?? "";
    const section = /^Commands:\n([\s\S]*)$/m.exec(help);
    const subs = section ? section[1].split("\n").map((l) => /^ {2}(\S+)/.exec(l)?.[1]).filter((s): s is string => !!s && s !== "help") : [];
    if (!subs.length) { out.push(path.join(" ")); return; }
    if (path.length && /\[command\]\s+\S/.test(usage)) out.push(path.join(" ")); // the parent also runs with an argument
    for (const s of subs) walk([...path, s]);
  };
  walk([]);
  return out.sort();
}

export function collectRequiredInputs(): RequiredInputs {
  return {
    permissions: [...CATALOG],
    commands: collectCommands(),
    settings: SETTINGS.map((s) => s.key),
    harnesses: adapterNames(),
    capabilities: Object.values(CAPABILITY_LABELS),
  };
}

/** The paragraph that follows a note marker (blank lines skipped), or undefined when the marker is absent. */
export function noteText(text: string, id: string): string | undefined {
  const marker = `<!-- note: ${id} -->`;
  const at = text.indexOf(marker);
  if (at === -1) return undefined;
  return text.slice(at + marker.length).trim().split(/\n\s*\n/)[0].trim();
}

const has = (text: string, needle: string): boolean => text.toLowerCase().includes(needle.toLowerCase());

/** Returns one message per missing or incomplete requirement; empty means the documentation is complete. */
export function checkRequiredTopics(docs: ReadonlyMap<string, string>, inputs: RequiredInputs): string[] {
  const errors: string[] = [];
  for (const id of REQUIRED_TOPIC_IDS) if (!docs.has(id)) errors.push(`missing topic \`${id}\``);
  const all = [...docs.values()].join("\n");

  const commands = docs.get("commands") ?? "";
  for (const c of inputs.commands) if (!commands.includes(`### \`${c}\`\n`)) errors.push(`command \`${c}\` is not documented in the commands topic (heading \`### \`${c}\`\`)`);

  const permissions = docs.get("permissions") ?? "";
  for (const p of inputs.permissions) if (!permissions.includes(`### \`${p}\`\n`)) errors.push(`permission \`${p}\` is not documented in the permissions topic`);

  const configuration = docs.get("configuration") ?? "";
  for (const key of inputs.settings) {
    const row = configuration.split("\n").find((l) => l.startsWith(`| \`${key}\` |`));
    const cells = row?.split(/(?<!\\)\|/).map((c) => c.trim());
    if (!row) errors.push(`configuration key \`${key}\` is not documented in the configuration topic`);
    else if (!cells || !cells[2] || cells[2] === "``") errors.push(`configuration key \`${key}\` is shown without its default`);
  }

  for (const id of MANDATORY_NOTES) {
    const text = noteText(all, id);
    if (text === undefined) errors.push(`mandatory note \`${id}\` is missing (marker \`<!-- note: ${id} -->\`)`);
    else if (text.length < 40) errors.push(`mandatory note \`${id}\` has no text`);
  }

  const harnesses = docs.get("harnesses") ?? "";
  for (const h of inputs.harnesses) if (!has(harnesses, h)) errors.push(`harness \`${h}\` is not named in the harnesses topic`);
  for (const c of inputs.capabilities) if (!has(harnesses, c)) errors.push(`capability "${c}" is missing from the harness support table`);
  return errors;
}

export function requiredFacts(inputs: RequiredInputs): RequiredFacts {
  return { commands: inputs.commands, config_keys: inputs.settings, permissions: inputs.permissions, notes: [...MANDATORY_NOTES] };
}
