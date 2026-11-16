/** The line that tells a person the change is not in effect yet, then the command that commits it. */
export const COMMIT_LEAD = "Commit it to apply:";

/** `git add <paths> && git commit -m "<message>"`, ready to run. */
export function commitCommand(paths: string[], message: string): string {
  return `git add ${paths.join(" ")} && git commit -m ${JSON.stringify(message)}`;
}

/** The two lines a command prints after writing a file it did not commit (the lead-in and the commit command). */
export function commitLines(paths: string[], message: string): string[] {
  return [COMMIT_LEAD, commitCommand(paths, message)];
}
