import { loadConfig } from '../config.js';
import { startPlan, type StartOptions } from './flows.js';

/** Fixture setup uses the real start implementation without a separate CLI process.
 * The callback is synchronous; identity and executable overrides are restored before
 * another test can run. Assertions about CLI output still use the CLI itself. */
export function startFixture(root: string, id: string, env: NodeJS.ProcessEnv, options: StartOptions = {}) {
  const keys = ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL', 'SPECPLANE_AGENT', 'SPECPLANE_SESSION', 'PATH'];
  const previous = keys.map(key => process.env[key]);
  try {
    for (const key of keys) {
      if (env[key] === undefined) delete process.env[key];
      else process.env[key] = env[key];
    }
    return startPlan(id, loadConfig(root).config, root, options);
  } finally {
    keys.forEach((key, i) => {
      if (previous[i] === undefined) delete process.env[key];
      else process.env[key] = previous[i];
    });
  }
}
