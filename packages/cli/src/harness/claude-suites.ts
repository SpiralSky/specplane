// D16 option A (`architecture/claude-integration` § Reviewed test suites, applied as A8; gated on a live check): reviewed test suites for the Claude workflow server.
// The table is bundled in the extension package, keyed by `suiteId`. The model never supplies a command: it can only
// ask the server to run the suites a prepared request already requires, and each is resolved here.
export type SuiteFormat = 'node-tap-v13' | 'junit-xml';
/** A host-fixed command. `executable: 'node'` means the running Node binary (`process.execPath`); anything else must be absolute. */
export interface SuiteCommand { executable: string; args: readonly string[]; format: SuiteFormat }
export type SuiteTable = Readonly<Record<string, SuiteCommand>>;

/**
 * The reviewed suites shipped with the package. G3 (2026-11-05, user away): conservative entries drawn from this
 * repository's own test command, FLAGGED FOR THE USER'S REVIEW. Each runs one compiled test file with the Node binary and the
 * TAP reporter (`node --test --test-reporter=tap`, report on stdout, no shell), relative to the checkout, so it applies when
 * the checkout is this repository with `packages/cli/dist` built. The core matches a requirement's `suiteId` to a suite name
 * in the report, and the Node reporter names suites after top-level tests, so each key is the exact name of one top-level
 * test in the file; the whole file runs and any failure in it fails the run. No entry exists for any other repository.
 */
export const BUNDLED_SUITES: SuiteTable = Object.freeze({
  'the bundled table ships no invented suite, and own-key lookup only': { executable: 'node', args: ['--test', '--test-reporter=tap', 'packages/cli/dist/harness/claude-mcp-suites.test.js'], format: 'node-tap-v13' },
  'D17 A: the first record parks the challenge, the second record with confirm writes the spec': { executable: 'node', args: ['--test', '--test-reporter=tap', 'packages/cli/dist/harness/claude-mcp-confirmation.test.js'], format: 'node-tap-v13' },
  'list is read-only and reports a live owner': { executable: 'node', args: ['--test', '--test-reporter=tap', 'packages/cli/dist/commands/workflow.test.js'], format: 'node-tap-v13' },
});

/** Resolves a suiteId to its fixed command. Own keys only, so `__proto__` or `constructor` are unknown suites. */
export function resolveSuite(table: SuiteTable, suiteId: string): { executable: string; args: string[]; format: SuiteFormat } | undefined {
  if (!Object.prototype.hasOwnProperty.call(table, suiteId)) return undefined;
  const entry = table[suiteId];
  return { executable: entry.executable === 'node' ? process.execPath : entry.executable, args: [...entry.args], format: entry.format };
}
