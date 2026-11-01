// What the CLI and the tests import. Everything else in src/ is internal, and
// free to move as the framework takes shape.
export { CHECKS, runChecks, selectChecks } from './checks.js';
export { FINDING_KEYS, ITEM_KEYS, SEVERITIES, STATUSES } from './finding.js';
export { verdict } from './verdict.js';
export { ACTION_KINDS, DOCS, RULES, exposureGuide, guideCommands, guideLines } from './guide.js';
export { KINDS, RISKY_CATEGORIES, isEnvFile, vendoredOf, vendoredRoots } from './patterns.js';
export { ACK_FILE, CONFIG_VERSION } from './acknowledge.js';
export { fence, isBareRepo, repositoryRoot, snapshot } from './snapshot.js';
