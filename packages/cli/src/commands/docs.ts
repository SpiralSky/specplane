import { DocumentationBundleError } from '../docs/bundle.js';
import { DocsUsageError, docsIndex, docsSearch, docsTopic, renderIndex, renderSearch, renderTopic } from '../docs/operations.js';

export interface DocsOptions { json?: boolean }

/** Offline: no repository, configuration or network lookup happens here. */
function run(produce: () => string): void {
  try { process.stdout.write(produce()); }
  catch (e) {
    if (e instanceof DocsUsageError || e instanceof DocumentationBundleError) { process.stderr.write(`${e.message}\n`); process.exitCode = 1; }
    else throw e;
  }
}
const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n';

export function docsCommand(topic: string | undefined, opts: DocsOptions): void {
  run(() => {
    if (topic === undefined) { const index = docsIndex(); return opts.json ? json(index) : renderIndex(index); }
    const result = docsTopic(topic);
    return opts.json ? json(result) : renderTopic(result);
  });
}
export function docsSearchCommand(words: string[], opts: DocsOptions): void {
  run(() => { const result = docsSearch(words.join(' ')); return opts.json ? json(result) : renderSearch(result); });
}
