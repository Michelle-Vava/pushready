// Which file names count as risky. Pure data and matching: nothing in this
// module touches the filesystem or git, which is what makes it the easiest file
// in the codebase to review for correctness.
import { basename } from 'node:path';

// .env, .env.local, .env.production ... but not .env.example / .env.sample / .env.template.
// Case-insensitive, like every other pattern here: Windows and macOS have
// case-insensitive filesystems, so a .ENV there is the same file as a .env.
const ENV_FILE = /^\.env(\..+)?$/i;
const ENV_TEMPLATE = /\.(example|sample|template|dist)$/i;

export function isEnvFile(path) {
  const name = basename(path);
  return ENV_FILE.test(name) && !ENV_TEMPLATE.test(name);
}

export function isNodeModules(path) {
  return path.split('/').includes('node_modules');
}

// Filename conventions that commonly hold secrets or personal data.
//
// pushready never opens these files, so a match means "this name is normally
// used for X", not "this file definitely contains a secret". Messages are
// worded as a warning to check, not as an accusation. Order matters: the first
// category that matches wins, so .env is a credential rather than a data file.
// TODO(v0.3.1): `status` on each category is a *severity* — how bad the check is
// when it fires — not a *status*, which is what happened on this run. Rename it
// to `severity`, and let a result carry both, so that "a blocker that passed" and
// "a blocker that was acknowledged" become expressible. --strict, the JSON schema
// and the verdict line all need the two axes kept apart.
export const RISKY_CATEGORIES = [
  {
    id: 'history-keys',
    name: 'private key file',
    status: 'fail',
    // .jks and .keystore are Java keystores, .ppk a PuTTY private key. All three
    // hold private keys even though the extension does not say "key".
    test: (name) => /^id_(rsa|dsa|ecdsa|ed25519)$/i.test(name) || /\.(pem|key|p12|pfx|jks|keystore|ppk)$/i.test(name),
    advice: {
      pushed: 'These names are normally used for private keys, and they were pushed. Replace any key that was real, then see "What to do next" below.',
      local: 'These names are normally used for private keys. Deleting the file in a later commit does not remove it — see "What to do next" below.',
      kept: 'These names are normally used for private keys. Nothing on a branch holds them, so no history rewrite is needed — see "What to do next" below.',
    },
  },
  {
    id: 'history-credentials',
    name: 'credential file',
    status: 'fail',
    // kubeconfig holds cluster tokens and client keys; .pgpass holds database
    // passwords in the clear. Terraform state is here rather than under data
    // because it routinely records provider credentials and generated passwords
    // in plain text — things that can, and should, be rotated.
    test: (name) =>
      isEnvFile(name) ||
      /^credentials\.json$/i.test(name) ||
      /^service-account.*\.json$/i.test(name) ||
      /^\.netrc$/i.test(name) ||
      /^kubeconfig$/i.test(name) ||
      /^\.pgpass$/i.test(name) ||
      /\.tfstate(\.backup)?$/i.test(name),
    advice: {
      pushed: 'These names are normally used for logins or API tokens, and they were pushed. Rotate anything that was real, then see "What to do next" below.',
      local: 'These names are normally used for logins or API tokens. Deleting the file in a later commit does not remove it — see "What to do next" below.',
      kept: 'These names are normally used for logins or API tokens. Nothing on a branch holds them, so no history rewrite is needed — see "What to do next" below.',
    },
  },
  {
    id: 'history-data',
    name: 'data file',
    status: 'warn',
    test: (name) => /\.(sqlite3?|db)$/i.test(name),
    advice: {
      pushed: 'These names are normally used for databases, and they were pushed. Leaked data cannot be rotated — see "What to do next" below.',
      local: 'These names are normally used for databases, which may hold personal data. See "What to do next" below.',
      kept: 'These names are normally used for databases, which may hold personal data. Nothing on a branch holds them — see "What to do next" below.',
    },
  },
];

// Names that match a pattern above but are public or harmless by convention.
// Certificates (.crt, .cer, .csr) are simply not in any list: they are meant to be shared.
const NOT_RISKY = [/\.pub$/i, /^thumbs\.db$/i];

export function categoryOf(path) {
  const name = basename(path);
  if (NOT_RISKY.some((re) => re.test(name))) return null;
  return RISKY_CATEGORIES.find((c) => c.test(name)) ?? null;
}
