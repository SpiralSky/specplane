/** Typed error classes (architecture/reference-cli § Error classes). */
export abstract class SpecplaneError extends Error {
  abstract readonly exitCode: 1 | 2;
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class ConfigError extends SpecplaneError {
  readonly exitCode = 1;
  /**
   * `key` is a config path (schema violations). Pass `null` when a feature spec fixes the
   * whole message verbatim (cross-field rules, `feature/configuration` acceptance scenarios).
   */
  constructor(key: string | null, reason: string) {
    super(key === null ? reason : `Config key \`${key}\`: ${reason}`);
  }
}
export class UnknownRootError extends SpecplaneError {
  readonly exitCode = 1;
  constructor(name: string) {
    super(`Unknown root \`${name}\`.`);
  }
}
export class SpecNotFoundError extends SpecplaneError {
  readonly exitCode = 1;
  constructor(id: string) {
    super(`Spec \`${id}\` not found.`);
  }
}
export class AmbiguousIdError extends SpecplaneError {
  readonly exitCode = 1;
  constructor(id: string, roots: string[]) {
    super(
      `Ambiguous ID \`${id}\`: found in roots ${roots.map((r) => `\`${r}\``).join(", ")}. Use \`<root>:${id}\`.`,
    );
  }
}
export class FrontmatterError extends SpecplaneError {
  readonly exitCode = 1;
  constructor(file: string, violation: string) {
    super(`\`${file}\`: ${violation}`);
  }
}
export class FrontmatterMissingError extends SpecplaneError {
  readonly exitCode = 1;
  constructor(file: string) {
    super(`\`${file}\`: no frontmatter block found`);
  }
}
export class AlreadyExistsError extends SpecplaneError {
  readonly exitCode = 1;
  constructor(kind: "Spec" | "Plan", id: string) {
    super(kind === "Plan" ? `Plan \`${id}\` already exists. Choose a different slug.` : `Spec \`${id}\` already exists.`);
  }
}
export class PlanNotFoundError extends SpecplaneError {
  readonly exitCode = 1;
  constructor(id: string) {
    super(`Plan \`${id}\` not found.`);
  }
}
export class PlanStateError extends SpecplaneError {
  readonly exitCode = 1;
  /** `message` is the full text; the feature specs fix it verbatim (e.g. "Cannot start plan: `<id>` is `draft`, not `ready`."). */
  constructor(message: string) {
    super(message);
  }
}
export class DependencyCycleError extends SpecplaneError {
  readonly exitCode = 1;
  constructor(public readonly cycle: string[]) {
    super(`Dependency cycle: ${cycle.map((c) => `\`${c}\``).join(" → ")}`);
  }
}
export class SetupHookError extends SpecplaneError {
  readonly exitCode = 1;
  constructor(cmd: string, code: number | null) {
    super(`Setup hook failed: \`${cmd}\` exited with code ${code}. Worktree removed.`);
  }
}
export class RebaseConflictError extends SpecplaneError {
  readonly exitCode = 1;
  constructor(id: string, base: string, files: string[] = []) {
    super(
      `Rebase of \`plan/${id}\` onto \`${base}\` has conflicts; resolve manually.` +
        (files.length > 0 ? `\nConflicting files:\n${files.map((f) => `  ${f}`).join("\n")}` : ""),
    );
  }
}
export class ForgeError extends SpecplaneError {
  readonly exitCode = 2;
  constructor(reason: string) {
    super(`Forge operation failed: ${reason}`);
  }
}
export class GitError extends SpecplaneError {
  readonly exitCode = 2;
  constructor(cmd: string, stderr: string) {
    super(`Git command failed: \`${cmd}\`: ${stderr}`);
  }
}
export class NotARepoError extends SpecplaneError {
  readonly exitCode = 1;
  constructor() {
    super("Not in a git repository");
  }
}

/** Print a SpecplaneError message to stderr and set its exit code; return false for other errors. */
export function reportError(e: unknown): boolean {
  if (!(e instanceof SpecplaneError)) return false;
  process.stderr.write(`${e.message}\n`);
  process.exitCode = e.exitCode;
  return true;
}
export class CommitFormatError extends SpecplaneError {
  readonly exitCode = 1;
  constructor(reason: string) {
    super(`Invalid commit message: ${reason}`);
  }
}
