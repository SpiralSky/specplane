// PROVISIONAL (D16 option A, awaiting approval of the proposal's A8): reviewed test suites for the Claude workflow server.
// The table is bundled in the extension package, keyed by `suiteId`. The model never supplies a command: it can only
// ask the server to run the suites a prepared request already requires, and each is resolved here.
export type SuiteFormat = 'node-tap-v13' | 'junit-xml';
/** A host-fixed command. `executable: 'node'` means the running Node binary (`process.execPath`); anything else must be absolute. */
export interface SuiteCommand { executable: string; args: readonly string[]; format: SuiteFormat }
export type SuiteTable = Readonly<Record<string, SuiteCommand>>;

/**
 * The reviewed suites shipped with the package. Empty until the user reviews and adds entries: no suite is invented
 * here, so with this table every `suiteId` is unknown and refused.
 */
export const BUNDLED_SUITES: SuiteTable = Object.freeze({});

/** Resolves a suiteId to its fixed command. Own keys only, so `__proto__` or `constructor` are unknown suites. */
export function resolveSuite(table: SuiteTable, suiteId: string): { executable: string; args: string[]; format: SuiteFormat } | undefined {
  if (!Object.prototype.hasOwnProperty.call(table, suiteId)) return undefined;
  const entry = table[suiteId];
  return { executable: entry.executable === 'node' ? process.execPath : entry.executable, args: [...entry.args], format: entry.format };
}
