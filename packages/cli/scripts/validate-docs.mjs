import { coreInfo } from '../dist/core/build-info.js';
import { loadDocumentationBundle } from '../dist/docs/bundle.js';

// Release assets must be usable without the source repository or a network.
loadDocumentationBundle(undefined, {
  core_version: coreInfo.version,
  docs_version: coreInfo.docsVersion,
  contract_version: coreInfo.contractVersion,
});
