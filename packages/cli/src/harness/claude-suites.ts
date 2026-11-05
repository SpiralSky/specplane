// Suite commands for the Claude workflow server (`architecture/claude-integration` § Reviewed test suites). Commands come only
// from `verification.suites` in the configuration the core bound for the prepared request; the model never supplies one.
export type SuiteFormat = 'node-tap-v13' | 'junit-xml';
/** The configured suites, keyed by `suiteId` (the shape of `verification.suites`). */
export type SuiteTable = Readonly<Record<string, { command: readonly string[]; format: SuiteFormat }>>;

/** Resolves a suiteId to its fixed command. Own keys only, so `__proto__` or `constructor` are unknown suites. */
export function resolveSuite(table: SuiteTable, suiteId: string): { executable: string; args: string[]; format: SuiteFormat } | undefined {
  if (!Object.prototype.hasOwnProperty.call(table, suiteId)) return undefined;
  const entry = table[suiteId];
  if (!entry || entry.command.length === 0) return undefined;
  return { executable: entry.command[0], args: entry.command.slice(1), format: entry.format };
}
