/** The line that tells a person the change is not in effect yet, then the command that commits it. */
export const COMMIT_LEAD = "Commit it to apply:";

/**
 * `git add -- :/<paths> && git commit -m "<message>" -- :/<paths>`, ready to run. The `:/` prefix resolves each path
 * from the repository top level, so the command works from any subdirectory; the trailing pathspec commits only the
 * written files, never anything else the person had staged.
 */
export function commitCommand(paths: string[], message: string): string {
  const specs = paths.map((p) => `:/${p}`).join(" ");
  return `git add -- ${specs} && git commit -m ${JSON.stringify(message)} -- ${specs}`;
}

/** The two lines a command prints after writing a file it did not commit (the lead-in and the commit command). */
export function commitLines(paths: string[], message: string): string[] {
  return [COMMIT_LEAD, commitCommand(paths, message)];
}
