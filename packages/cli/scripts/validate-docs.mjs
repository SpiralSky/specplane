import { coreInfo } from '../dist/build-info.js';
import { loadDocumentationBundle } from '../dist/docs/bundle.js';
import { loadEssentials } from '../dist/docs/operations.js';

// Release assets must be usable without the source repository or a network.
loadDocumentationBundle(undefined, {
  core_version: coreInfo.version,
  docs_version: coreInfo.docsVersion,
  contract_version: coreInfo.contractVersion,
});
loadEssentials();
