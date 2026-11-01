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

// Dependency trees and build output that belong in .gitignore, not in git.
//
// Each entry finds the *root folder* that was committed, so the report names
// "venv" rather than the 1,200 files under it, and the fix is one "git rm -r".
// Detection is by marker, not by folder name, because folder names are not
// evidence: plenty of projects have a legitimate `bin/` or `vendor/`, and Go
// vendoring is deliberate. A `pyvenv.cfg` or a `site-packages/` segment is not
// ambiguous in the same way.
//
// git always reports paths with "/", on Windows too, so splitting on "/" here
// is correct rather than a POSIX assumption.
const before = (parts, index) => parts.slice(0, index).join('/');

export const VENDORED = [
  {
    id: 'npm',
    what: 'installed npm packages',
    rootOf(parts) {
      const at = parts.indexOf('node_modules');
      return at === -1 ? null : before(parts, at + 1);
    },
  },
  {
    id: 'python',
    what: 'an installed Python environment',
    rootOf(parts) {
      // venv/lib/python3.12/site-packages/... and .venv\Lib\site-packages on
      // Windows, which git still reports with forward slashes.
      const at = parts.indexOf('site-packages');
      if (at !== -1) {
        const lib = parts.findIndex((p, n) => n < at && /^lib$/i.test(p));
        return before(parts, lib === -1 ? at : lib);
      }
      // The file every virtualenv has at its root.
      const cfg = parts.indexOf('pyvenv.cfg');
      return cfg === -1 ? null : before(parts, cfg);
    },
  },
  {
    id: 'composer',
    what: 'installed Composer packages',
    rootOf(parts) {
      // vendor/autoload.php is Composer's; a bare vendor/ is not evidence.
      const at = parts.indexOf('autoload.php');
      return at > 0 && parts[at - 1] === 'vendor' ? before(parts, at) : null;
    },
  },
  {
    id: 'bundler',
    what: 'installed Ruby gems',
    rootOf(parts) {
      const at = parts.indexOf('bundle');
      return at > 0 && parts[at - 1] === 'vendor' ? before(parts, at + 1) : null;
    },
  },
  {
    id: 'dotnet',
    what: '.NET build output',
    rootOf(parts) {
      // bin/Debug, bin/Release, obj/Debug ... and obj/project.assets.json, the
      // restore artifact. A bare bin/ or obj/ is left alone.
      const at = parts.findIndex((p, n) => n > 0 && /^(Debug|Release)$/i.test(p) && /^(bin|obj)$/i.test(parts[n - 1]));
      if (at !== -1) return before(parts, at + 1);
      const assets = parts.indexOf('project.assets.json');
      return assets > 0 && /^obj$/i.test(parts[assets - 1]) ? before(parts, assets) : null;
    },
  },
];

/**
 * The committed dependency tree a path belongs to, as `{ root, what }`, or null.
 * `root` is the folder to untrack; `what` describes it in the report.
 */
export function vendoredOf(path) {
  const parts = path.split('/');
  for (const kind of VENDORED) {
    const root = kind.rootOf(parts);
    if (root) return { root, what: kind.what, id: kind.id };
  }
  return null;
}

/** Every committed dependency root among `paths`, with how many files each holds. */
export function vendoredRoots(paths) {
  const roots = new Map();
  for (const path of paths) {
    const found = vendoredOf(path);
    if (!found) continue;
    const seen = roots.get(found.root) ?? { ...found, files: 0 };
    seen.files++;
    roots.set(found.root, seen);
  }
  return [...roots.values()].sort((a, b) => a.root.localeCompare(b.root));
}

// Filename conventions that commonly hold secrets or personal data.
//
// pushready never opens these files, so a match means "this name is normally
// used for X", not "this file definitely contains a secret". Messages are
// worded as a warning to check, not as an accusation. Order matters: the first
// category that matches wins, so .env is a credential rather than a data file.
//
// `severity` is how bad a check is when it fires, fixed per check; `status` is
// what happened on this run, and lives on the result. Keeping them apart is what
// lets "a blocker that passed" and "a blocker that was acknowledged" be said.
//
// `kind` is what the guide groups advice by. A credential can be rotated after a
// leak; data cannot. Every category must have one of KINDS, and the guide must
// have advice for every kind, which the test suite holds it to.
export const KINDS = ['credential', 'data'];

export const RISKY_CATEGORIES = [
  {
    id: 'history-keys',
    title: 'Private keys in history',
    name: 'private key file',
    severity: 'blocker',
    kind: 'credential',
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
    title: 'Credential files in history',
    name: 'credential file',
    severity: 'blocker',
    kind: 'credential',
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
    title: 'Database files in history',
    name: 'data file',
    severity: 'warning',
    kind: 'data',
    test: (name) => /\.(sqlite3?|db)$/i.test(name),
    advice: {
      pushed: 'These names are normally used for databases, and they were pushed. Leaked data cannot be rotated — see "What to do next" below.',
      local: 'These names are normally used for databases, which may hold personal data. See "What to do next" below.',
      kept: 'These names are normally used for databases, which may hold personal data. Nothing on a branch holds them — see "What to do next" below.',
    },
  },
];

// Names that match a pattern above but are public or harmless by convention.
// Certificates (.crt, .cer, .csr) are simply not in any list: they are meant to
// be shared. A CA bundle is a list of *public* root certificates — every Python
// environment ships one as certifi/cacert.pem, and matching ".pem" told people
// to rotate a key and rewrite history over a file anyone can download.
const NOT_RISKY = [
  /\.pub$/i,
  /^thumbs\.db$/i,
  /^ca-?cert(s|ificates)?\.(pem|crt)$/i,
  /^ca-?bundle\.(pem|crt)$/i,
  /^cacerts$/i,
];

export function categoryOf(path) {
  const name = basename(path);
  if (NOT_RISKY.some((re) => re.test(name))) return null;
  // A risky name inside a committed dependency tree is a third-party file, not
  // the user's secret: node_modules and site-packages are full of test keys and
  // CA bundles. Reporting each one buries the real finding, which is that the
  // whole tree was committed — and untracking it removes them all at once.
  if (vendoredOf(path)) return null;
  return RISKY_CATEGORIES.find((c) => c.test(name)) ?? null;
}
