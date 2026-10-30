// What the CLI and the tests import. Everything else in src/ is internal, and
// free to move as the framework takes shape.
export { CHECKS, runChecks } from './checks.js';
export { exposureGuide, DOCS } from './guide.js';
export { isEnvFile, isNodeModules } from './patterns.js';
export { ACK_FILE } from './acknowledge.js';
export { fence, snapshot } from './snapshot.js';
